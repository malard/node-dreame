/**
 * Probe: snapshot the device's complete known state right now,
 * after a real-world incident (stranded mid-job, battery went flat,
 * back on dock charging, no further cleaning).
 *
 * Goal: find every signal we DO have access to that we are NOT
 * currently surfacing in `VacuumState` / `MiotError` / events. Things
 * we expect to learn:
 *
 *  - Is there a sticky error code that has survived the deep-discharge
 *    cycle (e.g. a "stuck" or "rescue me" code), or does the device
 *    forget it the moment it docks again?
 *  - Is `NOTIFICATION_PROP.STUCK_NOTIFICATION_ACTIVE` (siid 14 piid 4)
 *    pinned right now?
 *  - Does the `MESSAGE_PROMPT` (siid 4 piid 57) or `NUMERIC_MESSAGE_PROMPT`
 *    (siid 4 piid 56) carry a human-readable hint that explains why
 *    the device is refusing to clean?
 *  - Does the task-status-or-phase machine sit in a non-idle int that
 *    we don't yet have catalogued?
 *  - Are there battery-health / low-battery / deep-discharge codes
 *    surfaced anywhere?
 *
 * Method: passive MQTT capture (no actions fired — we don't want to
 * start cleaning while the user is diagnosing), wide HTTP sweep across
 * every known and adjacent siid, full property refresh, then prompt the
 * device to push something useful by reading the noisy strings.
 *
 * Tag for filing the output:
 *   npx tsx examples/probe-post-stuck-state.ts
 */

import {
  DreameClient,
  DreameDeviceOfflineError,
  Vacuum,
  type VacuumState,
} from "../src/index.js";
import { MiotError } from "../src/miot-spec.js";

function emit(rec: Record<string, unknown>): void {
  process.stdout.write(
    `${JSON.stringify({ ts: new Date().toISOString(), ...rec })}\n`,
  );
}

const dreame = new DreameClient({
  email: process.env["DREAME_EMAIL"]!,
  password: process.env["DREAME_PASSWORD"]!,
  region: (process.env["DREAME_REGION"] as "eu" | "us" | "cn") ?? "eu",
});

await dreame.login();
const devices = await dreame.getDevices();
if (devices.length === 0) {
  console.error("no devices on account");
  process.exit(1);
}
const device = devices[0]!;
emit({
  kind: "device",
  did: device.did,
  model: device.model,
  online: device.online,
  fw: (device as unknown as { firmwareVersion?: string }).firmwareVersion,
});

// ─── Passive MQTT capture first ───────────────────────────────────────
const vacuum = new Vacuum(dreame, device);
await vacuum.watch();
emit({ kind: "phase", msg: "watch() up — collecting MQTT pushes" });

const seen: Array<{
  ts: string;
  siid: number;
  piid: number;
  value: unknown;
}> = [];
vacuum.on("change", (state: VacuumState) => emit({ kind: "state", state }));
vacuum.on("taskLifecycle", (lc) => emit({ kind: "taskLifecycle", lc }));
vacuum.on("taskComplete", (rec) => emit({ kind: "taskComplete", rec }));
vacuum.on("ota", (o) => emit({ kind: "ota", o }));
vacuum.on("mapInfo", (m) => emit({ kind: "mapInfo", m }));
vacuum.on("error", (err) => emit({ kind: "vacuum-error", message: err.message }));

// Tap raw MQTT for anything the high-level events filter out.
// Using the private subscription via verifyMqtt won't expose it, so
// re-subscribe a low-level listener via dreame.subscribe — but watch()
// already opened one. We add a side-channel listener through the
// existing subscription manager by attaching another subscriber.
const rawSub = await dreame.subscribe(device);
rawSub.on("message", (raw: unknown) => emit({ kind: "raw", raw }));
rawSub.on("properties", (changes) => {
  for (const c of changes) {
    seen.push({
      ts: new Date().toISOString(),
      siid: c.siid,
      piid: c.piid,
      value: c.value,
    });
  }
  emit({ kind: "properties_changed", changes });
});
rawSub.on("event", (ev) => emit({ kind: "event_occured", ev }));
rawSub.on("info", (info) => emit({ kind: "info", info }));

await new Promise((r) => setTimeout(r, 15_000));

// ─── HTTP refresh for the curated fast-path state ─────────────────────
emit({ kind: "phase", msg: "refresh()" });
try {
  const res = await vacuum.refresh({ timeoutMs: 12_000 });
  emit({ kind: "refresh", kindRes: res.kind, state: res.state });
} catch (err) {
  emit({ kind: "refresh-error", message: (err as Error).message });
}

emit({ kind: "phase", msg: "fetchTotals()" });
try {
  const tot = await vacuum.fetchTotals();
  emit({ kind: "totals", tot });
} catch (err) {
  emit({ kind: "totals-error", message: (err as Error).message });
}

// ─── Targeted reads for the post-stranding hypothesis ────────────────
//
// SIIDs of interest, with adjacent piid coverage to catch siblings we
// don't yet have catalogued:
//   - 2 (Vacuum core):       piid 1..30  → state, error, error-str-mirror, mop-pad
//   - 3 (Battery):           piid 1..10  → level, charging, off-peak json
//   - 4 (Task/cleaning):     piid 1..70  → task status, phase, errors, prompts, progress
//   - 12 (Totals):           piid 1..10  → lifetime stats
//   - 14 (Notifications):    piid 1..10  → stuck/attention flag
//   - 15 (Auto-empty):       piid 1..10
//   - 16 (Sensor maint):     piid 1..5
//   - 27,28 (Dock cluster):  piid 1..70  → mast, hot water, motion
//   - 99 (Diagnostic):       piid 1..120 → firmware build, AI models, usage counter
//
// piid 0 doesn't exist; we start at 1.

const PROBES: Array<{ siid: number; max: number }> = [
  { siid: 2, max: 30 },
  { siid: 3, max: 10 },
  { siid: 4, max: 90 },
  { siid: 12, max: 10 },
  { siid: 14, max: 10 },
  { siid: 15, max: 10 },
  { siid: 16, max: 5 },
  { siid: 27, max: 70 },
  { siid: 28, max: 70 },
  { siid: 99, max: 120 },
];

const CHUNK = 5;
const RETRIES = 3;
const RETRY_BACKOFF_MS = 4_000;

emit({
  kind: "phase",
  msg: `wide HTTP sweep, ${PROBES.reduce((s, p) => s + p.max, 0)} piids`,
});

for (const { siid, max } of PROBES) {
  const pairs: Array<{ siid: number; piid: number }> = [];
  for (let piid = 1; piid <= max; piid++) {
    pairs.push({ siid, piid });
  }
  for (let i = 0; i < pairs.length; i += CHUNK) {
    const batch = pairs.slice(i, i + CHUNK);
    let succeeded = false;
    for (let attempt = 0; attempt < RETRIES && !succeeded; attempt++) {
      try {
        const results = await dreame.getProperties(device.did, batch);
        for (const r of results) {
          if (r.code === 0 && r.value !== undefined && r.value !== null) {
            emit({
              kind: "prop",
              siid: r.siid,
              piid: r.piid,
              value: r.value,
            });
          } else if (r.code !== 0 && r.code !== -1 && r.code !== -704042001) {
            // Code -1 = piid doesn't exist; suppress to keep noise low.
            emit({
              kind: "prop-err",
              siid: r.siid,
              piid: r.piid,
              code: r.code,
            });
          }
        }
        succeeded = true;
      } catch (err) {
        if (err instanceof DreameDeviceOfflineError) {
          emit({ kind: "batch-no-ack", siid, offset: i, attempt });
          await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
        } else {
          emit({
            kind: "batch-error",
            siid,
            offset: i,
            message: (err as Error).message,
          });
          break;
        }
      }
    }
    if (!succeeded) {
      emit({ kind: "batch-gave-up", siid, offset: i, size: batch.length });
    }
  }
}

// ─── Post-sweep passive window so any MQTT echoes from the reads ──────
// (and any spontaneous "I need attention" pushes) land.
emit({ kind: "phase", msg: "post-sweep passive 20s" });
await new Promise((r) => setTimeout(r, 20_000));

emit({
  kind: "summary",
  pushed_props_during_passive: seen.length,
  current_state: vacuum.state,
  known_miot_error_codes: Object.entries(MiotError).filter(
    ([k]) => Number.isNaN(Number(k)),
  ),
});

await rawSub.close();
await vacuum.unwatch();
emit({ kind: "phase", msg: "done" });
process.exit(0);
