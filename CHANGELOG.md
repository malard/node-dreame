# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial scaffold.
- Dreame native cloud OAuth2 password-grant auth + token refresh.
- Device discovery via `/dreame-user-iot/iotuserbind/device/listV2`.
- HTTP `sendCommand` transport with typed helpers: `getProperties`, `setProperties`, `callAction`. Action dispatch correctly uses object-shaped `params` (Dreame's MIoT action call differs from property calls in this respect — cost us a debugging session).
- MQTT live subscription per device with typed events: `properties` (MIoT siid/piid changes), `props` (untyped k/v on `method:"props"`, used for OTA), `info` (typed `_otc.info` with wifi/network/firmware), `ota` (convenience for ota_state + ota_progress).
- High-level `Vacuum` wrapper: cached typed state, `refresh()`, `watch()`/`unwatch()`, `start/pause/stop/dock/locate/clearWarning/startAutoEmpty` methods, suction/water/cleaningMode/volume setters.
- `MiotState` enum sourced from r2532a's own translated keyDefine v8 (39 values); transitions verified live during an OTA.
- `DreameDeviceOfflineError` for cloud code 80001 (device offline / timeout); `Vacuum.refresh()` updates `state.online: false` instead of throwing.
- `state.ota` field — latest `OtaEvent` snapshot, cleared when OTA settles.
- Verification annotations throughout `miot-spec.ts` — every entry tagged VERIFIED `<date>` or ASSUMED `<source>`.
- Newly-discovered properties: firmware build (siid 1.4), serial (siid 1.5 / 4.14), timezone (siid 8.1), DND config JSON (siid 3.3), feature toggles JSON (siid 4.50, ~36 named toggles), versions JSON (siid 99.31 — fw_ver/mcu_ver/speech_ver), AI models JSON (siid 99.94), cloud-object pointer (siid 6.8).
- Long-running event logger (`examples/log-events.ts`) for capturing raw envelopes + version transitions over time.
- `SCHEDULE_PROP` block (siid 8) — cleaning schedule lives in a single dash-delimited string at piid 2. Format VERIFIED + documented (9 fields including weekday bitmap, recurring flag, room-scope, mop wetness, mode-dependent config block, room list).
- `WASHBOARD_PROP` block — live state during a dock washboard-cleaning cycle. `COUNTDOWN_SECS` (siid 4 piid 61) ticks at 1Hz from the device, so the app's countdown is true device feedback (not a UI estimate).
- `ScheduleRoute` enum — Standard/Intensive/Deep/Quick (bits 0-3 of the Custom-mode packed int).
- `ScheduleCleaningMode` enum — VacOnly/VacAndMop/MopOnly/MopAfterVac (bits 4-6).
- `SCHEDULE_FIELD8` constants — bit-position table for the Custom-mode packed integer (route / mode / suction / cycle count).
- `MiotState.CleanWashboardBase = 30` upgraded from keyDefine-only to direct observation.
- `SuctionLevel` enum names corrected to match the r2532a UI: Quiet/Standard/**Intense**/**Max** (Tasshack's Strong/Turbo were older-model labels for the same numeric values 2/3).
- Second session pass — cleaning-behaviour properties verified: `RESUME_CLEANING` (4.11), `CARPET_BOOST` (4.12), `AI_OBSTACLE_BITFIELD` (4.22, partial decode), `CHILD_LOCK` (4.27), `CARPET_SECONDARY_FLAG` (4.33), `CARPET_HANDLING_MODE` (4.36, 5-value enum), `CLEAN_CARPETS_FIRST` (28.2), `SIDE_BRUSH_ROTATING_ON_CARPET` (28.29), `OBSTACLE_CROSSING_MODE` (28.38), `POWER_SAVING_CLEANING` (28.63).
- Scale Inhibitor consumable added — `SCALE_INHIBITOR_DAYS_LEFT` (31.1), `SCALE_INHIBITOR_LEFT` (31.2). Same shape as SENSOR consumable.
- `SETTINGS_PROP` corrections: `siid 3 piid 3` was wrongly labelled DND — it's actually `OFF_PEAK_CHARGING_CONFIG_JSON`. The real DND config lives at `siid 5 piid 4` as a JSON-string array of windows.
- 7 more `FEATURE_CONFIG_KEYS` upgraded `?` → `✓` from live toggles (CarpetFineClean, RobotCarpetPressEnable, FillinLight, SbrushExtrSwitch, MopExtrSwitch, MonitorPromptLevel, PetPartClean) — 11 of ~36 keys now confirmed.
- New enums: `CarpetHandlingMode`, `ObstacleCrossingMode`, `LiveVideoPrompts`.
- Documented cross-coupling observations (Pet Recognition → Auto-Empty, Carpet Avoid → RobotCarpetPressEnable=-1) and the cloud-only settings set (auto-update, mopping-with-detergent, camera PIN, device rename, Matter PIN).
- Matter support discovered — noted in README + project memory as a future-look option for basic vacuum capabilities (separate from the deep cloud catalogue node-dreame provides).
