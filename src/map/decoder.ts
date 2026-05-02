/**
 * Pure live-map decoder.
 *
 * No IO, no MQTT, no network — `MapDecoder.decode(bytes)` takes the raw
 * MQTT push value (or the OSS-fetched bytes) and returns a fully parsed
 * `MapData`. Side-channel hints (per-blob AES key, per-model AES IV) go
 * in `MapDecodeOptions`.
 *
 * Phase 1 surface (this file):
 *   - envelope unwrap: base64 → optional AES-256-CBC → zlib inflate
 *   - 27-byte header parse
 *   - JSON tail parse (`timestamp_ms`, `origin`, `mra`, `oc`, `tr`,
 *     `sa`, `seg_inf`, `ai_obstacle`)
 *   - pixel grid → run-length layers using **path B (frame-map mode)**,
 *     since r2532a runs `fsm: 1` (verified Phase 0)
 *   - segment bbox + centroid scan
 *   - cleaning-path (`tr`) regex parse
 *   - obstacle list parse
 *
 * P-frame merging (`applyPFrame`) lands in Phase 2.
 *
 * AES is currently a no-op for the live `MAP_DATA` channel on r2532a
 * (Phase 0 finding) but the option is wired through for completeness so
 * later channels (POINTER_JSON OSS blobs, OLD_MAP_DATA, photo files)
 * can plug in once observed.
 */

import * as zlib from "node:zlib";
import { createDecipheriv, createHash } from "node:crypto";
import type {
  MapData,
  MapDecodeOptions,
  MapDimensions,
  MapFrameType,
  MapLayer,
  MapObstacle,
  MapPath,
  MapPathType,
  MapPose,
  MapRun,
  MapSegment,
} from "./types.js";

// ─── Public class ───────────────────────────────────────────────────

export class MapDecoder {
  /**
   * Decode a single frame envelope to a `MapData`. Accepts the raw MQTT
   * value (URL-safe base64 string, optionally with `,<aes-key>` suffix)
   * or the inflated bytes directly (`Buffer`). Pure — no IO.
   */
  static decode(input: Buffer | string, opts: MapDecodeOptions = {}): MapData {
    const inflated = typeof input === "string" ? unwrapEnvelope(input, opts) : input;
    const header = parseMapHeader(inflated);
    const tailText = sliceTailText(inflated, header);
    const tail = parseMapJsonTail(tailText);

    const dimensions = mergeDimensions(header, tail);
    const robot = pose(header.robotX, header.robotY, header.robotA, tail.nr === true);
    const dock = pose(header.chargerX, header.chargerY, header.chargerA, tail.nc === true);
    const docked = tail.oc === true;

    // Pixel grid in a P-frame is byte-add deltas over a previous I-frame's
    // grid, not absolute classifications — decoding it standalone produces
    // garbage (high-byte deltas masquerade as segment ids). Only run the
    // pixel decoder on I-frames; Phase 2's merge will produce a synthetic
    // I-frame for ongoing P-frame state.
    const pixelStart = HEADER_SIZE;
    const pixelEnd = pixelStart + header.width * header.height;
    const pixelGrid = inflated.subarray(pixelStart, pixelEnd);
    const canDecodePixels =
      header.frameType === "I" && pixelGrid.length === header.width * header.height;
    const layers = canDecodePixels
      ? decodePixelGridFsm1(pixelGrid, header.width, header.height)
      : [];

    const segments = canDecodePixels ? collectSegments(layers, dimensions, tail) : [];
    const paths = parsePathTr(tail.tr ?? "");
    const obstacles = parseObstacles(tail.ai_obstacle ?? []);

    return {
      mapId: header.mapId,
      frameId: header.frameId,
      frameType: header.frameType,
      timestamp: tail.timestamp_ms ?? 0,
      rotation: tail.mra ?? 0,
      dimensions,
      robot,
      dock,
      docked,
      layers,
      segments,
      paths,
      obstacles,
    };
  }
}

// ─── Envelope unwrap ────────────────────────────────────────────────

/** Bytes 0-26 are the fixed-layout binary header. */
export const HEADER_SIZE = 27;

/** Sentinel value in `robot.a` / `charger.a` meaning "absent". */
export const ANGLE_ABSENT = 0x7fff;

/** Frame-type byte values from the header. */
export const FRAME_TYPE = {
  I: 73,
  P: 80,
  W: 87,
} as const;

export class MapDecodeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MapDecodeError";
  }
}

/**
 * Unwrap a raw MAP_DATA envelope value: URL-safe base64 → optional
 * AES-256-CBC decrypt → zlib inflate. The returned buffer starts with
 * the 27-byte header.
 *
 * If the value contains a comma, everything after the first comma is
 * treated as the per-blob AES key and AES is forced on (matching the
 * outer-envelope convention from Tasshack `map.py:3759-3792`). If `opts.key`
 * and `opts.iv` are also supplied, the embedded key wins.
 */
export function unwrapEnvelope(value: string, opts: MapDecodeOptions = {}): Buffer {
  const commaIdx = value.indexOf(",");
  const b64 = commaIdx >= 0 ? value.slice(0, commaIdx) : value;
  const embeddedKey = commaIdx >= 0 ? value.slice(commaIdx + 1) : null;

  const standard = b64.replace(/-/g, "+").replace(/_/g, "/");
  let bytes: Buffer;
  try {
    bytes = Buffer.from(standard, "base64");
  } catch (err) {
    throw new MapDecodeError("envelope: base64 decode failed", { cause: err });
  }
  if (bytes.length === 0) {
    throw new MapDecodeError("envelope: empty payload after base64 decode");
  }

  const key = embeddedKey ?? opts.key ?? null;
  if (key) {
    if (!opts.iv) {
      throw new MapDecodeError("envelope: AES key supplied but no IV — pass `opts.iv` (16-byte ASCII)");
    }
    bytes = aesCbcDecrypt(bytes, key, opts.iv);
  }

  try {
    return zlib.inflateSync(bytes);
  } catch (err) {
    throw new MapDecodeError("envelope: zlib inflate failed", { cause: err });
  }
}

function aesCbcDecrypt(cipher: Buffer, rawKey: string, iv: string): Buffer {
  const keyBytes = Buffer.from(createHash("sha256").update(rawKey).digest("hex").slice(0, 32), "utf8");
  const ivBytes = Buffer.from(iv, "utf8");
  if (ivBytes.length !== 16) {
    throw new MapDecodeError(`envelope: AES IV must be 16 ASCII bytes, got ${ivBytes.length}`);
  }
  try {
    const decipher = createDecipheriv("aes-256-cbc", keyBytes, ivBytes);
    decipher.setAutoPadding(false);
    return Buffer.concat([decipher.update(cipher), decipher.final()]);
  } catch (err) {
    throw new MapDecodeError("envelope: AES decrypt failed", { cause: err });
  }
}

// ─── Header parse ───────────────────────────────────────────────────

export interface MapHeader {
  mapId: number;
  frameId: number;
  frameType: MapFrameType;
  robotX: number;
  robotY: number;
  robotA: number;
  chargerX: number;
  chargerY: number;
  chargerA: number;
  gridSize: number;
  width: number;
  height: number;
  left: number;
  top: number;
}

export function parseMapHeader(buf: Buffer): MapHeader {
  if (buf.length < HEADER_SIZE) {
    throw new MapDecodeError(`header: need ${HEADER_SIZE} bytes, got ${buf.length}`);
  }
  return {
    mapId: buf.readInt16LE(0),
    frameId: buf.readInt16LE(2),
    frameType: frameTypeFromByte(buf[4]!),
    robotX: buf.readInt16LE(5),
    robotY: buf.readInt16LE(7),
    robotA: buf.readInt16LE(9),
    chargerX: buf.readInt16LE(11),
    chargerY: buf.readInt16LE(13),
    chargerA: buf.readInt16LE(15),
    gridSize: buf.readInt16LE(17),
    width: buf.readInt16LE(19),
    height: buf.readInt16LE(21),
    left: buf.readInt16LE(23),
    top: buf.readInt16LE(25),
  };
}

function frameTypeFromByte(b: number): MapFrameType {
  switch (b) {
    case FRAME_TYPE.I:
      return "I";
    case FRAME_TYPE.P:
      return "P";
    case FRAME_TYPE.W:
      return "W";
    default:
      throw new MapDecodeError(`header: unknown frame_type byte ${b}`);
  }
}

// ─── JSON tail parse ────────────────────────────────────────────────

/**
 * Subset of the JSON tail keys that v1 actually consumes. Keep the
 * shape loose — Dreame adds keys without notice and we don't want to
 * fail on unknown ones.
 */
export interface MapTail {
  timestamp_ms?: number;
  /** `[left, top]` — overrides header dimensions when present. */
  origin?: [number, number];
  /** Rotation in degrees. */
  mra?: number;
  /** Docked flag. */
  oc?: boolean;
  /** No-charger flag. */
  nc?: boolean;
  /** No-robot flag. */
  nr?: boolean;
  /** Cleaning path string — see `parsePathTr`. */
  tr?: string;
  /** Active segment ids: `[[id], [id], ...]`. */
  sa?: number[][];
  /** Per-segment metadata, keyed by stringified id. */
  seg_inf?: Record<string, RawSegInf>;
  /** AI-detected obstacles, each a positional list. */
  ai_obstacle?: unknown[][];
  /** Optional `fsm` flag — `1` means frame-map mode (path B decoder). */
  fsm?: number;
  [key: string]: unknown;
}

export interface RawSegInf {
  /** Adjacent segment ids. */
  nei_id?: number[];
  /** Floor material code. */
  material?: number;
  /** Floor direction code. */
  direction?: number;
  /** Base64-encoded display name. */
  name?: string;
  type?: number;
  [key: string]: unknown;
}

export function sliceTailText(inflated: Buffer, header: MapHeader): string {
  const start = HEADER_SIZE + header.width * header.height;
  if (inflated.length < start) {
    throw new MapDecodeError(`tail: inflated payload shorter than header+pixels (${inflated.length} < ${start})`);
  }
  return inflated.subarray(start).toString("utf8");
}

export function parseMapJsonTail(text: string): MapTail {
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text) as MapTail;
  } catch (err) {
    throw new MapDecodeError("tail: JSON parse failed", { cause: err });
  }
}

function mergeDimensions(header: MapHeader, tail: MapTail): MapDimensions {
  const left = tail.origin?.[0] ?? header.left;
  const top = tail.origin?.[1] ?? header.top;
  return {
    left,
    top,
    width: header.width,
    height: header.height,
    gridSize: header.gridSize,
  };
}

function pose(x: number, y: number, angle: number, absent: boolean): MapPose | null {
  if (absent || angle === ANGLE_ABSENT) {
    return null;
  }
  return { x, y, angle };
}

// ─── Pixel grid → layers (path B / frame-map mode) ───────────────────

/**
 * Pixel-byte classifications for path B (`fsm: 1`).
 *
 * Layout (per roadmap):
 *   bits 7-2 = segment_id (top 6 bits, range 0..63)
 *   bits 1-0 = meta (low 2 bits)
 *
 * Special segment ids: 63 = WALL, 62 = FLOOR, 61 = UNKNOWN.
 * When the top 6 bits are zero, the low 2 bits encode markers
 * (01 = NEW_SEGMENT, 10 = WALL).
 * The `11` low-bit meta is a CARPET overlay independent of segment id.
 *
 * v1 layer types collapse this down to `wall | floor | segment`.
 * Carpet overlay is dropped for now — extending the v1 contract is a
 * separate decision (see types.ts MapLayerType).
 */
export type PixelClass = "wall" | "floor" | "segment" | "outside";

export function classifyPixelFsm1(byte: number): { kind: PixelClass; segmentId?: number } {
  if (byte === 0) {
    return { kind: "outside" };
  }
  const seg = byte >> 2;
  const meta = byte & 3;

  if (seg === 63) {
    return { kind: "wall" };
  }
  if (seg === 62) {
    return { kind: "floor" };
  }
  if (seg === 61) {
    return { kind: "outside" };
  }
  if (seg === 0) {
    if (meta === 2) {
      return { kind: "wall" };
    }
    return { kind: "outside" };
  }
  return { kind: "segment", segmentId: seg };
}

/**
 * Walk the pixel grid row-by-row and emit run-length layers. Each row
 * resets the run state; runs never cross row boundaries (so the renderer
 * doesn't need to know the width to interpret them).
 */
export function decodePixelGridFsm1(pixels: Buffer, width: number, height: number): MapLayer[] {
  const wallRuns: MapRun[] = [];
  const floorRuns: MapRun[] = [];
  const segmentRuns = new Map<number, MapRun[]>();

  for (let y = 0; y < height; y++) {
    const rowBase = y * width;
    let runStart = -1;
    let runKind: PixelClass = "outside";
    let runSegmentId = 0;
    for (let x = 0; x <= width; x++) {
      const byte = x < width ? pixels[rowBase + x]! : 0;
      const c = x < width ? classifyPixelFsm1(byte) : { kind: "outside" as const };
      const sameAsRun =
        runStart >= 0 &&
        c.kind === runKind &&
        (c.kind !== "segment" || c.segmentId === runSegmentId);
      if (sameAsRun) {
        continue;
      }
      // Emit the previous run (if any).
      if (runStart >= 0 && runKind !== "outside") {
        const length = x - runStart;
        const run: MapRun = [runStart, y, length];
        if (runKind === "wall") {
          wallRuns.push(run);
        } else if (runKind === "floor") {
          floorRuns.push(run);
        } else if (runKind === "segment") {
          let bucket = segmentRuns.get(runSegmentId);
          if (!bucket) {
            bucket = [];
            segmentRuns.set(runSegmentId, bucket);
          }
          bucket.push(run);
        }
      }
      // Start a new run.
      if (x < width && c.kind !== "outside") {
        runStart = x;
        runKind = c.kind;
        runSegmentId = c.kind === "segment" ? c.segmentId! : 0;
      } else {
        runStart = -1;
      }
    }
  }

  const layers: MapLayer[] = [];
  if (wallRuns.length > 0) {
    layers.push({ type: "wall", runs: wallRuns });
  }
  if (floorRuns.length > 0) {
    layers.push({ type: "floor", runs: floorRuns });
  }
  for (const [id, runs] of [...segmentRuns.entries()].sort(([a], [b]) => a - b)) {
    layers.push({ type: "segment", segmentId: id, runs });
  }
  return layers;
}

// ─── Segments (bbox + centroid + metadata merge) ─────────────────────

function collectSegments(layers: MapLayer[], dim: MapDimensions, tail: MapTail): MapSegment[] {
  const activeIds = new Set<number>();
  for (const entry of tail.sa ?? []) {
    if (Array.isArray(entry) && typeof entry[0] === "number") {
      activeIds.add(entry[0]);
    }
  }

  const segs: MapSegment[] = [];
  for (const layer of layers) {
    if (layer.type !== "segment" || layer.segmentId === undefined) {
      continue;
    }
    const id = layer.segmentId;
    let xMinPx = Infinity;
    let yMinPx = Infinity;
    let xMaxPx = -Infinity;
    let yMaxPx = -Infinity;
    let sumXPx = 0;
    let sumYPx = 0;
    let count = 0;
    for (const [x, y, len] of layer.runs) {
      if (x < xMinPx) {
        xMinPx = x;
      }
      if (y < yMinPx) {
        yMinPx = y;
      }
      if (x + len - 1 > xMaxPx) {
        xMaxPx = x + len - 1;
      }
      if (y > yMaxPx) {
        yMaxPx = y;
      }
      // centroid sum: for a run of `len` pixels starting at `x`, the
      // x-sum is len*x + (0+1+...+len-1) = len*x + len*(len-1)/2
      sumXPx += len * x + (len * (len - 1)) / 2;
      sumYPx += len * y;
      count += len;
    }
    if (count === 0) {
      continue;
    }

    const meta = tail.seg_inf?.[String(id)] ?? null;
    const bbox = {
      xMin: dim.left + xMinPx * dim.gridSize,
      yMin: dim.top + yMinPx * dim.gridSize,
      xMax: dim.left + (xMaxPx + 1) * dim.gridSize,
      yMax: dim.top + (yMaxPx + 1) * dim.gridSize,
    };
    const centroid = {
      x: dim.left + (sumXPx / count) * dim.gridSize,
      y: dim.top + (sumYPx / count) * dim.gridSize,
    };

    segs.push({
      id,
      name: meta?.name ? safeBase64ToUtf8(meta.name) : null,
      bbox,
      centroid,
      neighbours: meta?.nei_id ?? [],
      floorMaterial: meta?.material ?? null,
      floorDirection: meta?.direction ?? null,
      active: activeIds.has(id),
    });
  }
  return segs;
}

function safeBase64ToUtf8(s: string): string | null {
  try {
    return Buffer.from(s, "base64").toString("utf8");
  } catch {
    return null;
  }
}

// ─── Cleaning path (`tr` field) ──────────────────────────────────────

const PATH_TYPE_FROM_OP: Record<string, MapPathType> = {
  M: "mop",
  W: "sweep-and-mop",
  S: "sweep",
  L: "line",
};

const PATH_OP_REGEX = /([MWSLl])(-?\d+),(-?\d+)/g;

/**
 * Parse Dreame's compact path string into typed segments.
 *
 * Each op letter starts a new segment:
 *   M = mop,   W = sweep+mop,   S = sweep,   L = line moveTo,
 *   l = P-frame line continuation (treated as L per Tasshack map.py:3987).
 *
 * Coordinates are millimetres world-frame.
 */
export function parsePathTr(tr: string): MapPath[] {
  if (!tr) {
    return [];
  }
  const out: MapPath[] = [];
  let current: MapPath | null = null;
  for (const m of tr.matchAll(PATH_OP_REGEX)) {
    const opRaw = m[1]!;
    const x = Number(m[2]);
    const y = Number(m[3]);
    const op = opRaw === "l" ? "L" : opRaw;
    const type = PATH_TYPE_FROM_OP[op];
    if (!type) {
      continue;
    }
    if (!current || current.type !== type) {
      current = { type, points: [{ x, y }] };
      out.push(current);
    } else {
      current.points.push({ x, y });
    }
  }
  return out;
}

// ─── Obstacles ──────────────────────────────────────────────────────

/**
 * Decode one `ai_obstacle` entry. Field layout observed on r2532a
 * (2026-05-02 fixtures), 14 positional string fields:
 *   [0] x mm           [1] y mm           [2] type id
 *   [3] confidence 0-1 [4] timestamp.usec [5] photo file path
 *   [6] photo id       [7..10] bbox-like  [11..13] unknown small ints
 *
 * We use field 6 as `id` (numeric, fits comfortably in a JS number) and
 * field 4 (timestamp) is preserved via the schema's existing fields.
 * `photoKey` is left null — no AES key has been observed at this layer
 * on the live channel; it likely arrives via a separate cloud lookup.
 */
export function parseObstacles(raw: unknown[]): MapObstacle[] {
  const out: MapObstacle[] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length < 6) {
      continue;
    }
    const x = parseFloatField(entry[0]);
    const y = parseFloatField(entry[1]);
    const type = parseIntField(entry[2]);
    const confRaw = parseFloatField(entry[3]);
    if (x === null || y === null || type === null) {
      continue;
    }
    const photoFileName = typeof entry[5] === "string" ? entry[5] : null;
    const idCandidate = parseIntField(entry[6]);
    const id = idCandidate ?? Math.round((parseFloatField(entry[4]) ?? 0) * 1e6);
    out.push({
      id,
      x,
      y,
      type,
      confidence: confRaw === null ? 0 : Math.round(confRaw * 100),
      photoFileName,
      photoKey: null,
    });
  }
  return out;
}

function parseFloatField(v: unknown): number | null {
  if (typeof v === "number") {
    return Number.isFinite(v) ? v : null;
  }
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseIntField(v: unknown): number | null {
  const n = parseFloatField(v);
  return n === null ? null : Math.trunc(n);
}
