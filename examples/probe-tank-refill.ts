/**
 * Probe: watch what the device pushes when the clean-water tank is
 * refilled and reinserted, then fire start() to confirm the refusal
 * (error 107) is gone.
 *
 * Workflow:
 *   1. Subscribe MQTT, log everything.
 *   2. Wait WATCH_MS — user refills the tank during this window.
 *   3. Fire vacuum.start(), capture POST_START_MS of pushes.
 *   4. Fire vacuum.stop() so we don't actually clean the house.
 *
 * Hypothesis: tank reinsertion produces a property push on a stable
 * pIID we can use as the "tank-OK" signal. Error 107 should clear
 * spontaneously (or at the latest, when start() is re-fired and
 * succeeds).
 */

import { DreameClient } from "../src/index.js";

const WATCH_MS = 60_000;
const POST_START_MS = 20_000;

function emit(rec: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...rec })}\n`);
}

const dreame = new DreameClient({
  email: process.env["DREAME_EMAIL"]!,
  password: process.env["DREAME_PASSWORD"]!,
  region: "eu",
});

await dreame.login();
const devices = await dreame.getDevices();
const device = devices[0]!;
emit({ kind: "device", did: device.did, model: device.model, online: device.online });

const sub = await dreame.subscribe(device);
emit({ kind: "mqtt-topic", topic: sub.topic });
sub.on("properties", (changes) => emit({ kind: "mqtt-properties", changes }));
sub.on("event", (ev) => emit({ kind: "mqtt-event", ev }));
sub.on("props", (p) => emit({ kind: "mqtt-props", p }));
sub.on("info", (info) => emit({ kind: "mqtt-info", info }));
sub.on("error", (err) => emit({ kind: "mqtt-error", message: err.message }));

const vacuum = dreame.getVacuum(device);

emit({ kind: "phase", msg: `PASSIVE WATCH — refill the tank now. capturing for ${WATCH_MS}ms` });
await new Promise((r) => setTimeout(r, WATCH_MS));

emit({ kind: "phase", msg: "calling vacuum.start()" });
try {
  const result = await vacuum.start();
  emit({ kind: "start-result", result });
} catch (err) {
  emit({ kind: "start-threw", message: (err as Error).message });
}

emit({ kind: "phase", msg: `capturing MQTT for ${POST_START_MS}ms` });
await new Promise((r) => setTimeout(r, POST_START_MS));

emit({ kind: "phase", msg: "calling stop()" });
try {
  const result = await vacuum.stop();
  emit({ kind: "stop-result", result });
} catch (err) {
  emit({ kind: "stop-threw", message: (err as Error).message });
}

emit({ kind: "phase", msg: "capturing post-stop 5s" });
await new Promise((r) => setTimeout(r, 5_000));

await sub.close();
emit({ kind: "phase", msg: "done" });
process.exit(0);
