/**
 * Live-map streaming example.
 *
 * Logs in, opens a vacuum subscription, then attaches to the lazy
 * `vacuum.map` MapManager. Prints one line per decoded `MapData` (the
 * mid-flight merge of the OSS-fetched I-frame + each inline P-frame).
 *
 * Phase 5 reference: this is the smallest end-to-end consumer of the
 * public API. Use it to sanity-check changes to `Vacuum.map` /
 * `MapManager` against a real device.
 *
 * Run:
 *   npx tsx examples/live-map-stream.ts
 *
 * Requires `DREAME_EMAIL` / `DREAME_PASSWORD` in the environment — see
 * memory `reference_dreame_env.md` for the canonical loader.
 */
import { DreameClient } from "../src/index.js";

const dreame = new DreameClient({
  email: process.env.DREAME_EMAIL!,
  password: process.env.DREAME_PASSWORD!,
  region: "eu",
  logger: (m, x) => console.log("[d]", m, x ?? ""),
});

const device = (await dreame.getDevices())[0]!;
console.log(`subscribing to ${device.name} (${device.did}, ${device.model})`);

const vacuum = dreame.getVacuum(device);
await vacuum.watch();

vacuum.map.on("map", (data) => {
  console.log(
    `[map] frame=${data.frameType}#${data.frameId} mapId=${data.mapId} ` +
      `dim=${data.dimensions.width}x${data.dimensions.height}@${data.dimensions.gridSize}mm ` +
      `segments=${data.segments.length} obstacles=${data.obstacles.length} ` +
      `paths=${data.paths.reduce((n, p) => n + p.points.length, 0)}pts ` +
      `robot=${data.robot ? `(${data.robot.x},${data.robot.y},${data.robot.angle}°)` : "null"}`,
  );
});

vacuum.map.on("error", (err) => {
  console.error(`[map error] ${err.message}`);
});

console.log("listening for 60 seconds...");
setTimeout(async () => {
  await vacuum.unwatch();
  process.exit(0);
}, 60_000);
