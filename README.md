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

Built and tested against a **Dreame `r2532a`** (X50 Ultra Complete, EU region, firmware 4.3.9_2199). Other models may work — the auth and transport layer should be model-agnostic — but the property/action catalogue in `miot-spec.ts` is partly verified on r2532a and partly inherited from [Tasshack/dreame-vacuum](https://github.com/Tasshack/dreame-vacuum) (older Dreames on Mi cloud).

### What's verified vs assumed

Each entry in `src/miot-spec.ts` is annotated:

- `// VERIFIED <date>` — observed working on r2532a in front of us
- `// ASSUMED from <source>` — borrowed; not yet confirmed on r2532a

Confirmed VERIFIED on r2532a:

- Auth + device discovery
- MQTT subscription incl. typed `properties_changed`, `props`, `_otc.info`, OTA progress channel
- Property reads: state, error, battery, charging, suction, water, cleaning_mode (raw), task_status (raw), volume, consumables, firmware build, serial, timezone, DND config JSON, feature toggles JSON, version metadata
- Property writes: round-trip no-op write
- Actions: `LOCATE`, `TEST_SOUND`, `CLEAR_WARNING`
- The `MiotState` enum (siid 2 piid 1) — values 13, 14, 2, 6 transitions confirmed live during an OTA cycle
- OTA observation end-to-end (download → install → reboot → re-online → version flip from `4.3.9_2033` → `4.3.9_2199`) via the `props` channel
- `DreameDeviceOfflineError` (cloud code 80001) distinguished from other API errors

ASSUMED (works on older Dreames, untested on r2532a):

- Actions: `START`, `PAUSE`, `STOP`, `CHARGE`/dock, `START_AUTO_EMPTY`, all reset actions
- Enums: `SuctionLevel`, `WaterVolume`, `ChargingStatus`, `CleaningMode` (the last is known to be a packed bitfield on r2532a — raw int returned 5120; the simple 0–3 enum doesn't apply)
- The `TASK_STATUS` field at siid 4 piid 1 — we read it as a raw int but have no enum mapping for r2532a (Tasshack's older-model values do not match observation)

If you adopt this for another model, please contribute back what you verify.

## Reverse-engineering notes

For implementers (and for AI agents extending the spec), [`docs/`](./docs) contains:

- [`auth-flow.md`](./docs/auth-flow.md) — endpoint URLs, headers, request/response shapes for auth + device list + MQTT
- [`ota-flow.md`](./docs/ota-flow.md) — observed timeline + envelope shapes from a real firmware update, including the OTA `props` channel and the `dowloaded` typo
- [`spec-discovery-methodology.md`](./docs/spec-discovery-methodology.md) — how the property/action catalogue was assembled from a live device, with all the verified mappings and what's still unknown

## License

MIT — see [LICENSE](./LICENSE).

## Acknowledgements

The MIoT property/action enum structure is informed by [Tasshack's dreame-vacuum](https://github.com/Tasshack/dreame-vacuum) (Mi cloud). This library does not share code with it.
