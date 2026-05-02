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
  /**
   * ASSUMED Tasshack types.py:576 — water flow level **during active cleaning**
   * (mop on the floor). NOT to be confused with `MOP_WASH_WATER_LEVEL` (siid 4
   * piid 46) which is the dock's wash-cycle water amount.
   */
  WATER_VOLUME: { siid: 4, piid: 5 } as const,
  /** ASSUMED Tasshack types.py:587 — JSON payload for joystick control. Note: live joystick during the camera/remote-control session appears to bypass this and use a side-channel through the Aliyun video session (no MQTT echoes for joystick movement). */
  REMOTE_CONTROL: { siid: 4, piid: 15 } as const,
  /** ASSUMED Tasshack types.py:594 — cleaning mode (sweep/mop/both). VERIFIED returns 5120 on r2532a — clearly a packed bitfield, the simple `CleaningMode` enum below does NOT apply. Decoded form TBD. */
  CLEANING_MODE: { siid: 4, piid: 23 } as const,
  /**
   * VERIFIED on r2532a 2026-05-02 — the **Auto Mop-Washing** boolean
   * (auto-rewashes the mop pad mid-job at intervals).
   * Observed transitions: 1 → 0 → 1 with each app toggle.
   * Tasshack labelled this `SELF_CLEAN`; we keep that name for back-compat
   * but `AUTO_MOP_WASH` is the user-facing label on r2532a.
   */
  SELF_CLEAN: { siid: 4, piid: 34 } as const,
  /**
   * VERIFIED on r2532a 2026-05-02 — Mop-Drying duration in hours, bounded enum.
   * Confirmed values: 2, 3, 4. Other values not selectable in app.
   * Use the `DryingTimeHours` type for type-safe writes.
   */
  DRYING_TIME: { siid: 4, piid: 40 } as const,
  /**
   * VERIFIED on r2532a 2026-05-02 — boolean for "Mop-Washing with Detergent"
   * (whether the dock injects detergent during the mop wash cycle).
   */
  MOP_WASH_DETERGENT_ENABLED: { siid: 4, piid: 37 } as const,
  /**
   * VERIFIED on r2532a 2026-05-02 — Mop-Washing Water Level enum (how much
   * water the dock uses for the wash cycle — NOT the cleaning-time water flow).
   *   0 = Water Saving
   *   1 = Standard
   *   2 = Deep
   * Use the `MopWashWaterLevel` enum.
   */
  MOP_WASH_WATER_LEVEL: { siid: 4, piid: 46 } as const,
  /** VERIFIED on r2532a — appeared synchronously with detergent toggle. Likely detergent dosage units (value 11 observed). */
  DETERGENT_DOSAGE_INT: { siid: 4, piid: 56 } as const,
  /** VERIFIED on r2532a — string-typed twin of DETERGENT_DOSAGE_INT (e.g. "11"). Purpose unclear but co-fires with the int field. */
  DETERGENT_DOSAGE_STR: { siid: 4, piid: 57 } as const,
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
 * Dock service (siid 27 + siid 28 cluster — sister services on r2532a's base station).
 *
 * The dock-side settings (mop-wash temperature, mop-drying mode, hair compression,
 * smart-mode master toggle, mast control) are split across these two siids in a
 * way Tasshack's older mapping doesn't cover. All entries here are VERIFIED by
 * directly toggling them in the Dreamehome app and observing the MQTT echo.
 */
export const DOCK_PROP = {
  /**
   * VERIFIED on r2532a — boolean for the **elevating LiDAR/camera mast**
   * (the X50 Ultra Complete's signature feature — extends ~10cm above the
   * robot body so the LiDAR can see over low obstacles).
   *   1 = mast raised
   *   0 = mast lowered
   */
  MAST_RAISED: { siid: 27, piid: 6 } as const,
  /**
   * VERIFIED on r2532a — derived "heater on" flag.
   * Mirrors `MOP_WASH_TEMP > 0`. When MOP_WASH_TEMP is set to 0 (no heating),
   * this drops to 0 in the same MQTT batch.
   */
  HEATER_ENABLED: { siid: 27, piid: 15 } as const,
  /**
   * VERIFIED on r2532a — Mop-Washing Water Temperature enum (4 values).
   *   0 = Normal (no heating)
   *   1 = Mild
   *   2 = Warm
   *   3 = High Temperature
   * Use the `MopWashTemp` enum.
   */
  MOP_WASH_TEMP: { siid: 28, piid: 8 } as const,
  /**
   * VERIFIED on r2532a — Smart Mop-Washing master toggle.
   * When `1`, the device chooses water level / temperature / frequency
   * automatically; the manual settings get greyed out in the app.
   * Distinct from `SmartAutoWash` in `FEATURE_CONFIG_JSON` — that's a
   * different feature ("Auto Mop-Rewashing" mid-job).
   */
  SMART_MOP_WASH: { siid: 28, piid: 22 } as const,
  /**
   * VERIFIED on r2532a — Mop-Drying Mode boolean.
   *   0 = Standard
   *   1 = Mute (slower, quieter)
   * Duration is independent — see `DRYING_TIME` (siid 4 piid 40).
   */
  MOP_DRY_MODE: { siid: 28, piid: 27 } as const,
  /**
   * VERIFIED on r2532a — Hair Compression boolean (dock compacts collected hair).
   */
  HAIR_COMPRESSION: { siid: 28, piid: 28 } as const,
  /**
   * VERIFIED on r2532a — Robot "in motion" flag. Flips 0→1 when the robot
   * undocks / starts moving and 1→0 when it docks / stops. Useful for cleanly
   * detecting motion start/stop edges without polling status.
   */
  MOTION_FLAG: { siid: 28, piid: 4 } as const,
} as const;

/**
 * Schedules service (siid 8) — recurring cleaning schedules.
 *
 * VERIFIED on r2532a 2026-05-02. The schedule lives in a single dash-delimited
 * string at piid 2; multiple schedules likely live at higher piids (untested).
 *
 * **String format** (9 dash-separated fields):
 *
 * ```
 * <id>-<enabled>-<HH:MM>-<weekdays>-<recurring>-<roomScope>-<wetness>-<config>-<rooms>
 *   1     0/1     22:00   1111111    0/1         0/1          0-32     <int>    <list>
 * ```
 *
 * - `id`         numeric schedule slot id (1 in our tests)
 * - `enabled`    0 = paused, 1 = active
 * - `HH:MM`      24h trigger time
 * - `weekdays`   7-char Mon-Sun bitmap, "1" = run, "0" = skip ("1111111" = daily)
 * - `recurring`  0 = one-shot (runs next matching day, then auto-disables), 1 = repeating
 * - `roomScope`  0 = whole map, 1 = specific rooms
 * - `wetness`    0 in non-Mop modes; 1-32 in Mop modes (16 = Standard default)
 * - `config`     mode-dependent — see below
 * - `rooms`      mode-dependent — see below
 *
 * **Bimodal config encoding:**
 *   - **CleanGenius preset** (`config` is small int 128-255):
 *       low byte = `<bit7 always-on>|<quality bits 4-5: 16=Normal,32=Deep>|<mode bits 0-3: 2=Vac+Mop, 4=MopAfterVac>`
 *       `rooms` = comma-separated list of segment IDs (e.g. `"7,4,2,3"`) or `"0"` for whole map
 *   - **Custom mode (global)** (`config` is large packed int):
 *       see `SCHEDULE_FIELD8` for bit layout (route/mode/suction/cycle-count)
 *       `rooms` = "0"
 *   - **Custom mode (per-room)** (`config` = `0`):
 *       `rooms` = comma-separated list of packed ints, ONE PER ROOM, where each int
 *       embeds both the segment ID and that room's per-room settings.
 *       Per-room packed-int layout NOT YET DECODED (see GitHub issue).
 */
export const SCHEDULE_PROP = {
  /**
   * VERIFIED on r2532a — primary cleaning schedule slot. See block doc for format.
   * Writes are committed atomically on the app's "Save" tap (no per-keystroke push).
   */
  SLOT_1: { siid: 8, piid: 2 } as const,
  /** VERIFIED — IANA timezone string (e.g. "Europe/London"). */
  TIMEZONE: { siid: 8, piid: 1 } as const,
  /**
   * VERIFIED on r2532a — small base64-zlib blob; appears to be a binary
   * companion to the schedule string. Decoded contents TBD.
   */
  SCHEDULE_BLOB: { siid: 8, piid: 5 } as const,
  /**
   * VERIFIED on r2532a — counter that increments by 1 every time a schedule
   * change is committed via the app's Save button. Useful as a simple "schedule
   * was modified" signal without diffing the full string.
   */
  EDIT_COUNTER: { siid: 4, piid: 64 } as const,
} as const;

/**
 * Washboard / dock cleaning service properties (live state during a wash cycle).
 */
export const WASHBOARD_PROP = {
  /**
   * VERIFIED on r2532a — `1`-Hz countdown of seconds remaining in the current
   * washboard cleaning cycle. Pushed once per second via `properties_changed`
   * while the cycle runs. The Dreamehome app's countdown timer is just rendering
   * this property — it's actual device-side feedback, not a UI estimate.
   */
  COUNTDOWN_SECS: { siid: 4, piid: 61 } as const,
  /**
   * VERIFIED on r2532a — the cycle's "current step" indicator (jumped 0 → 27
   * when the cycle started, suggesting an N-of-M progress field).
   */
  STEP: { siid: 4, piid: 7 } as const,
} as const;

/**
 * Auto-Empty service (siid 15) — dust bag / debris evacuation.
 */
export const AUTO_EMPTY_PROP = {
  /**
   * VERIFIED on r2532a — Auto-Empty frequency mode enum (4 values).
   *   0 = Off
   *   1 = Standard
   *   2 = High Frequency
   *   3 = Low Frequency
   * Note the values are arbitrary mode ids, not a numeric "frequency" scale —
   * 2 and 3 are not in expected order. Use the `AutoEmptyFrequency` enum.
   */
  FREQUENCY: { siid: 15, piid: 1 } as const,
  /**
   * VERIFIED on r2532a — boolean asserting when the robot is on the dock
   * and the auto-empty service is ready (1 = docked & idle, 0 = away).
   */
  ON_DOCK_FLAG: { siid: 15, piid: 3 } as const,
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
  /**
   * VERIFIED on r2532a 2026-05-02 — front camera fill-light brightness as
   * a string-typed integer.
   *
   *   "0"–"100"  — manual brightness percentage (perceptually logarithmic
   *                in the app slider — "half way" on the slider reads ~70-76)
   *   "101"      — sentinel meaning auto / off (set when not in manual mode)
   *
   * The slider is roughly square-root scaled (slider position² / 100 ≈ value).
   * (Previous tentative label `STREAM_TASK_ID` was wrong — the value "101"
   * just coincided with stream-start, when the light was in auto mode.)
   */
  FILL_LIGHT_BRIGHTNESS: { siid: 10001, piid: 9 } as const,
  /**
   * VERIFIED on r2532a 2026-05-02 — real-time on-device AI object detection
   * feed, pushed via MQTT at ~10-30 fps while the camera is active.
   * Each push is a JSON-string of:
   *   `{ timestamp: <microseconds>, boxlist: [{type: <classId>, bbox: [x,y,w,h]}, ...] }`
   * Coordinates are normalized 0-1. `type` is an integer class id; class 160
   * appears repeatedly during dock-hunting (likely "obstacle/unknown").
   * The model catalog itself lives at `DIAGNOSTIC_PROP.AI_MODELS_JSON`.
   */
  AI_DETECTION_FEED: { siid: 10001, piid: 112 } as const,
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

// ─── FEATURE_CONFIG_JSON (siid 4 piid 50) keys ────────────────────────

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
 *   ✓ — toggled live and confirmed
 *   ? — guessed from key name only
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
  /** ? "Smart Auto Mop" — multi-mode (-1 observed = Off). Exact options unknown. */
  SmartAutoMop: "SmartAutoMop",
  /** ? Hot wash boolean (separate from `MOP_WASH_TEMP` enum). 1 = on. */
  HotWash: "HotWash",
  /** ? Side-brush extension toggle. */
  SbrushExtrSwitch: "SbrushExtrSwitch",
  /** ? Mop extension toggle (mop arm extends past chassis). */
  MopExtrSwitch: "MopExtrSwitch",
  /** ? Mop fully-scalable toggle (?). */
  MopFullyScalable: "MopFullyScalable",
  /** ? Front fill-light master enable. */
  FillinLight: "FillinLight",
  /** ? AI stain detection. */
  StainIdentify: "StainIdentify",
  /** ? Super-wash mode (intensified). */
  SuperWash: "SuperWash",
  /** ? AI human-follow camera mode. */
  MonitorHumanFollow: "MonitorHumanFollow",
  /** ? Cleaning route algorithm choice. */
  CleanRoute: "CleanRoute",
  /** ? Smart-host AI? */
  SmartHost: "SmartHost",
  /** ? Carpet fine-clean toggle. */
  CarpetFineClean: "CarpetFineClean",
  /** ? Carpet-only cleaning mode. */
  CarpetOnlyClean: "CarpetOnlyClean",
  /** ? Mop effect setting. */
  MopEffectState: "MopEffectState",
  /** ? Mop effect on/off. */
  MopEffectSwitch: "MopEffectSwitch",
  /** ? Material direction clean (follow grain). */
  MaterialDirectionClean: "MaterialDirectionClean",
  /** ? Detergent reminder/notification. */
  DetergentNote: "DetergentNote",
  /** ? Meticulous twist (thorough scrubbing). -7 observed default. */
  MeticulousTwist: "MeticulousTwist",
  /** ? Hardware revision id of the mop. */
  MopScalableVersion: "MopScalableVersion",
  /** ? Mop scalable v2 toggle. */
  MopScalable2: "MopScalable2",
  /** ? Smart-charging mode. */
  SmartCharge: "SmartCharge",
  /** ? Type of dock back-wash. */
  BackWashType: "BackWashType",
  /** ? Mop extension frequency. */
  ExtrFreq: "ExtrFreq",
  /** ? Smart drying mode. */
  SmartDrying: "SmartDrying",
  /** ? Max-suction toggle. */
  SuctionMax: "SuctionMax",
  /** ? "Less collision" — softer obstacle approach. */
  LessColl: "LessColl",
  /** ? Cleaning-type selection. */
  CleanType: "CleanType",
  /** ? Press into carpet for deep clean. */
  RobotCarpetPressEnable: "RobotCarpetPressEnable",
  /** ? "Lacune mop scalable" — meaning unclear. */
  LacuneMopScalable: "LacuneMopScalable",
  /** ? Monitor prompt level (notification verbosity?). */
  MonitorPromptLevel: "MonitorPromptLevel",
  /** ? Pet-area cleaning. */
  PetPartClean: "PetPartClean",
  /** ? Fluctuation confirm result (calibration?). */
  FluctuationConfirmResult: "FluctuationConfirmResult",
  /** ? Fluctuation test result (calibration?). */
  FluctuationTestResult: "FluctuationTestResult",
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
