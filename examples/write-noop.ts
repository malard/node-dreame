/**
 * No-op write: read a boolean property, write the same value back.
 * Confirms the set_properties round-trip without changing device state.
 */
import { DreameClient } from "../src/index.js";

const dreame = new DreameClient({
  email: process.env.DREAME_EMAIL!,
  password: process.env.DREAME_PASSWORD!,
  region: "eu",
});

const did = (await dreame.getDevices())[0]!.did;

// siid 14 piid 1 reads as 0 (a boolean-shaped int) — write 0 back.
const before = await dreame.getProperties(did, [{ siid: 14, piid: 1 }]);
console.log("before:", JSON.stringify(before));

const write = await dreame.setProperties(did, [{ siid: 14, piid: 1, value: 0 }]);
console.log("write :", JSON.stringify(write));

const after = await dreame.getProperties(did, [{ siid: 14, piid: 1 }]);
console.log("after :", JSON.stringify(after));
