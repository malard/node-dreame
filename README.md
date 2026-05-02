# node-dreame

[![CI](https://github.com/malard/node-dreame/actions/workflows/ci.yml/badge.svg)](https://github.com/malard/node-dreame/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](./package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg?logo=typescript&logoColor=white)](./tsconfig.json)
[![Tested model](https://img.shields.io/badge/tested-Dreame%20X50%20Ultra%20Complete%20%28r2532a%29-orange.svg)](./docs/spec-discovery-methodology.md)
[![Issues](https://img.shields.io/github/issues/malard/node-dreame.svg)](https://github.com/malard/node-dreame/issues)
[![Last commit](https://img.shields.io/github/last-commit/malard/node-dreame.svg)](https://github.com/malard/node-dreame/commits/main)

Node.js client for the **Dreame native cloud** — the backend behind the **Dreamehome** mobile app. Control Dreame robot vacuums from Node, without going via Home Assistant or Xiaomi Mi cloud.

> **Status:** pre-alpha. Auth flow is being reverse-engineered. Public API will change. Do not use in production yet.

## Why this exists

Most existing Dreame integrations (notably [Tasshack/dreame-vacuum](https://github.com/Tasshack/dreame-vacuum)) talk to **Xiaomi Mi cloud**, which only works for robots paired with the Mi Home / Xiaomi Home app. Robots paired with the Dreamehome app live on a different backend and aren't reachable via that path.

This library targets that gap.

## Scope

- **In scope:** Dreamehome cloud auth (email/password), device discovery, status polling, command dispatch, MQTT live updates, room-aware cleaning.
- **Out of scope (for now):** Mi cloud, the binary map renderer, Home Assistant integration.

## Install

```bash
npm install node-dreame
```

Requires Node.js 18 or newer.

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
console.log(devices);

const robot = devices[0];
await robot.start();
await robot.dock();
```

CommonJS:

```js
const { DreameClient } = require("node-dreame");
```

## Supported devices

Developed against a **Dreame `r2532a`** (X50 Ultra Complete, EU region, firmware 4.3.9_2199). Other models may work — the auth and transport layer should be model-agnostic — but the property/action catalogue in `miot-spec.ts` is partly verified on r2532a and partly inherited from [Tasshack/dreame-vacuum](https://github.com/Tasshack/dreame-vacuum) (older Dreames on Mi cloud).

### Coverage status

This is **a partial mapping, not a complete one**. We've prioritised the surface most useful for home-automation integration (dock settings, OTA, schedules, a handful of actions), but large parts of the device's feature set haven't been observed yet.

Roughly:

- **Well-mapped:** auth + transport, MQTT event channels, dock settings, OTA flow, the global Custom-mode schedule format, basic battery/charge/state.
- **Partly mapped:** MIoT state enum (we have all the keyDefine translations, but only a subset have been observed in real transitions); FEATURE_CONFIG_JSON keys (3 of ~36 confirmed by toggle, the rest documented by name only).
- **Hardly touched:** actual cleaning runs, room-targeted cleaning behaviour, per-room schedule packing, the `0xC249` middle bits of the global Custom-mode int, voice configuration, DND scheduling, error-code catalogue, AI object-detection class IDs, the siid 6 / siid 99 binary blobs (likely live map + telemetry), and the many siid 4 piids we never observed move.

Each entry in `src/miot-spec.ts` is annotated:

- `// VERIFIED <date>` — observed working on r2532a
- `// ASSUMED from <source>` — borrowed from another project, not yet confirmed on r2532a

If a behaviour you care about isn't VERIFIED, treat it as a guess. If you exercise something new, please contribute the finding back — the methodology is documented in [`docs/spec-discovery-methodology.md`](./docs/spec-discovery-methodology.md) and the long-running logger in `examples/log-events.ts` makes it cheap to add observations.

### Known specifically-verified pieces

- Auth + device discovery + MQTT subscription
- Typed event channels: `properties_changed`, `props` (incl. OTA), `_otc.info`
- Property reads (state, error, battery, charging, suction, water, cleaning_mode raw, task_status raw, volume, consumables, firmware build, serial, timezone, off-peak charging window, DND windows, feature toggles JSON, version metadata)
- Property writes (round-trip verified)
- Actions: `LOCATE`, `TEST_SOUND`, `CLEAR_WARNING` only
- Full OTA cycle (download → install → reboot → re-online → version flip)
- All dock settings reachable from the Dreamehome app's "Base Station" menu (mop wash temp/water level/wetness, drying mode, hair compression, smart-mode master, mast control, auto-empty frequency)
- All cleaning behaviour settings reachable from the app's "Cleaning Settings" menu (carpet handling mode + sub-options, child lock, resume cleaning, power-saving, obstacle crossing mode, AI obstacle bitfield partial)
- Cleaning-schedule string format (CleanGenius preset + Custom-global; Custom per-room is structural only — see [issue #1](https://github.com/malard/node-dreame/issues/1))
- Scale Inhibitor consumable (`siid 31`) on top of brush/filter/sensor
- `DreameDeviceOfflineError` distinguished from other API errors
- 11 of ~36 `FEATURE_CONFIG_KEYS` confirmed by toggle (the rest documented by name only)

### Known specifically-NOT-verified pieces

- Actions `START`, `PAUSE`, `STOP`, `CHARGE`/dock, `START_AUTO_EMPTY`, `START_WASHING`, all `RESET_*` — wired with Tasshack's older-model siid:aiid values, but no live test
- `SuctionLevel`, `WaterVolume`, `ChargingStatus`, `CleaningMode` enum behaviour during actual cleaning (settings reads work; downstream effects untested)
- `TASK_STATUS` (siid 4 piid 1) — raw int only; values 3, 6, 13, 14, 17, 23 observed in different states without a clean mapping
- `CleaningMode` (siid 4 piid 23) — known to be a packed bitfield on r2532a (raw 5120 in baseline); not decoded
- Per-room schedule packed-int format ([issue #1](https://github.com/malard/node-dreame/issues/1))
- AI obstacle bitfield (`siid 4 piid 22`) — partial decoding only; bits 1, 2, 4 verified, bits 0, 3, 5-8 unknown
- `0xC249` middle bits of the Custom-mode global schedule int
- The `siid 99 piid 98` and `siid 6 piid 1` compressed blobs (likely telemetry + live map)
- AI object-detection class catalog (we see bbox class id 160 repeatedly; other class IDs not observed)
- Most of the `FEATURE_CONFIG_KEYS` (~25 still documented by name only)
- A real cleaning run — none triggered via the lib

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
