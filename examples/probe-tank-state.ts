/**
 * Probe: find which dock-cluster pIIDs reflect tank-fill state.
 *
 * Driven by issue #3.
 *
 * Two halves:
 *
 * 1. Passive MQTT capture — subscribe and log everything the device
 *    pushes for ~60s. When a tank is empty / wastewater is full, the
 *    device often pushes a dock-status event spontaneously.
 *
 * 2. Active sweep — getProperties across siid 15/27/28 in small
 *    chunks. On r2532a the cloud's HTTP ack frequently 80001s; we
 *    log the no-ack and keep going. Any MQTT response from those
 *    sweeps lands in the passive log via the kept-open subscription.
 *
 * Tag the run with the physical state (argv[2]):
 *   npx tsx examples/probe-tank-state.ts clean-water-empty
 *
 * JSONL on stdout; tee to a file then diff between physical states.
 *
 * Requires DREAME_EMAIL / DREAME_PASSWORD.
 */

import { DreameClient, DreameDeviceOfflineError } from "../src/index.js";

const TAG = process.argv[2] ?? "untagged";
const SIIDS = [15, 27, 28];
const PIID_MAX = 70;
const CHUNK = 5;
const RETRIES = 4;
const RETRY_BACKOFF_MS = 4_000;
const PASSIVE_MS = 10_000;
const POST_SWEEP_MS = 15_000;

function emit(rec: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), tag: TAG, ...rec })}\n`);
}

const dreame = new DreameClient({
  email: process.env["DREAME_EMAIL"]!,
  password: process.env["DREAME_PASSWORD"]!,
  region: "eu",
});

await dreame.login();
const devices = await dreame.getDevices();
if (devices.length === 0) {
  console.error("no devices on account");
  process.exit(1);
}
const device = devices[0]!;
emit({ kind: "device", did: device.did, model: device.model, online: device.online });

const sub = await dreame.subscribe(device);
emit({ kind: "mqtt-subscribed", topic: sub.topic });

sub.on("message", (raw) => emit({ kind: "mqtt-raw", raw }));
sub.on("properties", (changes) => emit({ kind: "mqtt-properties", changes }));
sub.on("event", (ev) => emit({ kind: "mqtt-event", ev }));
sub.on("props", (p) => emit({ kind: "mqtt-props", p }));
sub.on("info", (info) => emit({ kind: "mqtt-info", info }));
sub.on("error", (err) => emit({ kind: "mqtt-error", message: err.message }));

emit({ kind: "phase", msg: `passive capture ${PASSIVE_MS}ms` });
await new Promise((r) => setTimeout(r, PASSIVE_MS));

const probes: { siid: number; piid: number }[] = [];
for (const siid of SIIDS) {
  for (let piid = 1; piid <= PIID_MAX; piid++) {
    probes.push({ siid, piid });
  }
}
emit({ kind: "phase", msg: `active sweep ${probes.length} pairs in chunks of ${CHUNK}` });

for (let i = 0; i < probes.length; i += CHUNK) {
  const batch = probes.slice(i, i + CHUNK);
  let succeeded = false;
  for (let attempt = 0; attempt < RETRIES && !succeeded; attempt++) {
    try {
      const results = await dreame.getProperties(device.did, batch);
      for (const r of results) {
        emit({
          kind: "prop",
          siid: r.siid,
          piid: r.piid,
          code: r.code,
          value: r.code === 0 ? r.value : undefined,
        });
      }
      succeeded = true;
    } catch (err) {
      if (err instanceof DreameDeviceOfflineError) {
        emit({ kind: "batch-no-ack", offset: i, attempt });
        await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
      } else {
        emit({ kind: "batch-error", offset: i, message: (err as Error).message });
        break;
      }
    }
  }
  if (!succeeded) {
    emit({ kind: "batch-gave-up", offset: i, size: batch.length });
  }
}

emit({ kind: "phase", msg: `post-sweep passive ${POST_SWEEP_MS}ms` });
await new Promise((r) => setTimeout(r, POST_SWEEP_MS));

await sub.close();
emit({ kind: "phase", msg: "done" });
process.exit(0);
