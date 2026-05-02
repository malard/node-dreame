/**
 * Probe which siids exist on the device by reading piid=1 from each.
 * A "value" present = service exists. Errors = service absent.
 */
import { DreameClient } from "../src/index.js";

const dreame = new DreameClient({
  email: process.env.DREAME_EMAIL!,
  password: process.env.DREAME_PASSWORD!,
  region: "eu",
});

const devices = await dreame.getDevices();
const did = devices[0]!.did;

const probes = [];
for (let s = 1; s <= 30; s++) {
  probes.push({ siid: s, piid: 1 });
}

const results = await dreame.getProperties(did, probes);
for (const r of results) {
  const status = r.code === 0 ? "OK " : `err${r.code}`;
  const value = r.code === 0 ? JSON.stringify(r.value) : "";
  console.log(`siid=${String(r.siid).padStart(2)} piid=1  ${status}  ${value}`);
}
