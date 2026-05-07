/**
 * Pixel-grid decoder for fsm:1 (path B / frame-map mode) — the layout
 * r2532a uses. Walks the grid row-by-row and emits run-length
 * `MapLayer` entries the renderer can blit straight onto canvas
 * without tracking individual pixels.
 *
 * The fsm:0 (variant A) layout is documented in the roadmap but isn't
 * exercised by any captured fixture; not implemented.
 */

import type {
  MapDimensions,
  MapLayer,
  MapRun,
  MapSegment,
  MapTail,
} from "./types.js";

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

/**
 * Project decoded pixel-grid layers into per-segment metadata: bbox
 * and centroid in mm world-frame, plus the optional `seg_inf.<id>`
 * fields (name, neighbours, material, direction). `tail.sa` flags
 * which segments are in the device's current cleaning set.
 */
export function collectSegments(
  layers: MapLayer[],
  dim: MapDimensions,
  tail: MapTail,
): MapSegment[] {
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
