# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
