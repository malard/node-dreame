/**
 * MIoT siid/piid/aiid catalogue for the modern Dreame vacuum series.
 *
 * Each entry is annotated:
 *   VERIFIED <model>  → observed working against that exact device
 *   ASSUMED  <source> → borrowed from another project; not yet confirmed
 *
 * Verifications below were all done against `dreame.vacuum.r2532a`
 * (Dreame X50 Ultra Complete, EU region, firmware 4.3.9_2033) on 2026-05-02.
 *
 * Borrowed entries come from Tasshack/dreame-vacuum (Mi cloud, generic
 * Dreame profile spanning r2228/r2389/r2449). They tend to hold across the
 * generation, but some siid/piid/aiid numbers and especially enum *value*
 * meanings can shift on newer firmware. Don't trust an "ASSUMED" entry as
 * a label; treat the integer as raw until you've seen it move with the
 * device in a known state.
 */

// ─── Properties ────────────────────────────────────────────────────────

/** Device-info service (siid 1). */
export const DEVICE_PROP = {
  /** Manufacturer. VERIFIED returns "dreame" on r2532a. */
  MANUFACTURER: { siid: 1, piid: 1 } as const,
  /** Model string. VERIFIED returns "dreame.vacuum.r2532a". */
  MODEL: { siid: 1, piid: 2 } as const,
  /** Device id (did). VERIFIED matches DreameDevice.did. */
  DID: { siid: 1, piid: 3 } as const,
  /** Firmware build number string (e.g. "2033", "2199"). VERIFIED transitioned 2033→2199 across an OTA on r2532a. */
  FIRMWARE_BUILD: { siid: 1, piid: 4 } as const,
  /** Serial number. VERIFIED returns the printed serial on r2532a. */
  SERIAL: { siid: 1, piid: 5 } as const,
} as const;

/** Vacuum service properties. */
export const VACUUM_PROP = {
  /** MIoT vacuum-status enum. VERIFIED on r2532a: transitions through 13 (ChargingComplete), 14 (Updating), 2 (Standby), 6 (Charging) observed. */
  STATE: { siid: 2, piid: 1 } as const,
  /** Error/fault code. VERIFIED returns 0 when clear on r2532a. */
  ERROR: { siid: 2, piid: 2 } as const,

  // Everything below is on siid 4. We've VERIFIED that siid 4 piid 1 reads
  // (returned 14 then 6 in different cloud sessions) but we DO NOT have a
  // verified value→meaning mapping for piid 1 on r2532a — only Tasshack's
  // older-model dict, which uses different numbers. Treat as raw int.
  /** ASSUMED Tasshack — Dreame "task status" enum. VERIFIED readable on r2532a, value meanings UNVERIFIED. */
  TASK_STATUS: { siid: 4, piid: 1 } as const,
  /** ASSUMED Tasshack types.py:573 — current job runtime in minutes. */
  CLEANING_TIME: { siid: 4, piid: 2 } as const,
  /** ASSUMED Tasshack types.py:574 — area cleaned in m². */
  CLEANED_AREA: { siid: 4, piid: 3 } as const,
  /** ASSUMED Tasshack types.py:575 — suction level enum (see SuctionLevel). */
  SUCTION_LEVEL: { siid: 4, piid: 4 } as const,
  /** ASSUMED Tasshack types.py:576 — water flow level enum (see WaterVolume). */
  WATER_VOLUME: { siid: 4, piid: 5 } as const,
  /** ASSUMED Tasshack types.py:587 — JSON payload for joystick control. */
  REMOTE_CONTROL: { siid: 4, piid: 15 } as const,
  /** ASSUMED Tasshack types.py:594 — cleaning mode (sweep/mop/both). VERIFIED returns 5120 on r2532a — likely a packed bitfield, NOT the simple enum below. */
  CLEANING_MODE: { siid: 4, piid: 23 } as const,
  /** ASSUMED Tasshack types.py:606 — auto mop-wash mid-job toggle. */
  SELF_CLEAN: { siid: 4, piid: 34 } as const,
  /** ASSUMED Tasshack types.py:612 — drying time enum. */
  DRYING_TIME: { siid: 4, piid: 40 } as const,
  /**
   * VERIFIED on r2532a: returns a JSON string (yes — string-encoded JSON, not native JSON)
   * containing an array of `{k, v}` objects representing the full feature toggle config:
   * AutoDry, FillinLight, StainIdentify, SuperWash, MopExtrSwitch, RobotCarpetPressEnable,
   * SmartAutoMop, LacuneMopScalable, SbrushExtrSwitch, MonitorHumanFollow, MopEffectSwitch,
   * SmartHost, CleanRoute, MopEffectState, MopFullyScalable, PetPartClean, MopScalable2,
   * SmartAutoWash, MaterialDirectionClean, DetergentNote, SmartCharge, CarpetOnlyClean,
   * CarpetFineClean, SuctionMax, UVLight, MonitorPromptLevel, SmartDrying, HotWash,
   * BackWashType, ExtrFreq, MopScalableVersion, MeticulousTwist, FluctuationConfirmResult,
   * FluctuationTestResult, CleanType, LessColl, plus a few more — ~36 keys total.
   */
  FEATURE_CONFIG_JSON: { siid: 4, piid: 50 } as const,
  /** VERIFIED on r2532a: returns the printed serial number (alternative to siid 1 piid 5). */
  SERIAL_ALT: { siid: 4, piid: 14 } as const,
} as const;

/**
 * "Diagnostic" service (siid 99) — undocumented vendor-specific telemetry.
 * Most fields are uninteresting counters but a few carry firmware metadata.
 */
export const DIAGNOSTIC_PROP = {
  /**
   * VERIFIED on r2532a: comma-separated firmware-build line, e.g.
   * `"2025-04-29 16:45:02,4.3.9_2033_release,,"` then post-OTA
   * `"2026-01-20 18:05:37,4.3.9_2199_release,,x50pro-en-001.002.1019.f6598f8-20240920.tar"`.
   */
  FIRMWARE_INFO_LINE: { siid: 99, piid: 17 } as const,
  /**
   * VERIFIED on r2532a: JSON object `{fw_ver, mcu_ver, speech_ver}` — separate
   * version strings for the main firmware, MCU, and voice pack.
   */
  VERSIONS_JSON: { siid: 99, piid: 31 } as const,
  /**
   * VERIFIED on r2532a: JSON `{platform, models[]}` enumerating the on-device AI
   * models (e.g. human v2.0.2, obstacle_instance v4.5.7) and MR527 platform name.
   */
  AI_MODELS_JSON: { siid: 99, piid: 94 } as const,
} as const;

/**
 * Cloud-storage pointer service (siid 6).
 */
export const CLOUD_OBJ_PROP = {
  /**
   * VERIFIED on r2532a: object path string `ali_dreame/<uid>/<did>/<n>`.
   * The integer suffix appears to bump on every new session/stream.
   */
  PATH: { siid: 6, piid: 3 } as const,
  /**
   * VERIFIED on r2532a after OTA: JSON `{obj_name, md5}` pointing at a
   * cloud-stored binary blob — most likely a fresh map snapshot fetched
   * via the Aliyun OSS bucket. Path format: `ali_dreame/<uid>/<did>/<n>`.
   */
  POINTER_JSON: { siid: 6, piid: 8 } as const,
} as const;

/**
 * Camera / video-stream service (siid 10001).
 *
 * VERIFIED on r2532a 2026-05-02 — observed transitions when the user enabled
 * "Remote control" in the Dreamehome app, entered the security PIN, and
 * began streaming the onboard camera.
 *
 * The video stream itself runs over **Aliyun LinkVisual** (Aliyun's IoT
 * video product), not a Dreame-specific protocol — the device's
 * `feature` field reads `"video_ali,fastCommand"` to confirm.
 *
 * The session metadata pushed here contains everything an Aliyun
 * LinkVisual SDK client would need to subscribe to the stream
 * (channelId, session, encryptionKey). The PIN is validated server-side
 * before the session is created — it never appears on this channel.
 */
export const CAMERA_PROP = {
  /**
   * VERIFIED — JSON-string with the active stream session.
   * On idle: `{operType: "end", operation: "monitor", result: 0, status: 0}`.
   * On start: `{token: "alify", channelId: <iotId>, area: "4",
   *            operType: "monitor", operation: "start", session: <sessionId>,
   *            encryptionKey: <hexAesKey>, result: 0, status: 1, df: 1}`.
   */
  STREAM_SESSION_JSON: { siid: 10001, piid: 1 } as const,
  /** VERIFIED — string-typed session/task counter (e.g. "101"). */
  STREAM_TASK_ID: { siid: 10001, piid: 9 } as const,
} as const;

/** Battery service. */
export const BATTERY_PROP = {
  /** VERIFIED returns 100 while docked on r2532a. Standard MIoT battery percentage. */
  LEVEL: { siid: 3, piid: 1 } as const,
  /** VERIFIED returns 1 while charging on r2532a. */
  CHARGING_STATUS: { siid: 3, piid: 2 } as const,
} as const;

/** Settings service. */
export const SETTINGS_PROP = {
  /** ASSUMED Tasshack types.py — DND master toggle. */
  DND: { siid: 5, piid: 1 } as const,
  /**
   * VERIFIED on r2532a: returns a JSON-string with full DND config, e.g.
   * `{"enable":false,"startTime":"22:00","endTime":"08:00"}`. Differs from
   * the boolean-only `DND` above.
   */
  DND_CONFIG_JSON: { siid: 3, piid: 3 } as const,
  /** ASSUMED Tasshack types.py:642 — voice volume 0-100. VERIFIED returned 90 on r2532a (plausible). */
  VOLUME: { siid: 7, piid: 1 } as const,
  /** VERIFIED on r2532a: returns "Europe/London" — IANA timezone string. */
  TIMEZONE: { siid: 8, piid: 1 } as const,
} as const;

/**
 * Consumables.
 *
 * **Unit convention varies by consumable** — Dreame doesn't keep the same
 * piid layout across services. Numbers below are the conventions verified
 * on r2532a (X50 Ultra Complete) firmware 4.3.9_2199:
 *
 * |           | piid 1       | piid 2       | piid 3 |
 * |-----------|--------------|--------------|--------|
 * | brush 9   | hours-left   | **% left**   | flag=1 |
 * | brush 10  | hours-left   | **% left**   | flag=1 |
 * | filter 11 | **% left**   | hours-left   | flag=1 |
 * | sensor 16 | hours-left   | **days-left** | flag=1 |
 *
 * Whichever counter hits zero first triggers the in-app maintenance
 * notification. Reset action for each is at `siid <X> aiid 1`.
 */
export const CONSUMABLE_PROP = {
  /** VERIFIED on r2532a — hours of operation remaining before next service. */
  MAIN_BRUSH_TIME_LEFT: { siid: 9, piid: 1 } as const,
  /** VERIFIED on r2532a — % of life remaining (returned 65 in field). */
  MAIN_BRUSH_LEFT: { siid: 9, piid: 2 } as const,
  /** VERIFIED on r2532a — hours of operation remaining. */
  SIDE_BRUSH_TIME_LEFT: { siid: 10, piid: 1 } as const,
  /** VERIFIED on r2532a — % of life remaining (returned 48 in field). */
  SIDE_BRUSH_LEFT: { siid: 10, piid: 2 } as const,
  /** VERIFIED on r2532a — % of life remaining (returned 30 in field). NOTE convention is reversed from brush. */
  FILTER_LEFT: { siid: 11, piid: 1 } as const,
  /** VERIFIED on r2532a — hours of operation remaining (returned 46 in field). */
  FILTER_TIME_LEFT: { siid: 11, piid: 2 } as const,
  /** VERIFIED on r2532a 2026-05-02 — hours of cleaning operation remaining. After in-app reset: jumped from 0 → 100. */
  SENSOR_HOURS_LEFT: { siid: 16, piid: 1 } as const,
  /** VERIFIED on r2532a 2026-05-02 — DAYS remaining (NOT %). After in-app reset: jumped from 0 → 30. Triggers a "Clean sensors" notification when either this or piid 1 hits 0. */
  SENSOR_DAYS_LEFT: { siid: 16, piid: 2 } as const,
} as const;

// ─── Actions ───────────────────────────────────────────────────────────

/**
 * Note: action calls require a single-object `params` field, not an array.
 * Dispatch is handled by `commands.ts:callAction` which builds the right shape.
 */
export const VACUUM_ACTION = {
  /** ASSUMED Tasshack — start cleaning. NOT YET VERIFIED on r2532a (would actually run the robot). */
  START: { siid: 2, aiid: 1 } as const,
  /** ASSUMED Tasshack — pause. NOT YET VERIFIED on r2532a. */
  PAUSE: { siid: 2, aiid: 2 } as const,
  /** ASSUMED Tasshack — return to dock. NOT YET VERIFIED on r2532a. */
  CHARGE: { siid: 3, aiid: 1 } as const,
  /** ASSUMED Tasshack — start zone/segment clean (needs `in` payload). NOT YET VERIFIED on r2532a. */
  START_CUSTOM: { siid: 4, aiid: 1 } as const,
  /** ASSUMED Tasshack — stop. NOT YET VERIFIED on r2532a. */
  STOP: { siid: 4, aiid: 2 } as const,
  /** VERIFIED 2026-05-02 on r2532a — returned code 0. */
  CLEAR_WARNING: { siid: 4, aiid: 3 } as const,
  /** ASSUMED Tasshack — start dock mop wash. NOT YET VERIFIED on r2532a. */
  START_WASHING: { siid: 4, aiid: 4 } as const,
  /** VERIFIED 2026-05-02 on r2532a — robot beeped, returned code 0. */
  LOCATE: { siid: 7, aiid: 1 } as const,
  /** VERIFIED 2026-05-02 on r2532a — robot played sound, returned code 0. */
  TEST_SOUND: { siid: 7, aiid: 2 } as const,
  /** ASSUMED Tasshack — manual auto-empty trigger. NOT YET VERIFIED on r2532a. */
  START_AUTO_EMPTY: { siid: 15, aiid: 1 } as const,
  /** ASSUMED Tasshack — reset main brush life. NOT YET VERIFIED on r2532a. */
  RESET_MAIN_BRUSH: { siid: 9, aiid: 1 } as const,
  /** ASSUMED Tasshack. */
  RESET_SIDE_BRUSH: { siid: 10, aiid: 1 } as const,
  /** ASSUMED Tasshack. */
  RESET_FILTER: { siid: 11, aiid: 1 } as const,
  /** ASSUMED Tasshack. */
  RESET_SENSOR: { siid: 16, aiid: 1 } as const,
  /** ASSUMED Tasshack. */
  RESET_SECONDARY_FILTER: { siid: 17, aiid: 1 } as const,
  /** ASSUMED Tasshack. */
  RESET_MOP_PAD: { siid: 18, aiid: 1 } as const,
  /** ASSUMED Tasshack. */
  RESET_SILVER_ION: { siid: 19, aiid: 1 } as const,
  /** ASSUMED Tasshack. */
  RESET_DETERGENT: { siid: 20, aiid: 1 } as const,
} as const;

// ─── Enums ─────────────────────────────────────────────────────────────

/**
 * VERIFIED enum for **siid 2 piid 1 (MIoT STATE)** on r2532a.
 *
 * Sourced from the device's own `keyDefine v8` JSON (translated UI strings),
 * fetched from `oss.iot.dreame.tech` on 2026-05-02. All 39 documented values
 * present below; some sparse gaps (31-32, 34-96, 100) are not defined by the
 * device file and so absent here.
 *
 * Live observations on r2532a (2026-05-02 OTA cycle):
 *   13 → 14 (start of OTA install)  → "Updating"
 *   14 → 2  (post-reboot, briefly)  → "Standby"
 *   2  → 13 (settled back on dock)  → "ChargingComplete"
 *   13 → 6  (subsequent re-charge from charge port)  → "Charging"
 *
 * **Do NOT use this enum for siid 4 piid 1** (`TASK_STATUS`) — different
 * property, different value space, no verified mapping yet.
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
 * ASSUMED Tasshack mapping for siid 3 piid 2.
 * VERIFIED on r2532a we observed value `1` while charging — consistent.
 * Other values not yet observed; treat with caution.
 */
export enum ChargingStatus {
  NotCharging = 0,
  Charging = 1,
  ChargedComplete = 2,
  ChargingError = 5,
}

/** ASSUMED Tasshack — siid 4 piid 4 enum. NOT YET observed on r2532a. */
export enum SuctionLevel {
  Quiet = 0,
  Standard = 1,
  Strong = 2,
  Turbo = 3,
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
