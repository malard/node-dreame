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
 * Error / fault code value space for **siid 2 piid 2 (ERROR)** and the
 * multi-value fault-list mirror at **siid 4 piid 18 (FAULTS)**.
 *
 * Two tiers of members:
 *
 * **VERIFIED on r2532a** (X50 Ultra Complete) — observed live during a
 * full cleaning task, a deliberate wheel-spin perturbation, and the
 * 2026-05-12 tank-refusal probes:
 *
 *   - `Clear = 0` — clear / no error.
 *   - `WheelRotationAnomaly = 1` — encoder reports motion that doesn't
 *     match commanded motor state (slip, forced rotation, debris,
 *     gear stuck). Auto-clears in ~12s once the cause resolves.
 *   - `RobotLifted = 18` — robot lifted / wheels off ground. **Sticky**
 *     until physical resolution.
 *   - `TaskComplete = 68` — task-complete notification. Fires together
 *     with the final MopDrying transition at end-of-task; not a fault.
 *     Sticky during the drying period. (Tasshack labels 68 as
 *     `REMOVE_MOP` for older Mi-cloud models — the meaning of code 68
 *     differs between firmwares. We keep our VERIFIED r2532a label.)
 *   - `ManualMopInstallRequired = 74` — fires after auto-install
 *     attempts fail; auto-clears once the user manually installs the
 *     pads.
 *   - `WastewaterTankFull = 105` — refuses `start()` until the tank is
 *     emptied. VERIFIED 2026-05-12.
 *   - `CleanWaterTankEmpty = 107` — refuses `start()` until the tank
 *     is refilled. VERIFIED 2026-05-12.
 *   - `WashboardFilterNeedsCleaning = 114` — maintenance reminder.
 *
 * **ASSUMED from Tasshack/dreame-vacuum** (`types.py:225-363` on dev
 * branch) — borrowed names, not yet seen live on r2532a. Treat the
 * label as a hint; the integer is the source of truth. Naming on the
 * Dreamehome cloud may differ from Tasshack's Mi-cloud-era catalogue.
 *
 * Most codes auto-clear when the underlying condition resolves; the
 * `CLEAR_WARNING` action is rarely needed. The string-typed fault-list
 * mirror at `VACUUM_PROP.FAULTS_STR` (siid 4 piid 18) co-fires with
 * every ERROR change and can carry MULTIPLE comma-separated codes when
 * several conditions are latched simultaneously (e.g. tank empty +
 * robot lifted). See `Vacuum.state.faults` for the parsed list.
 */
export enum MiotError {
  Clear = 0,
  // ─── VERIFIED on r2532a ─────────────────────────────────────────────
  WheelRotationAnomaly = 1,
  RobotLifted = 18,
  TaskComplete = 68,
  ManualMopInstallRequired = 74,
  WastewaterTankFull = 105,
  CleanWaterTankEmpty = 107,
  WashboardFilterNeedsCleaning = 114,
  /**
   * Latched on `start()` when the mop pads are not seated on the robot.
   * Observed on r2532a (fw 4.3.9_2199) 2026-05-17 — the Dreamehome app
   * shows this as "Mop not in place, please check if the mop is in the
   * dock, or install manually on the robot." Distinct from
   * `ManualMopInstallRequired = 74` (which fires after the dock's
   * auto-install sequence gives up at end-of-task); 120 is the
   * action-refusal variant fired *at* `start()` rather than mid-task.
   *
   * Co-firing with `FAULTS_STR` (siid 4 piid 18) was NOT observed in
   * the original repro (state.faults stayed empty for 30 minutes) — see
   * GitHub #8 secondary issue. May only push on `ERROR` (siid 2 piid 2).
   */
  MopPadsMissing = 120,
  // ─── ASSUMED from Tasshack — battery / charging ─────────────────────
  /** Sensor-side "battery low" warning (distinct from `LowBatteryTurnOff`). Tasshack suppresses this code while charging. */
  BatteryLow = 20,
  /** Charging fault — cable / pad contact issue, dock electrical problem. */
  ChargeFault = 21,
  /** Battery percentage anomaly (battery telemetry inconsistent). */
  BatteryPercentageAnomaly = 22,
  /** Robot reached the dock but received no charging current. */
  ChargeNoElectric = 28,
  /** Battery cell fault — hardware-level problem with the pack. */
  BatteryFault = 29,
  /**
   * Robot powered itself off mid-task because the battery was depleted.
   * Tasshack groups this with the user-clearable warnings — once the
   * device recovers, the code goes away on its own. Highly likely the
   * code that fired during the 2026-05-16 stranding incident on this
   * project's r2532a.
   */
  LowBatteryTurnOff = 75,
  // ─── ASSUMED from Tasshack — stuck family ───────────────────────────
  /** Generic "robot is stuck" — no specific subtype. */
  RobotStuck = 80,
  /** Stuck and previous unstuck attempts failed (escalation). */
  RobotStuckRepeat = 81,
  /** Stuck (secondary code seen on newer firmwares). */
  RobotStuck2 = 90,
  /** Stuck under a table / piece of furniture. */
  RobotStuckOnTables = 91,
  /** Stuck in a narrow passage between rooms. */
  RobotStuckOnPassage = 92,
  /** Stuck on a threshold (room divider, door frame). */
  RobotStuckOnThreshold = 93,
  /** Stuck in a low-clearance area the chassis can't lift over. */
  RobotStuckOnLowLyingArea = 94,
  /** Stuck on a ramp / slope. */
  RobotStuckOnRamp = 95,
  /** Stuck on a discrete obstacle (toy, cable, shoe, …). */
  RobotStuckOnObstacle = 96,
  /** Stuck because of a pet (mostly the pet being in the path). */
  RobotStuckOnPet = 97,
  /** Slipping on a hard surface and can't make progress. */
  RobotStuckOnSlipperySurface = 98,
  /** Stuck on a thick / shaggy carpet. */
  RobotStuckOnCarpet = 99,
  /** Stuck on a curtain (entangled). */
  RobotStuckOnCurtain = 200,
  // ─── ASSUMED from Tasshack — bin / dock / dust ─────────────────────
  /** Dust bin is full. */
  BinFull = 101,
  /** Dock disconnected (no comms with base station). */
  StationDisconnected = 117,
  /** Disposable dust bag in the dock is full. */
  DustBagFull = 121,
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
 * VERIFIED on r2449a 2026-05-21 — packed into the **low 2 bits** of
 * `CLEANING_MODE` (siid 4 piid 23) and mirrored cleanly as plain `0..3`
 * on `MOP_PADS_STATE` (siid 2 piid 6). The full `CLEANING_MODE` value is
 * `(CleaningMode | 0x1400)`; mask with `& 0x3` to extract this enum.
 *
 * Consistent with r2532a 2026-05-02 observations after bitfield decode:
 * the `5120 ↔ 5122` transitions are `(0x1400 | Sweeping) ↔ (0x1400 |
 * SweepAndMop)`. See `VACUUM_PROP.CLEANING_MODE` for the trap to avoid
 * when writing the raw bitfield directly.
 */
export enum CleaningMode {
  Sweeping = 0,
  Mopping = 1,
  SweepAndMop = 2,
  MopAfterSweep = 3,
}

/**
 * VERIFIED on r2449a 2026-05-21 — `FEATURE_CONFIG_KEYS.SmartHost` value
 * space. The CleanGenius master toggle is **3-state, not boolean**: in
 * addition to off (`0`) and the standard CleanGenius mode (`1`), there's
 * a "Deep Cleaning" CleanGenius variant (`2`). Matches the Dreamehome
 * app's three-tab CleanGenius UI on the X40 Ultra.
 */
export enum CleanGenius {
  Off = 0,
  Normal = 1,
  Deep = 2,
}

/**
 * VERIFIED on r2449a 2026-05-21 — `DOCK_PROP.CLEAN_GENIUS_SUB_MODE` value
 * space (siid 28 piid 5). Selects the sub-mode within CleanGenius — Vac
 * + Mop (`2`) or Mop after Vac (`3`). CleanGenius does NOT expose Vac-
 * only or Mop-only sub-modes (mirrors the Dreamehome app's UI), so the
 * value space is intentionally a 2-element subset of `CleaningMode`'s
 * `SweepAndMop` and `MopAfterSweep` members.
 */
export enum CleanGeniusSubMode {
  VacAndMop = 2,
  MopAfterVac = 3,
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
