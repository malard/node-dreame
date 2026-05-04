/**
 * Canonical "is my MQTT subscription actually receiving pushes?" check.
 *
 * Thin wrapper around `Vacuum.verifyMqtt()` that prints the result with
 * a human-readable verdict and the raw `getDevices` JSON for the first
 * device — the latter is useful when filing a bug ("here's exactly
 * what the cloud sees about my account") or when investigating whether
 * a future protocol revision adds a new field the lib should pick up
 * (look for any topic-shaped string we're not using).
 *
 * Run:
 *   npx tsx examples/probe-mqtt-verify.ts
 *
 * Requires `DREAME_EMAIL` / `DREAME_PASSWORD` in the environment — see
 * memory `reference_dreame_env.md` for the canonical loader.
 */
import { DreameClient } from "../src/index.js";

const dreame = new DreameClient({
  email: process.env["DREAME_EMAIL"]!,
  password: process.env["DREAME_PASSWORD"]!,
  region: "eu",
});

const devices = await dreame.getDevices();
if (devices.length === 0) {
  console.error("no devices on account");
  process.exit(1);
}
const device = devices[0]!;

console.log("=== device record (raw getDevices entry) ===");
console.log(JSON.stringify(device.raw, null, 2));
console.log("");
console.log(`device.did    = ${device.did}`);
console.log(`device.model  = ${device.model}`);
console.log(`device.online = ${device.online}  (cloud-cached — not always real-time)`);
console.log("");

const vacuum = dreame.getVacuum(device);
await vacuum.watch();
console.log("opened MQTT subscription, calling vacuum.verifyMqtt()…");
console.log("");

const result = await vacuum.verifyMqtt({ timeoutMs: 15000 });

console.log("=== verifyMqtt result ===");
console.log(JSON.stringify(result, null, 2));
console.log("");

console.log("=== verdict ===");
switch (result.reason) {
  case "ok":
    console.log(`PASS — broker echoed back in ${result.echoMs}ms.`);
    console.log("MQTT push channel is healthy. Live state pushes will flow whenever");
    console.log("the device decides to push them. For the live-map case, use");
    console.log("vacuum.map.whenReady() to actively provoke a fresh I-frame.");
    break;
  case "no-echo":
    console.log("FAIL — no-echo.");
    console.log("No properties_changed echo arrived within the timeout. Either the");
    console.log("device is genuinely unreachable (powered off, network lost, mid-");
    console.log("reboot) or it's responsive but didn't generate an echo for the");
    console.log("no-op write. Try waking the device (open the Dreamehome app and");
    console.log("tap a control) and re-run. Note: the cloud's HTTP code 80001");
    console.log("(\"device offline\") is IGNORED by verifyMqtt because it's a false");
    console.log("negative on healthy devices — see DreameDeviceOfflineError docs.");
    break;
  case "not-watching":
    console.log("FAIL — not-watching.");
    console.log("vacuum.watch() didn't open a subscription. Check for an earlier error.");
    break;
}

await vacuum.unwatch();
process.exit(result.reason === "ok" ? 0 : 1);
