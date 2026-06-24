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
  NOTIFICATION_PROP,
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
  /**
   * Single-value error code (siid 2 piid 2). 0 = clear.
   *
   * The device only surfaces ONE code here even when multiple
   * conditions are latched simultaneously. For the full set of latched
   * faults read `faults` instead — that's parsed from the multi-value
   * `FAULTS_STR` mirror (siid 4 piid 18) and is the source of truth
   * for "everything currently wrong."
   */
  errorCode: number | null;
  /**
   * Full list of currently-latched fault codes. Primary source is the
   * multi-value `FAULTS_STR` (siid 4 piid 18); a non-zero `errorCode`
   * is always unioned in too so action-refusal codes that push only on
   * `ERROR` (e.g. `MopPadsMissing = 120`) don't get lost. Empty when no
   * faults. Typically one element (matching `errorCode`); multiple
   * elements when several conditions are latched at once (e.g. robot
   * lifted AND clean-water tank empty: `[18, 107]`).
   *
   * Codes are returned as raw ints; cross-reference `MiotError` for
   * the catalogued labels. Unknown codes pass through verbatim.
   */
  faults: readonly number[];
  /**
   * **Stuck flag** — `siid 14 piid 4` (NOTIFICATION_PROP.STUCK_NOTIFICATION_ACTIVE).
   *
   * The device's "robot needs attention" boolean — used by the
   * Dreamehome app to drive the orange-attention-bar prompts. Sticky
   * for the lifetime of the stuck condition; per VERIFIED memory on
   * r2532a, stays pinned at `1` for hours during a real stuck event
   * until the user intervenes.
   *
   * Triggers observed live: navigation/stuck warnings, post-task
   * water-tank service alerts ("refill clean / empty wastewater"),
   * genuine multi-hour stuck conditions. Disambiguate by stickiness
   * and correlation with `errorCode` / `faults` / `miotState`.
   *
   * The `'stuck'` event on `Vacuum` is emitted on 0/null → 1
   * transitions; `state.stuck` carries the current latched value
   * so a UI binding stays consistent across reconnects.
   */
  stuck: boolean | null;
  /**
   * **Mop-drying progress in minutes** — `siid 4 piid 64`
   * (`VACUUM_PROP.DRYING_PROGRESS`). Counts up from 0 once per minute
   * during the post-task drying cycle (`MiotState.MopDrying = 8`),
   * resets to 0 when the cycle finishes or a new task starts.
   *
   * `null` when the device hasn't pushed this property yet (most
   * common state — only ticks during drying).
   */
  dryingProgressMin: number | null;
  /**
   * Raw `siid 4 piid 20` (`RELOCATION_STATUS`). ASSUMED from Tasshack:
   *   0  Located, 1 Locating, 10 Failed, 11 Success.
   *
   * A 0→1 transition is the signal that the user has picked the
   * robot up — useful for distinguishing "robot was rescued from
   * stranding and is recovering" from "robot finished cleanly."
   *
   * Not yet observed on r2532a; kept as raw int until verified.
   */
  relocationStatusRaw: number | null;

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
   * Dirt / cliff sensors maintenance counters (siid 16). Either hitting
   * 0 triggers the Dreamehome "clean the sensors" prompt. Note the unit
   * split: piid 1 is HOURS-left, piid 2 is DAYS-left (NOT a percentage).
   * VERIFIED on r2532a 2026-05-02; reset via `VACUUM_ACTION.RESET_SENSOR`.
   */
  sensorHoursLeft: number | null;
  sensorDaysLeft: number | null;
  /**
   * Dock Scale Inhibitor cartridge (siid 31): days-left (piid 1) and
   * %-left (piid 2). VERIFIED on r2532a 2026-05-02.
   */
  scaleInhibitorDaysLeft: number | null;
  scaleInhibitorLeftPct: number | null;

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
  /**
   * Map ID currently treated as active by the device (the "now"
   * floor). Driven by the `mapInfo` push on `_sync.update_vacuum_mapinfo`;
   * `null` until the first such push lands. See `MapInfoPush.activeMapId`.
   */
  activeMapId: number | null;
  /**
   * All saved-map IDs the device has, sorted ascending. Empty until
   * the first `mapInfo` push lands. See `MapInfoPush.savedMapIds`.
   */
  savedMapIds: readonly number[];
  /**
   * Wall-clock timestamp of the most-recent property batch that actually
   * moved a field. `null` until the first such batch lands. Lets
   * consumers detect "data is stale" without inferring from `null`
   * fields — e.g. show "data N seconds old" when the dashboard's
   * auto-refresh notices `Date.now() - lastStateUpdateAt > threshold`.
   *
   * Set by both MQTT property pushes and HTTP `refresh()` /
   * `refreshFromCloud()` calls. Not bumped on no-op batches (where
   * every field is already at the pushed value).
   */
  lastStateUpdateAt: Date | null;
}

export const EMPTY_STATE: VacuumState = {
  miotState: null,
  miotStateRaw: null,
  errorCode: null,
  faults: Object.freeze([]) as readonly number[],
  stuck: null,
  dryingProgressMin: null,
  relocationStatusRaw: null,
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
  sensorHoursLeft: null,
  sensorDaysLeft: null,
  scaleInhibitorDaysLeft: null,
  scaleInhibitorLeftPct: null,
  online: null,
  ota: null,
  activeMapId: null,
  savedMapIds: Object.freeze([]) as readonly number[],
  lastStateUpdateAt: null,
};

type Patch = Partial<VacuumState>;
/**
 * Handlers receive the raw MIoT property value (which may be a number,
 * a string, or `null`/`undefined` when the device sent a non-scalar).
 * Most handlers coerce to a number internally; the `FAULTS_STR` handler
 * needs the string form to split it.
 */
type Applier = (value: unknown) => Patch;

export function propKey(p: { siid: number; piid: number }): string {
  return `${p.siid}.${p.piid}`;
}

/** Coerce a raw MIoT value to a number or null. */
function asNum(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/** Narrow a raw int to an enum member, or null if it's not a known value. */
function asEnum<T extends number>(num: number | null, enumObj: object): T | null {
  return num !== null && num in enumObj ? (num as T) : null;
}

/**
 * Parse the multi-value `FAULTS_STR` (siid 4 piid 18) string into an
 * array of fault-code ints. Per Tasshack/dreame-vacuum `device.py:1342-1372`
 * on dev branch, the device sends a comma-separated list when several
 * conditions are latched simultaneously; the single-fault case is just
 * the int as a string.
 *
 * Empty / `"0"` / whitespace-only collapse to an empty array. Unknown
 * codes are kept as raw ints — callers cross-reference `MiotError`.
 */
function parseFaultList(value: unknown): readonly number[] {
  if (typeof value !== "string") {
    // The device occasionally pushes a single int directly (no string-encoding).
    // Accept that as a one-element list when non-zero.
    if (typeof value === "number" && value !== 0) {
      return Object.freeze([value]);
    }
    return Object.freeze([]);
  }
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "0") {
    return Object.freeze([]);
  }
  const codes: number[] = [];
  for (const part of trimmed.split(",")) {
    const n = Number.parseInt(part.trim(), 10);
    if (Number.isFinite(n) && n !== 0) {
      codes.push(n);
    }
  }
  return Object.freeze(codes);
}

/**
 * Each handler maps a single MIoT property push to a partial state
 * patch. The `Vacuum` class looks up the right handler by `siid.piid`,
 * computes the patch, and merges it into state.
 */
export const APPLIERS: Record<string, Applier> = {
  [propKey(VACUUM_PROP.STATE)]: (value) => {
    const num = asNum(value);
    return { miotStateRaw: num, miotState: asEnum<MiotState>(num, MiotState) };
  },
  [propKey(VACUUM_PROP.ERROR)]: (value) => ({ errorCode: asNum(value) }),
  [propKey(VACUUM_PROP.FAULTS_STR)]: (value) => ({ faults: parseFaultList(value) }),
  [propKey(VACUUM_PROP.TASK_STATUS)]: (value) => ({ taskStatusRaw: asNum(value) }),
  [propKey(VACUUM_PROP.RELOCATION_STATUS)]: (value) => ({ relocationStatusRaw: asNum(value) }),
  [propKey(VACUUM_PROP.DRYING_PROGRESS)]: (value) => ({ dryingProgressMin: asNum(value) }),
  [propKey(NOTIFICATION_PROP.STUCK_NOTIFICATION_ACTIVE)]: (value) => {
    const num = asNum(value);
    return { stuck: num === null ? null : num !== 0 };
  },
  [propKey(BATTERY_PROP.LEVEL)]: (value) => ({ battery: asNum(value) }),
  [propKey(BATTERY_PROP.CHARGING_STATUS)]: (value) => {
    const num = asNum(value);
    return { chargingRaw: num, charging: asEnum<ChargingStatus>(num, ChargingStatus) };
  },
  [propKey(VACUUM_PROP.SUCTION_LEVEL)]: (value) => {
    const num = asNum(value);
    return { suctionRaw: num, suction: asEnum<SuctionLevel>(num, SuctionLevel) };
  },
  [propKey(VACUUM_PROP.WATER_VOLUME)]: (value) => {
    const num = asNum(value);
    return { waterVolumeRaw: num, waterVolume: asEnum<WaterVolume>(num, WaterVolume) };
  },
  [propKey(VACUUM_PROP.CLEANING_MODE)]: (value) => {
    const num = asNum(value);
    return {
      cleaningModeRaw: num,
      cleaningMode: num !== null && num >= 0 && num <= 3 ? (num as CleaningMode) : null,
    };
  },
  [propKey(VACUUM_PROP.CLEANING_TIME)]: (value) => ({ cleaningTimeMin: asNum(value) }),
  [propKey(VACUUM_PROP.CLEANED_AREA)]: (value) => ({ cleanedAreaSqm: asNum(value) }),
  [propKey(VACUUM_PROP.TASK_PROGRESS_PCT)]: (value) => ({ taskProgressPct: asNum(value) }),
  [propKey(SETTINGS_PROP.VOLUME)]: (value) => ({ volume: asNum(value) }),
  [propKey(CONSUMABLE_PROP.MAIN_BRUSH_LEFT)]: (value) => ({ mainBrushLeftPct: asNum(value) }),
  [propKey(CONSUMABLE_PROP.SIDE_BRUSH_LEFT)]: (value) => ({ sideBrushLeftPct: asNum(value) }),
  [propKey(CONSUMABLE_PROP.FILTER_LEFT)]: (value) => ({ filterLeftPct: asNum(value) }),
  [propKey(CONSUMABLE_PROP.SENSOR_HOURS_LEFT)]: (value) => ({ sensorHoursLeft: asNum(value) }),
  [propKey(CONSUMABLE_PROP.SENSOR_DAYS_LEFT)]: (value) => ({ sensorDaysLeft: asNum(value) }),
  [propKey(CONSUMABLE_PROP.SCALE_INHIBITOR_DAYS_LEFT)]: (value) => ({ scaleInhibitorDaysLeft: asNum(value) }),
  [propKey(CONSUMABLE_PROP.SCALE_INHIBITOR_LEFT)]: (value) => ({ scaleInhibitorLeftPct: asNum(value) }),
};

