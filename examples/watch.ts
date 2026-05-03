/**
 * Subscribe to live property pushes for ~30 seconds, then close.
 * Triggers a no-op write mid-window to verify we receive a properties_changed event.
 */
import { DreameClient } from "../src/index.js";

const dreame = new DreameClient({
  email: process.env.DREAME_EMAIL!,
  password: process.env.DREAME_PASSWORD!,
  region: "eu",
  logger: (level, m, x) => console.log(`[d:${level}]`, m, x ?? ""),
});

const device = (await dreame.getDevices())[0]!;
console.log(`subscribing to ${device.did} (${device.model})`);

const sub = await dreame.subscribe(device);
console.log(`topic: ${sub.topic}`);

sub.on("properties", (changes) => {
  console.log(">>> properties_changed:", JSON.stringify(changes));
});
sub.on("message", (raw) => {
  console.log(">>> raw method:", raw.data?.method, "params:", raw.data?.params?.length ?? 0);
});
sub.on("close", () => console.log("(mqtt close)"));
sub.on("error", (err) => console.error("(mqtt error)", err.message));

// After 5s, trigger a no-op write that the broker should echo back to us.
setTimeout(async () => {
  console.log("issuing no-op write to provoke event...");
  await dreame.setProperties(device.did, [{ siid: 14, piid: 1, value: 0 }]);
}, 5000);

// Keep the process alive for 30s, then clean up.
setTimeout(async () => {
  console.log("closing subscription");
  await sub.close();
  process.exit(0);
}, 30_000);
