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
  MapCleanedAreaOverlay,
  MapData,
  MapDecodeOptions,
  MapDimensions,
  MapFrameType,
  MapLayer,
  MapLowLyingArea,
  MapObstacle,
  MapPath,
  MapPathType,
  MapPose,
  MapRestrictedArea,
  MapRoom,
  MapRoomWall,
  MapRun,
  MapSegment,
  MapStorey,
  MapTail,
  MapVirtualWall,
  MapWallsInfo,
} from "./types.js";
import { mergePFrame, mergePFrameEnvelope } from "./merge.js";

// ─── Public class ───────────────────────────────────────────────────

export class MapDecoder {
  /**
   * Decode a single frame envelope to a `MapData`. Accepts the raw MQTT
   * value (URL-safe base64 string, optionally with `,<aes-key>` suffix)
   * or the inflated bytes directly (`Buffer`). Pure — no IO.
   */
  static decode(input: Buffer | string, opts: MapDecodeOptions = {}): MapData {
    const inflated = typeof input === "string" ? unwrapEnvelope(input, opts) : input;
    const { header, tail } = parseFrame(inflated);

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
    let { virtualWalls, restrictedAreas } = parseVirtualWalls(tail.vw, tail.vws);
    let lowLyingAreas = parseLowLyingAreas(tail.sneak_areas_end, tail.sneak_areas);
    let wallsInfo = parseWallsInfo(tail.walls_info);
    // The persistent saved-map blob is embedded inline as `tail.rism`
    // (URL-safe-base64 + zlib + same envelope shape). On r2532a fw
    // 4.3.9_2199 the outer tail's `vw`/`vws` are absent and the
    // geometry lives only in the inner saved-map's tail. Recurse to
    // surface it; if the inner blob fails to decode (corrupt,
    // unexpected shape, missing AES IV, etc.) leave the outer values
    // as-is and swallow the error — geometry decode failure must
    // never break pixel/path/obstacle decode of the outer frame.
    // Recurses one level only — the inner saved-map blob does not
    // carry its own `rism`.
    if (
      (virtualWalls.length === 0 ||
        restrictedAreas.length === 0 ||
        lowLyingAreas.length === 0 ||
        wallsInfo === null) &&
      typeof tail.rism === "string" &&
      tail.rism.length > 0
    ) {
      try {
        const innerInflated = unwrapEnvelope(tail.rism);
        const { tail: innerTail } = parseFrame(innerInflated);
        const inner = parseVirtualWalls(innerTail.vw, innerTail.vws);
        const innerLow = parseLowLyingAreas(innerTail.sneak_areas_end, innerTail.sneak_areas);
        const innerWallsInfo = parseWallsInfo(innerTail.walls_info);
        if (virtualWalls.length === 0 && inner.virtualWalls.length > 0) {
          virtualWalls = inner.virtualWalls;
        }
        if (restrictedAreas.length === 0 && inner.restrictedAreas.length > 0) {
          restrictedAreas = inner.restrictedAreas;
        }
        if (lowLyingAreas.length === 0 && innerLow.length > 0) {
          lowLyingAreas = innerLow;
        }
        if (wallsInfo === null && innerWallsInfo !== null) {
          wallsInfo = innerWallsInfo;
        }
      } catch {
        // intentional — outer frame remains valid even if rism is unreadable
      }
    }
    const cleanedArea =
      typeof tail.decmap === "string" ? parseCleanedAreaOverlay(tail.decmap) : null;

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
      virtualWalls,
      restrictedAreas,
      lowLyingAreas,
      wallsInfo,
      cleanedArea,
    };
  }

  /**
   * Merge a P-frame onto a previous (I-frame or already-merged) inflated
   * frame buffer and decode the result. Returns both the merged buffer
   * (so callers can chain further merges without re-allocating) and the
   * decoded `MapData`.
   *
   * Throws `OutOfOrderFrameError` when `pframe.frameId !== prev.frameId + 1`.
   *
   * Inputs are envelope strings or already-unwrapped buffers — both
   * sides are normalised internally via `unwrapEnvelope` when given a
   * string, with the matching `MapDecodeOptions` for the AES key/IV.
   */
  static applyPFrame(
    prev: Buffer | string,
    pframe: Buffer | string,
    opts: { prev?: MapDecodeOptions; pframe?: MapDecodeOptions } = {},
  ): { buffer: Buffer; data: MapData } {
    const merged =
      typeof prev === "string" || typeof pframe === "string"
        ? mergePFrameEnvelope(prev, pframe, opts.prev, opts.pframe)
        : mergePFrame(prev, pframe);
    return { buffer: merged, data: MapDecoder.decode(merged) };
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
//
// `MapTail` and `RawSegInf` live in `./types.ts` alongside the public
// `MapData` shape — they're the wire-shape contract for everything
// in `src/map/`, not a decoder internal.

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

/**
 * Parse the header + JSON tail from an already-inflated frame buffer.
 *
 * Combines `parseMapHeader` + `sliceTailText` + `parseMapJsonTail`,
 * which the decoder, the rism-recurse path, and `merge.ts` all
 * invoke as a unit. Centralising the sequence keeps the three call
 * sites in lockstep — the alternative is to drift independently if
 * one is updated without the others.
 *
 * Pure; doesn't unwrap base64 — call `unwrapEnvelope` first.
 */
export function parseFrame(inflated: Buffer): { header: MapHeader; tail: MapTail } {
  const header = parseMapHeader(inflated);
  const tail = parseMapJsonTail(sliceTailText(inflated, header));
  return { header, tail };
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

/**
 * Classify a single pixel byte under fsm:1 (path B) layout.
 *
 * `kind` is the primary mutually-exclusive class. `carpet` is an
 * independent overlay flag (low bits == 11): it can co-occur with any
 * primary class — a carpet floor, a carpet pixel inside a segment, etc.
 * The wall marker (low bits == 10 with high bits zero) and the carpet
 * marker share the low-bits field, so a pixel cannot be both "wall
 * marker" and "carpet" at the same time.
 */
export function classifyPixelFsm1(byte: number): {
  kind: PixelClass;
  segmentId?: number;
  carpet?: true;
} {
  if (byte === 0) {
    return { kind: "outside" };
  }
  const seg = byte >> 2;
  const meta = byte & 3;
  const isCarpet = meta === 3;

  if (seg === 63) {
    return isCarpet ? { kind: "wall", carpet: true } : { kind: "wall" };
  }
  if (seg === 62) {
    return isCarpet ? { kind: "floor", carpet: true } : { kind: "floor" };
  }
  if (seg === 61) {
    return { kind: "outside" };
  }
  if (seg === 0) {
    if (meta === 2) {
      return { kind: "wall" };
    }
    if (isCarpet) {
      return { kind: "outside", carpet: true };
    }
    return { kind: "outside" };
  }
  return isCarpet
    ? { kind: "segment", segmentId: seg, carpet: true }
    : { kind: "segment", segmentId: seg };
}

/**
 * Walk the pixel grid row-by-row and emit run-length layers. Each row
 * resets the run state; runs never cross row boundaries (so the renderer
 * doesn't need to know the width to interpret them).
 *
 * Two kinds of run accumulation happen in parallel:
 *   - the primary classification (wall / floor / segment) — one run per
 *     contiguous same-class span
 *   - the carpet overlay — one run per contiguous carpet span, regardless
 *     of underlying primary class (a carpet stripe spanning the boundary
 *     between segment 5 and segment 7 produces one carpet run)
 */
export function decodePixelGridFsm1(pixels: Buffer, width: number, height: number): MapLayer[] {
  const wallRuns: MapRun[] = [];
  const floorRuns: MapRun[] = [];
  const segmentRuns = new Map<number, MapRun[]>();
  const carpetRuns: MapRun[] = [];

  for (let y = 0; y < height; y++) {
    const rowBase = y * width;
    let runStart = -1;
    let runKind: PixelClass = "outside";
    let runSegmentId = 0;
    let carpetStart = -1;
    for (let x = 0; x <= width; x++) {
      const byte = x < width ? pixels[rowBase + x]! : 0;
      const c =
        x < width ? classifyPixelFsm1(byte) : { kind: "outside" as const, carpet: undefined };
      const sameAsRun =
        runStart >= 0 &&
        c.kind === runKind &&
        (c.kind !== "segment" || c.segmentId === runSegmentId);
      if (!sameAsRun) {
        // Emit the previous primary run (if any).
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
        // Start a new primary run.
        if (x < width && c.kind !== "outside") {
          runStart = x;
          runKind = c.kind;
          runSegmentId = c.kind === "segment" ? c.segmentId! : 0;
        } else {
          runStart = -1;
        }
      }

      // Carpet overlay accumulates independently of primary classification.
      const isCarpet = c.carpet === true;
      if (isCarpet && carpetStart < 0) {
        carpetStart = x;
      } else if (!isCarpet && carpetStart >= 0) {
        carpetRuns.push([carpetStart, y, x - carpetStart]);
        carpetStart = -1;
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
  if (carpetRuns.length > 0) {
    layers.push({ type: "carpet", runs: carpetRuns });
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
 * Coordinates are millimetres world-frame for `mop` / `sweep` /
 * `sweep-and-mop` waypoints. **Line ops are RELATIVE deltas** to the
 * preceding absolute waypoint (or the previous point within the same
 * line). The accumulator unwinds them so every surfaced point is
 * absolute world-frame mm — verified live 2026-05-07 against r2532a
 * (without unwinding, 1000s of `line` deltas all cluster around the
 * world origin and render as a tight artifact).
 *
 * When a `line` op appears with no preceding absolute waypoint
 * (e.g. when `tr` starts with `L`/`l` and there's no anchor to
 * accumulate against — rare but possible at the very start of a
 * fresh subscription), the points are emitted literally. Callers
 * downstream of the merge layer don't see this path because P-frame
 * `tr` concatenation always prepends the prior absolute waypoint.
 */
export function parsePathTr(tr: string): MapPath[] {
  if (!tr) {
    return [];
  }
  // Locally mutable so we can push as we walk the regex matches; widened
  // to the public `readonly`-decorated MapPath shape on return.
  type MutablePath = { type: MapPathType; points: { x: number; y: number }[] };
  const out: MutablePath[] = [];
  let current: MutablePath | null = null;
  let anchor: { x: number; y: number } | null = null;
  for (const m of tr.matchAll(PATH_OP_REGEX)) {
    const opRaw = m[1]!;
    const xRaw = Number(m[2]);
    const yRaw = Number(m[3]);
    const op = opRaw === "l" ? "L" : opRaw;
    const type = PATH_TYPE_FROM_OP[op];
    if (!type) {
      continue;
    }
    if (type === "line" && anchor !== null) {
      // Accumulate the relative delta against the running anchor.
      const abs: { x: number; y: number } = {
        x: anchor.x + xRaw,
        y: anchor.y + yRaw,
      };
      if (!current || current.type !== type) {
        // New line segment: seed with the anchor itself so the line
        // draws a continuous trace from the preceding waypoint.
        current = { type, points: [{ x: anchor.x, y: anchor.y }, abs] };
        out.push(current);
      } else {
        current.points.push(abs);
      }
      anchor = abs;
    } else {
      // Either an absolute waypoint (S / W / M) or a `line` with no
      // anchor yet — emit literally.
      const pt = { x: xRaw, y: yRaw };
      if (!current || current.type !== type) {
        current = { type, points: [pt] };
        out.push(current);
      } else {
        current.points.push(pt);
      }
      if (type !== "line") {
        // Absolute waypoint — update the anchor for any following
        // `line` op to accumulate against.
        anchor = pt;
      }
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

/**
 * Parse the `vw` (and optional `vws`) blocks — Dreame's user-defined
 * geometry. Tasshack `dev` `map.py:4597-4702` is the canonical
 * reference; we mirror its shape interpretations:
 *
 * `vw` (classic block):
 *   - `vw.line`: `[x0,y0,x1,y1]` line segments — virtual walls.
 *   - `vw.rect`: `[x0,y0,x1,y1, angle?]` axis-aligned no-go
 *     rectangles. Corners get sorted so the bbox is well-formed
 *     regardless of wire order.
 *   - `vw.mop`: same shape as `vw.rect`, no-mop zones.
 *   - `vw.nocpt`: `[x0,y0,x1,y1]` "do not cross" no-go rectangles —
 *     verified live 2026-05-07 on r2532a as additional no-go zones
 *     the user marked in the app. (Note: NOT carpets despite the
 *     name; Tasshack `map.py:4668` reads them as no-go rects.)
 *
 * `vws` (X50 threshold block — only present when the user has
 * configured thresholds; absent on older firmware):
 *   - `vws.vwsl`: `[x0,y0,x1,y1]` lines. When `vws.npthrsd` is
 *     present in the SAME `vws` object, these are *passable*
 *     thresholds (`kind: "threshold", passable: true`). When
 *     `npthrsd` is absent, they're "virtual" thresholds
 *     (`kind: "threshold"` with no `passable` hint).
 *   - `vws.npthrsd`: `[x0,y0,x1,y1]` lines — *impassable* thresholds
 *     (`kind: "threshold", passable: false`). Verified live
 *     2026-05-07 on r2532a fw 4.3.9_2199.
 *
 * `vw.cliff` and `vws.cliff` (line segments) and `vws.ramp` (areas)
 * have been observed empty on r2532a; they're not surfaced here
 * until a fixture exists for the populated form. `vw.addcpt` /
 * `vws.rec_*` recommendation mirrors are also out of scope for now.
 *
 * Returns empty arrays when both blocks are absent — there's no
 * meaningful difference between "no walls configured" and "this
 * frame doesn't carry the field" at the public-API layer, and the
 * merge layer + rism recurse handle the latter via fallback.
 */
export function parseVirtualWalls(
  vw:
    | {
        line?: number[][];
        rect?: number[][];
        mop?: number[][];
        nocpt?: number[][];
      }
    | undefined,
  vws?: { vwsl?: number[][]; npthrsd?: number[][] } | undefined,
): { virtualWalls: MapVirtualWall[]; restrictedAreas: MapRestrictedArea[] } {
  const virtualWalls: MapVirtualWall[] = [];
  const restrictedAreas: MapRestrictedArea[] = [];

  if (vw) {
    for (const line of vw.line ?? []) {
      const wall = parseLine(line, "wall");
      if (wall) {
        virtualWalls.push(wall);
      }
    }
    for (const rect of vw.rect ?? []) {
      const area = parseRestrictedArea("noGo", rect);
      if (area) {
        restrictedAreas.push(area);
      }
    }
    for (const rect of vw.mop ?? []) {
      const area = parseRestrictedArea("noMop", rect);
      if (area) {
        restrictedAreas.push(area);
      }
    }
    for (const rect of vw.nocpt ?? []) {
      const area = parseRestrictedArea("noGo", rect);
      if (area) {
        restrictedAreas.push(area);
      }
    }
  }

  if (vws) {
    const npthrsdPresent = Array.isArray(vws.npthrsd) && vws.npthrsd.length > 0;
    for (const line of vws.vwsl ?? []) {
      // vwsl semantics flip on the presence of npthrsd in the same block.
      const wall = parseLine(line, "threshold");
      if (wall) {
        if (npthrsdPresent) {
          wall.passable = true;
        }
        // else: leave `passable` absent — these are "virtual" thresholds
        // from older firmware that doesn't split the two.
        virtualWalls.push(wall);
      }
    }
    for (const line of vws.npthrsd ?? []) {
      const wall = parseLine(line, "threshold");
      if (wall) {
        wall.passable = false;
        virtualWalls.push(wall);
      }
    }
  }

  return { virtualWalls, restrictedAreas };
}

function parseLine(
  raw: unknown,
  kind: "wall" | "threshold",
): MapVirtualWall | null {
  if (!Array.isArray(raw) || raw.length < 4) {
    return null;
  }
  const x0 = parseFloatField(raw[0]);
  const y0 = parseFloatField(raw[1]);
  const x1 = parseFloatField(raw[2]);
  const y1 = parseFloatField(raw[3]);
  if (x0 === null || y0 === null || x1 === null || y1 === null) {
    return null;
  }
  // `kind` is omitted from the emitted object when it would be the
  // default ("wall"), matching the historical wire-empty case so
  // identity comparisons in existing tests don't break unnecessarily.
  if (kind === "wall") {
    return { from: { x: x0, y: y0 }, to: { x: x1, y: y1 } };
  }
  return { from: { x: x0, y: y0 }, to: { x: x1, y: y1 }, kind };
}

/**
 * Parse the saved-map's per-room wall geometry. Wire shape (verified
 * 2026-05-07 against r2532a fw 4.3.9_2199):
 *
 * ```
 * {
 *   version_flag: 3,
 *   storeys: [{
 *     rooms: [{
 *       room_id: 10,
 *       walls: [{
 *         type:      0,        // 0 = solid wall, 1 = opening (observed)
 *         beg_pt_x:  -8225,
 *         beg_pt_y:  9275,
 *         end_pt_x:  -9025,
 *         end_pt_y:  9275,
 *         normal_x:  0,        // unit-vector pointing into the room
 *         normal_y:  -1
 *       }, …]
 *     }, …]
 *   }, …]
 * }
 * ```
 *
 * Returns `null` if the wire object is missing or has no storeys —
 * the public field on `MapData` is null in that case rather than an
 * empty `MapWallsInfo`.
 */
export function parseWallsInfo(
  raw: NonNullable<MapTail["walls_info"]> | undefined,
): MapWallsInfo | null {
  if (!raw || !Array.isArray(raw.storeys) || raw.storeys.length === 0) {
    return null;
  }
  const storeys: MapStorey[] = [];
  for (const s of raw.storeys) {
    if (!s || !Array.isArray(s.rooms)) {
      continue;
    }
    const rooms: MapRoom[] = [];
    for (const r of s.rooms) {
      if (!r || typeof r.room_id !== "number" || !Array.isArray(r.walls)) {
        continue;
      }
      const walls: MapRoomWall[] = [];
      for (const w of r.walls) {
        if (
          !w ||
          typeof w.type !== "number" ||
          typeof w.beg_pt_x !== "number" ||
          typeof w.beg_pt_y !== "number" ||
          typeof w.end_pt_x !== "number" ||
          typeof w.end_pt_y !== "number" ||
          typeof w.normal_x !== "number" ||
          typeof w.normal_y !== "number"
        ) {
          continue;
        }
        walls.push({
          type: w.type,
          from: { x: w.beg_pt_x, y: w.beg_pt_y },
          to: { x: w.end_pt_x, y: w.end_pt_y },
          normal: { x: w.normal_x, y: w.normal_y },
        });
      }
      rooms.push({ roomId: r.room_id, walls });
    }
    storeys.push({ rooms });
  }
  if (storeys.length === 0) {
    return null;
  }
  return {
    versionFlag: typeof raw.version_flag === "number" ? raw.version_flag : 0,
    storeys,
  };
}

interface SneakAreaEntry {
  id?: number;
  type?: number;
  hide?: number;
  roi?: number[];
  ms?: number;
  area?: number;
}

/**
 * Parse low-clearance "sneak under furniture" zones from a tail's
 * `sneak_areas` / `sneak_areas_end` arrays. Verified live 2026-05-07
 * on r2532a fw 4.3.9_2199 (every observed entry was a 4-corner rect,
 * 8 ints in `roi`); Tasshack `dev` `map.py:4776-4809` parses
 * arbitrary even-length polygons, so we surface points as-emitted
 * without coercing to a bounding box.
 *
 * `sneak_areas_end` is preferred when both fields are present in the
 * same tail — it carries the saved `area` field. `sneak_areas` is the
 * live-fly variant.
 */
export function parseLowLyingAreas(
  end: SneakAreaEntry[] | undefined,
  live: SneakAreaEntry[] | undefined,
): MapLowLyingArea[] {
  const source = end && end.length > 0 ? end : live;
  if (!source) {
    return [];
  }
  const out: MapLowLyingArea[] = [];
  for (const entry of source) {
    if (!entry || !Array.isArray(entry.roi) || entry.roi.length < 4 || entry.roi.length % 2 !== 0) {
      continue;
    }
    const points: { x: number; y: number }[] = [];
    let badPoint = false;
    for (let i = 0; i + 1 < entry.roi.length; i += 2) {
      const x = parseFloatField(entry.roi[i]);
      const y = parseFloatField(entry.roi[i + 1]);
      if (x === null || y === null) {
        badPoint = true;
        break;
      }
      points.push({ x, y });
    }
    if (badPoint || points.length === 0) {
      continue;
    }
    const id = typeof entry.id === "number" ? entry.id : -1;
    const area: MapLowLyingArea = { id, points };
    if (typeof entry.area === "number") {
      area.area = entry.area;
    }
    out.push(area);
  }
  return out;
}

/**
 * Decode the `decmap` recursive blob into a `MapCleanedAreaOverlay`.
 *
 * `decmap` is a full inner map envelope (URL-safe base64 → zlib →
 * 27-byte header + width*height pixels + JSON tail) embedded inside
 * the parent's JSON tail. Tasshack reference: `dev` `map.py:5162-5233`.
 *
 * Inner pixel encoding uses only the low 2 bits (`& 0x03`):
 *   - `1` → cleaned
 *   - `2` → dirty
 *   - `0` (or `3`) → ignored
 *
 * Returns `null` for any decode failure — the parent decode should
 * never abort because of a malformed inner blob.
 */
export function parseCleanedAreaOverlay(decmap: string): MapCleanedAreaOverlay | null {
  if (!decmap) {
    return null;
  }
  let inflated: Buffer;
  try {
    inflated = unwrapEnvelope(decmap);
  } catch {
    return null;
  }
  if (inflated.length < HEADER_SIZE) {
    return null;
  }
  let header;
  try {
    header = parseMapHeader(inflated);
  } catch {
    return null;
  }
  const pixelStart = HEADER_SIZE;
  const pixelEnd = pixelStart + header.width * header.height;
  if (inflated.length < pixelEnd || header.width <= 0 || header.height <= 0) {
    return null;
  }
  const pixels = inflated.subarray(pixelStart, pixelEnd);
  const { cleaned, dirty } = decodeCleanedAreaPixels(pixels, header.width, header.height);

  const overlay: MapCleanedAreaOverlay = {
    dimensions: {
      left: header.left,
      top: header.top,
      width: header.width,
      height: header.height,
      gridSize: header.gridSize,
    },
    cleaned,
    dirty,
  };

  // Pull out CleanArea from the inner JSON tail when present — opaque
  // to us, useful for downstream stats.
  if (inflated.length > pixelEnd) {
    const tailText = inflated.subarray(pixelEnd).toString("utf8");
    if (tailText) {
      try {
        const innerTail = JSON.parse(tailText) as { CleanArea?: unknown };
        if (innerTail.CleanArea !== undefined) {
          overlay.cleanedSegments = innerTail.CleanArea;
        }
      } catch {
        // Inner tail malformed — keep the pixel decoding, drop the stats.
      }
    }
  }

  return overlay;
}

function decodeCleanedAreaPixels(
  pixels: Buffer,
  width: number,
  height: number,
): { cleaned: MapRun[]; dirty: MapRun[] } {
  const cleaned: MapRun[] = [];
  const dirty: MapRun[] = [];
  for (let y = 0; y < height; y++) {
    let cleanStart = -1;
    let dirtyStart = -1;
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      const v = pixels[rowOff + x]! & 0x03;
      if (v === 1) {
        if (dirtyStart >= 0) {
          dirty.push([dirtyStart, y, x - dirtyStart]);
          dirtyStart = -1;
        }
        if (cleanStart < 0) {
          cleanStart = x;
        }
      } else if (v === 2) {
        if (cleanStart >= 0) {
          cleaned.push([cleanStart, y, x - cleanStart]);
          cleanStart = -1;
        }
        if (dirtyStart < 0) {
          dirtyStart = x;
        }
      } else {
        if (cleanStart >= 0) {
          cleaned.push([cleanStart, y, x - cleanStart]);
          cleanStart = -1;
        }
        if (dirtyStart >= 0) {
          dirty.push([dirtyStart, y, x - dirtyStart]);
          dirtyStart = -1;
        }
      }
    }
    if (cleanStart >= 0) {
      cleaned.push([cleanStart, y, width - cleanStart]);
    }
    if (dirtyStart >= 0) {
      dirty.push([dirtyStart, y, width - dirtyStart]);
    }
  }
  return { cleaned, dirty };
}

function parseRestrictedArea(
  kind: "noGo" | "noMop",
  raw: unknown,
): MapRestrictedArea | null {
  if (!Array.isArray(raw) || raw.length < 4) {
    return null;
  }
  const a = parseFloatField(raw[0]);
  const b = parseFloatField(raw[1]);
  const c = parseFloatField(raw[2]);
  const d = parseFloatField(raw[3]);
  if (a === null || b === null || c === null || d === null) {
    return null;
  }
  const xMin = Math.min(a, c);
  const xMax = Math.max(a, c);
  const yMin = Math.min(b, d);
  const yMax = Math.max(b, d);
  const area: MapRestrictedArea = {
    kind,
    bbox: { xMin, yMin, xMax, yMax },
  };
  const e = raw.length > 4 ? parseFloatField(raw[4]) : null;
  if (e !== null) {
    area.angle = e;
  }
  return area;
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
