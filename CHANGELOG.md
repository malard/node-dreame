# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-05-03

Initial release. Pre-alpha — public API will change. See the README
for the full coverage matrix and which device behaviours are verified
against real hardware versus inherited from upstream sources.

### Features

- **Auth.** Email/password login against the Dreame native cloud, with
  automatic token refresh.
- **Device discovery.** List devices on the account, including shared
  devices.
- **MIoT property reads/writes and action invocations.** Typed helpers
  for `getProperties`, `setProperties`, and `callAction`.
- **MQTT live subscription.** Per-device socket emitting typed events:
  `properties` (siid/piid changes), `props` (k/v pushes including OTA
  state/progress), `info` (network + firmware), and `ota` (convenience
  for combined state/progress).
- **High-level `Vacuum` wrapper.** Cached typed state, `refresh()`,
  `watch()`/`unwatch()`, common commands (`start`, `pause`, `stop`,
  `dock`, `locate`, `clearWarning`, `startAutoEmpty`), and setters for
  suction / water volume / cleaning mode / volume.
- **Live-map decoding.** Pure decoder for the device's binary live-map
  envelope (base64 + zlib), P-frame merge, OSS fetch for the cached
  I-frame, and a `MapManager` state machine that ties the three
  together. Output is `MapData` in raw mm world-frame coordinates so
  the consuming app does the viewport transform.
- **Lazy `vacuum.map` getter.** Auto-constructs and starts a
  `MapManager` bound to the active subscription.
- **`node-dreame/map` sub-export.** Lets consumers import just the
  decoder / merge helpers without the rest of the surface.
- **Property + action catalogue** (`miot-spec.ts`) covering vacuum
  state, battery, consumables, dock settings, OTA, schedules, the
  feature-toggle JSON, and the cloud-object channels. Each entry is
  annotated `VERIFIED` or `ASSUMED` so consumers know what to trust.
- **Device capability records.** `getCapabilities(model)` and
  `vacuum.capabilities` return a typed `DeviceCapabilities` describing
  what the model supports (mop, auto-empty, multi-floor, virtual
  walls, etc.) and which suction / water / carpet / dock-setting
  values it accepts. Curated entries return `verified: true`; unknown
  models fall back to a conservative safe-default.
- **Virtual walls and restricted areas in `MapData`.**
  `MapData.virtualWalls` and `MapData.restrictedAreas` (no-go and
  no-mop zones) decoded from the JSON tail's `vw` block. Coordinates
  in raw mm world-frame.
- **Cleaned-area overlay in `MapData`.** `MapData.cleanedArea`
  decodes the recursive `decmap` blob — a parallel pixel grid with
  cleaned/dirty run-length runs and optional per-segment cleaned-area
  stats. Inner blob has its own dimensions independent of the parent
  map.
- **Vacuum semantic action helpers.** `cleanSegments(ids, opts?)`,
  `cleanZones(zones, opts?)`, `cleanSpot(point, opts?)` for targeted
  cleaning. `goHome()`, `resume()`, `cancelCurrentJob()` as readable
  aliases for `dock`/`start`/`stop`. Defaults pick suction and water
  from cached state.
- **Saved-map list fetch.** `vacuum.fetchSavedMapList()` reads the
  `MAP_LIST` pointer (siid 6 piid 8), fetches the OSS blob, and
  returns the list of stored floors plus the active map id.
- **Lifetime totals.** `vacuum.fetchTotals()` returns
  `{firstCleaningDate, totalCleaningMinutes, cleaningCount,
  totalCleanedAreaSqm}` from the device's cumulative-totals service
  (siid 12).
- **MIoT event-bus parsing.** `DreameSubscription` now emits an
  `'event'` event for every `event_occured` push (Dreame's typo).
  Catches the per-task summary push (`siid 4 eiid 1`) plus generic
  status-changed events.
- **Per-task history records.** `vacuum.on('taskComplete', cb)`
  emits a typed `CleaningHistoryRecord` (`startTime`,
  `cleaningTimeMin`, `cleanedAreaSqm`, `completed`, `logFileName`,
  `cleaningProperties`) decoded from the MIoT event-bus push the
  device fires at end-of-task.
- **Per-task historical maps.** `vacuum.fetchTaskMap(logFileName)`
  fetches the per-task `.bin` from OSS and decodes it into a
  `MapData` with the full cleaning path embedded in `paths`, the
  cleaned/dirty overlay in `cleanedArea`, and the same room layout
  in `layers`/`segments`.
- **Task progress percentage.** `VacuumState.taskProgressPct`
  exposes the device's own 0..100 progress for an active cleaning
  task (siid 4 piid 63), suitable as a progress bar source.
- **Reference web bridges.** `examples/server-sse.ts` (zero-deps SSE)
  and `examples/server-websocket.ts` (bidirectional `ws`) showing how
  to forward `MapData` / `VacuumState` / events to a browser client.
- **Typed errors.** `DreameAuthError`, `DreameApiError`,
  `DreameDeviceOfflineError`, `DreameTransportError`.

### Examples

- `examples/live-map-stream.ts` — minimal end-to-end map streaming.
- `examples/server-sse.ts` — zero-deps SSE bridge for browser clients.
- `examples/server-websocket.ts` — bidirectional WebSocket bridge.
- `examples/log-events.ts` — long-running raw event logger.
- Plus a handful of one-shot probe scripts under `examples/probe-*.ts`.

### Tooling

- ESM + CJS dual build via tsup.
- TypeScript strict, type definitions emitted for both entries.
- Vitest test suite (168 tests).
- ESLint v9 flat config.
