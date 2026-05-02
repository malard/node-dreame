/**
 * Public types for the live-map decoder.
 *
 * All coordinates are millimetres in the device's world frame, exactly as
 * Dreame's binary encodes them — no Y-flip, no centimetre rescale, no
 * origin shift. The browser renderer is expected to apply whichever
 * transform fits its rendering library. This is a deliberate departure
 * from the Valetudo schema; see `docs/live-map-roadmap.md` for the
 * rationale.
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
  runs: MapRun[];
}

export interface MapSegment {
  /** Segment id from the pixel grid (1..63). */
  id: number;
  /** Decoded from `seg_inf.<id>.name` (base64). */
  name: string | null;
  /** mm, world-frame, derived from the pixel scan. */
  bbox: MapBoundingBox;
  /** mm, world-frame — useful as a label-anchor point. */
  centroid: MapPoint;
  /** Adjacent segment ids from `seg_inf.<id>.nei_id`. */
  neighbours: number[];
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
  points: MapPoint[];
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
 * The decoded map. v1 surface area: walls + segments + robot pose + dock
 * + cleaning path + obstacles. v2 (no-go zones, virtual walls, multi-floor,
 * cleaned-area overlay) lives outside this interface and will extend it.
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
  layers: MapLayer[];

  // ── Segments (rooms) ─────────────────────────────────────────────
  segments: MapSegment[];

  // ── Cleaning path, broken into runs by op type ───────────────────
  paths: MapPath[];

  // ── AI-detected obstacles ────────────────────────────────────────
  obstacles: MapObstacle[];
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
