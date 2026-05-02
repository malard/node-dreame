/**
 * Long-running logger — records every property change pushed by the device
 * to a JSONL file, plus prints a one-line summary of each transition.
 *
 * Use this to nail down enum/bitfield meanings empirically. Start it,
 * then operate the robot normally (start a job, change suction, dock,
 * trigger a mop wash) and post-process the logfile to see what each
 * property moved through.
 *
 * Usage:
 *   DREAME_EMAIL=… DREAME_PASSWORD=… npx tsx examples/log-events.ts [outfile]
 *
 * Output schema, one JSON per line:
 *   {
 *     "ts":       ISO 8601 timestamp,
 *     "siid":     int,
 *     "piid":     int,
 *     "value":    any,
 *     "prevValue": any (null on first observation),
 *     "source":   "refresh" | "mqtt"
 *   }
 *
 * The first batch on startup is a full refresh of every known property
 * (source=refresh) so we have a baseline. Everything after is MQTT
 * push (source=mqtt), only emitted when the value actually changes.
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

console.log(`logging events for ${device.name} (${device.model}, did=${device.did})`);
console.log(`outfile: ${outfile}`);

// Track last-known value per "siid.piid" so we only log transitions.
const last = new Map<string, unknown>();

function append(
  siid: number,
  piid: number,
  value: unknown,
  source: "refresh" | "mqtt",
): void {
  const key = `${siid}.${piid}`;
  const prev = last.has(key) ? last.get(key) : null;
  if (prev !== undefined && JSON.stringify(prev) === JSON.stringify(value) && source === "mqtt") {
    return;
  }
  last.set(key, value);
  const record = {
    ts: new Date().toISOString(),
    siid,
    piid,
    value,
    prevValue: prev,
    source,
  };
  fs.appendFileSync(outfile, JSON.stringify(record) + "\n", "utf8");
  const arrow = prev !== null && prev !== undefined ? `${JSON.stringify(prev)} → ` : "";
  console.log(
    `[${record.ts}] ${source.padEnd(7)} ${key.padStart(5)}  ${arrow}${JSON.stringify(value)}`,
  );
}

// ─── seed: probe siid 1..30 piid 1 to discover services, then read piid 1..30 of each ──

console.log("seeding baseline ...");
const seedSiids: number[] = [];
const seedProbes = [];
for (let s = 1; s <= 30; s++) {
  seedProbes.push({ siid: s, piid: 1 });
}
const seedRes = await dreame.getProperties(device.did, seedProbes);
for (const r of seedRes) {
  if (r.code === 0 && r.value !== undefined) {
    seedSiids.push(r.siid);
    append(r.siid, r.piid, r.value, "refresh");
  }
}

// For each existing siid, sweep piid 1..50 to capture the full property table.
for (const s of seedSiids) {
  const probes = [];
  for (let p = 1; p <= 50; p++) {
    if (s === seedSiids[0] && p === 1) {
      // already captured
      continue;
    }
    probes.push({ siid: s, piid: p });
  }
  // Chunk into batches of 20 to avoid overlong requests.
  const chunkSize = 20;
  for (let i = 0; i < probes.length; i += chunkSize) {
    const chunk = probes.slice(i, i + chunkSize);
    try {
      const res = await dreame.getProperties(device.did, chunk);
      for (const r of res) {
        if (r.code === 0 && r.value !== undefined) {
          append(r.siid, r.piid, r.value, "refresh");
        }
      }
    } catch (e) {
      console.error(`siid ${s} chunk ${i} read failed:`, (e as Error).message);
    }
  }
}

console.log(`baseline complete — ${last.size} properties seeded`);

// ─── live: subscribe and stream ────────────────────────────────────

const sub = await dreame.subscribe(device);
console.log(`subscribed: ${sub.topic}`);

sub.on("properties", (changes) => {
  for (const c of changes) {
    append(c.siid, c.piid, c.value, "mqtt");
  }
});
sub.on("error", (err) => console.error("[mqtt error]", err.message));
sub.on("close", () => console.log("[mqtt close — will auto-reconnect]"));
sub.on("connect", () => console.log("[mqtt connect]"));

// Periodic refresh every 5 min in case we missed any pushes (broker truncates >4KB).
setInterval(async () => {
  try {
    const probes = [...last.keys()].map((k) => {
      const [s, p] = k.split(".").map(Number);
      return { siid: s as number, piid: p as number };
    });
    const res = await dreame.getProperties(device.did, probes);
    for (const r of res) {
      if (r.code === 0 && r.value !== undefined) {
        append(r.siid, r.piid, r.value, "refresh");
      }
    }
  } catch (e) {
    console.error("[periodic refresh failed]", (e as Error).message);
  }
}, 5 * 60_000);

// Graceful shutdown on Ctrl-C.
process.on("SIGINT", async () => {
  console.log("\nshutting down ...");
  await sub.close();
  process.exit(0);
});
