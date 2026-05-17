/**
 * Wake the device with a benign action, then snapshot everything it pushes.
 *
 * Background: the X50 sits silent on the dock (no MQTT pushes) and HTTP
 * `getProperties` 80001s ~95% of the time when idle. The action-trigger
 * technique from `reference_action_trigger_probe` is the only reliable
 * way to surface current state.
 *
 * Plan:
 *  1. Watch MQTT
 *  2. Fire `locate()` — robot beeps, doesn't move. Forces the device to
 *     respond and dumps the surrounding state.
 *  3. Fire `clearWarning()` — also benign, may clear or surface a sticky
 *     error code.
 *  4. Capture every property push, every event, every raw MQTT message
 *     for ~30s.
 *  5. Then issue ONE focused HTTP probe for our highest-priority piids
 *     (error code, task status, message prompts, stuck flag).
 *
 * Output: JSONL, then a "summary" block at the end with deduped
 * properties seen, sorted by (siid, piid), with values.
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
const device = devices[0]!;
emit({ kind: "device", did: device.did, model: device.model, online: device.online });

const vacuum = new Vacuum(dreame, device);
await vacuum.watch();
emit({ kind: "phase", msg: "watch() up" });

// Raw passive subscription side-channel.
const seen = new Map<string, { value: unknown; ts: string }>();
const rawSub = await dreame.subscribe(device);
rawSub.on("message", (raw) => emit({ kind: "raw", raw }));
rawSub.on("properties", (changes) => {
  for (const c of changes) {
    seen.set(`${c.siid}.${c.piid}`, { value: c.value, ts: new Date().toISOString() });
  }
  emit({ kind: "properties_changed", changes });
});
rawSub.on("event", (ev) => emit({ kind: "event_occured", ev }));
rawSub.on("info", (info) => emit({ kind: "info", info }));
rawSub.on("ota", (o) => emit({ kind: "ota", o }));

vacuum.on("change", (state: VacuumState) => emit({ kind: "vacuum-state", state }));
vacuum.on("taskLifecycle", (lc) => emit({ kind: "taskLifecycle", lc }));
vacuum.on("taskComplete", (rec) => emit({ kind: "taskComplete", rec }));
vacuum.on("error", (err) => emit({ kind: "vacuum-error", message: err.message }));

// Passive listen for 8s — gather any spontaneous push first.
emit({ kind: "phase", msg: "passive 8s" });
await new Promise((r) => setTimeout(r, 8_000));

// ── Wake the device with benign locate() ─────────────────────────────
emit({ kind: "phase", msg: "locate() — robot will beep, not move" });
try {
  const res = await vacuum.locate();
  emit({ kind: "locate-result", kindRes: res.kind });
} catch (err) {
  emit({ kind: "locate-error", message: (err as Error).message });
}
await new Promise((r) => setTimeout(r, 5_000));

// ── Then clearWarning ───────────────────────────────────────────────
emit({ kind: "phase", msg: "clearWarning()" });
try {
  const res = await vacuum.clearWarning();
  emit({ kind: "clearWarning-result", kindRes: res.kind });
} catch (err) {
  emit({ kind: "clearWarning-error", message: (err as Error).message });
}
await new Promise((r) => setTimeout(r, 5_000));

// ── refresh() now that device is awake ──────────────────────────────
emit({ kind: "phase", msg: "refresh()" });
try {
  const res = await vacuum.refresh({ timeoutMs: 15_000 });
  emit({ kind: "refresh-result", kindRes: res.kind, state: res.state });
} catch (err) {
  emit({ kind: "refresh-error", message: (err as Error).message });
}

// ── fetchTotals so we can see whether a task ran today/yesterday ────
emit({ kind: "phase", msg: "fetchTotals()" });
try {
  const tot = await vacuum.fetchTotals({ timeoutMs: 15_000 });
  emit({ kind: "totals", tot });
} catch (err) {
  emit({ kind: "totals-error", message: (err as Error).message });
}

// ── Focused HTTP probes for the priority piids ──────────────────────
//
// We previously saw these piids carry the most informative signals,
// so pin them down even if 80001 happens elsewhere.
const FOCUSED: Array<{ siid: number; piid: number; label: string }> = [
  { siid: 2, piid: 1, label: "MiotState" },
  { siid: 2, piid: 2, label: "ErrorCode" },
  { siid: 2, piid: 6, label: "MopPadsState" },
  { siid: 3, piid: 1, label: "Battery" },
  { siid: 3, piid: 2, label: "ChargingStatus" },
  { siid: 4, piid: 1, label: "TaskStatus" },
  { siid: 4, piid: 7, label: "StepIndicator" },
  { siid: 4, piid: 18, label: "ErrorStrMirror" },
  { siid: 4, piid: 25, label: "TaskPhase" },
  { siid: 4, piid: 56, label: "NumericMessagePrompt" },
  { siid: 4, piid: 57, label: "MessagePrompt" },
  { siid: 4, piid: 63, label: "TaskProgressPct" },
  { siid: 4, piid: 64, label: "TaskResetCounter" },
  { siid: 8, piid: 2, label: "Schedule_Slot1" },
  { siid: 14, piid: 4, label: "StuckNotificationActive" },
  { siid: 15, piid: 1, label: "AutoEmptyFrequency" },
  { siid: 15, piid: 3, label: "AutoEmpty_OnDockFlag" },
  { siid: 28, piid: 4, label: "MotionFlag" },
  { siid: 99, piid: 17, label: "FirmwareInfoLine" },
];

emit({ kind: "phase", msg: `focused HTTP probe x${FOCUSED.length}` });
for (const p of FOCUSED) {
  let acked = false;
  for (let attempt = 0; attempt < 4 && !acked; attempt++) {
    try {
      const results = await dreame.getProperties(device.did, [{ siid: p.siid, piid: p.piid }]);
      const r = results[0];
      if (r) {
        emit({
          kind: "focused",
          label: p.label,
          siid: p.siid,
          piid: p.piid,
          code: r.code,
          value: r.code === 0 ? r.value : undefined,
        });
      }
      acked = true;
    } catch (err) {
      if (err instanceof DreameDeviceOfflineError) {
        emit({ kind: "focused-no-ack", label: p.label, attempt });
        await new Promise((r) => setTimeout(r, 2_500));
      } else {
        emit({ kind: "focused-error", label: p.label, message: (err as Error).message });
        break;
      }
    }
  }
  if (!acked) {
    emit({ kind: "focused-gave-up", label: p.label });
  }
}

// ── Final passive window to catch any tail-end pushes ───────────────
emit({ kind: "phase", msg: "tail passive 10s" });
await new Promise((r) => setTimeout(r, 10_000));

const summary = Array.from(seen.entries())
  .map(([k, v]) => {
    const [siid, piid] = k.split(".").map(Number);
    return { siid, piid, value: v.value, ts: v.ts };
  })
  .sort((a, b) => a.siid - b.siid || a.piid - b.piid);
emit({
  kind: "summary",
  pushed_unique: summary.length,
  pushed: summary,
  current_state: vacuum.state,
  known_miot_error_codes: Object.entries(MiotError).filter(
    ([k]) => Number.isNaN(Number(k)),
  ),
});

await rawSub.close();
await vacuum.unwatch();
emit({ kind: "phase", msg: "done" });
process.exit(0);
