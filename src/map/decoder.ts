/**
 * Public entry-point for decoding a single map-frame envelope into a
 * `MapData`. Composes the per-concern modules:
 *
 *   - `envelope.ts`      — base64 / AES / zlib unwrap
 *   - `header.ts`        — 27-byte binary header
 *   - `tail.ts`          — UTF-8 JSON tail (+ `parseFrame` seam)
 *   - `pixel-grid.ts`    — fsm:1 pixel decode + segment collect
 *   - `path.ts`          — `tr` cleaning-path string parser
 *   - `obstacles.ts`     — AI-detected obstacle records
 *   - `geometry.ts`      — `vw` / `vws` / `walls_info` / sneak-zones
 *   - `cleaned-area.ts`  — recursive `decmap` overlay
 *
 * Public surface: the `MapDecoder` class plus a `MapDecodeError` and
 * the small wire-format constants. Per-concern parsers are also
 * re-exported via `src/map/index.ts` for callers that want to feed
 * raw bytes through specific stages.
 */

import type {
  MapData,
  MapDecodeOptions,
  MapDimensions,
  MapPose,
  MapTail,
} from "./types.js";
import {
  ANGLE_ABSENT,
  HEADER_SIZE,
  MapDecodeError,
  unwrapEnvelope,
} from "./envelope.js";
import type { MapHeader } from "./header.js";
import { parseFrame } from "./tail.js";
import { collectSegments, decodePixelGridFsm1 } from "./pixel-grid.js";
import { parsePathTr } from "./path.js";
import { parseObstacles } from "./obstacles.js";
import {
  parseLowLyingAreas,
  parseVirtualWalls,
  parseWallsInfo,
} from "./geometry.js";
import { parseCleanedAreaOverlay } from "./cleaned-area.js";
import { mergePFrame, mergePFrameEnvelope } from "./merge.js";

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
