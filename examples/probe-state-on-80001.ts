/**
 * Probe: what does an idle device push naturally, and what's in the
 * 80001 response body?
 *
 * Background: when `Vacuum.refresh()` returns `kind: "no-ack"` (the
 * cloud's HTTP-side ACK waiter timed out, surfacing code 80001), no
 * cached state gets seeded — `vacuum.state` stays at its initial
 * mostly-`null` shape. MQTT only delivers state on *change*, so a
 * quiet idle device leaves consumers staring at nulls until the
 * device pushes something.
 *
 * This probe captures the data we'd need to decide whether there's
 * any seed path the lib could expose without an HTTP ack:
 *
 *   1. Subscribe MQTT first, capture every envelope received in the
 *      first 30s — including any retained messages the broker may
 *      replay on subscribe.
 *   2. Fire `getProperties` for the same property set `refresh()`
 *      uses. If it acks, dump the result array. If it 80001s, dump
 *      the parsed response body that the cloud returned alongside
 *      the error code (the body is reachable via
 *      `DreameDeviceOfflineError.body`).
 *   3. Continue logging MQTT pushes for another 30s after the
 *      getProperties call — sometimes the device responds to the
 *      cloud-side fanout even after the HTTP ACK waiter has
 *      already given up.
 *
 * Output: a single JSONL stream on stdout, one event per line,
 * suitable for `tee probe-state.log`. Each line is `{ ts, kind,
 * data }`.
 *
 * Run:
 *   npx tsx examples/probe-state-on-80001.ts
 *
 * Requires `DREAME_EMAIL` / `DREAME_PASSWORD` in the environment.
 */

import { DreameClient, DreameDeviceOfflineError } from "../src/index.js";
import {
  BATTERY_PROP,
  CONSUMABLE_PROP,
  SETTINGS_PROP,
  VACUUM_PROP,
} from "../src/miot-spec.js";

const PROBE_PROPS = [
  VACUUM_PROP.STATE,
  VACUUM_PROP.ERROR,
  VACUUM_PROP.TASK_STATUS,
  VACUUM_PROP.SUCTION_LEVEL,
  VACUUM_PROP.WATER_VOLUME,
  VACUUM_PROP.CLEANING_MODE,
  VACUUM_PROP.CLEANING_TIME,
  VACUUM_PROP.CLEANED_AREA,
  VACUUM_PROP.TASK_PROGRESS_PCT,
  BATTERY_PROP.LEVEL,
  BATTERY_PROP.CHARGING_STATUS,
  SETTINGS_PROP.VOLUME,
  CONSUMABLE_PROP.MAIN_BRUSH_LEFT,
  CONSUMABLE_PROP.SIDE_BRUSH_LEFT,
  CONSUMABLE_PROP.FILTER_LEFT,
];

const PRE_GET_WAIT_MS = 30_000;
const POST_GET_WAIT_MS = 30_000;

function emit(kind: string, data: unknown): void {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), kind, data })}\n`);
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
emit("device", { did: device.did, model: device.model, online: device.online });

const sub = await dreame.subscribe(device);
emit("mqtt-subscribed", { topic: sub.topic });

sub.on("message", (raw) => emit("mqtt-raw", raw));
sub.on("properties", (changes) => emit("mqtt-properties", changes));
sub.on("event", (ev) => emit("mqtt-event", ev));
sub.on("props", (p) => emit("mqtt-props", p));
sub.on("info", (info) => emit("mqtt-info", info));
sub.on("connect", () => emit("mqtt-connect", null));
sub.on("close", () => emit("mqtt-close", null));
sub.on("error", (err) => emit("mqtt-error", { name: err.name, message: err.message }));

emit("phase", `waiting ${PRE_GET_WAIT_MS}ms before getProperties — capturing any retained / spontaneous pushes`);
await new Promise((r) => setTimeout(r, PRE_GET_WAIT_MS));

emit("phase", `firing getProperties for ${PROBE_PROPS.length} properties`);
try {
  const results = await dreame.getProperties(device.did, PROBE_PROPS);
  emit("get-properties-acked", results);
} catch (err) {
  if (err instanceof DreameDeviceOfflineError) {
    emit("get-properties-no-ack", {
      message: err.message,
      status: err.status,
      body: err.body,
    });
  } else {
    emit("get-properties-error", {
      name: (err as Error).name,
      message: (err as Error).message,
    });
  }
}

emit("phase", `waiting ${POST_GET_WAIT_MS}ms post-getProperties — capturing any delayed pushes`);
await new Promise((r) => setTimeout(r, POST_GET_WAIT_MS));

await sub.close();
emit("phase", "done");
process.exit(0);
