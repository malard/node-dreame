/**
 * Try a few SAFE actions in sequence to see which (if any) work on r2532a.
 * - CLEAR_WARNING (siid 4 aiid 3): no-op if no warning
 * - LOCATE        (siid 7 aiid 1): brief beep
 * - TEST_SOUND    (siid 7 aiid 2): brief beep
 * Skips START / STOP / DOCK to avoid moving the robot.
 */
import { DreameClient } from "../src/index.js";

const dreame = new DreameClient({
  email: process.env.DREAME_EMAIL!,
  password: process.env.DREAME_PASSWORD!,
  region: "eu",
});

const did = (await dreame.getDevices())[0]!.did;

const probes: { label: string; siid: number; aiid: number }[] = [
  { label: "CLEAR_WARNING (4.3)", siid: 4, aiid: 3 },
  { label: "LOCATE        (7.1)", siid: 7, aiid: 1 },
  { label: "TEST_SOUND    (7.2)", siid: 7, aiid: 2 },
];

for (const p of probes) {
  try {
    const r = await dreame.callAction(did, { siid: p.siid, aiid: p.aiid, in: [] });
    console.log(`OK  ${p.label}:`, JSON.stringify(r));
  } catch (e) {
    console.log(`ERR ${p.label}:`, (e as Error).message);
  }
}
