# node-dreame

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

This is being developed against a Dreame `r2532a`. Other models may need property mapping additions — contributions welcome.

## License

MIT — see [LICENSE](./LICENSE).

## Acknowledgements

The MIoT property/action enum structure is informed by [Tasshack's dreame-vacuum](https://github.com/Tasshack/dreame-vacuum) (Mi cloud). This library does not share code with it.
