/**
 * User-defined map geometry — the `vw`, `vws`, `walls_info`,
 * `sneak_areas` / `sneak_areas_end` blocks of the JSON tail.
 *
 * On r2532a fw 4.3.9_2199 (verified 2026-05-07) the live I-frame's
 * top-level tail does NOT carry these blocks; they live inside the
 * embedded saved-map blob (`tail.rism`). `MapDecoder.decode` recurses
 * into rism and merges the inner geometry onto the outer `MapData`,
 * so consumers see "all geometry for this floor" regardless of which
 * tail physically carried it.
 */

import type {
  MapLowLyingArea,
  MapRestrictedArea,
  MapRoom,
  MapRoomWall,
  MapStorey,
  MapTail,
  MapVirtualWall,
  MapWallsInfo,
} from "./types.js";
import { parseFloatField } from "./field-utils.js";

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
 * Aggregate of every geometry-bearing field surfaced from the tail.
 * `MapDecoder.decode` parses one of these per tail and the rism-
 * recurse path uses `coalesceGeometry` to fill in fields the outer
 * tail left empty.
 */
export interface MapGeometry {
  virtualWalls: MapVirtualWall[];
  restrictedAreas: MapRestrictedArea[];
  lowLyingAreas: MapLowLyingArea[];
  wallsInfo: MapWallsInfo | null;
}

/**
 * Decode every geometry-bearing field from a tail in one shot.
 *
 * Adding a new geometry block (e.g. `vw.cliff` once we get a fixture)
 * is a one-line edit here — `MapDecoder.decode` and the rism-recurse
 * path automatically pick up the new field via `coalesceGeometry`.
 */
export function parseTailGeometry(tail: MapTail): MapGeometry {
  const { virtualWalls, restrictedAreas } = parseVirtualWalls(tail.vw, tail.vws);
  return {
    virtualWalls,
    restrictedAreas,
    lowLyingAreas: parseLowLyingAreas(tail.sneak_areas_end, tail.sneak_areas),
    wallsInfo: parseWallsInfo(tail.walls_info),
  };
}

/**
 * `true` when every geometry field has at least one entry. Used by
 * the rism-recurse path to skip the inner decode when the outer tail
 * already supplied everything.
 */
export function isGeometryComplete(g: MapGeometry): boolean {
  return (
    g.virtualWalls.length > 0 &&
    g.restrictedAreas.length > 0 &&
    g.lowLyingAreas.length > 0 &&
    g.wallsInfo !== null
  );
}

/**
 * Merge two `MapGeometry` snapshots. `primary` wins on every field
 * that's non-empty there; `fallback` fills the rest. Used by the
 * rism-recurse path: outer tail's geometry as primary, inner saved-
 * map blob's geometry as fallback.
 */
export function coalesceGeometry(
  primary: MapGeometry,
  fallback: MapGeometry,
): MapGeometry {
  return {
    virtualWalls:
      primary.virtualWalls.length > 0 ? primary.virtualWalls : fallback.virtualWalls,
    restrictedAreas:
      primary.restrictedAreas.length > 0
        ? primary.restrictedAreas
        : fallback.restrictedAreas,
    lowLyingAreas:
      primary.lowLyingAreas.length > 0 ? primary.lowLyingAreas : fallback.lowLyingAreas,
    wallsInfo: primary.wallsInfo !== null ? primary.wallsInfo : fallback.wallsInfo,
  };
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
