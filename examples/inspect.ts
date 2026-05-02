import { DreameClient } from "../src/index.js";

const dreame = new DreameClient({
  email: process.env.DREAME_EMAIL!,
  password: process.env.DREAME_PASSWORD!,
  region: "eu",
});

const devices = await dreame.getDevices();
for (const d of devices) {
  console.log(JSON.stringify(d.raw, null, 2));
}
