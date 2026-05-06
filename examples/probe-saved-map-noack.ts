/**
 * Probe: how does the saved-map fetch path behave around a mobile-app
 * interaction with the same device?
 *
 * Today `Vacuum.fetchSavedMapList()` reads the OSS pointer via
 * `getProperties(siid 6 piid 8)`. When the cloud's HTTP-side ACK
 * waiter times out the call returns `null` (we fold 80001 into "no
 * pointer") even though the Dreamehome mobile app routinely shows
 * the saved map for the same device in the same state. Something
 * the app does is unblocking the read path; we're trying to capture
 * what.
 *
 * The probe walks through six phases. It prompts you when to open
 * the app and when to leave it alone, so the timing of the app
 * interaction lines up with the data we're capturing.
 *
 *   PHASE 1  passive baseline, 20s — what the broker sends with no
 *            interaction at all. Useful to see retained messages,
 *            heartbeats, the fresh-subscription PATH push, etc.
 *   PHASE 2  one HTTP POINTER read — does it 80001 cold?
 *   PHASE 3  ★ open the Dreamehome app on this device ★ — 60s
 *            window with the app interactive. Every MQTT envelope
 *            during this window is logged.
 *   PHASE 4  another HTTP POINTER read — has the app's activity
 *            "warmed" the device's HTTP path?
 *   PHASE 5  end-to-end fetchSavedMapList — does it succeed now?
 *   PHASE 6  cool-down, 30s — captures any delayed pushes that
 *            arrive after we stop probing.
 *
 * Output: JSONL on stdout. Tee to a file:
 *   npx tsx examples/probe-saved-map-noack.ts | tee probe-saved-map.jsonl
 *
 * Requires `DREAME_EMAIL` / `DREAME_PASSWORD` in the environment.
 */

import {
  CLOUD_OBJ_PROP,
  DreameClient,
  DreameDeviceOfflineError,
} from "../src/index.js";

function emit(kind: string, data: unknown): void {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), kind, data })}\n`);
}

function banner(msg: string): void {
  process.stderr.write(`\n=== ${msg} ===\n`);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

// ─── PHASE 1 — passive baseline ──────────────────────────────────
banner("PHASE 1 — passive baseline (20s). Don't touch the device or app.");
emit("phase", { n: 1, label: "passive-baseline", durationMs: 20_000 });
await sleep(20_000);

// ─── PHASE 2 — cold pointer read ─────────────────────────────────
banner("PHASE 2 — cold POINTER_JSON read");
emit("phase", { n: 2, label: "cold-pointer-read" });
await tryPointerRead("phase-2");

// ─── PHASE 3 — open the app ──────────────────────────────────────
banner(
  "PHASE 3 — OPEN THE DREAMEHOME APP NOW. Tap into this device. Look at\n" +
    "the saved map. Stay on the device screen for the next 60 seconds. The\n" +
    "probe is logging every MQTT envelope while you do this.",
);
emit("phase", { n: 3, label: "app-interactive-60s", durationMs: 60_000 });
await sleep(60_000);

// ─── PHASE 4 — warm pointer read ─────────────────────────────────
banner("PHASE 4 — warm POINTER_JSON read (you can put the app down now)");
emit("phase", { n: 4, label: "warm-pointer-read" });
await tryPointerRead("phase-4");

// ─── PHASE 5 — end-to-end fetchSavedMapList ──────────────────────
banner("PHASE 5 — end-to-end fetchSavedMapList()");
emit("phase", { n: 5, label: "fetch-saved-map-list" });
const vacuum = dreame.getVacuum(device);
try {
  const list = await vacuum.fetchSavedMapList();
  if (list === null) {
    emit("fetch-saved-map-list-null", null);
  } else {
    emit("fetch-saved-map-list-ok", {
      activeMapId: list.activeMapId,
      mapCount: list.maps.length,
      maps: list.maps.map((m) => ({
        mapId: m.mapId,
        name: m.name,
        angle: m.angle,
        segments: m.data.segments.length,
        dimensions: m.data.dimensions,
      })),
    });
  }
} catch (err) {
  emit("fetch-saved-map-list-error", {
    name: (err as Error).name,
    message: (err as Error).message,
  });
}

// ─── PHASE 6 — cool-down ─────────────────────────────────────────
banner("PHASE 6 — cool-down (30s). Done shortly.");
emit("phase", { n: 6, label: "cool-down", durationMs: 30_000 });
await sleep(30_000);

await sub.close();
emit("phase", { n: 7, label: "done" });
process.exit(0);

async function tryPointerRead(label: string): Promise<void> {
  try {
    const results = await dreame.getProperties(device.did, [CLOUD_OBJ_PROP.POINTER_JSON]);
    emit(`${label}-pointer-acked`, results);
  } catch (err) {
    if (err instanceof DreameDeviceOfflineError) {
      emit(`${label}-pointer-no-ack`, {
        message: err.message,
        status: err.status,
        body: err.body,
      });
    } else {
      emit(`${label}-pointer-error`, {
        name: (err as Error).name,
        message: (err as Error).message,
      });
    }
  }
}
