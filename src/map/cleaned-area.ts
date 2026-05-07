/**
 * Cleaned-area overlay decoder for the JSON tail's `decmap` field.
 *
 * `decmap` is a recursive map envelope embedded as a base64 string —
 * the same outer-envelope shape as the parent (URL-safe base64 →
 * zlib → 27-byte header + pixel grid + UTF-8 JSON tail) but with a
 * different per-pixel encoding. Inner pixel encoding uses only the
 * low 2 bits (`& 0x03`): `1` → cleaned, `2` → dirty, others ignored.
 *
 * Tasshack reference: `dev` `map.py:5162-5233`.
 */

import { HEADER_SIZE, unwrapEnvelope } from "./envelope.js";
import { parseMapHeader } from "./header.js";
import type { MapCleanedAreaOverlay, MapRun } from "./types.js";

/**
 * Decode the `decmap` recursive blob into a `MapCleanedAreaOverlay`.
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
