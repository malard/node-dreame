import { DreameClient } from "../src/index.js";

const dreame = new DreameClient({
  email: process.env.DREAME_EMAIL!,
  password: process.env.DREAME_PASSWORD!,
  region: "eu",
  logger: (m, x) => console.log("[d]", m, x ?? ""),
});

const devices = await dreame.getDevices();
const robot = devices[0]!;
console.log(`reading from ${robot.did}`);

// Try multiple plausible MIoT layouts
const probes = [
  { siid: 2, piid: 1, label: "vac.status (siid 2 piid 1)" },
  { siid: 3, piid: 1, label: "battery (siid 3 piid 1)" },
  { siid: 3, piid: 2, label: "charging (siid 3 piid 2)" },
  { siid: 2, piid: 2, label: "fault (siid 2 piid 2)" },
];

for (const p of probes) {
  try {
    const res = await dreame.getProperties(robot.did, [{ siid: p.siid, piid: p.piid }]);
    console.log(`OK ${p.label}:`, JSON.stringify(res));
  } catch (e) {
    console.log(`ERR ${p.label}:`, (e as Error).message);
  }
}
