/**
 * Run with: npx tsx examples/basic.ts
 *
 * Reads DREAME_EMAIL / DREAME_PASSWORD / DREAME_REGION from the environment.
 */
import { DreameClient } from "../src/index.js";

const email = process.env.DREAME_EMAIL;
const password = process.env.DREAME_PASSWORD;
const region = (process.env.DREAME_REGION as "eu" | "us" | "cn" | undefined) ?? "eu";

if (!email || !password) {
  console.error("Set DREAME_EMAIL and DREAME_PASSWORD in the environment.");
  process.exit(1);
}

const dreame = new DreameClient({ email, password, region });

await dreame.login();
const devices = await dreame.getDevices();

console.log(`Found ${devices.length} device(s):`);
for (const d of devices) {
  console.log(`  ${d.name}  (${d.model})  did=${d.did}  online=${d.online}`);
}
