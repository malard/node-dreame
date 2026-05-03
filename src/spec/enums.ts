/**
 * MIoT enum definitions and small enum-adjacent types.
 *
 * Extracted from `miot-spec.ts` so the property/action catalogue stays
 * focused on siid/piid/aiid tables. `miot-spec.ts` re-exports each
 * symbol so existing imports keep working.
 */

// ─── Core vacuum-state enums ─────────────────────────────────────────

/**
 * VERIFIED enum for **siid 2 piid 1 (MIoT STATE)** on r2532a.
 *
 * Sourced from the device's own `keyDefine v8` JSON (translated UI strings),
 * fetched from `oss.iot.dreame.tech` on 2026-05-02. All 39 documented values
 * present below; some sparse gaps (31-32, 34-96, 100) are not defined by the
 * device file and so absent here.
 *
 * **19 values verified live on r2532a 2026-05-02** across a full ~2.5h
 * cleaning task (incl. multiple mid-job dock cycles, mop install/remove,
 * auto-empty, end-of-task drying):
 *
 *   1, 2, 3, 4, 5, 6, 8, 9, 10, 12, 13, 14, 17, 18, 20, 22, 23, 28, 30
 *
 * **+2 more values verified live 2026-05-03** during a "greasy areas"
 * targeted clean (~93 min):
 *
 *   - `20 (CleanMopRefillWater)` — re-confirmed; appeared during the
 *     dock-side mop wash sub-cycle as a brief intermediate (`9 → 20 → 9`).
 *   - `25 (SecondCleaning)` — common transitional hub state observed
 *     between active cleaning and any dock excursion (re-pad, mop wash,
 *     return-with-intent). Tasshack's `SecondCleaning` label fits the
 *     observed semantics: "device is between phases of a task,
 *     re-evaluating what to do next".
 *
 * Sub-mode discovery: **MiotState 1 vs 12 distinguishes vacuum-only
 * vs vacuum+mop cleaning** — the robot dynamically alternates per zone
 * (install pads → 12 → remove pads → 1) without ending the user-visible
 * task. Confirmed across 6 independent transitions.
 *
 * Canonical end-of-cleaning sequence:
 *   `12 → 5 → 6 → 22 → 9 → 6 → 8`
 *   Cleaning → ReturningToCharge → Charging → AutoEmptying → MopCleaning
 *   → Charging → MopDrying (settled idle).
 *
 * "Return-with-intent" triplet (all verified 2026-05-02):
 *   17 = ReturnInstallMop, 18 = ReturnRemoveMop, 28 = ReturnToEmpty.
 *
 * **Do NOT use this enum for siid 4 piid 1** (`TASK_STATUS`) — that's a
 * separate property with its own value space; see `TaskStatus` enum.
 */
export enum MiotState {
  Cleaning = 1,
  Standby = 2,
  Paused = 3,
  PausedAlt = 4, // keyDefine also labels 4 as "Paused"
  ReturningToCharge = 5,
  Charging = 6,
  Mopping = 7,
  MopDrying = 8,
  MopCleaning = 9,
  ReturningToWash = 10,
  Mapping = 11,
  CleaningAlt = 12, // keyDefine also labels 12 as "Cleaning"
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
  ShortcutRunning = 97,
  CameraMonitoring = 98,
  CameraMonitoringPaused = 99,
  InitialDeepClean = 101,
}

/**
 * VERIFIED enum for **siid 3 piid 2 (ChargingStatus)** on r2532a.
 *
 * Values 1, 2, 5 confirmed by direct observation across an undock → drive
 * → return-to-dock → recharge cycle on 2026-05-02. The Tasshack mapping
 * (`ChargedComplete=2`, `ChargingError=5`) was wrong for this generation —
 * value 2 actually means "off-dock / discharging" and value 5 means
 * "returning to dock".
 *
 * Other values (charged-complete, error states) not yet observed; the
 * device may use other ints or may simply leave this at 1 when fully
 * charged on the dock.
 */
export enum ChargingStatus {
  Charging = 1,
  Discharging = 2,
  Returning = 5,
}

/**
 * VERIFIED enum for **siid 2 piid 2 (ERROR / fault code)** on r2532a.
 *
 * 6 values catalogued live on 2026-05-02 (full cleaning task + a deliberate
 * wheel-spin user perturbation):
 *
 * - `0` — clear / no error
 * - `1` — wheel rotation anomaly (encoder reports motion that doesn't match
 *         commanded motor state — slip, forced rotation, debris, gear stuck).
 *         Auto-clears in ~12s once the cause resolves.
 * - `18` — robot lifted / wheels off ground. **Sticky** until physical resolution.
 * - `68` — task-complete notification. Fires together with the final
 *          MopDrying transition at end-of-task; not a fault. Sticky during
 *          the drying period.
 * - `74` — manual mop install required. Fires after auto-install attempts
 *          fail; auto-clears once the user manually installs the pads.
 * - `114` — washboard filter needs cleaning (maintenance reminder).
 *
 * Most codes auto-clear when the underlying condition resolves — the
 * `CLEAR_WARNING` action is rarely needed. The string mirror at
 * `VACUUM_PROP.ERROR_STR_MIRROR` (siid 4 piid 18) co-fires within ~1ms.
 *
 * Other Tasshack-documented error codes (e.g. low battery, dustbin full,
 * water tank empty) likely use different ints on r2532a — treat any
 * non-listed value as raw and capture for cataloguing.
 */
export enum MiotError {
  Clear = 0,
  WheelRotationAnomaly = 1,
  RobotLifted = 18,
  TaskComplete = 68,
  ManualMopInstallRequired = 74,
  WashboardFilterNeedsCleaning = 114,
}

/**
 * VERIFIED enum for **siid 4 piid 1 (TASK_STATUS)** on r2532a.
 *
 * 6 values catalogued live during a full cleaning task on 2026-05-02:
 *
 * - `1` — interrupted / paused (lift, user-pause, transient stall — the
 *         common pause fallback)
 * - `2` — active task running
 * - `3` — transitioning (returning to wash / dock)
 * - `6` — on dock idle (post-wash, between phases)
 * - `12` — transient pause-edge (fires briefly during MiotState 12 → paused
 *          transitions)
 * - `14` — needs intervention (long-stall / sticky error)
 *
 * Distinct from `MiotState` (siid 2 piid 1) — `TaskStatus` is roughly
 * "what is the user-visible task doing" while `MiotState` is the lower-level
 * vacuum mode machine. They co-vary but don't have a 1:1 mapping.
 */
export enum TaskStatus {
  InterruptedOrPaused = 1,
  Active = 2,
  Transitioning = 3,
  OnDockIdle = 6,
  TransientPauseEdge = 12,
  NeedsIntervention = 14,
}

/**
 * VERIFIED enum for **siid 4 piid 25 (TASK_PHASE)** on r2532a.
 *
 * 4 values catalogued during a full cleaning task on 2026-05-02:
 *
 * - `0` — idle / no active sub-task
 * - `1` — active sub-task running (during BOTH cleaning AND wash contexts —
 *         a general "doing the active phase of whatever task we're in" signal)
 * - `3` — transit to wash / dock
 * - `5` — washing in progress
 *
 * Use as a finer-grained progression signal than `TaskStatus`. Values
 * 2 and 4 not yet observed.
 */
export enum TaskPhase {
  Idle = 0,
  Active = 1,
  TransitToWash = 3,
  Washing = 5,
}

/**
 * VERIFIED on r2532a 2026-05-02 — actual UI labels confirmed by Martin.
 * These are the X50 Ultra Complete labels; older Dreames (Tasshack-era)
 * used the names Strong/Turbo for values 2/3 — same numeric mapping,
 * just different display strings.
 */
export enum SuctionLevel {
  Quiet = 0,
  Standard = 1,
  Intense = 2,
  Max = 3,
}

/** ASSUMED Tasshack — siid 4 piid 5 enum. NOT YET observed on r2532a. */
export enum WaterVolume {
  Low = 1,
  Medium = 2,
  High = 3,
}

/**
 * ASSUMED Tasshack — siid 4 piid 23 enum.
 * **NOT applicable to r2532a as-is**: we observed value `5120` on r2532a,
 * way outside this 0-3 range — almost certainly a packed bitfield in the
 * X50 generation. Surface the raw int until decoded.
 */
export enum CleaningMode {
  Sweeping = 0,
  Mopping = 1,
  SweepAndMop = 2,
  MopAfterSweep = 3,
}

// ─── Dock setting enums (all VERIFIED on r2532a 2026-05-02) ───────────

/** Mop-Washing Water Temperature (`DOCK_PROP.MOP_WASH_TEMP`). */
export enum MopWashTemp {
  Normal = 0,
  Mild = 1,
  Warm = 2,
  High = 3,
}

/** Mop-Washing Water Level (`VACUUM_PROP.MOP_WASH_WATER_LEVEL`). */
export enum MopWashWaterLevel {
  WaterSaving = 0,
  Standard = 1,
  Deep = 2,
}

/** Mop-Drying Mode (`DOCK_PROP.MOP_DRY_MODE`). */
export enum MopDryMode {
  Standard = 0,
  Mute = 1,
}

/** Auto-Empty Frequency (`AUTO_EMPTY_PROP.FREQUENCY`). Arbitrary mode ids — values aren't ordered by frequency. */
export enum AutoEmptyFrequency {
  Off = 0,
  Standard = 1,
  HighFrequency = 2,
  LowFrequency = 3,
}

/** Carpet Handling Mode (`VACUUM_PROP.CARPET_HANDLING_MODE`). Multiplexes the parent menu + the Vacuum-mode sub-options. */
export enum CarpetHandlingMode {
  Avoid = 1,
  VacuumMopLift = 2,
  VacuumRemoveMop = 3,
  Ignore = 6,
  Crossing = 7,
}

/** Obstacle Crossing Mode (`DOCK_PROP.OBSTACLE_CROSSING_MODE`) — how the X50's motorised chassis lift handles thresholds. */
export enum ObstacleCrossingMode {
  HurdleStyle = 0,
  SynchronisedDualLeg = 1,
}

/** Live Video Prompts level (`FEATURE_CONFIG_KEYS.MonitorPromptLevel`) — voice prompt volume during camera streaming. */
export enum LiveVideoPrompts {
  Weak = 0,
  Strong = 1,
  Quiet = 2,
}

/** Mop-Drying duration in hours — bounded set. */
export type DryingTimeHours = 2 | 3 | 4;

// ─── Custom-mode schedule field-8 packed integer (VERIFIED on r2532a 2026-05-02) ─

/**
 * Cleaning route enum — packed into bits 0-3 of the schedule field-8 int.
 * Only meaningful in Custom-mode schedules. Available routes depend on
 * the active cleaning mode (e.g. Deep is only valid in Mop-only mode).
 */
export enum ScheduleRoute {
  Standard = 1,
  Intensive = 2,
  Deep = 3,
  Quick = 4,
}

/**
 * Cleaning mode enum for Custom-mode schedules — packed into bits 4-6.
 * Note the value-to-meaning ordering is Dreame's own (not by use frequency).
 */
export enum ScheduleCleaningMode {
  VacOnly = 1,
  VacAndMop = 2,
  MopOnly = 3,
  MopAfterVac = 4,
}

/**
 * Bit positions for the Custom-mode schedule's packed-integer field 8.
 * See `notes/feature-discovery-session.md` and the SCHEDULE_PROP doc for
 * the full schedule string format.
 */
export const SCHEDULE_FIELD8 = {
  ROUTE_BITS: { offset: 0, width: 4 } as const,    // 1-4 small int — see ScheduleRoute
  MODE_BITS:  { offset: 4, width: 3 } as const,    // 1-4 small int — see ScheduleCleaningMode
  // bits 7..23  — undecoded (constant 0xC249 across all observations; suspected
  //               to encode default/per-room overrides not exercised in our session).
  SUCTION_BITS:    { offset: 24, width: 2 } as const, // 0-3 — see SuctionLevel
  // bits 26..27 — unknown
  CYCLE_COUNT_BITS: { offset: 28, width: 4 } as const, // 1-N int (1-15 max)
} as const;
