/**
 * Probe: find which property carries the "paused because clean-water tank
 * empty" reason during a MID-TASK pause (GitHub issue #11).
 *
 * Issue #3 covered the START-REFUSAL case: firing start() with an empty
 * tank latches `MiotError.CleanWaterTankEmpty = 107` on ERROR (siid 2
 * piid 2) + FAULTS_STR (siid 4 piid 18) within ~1s. That path works.
 *
 * Issue #11 is the sibling: the tank runs empty MID-TASK, the device goes
 * to `MiotState.PausedCleaning = 21`, but errorCode / faults stay empty
 * and no `taskLifecycle: aborted` fires. We need the property that the
 * Dreamehome app reads to show "low water level in clean water tank".
 *
 * Three things this probe captures, tagged with the physical state:
 *
 *   1. A targeted read of the reason-candidate properties (TASK_STATUS,
 *      the two MESSAGE_PROMPT channels, STEP_INDICATOR, TASK_PHASE, the
 *      error pair, STATE, STUCK). These are the fields most likely to
 *      discriminate a needs-attention pause from a normal user pause.
 *   2. A dock-cluster sweep (siid 27/28) for a graded clean-water-level
 *      property (issue #3 deferred for lack of a graded fill code).
 *   3. OPTIONAL `--trigger`: fire resume() (same wire call as start()).
 *      Hypothesis — resuming while the tank is still empty re-triggers
 *      the start-refusal path and surfaces 107 on ERROR/FAULTS_STR, the
 *      same way #3 found it. If so, the consumer's "why is it paused?"
 *      answer is recoverable on demand. A stop() safety net runs after.
 *
 * Usage (load DREAME_EMAIL/DREAME_PASSWORD into the shell first):
 *   # baseline — device docked / idle, tank full:
 *   npx tsx examples/probe-pause-reason.ts docked-tank-full
 *   # repro — device paused mid-task, clean-water tank just ran empty:
 *   npx tsx examples/probe-pause-reason.ts paused-tank-empty
 *   # repro + probe the resume-refusal:
 *   npx tsx examples/probe-pause-reason.ts paused-tank-empty --trigger
 *
 * JSONL on stdout; tee to a file per physical state then diff the two.
 */

import { DreameClient, DreameDeviceOfflineError } from "../src/index.js";
import { VACUUM_PROP, NOTIFICATION_PROP } from "../src/index.js";

const TAG = process.argv[2] ?? "untagged";
const TRIGGER = process.argv.includes("--trigger");

const RETRIES = 4;
const RETRY_BACKOFF_MS = 4_000;
const PASSIVE_MS = 10_000;
const TRIGGER_CAPTURE_MS = 30_000;

// The fields most likely to carry the pause reason, read by name so the
// output is self-documenting.
const CANDIDATES: { label: string; siid: number; piid: number }[] = [
  { label: "STATE", ...VACUUM_PROP.STATE },
  { label: "ERROR", ...VACUUM_PROP.ERROR },
  { label: "FAULTS_STR", ...VACUUM_PROP.FAULTS_STR },
  { label: "TASK_STATUS", ...VACUUM_PROP.TASK_STATUS },
  { label: "TASK_PHASE", ...VACUUM_PROP.TASK_PHASE },
  { label: "STEP_INDICATOR", ...VACUUM_PROP.STEP_INDICATOR },
  { label: "NUMERIC_MESSAGE_PROMPT", ...VACUUM_PROP.NUMERIC_MESSAGE_PROMPT },
  { label: "MESSAGE_PROMPT", ...VACUUM_PROP.MESSAGE_PROMPT },
  { label: "STUCK", ...NOTIFICATION_PROP.STUCK_NOTIFICATION_ACTIVE },
];

// Dock-cluster sweep — a graded clean-water-level property would live here.
const DOCK_SIIDS = [27, 28];
const DOCK_PIID_MAX = 40;
const CHUNK = 5;

function emit(rec: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), tag: TAG, ...rec })}\n`);
}

async function readBatch(
  dreame: DreameClient,
  did: string,
  batch: { siid: number; piid: number; label?: string }[],
): Promise<void> {
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const results = await dreame.getProperties(did, batch.map((b) => ({ siid: b.siid, piid: b.piid })));
      for (const r of results) {
        const label = batch.find((b) => b.siid === r.siid && b.piid === r.piid)?.label;
        emit({
          kind: "prop",
          label,
          siid: r.siid,
          piid: r.piid,
          code: r.code,
          value: r.code === 0 ? r.value : undefined,
        });
      }
      return;
    } catch (err) {
      if (err instanceof DreameDeviceOfflineError) {
        emit({ kind: "read-no-ack", attempt, size: batch.length });
        await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
      } else {
        emit({ kind: "read-error", message: (err as Error).message });
        return;
      }
    }
  }
  emit({ kind: "read-gave-up", size: batch.length });
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
sub.on("properties", (changes) => emit({ kind: "mqtt-properties", changes }));
sub.on("event", (ev) => emit({ kind: "mqtt-event", ev }));
sub.on("props", (p) => emit({ kind: "mqtt-props", p }));
sub.on("info", (info) => emit({ kind: "mqtt-info", info }));
sub.on("error", (err) => emit({ kind: "mqtt-error", message: err.message }));

emit({ kind: "phase", msg: `passive capture ${PASSIVE_MS}ms` });
await new Promise((r) => setTimeout(r, PASSIVE_MS));

emit({ kind: "phase", msg: "reading reason-candidate properties" });
await readBatch(dreame, device.did, CANDIDATES);

emit({ kind: "phase", msg: `dock-cluster sweep siid ${DOCK_SIIDS.join("/")} piid 1..${DOCK_PIID_MAX}` });
for (const siid of DOCK_SIIDS) {
  for (let piid = 1; piid <= DOCK_PIID_MAX; piid += CHUNK) {
    const batch = [];
    for (let p = piid; p < piid + CHUNK && p <= DOCK_PIID_MAX; p++) {
      batch.push({ siid, piid: p });
    }
    await readBatch(dreame, device.did, batch);
  }
}

if (TRIGGER) {
  const vacuum = dreame.getVacuum(device);
  emit({ kind: "phase", msg: "firing resume() — expect 107 refusal if tank still empty" });
  try {
    const result = await vacuum.resume();
    emit({ kind: "resume-result", result });
  } catch (err) {
    emit({ kind: "resume-threw", name: (err as Error).name, message: (err as Error).message });
  }
  emit({ kind: "phase", msg: `capturing MQTT for ${TRIGGER_CAPTURE_MS}ms` });
  await new Promise((r) => setTimeout(r, TRIGGER_CAPTURE_MS));
  emit({ kind: "phase", msg: "re-reading candidates after resume" });
  await readBatch(dreame, device.did, CANDIDATES);
  emit({ kind: "phase", msg: "firing stop() as safety net" });
  try {
    const result = await vacuum.stop();
    emit({ kind: "stop-result", result });
  } catch (err) {
    emit({ kind: "stop-threw", name: (err as Error).name, message: (err as Error).message });
  }
}

await sub.close();
emit({ kind: "phase", msg: "done" });
process.exit(0);
