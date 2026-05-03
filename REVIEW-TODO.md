# Code Review TODO

Action items from the 2026-05-03 codebase review. Numbers are stable references — quote them in commits/PRs as `review #N`.

Status legend: `[ ]` open, `[~]` in progress, `[x]` done, `[-]` won't fix.

## Defects / risks

- [x] **#1 — Add HTTP timeout to `httpPostJson`.** No `AbortSignal` is set on `fetch()`; a hung connection blocks indefinitely. Default to ~30s via `AbortSignal.timeout`, allow per-call override. (`src/http.ts`)
- [x] **#2 — Plumb `AbortSignal` through public async methods.** `client.getProperties`, `setProperties`, `callAction`, `getDevices`, `OssFetcher.fetchBlob`, `Vacuum.fetchTotals`/`fetchTaskMap`/`fetchSavedMapList` should all accept an optional `signal`. (`src/client.ts`, `src/commands.ts`, `src/devices.ts`, `src/map/oss-fetch.ts`, `src/vacuum.ts`)
- [x] **#3 — Justify or remove `rejectUnauthorized: false` on the MQTT connect.** Either pin the expected CA / fingerprint with a comment, or flip to `true` if the broker presents a valid public cert. (`src/mqtt.ts:160`)
- [x] **#4 — Dedupe in-flight `OssFetcher` fetches.** Two concurrent calls for the same `filename` both hit the network. Add a `Map<string, Promise<Buffer>>` of in-flight resolves. (`src/map/oss-fetch.ts`)
- [x] **#5 — Tighten `MapManager.#fetchAndIngestOssBlob` ordering.** PATH and POINTER_JSON pushes with different `objName`s racing can let a stale I-frame overwrite a fresher one (the `frameId > decoded.frameId` guard only catches same-mapId regressions). Add an in-flight ingest guard. (`src/map/manager.ts`)
- [x] **#6 — Document MQTT token-refresh behaviour.** `DreameSubscription` keeps using the stale access token as its MQTT password after a session refresh. Confirm broker validates only at CONNECT and add a comment + test capturing that contract. (`src/mqtt.ts`)
- [x] **#7 — Stop swallowing parse failures in `extractResultArray`.** Returning `[]` on an unrecognised shape masks bugs. Either log via `client.logger` or attach the raw response to a thrown `DreameApiError`. (`src/commands.ts`)
- [x] **#8 — Make `Vacuum.refresh()`'s offline outcome explicit.** Return type currently `VacuumState`; the `online: false` discriminator is buried. Consider `{ kind: "online" | "offline"; state }` (or at minimum, beef up the JSDoc and add a unit test pinning the offline path). (`src/vacuum.ts`)
- [x] **#9 — Add a level to the logger signature.** `(msg, meta?)` forces consumers to filter by string content. Change to `(level: "debug"|"info"|"warn"|"error", msg, meta?)`. Breaking — do before 1.0. (`src/types.ts`, all call sites)
- [x] **#10 — Widen `randomRequestId()` range.** 9000 ids is fine for serial calls but a correlation hazard if concurrent fan-out is ever added. Widen to e.g. 32-bit. (`src/crypto.ts`)

## Refactor opportunities

- [x] **#11 — Centralise `RequestContext` construction.** `auth.ts:ctxFromInput`, `commands.ts:sendCommand`, `devices.ts:listDevices`, `oss-fetch.ts:resolveUrl` all open-code the same conditional-spread. Extract `RequestContext.from(input)`. (`src/http.ts` + four callers)
- [x] **#12 — Pass `RequestContext` through to leaves.** `client.ts:#commonInput` rebuilds the same fields each call; `sendCommand` re-instantiates `RequestContext`. Pass the existing context object directly. (`src/client.ts`, `src/commands.ts`)
- [x] **#13 — Break the `auth.ts ↔ http.ts` import cycle.** Move `buildHeaders` out of `auth.ts` (into `http.ts` or a new `headers.ts`). (`src/auth.ts`, `src/http.ts`)
- [x] **#14 — De-duplicate the lazy-init pairs in `vacuum.ts`.** Three repeated `if (!this.#ossFetcher) … if (!session) throw …` blocks (~lines 432, 661, 729). Extract `#requireOssContext()`. (`src/vacuum.ts`)
- [x] **#15 — Split `vacuum.ts` (1072 lines).** Into `vacuum/state.ts` (APPLIERS, VacuumState, EMPTY_STATE), `vacuum/task-complete.ts` (parser + record), `vacuum/saved-maps.ts` (decodeSavedMapList). Keep the class file thin. (`src/vacuum.ts`)
- [x] **#16 — Split `miot-spec.ts` (1310 lines).** Per service: `spec/vacuum.ts`, `spec/dock.ts`, `spec/schedule.ts`, etc., re-exported from `spec/index.ts`. (`src/miot-spec.ts`)
- [x] **#17 — Replace magic numbers in `Vacuum.#resolveCleanOpts`.** `?? 1` and `?? 2` should reference `SuctionLevel.Standard` / `WaterVolume.Medium`. (`src/vacuum.ts:835-840`)
- [x] **#18 — Freeze `MODEL_CAPABILITIES` table entries.** Currently shared by reference; a consumer mutation corrupts the table for the next caller. Deep-freeze on module load. (`src/capabilities.ts`)
- [x] **#19 — Adopt typed event emitters.** `Vacuum`, `MapManager`, `DreameSubscription` extend `EventEmitter` with untyped `emit/on`. Add a `*Events` map and typed `on`/`emit` overloads so event-name typos fail at compile time. (`src/vacuum.ts`, `src/map/manager.ts`, `src/mqtt.ts`)

## Coding standards (codify in CONTRIBUTING.md)

- [x] **#20 — Document the JSDoc verification tag convention.** `VERIFIED <model> <date>` / `ASSUMED <source>` — already a house convention, write it down.
- [x] **#21 — Document naming conventions.** `canX` / `hasX` / `supportsX` / `supportedXs`; `#privateField` for class privates; `UPPER_SNAKE` for spec constants; `as const` on every spec table.
- [x] **#22 — Codify "headers always lowercase" rule.** Already followed; document it.
- [x] **#23 — Codify "no plain `throw new Error()` at module boundaries".** Use `Dreame*Error` subclasses; `RangeError` for input validation only.
- [x] **#24 — Mandate explicit `Promise<...>` return types on public async methods.** Already followed; document it.
- [x] **#25 — Mandate `readonly` on public array-typed fields.** Extend the `capabilities.ts` pattern to `MapData`/`MapLayer` arrays so renderers can't mutate decoder output.
- [x] **#26 — Codify "no backwards-compat scaffolding".** No version sniffing, no fallback paths for older firmware. Drop ASSUMED entries when contradicted rather than supporting both.
- [x] **#27 — Codify "lazy-load fixtures inside `it()` callbacks".** Already in memory; document so external contributors don't re-discover.
- [x] **#28 — Codify "one concept per file".** Gives cover for the splits in #15 / #16.
