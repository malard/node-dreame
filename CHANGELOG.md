# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] - 2026-06-24

### Added

- **Navigation / routing `MiotError` codes** — `Route2 = 62`, `Route = 61`,
  `NoGoZone = 59`, `Ultrasonic = 58`, `Blocked = 47`, `Blocked2 = 63`,
  `Blocked3 = 64`, `Restricted = 65`, with matching kebab abort reasons
  (`route-2`, `route`, …). Code 62 was OBSERVED firing on r2532a — the
  integer is confirmed on our firmware, the meaning is borrowed from
  Tasshack's `ROUTE_2` (a path-planning fault) as a hint. Previously
  these surfaced as the opaque `error-<n>` placeholder.
- **Sensor and scale-inhibitor consumable counters in `Vacuum.state`** —
  `sensorHoursLeft` / `sensorDaysLeft` (siid 16) and
  `scaleInhibitorDaysLeft` / `scaleInhibitorLeftPct` (siid 31) are now
  reduced into state and included in the `refresh()` poll batch. This
  gives consumers a path to the in-app "clean the sensors" maintenance
  warning (fired when either sensor counter hits 0), which previously had
  no representation in library state. Note the unit split: sensor piid 1
  is hours-left, piid 2 is days-left (not a percentage).

## [0.4.2] - 2026-05-24

### Breaking

- **`VACUUM_PROP.MOP_PADS_STATE` renamed to `VACUUM_PROP.CLEAN_MODE_SETTING`.**
  The old name described a hypothesis (mop-pad availability flag) that
  the r2449a verification disproved — the field is the writable
  `CleaningMode` enum surface, not a pad-availability signal. The
  siid/piid (`2`/`6`) is unchanged. Callers using
  `VACUUM_PROP.MOP_PADS_STATE` must update the property name.

### Added

- **`dreame.vacuum.r2449a` (Dreame X40 Ultra Complete) entry in
  `MODEL_CAPABILITIES`.** Same dock-side feature set as r2532a (heated
  mop wash, mop drying, hair compression, detergent reservoir,
  obstacle-crossing chassis), `verified: true`. Verified against
  firmware FU174072 (EU region) on 2026-05-21 — auth, transport, MQTT,
  OSS map fetch, and the catalogue subset used by the sobreda
  integration all work unchanged against the X40.
- **`DOCK_PROP.CLEAN_GENIUS_SUB_MODE` at `siid 28 piid 5`.** Selects
  the CleanGenius sub-mode (Vac + Mop vs Mop after Vac). Undocumented
  in Tasshack/dreame-vacuum's enum. VERIFIED on r2449a 2026-05-21.
- **`CleanGenius` enum (`Off=0`, `Normal=1`, `Deep=2`).** Value space
  of `FEATURE_CONFIG_KEYS.SmartHost`. The CleanGenius master is
  **3-state, not boolean** — the third state ("Deep Cleaning"
  CleanGenius variant) was not present in the original Tasshack
  mapping.
- **`CleanGeniusSubMode` enum (`VacAndMop=2`, `MopAfterVac=3`).**
  Value space of `DOCK_PROP.CLEAN_GENIUS_SUB_MODE`. CleanGenius does
  NOT expose Vac-only or Mop-only sub-modes — the enum is
  intentionally a 2-element subset of `CleaningMode`.

### Changed

- **`VACUUM_PROP.CLEANING_MODE` (`siid 4 piid 23`) bitfield decoded.**
  The "known to be a packed bitfield on r2532a, not decoded" entry is
  now fully decoded: `value & 0x3` is the `CleaningMode` enum
  (`Sweeping` / `Mopping` / `SweepAndMop` / `MopAfterSweep`); `value
  & 0x1400` is the always-on capability mask (bits 10 + 12, constant
  on every observation across r2532a and r2449a). The r2532a `5120 ↔
  5122` transitions decode as `Sweeping ↔ SweepAndMop` clean-mode
  toggles — i.e. the user (or app) switching between Vac-only and Vac
  + Mop, which co-fires with the dock's mop-install / remove sequence.
  The earlier "bit 1 = mop pads physically attached" reading is bit-
  pattern-compatible but the better mental model is "low 2 bits =
  clean-mode enum"; the mop-attachment correlation falls out of which
  modes need pads.
- **`VACUUM_PROP.CLEAN_MODE_SETTING` (`siid 2 piid 6`) JSDoc rewritten.**
  Verified on r2449a 2026-05-21 as the canonical write path for the
  `CleaningMode` enum (plain `0..3`, no `0x1400` capability mask).
  Writing directly to `CLEANING_MODE` and dropping the `0x1400` bits
  silently bricks the next clean on r2449a — `CLEAN_MODE_SETTING`
  avoids the trap. The field is the clean-mode setting, not an
  independent pad-availability flag; see the rename note above.
- **`CleaningMode` enum promoted from `ASSUMED` to `VERIFIED`** on
  r2449a (and consistent with r2532a after bitfield decode). Applies
  to the low 2 bits of `CLEANING_MODE` and the full value of
  `CLEAN_MODE_SETTING`.
- **`FEATURE_CONFIG_KEYS.CleanRoute` promoted from `~` to `✓`.**
  Verified on r2449a 2026-05-21 by toggling each option in the
  Dreamehome app. Values: `1=Standard, 2=Intensive, 3=Deep,
  4=Quick` — same value space as the existing `ScheduleRoute` enum
  used in the Custom-mode schedule packed-int.
- **`FEATURE_CONFIG_KEYS.SmartHost` promoted from `~` to `✓`.**
  Verified on r2449a 2026-05-21. **3-state, not boolean** — values
  `0=Off, 1=Normal, 2=Deep`. Use the new `CleanGenius` enum.
- **README "Tested model" badge** updated to list both r2532a (X50
  Ultra Complete) and r2449a (X40 Ultra Complete). README "Supported
  devices" section explains what's shared between the two models.

## [0.4.1] - 2026-05-17

### Added

- `MiotError.MopPadsMissing = 120` — the action-refusal "Mop not in
  place" code fired when `start()` is called with mop pads not seated
  on the robot. Distinct from `ManualMopInstallRequired = 74` (the
  end-of-task auto-install-failed code). `taskLifecycle.aborted`
  payloads surface this as `reason: "mop-pads-missing"`.
- `state.lastStateUpdateAt: Date | null` — wall-clock timestamp of the
  most-recent property batch that moved a field. Lets consumers detect
  staleness without inferring it from `null` fields. Stamped by MQTT
  property pushes, `refresh()`, `refreshFromCloud()`, OTA events, map-
  info pushes, and online-flag flips.

### Changed

- `state.faults` now always includes a non-zero `errorCode` even when
  `FAULTS_STR` (siid 4 piid 18) is silent. Fixes the case where
  action-refusal codes (e.g. `MopPadsMissing = 120`) pushed only on
  `ERROR` and left `state.faults` empty for the full latched window.
- JSDoc on `VACUUM_PROP.ERROR` un-staled: now lists the 9 verified
  codes (0/1/18/68/74/105/107/114/120) instead of the old 6, and flags
  `TaskComplete = 68` as the benign end-of-task code to filter out of
  any "needs attention" UX.

## [0.4.0] - 2026-05-17

### Added

- New `stuck` and `unstuck` events on `Vacuum`, driven by the device's
  own "needs attention" flag at `siid 14 piid 4`
  (`NOTIFICATION_PROP.STUCK_NOTIFICATION_ACTIVE`). The flag is sticky
  for the lifetime of the stuck condition; consumers get an edge-
  triggered event plus a `state.stuck` boolean for UI bindings. Payload
  carries the current `errorCode`, `faults` snapshot, and `miotState`
  so a downstream handler can disambiguate post-task tank prompts from
  genuine multi-hour stuck events.
- New `batteryLifecycle` event with debounced threshold crossings:
  `low` (≤ 20% while not charging), `critical` (≤ 10% while not
  charging), `depleted` (battery 0 OR device went offline while
  battery was already critical — the closest signal we can give to
  "robot ran out of charge mid-job"), and `recovered` (battery
  climbed back above 25%). Re-arms after `recovered` so subsequent
  drops fire again. The `depleted`-on-disconnect path covers the
  exact incident class where the device strands itself, deep-
  discharges, and recovers silently with no fault history retained.
- New `state.faults: readonly number[]` — the **full set of currently-
  latched fault codes**, parsed from the multi-value `FAULTS_STR`
  mirror at `siid 4 piid 18`. The single-value `errorCode` (siid 2
  piid 2) only ever holds one code; when several conditions are
  latched at once (e.g. robot lifted AND clean-water tank empty) the
  device packs them comma-separated into `FAULTS_STR`. Cross-
  reference Tasshack/dreame-vacuum `device.py:1342-1372` on dev.
- `taskLifecycle.aborted` payloads now carry the `faults` array
  alongside the single `errorCode`, plus an optional `inferred`
  discriminator:
    - `"initial-state"` — fired when the subscription joins a device
      that's already latched in an error state (closes the gap where
      mid-incident subscribers never heard about the incident).
    - `"mqtt-disconnect"` — fired with `reason: "disappeared"` when
      the connection drops while a task was actively running.
- New `Vacuum.refreshFromCloud()` — refreshes `state.battery` /
  `state.miotState` / `state.online` from the cloud device-list HTTP
  endpoint, which serves cached telemetry reliably even when
  `getProperties` is 80001-spinning. Returns the parsed
  `DreameCloudState` snapshot ( `latestStatus`, `battery`,
  `videoActive`, `featureCode2`). The fallback path of choice when
  the live MIoT channel is silent.
- `DreameDevice` now surfaces `firmwareVersion`, `serialNumber`, and
  `cloudState` as typed top-level fields (previously hidden inside
  `device.raw`).
- `state.stuck`, `state.dryingProgressMin`, `state.relocationStatusRaw`,
  `state.activeMapId`, `state.savedMapIds` — first-class state fields
  for signals we previously surfaced only at the property-catalogue
  level. `activeMapId` is derived from the `_sync.update_vacuum_mapinfo`
  push's per-map token (`[5,10]`-style for active, `[0]` for stored).
- Expanded `MiotError` enum with the Tasshack/dreame-vacuum
  `DreameVacuumErrorCode` codes most relevant to consumer alerting:
  `BatteryLow` (20), `ChargeFault` (21), `BatteryPercentageAnomaly`
  (22), `ChargeNoElectric` (28), `BatteryFault` (29),
  `LowBatteryTurnOff` (75), `RobotStuck` (80), `RobotStuckRepeat` (81),
  `RobotStuck2` (90), the `RobotStuckOnTables`/`Passage`/`Threshold`/
  `LowLyingArea`/`Ramp`/`Obstacle`/`Pet`/`SlipperySurface`/`Carpet`
  family (91-99), `RobotStuckOnCurtain` (200), `BinFull` (101),
  `StationDisconnected` (117), `DustBagFull` (121). VERIFIED entries
  unchanged; new entries flagged ASSUMED in the JSDoc.
- `MiotError`, `TaskStatus`, `TaskPhase`, and `NOTIFICATION_PROP` are
  now re-exported from the top-level `node-dreame` entry; previously
  consumers had to import them from the deep `./miot-spec` path.

### Changed

- **Property rename:** `VACUUM_PROP.TASK_RESET_COUNTER` (siid 4 piid 64)
  → `VACUUM_PROP.DRYING_PROGRESS`. Tasshack's `DRYING_PROGRESS` label
  matches the observed behaviour (resets at end-of-task, ticks once
  per minute through the dock's drying cycle) exactly. The new
  `state.dryingProgressMin` surfaces it as minutes-elapsed.
- **Property rename:** `VACUUM_PROP.ERROR_STR_MIRROR` (siid 4 piid 18)
  → `VACUUM_PROP.FAULTS_STR`. The field is a comma-separated fault
  list, not a single-value mirror; on r2532a we'd only observed it
  carrying single codes (which still works), but the rename reflects
  the actual multi-value semantics.

## [0.3.0] - 2026-05-12

### Added

- New `taskLifecycle` event on `Vacuum` — a single typed envelope
  covering the three transitions a notification consumer typically
  wires up: `started` (TASK_STATUS reaches the active-running state
  from a known non-running value), `completed` (carrying the same
  parsed `CleaningHistoryRecord` as the existing `taskComplete`
  event), and `aborted` (errorCode flips 0 → non-zero, excluding the
  benign end-of-task code 68). `aborted` payloads include a
  kebab-case `reason` derived from the `MiotError` catalogue
  (`clean-water-tank-empty`, `wastewater-tank-full`,
  `robot-lifted`, etc.) and fall back to `error-<n>` for codes that
  haven't been catalogued yet. Initial null → known transitions are
  suppressed so subscribing to a device that's already mid-task
  doesn't fire a phantom `started`. Closes the consumer-facing gap
  for dunbar-os-style "robot needs you" push notifications.
- `MiotError.CleanWaterTankEmpty = 107` and
  `MiotError.WastewaterTankFull = 105`. Verified live on r2532a
  2026-05-12 by firing `vacuum.start()` with each tank in the
  refusal state — error latched on the attempt, cleared on the
  physical condition resolving or on `vacuum.stop()`. Reuse via
  `vacuum.state.errorCode === MiotError.CleanWaterTankEmpty` or via
  `taskLifecycle`'s typed `reason`.

## [0.2.0] - 2026-05-07

Live map decoding closes its biggest consumer-visible gap: the
`vw` / `vws` / `walls_info` / `sneak_areas` blocks the device emits
on every saved-map blob now surface on `MapData`, and the recursive
`tail.rism` saved-map embedding is decoded so the geometry comes
through on live I-frames too. Plus an offline-tolerant map fetch path
for idle / sleeping devices and a path-decoder bug fix.

### Behavioural changes

- **`MapData.virtualWalls` / `MapData.restrictedAreas` now populate
  on live I-frames.** Previously they were always empty arrays on
  the live channel: the device embeds the persistent saved-map blob
  inside `tail.rism` (a base64 envelope of the same shape as the
  outer frame), and the decoder didn't recurse into it.
  `MapDecoder.decode` now decodes `tail.rism` when the outer tail's
  geometry block is empty and merges the inner geometry onto the
  outer `MapData`. Consumers that worked around this by deeply
  decoding `tail.rism` themselves can drop the workaround. Outer
  geometry wins when both are populated.
- **`MapData.paths[].points` are now absolute world-frame mm for
  `line`-type runs.** Previously emitted as the device's literal
  on-wire values, which for `L`/`l` (line) ops are RELATIVE deltas
  to the preceding sweep / sweep-and-mop / mop waypoint — so a
  populated `tr` rendered as a tight artifact clustered around the
  world origin. The parser now accumulates each delta against the
  running anchor and seeds new line segments with the anchor itself,
  so the trace is a continuous coverage path. The no-anchor edge
  case (`tr` starts with `L`/`l` with no preceding absolute
  waypoint) still emits literally.

### Added

- **`Vacuum.rememberOssPointer({ pointerStore? })` + `Vacuum.fetchMap
  FromOss({ filename? })`.** Memoises the most recent `siid 6 piid 3`
  (PATH) and `siid 6 piid 8` (POINTER_JSON) MQTT pushes; resolves
  the cached pointer via the existing `OssFetcher` to return a
  decoded `MapData` without any HTTP round-trip to the device. This
  is the path the Dreamehome mobile app uses to render the map on
  open even when the cloud's HTTP read is in code-80001 ack-timeout
  state. `pointerStore` is an optional `{ read, write }` callback
  pair so consumers can persist captures across process restarts;
  the lib stays IO-free. Survives `unwatch()` — the cache outlives
  the subscription. New `OssPointer` and `OssPointerStore` types
  exported from `node-dreame`.
- **`MapData.lowLyingAreas` (`MapLowLyingArea[]`).** X50 "sneak
  under furniture" zones from the JSON tail's `sneak_areas` /
  `sneak_areas_end` arrays. Polygon ROIs in mm world-frame —
  surfaces points as-emitted rather than coercing to a bounding box,
  matching Tasshack's parsing. `sneak_areas_end` is preferred when
  both fields are present (it carries the saved `area` m² field).
- **`MapData.wallsInfo` (`MapWallsInfo | null`).** Per-room wall
  geometry from the saved-map blob's `walls_info` field — a typed
  `{ versionFlag, storeys[].rooms[].walls[] }` tree where each wall
  carries `type` (`0` = solid, `1` = opening), `from` / `to`
  endpoints, and an inward-facing `normal` unit vector. Only
  populated when a saved-map blob is in scope (live-stream I-frames
  pick it up via the `tail.rism` recurse).
- **`MapVirtualWall { kind?: "wall" | "threshold"; passable?: boolean }`.**
  The `vw.line` virtual walls and the X50's `vws` threshold variants
  now surface on the same array, discriminated by `kind`. When
  `kind === "threshold"`, `passable: true` flags passable thresholds
  (`vws.vwsl` when `vws.npthrsd` is present), `passable: false`
  flags impassable thresholds (`vws.npthrsd`), and an absent
  `passable` means a "virtual" threshold from older firmware that
  doesn't split the two. Classic `vw.line` walls still emit without
  either field for back-compat.
- **`vw.nocpt`** parsed as additional no-go rectangles
  (`MapRestrictedArea` with `kind: "noGo"`). NOT carpets despite
  the wire-name; Tasshack `map.py:4668` reads them the same way.
- **`parseFrame(inflated)`** in `node-dreame/map`. Composes
  `parseMapHeader` + `sliceTailText` + `parseMapJsonTail` so callers
  reaching past `MapDecoder.decode` can follow the same wire-shape
  contract.
- **`parsePointerJson(value)`** in `node-dreame/map`. Shared parser
  for `siid 6 piid 8` (POINTER_JSON) values that accepts both
  string and pre-parsed-object inputs and tolerates the
  `obj_name` / `object_name` alias split.
- **`parseTailGeometry` / `coalesceGeometry` / `isGeometryComplete` /
  `MapGeometry`** in `node-dreame/map`. Aggregate decoder for every
  geometry-bearing tail field plus the merge primitive used by the
  rism-recurse path.
- **`PERSISTENT_TAIL_KEYS`** constant exported from
  `node-dreame/map`. The set of tail-JSON keys representing
  persistent floor-plan / saved-map / cleaning-progress
  configuration; `mergeTails` falls these back from prev when the
  P-frame doesn't re-send them.

### Changed

- **P-frame tail merge falls back on more keys.** Previously
  `mergeTails` only fell back `vw` and `decmap` when the P-frame's
  tail didn't re-send them. Now also `vws`, `sneak_areas`,
  `sneak_areas_end`, `walls_info`, and `rism` — all configuration
  the device emits only on full snapshots, not on every P-frame.
  Without the fall-through, the running merged state lost the
  user's geometry between snapshots.

### Documentation

- **`docs/live-map-format.md`** JSON-tail field table expanded to
  cover `vw.mop`, `vw.nocpt`, `vws.vwsl`, `vws.npthrsd`,
  `sneak_areas` / `sneak_areas_end`. The previous claim that
  `sneak_areas` had the same format as `vw.rect` was wrong (the
  shape is `{id, type, hide, roi, area?}`) — fixed. The `rism` row
  was rewritten from "not decoded" to describe the recursion
  contract that now ships.
- **`MapSegment.name` JSDoc** clarifies that the field is already
  decoded from base64 — use as-is, do NOT double-decode. Empty
  string (`""`) means "user has not named the room" (observed live
  on r2532a 2026-05-07); `null` means `seg_inf` was missing
  entirely. Renderers using `s.name || \`Room ${id}\`` work for
  both cases; strict-null checks (`s.name === null ?`) miss the
  empty-string case.
- **`MapVirtualWall` JSDoc** documents the `kind` / `passable`
  contract for thresholds across the X50 / older-firmware variants.

### Refactors (no behavioural change)

- **`src/map/decoder.ts` split** from 1165 lines into nine per-
  concern modules: `envelope.ts` (base64 / AES / zlib unwrap),
  `header.ts` (27-byte binary header), `tail.ts` (JSON tail +
  `parseFrame` seam), `pixel-grid.ts` (fsm:1 pixel decode + segment
  collect), `path.ts` (`tr` parser), `obstacles.ts`, `geometry.ts`
  (`vw` / `vws` / `walls_info` / sneak-zones), `cleaned-area.ts`
  (recursive `decmap` overlay), `field-utils.ts` (numeric coercion
  helpers). `decoder.ts` itself now holds just the public
  `MapDecoder` class. Public API unchanged — `node-dreame/map` re-
  exports every moved symbol at its original name.
- **`MapTail` and `RawSegInf` moved** from `src/map/decoder.ts` to
  `src/map/types.ts` — they're the wire-shape contract for
  everything in `src/map/`, not a decoder internal.
- **`src/vacuum/oss-pointer.ts` extracted.** `OssPointerCache`
  encapsulates the OSS-pointer capture / dedupe / persistence
  machinery; `Vacuum` keeps thin delegating wrappers for
  `rememberOssPointer` / `fetchMapFromOss` / `lastOssPointer*`.
- **`parsePointerJson` deduped.** Three sites (`MapManager`'s
  pointer-push handler, `Vacuum.fetchSavedMapList`,
  `Vacuum.rememberOssPointer`) now share the helper.
- **Rism-recurse cascade collapsed** from per-field if-statements
  to a single `coalesceGeometry(outer, inner)` call.

### Tests

Suite is 307 tests (was 268 at v0.1.5 release; +39 covering the
geometry parsers, path-delta accumulation, rism recurse, OSS-pointer
cache, and `parsePointerJson`).

## [0.1.5] - 2026-05-06

### Breaking changes

- **`Vacuum.refresh()` discriminator renamed and `state.online` no
  longer flipped on 80001.** `RefreshResult.kind` is now
  `"acked" | "no-ack"` instead of `"online" | "offline"` — the
  outcome describes whether the cloud's HTTP-side ACK arrived in
  time, not whether the device is reachable. The `"no-ack"` branch
  no longer forces `state.online = false`; the previous behaviour
  was based on the misreading of code 80001 corrected in 0.1.4. The
  MQTT `connect` / `close` listeners remain the authoritative
  source for `state.online`, so that value now stays untouched
  whenever the HTTP read times out.
- **Every `Vacuum` action and settings method now returns
  `Promise<ActionResult>` instead of `Promise<unknown>`.** Affected:
  `start`, `pause`, `stop`, `dock`, `locate`, `clearWarning`,
  `startAutoEmpty`, `cleanSegments`, `cleanZones`, `cleanSpot`,
  `resume`, `cancelCurrentJob`, `goHome`, `setSuction`,
  `setWaterVolume`, `setCleaningMode`, `setVolume`, `setSettings`.
  `ActionResult = { kind: "acked"; value } | { kind: "no-ack" }`.
  Code 80001 from the cloud's HTTP-side ACK waiter is folded into
  `"no-ack"` rather than thrown — the device frequently executes
  the action anyway, so `"no-ack"` means "watch MQTT to confirm,"
  not "the call failed." Non-80001 errors still throw. New
  `ActionResult` and `VerifyMqttResult` types are exported from
  `node-dreame`.
- **`VACUUM_PROP.DETERGENT_DOSAGE_INT` / `DETERGENT_DOSAGE_STR`
  renamed to `NUMERIC_MESSAGE_PROMPT` / `MESSAGE_PROMPT`.** The
  earlier names were a mislabel — the synchronous firing observed
  when toggling detergent dosage on r2532a was coincidental
  notification traffic, not the dosage value. The maintainer of
  Tasshack/dreame-vacuum confirmed on 2026-05-06 that siid 4 piid
  56/57 are general-purpose home-page message channels. JSDoc and
  the `docs/spec-discovery-methodology.md` table updated to match.

### Added

- **`Vacuum.fetchCurrentMap(timeoutMs?)`** — MQTT-driven current-
  floor-plan fetch with lifecycle handled. Probed live 2026-05-06:
  this is the path the Dreamehome mobile app uses when the cloud's
  HTTP `getProperties` is 80001-timing-out, which is the same state
  that has been making `fetchSavedMapList()` return `null`. Watches
  MQTT for the device's PATH push, fetches the announced OSS
  object, and returns decoded `MapData`. Opens a temporary
  subscription if `watch()` isn't already active and closes it
  before resolving. Single-floor consumers should prefer this over
  `fetchSavedMapList()`.
- **`'mapInfo'` event on `Vacuum` and `DreameSubscription`** —
  fires on the device's `_sync.update_vacuum_mapinfo` MQTT method,
  carrying the saved-map catalogue parsed into a
  `Map<mapId, number[]>`. Previously dropped silently (memory had
  this flagged as a known gap). The inner array values are not
  yet fully decoded — observed `[5,10]` for one map and `[0]` for
  the others on r2532a, suggestive of `[active_flag, ?]` or
  `[version, count]`. Surfaced raw so consumers can experiment.
  New `MapInfoPush` type exported from `node-dreame`.
- **`examples/probe-state-on-80001.ts`** — capture probe for the
  state-population question: subscribes MQTT, fires
  `getProperties`, and dumps every push + the 80001 response body
  (if any) as JSONL on stdout. Used to investigate whether there's
  a library-side seed path for `vacuum.state` when the cloud
  returns 80001 from the HTTP read; the answer today is "no, not
  without an APK-decompile pass on the Dreamehome mobile app."
- **`examples/probe-saved-map-noack.ts`** — six-phase capture
  probe used to determine the path the Dreamehome mobile app
  takes when fetching saved-map data against a device whose HTTP
  read is 80001-timing-out. Phase 3 prompts the operator to open
  the app on the same device; the resulting MQTT pushes drove the
  `fetchCurrentMap()` and `'mapInfo'` design above.

### Documentation

- **`docs/live-map-roadmap.md` replaced by `docs/live-map-format.md`.**
  The old file was a working notebook — phase-status blocks, "DONE
  YYYY-MM-DD" tags, executor checklists, open questions, and
  consumer-specific sections — half of which were already stale.
  The replacement is a flat binary-format reference: outer
  envelope, 27-byte header, three pixel-grid decoders, JSON tail
  keys, frame types + P-frame merge rules, coordinate system, OSS
  endpoints, output schema, and Tasshack file:line landmarks. Two
  internal references (`src/miot-spec.ts`, `src/map/types.ts`) and
  one README link updated to point at the new file.
- **README "Live updates over MQTT" section** gained a subsection
  explaining how `vacuum.state` populates: from a `kind: "acked"`
  `refresh()` (full seed in one round-trip) OR from MQTT
  `properties_changed` pushes (per-field patches on change). On a
  quiet idle device whose `refresh()` no-acks, fields can stay
  null for minutes — consumers should treat the `'change'` event
  as the source of truth rather than reading `state` synchronously.
- **`Vacuum.state` JSDoc** now documents the same two sources and
  the no-seed-on-80001 behaviour.
- **`Vacuum.fetchSavedMapList()` JSDoc** clarifies that this is
  the multi-floor metadata path that depends on the cloud's HTTP
  read succeeding, frequently returns `null` for that reason, and
  is NOT the path the mobile app uses for rendering — it points
  single-floor consumers at `fetchCurrentMap()`.
- **README "Live updates over MQTT" section** gained a
  "Getting a current floor plan" subsection comparing
  `fetchCurrentMap()` and `fetchSavedMapList()`, plus a sample of
  the `'mapInfo'` event for multi-floor awareness.

## [0.1.4] - 2026-05-04

Live-MQTT subscription, action-call, and live-map ergonomics —
all driven by the realisation that the cloud's HTTP code 80001
("device offline") is misleading on healthy devices and was poisoning
both the lib's error model and consumer code that tried to wait for
"the subscription to come alive."

### Added

- **`Vacuum.verifyMqtt(opts?)`** — first-class "is my subscription
  actually receiving pushes?" check. Issues a no-op `VOLUME` write and
  waits for the broker to echo it back as `properties_changed`. Returns
  a `VerifyMqttResult` discriminated by `reason`: `"ok"` / `"no-echo"` /
  `"not-watching"`. The MQTT echo is treated as the source of truth —
  HTTP code 80001 from the trigger write is **ignored**, because it's a
  false negative on healthy devices (see Changed below). Replaces the
  previous "stare at the empty event stream and hope" pattern for
  verifying a subscription is alive.
- **`MapManager.requestIFrame(opts?)`** — convenience wrapper around the
  internal frame requester. Consumers no longer need to import the
  standalone `requestIFrame(client, did)` helper just to provoke a fresh
  I-frame from the map manager they already have.
- **`MapManager.whenReady(timeoutMs?)`** — Promise that resolves with
  the next decoded `MapData`, kicking `requestIFrame()` to bootstrap if
  no map is current yet. Auto-calls `start()` (idempotent). Default
  timeout 30000ms; pass `0` to wait indefinitely. Live-channel only —
  the docstring directs static "give me the current floor plan" use
  cases at `Vacuum.fetchSavedMapList()` instead.
- **`examples/probe-mqtt-verify.ts`** — thin wrapper around
  `Vacuum.verifyMqtt()` for one-shot diagnostics from the command line.
  Also dumps the raw `getDevices` JSON for the first device.

### Changed

- **`Vacuum.fetchSavedMapList()` tolerates 80001.** When the cloud
  returns 80001 for the underlying pointer read, the method now folds
  that into the same `null` outcome as "no pointer published yet"
  rather than throwing. This makes it a safe fallback for the static-
  floor-plan use case the README points at, even when the device is
  unresponsive.
- **`DreameDeviceOfflineError` reinterpreted.** The class name is kept
  for legibility against the wire-level literal `msg`, but its JSDoc
  now documents that code 80001 does NOT mean the device is offline.
  Verified live 2026-05-04 against a Dreame X50: `vacuum.start()`,
  `vacuum.dock()`, `vacuum.cancelCurrentJob()`, `setProperties`, and
  `getProperties` all returned 80001 from the HTTP layer while the
  device was simultaneously executing the actions and echoing state
  changes back over MQTT. 80001 actually means "the cloud's HTTP-side
  ACK waiter timed out after ~8s" — the action may well have been
  delivered. The MQTT subscription is the source of truth for
  device-side response. `Vacuum.verifyMqtt()` and
  `MapManager.whenReady()` both swallow 80001 from their trigger
  actions for this reason; consumers writing custom round-trips should
  do the same.

## [0.1.3] - 2026-05-03

Post-release code-review pass plus a Node-engine bump to current LTS.
No new device features — all changes are internal hygiene, public-API
refinements, and CI/CD plumbing fixes.

> 0.1.1 and 0.1.2 were tagged but never reached the npm registry. 0.1.1
> hit a 404 because the Release workflow's bundled npm was too old to
> use OIDC Trusted Publishing for the registry PUT. 0.1.2 hit a 422
> because `package.json` carried the wrong-case `Malard` for the GitHub
> owner in `repository.url`/`bugs.url`/`homepage`, which npm provenance
> verification rejects against the lowercase canonical claim from the
> OIDC token. 0.1.3 fixes both and supersedes them.

### Breaking changes

- **Minimum Node.js version is now 24.** `engines.node` raised from
  `>=18` to `>=24`. Node 18 reached end-of-life in April 2025 and
  Node 20 reached end-of-life in April 2026 — both are unsupported.
  Node 22 is dropped from the support matrix to keep the surface small.

### Breaking changes

- **`Vacuum.refresh()` return type.** Now returns
  `RefreshResult = { kind: "online" | "offline"; state: VacuumState }`
  rather than bare `VacuumState`. The previous offline-by-side-effect
  behaviour (silently returning a stale state with `online: false`) is
  unchanged; the discriminator is now explicit on the return value.
- **`DreameClientOptions.logger` signature.** Now
  `(level, msg, meta?) => void` with `level: "debug" | "info" | "warn" |
  "error"`. The previous `(msg, meta?)` form forced consumers to filter
  by string content. New `DreameLogger` and `DreameLogLevel` types are
  exported.
- **`commands.extractResultArray` (internal but observable via
  `DreameClient.getProperties`/`setProperties`).** Throws `DreameApiError`
  instead of returning `[]` when the cloud's response shape is not
  recognised — masking these used to hide bugs.

### CI / Release

- **Release workflow updated** to use Node 24, force-upgrade npm to the
  latest before publish (OIDC Trusted Publishing requires npm >= 11.5.1),
  and drop the `registry-url:` setup-node parameter that was injecting
  an empty-token `.npmrc` and short-circuiting OIDC auth.
- **`package.json` GitHub URLs lowercased.** `repository.url` /
  `bugs.url` / `homepage` now use `malard` (the canonical lowercase
  GitHub owner). npm provenance verification is case-sensitive against
  the OIDC claim and rejects mismatches with `422`.
- **CI matrix narrowed to Node 24 only** and the lint step is now part
  of the gate (was previously only enforced via `prepublishOnly`).
- **`@types/node` bumped to `^24.0.0`** to match the engine floor.

### Cleanup

- **`src/http.ts` `composeSignals`** now uses native `AbortSignal.any`
  unconditionally; the manual `mergeSignals` controller-based fallback
  required for Node 18 has been deleted.

### Features

- **`AbortSignal` and per-call `timeoutMs` on every public async
  method.** `getDevices`, `getProperties`, `setProperties`, `callAction`,
  `Vacuum.fetchTotals` / `fetchTaskMap` / `fetchSavedMapList`, and
  `OssFetcher.fetchBlob` all accept a `CallOptions { signal?, timeoutMs? }`.
  Default request timeout is 30 s (was unbounded).
- **Typed event emitters.** `Vacuum`, `MapManager`, and
  `DreameSubscription` now extend a generic `TypedEmitter<E>` so
  event-name typos fail at compile time. Each class exports its event
  payload map (`VacuumEvents`, `MapManagerEvents`,
  `DreameSubscriptionEvents`).
- **`readonly` arrays on decoder output.** `MapData`, `MapLayer`,
  `MapSegment`, `MapPath`, and `MapCleanedAreaOverlay` now mark every
  array field `readonly` so renderers can't mutate the buffer
  `MapManager` keeps as the running merged state.

### Improvements

- **HTTP request timeout** wired through `httpPostJson` via
  `AbortSignal.timeout` (with an `AbortSignal.any` fallback path for
  Node 18). Caller-supplied signals merge with the timeout.
- **MapManager OSS-pointer ingests are serialised** through an internal
  promise chain so two near-simultaneous PATH / POINTER_JSON pushes
  with different `objName`s can no longer let a stale I-frame overwrite
  a fresher one.
- **`OssFetcher.fetchBlob` coalesces concurrent fetches** for the same
  `(did, filename)` pair into a single network request.
- **`MODEL_CAPABILITIES` table entries are deep-frozen** at module
  load — a stray consumer mutation can no longer corrupt the table for
  subsequent callers.
- **`randomRequestId()` widened** from `[1000, 9999]` to a positive
  31-bit integer, eliminating a correlation hazard for any future
  concurrent fan-out.
- **MQTT TLS rationale documented** at the `rejectUnauthorized: false`
  call site, alongside the access-token refresh contract for the live
  subscription.

### Refactors (no behavioural change)

- **`RequestContext.from(input)`** factory replaces four open-coded
  conditional-spread blocks across `auth`, `commands`, `devices`, and
  `map/oss-fetch`.
- **`DreameClient` now passes its long-lived `RequestContext`** to
  `commands.sendCommand` and `devices.listDevices` instead of
  re-resolving region/host/etc. per call.
- **Import cycle broken.** `buildHeaders` moved out of `auth.ts` into a
  new `headers.ts`, eliminating the previous `auth → http → auth`
  circular import.
- **`Vacuum#requireOssContext` helper** replaces three repeated lazy-
  init / session-check blocks in the map / fetchTaskMap /
  fetchSavedMapList sites.
- **`vacuum.ts` split.** The applier table + `VacuumState`,
  `parseTaskCompleteEvent` + `CleaningHistoryRecord`, and
  `decodeSavedMapList` moved into `src/vacuum/state.ts`,
  `src/vacuum/task-complete.ts`, `src/vacuum/saved-maps.ts`. Public
  exports re-bridged from `vacuum.ts` so import paths are unchanged.
- **`miot-spec.ts` split.** Enum catalogue and `FEATURE_CONFIG_KEYS`
  moved into `src/spec/enums.ts` and `src/spec/feature-config.ts`. Re-
  exports keep the public surface stable.
- **Magic numbers replaced.** `Vacuum#resolveCleanOpts` now references
  `SuctionLevel.Standard` / `WaterVolume.Medium` for default fan/water
  rather than literal `1` / `2`.

### Docs

- **`CONTRIBUTING.md`** added covering the JSDoc verification-tag
  convention, naming conventions (`canX`/`hasX`/`supportsX`/`supportedXs`,
  `#privateField`, `UPPER_SNAKE` for spec constants), the lowercase
  HTTP header rule, the `Dreame*Error` boundary-throwing rule, the
  explicit-Promise-return-type rule, the readonly-public-arrays rule,
  the no-backwards-compat-scaffolding rule, the lazy-load-fixtures
  rule, and the one-concept-per-file rule.

### Tests

- New tests cover the OSS-fetcher coalescing path, the HTTP timeout
  and abort-signal paths, the `extractResultArray` throw path, the
  `MODEL_CAPABILITIES` immutability guarantee, and the `Vacuum.refresh`
  online / offline / re-throw discrimination. Suite is now 237 tests
  (was 228).

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
