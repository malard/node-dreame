/**
 * JSON tail extraction from an inflated map frame buffer.
 *
 * The tail is UTF-8 JSON immediately after the header + pixel grid;
 * `MapTail` (`./types.ts`) describes the subset of keys we consume.
 *
 * `parseFrame` is the composed seam used by both `MapDecoder.decode`
 * and the rism-recurse path inside it — keeping the
 * "header → tail" sequence in one place ensures the two call sites
 * can't drift independently.
 */

import { HEADER_SIZE, MapDecodeError } from "./envelope.js";
import { parseMapHeader, type MapHeader } from "./header.js";
import type { MapTail } from "./types.js";

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
 * which the decoder, the rism-recurse path, and (deliberately not)
 * `merge.ts` invoke as a unit. Centralising the sequence keeps the
 * call sites in lockstep — the alternative is to drift independently
 * if one is updated without the others.
 *
 * Pure; doesn't unwrap base64 — call `unwrapEnvelope` first.
 */
export function parseFrame(inflated: Buffer): { header: MapHeader; tail: MapTail } {
  const header = parseMapHeader(inflated);
  const tail = parseMapJsonTail(sliceTailText(inflated, header));
  return { header, tail };
}
