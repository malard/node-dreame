# node-dreame

[![CI](https://github.com/malard/node-dreame/actions/workflows/ci.yml/badge.svg)](https://github.com/malard/node-dreame/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A524-brightgreen.svg)](./package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg?logo=typescript&logoColor=white)](./tsconfig.json)
[![Tested model](https://img.shields.io/badge/tested-Dreame%20X50%20Ultra%20Complete%20%28r2532a%29-orange.svg)](./docs/spec-discovery-methodology.md)
[![Issues](https://img.shields.io/github/issues/malard/node-dreame.svg)](https://github.com/malard/node-dreame/issues)
[![Last commit](https://img.shields.io/github/last-commit/malard/node-dreame.svg)](https://github.com/malard/node-dreame/commits/main)

Node.js client for the **Dreame native cloud** — the backend behind the **Dreamehome** mobile app. Control Dreame robot vacuums from Node, without going via Home Assistant or Xiaomi Mi cloud.

> **Status:** pre-1.0. Auth, MQTT live updates, action dispatch, and live-map decoding are all working against a real Dreame X50 Ultra Complete. Public API may still shift before 1.0 — pin a specific version.

## Why this exists

Most existing Dreame integrations (notably [Tasshack/dreame-vacuum](https://github.com/Tasshack/dreame-vacuum)) talk to **Xiaomi Mi cloud**, which only works for robots paired with the Mi Home / Xiaomi Home app. Robots paired with the Dreamehome app live on a different backend and aren't reachable via that path.

This library targets that gap.

## Scope

- **In scope:** Dreamehome cloud auth (email/password), device discovery, status polling, command dispatch, MQTT live updates, room-aware cleaning, live-map and saved-map decoding (`MapData` shape — segments, walls, no-go zones, dock + robot pose, paths).
- **Out of scope (for now):** Mi cloud (use [Tasshack/dreame-vacuum](https://github.com/Tasshack/dreame-vacuum) for that), pixel/raster rendering of maps (we expose structured `MapData`; the consumer does the viewport transform — see [`docs/live-map-format.md`](./docs/live-map-format.md)), Home Assistant integration.

## Install

```bash
npm install node-dreame
```

Requires Node.js 24 or newer.

## Usage

```ts
import { DreameClient } from "node-dreame";

const dreame = new DreameClient({
  email: "you@example.com",
  password: "***",
  region: "eu", // or "us", "cn", ...
});

await dreame.login();

const devices = await dreame.getDevices();
const vacuum = dreame.getVacuum(devices[0]);

// Inspect what the hardware supports before rendering UI / building requests:
if (vacuum.capabilities.canMop) {
  console.log("Mop supported. Water levels:", vacuum.capabilities.supportedWaterVolumes);
}

const refresh = await vacuum.refresh();
if (refresh.kind === "no-ack") { console.warn("cloud HTTP read timed out; cached state may be stale"); }

const locate = await vacuum.locate();
if (locate.kind === "no-ack") { console.warn("locate may still have fired; watch MQTT to confirm"); }
```

CommonJS:

```js
const { DreameClient } = require("node-dreame");
```

## Live updates over MQTT

Open an MQTT subscription to receive `properties_changed`, OTA progress, task-complete events, and live-map frames as the device pushes them:

```ts
await vacuum.watch();
vacuum.on("change", (state) => console.log(state));
vacuum.on("taskComplete", (record) => console.log("done:", record));
```

For notification-style consumers there's also a single envelope event covering start / complete / abort with a typed reason:

```ts
vacuum.on("taskLifecycle", (ev) => {
  if (ev.phase === "started")   console.log("cleaning started");
  if (ev.phase === "completed") console.log("done:", ev.record);
  if (ev.phase === "aborted")   console.log(`robot needs attention: ${ev.reason}`);
});
```

`reason` is derived from `MiotError` — known refusal codes surface as `clean-water-tank-empty`, `wastewater-tank-full`, `robot-lifted`, etc.; unknown codes fall through as `error-<n>`.

The MQTT channel is **passive** — the device only pushes when state changes, so a quiet idle window can look indistinguishable from a broken subscription. Use the first-class verifier to remove the ambiguity:

```ts
const r = await vacuum.verifyMqtt();
if (r.reason !== "ok") { console.error("subscription not healthy:", r.reason); }
```

`r.reason` discriminates: `"ok"` (broker echoed our trigger write back), `"no-echo"` (no echo within timeout — device may be genuinely unreachable or just unresponsive to the no-op), `"not-watching"` (`watch()` wasn't called). The MQTT echo is the source of truth — the HTTP layer's code 80001 ("device offline") is **ignored** because it's a false negative on healthy devices (the cloud's HTTP-side ACK waiter often times out while the device is actually executing the action and echoing state back over MQTT — see `DreameDeviceOfflineError` for details).

### `vacuum.state` populates from two sources

`vacuum.state` is the cached snapshot exposed through `state` and the `'change'` event. It populates from:

1. **`refresh()` returning `kind: "acked"`** — seeds every tracked field in one HTTP round-trip. When the cloud returns 80001 (`refresh()` resolves to `kind: "no-ack"`), no seeding happens; fields stay where they were.
2. **MQTT `properties_changed` pushes** — the device emits these on every state change after `watch()`. Each push patches one or more fields. On a quiet idle device (charging on the dock, no errors) push rate can sit at zero for minutes.

Practical consequence: don't assume `state` is fully populated immediately after `watch()`. Treat the `'change'` event as the source of truth and re-render whenever it fires. Call `refresh()` opportunistically — when it acks you get a full snapshot, when it no-acks you've lost nothing.

If you need a populated `state` *now* and `refresh()` no-acks, there is no library-side workaround today: the Dreamehome cloud exposes `/device/sendCommand` as the only read path, and that's the call returning 80001. We've gathered enough to document the behaviour but not enough to bypass it; an APK-decompile pass on the Dreamehome mobile app is the next investigation step. The `examples/probe-state-on-80001.ts` probe captures whatever the broker / cloud will surface to a passive observer in this state, for that future investigation.

### Action calls return `ActionResult` instead of throwing on 80001

Every action and settings method on `Vacuum` (`start`, `dock`, `pause`, `stop`, `locate`, `clearWarning`, `startAutoEmpty`, `cleanSegments` / `cleanZones` / `cleanSpot`, `resume` / `cancelCurrentJob` / `goHome`, `setSuction` / `setWaterVolume` / `setCleaningMode` / `setVolume` / `setSettings`) returns `Promise<ActionResult>`:

```ts
type ActionResult<T = unknown> =
  | { kind: "acked"; value: T }
  | { kind: "no-ack" };
```

When the cloud responds normally you get `{ kind: "acked", value }`; when the cloud returns 80001 you get `{ kind: "no-ack" }`. **`"no-ack"` does not mean the action failed** — the device often executes the action anyway and echoes the resulting state changes back over MQTT. Treat it as "watch MQTT to confirm" rather than as an error. Non-80001 errors (network, auth, malformed response) still throw and need caller attention.

For the live-map case during an active cleaning task, don't sit waiting for the first `'map'` event — actively provoke one:

```ts
const data = await vacuum.map.whenReady();   // live channel, resolves on next push
```

`whenReady(timeoutMs?)` resolves with the next decoded `MapData`, kicking `requestIFrame()` to bootstrap. Default timeout 30000ms. The same `vacuum.map` exposes `requestIFrame(opts?)` directly when you need the underlying action without the wait.

### Getting a current floor plan

For "give me the current floor plan as a single `MapData`" — segments, walls, dock, robot pose, the lot — there are two paths, with different trade-offs:

```ts
// Path 1 (recommended for single-floor homes): MQTT-driven, no HTTP dependency.
const data = await vacuum.fetchCurrentMap();

// Path 2: multi-floor metadata (named floors, angles, active-map pointer).
const list = await vacuum.fetchSavedMapList();
const active = list?.maps.find((m) => m.mapId === list.activeMapId);
const data2 = active?.data;
```

`fetchCurrentMap()` is the path the **Dreamehome mobile app uses** when the cloud's HTTP path is timing out (probed live 2026-05-06): it watches MQTT for the device's PATH push, fetches the announced OSS object, and returns the decoded `MapData`. It opens a temporary subscription if `watch()` isn't already active, and closes it before resolving. Default timeout 30000ms; pass `0` to wait indefinitely.

`fetchSavedMapList()` reads the per-floor catalogue via HTTP `getProperties` and is **frequently `null` on otherwise-healthy devices** because the cloud's HTTP-side ACK waiter times out (code 80001). Reach for it only when you specifically need per-floor names or the active-map pointer.

If you want to know *which* maps the device has saved (multi-floor awareness without committing to the HTTP path), subscribe to the `'mapInfo'` event:

```ts
await vacuum.watch();
vacuum.on("mapInfo", (push) => {
  console.log("saved-map ids:", [...push.maps.keys()]);
});
```

The Dreamehome cloud emits this on the device's `_sync.update_vacuum_mapinfo` MQTT method whenever its saved-map catalogue is re-announced — typically when the mobile app opens the device. Payload is a `Map<mapId, number[]>`; the inner array values are not yet fully decoded.

## Building a web app on top of node-dreame

node-dreame runs in a Node.js process and emits events. If you want a
browser front-end (e.g. a live map UI), put a thin bridge between
node-dreame and your browser. Two reference adapters live in
`examples/`, both ~120 lines, copy-and-adapt:

- [`examples/server-sse.ts`](./examples/server-sse.ts) — zero-deps
  Server-Sent Events stream + `POST /actions/<name>`. Simplest. Use
  when one-way live updates plus discrete commands is enough.
- [`examples/server-websocket.ts`](./examples/server-websocket.ts) —
  bidirectional WebSocket using [`ws`](https://www.npmjs.com/package/ws).
  Use when the browser needs to push back frequently (action invocations,
  cursor positions, etc.).

Both forward `vacuum.map`, `vacuum.on('change')`, and `vacuum.on('ota')`
to all connected clients with a tagged `{ type, data }` envelope.

Live map streaming on its own (no server) is in
[`examples/live-map-stream.ts`](./examples/live-map-stream.ts).

The map shape (`MapData`) and the underlying binary format are
documented in
[`docs/live-map-format.md`](./docs/live-map-format.md). Coordinates
are raw mm in the device's world frame — the consumer does the
viewport transform.

## Supported devices

Developed against a **Dreame `r2532a`** (X50 Ultra Complete, EU region, firmware 4.3.9_2199). Other models may work — the auth and transport layer should be model-agnostic — but the property/action catalogue in `miot-spec.ts` is partly verified on r2532a and partly inherited from [Tasshack/dreame-vacuum](https://github.com/Tasshack/dreame-vacuum) (older Dreames on Mi cloud).

### Coverage status

This is **a partial mapping, not a complete one**. We've prioritised the surface most useful for home-automation integration (dock settings, OTA, schedules, a handful of actions), but large parts of the device's feature set haven't been observed yet.

Roughly:

- **Well-mapped:** auth + transport, MQTT event channels, dock settings, OTA flow, the global Custom-mode schedule format, basic battery/charge/state.
- **Partly mapped:** MIoT state enum (we have all the keyDefine translations, but only a subset have been observed in real transitions); FEATURE_CONFIG_JSON keys (3 of ~36 confirmed by toggle, the rest documented by name only).
- **Hardly touched:** room-targeted cleaning behaviour, per-room schedule packing, the `0xC249` middle bits of the global Custom-mode int, voice configuration, DND scheduling, AI object-detection class IDs, the `siid 99 piid 98` telemetry blob, and the many siid 4 piids we never observed move. (Live-map blobs on `siid 6` and the cleaning-run lifecycle are now mapped — see the live-map decoder and `taskLifecycle`.)

Each entry in `src/miot-spec.ts` is annotated:

- `// VERIFIED <date>` — observed working on r2532a
- `// ASSUMED from <source>` — borrowed from another project, not yet confirmed on r2532a

If a behaviour you care about isn't VERIFIED, treat it as a guess. If you exercise something new, please contribute the finding back — the methodology is documented in [`docs/spec-discovery-methodology.md`](./docs/spec-discovery-methodology.md) and the long-running logger in `examples/log-events.ts` makes it cheap to add observations.

### Known specifically-verified pieces

- Auth + device discovery + MQTT subscription
- Typed event channels: `properties_changed`, `props` (incl. OTA), `_otc.info`
- Property reads (state, error, battery, charging, suction, water, cleaning_mode raw, task_status raw, volume, consumables, firmware build, serial, timezone, off-peak charging window, DND windows, feature toggles JSON, version metadata)
- Property writes (round-trip verified)
- Actions: `LOCATE`, `TEST_SOUND`, `CLEAR_WARNING`, `START` (cleans, refused with `MiotError.CleanWaterTankEmpty=107` / `WastewaterTankFull=105` when tanks are blocked), `STOP`, `PAUSE`
- Full OTA cycle (download → install → reboot → re-online → version flip)
- All dock settings reachable from the Dreamehome app's "Base Station" menu (mop wash temp/water level/wetness, drying mode, hair compression, smart-mode master, mast control, auto-empty frequency)
- All cleaning behaviour settings reachable from the app's "Cleaning Settings" menu (carpet handling mode + sub-options, child lock, resume cleaning, power-saving, obstacle crossing mode, AI obstacle bitfield partial)
- Cleaning-schedule string format (CleanGenius preset + Custom-global; Custom per-room is structural only — see [issue #1](https://github.com/malard/node-dreame/issues/1))
- Scale Inhibitor consumable (`siid 31`) on top of brush/filter/sensor
- `DreameDeviceOfflineError` distinguished from other API errors
- 11 of ~36 `FEATURE_CONFIG_KEYS` confirmed by toggle (the rest documented by name only)

### Known specifically-NOT-verified pieces

- Actions `CHARGE`/dock, `START_AUTO_EMPTY`, `START_WASHING`, all `RESET_*` — wired with Tasshack's older-model siid:aiid values, but no live test
- `SuctionLevel`, `WaterVolume`, `ChargingStatus`, `CleaningMode` enum behaviour during actual cleaning (settings reads work; downstream effects untested)
- `TASK_STATUS` (siid 4 piid 1) — raw int only; values 1, 2, 3, 6, 12, 13, 14, 17, 18, 23 observed in different states without a clean mapping
- `CleaningMode` (siid 4 piid 23) — known to be a packed bitfield on r2532a (raw 5120 in baseline); not decoded
- Per-room schedule packed-int format ([issue #1](https://github.com/malard/node-dreame/issues/1))
- AI obstacle bitfield (`siid 4 piid 22`) — partial decoding only; bits 1, 2, 4 verified, bits 0, 3, 5-8 unknown
- `0xC249` middle bits of the Custom-mode global schedule int
- The `siid 99 piid 98` compressed telemetry blob — payload format unknown
- AI object-detection class catalog (we see bbox class id 160 repeatedly; other class IDs not observed)
- Most of the `FEATURE_CONFIG_KEYS` (~25 still documented by name only)
- Long-form cleaning-run behaviour through to completion — we've triggered short START/STOP cycles via the lib, but a full task end-to-end (with the resulting `taskComplete` event) has only been observed from app-initiated runs

### Cloud-only settings (no MQTT push to the device)

Some app settings are **not stored on the device at all** — they live entirely in Dreame's cloud and never produce an MQTT echo. node-dreame can't observe or write these without a separate cloud-API endpoint:

- Auto-update toggle
- "Mopping with Detergent" master (note: distinct from "Mop-Washing with Detergent" which DOES push)
- Camera / Activation PIN
- Device rename (`customName`)
- Matter pairing / activation code

### Matter support

The X50 Ultra Complete also supports Matter. node-dreame stays cloud-based; Matter would be a cleaner local-only path for basic robot vacuum capabilities (start/dock/battery), but exposes a much smaller surface than what's mapped here. See `project_dreame_matter_future.md` in the project memory for context if pivoting.

## Reverse-engineering notes

For implementers (and for AI agents extending the spec), [`docs/`](./docs) contains:

- [`auth-flow.md`](./docs/auth-flow.md) — endpoint URLs, headers, request/response shapes for auth + device list + MQTT
- [`ota-flow.md`](./docs/ota-flow.md) — observed timeline + envelope shapes from a real firmware update, including the OTA `props` channel and the `dowloaded` typo
- [`spec-discovery-methodology.md`](./docs/spec-discovery-methodology.md) — how the property/action catalogue was assembled from a live device, with all the verified mappings and what's still unknown

## License

MIT — see [LICENSE](./LICENSE).

## Acknowledgements

The MIoT property/action enum structure is informed by [Tasshack's dreame-vacuum](https://github.com/Tasshack/dreame-vacuum) (Mi cloud). This library does not share code with it.
