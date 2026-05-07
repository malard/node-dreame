/**
 * P-frame merging.
 *
 * The live channel emits a base I-frame (full snapshot, OSS-fetched per
 * Phase 0 finding) followed by sequential P-frames carrying byte-add
 * deltas plus updated robot/dock pose, latest obstacle list, and an
 * incremental `tr` path fragment. To keep an up-to-date renderable map,
 * each P-frame must be merged onto the running state.
 *
 * Strategy (matches Tasshack `dreame/map.py:5018-5070`):
 *   - allocate a new pixel buffer sized to the union of (prev bbox,
 *     P-frame bbox) in world-frame mm
 *   - copy prev pixels into the new buffer at the offset of prev's
 *     world-frame origin within the union
 *   - byte-add each P-frame pixel into the new buffer at its offset
 *     (`out[i] = (out[i] + p[i]) & 0xFF`, intentional 8-bit wrap)
 *   - re-stamp the result as `frame_type = I` (73). The pixel grid is
 *     now an absolute classification, not a delta — and the existing
 *     `MapDecoder` deliberately skips pixel decode on P-frames, so the
 *     merged buffer must look like an I-frame to round-trip cleanly
 *   - merge JSON tail: prefer P's keys (latest state), but APPEND P's
 *     `tr` to prev's (the path is incremental), and fall back to prev's
 *     `seg_inf` when P doesn't carry one (most P-frames don't)
 *   - advance `frame_id` to P's, keep `map_id`
 *
 * The result is a synthetic inflated frame buffer that
 * `MapDecoder.decode(buffer)` consumes normally. No envelope wrap.
 *
 * For sequence enforcement: `mergePFrame` throws `OutOfOrderFrameError`
 * when `pframe.frameId !== prev.frameId + 1`. The Phase 4 manager uses
 * this to queue or trigger a re-request.
 */

import { FRAME_TYPE, HEADER_SIZE, MapDecodeError, unwrapEnvelope } from "./envelope.js";
import { parseMapHeader } from "./header.js";
import { parseMapJsonTail, sliceTailText } from "./tail.js";
import type { MapDecodeOptions, MapTail } from "./types.js";

export class OutOfOrderFrameError extends Error {
  readonly expectedFrameId: number;
  readonly actualFrameId: number;
  constructor(expectedFrameId: number, actualFrameId: number) {
    super(`map: out-of-order P-frame (expected frame_id=${expectedFrameId}, got ${actualFrameId})`);
    this.name = "OutOfOrderFrameError";
    this.expectedFrameId = expectedFrameId;
    this.actualFrameId = actualFrameId;
  }
}

/**
 * Merge a P-frame onto the previous (I-frame or already-merged) inflated
 * frame buffer. Returns a new inflated buffer re-stamped as `frame_type=I`.
 *
 * Both inputs must already be unwrapped (`unwrapEnvelope` applied). For
 * envelope-string inputs use `mergePFrameEnvelope` or `MapDecoder.applyPFrame`.
 */
export function mergePFrame(prevInflated: Buffer, pFrameInflated: Buffer): Buffer {
  const prevHeader = parseMapHeader(prevInflated);
  const pHeader = parseMapHeader(pFrameInflated);

  if (pHeader.frameType !== "P") {
    throw new MapDecodeError(`mergePFrame: expected P-frame, got frame_type=${pHeader.frameType}`);
  }
  if (pHeader.mapId !== prevHeader.mapId) {
    throw new MapDecodeError(
      `mergePFrame: map_id mismatch (prev=${prevHeader.mapId}, P=${pHeader.mapId}) — request a fresh I-frame`,
    );
  }
  if (pHeader.frameId !== prevHeader.frameId + 1) {
    throw new OutOfOrderFrameError(prevHeader.frameId + 1, pHeader.frameId);
  }
  if (prevHeader.gridSize !== pHeader.gridSize && pHeader.width > 0 && pHeader.height > 0) {
    throw new MapDecodeError(
      `mergePFrame: grid_size changed mid-stream (${prevHeader.gridSize} → ${pHeader.gridSize})`,
    );
  }

  const prevTail = parseMapJsonTail(sliceTailText(prevInflated, prevHeader));
  const pTail = parseMapJsonTail(sliceTailText(pFrameInflated, pHeader));

  // ── compute union bbox ──────────────────────────────────────────────
  // tail.origin and header.left/top agree on r2532a fsm:1 captures —
  // prefer the tail value when present, fall back to the header.
  const prevLeft = prevTail.origin?.[0] ?? prevHeader.left;
  const prevTop = prevTail.origin?.[1] ?? prevHeader.top;
  const grid = prevHeader.gridSize;
  const prevRight = prevLeft + prevHeader.width * grid;
  const prevBottom = prevTop + prevHeader.height * grid;

  // P-frames with width=0,height=0 represent "no spatial change" — robot
  // moved or obstacle list updated, but no pixel deltas. Skip the bbox
  // union and the byte-add loop in that case.
  const hasPixelDelta = pHeader.width > 0 && pHeader.height > 0;
  let unionLeft = prevLeft;
  let unionTop = prevTop;
  let unionWidth = prevHeader.width;
  let unionHeight = prevHeader.height;
  let pLeft = 0;
  let pTop = 0;

  if (hasPixelDelta) {
    pLeft = pTail.origin?.[0] ?? pHeader.left;
    pTop = pTail.origin?.[1] ?? pHeader.top;
    const pRight = pLeft + pHeader.width * grid;
    const pBottom = pTop + pHeader.height * grid;

    if ((pLeft - prevLeft) % grid !== 0 || (pTop - prevTop) % grid !== 0) {
      throw new MapDecodeError(
        `mergePFrame: P-frame origin not aligned to prev grid (offset=${pLeft - prevLeft},${pTop - prevTop} vs grid=${grid})`,
      );
    }

    unionLeft = Math.min(prevLeft, pLeft);
    unionTop = Math.min(prevTop, pTop);
    const unionRight = Math.max(prevRight, pRight);
    const unionBottom = Math.max(prevBottom, pBottom);
    unionWidth = (unionRight - unionLeft) / grid;
    unionHeight = (unionBottom - unionTop) / grid;
  }

  // ── allocate new pixel grid + copy prev pixels in ───────────────────
  const newPixels = Buffer.alloc(unionWidth * unionHeight);
  const prevPixelEnd = HEADER_SIZE + prevHeader.width * prevHeader.height;
  if (prevInflated.length < prevPixelEnd) {
    throw new MapDecodeError(
      `mergePFrame: prev buffer truncated (need ${prevPixelEnd} bytes for header+pixels, got ${prevInflated.length})`,
    );
  }
  const prevPixels = prevInflated.subarray(HEADER_SIZE, prevPixelEnd);
  const prevDxPx = (prevLeft - unionLeft) / grid;
  const prevDyPx = (prevTop - unionTop) / grid;
  for (let y = 0; y < prevHeader.height; y++) {
    const srcOff = y * prevHeader.width;
    const dstOff = (prevDyPx + y) * unionWidth + prevDxPx;
    prevPixels.copy(newPixels, dstOff, srcOff, srcOff + prevHeader.width);
  }

  // ── byte-add P pixels at their offset ───────────────────────────────
  if (hasPixelDelta) {
    const pPixelEnd = HEADER_SIZE + pHeader.width * pHeader.height;
    if (pFrameInflated.length < pPixelEnd) {
      throw new MapDecodeError(
        `mergePFrame: P buffer truncated (need ${pPixelEnd} bytes for header+pixels, got ${pFrameInflated.length})`,
      );
    }
    const pPixels = pFrameInflated.subarray(HEADER_SIZE, pPixelEnd);
    const pDxPx = (pLeft - unionLeft) / grid;
    const pDyPx = (pTop - unionTop) / grid;
    for (let y = 0; y < pHeader.height; y++) {
      const dstRow = (pDyPx + y) * unionWidth + pDxPx;
      const srcRow = y * pHeader.width;
      for (let x = 0; x < pHeader.width; x++) {
        newPixels[dstRow + x] = (newPixels[dstRow + x]! + pPixels[srcRow + x]!) & 0xff;
      }
    }
  }

  // ── build new header (re-stamped as I-frame, union bbox) ────────────
  const newHeader = Buffer.alloc(HEADER_SIZE);
  newHeader.writeInt16LE(prevHeader.mapId, 0);
  newHeader.writeInt16LE(pHeader.frameId, 2);
  newHeader[4] = FRAME_TYPE.I;
  newHeader.writeInt16LE(pHeader.robotX, 5);
  newHeader.writeInt16LE(pHeader.robotY, 7);
  newHeader.writeInt16LE(pHeader.robotA, 9);
  newHeader.writeInt16LE(pHeader.chargerX, 11);
  newHeader.writeInt16LE(pHeader.chargerY, 13);
  newHeader.writeInt16LE(pHeader.chargerA, 15);
  newHeader.writeInt16LE(grid, 17);
  newHeader.writeInt16LE(unionWidth, 19);
  newHeader.writeInt16LE(unionHeight, 21);
  newHeader.writeInt16LE(unionLeft, 23);
  newHeader.writeInt16LE(unionTop, 25);

  // ── merge JSON tail ─────────────────────────────────────────────────
  const mergedTail = mergeTails(prevTail, pTail, unionLeft, unionTop);
  const tailBytes = Buffer.from(JSON.stringify(mergedTail), "utf8");

  return Buffer.concat([newHeader, newPixels, tailBytes]);
}

/**
 * Convenience wrapper: accept envelope strings (or raw buffers) for both
 * inputs and return the merged inflated buffer.
 */
export function mergePFrameEnvelope(
  prev: Buffer | string,
  pframe: Buffer | string,
  prevOpts?: MapDecodeOptions,
  pframeOpts?: MapDecodeOptions,
): Buffer {
  const prevBuf = typeof prev === "string" ? unwrapEnvelope(prev, prevOpts) : prev;
  const pBuf = typeof pframe === "string" ? unwrapEnvelope(pframe, pframeOpts) : pframe;
  return mergePFrame(prevBuf, pBuf);
}

/**
 * Construct the merged JSON tail. P-frame's tail is taken as the base
 * (it carries the latest robot/dock/obstacle/etc. state); a few keys
 * need explicit treatment:
 *
 *   - `origin` is overwritten with the union origin
 *   - `tr` (cleaning path) is concatenated: `prev.tr + p.tr`. P-frame
 *     uses lowercase `l` for line continuation; `parsePathTr` already
 *     normalises that, so plain concatenation is correct
 *   - `seg_inf` falls back to prev's when P doesn't supply one (typical;
 *     P-frames re-send seg_inf only on segment metadata changes)
 *   - `sa` (active segments) similarly falls back to prev's when absent
 */
function mergeTails(
  prev: MapTail,
  p: MapTail,
  unionLeft: number,
  unionTop: number,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...p };
  merged.origin = [unionLeft, unionTop];

  const prevTr = typeof prev.tr === "string" ? prev.tr : "";
  const pTr = typeof p.tr === "string" ? p.tr : "";
  if (prevTr || pTr) {
    merged.tr = prevTr + pTr;
  } else {
    delete merged.tr;
  }

  if (!("seg_inf" in p) && "seg_inf" in prev) {
    merged.seg_inf = prev.seg_inf;
  }
  if (!("sa" in p) && "sa" in prev) {
    merged.sa = prev.sa;
  }
  // User-defined geometry + persistent overlay blocks are
  // configuration, not live state — most P-frames don't re-send any
  // of them. Fall back to prev when absent so the running state
  // retains user-defined geometry / cleaned-area / saved-map across
  // the chain. To wire a new persistent tail key (e.g. `vw.cliff`
  // when we get a fixture), add it here and to `MapTail` in types.
  for (const key of PERSISTENT_TAIL_KEYS) {
    if (!(key in p) && key in prev) {
      merged[key] = prev[key];
    }
  }
  return merged;
}

/**
 * Tail-JSON keys that represent persistent floor-plan / saved-map /
 * cleaning-progress configuration — re-emitted by the device only on
 * full snapshots, not every P-frame. `mergeTails` falls these back
 * from prev when the P-frame's tail doesn't carry them, so the
 * running merged state keeps the user's geometry between full
 * snapshots.
 */
export const PERSISTENT_TAIL_KEYS = [
  "vw",
  "vws",
  "sneak_areas",
  "sneak_areas_end",
  "walls_info",
  "rism",
  "decmap",
] as const;

