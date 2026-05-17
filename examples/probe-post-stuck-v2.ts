/**
 * v2 — drop HTTP property reads, focus on cloud device-list + MQTT.
 *
 * Findings from v1:
 *  - Device IS reachable: `locate()` triggered an MQTT echo of
 *    `siid 4 piid 1 = 6` (TASK_STATUS = OnDockIdle).
 *  - HTTP `getProperties` 80001s 100% of the time for this idle device
 *    right now. Don't waste cycles retrying.
 *  - `clearWarning()` produced no MQTT push — suggests no latched warning
 *    OR clearWarning is a true no-op when clear.
 *
 * v2 plan:
 *  1. Dump the FULL raw cloud device-list record (fields we don't
 *     currently surface — `lwt`, `bindDomain`, any error/status fields).
 *  2. Subscribe MQTT, no HTTP reads.
 *  3. Trigger a sequence of benign state-touching actions that should
 *     each produce an MQTT burst:
 *       - stop()              clear any latched error
 *       - pause()             no-op on dock
 *       - locate()            beep
 *  4. Watch raw MQTT for 45 s — let any spontaneous push land too.
 *  5. Print a per-piid table at the end with timestamp + value.
 */

import { DreameClient, Vacuum, type VacuumState } from "../src/index.js";

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

// Dump the raw device-list record — fields we currently throw away.
emit({ kind: "device", did: device.did, model: device.model, name: device.name, online: device.online });
emit({ kind: "device-raw", raw: device.raw });

const vacuum = new Vacuum(dreame, device);
await vacuum.watch();
emit({ kind: "phase", msg: "watch() up" });

const seen = new Map<string, { value: unknown; firstTs: string; lastTs: string; count: number }>();
const allEvents: Array<unknown> = [];

const rawSub = await dreame.subscribe(device);
rawSub.on("message", (raw) => {
  allEvents.push(raw);
  emit({ kind: "raw", raw });
});
rawSub.on("properties", (changes) => {
  for (const c of changes) {
    const key = `${c.siid}.${c.piid}`;
    const ts = new Date().toISOString();
    const ex = seen.get(key);
    if (ex) {
      ex.value = c.value;
      ex.lastTs = ts;
      ex.count += 1;
    } else {
      seen.set(key, { value: c.value, firstTs: ts, lastTs: ts, count: 1 });
    }
  }
});
rawSub.on("event", (ev) => emit({ kind: "event_occured", ev }));
rawSub.on("info", (info) => emit({ kind: "info", info }));
rawSub.on("ota", (o) => emit({ kind: "ota", o }));
rawSub.on("props", (p) => emit({ kind: "props", p }));
rawSub.on("mapInfo", (m) => emit({ kind: "mapInfo", m }));

vacuum.on("taskLifecycle", (lc) => emit({ kind: "taskLifecycle", lc }));
vacuum.on("taskComplete", (rec) => emit({ kind: "taskComplete", rec }));
vacuum.on("change", (s: VacuumState) => emit({ kind: "vacuum-state", s }));

// Passive 8s
emit({ kind: "phase", msg: "passive 8s" });
await new Promise((r) => setTimeout(r, 8_000));

// stop() — clears latched errors, no-op on idle
emit({ kind: "phase", msg: "stop() — clears latched errors" });
try {
  const res = await vacuum.stop();
  emit({ kind: "stop-result", kindRes: res.kind });
} catch (err) {
  emit({ kind: "stop-error", message: (err as Error).message });
}
await new Promise((r) => setTimeout(r, 8_000));

// pause()
emit({ kind: "phase", msg: "pause()" });
try {
  const res = await vacuum.pause();
  emit({ kind: "pause-result", kindRes: res.kind });
} catch (err) {
  emit({ kind: "pause-error", message: (err as Error).message });
}
await new Promise((r) => setTimeout(r, 8_000));

// locate()
emit({ kind: "phase", msg: "locate() — robot beeps" });
try {
  const res = await vacuum.locate();
  emit({ kind: "locate-result", kindRes: res.kind });
} catch (err) {
  emit({ kind: "locate-error", message: (err as Error).message });
}
await new Promise((r) => setTimeout(r, 12_000));

// clearWarning()
emit({ kind: "phase", msg: "clearWarning()" });
try {
  const res = await vacuum.clearWarning();
  emit({ kind: "clearWarning-result", kindRes: res.kind });
} catch (err) {
  emit({ kind: "clearWarning-error", message: (err as Error).message });
}
await new Promise((r) => setTimeout(r, 8_000));

// Final tail window
emit({ kind: "phase", msg: "tail passive 10s" });
await new Promise((r) => setTimeout(r, 10_000));

const summary = Array.from(seen.entries())
  .map(([k, v]) => {
    const [siid, piid] = k.split(".").map(Number);
    return { siid, piid, ...v };
  })
  .sort((a, b) => a.siid - b.siid || a.piid - b.piid);

emit({
  kind: "summary",
  unique_piids_pushed: summary.length,
  pushed: summary,
  current_state: vacuum.state,
  total_raw_events: allEvents.length,
});

await rawSub.close();
await vacuum.unwatch();
emit({ kind: "phase", msg: "done" });
process.exit(0);
