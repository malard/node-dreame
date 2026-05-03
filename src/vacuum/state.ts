/**
 * Per-property → state-patch table for `Vacuum`.
 *
 * Extracted from `src/vacuum.ts` so the class file stays focused on
 * orchestration. Adding a new tracked property only touches `APPLIERS`
 * (and the corresponding field on `VacuumState`).
 */

import {
  BATTERY_PROP,
  CONSUMABLE_PROP,
  ChargingStatus,
  CleaningMode,
  MiotState,
  SETTINGS_PROP,
  SuctionLevel,
  VACUUM_PROP,
  WaterVolume,
} from "../miot-spec.js";
import type { OtaEvent } from "../mqtt.js";

/**
 * Typed snapshot of the most-recently-known device state.
 *
 * Field naming convention:
 *   - `<name>` (typed)         → enum/struct value where we have a VERIFIED mapping
 *   - `raw<Name>` / `<name>Raw` → raw integer for fields where the enum is ASSUMED
 *                                 or value space is not yet decoded
 *
 * See `miot-spec.ts` for which siid/piid combos are verified vs assumed.
 */
export interface VacuumState {
  /** MIoT STATE (siid 2 piid 1). VERIFIED enum mapping for r2532a. */
  miotState: MiotState | null;
  /** Raw int from siid 2 piid 1 — present even when outside the known enum. */
  miotStateRaw: number | null;
  /** Error/fault code (siid 2 piid 2). 0 = clear. */
  errorCode: number | null;

  /**
   * Dreame "task status" raw int (siid 4 piid 1).
   * NOT enum-mapped: Tasshack's older-model enum does not match observed
   * r2532a values, and we don't yet have a translated keyDefine for it.
   */
  taskStatusRaw: number | null;

  /** Battery percentage (siid 3 piid 1). */
  battery: number | null;
  /** Charging status (siid 3 piid 2). ASSUMED enum from Tasshack. */
  charging: ChargingStatus | null;
  /** Same as `charging` but as the raw int — useful when value is outside the assumed enum. */
  chargingRaw: number | null;

  /** Suction level (siid 4 piid 4). ASSUMED enum from Tasshack. */
  suction: SuctionLevel | null;
  suctionRaw: number | null;

  /** Water volume (siid 4 piid 5). ASSUMED enum from Tasshack. */
  waterVolume: WaterVolume | null;
  waterVolumeRaw: number | null;

  /**
   * Cleaning mode (siid 4 piid 23). On r2532a returns values like 5120 that
   * don't fit the simple Tasshack enum — likely a packed bitfield. Raw only
   * until decoded.
   */
  cleaningModeRaw: number | null;
  /** Tentative enum value — only populated when raw is in 0-3 range. */
  cleaningMode: CleaningMode | null;

  /** Current job runtime in minutes (siid 4 piid 2). ASSUMED. */
  cleaningTimeMin: number | null;
  /** Area cleaned this job in m² (siid 4 piid 3). ASSUMED. */
  cleanedAreaSqm: number | null;
  /**
   * Task progress percentage (siid 4 piid 63), 0..100. Hits 100 at
   * end-of-task right before the `taskComplete` event fires, then
   * resets to 0. VERIFIED on r2532a 2026-05-03.
   */
  taskProgressPct: number | null;
  /** Voice volume 0-100 (siid 7 piid 1). ASSUMED. */
  volume: number | null;

  /** Consumables — % remaining (ASSUMED siid/piid from Tasshack). */
  mainBrushLeftPct: number | null;
  sideBrushLeftPct: number | null;
  filterLeftPct: number | null;

  /**
   * Whether the device is currently reachable via the cloud. Updated by
   * MQTT connect/close events and by refresh() outcomes. `null` means
   * unknown (haven't connected/refreshed yet).
   */
  online: boolean | null;
  /**
   * Latest OTA event seen (state + progress). `null` once the OTA settles
   * back to `state: "idle"` or `state: "installed"`. Useful for UI progress bars.
   */
  ota: OtaEvent | null;
}

export const EMPTY_STATE: VacuumState = {
  miotState: null,
  miotStateRaw: null,
  errorCode: null,
  taskStatusRaw: null,
  battery: null,
  charging: null,
  chargingRaw: null,
  suction: null,
  suctionRaw: null,
  waterVolume: null,
  waterVolumeRaw: null,
  cleaningModeRaw: null,
  cleaningMode: null,
  cleaningTimeMin: null,
  cleanedAreaSqm: null,
  taskProgressPct: null,
  volume: null,
  mainBrushLeftPct: null,
  sideBrushLeftPct: null,
  filterLeftPct: null,
  online: null,
  ota: null,
};

type Patch = Partial<VacuumState>;
type Applier = (num: number | null) => Patch;

export function propKey(p: { siid: number; piid: number }): string {
  return `${p.siid}.${p.piid}`;
}

/** Narrow a raw int to an enum member, or null if it's not a known value. */
function asEnum<T extends number>(num: number | null, enumObj: object): T | null {
  return num !== null && num in enumObj ? (num as T) : null;
}

/**
 * Each handler maps a single MIoT property push (numeric value, possibly
 * null if the device sent a non-number) to a partial state patch. The
 * `Vacuum` class looks up the right handler by `siid.piid`, computes the
 * patch, and merges it into state.
 */
export const APPLIERS: Record<string, Applier> = {
  [propKey(VACUUM_PROP.STATE)]: (num) => ({
    miotStateRaw: num,
    miotState: asEnum<MiotState>(num, MiotState),
  }),
  [propKey(VACUUM_PROP.ERROR)]: (num) => ({ errorCode: num }),
  [propKey(VACUUM_PROP.TASK_STATUS)]: (num) => ({ taskStatusRaw: num }),
  [propKey(BATTERY_PROP.LEVEL)]: (num) => ({ battery: num }),
  [propKey(BATTERY_PROP.CHARGING_STATUS)]: (num) => ({
    chargingRaw: num,
    charging: asEnum<ChargingStatus>(num, ChargingStatus),
  }),
  [propKey(VACUUM_PROP.SUCTION_LEVEL)]: (num) => ({
    suctionRaw: num,
    suction: asEnum<SuctionLevel>(num, SuctionLevel),
  }),
  [propKey(VACUUM_PROP.WATER_VOLUME)]: (num) => ({
    waterVolumeRaw: num,
    waterVolume: asEnum<WaterVolume>(num, WaterVolume),
  }),
  [propKey(VACUUM_PROP.CLEANING_MODE)]: (num) => ({
    cleaningModeRaw: num,
    cleaningMode: num !== null && num >= 0 && num <= 3 ? (num as CleaningMode) : null,
  }),
  [propKey(VACUUM_PROP.CLEANING_TIME)]: (num) => ({ cleaningTimeMin: num }),
  [propKey(VACUUM_PROP.CLEANED_AREA)]: (num) => ({ cleanedAreaSqm: num }),
  [propKey(VACUUM_PROP.TASK_PROGRESS_PCT)]: (num) => ({ taskProgressPct: num }),
  [propKey(SETTINGS_PROP.VOLUME)]: (num) => ({ volume: num }),
  [propKey(CONSUMABLE_PROP.MAIN_BRUSH_LEFT)]: (num) => ({ mainBrushLeftPct: num }),
  [propKey(CONSUMABLE_PROP.SIDE_BRUSH_LEFT)]: (num) => ({ sideBrushLeftPct: num }),
  [propKey(CONSUMABLE_PROP.FILTER_LEFT)]: (num) => ({ filterLeftPct: num }),
};
