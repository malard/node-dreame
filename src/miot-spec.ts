/**
 * MIoT siid/piid/aiid catalogue for the modern Dreame vacuum series.
 *
 * Each entry is annotated:
 *   VERIFIED <model>  → observed working against that exact device
 *   ASSUMED  <source> → borrowed from another project; not yet confirmed
 *
 * Verifications below were all done against `dreame.vacuum.r2532a`
 * (Dreame X50 Ultra Complete, EU region, firmware 4.3.9_2199) on 2026-05-02.
 *
 * Borrowed entries come from Tasshack/dreame-vacuum (Mi cloud, generic
 * Dreame profile spanning r2228/r2389/r2449). They tend to hold across the
 * generation, but some siid/piid/aiid numbers and especially enum *value*
 * meanings can shift on newer firmware. Don't trust an "ASSUMED" entry as
 * a label; treat the integer as raw until you've seen it move with the
 * device in a known state.
 *
 * **Layout:** the property tables themselves live in per-service files
 * under `./spec/*-props.ts`. This module is a barrel — it re-exports
 * them under their canonical names so existing consumer imports
 * (`import { VACUUM_PROP } from "node-dreame/miot-spec"`) keep working.
 * Add new properties to the appropriate per-service file, not here.
 */

// ─── Property tables (per-service) ───────────────────────────────────
export { DEVICE_PROP, DIAGNOSTIC_PROP } from "./spec/device-props.js";
export { VACUUM_PROP, VACUUM_ACTION } from "./spec/vacuum-props.js";
export { BATTERY_PROP } from "./spec/battery-props.js";
export { SETTINGS_PROP } from "./spec/settings-props.js";
export { SCHEDULE_PROP } from "./spec/schedule-props.js";
export { TOTALS_PROP } from "./spec/totals-props.js";
export { AUTO_EMPTY_PROP } from "./spec/auto-empty-props.js";
export { DOCK_PROP, WASHBOARD_PROP } from "./spec/dock-props.js";
export { CLOUD_OBJ_PROP, MAP_ACTION } from "./spec/map-props.js";
export { CAMERA_PROP } from "./spec/camera-props.js";
export { NOTIFICATION_PROP } from "./spec/notification-props.js";
export { CONSUMABLE_PROP } from "./spec/consumable-props.js";

// ─── Enums + feature-config ──────────────────────────────────────────
export {
  MiotState,
  ChargingStatus,
  MiotError,
  TaskStatus,
  TaskPhase,
  SuctionLevel,
  WaterVolume,
  CleaningMode,
  MopWashTemp,
  MopWashWaterLevel,
  MopDryMode,
  AutoEmptyFrequency,
  CarpetHandlingMode,
  ObstacleCrossingMode,
  LiveVideoPrompts,
  ScheduleRoute,
  ScheduleCleaningMode,
  SCHEDULE_FIELD8,
} from "./spec/enums.js";
export type { DryingTimeHours } from "./spec/enums.js";

export { FEATURE_CONFIG_KEYS } from "./spec/feature-config.js";
export type { FeatureConfigKey, FeatureConfigEntry } from "./spec/feature-config.js";
