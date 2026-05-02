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
