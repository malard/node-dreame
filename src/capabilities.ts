/**
 * Per-model device capability records.
 *
 * Lets a consumer (e.g. a web UI) ask "does this device have a mop?"
 * or "which suction levels does it accept?" without shipping its own
 * copy of the spec table. The capability record is derived from the
 * model identifier (e.g. `"dreame.vacuum.r2532a"`) — the curated
 * `MODEL_CAPABILITIES` table holds verified entries, and unknown
 * models fall back to a conservative safe-default.
 *
 * Add a new model by appending to `MODEL_CAPABILITIES` with `verified:
 * true` after confirming each flag against real hardware. Update the
 * `verified` flag if any field is best-guess rather than observed.
 */
import {
  AutoEmptyFrequency,
  CarpetHandlingMode,
  MopDryMode,
  MopWashTemp,
  MopWashWaterLevel,
  ObstacleCrossingMode,
  SuctionLevel,
  WaterVolume,
} from "./miot-spec.js";

/**
 * Snapshot of what a Dreame model can do — used by consumers to
 * conditionally render controls and validate inputs.
 *
 * Field naming:
 *   - `canX` — discrete capability (the device can perform action X)
 *   - `hasX` — physical hardware presence
 *   - `supportsX` — feature category (multi-floor, virtual walls, etc.)
 *   - `supportedXs` — enum subset this model accepts for setting X
 *
 * All array fields are `readonly` to discourage mutation of shared
 * table entries.
 */
export interface DeviceCapabilities {
  /** Model identifier (e.g. `"dreame.vacuum.r2532a"`). */
  model: string;

  /**
   * `true` when the record came from the curated per-model table;
   * `false` when synthesised from `FALLBACK_CAPABILITIES` because the
   * model wasn't recognised. Consumers should treat unverified
   * records as best-effort hints.
   */
  verified: boolean;

  // ── Hardware ────────────────────────────────────────────────────

  /** Has a mop pad attachment (lift-mop or fixed). */
  canMop: boolean;
  /** Mop pads can be auto-installed/removed at the dock. */
  canAutoInstallMop: boolean;
  /** Has a side brush. */
  hasSideBrush: boolean;
  /** Has an onboard camera (live video feed). */
  hasCamera: boolean;
  /** Has a carpet detection sensor (auto-boost on carpet). */
  hasCarpetSensor: boolean;
  /** Has AI obstacle detection (camera-based object recognition). */
  hasAiObstacleDetection: boolean;

  // ── Dock ────────────────────────────────────────────────────────

  /** Has an auto-empty dock (debris evacuation into a bag). */
  canAutoEmpty: boolean;
  /** Dock can wash the mop pads. */
  canMopWash: boolean;
  /** Dock can dry the mop pads. */
  canMopDry: boolean;
  /** Dock can heat mop-wash water. */
  canHeatMopWater: boolean;
  /** Dock has a detergent reservoir. */
  hasDetergentReservoir: boolean;

  // ── Cleaning behaviour ──────────────────────────────────────────

  /** Supports per-room (segment) targeted cleaning. */
  canCleanPerRoom: boolean;
  /** User-defined virtual walls are honoured. */
  supportsVirtualWalls: boolean;
  /** User-defined no-go zones are honoured. */
  supportsNoGoZones: boolean;
  /** On-device child lock disables physical buttons. */
  hasChildLock: boolean;
  /** Stores multiple maps (one per floor). */
  supportsMultiFloor: boolean;

  // ── Supported value sets ────────────────────────────────────────

  /** Suction levels this model accepts for `setSuction`. */
  supportedSuctionLevels: readonly SuctionLevel[];
  /** Water volumes this model accepts for `setWaterVolume`. */
  supportedWaterVolumes: readonly WaterVolume[];
  /** Carpet-handling modes this model accepts (empty if no carpet sensor). */
  supportedCarpetHandlingModes: readonly CarpetHandlingMode[];
  /** Obstacle-crossing modes (empty if not applicable). */
  supportedObstacleCrossingModes: readonly ObstacleCrossingMode[];
  /** Mop-wash water temperatures (empty if `canHeatMopWater` is false). */
  supportedMopWashTemps: readonly MopWashTemp[];
  /** Mop-wash water levels (empty if `canMopWash` is false). */
  supportedMopWashWaterLevels: readonly MopWashWaterLevel[];
  /** Mop-dry modes (empty if `canMopDry` is false). */
  supportedMopDryModes: readonly MopDryMode[];
  /** Auto-empty frequency options (empty if `canAutoEmpty` is false). */
  supportedAutoEmptyFrequencies: readonly AutoEmptyFrequency[];
}

/**
 * Conservative safe-default returned for models not in the curated table.
 * Hardware feature flags default to `false` so consumers don't render
 * controls for capabilities the device may not have. Suction and water
 * volume default to the standard 4/3-level enums since most Dreame
 * vacuums in this generation expose them.
 */
const FALLBACK: Omit<DeviceCapabilities, "model"> = {
  verified: false,
  canMop: false,
  canAutoInstallMop: false,
  hasSideBrush: true,
  hasCamera: false,
  hasCarpetSensor: false,
  hasAiObstacleDetection: false,
  canAutoEmpty: false,
  canMopWash: false,
  canMopDry: false,
  canHeatMopWater: false,
  hasDetergentReservoir: false,
  canCleanPerRoom: false,
  supportsVirtualWalls: false,
  supportsNoGoZones: false,
  hasChildLock: false,
  supportsMultiFloor: false,
  supportedSuctionLevels: [
    SuctionLevel.Quiet,
    SuctionLevel.Standard,
    SuctionLevel.Intense,
    SuctionLevel.Max,
  ],
  supportedWaterVolumes: [WaterVolume.Low, WaterVolume.Medium, WaterVolume.High],
  supportedCarpetHandlingModes: [],
  supportedObstacleCrossingModes: [],
  supportedMopWashTemps: [],
  supportedMopWashWaterLevels: [],
  supportedMopDryModes: [],
  supportedAutoEmptyFrequencies: [],
};

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj)) {
      deepFreeze(v);
    }
  }
  return obj;
}

/**
 * Curated per-model capability table. Each entry is the result of
 * cross-referencing `miot-spec.ts` annotations against observed
 * behaviour on the listed model. Add models as they're verified.
 *
 * Each entry is deep-frozen at module load (see below) — `getCapabilities`
 * returns table entries by reference and a stray mutation would otherwise
 * corrupt them for every subsequent caller.
 */
export const MODEL_CAPABILITIES: Readonly<Record<string, DeviceCapabilities>> = {
  /** Dreame X50 Ultra Complete — verified against firmware 4.3.9_2199 (2026-05-02). */
  "dreame.vacuum.r2532a": {
    model: "dreame.vacuum.r2532a",
    verified: true,
    canMop: true,
    canAutoInstallMop: true,
    hasSideBrush: true,
    hasCamera: true,
    hasCarpetSensor: true,
    hasAiObstacleDetection: true,
    canAutoEmpty: true,
    canMopWash: true,
    canMopDry: true,
    canHeatMopWater: true,
    hasDetergentReservoir: true,
    canCleanPerRoom: true,
    supportsVirtualWalls: true,
    supportsNoGoZones: true,
    hasChildLock: true,
    supportsMultiFloor: true,
    supportedSuctionLevels: [
      SuctionLevel.Quiet,
      SuctionLevel.Standard,
      SuctionLevel.Intense,
      SuctionLevel.Max,
    ],
    supportedWaterVolumes: [WaterVolume.Low, WaterVolume.Medium, WaterVolume.High],
    supportedCarpetHandlingModes: [
      CarpetHandlingMode.Avoid,
      CarpetHandlingMode.VacuumMopLift,
      CarpetHandlingMode.VacuumRemoveMop,
      CarpetHandlingMode.Ignore,
      CarpetHandlingMode.Crossing,
    ],
    supportedObstacleCrossingModes: [
      ObstacleCrossingMode.HurdleStyle,
      ObstacleCrossingMode.SynchronisedDualLeg,
    ],
    supportedMopWashTemps: [
      MopWashTemp.Normal,
      MopWashTemp.Mild,
      MopWashTemp.Warm,
      MopWashTemp.High,
    ],
    supportedMopWashWaterLevels: [
      MopWashWaterLevel.WaterSaving,
      MopWashWaterLevel.Standard,
      MopWashWaterLevel.Deep,
    ],
    supportedMopDryModes: [MopDryMode.Standard, MopDryMode.Mute],
    supportedAutoEmptyFrequencies: [
      AutoEmptyFrequency.Off,
      AutoEmptyFrequency.Standard,
      AutoEmptyFrequency.HighFrequency,
      AutoEmptyFrequency.LowFrequency,
    ],
  },
};

for (const entry of Object.values(MODEL_CAPABILITIES)) {
  deepFreeze(entry);
}

/**
 * Resolve a model identifier to a `DeviceCapabilities` record.
 *
 * Returns the curated table entry when the model is recognised;
 * otherwise returns a fallback record with `verified: false` and
 * conservative hardware defaults.
 *
 * The returned object is shared with the table (when verified) — do
 * not mutate it.
 */
export function getCapabilities(model: string): DeviceCapabilities {
  const known = MODEL_CAPABILITIES[model];
  if (known) {
    return known;
  }
  return { model, ...FALLBACK };
}
