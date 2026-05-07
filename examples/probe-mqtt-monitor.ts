/**
 * One-shot live capture: subscribes via MQTT and logs every property
 * change and every raw envelope (including non-`properties_changed`
 * methods) to a JSONL file, with a one-line console summary per event.
 *
 * Skips the baseline property poll that `log-events.ts` does, because
 * code 80001 ("offline / command timed out") often blows up the seed
 * even when MQTT is live — see project memory `project_node_dreame_status`.
 *
 * Usage:
 *   npx tsx examples/probe-mqtt-monitor.ts [outfile]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { DreameClient } from "../src/index.js";

const outfile = process.argv[2] ?? path.resolve("dreame-events.jsonl");

const dreame = new DreameClient({
  email: process.env.DREAME_EMAIL!,
  password: process.env.DREAME_PASSWORD!,
  region: "eu",
});

const device = (await dreame.getDevices())[0];
if (!device) {
  console.error("no devices on account");
  process.exit(1);
}

console.log(`monitoring ${device.name} (${device.model}, did=${device.did})`);
console.log(`outfile: ${outfile}`);

function write(record: Record<string, unknown>): void {
  fs.appendFileSync(outfile, JSON.stringify(record) + "\n", "utf8");
}

const sub = await dreame.subscribe(device);
console.log(`subscribed: ${sub.topic}`);

sub.on("properties", (changes) => {
  for (const c of changes) {
    const ts = new Date().toISOString();
    write({ ts, kind: "property", siid: c.siid, piid: c.piid, value: c.value });
    console.log(`[${ts}] prop  ${c.siid}.${c.piid}  ${JSON.stringify(c.value)}`);
  }
});

sub.on("message", (raw) => {
  const method = raw.data?.method ?? "(no-method)";
  if (method === "properties_changed") {
    return;
  }
  const ts = new Date().toISOString();
  write({ ts, kind: "mqtt-envelope", method, raw });
  console.log(`[${ts}] envelope method=${method}`);
});

sub.on("error", (err) => console.error("[mqtt error]", err.message));
sub.on("close", () => console.log("[mqtt close — auto-reconnect]"));
sub.on("connect", () => console.log("[mqtt connect]"));

process.on("SIGINT", async () => {
  console.log("\nshutting down ...");
  await sub.close();
  process.exit(0);
});
