/**
 * Long-running logger — records every property change pushed by the device,
 * every raw MQTT envelope, and any change in the device-list `ver` field
 * (firmware version) to a JSONL file.
 *
 * Usage:
 *   DREAME_EMAIL=… DREAME_PASSWORD=… npx tsx examples/log-events.ts [outfile]
 *
 * Output schema, one JSON per line:
 *   { "ts": ISO, "kind": "property",      "siid", "piid", "value", "prevValue", "source" }
 *   { "ts": ISO, "kind": "mqtt-envelope", "method", "raw" }
 *   { "ts": ISO, "kind": "device-list",   "did", "ver", "online", "raw" }
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

const last = new Map<string, unknown>();
let lastVer = String(device.raw["ver"] ?? "");

function write(record: Record<string, unknown>): void {
  fs.appendFileSync(outfile, JSON.stringify(record) + "\n", "utf8");
}

function logProperty(
  siid: number,
  piid: number,
  value: unknown,
  source: "refresh" | "mqtt",
): void {
  const key = `${siid}.${piid}`;
  const prev = last.has(key) ? last.get(key) : null;
  const same = prev !== undefined && JSON.stringify(prev) === JSON.stringify(value);
  if (same && source === "mqtt") {
    return;
  }
  last.set(key, value);
  const record = {
    ts: new Date().toISOString(),
    kind: "property" as const,
    siid,
    piid,
    value,
    prevValue: prev,
    source,
  };
  write(record);
  if (!same) {
    const arrow = prev !== null && prev !== undefined ? `${JSON.stringify(prev)} → ` : "";
    console.log(
      `[${record.ts}] ${source.padEnd(7)} ${key.padStart(5)}  ${arrow}${JSON.stringify(value)}`,
    );
  }
}

// ─── seed: probe siid 1..30 piid 1 to discover services, then read piid 1..50 of each ──

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
    logProperty(r.siid, r.piid, r.value, "refresh");
  }
}

for (const s of seedSiids) {
  const probes = [];
  for (let p = 1; p <= 50; p++) {
    if (s === seedSiids[0] && p === 1) {
      continue;
    }
    probes.push({ siid: s, piid: p });
  }
  const chunkSize = 20;
  for (let i = 0; i < probes.length; i += chunkSize) {
    const chunk = probes.slice(i, i + chunkSize);
    try {
      const res = await dreame.getProperties(device.did, chunk);
      for (const r of res) {
        if (r.code === 0 && r.value !== undefined) {
          logProperty(r.siid, r.piid, r.value, "refresh");
        }
      }
    } catch (e) {
      console.error(`siid ${s} chunk ${i} read failed:`, (e as Error).message);
    }
  }
}

console.log(`baseline complete — ${last.size} properties seeded`);
write({ ts: new Date().toISOString(), kind: "device-list", did: device.did, ver: lastVer, online: device.online, raw: device.raw });

// ─── live MQTT ─────────────────────────────────────────────────────

const sub = await dreame.subscribe(device);
console.log(`subscribed: ${sub.topic}`);

// Property changes (typed).
sub.on("properties", (changes) => {
  for (const c of changes) {
    logProperty(c.siid, c.piid, c.value, "mqtt");
  }
});

// EVERY raw envelope, including OTA-progress / non-properties_changed methods.
sub.on("message", (raw) => {
  const method = raw.data?.method ?? "(no-method)";
  // properties_changed is already covered by the typed handler — log everything else.
  if (method === "properties_changed") {
    return;
  }
  write({ ts: new Date().toISOString(), kind: "mqtt-envelope", method, raw });
  console.log(`[${new Date().toISOString()}] envelope method=${method}`);
});

sub.on("error", (err) => console.error("[mqtt error]", err.message));
sub.on("close", () => console.log("[mqtt close — will auto-reconnect]"));
sub.on("connect", () => console.log("[mqtt connect]"));

// ─── periodic property re-read (5 min) — defends against truncated MQTT ─────

setInterval(async () => {
  try {
    const probes = [...last.keys()].map((k) => {
      const [s, p] = k.split(".").map(Number);
      return { siid: s as number, piid: p as number };
    });
    const res = await dreame.getProperties(device.did, probes);
    for (const r of res) {
      if (r.code === 0 && r.value !== undefined) {
        logProperty(r.siid, r.piid, r.value, "refresh");
      }
    }
  } catch (e) {
    console.error("[periodic property refresh failed]", (e as Error).message);
  }
}, 5 * 60_000);

// ─── periodic device-list poll (30 s) — catches ver / online changes ───────

setInterval(async () => {
  try {
    const devs = await dreame.getDevices();
    const cur = devs.find((d) => d.did === device.did);
    if (!cur) {
      return;
    }
    const v = String(cur.raw["ver"] ?? "");
    if (v !== lastVer || cur.online !== device.online) {
      console.log(`[device-list] ver ${lastVer} → ${v}, online=${cur.online}`);
      lastVer = v;
      write({
        ts: new Date().toISOString(),
        kind: "device-list",
        did: cur.did,
        ver: v,
        online: cur.online,
        raw: cur.raw,
      });
    }
  } catch (e) {
    console.error("[device-list poll failed]", (e as Error).message);
  }
}, 30_000);

process.on("SIGINT", async () => {
  console.log("\nshutting down ...");
  await sub.close();
  process.exit(0);
});
