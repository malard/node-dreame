/**
 * Probe: fire vacuum.start() while clean-water tank is empty, capture
 * everything the device says back via MQTT.
 *
 * Hypothesis (issue #3): the device will refuse to start and surface
 * the reason via a property change or event push — which would tell
 * us the exact siid/piid that reflects tank state.
 *
 * Run only when the dock physically has the clean-water tank empty.
 * If the device actually starts cleaning, the script also calls
 * stop() at the end as a safety net.
 */

import { DreameClient } from "../src/index.js";

const WINDOW_MS = 60_000;

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

emit({ kind: "phase", msg: "calling vacuum.start()" });
try {
  const result = await vacuum.start();
  emit({ kind: "start-result", result });
} catch (err) {
  emit({ kind: "start-threw", name: (err as Error).name, message: (err as Error).message });
}

emit({ kind: "phase", msg: `capturing MQTT for ${WINDOW_MS}ms` });
await new Promise((r) => setTimeout(r, WINDOW_MS));

emit({ kind: "phase", msg: "calling stop() as safety net" });
try {
  const result = await vacuum.stop();
  emit({ kind: "stop-result", result });
} catch (err) {
  emit({ kind: "stop-threw", name: (err as Error).name, message: (err as Error).message });
}

await sub.close();
emit({ kind: "phase", msg: "done" });
process.exit(0);
