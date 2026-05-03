/**
 * Calls the LOCATE action on the first device — the robot will beep.
 * Run with: npx tsx examples/locate.ts
 */
import { DreameClient } from "../src/index.js";

const email = process.env.DREAME_EMAIL!;
const password = process.env.DREAME_PASSWORD!;
const region = (process.env.DREAME_REGION as "eu") ?? "eu";

const dreame = new DreameClient({
  email,
  password,
  region,
  logger: (level, msg, meta) => console.log(`[dreame:${level}] ${msg}`, meta ?? ""),
});

const devices = await dreame.getDevices();
const robot = devices[0];
if (!robot) {
  console.error("No devices on account");
  process.exit(1);
}

console.log(`\nCalling LOCATE on ${robot.name} (${robot.model}, did=${robot.did})...`);
// MIoT mapping (per Tasshack types.py): LOCATE = siid 7 / aiid 1
const result = await dreame.callAction(robot.did, { siid: 7, aiid: 1, in: [] });
console.log("Result:", JSON.stringify(result, null, 2));
