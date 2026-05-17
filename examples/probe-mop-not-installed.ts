/**
 * Probe: confirm code 120 is latched while the device shows
 * "Mop not in place" in the Dreamehome app, and check whether
 * `FAULTS_STR` (siid 4 piid 18) mirrors errorCode or stays empty.
 *
 * Context: GitHub issue #8 — on r2532a (fw 4.3.9_2199), starting the
 * vacuum with mop pads not seated latches `errorCode = 120`, but
 * `state.faults` (parsed from FAULTS_STR) was observed empty for the
 * full 30 min latched window. We need to know whether:
 *
 *   (a) FAULTS_STR never pushes for this code → action-refusal codes
 *       skip the multi-value mirror entirely, and we need explicit
 *       getProperties to pull it.
 *   (b) FAULTS_STR pushes but the parser drops it.
 *   (c) FAULTS_STR mirrors errorCode normally → ticket repro was a
 *       transient artefact.
 *
 * Method:
 *   1. Subscribe MQTT and log every property push for 60s. Any 120
 *      pushed on `ERROR` (2/2) or `FAULTS_STR` (4/18) will be visible.
 *   2. Fire an explicit `getProperties` for ERROR + FAULTS_STR. Dump
 *      the raw result envelope. If FAULTS_STR has a value (even "0"
 *      or ""), we'll see it.
 *   3. Continue logging for 30s post-get to catch any deferred pushes.
 *
 * Run (PowerShell):
 *   $env:DREAME_EMAIL = ...; $env:DREAME_PASSWORD = ...
 *   npx tsx examples/probe-mop-not-installed.ts
 */

import { DreameClient, DreameDeviceOfflineError } from "../src/index.js";
import { VACUUM_PROP } from "../src/miot-spec.js";

const PRE_GET_WAIT_MS = 60_000;
const POST_GET_WAIT_MS = 30_000;

const PROBE_PROPS = [
  VACUUM_PROP.STATE,
  VACUUM_PROP.ERROR,
  VACUUM_PROP.FAULTS_STR,
  VACUUM_PROP.TASK_STATUS,
  VACUUM_PROP.MOP_PADS_STATE,
];

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

sub.on("properties", (changes) => emit("mqtt-properties", changes));
sub.on("event", (ev) => emit("mqtt-event", ev));
sub.on("props", (p) => emit("mqtt-props", p));
sub.on("error", (err) => emit("mqtt-error", { name: err.name, message: err.message }));

emit("phase", `waiting ${PRE_GET_WAIT_MS}ms — capturing spontaneous pushes`);
await new Promise((r) => setTimeout(r, PRE_GET_WAIT_MS));

emit("phase", `firing getProperties [STATE, ERROR, FAULTS_STR, TASK_STATUS, MOP_PADS_STATE]`);
try {
  const results = await dreame.getProperties(device.did, PROBE_PROPS);
  emit("get-properties-acked", results);
} catch (err) {
  if (err instanceof DreameDeviceOfflineError) {
    emit("get-properties-no-ack", { message: err.message, status: err.status, body: err.body });
  } else {
    emit("get-properties-error", { name: (err as Error).name, message: (err as Error).message });
  }
}

emit("phase", `waiting ${POST_GET_WAIT_MS}ms post-get — capturing deferred pushes`);
await new Promise((r) => setTimeout(r, POST_GET_WAIT_MS));

await sub.close();
emit("phase", "done");
process.exit(0);
