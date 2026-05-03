/**
 * Saved-map list decoder.
 *
 * Wraps Tasshack's `dev` `map.py:1078-1115` shape:
 *   `{ mapstr: [{ map, name, angle }, ...], curr_id }`
 *
 * Decoded result is a `MapSavedList` re-exported from `node-dreame/map`.
 */

import { MapDecoder } from "../map/decoder.js";
import type { MapSaved, MapSavedList } from "../map/types.js";

interface SavedMapEntry {
  map?: string;
  name?: string;
  angle?: number | string;
}

interface SavedMapWrapper {
  mapstr?: SavedMapEntry[];
  curr_id?: number | string;
}

/**
 * Decode the OSS-fetched saved-map list blob into a `MapSavedList`.
 *
 * Returns `null` if the body isn't valid JSON or doesn't have the
 * expected shape — caller can then fall back to whatever recovery
 * strategy fits (re-fetch, treat the whole blob as a single map, etc.).
 */
export function decodeSavedMapList(bytes: Buffer): MapSavedList | null {
  let parsed: SavedMapWrapper;
  try {
    parsed = JSON.parse(bytes.toString("utf8")) as SavedMapWrapper;
  } catch {
    return null;
  }
  if (!parsed.mapstr || !Array.isArray(parsed.mapstr)) {
    return null;
  }
  const maps: MapSaved[] = [];
  for (const entry of parsed.mapstr) {
    if (!entry || typeof entry.map !== "string" || !entry.map) {
      continue;
    }
    let data;
    try {
      data = MapDecoder.decode(entry.map);
    } catch {
      continue;
    }
    const angle =
      typeof entry.angle === "number"
        ? entry.angle
        : typeof entry.angle === "string"
          ? Number(entry.angle) || 0
          : 0;
    maps.push({
      mapId: data.mapId,
      name: typeof entry.name === "string" ? entry.name : null,
      angle,
      data,
    });
  }
  if (maps.length === 0) {
    return null;
  }
  const currId =
    typeof parsed.curr_id === "number"
      ? parsed.curr_id
      : typeof parsed.curr_id === "string"
        ? Number(parsed.curr_id)
        : NaN;
  const activeMapId = Number.isFinite(currId) ? currId : maps[0]!.mapId;
  return { activeMapId, maps };
}
