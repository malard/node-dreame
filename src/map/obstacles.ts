/**
 * AI-detected obstacles parser. Wire format: the JSON tail's
 * `ai_obstacle` field is an array of positional records (~14 fields
 * each on r2532a). Field layout per `docs/live-map-format.md`.
 */

import type { MapObstacle } from "./types.js";
import { parseFloatField, parseIntField } from "./field-utils.js";

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
