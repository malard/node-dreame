/**
 * MIoT siid/piid/aiid catalogue for the modern Dreame vacuum series
 * (r24xx + r25xx generation, including X40/X50 Ultra). The spec is
 * stable across this generation — same dict in Tasshack's `types.py`
 * for r2228, r2389, r2449, r2532a.
 *
 * If you target an older Dreame (m1808/p2008/etc.), expect overrides.
 */

/** Vacuum service properties. */
export const VACUUM_PROP = {
  STATE: { siid: 2, piid: 1 } as const, // raw MIoT vacuum-status enum
  ERROR: { siid: 2, piid: 2 } as const,
  STATUS: { siid: 4, piid: 1 } as const, // richer Dreame task-status enum
  SUCTION_LEVEL: { siid: 4, piid: 4 } as const,
  WATER_VOLUME: { siid: 4, piid: 5 } as const,
  CLEANING_TIME: { siid: 4, piid: 2 } as const,
  CLEANED_AREA: { siid: 4, piid: 3 } as const,
  CLEANING_MODE: { siid: 4, piid: 23 } as const,
  SELF_CLEAN: { siid: 4, piid: 34 } as const,
  DRYING_TIME: { siid: 4, piid: 40 } as const,
  REMOTE_CONTROL: { siid: 4, piid: 15 } as const,
} as const;

/** Battery service. */
export const BATTERY_PROP = {
  LEVEL: { siid: 3, piid: 1 } as const,
  CHARGING_STATUS: { siid: 3, piid: 2 } as const,
} as const;

/** Settings service. */
export const SETTINGS_PROP = {
  DND: { siid: 5, piid: 1 } as const,
  VOLUME: { siid: 7, piid: 1 } as const,
} as const;

/** Consumables (`*_LEFT` is %, `*_TIME_LEFT` is hours/days). */
export const CONSUMABLE_PROP = {
  MAIN_BRUSH_LEFT: { siid: 9, piid: 2 } as const,
  MAIN_BRUSH_TIME_LEFT: { siid: 9, piid: 1 } as const,
  SIDE_BRUSH_LEFT: { siid: 10, piid: 2 } as const,
  SIDE_BRUSH_TIME_LEFT: { siid: 10, piid: 1 } as const,
  FILTER_LEFT: { siid: 11, piid: 1 } as const,
  FILTER_TIME_LEFT: { siid: 11, piid: 2 } as const,
} as const;

/** Actions (siid + aiid). */
export const VACUUM_ACTION = {
  START: { siid: 2, aiid: 1 } as const,
  PAUSE: { siid: 2, aiid: 2 } as const,
  CHARGE: { siid: 3, aiid: 1 } as const, // return-to-dock
  START_CUSTOM: { siid: 4, aiid: 1 } as const, // segment / zone clean
  STOP: { siid: 4, aiid: 2 } as const,
  CLEAR_WARNING: { siid: 4, aiid: 3 } as const,
  START_WASHING: { siid: 4, aiid: 4 } as const,
  LOCATE: { siid: 7, aiid: 1 } as const,
  TEST_SOUND: { siid: 7, aiid: 2 } as const,
  RESET_MAIN_BRUSH: { siid: 9, aiid: 1 } as const,
  RESET_SIDE_BRUSH: { siid: 10, aiid: 1 } as const,
  RESET_FILTER: { siid: 11, aiid: 1 } as const,
  RESET_SENSOR: { siid: 16, aiid: 1 } as const,
  START_AUTO_EMPTY: { siid: 15, aiid: 1 } as const,
  RESET_SECONDARY_FILTER: { siid: 17, aiid: 1 } as const,
  RESET_MOP_PAD: { siid: 18, aiid: 1 } as const,
  RESET_SILVER_ION: { siid: 19, aiid: 1 } as const,
  RESET_DETERGENT: { siid: 20, aiid: 1 } as const,
} as const;

/**
 * Dreame STATUS enum (siid 4 piid 1) — the rich task-status field.
 * Translations sourced from the live r2532a keyDefine v8.
 */
export enum VacuumStatus {
  Cleaning = 1,
  Idle = 2,
  Paused = 3,
  Error = 4,
  ReturningToCharge = 5,
  Charging = 6,
  Mopping = 7,
  DryingMop = 8,
  WashingMop = 9,
  ReturningToWash = 10,
  Mapping = 11,
  Cleaning2 = 12,
  ChargingComplete = 13,
  Updating = 14,
  CallToClean = 15,
  AutoRepairBase = 16,
  ReturnInstallMop = 17,
  ReturnRemoveMop = 18,
  WaterSupplyDrainTest = 19,
  CleanMopRefillWater = 20,
  PausedCleaning = 21,
  AutoEmptying = 22,
  RemoteCleaning = 23,
  IntelligentCharging = 24,
  SecondCleaning = 25,
  Following = 26,
  PartialCleaning = 27,
  ReturnToEmpty = 28,
  WaitingForTask = 29,
  CleanWashboardBase = 30,
  AutoWaterDraining = 33,
}

export enum ChargingStatus {
  NotCharging = 0,
  Charging = 1,
  ChargedComplete = 2, // some firmwares
  ChargingError = 5,
}

/** Suction level enum — values cross-checked against Tasshack. */
export enum SuctionLevel {
  Quiet = 0,
  Standard = 1,
  Strong = 2,
  Turbo = 3,
}

export enum WaterVolume {
  Low = 1,
  Medium = 2,
  High = 3,
}

export enum CleaningMode {
  Sweeping = 0,
  Mopping = 1,
  SweepAndMop = 2,
  MopAfterSweep = 3,
}
