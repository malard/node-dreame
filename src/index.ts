export { DreameClient } from "./client.js";
export {
  DreameAuthError,
  DreameApiError,
  DreameDeviceOfflineError,
  DreameTransportError,
} from "./errors.js";
export type {
  DreameClientOptions,
  DreameRegion,
  DreameDevice,
  DreameSession,
} from "./types.js";
export type {
  MiotProp,
  MiotAction,
  PropertyWrite,
  PropertyResult,
} from "./commands.js";
export { DreameSubscription } from "./mqtt.js";
export type {
  PropertyChange,
  PropsPush,
  InfoPush,
  OtaEvent,
  EventOccuredPush,
  RawMqttEvent,
} from "./mqtt.js";
export { Vacuum } from "./vacuum.js";
export type { VacuumState, DeviceTotals, CleanOpts } from "./vacuum.js";
export {
  MiotState,
  ChargingStatus,
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
  DEVICE_PROP,
  VACUUM_PROP,
  VACUUM_ACTION,
  BATTERY_PROP,
  SETTINGS_PROP,
  CONSUMABLE_PROP,
  DIAGNOSTIC_PROP,
  CLOUD_OBJ_PROP,
  CAMERA_PROP,
  DOCK_PROP,
  AUTO_EMPTY_PROP,
  TOTALS_PROP,
  SCHEDULE_PROP,
  WASHBOARD_PROP,
  SCHEDULE_FIELD8,
  FEATURE_CONFIG_KEYS,
} from "./miot-spec.js";
export type {
  DryingTimeHours,
  FeatureConfigKey,
  FeatureConfigEntry,
} from "./miot-spec.js";
export {
  getCapabilities,
  MODEL_CAPABILITIES,
} from "./capabilities.js";
export type { DeviceCapabilities } from "./capabilities.js";
