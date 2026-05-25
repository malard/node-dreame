/**
 * `FEATURE_CONFIG_JSON` (siid 4 piid 50) keys + parsed entry shape.
 *
 * Extracted from `miot-spec.ts`. The feature-config payload is a single
 * MIoT property with a JSON-string body containing tens of `{k, v}` pairs
 * — large enough to deserve its own module. `miot-spec.ts` re-exports the
 * names so existing imports keep working.
 */

/**
 * Known keys inside the JSON-string at `VACUUM_PROP.FEATURE_CONFIG_JSON`.
 *
 * This single property mirrors a large section of the Dreamehome settings
 * menu as a JSON-string `[{k: <name>, v: <int>}, ...]` array. Writing back
 * requires reconstructing the full array (no per-key sub-protocol).
 *
 * **Universal "off" sentinel:** Dreame uses `-1` (NOT `0`) as the disabled
 * value for multi-mode keys (`SmartAutoWash`, `SmartAutoMop`, `MeticulousTwist`).
 * Plain on/off booleans use `0`/`1`.
 *
 * Verification status notes:
 *   ✓ — toggled live on r2532a and confirmed
 *   ~ — friendly name imported from Tasshack/dreame-vacuum's
 *       `DreameVacuumAutoSwitchProperty` enum (older-model context); not yet
 *       toggle-verified on r2532a, so the label is plausible but not proven.
 *   ? — guessed from key name only (no Tasshack mapping either)
 */
export const FEATURE_CONFIG_KEYS = {
  /** ✓ Auto Mop-Drying — boolean (0/1). */
  AutoDry: "AutoDry",
  /** ✓ UV Sterilization — boolean (0/1). */
  UVLight: "UVLight",
  /**
   * ✓ Auto Mop-Rewashing mode (during a job, distinct from the dock wash cycle).
   *   -1 = Off
   *    1 = Works only in CleanGenius-Deep Cleaning mode
   *    2 = Works in CleanGenius
   */
  SmartAutoWash: "SmartAutoWash",
  /** ✓ Intensive Carpet Cleaning — boolean. JSON-only (no dedicated siid:piid). */
  CarpetFineClean: "CarpetFineClean",
  /**
   * ✓ Carpet Boost — 3-state with the `-1` blocked-sentinel pattern.
   *    1 = enabled
   *    0 = user-disabled
   *   -1 = blocked entirely (when CARPET_HANDLING_MODE = Avoid)
   * Has a paired siid:piid at `VACUUM_PROP.CARPET_BOOST` (siid 4 piid 12).
   */
  RobotCarpetPressEnable: "RobotCarpetPressEnable",
  /** ✓ Master Fill Light enable for the front camera (separate from the manual brightness slider at `CAMERA_PROP.FILL_LIGHT_BRIGHTNESS`). */
  FillinLight: "FillinLight",
  /** ✓ AI-driven SideReach (side brush extension/reach). Boolean. */
  SbrushExtrSwitch: "SbrushExtrSwitch",
  /** ✓ AI-driven MopExtend (mop arm extension/reach). Boolean. */
  MopExtrSwitch: "MopExtrSwitch",
  /**
   * ✓ Live Video Prompts (3-value enum). See `LiveVideoPrompts`:
   *   0 = Weak, 1 = Strong, 2 = Quiet.
   */
  MonitorPromptLevel: "MonitorPromptLevel",
  /** ✓ Pet Recognition — mirrors bit 4 of `VACUUM_PROP.AI_OBSTACLE_BITFIELD`. */
  PetPartClean: "PetPartClean",
  /** ~ Auto-Recleaning (Tasshack: AUTO_RECLEANING). Multi-mode with -1 = Off (observed); other values not enumerated. */
  SmartAutoMop: "SmartAutoMop",
  /** ~ Hot Washing (Tasshack: HOT_WASHING). Boolean; separate from the `MOP_WASH_TEMP` enum which selects the heat level. */
  HotWash: "HotWash",
  /** ? Mop fully-scalable toggle. No Tasshack mapping. */
  MopFullyScalable: "MopFullyScalable",
  /** ~ Stain Avoidance (Tasshack: STAIN_AVOIDANCE). AI stain detection. */
  StainIdentify: "StainIdentify",
  /** ~ Ultra-Clean Mode (Tasshack: ULTRA_CLEAN_MODE). Intensified wash cycle. */
  SuperWash: "SuperWash",
  /** ~ Human Follow camera mode (Tasshack: HUMAN_FOLLOW). */
  MonitorHumanFollow: "MonitorHumanFollow",
  /**
   * ✓ Cleaning Route algorithm (Custom mode). VERIFIED on r2449a 2026-05-21
   * by toggling each option in the Dreamehome app and observing the
   * FEATURE_CONFIG_JSON echo. Values: `1=Standard, 2=Intensive, 3=Deep,
   * 4=Quick` — same value space as the `ScheduleRoute` enum used in the
   * Custom-mode schedule packed-int. Available routes depend on the
   * active cleaning mode (Deep is only valid in Mop-only mode).
   */
  CleanRoute: "CleanRoute",
  /**
   * ✓ CleanGenius master toggle. VERIFIED on r2449a 2026-05-21 — **3-state,
   * not boolean**: `0=Off, 1=Normal, 2=Deep`. Pairs with the in-schedule
   * CleanGenius preset bits. The third "Deep" state was not present in
   * the original Tasshack mapping; see the `CleanGenius` enum.
   */
  SmartHost: "SmartHost",
  /** ? Carpet-only cleaning mode. No Tasshack mapping. */
  CarpetOnlyClean: "CarpetOnlyClean",
  /** ~ Mopping Mode (Tasshack: MOPPING_MODE). Companion to MopEffectSwitch. */
  MopEffectState: "MopEffectState",
  /** ~ Custom Mopping Mode (Tasshack: CUSTOM_MOPPING_MODE). Toggle for an alternative mop-effect profile. */
  MopEffectSwitch: "MopEffectSwitch",
  /** ~ Floor Direction Cleaning (Tasshack: FLOOR_DIRECTION_CLEANING). Aligns mop/sweep direction with floor grain. */
  MaterialDirectionClean: "MaterialDirectionClean",
  /** ? Detergent reminder/notification. No Tasshack mapping. */
  DetergentNote: "DetergentNote",
  /** ~ Wider Corner Coverage (Tasshack: WIDER_CORNER_COVERAGE). Default `-7` observed. */
  MeticulousTwist: "MeticulousTwist",
  /** ? Mop scalable hardware revision id. No Tasshack mapping. */
  MopScalableVersion: "MopScalableVersion",
  /** ~ Mopping Under Furnitures (Tasshack: MOPPING_UNDER_FURNITURES). */
  MopScalable2: "MopScalable2",
  /** ~ Auto-Charging (Tasshack: AUTO_CHARGING). Smart charging mode. */
  SmartCharge: "SmartCharge",
  /** ~ Self-Clean Frequency (Tasshack: SELF_CLEAN_FREQUENCY). How often the dock back-washes the mop. */
  BackWashType: "BackWashType",
  /** ~ Mop Extend Frequency (Tasshack: MOP_EXTEND_FREQUENCY). How often the mop arm extends. */
  ExtrFreq: "ExtrFreq",
  /** ~ Smart Drying mode (Tasshack: SMART_DRYING). */
  SmartDrying: "SmartDrying",
  /**
   * ✓ Max Suction Power toggle. VERIFIED on r2449a 2026-05-25 by
   * toggling each direction in the Dreamehome app and observing
   * `FEATURE_CONFIG_JSON` deltas. Boolean (`0 = off`, `1 = on`); writes
   * accepted in both `Sweeping` and `MopAfterSweep` sub-modes (the two
   * sub-modes the app surfaces the toggle in — any mode with a pure-
   * vacuum phase). Tasshack name: `MAX_SUCTION_POWER`.
   */
  SuctionMax: "SuctionMax",
  /** ~ Collision Avoidance (Tasshack: COLLISION_AVOIDANCE). Softer obstacle approach. */
  LessColl: "LessColl",
  /** ~ Mopping Type (Tasshack: MOPPING_TYPE). See `DreameVacuumMoppingType` upstream — likely Daily/Accurate/Deep on older models. */
  CleanType: "CleanType",
  /** ~ Gap Cleaning Extension (Tasshack: GAP_CLEANING_EXTENSION). Mop reaches into low-clearance gaps. */
  LacuneMopScalable: "LacuneMopScalable",
  /** ~ Drainage Confirm Result (Tasshack: DRAINAGE_CONFIRM_RESULT). Output of the dock's drainage calibration. */
  FluctuationConfirmResult: "FluctuationConfirmResult",
  /** ~ Drainage Test Result (Tasshack: DRAINAGE_TEST_RESULT). Output of the dock's drainage test. */
  FluctuationTestResult: "FluctuationTestResult",
  /** ~ Intelligent Stain Cleaning (Tasshack: INTELLIGENT_STAIN_CLEANING). Not yet observed in r2532a's FEATURE_CONFIG payload — added for completeness from Tasshack's enum. */
  HeavyStainSmart: "HeavyStainSmart",
} as const;

export type FeatureConfigKey = keyof typeof FEATURE_CONFIG_KEYS;

/**
 * Parsed shape of `VACUUM_PROP.FEATURE_CONFIG_JSON` after JSON.parse.
 * Always an array of `{k, v}` entries — order changes between writes.
 */
export interface FeatureConfigEntry {
  k: string;
  v: number;
}
