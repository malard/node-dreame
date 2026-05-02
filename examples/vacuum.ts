/**
 * Exercise the Vacuum wrapper: refresh state, subscribe, and locate.
 */
import { DreameClient } from "../src/index.js";

const dreame = new DreameClient({
  email: process.env.DREAME_EMAIL!,
  password: process.env.DREAME_PASSWORD!,
  region: "eu",
});

const device = (await dreame.getDevices())[0]!;
const vacuum = dreame.getVacuum(device);

console.log(`refreshing state for ${device.name} ...`);
const state = await vacuum.refresh();
console.log(JSON.stringify(state, null, 2));

console.log("\nsubscribing to live updates...");
await vacuum.watch();
vacuum.on("change", (s) => console.log("[change]", JSON.stringify(s)));

console.log("\nattempting LOCATE (robot will beep) ...");
try {
  const r = await vacuum.locate();
  console.log("locate ok:", JSON.stringify(r));
} catch (e) {
  console.log("locate failed:", (e as Error).message);
}

setTimeout(async () => {
  await vacuum.unwatch();
  process.exit(0);
}, 10_000);
