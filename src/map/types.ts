/**
 * Public types for the live-map decoder.
 *
 * All coordinates are millimetres in the device's world frame, exactly as
 * Dreame's binary encodes them — no Y-flip, no centimetre rescale, no
 * origin shift. The consumer is expected to apply whichever transform
 * fits its rendering library. This is a deliberate departure from the
 * Valetudo schema; see `docs/live-map-format.md` for the rationale.
 */

/** Frame type byte from the 27-byte map header. */
export type MapFrameType = "I" | "P" | "W";

/** Cleaning-path op classes — the four `tr` regex ops collapsed into named runs. */
export type MapPathType = "mop" | "sweep" | "sweep-and-mop" | "line";

/**
 * Pixel-grid layer kind. `wall`, `floor`, and `segment` are mutually
 * exclusive primary classifications — one per pixel. `carpet` is an
 * independent overlay (low-bits=11 in fsm:1 path B): a carpet pixel
 * also has a primary classification, and the renderer paints the carpet
 * texture on top of whatever colour the underlying layer chose.
 */
export type MapLayerType = "wall" | "floor" | "segment" | "carpet";

export interface MapPose {
  /** mm, world-frame. */
  x: number;
  /** mm, world-frame. */
  y: number;
  /** Degrees. Raw — the renderer applies `MapData.rotation` if it cares. */
  angle: number;
}

export interface MapDimensions {
  /** mm, world-x of pixel column 0. */
  left: number;
  /** mm, world-y of pixel row 0. */
  top: number;
  /** Pixels. */
  width: number;
  /** Pixels. */
  height: number;
  /** mm per pixel. */
  gridSize: number;
}

export interface MapBoundingBox {
  /** mm. */
  xMin: number;
  /** mm. */
  yMin: number;
  /** mm. */
  xMax: number;
  /** mm. */
  yMax: number;
}

export interface MapPoint {
  /** mm. */
  x: number;
  /** mm. */
  y: number;
}

/**
 * One run of consecutive same-class pixels on a single row, encoded as
 * `[xPixel, yPixel, length]` in pixel-space (multiply by `gridSize` and
 * add `left`/`top` to project to mm world-frame).
 */
export type MapRun = [number, number, number];

export interface MapLayer {
  type: MapLayerType;
  /** Set when `type === "segment"`. Range 1..63. */
  segmentId?: number;
  readonly runs: readonly MapRun[];
}

export interface MapSegment {
  /** Segment id from the pixel grid (1..63). */
  id: number;
  /**
   * User-given room name. Already decoded from the wire format's
   * base64 — use as-is, do NOT double-decode.
   *
   * `null` when `seg_inf.<id>.name` was missing entirely. Empty-string
   * (`""`) when the user has not named the room — observed live on
   * r2532a 2026-05-07 when no rooms were named in the Dreamehome app.
   * Renderers that fall back via `s.name || \`Room ${s.id}\`` work
   * correctly for both because both are falsy in JS, but a
   * strict-null-only check (`s.name === null ? … : s.name`) would
   * render visible empty labels.
   */
  name: string | null;
  /** mm, world-frame, derived from the pixel scan. */
  bbox: MapBoundingBox;
  /** mm, world-frame — useful as a label-anchor point. */
  centroid: MapPoint;
  /** Adjacent segment ids from `seg_inf.<id>.nei_id`. */
  readonly neighbours: readonly number[];
  /** Floor material code from `seg_inf.<id>.material`. */
  floorMaterial: number | null;
  /** Floor direction code from `seg_inf.<id>.direction`. */
  floorDirection: number | null;
  /** Whether this segment is in the current cleaning set (`sa`). */
  active: boolean;
}

export interface MapPath {
  type: MapPathType;
  /** mm, world-frame. */
  readonly points: readonly MapPoint[];
}

export interface MapObstacle {
  /** Per-obstacle id from `ai_obstacle`. */
  id: number;
  /** mm, world-frame. */
  x: number;
  /** mm, world-frame. */
  y: number;
  /**
   * `ObstacleType` enum value — carried through unchanged. The browser
   * decodes the integer to a label; node-dreame doesn't ship the lookup
   * table because Dreame revises it per firmware.
   */
  type: number;
  /** 0..100 — Dreame's own confidence percentage. */
  confidence: number;
  /** When the device captured a photo of the obstacle, the OSS file name. */
  photoFileName: string | null;
  /** AES key for photo decryption — separate from the map blob's key. */
  photoKey: string | null;
}

/**
 * One user-defined wall-shaped piece of geometry — a line segment in
 * mm world-frame. Includes both classic virtual walls (`vw.line`) and
 * the X50's threshold variants (`vws.vwsl` / `vws.npthrsd`); the
 * `kind` and `passable` fields discriminate.
 *
 * `kind` defaults to `"wall"` when absent — older callers that
 * pre-date the threshold split don't have to update.
 *
 * Threshold semantics (Tasshack `dev` `map.py:4678-4691`):
 *   - `kind: "threshold", passable: true`   — passable threshold (X50 firmware
 *     where the user has separately configured the impassable set)
 *   - `kind: "threshold", passable: false`  — impassable threshold
 *   - `kind: "threshold"` (no passable)     — "virtual" threshold from
 *     older firmware that doesn't split passable/impassable
 *   - `kind: "wall"` (or absent)            — classic virtual wall (`vw.line`)
 */
export interface MapVirtualWall {
  from: MapPoint;
  to: MapPoint;
  /** Defaults to `"wall"` when absent. */
  kind?: "wall" | "threshold";
  /** Only meaningful when `kind === "threshold"`. */
  passable?: boolean;
}

/**
 * One axis-aligned restricted area — either a no-go zone (`vw.rect`,
 * `kind: "noGo"`) or a no-mop zone (`vw.mop`, `kind: "noMop"`).
 *
 * The wire format carries only two opposing corners; this struct
 * normalises them into a `MapBoundingBox`. The optional `angle`
 * mirrors a fifth element Dreame sometimes appends (rotation hint —
 * the rectangle itself remains axis-aligned in the wire format).
 */
export interface MapRestrictedArea {
  kind: "noGo" | "noMop";
  bbox: MapBoundingBox;
  /** Optional rotation hint from the wire format — degrees, may be undefined. */
  angle?: number;
}

/**
 * One wall segment from the per-room wall geometry — present on
 * saved maps as `walls_info.storeys[*].rooms[*].walls[*]`.
 *
 * `type` discriminates the wall variant; observed values on r2532a:
 *   `0` — solid wall
 *   `1` — opening / doorway
 * Surfaced as-emitted; consumers can ignore or render selectively.
 *
 * `normal` is the unit-vector pointing into the room's interior on
 * the wire (each component typically `-1`, `0`, or `1`).
 */
export interface MapRoomWall {
  type: number;
  from: MapPoint;
  to: MapPoint;
  normal: MapPoint;
}

/**
 * One room's wall list inside `walls_info.storeys[*].rooms[*]`.
 * `roomId` matches a segment id from the pixel grid where present
 * (some captures show roomIds outside the 1..63 segment range, so do
 * NOT assume a 1:1 mapping at the consumer layer).
 */
export interface MapRoom {
  roomId: number;
  walls: readonly MapRoomWall[];
}

/**
 * One floor's worth of rooms inside `walls_info.storeys[*]`.
 * Single-floor homes have exactly one storey; multi-floor would have
 * one entry per floor. `MapData.wallsInfo` carries only the storey
 * matching the current `mapId`.
 */
export interface MapStorey {
  rooms: readonly MapRoom[];
}

/**
 * Per-room wall geometry from the saved-map blob's `walls_info`
 * field. Big and only present on saved maps (not live I-frames).
 *
 * `versionFlag` is the wire's `version_flag` int — surfaced
 * unchanged in case the schema evolves.
 */
export interface MapWallsInfo {
  versionFlag: number;
  storeys: readonly MapStorey[];
}

/**
 * One user-defined low-clearance "sneak under furniture" zone — the
 * X50 retracts its tower while passing through. Surfaced from the
 * tail's `sneak_areas` / `sneak_areas_end` field (Tasshack `dev`
 * `map.py:4776-4809`).
 *
 * The wire format is a polygon: `roi` is an even-length list of
 * alternating `x0, y0, x1, y1, …` ints in mm world-frame. On
 * r2532a 2026-05-07 every observed entry was a 4-corner rect (8
 * ints) — but the Tasshack reference parses arbitrary even lengths,
 * so we surface the points as-emitted rather than coercing to a
 * bounding box.
 */
export interface MapLowLyingArea {
  /** Stable id from the wire format (for cross-frame correlation). */
  id: number;
  /** Polygon vertices in mm, world-frame. */
  points: readonly MapPoint[];
  /** Floor area in m² — present when the device emitted `sneak_areas_end`. */
  area?: number;
}

/**
 * One saved map (floor) as returned by `Vacuum.fetchSavedMapList()`.
 *
 * `data` is the fully-decoded `MapData` for the saved map's binary
 * blob — same shape as live frames, but with `frameType: "I"` since
 * saved maps are always full snapshots.
 */
export interface MapSaved {
  mapId: number;
  /** Custom user-given name (from the wrapper JSON), if any. */
  name: string | null;
  /** Rotation in degrees (from the wrapper JSON's `angle` field). */
  angle: number;
  /** Decoded map content. */
  data: MapData;
}

/**
 * Result of `Vacuum.fetchSavedMapList()` — all stored maps for the
 * device plus a pointer to the currently-active one.
 *
 * On a single-floor home the list will have exactly one entry whose
 * `mapId` matches `activeMapId`.
 */
export interface MapSavedList {
  /** `mapId` of the currently-active floor (the one the robot is on). */
  activeMapId: number;
  /** All stored maps. Order matches the wire wrapper. */
  maps: MapSaved[];
}

/**
 * Cleaned-area overlay decoded from the JSON tail's `decmap` field.
 *
 * `decmap` is a recursive blob — a full inner map envelope (header +
 * zlib + JSON tail) embedded as a base64 string in the parent tail.
 * Its pixel grid uses only the low 2 bits (`& 0x03`): `1 = cleaned`,
 * `2 = dirty`. The inner grid has its own dimensions, independent of
 * the parent map; the renderer reprojects onto the parent's pixel
 * grid using the dimensions below.
 *
 * Both `cleaned` and `dirty` are run-length encoded the same way as
 * `MapLayer.runs` — `[xPixel, yPixel, length]` in the inner grid's
 * pixel-space.
 *
 * `cleanedSegments` carries the inner tail's `CleanArea` field when
 * present (per-segment cleaned-area stats). Shape varies per firmware
 * so it's surfaced as opaque.
 */
export interface MapCleanedAreaOverlay {
  /** Inner blob's own dimensions — independent of the parent map's. */
  dimensions: MapDimensions;
  /** Pixels marked `cleaned` (low-bits == 1) in the inner grid. */
  readonly cleaned: readonly MapRun[];
  /** Pixels marked `dirty` (low-bits == 2) in the inner grid. */
  readonly dirty: readonly MapRun[];
  /** Optional per-segment cleaned-area stats from the inner JSON tail. */
  cleanedSegments?: unknown;
}

/**
 * The decoded map. Coordinates throughout are mm in the device's world
 * frame. The renderer transforms once when projecting onto its own
 * canvas — see `dimensions` for the parent grid origin / scale.
 */
export interface MapData {
  // ── Identity ──────────────────────────────────────────────────────
  mapId: number;
  frameId: number;
  frameType: MapFrameType;
  /** ms since epoch, from JSON tail's `timestamp_ms`. */
  timestamp: number;
  /** Degrees from JSON tail's `mra` — applied by the renderer if it rotates. */
  rotation: number;

  // ── World transform — every coordinate below is mm, world-frame ───
  dimensions: MapDimensions;

  // ── Robot/dock state ─────────────────────────────────────────────
  robot: MapPose | null;
  dock: MapPose | null;
  docked: boolean;

  // ── Spatial layers (run-length encoded over the pixel grid) ──────
  readonly layers: readonly MapLayer[];

  // ── Segments (rooms) ─────────────────────────────────────────────
  readonly segments: readonly MapSegment[];

  // ── Cleaning path, broken into runs by op type ───────────────────
  readonly paths: readonly MapPath[];

  // ── AI-detected obstacles ────────────────────────────────────────
  readonly obstacles: readonly MapObstacle[];

  // ── User-defined geometry (from JSON tail's `vw` / `vws`) ────────
  /**
   * Line-segment walls and threshold variants. Empty array when none
   * configured. Each entry's `kind` (defaults to `"wall"` when absent)
   * and `passable` discriminate classic virtual walls (`vw.line`)
   * from passable / impassable / virtual thresholds (`vws.vwsl` /
   * `vws.npthrsd`). See `MapVirtualWall`.
   */
  readonly virtualWalls: readonly MapVirtualWall[];
  /**
   * Axis-aligned restricted areas — both no-go (`vw.rect`, `vw.nocpt`)
   * and no-mop (`vw.mop`).
   */
  readonly restrictedAreas: readonly MapRestrictedArea[];
  /**
   * Low-clearance "sneak under furniture" zones from `sneak_areas` /
   * `sneak_areas_end`. Empty array when none configured.
   */
  readonly lowLyingAreas: readonly MapLowLyingArea[];
  /**
   * Per-room wall geometry from the saved-map blob's `walls_info`.
   * `null` on live I-frames that don't carry the field — only
   * populated when the parent frame has a saved-map blob to mine
   * from (or is itself the saved-map blob).
   */
  readonly wallsInfo: MapWallsInfo | null;

  // ── Cleaned-area overlay (from JSON tail's `decmap`) ─────────────
  /**
   * Cleaning progress map embedded in the parent frame, decoded from
   * the recursive `decmap` blob. `null` when the parent didn't carry
   * one (typical for live-stream frames; the device emits `decmap`
   * mainly on full-snapshot pushes).
   */
  cleanedArea: MapCleanedAreaOverlay | null;
}

/**
 * Optional decode hints. The AES key is per-blob (it arrives appended to
 * the OSS object name with a comma, or via the OLD_MAP_DATA multiplexed
 * format); the IV is per-model (lives in Tasshack's `device_info` table)
 * and must be supplied here since node-dreame doesn't ship a per-model
 * IV lookup.
 */
export interface MapDecodeOptions {
  /** AES-256-CBC key — 32 ASCII hex chars from `sha256(<rawKey>)[0:32]`. */
  key?: string;
  /** AES-256-CBC IV — 16 ASCII bytes, model-specific. */
  iv?: string;
}
