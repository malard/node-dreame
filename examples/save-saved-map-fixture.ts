/**
 * Save the current saved-map list (siid 6 piid 8 → /9 OSS slot) to a
 * fixture file. Discovers the OSS object name dynamically from the
 * device's published `POINTER_JSON` property — never hard-codes account
 * UID or DID, so the script is safe to commit and re-use.
 *
 * Usage:
 *   npx tsx examples/save-saved-map-fixture.ts <out-path>
 *
 * Falls back to reading `siid 6 piid 8` for the obj_name. If that
 * 80001s, pass an explicit obj_name from a recent JSONL capture as
 * the second argv:
 *   npx tsx examples/save-saved-map-fixture.ts <out-path> <obj_name>
 */
import * as fs from "node:fs";
import { DreameClient } from "../src/index.js";
import { OssFetcher } from "../src/map/oss-fetch.js";

const out = process.argv[2];
if (!out) {
  console.error("usage: save-saved-map-fixture.ts <out-path> [<obj_name>]");
  process.exit(1);
}

const dreame = new DreameClient({
  email: process.env.DREAME_EMAIL!,
  password: process.env.DREAME_PASSWORD!,
  region: "eu",
});
const device = (await dreame.getDevices())[0]!;

let objName = process.argv[3];
if (!objName) {
  console.log(`reading siid 6 piid 8 to discover saved-map list pointer ...`);
  try {
    const res = await dreame.getProperties(device.did, [{ siid: 6, piid: 8 }]);
    const v = res[0]?.value;
    if (typeof v === "string" && v.length > 0) {
      const parsed = JSON.parse(v) as { obj_name?: string; object_name?: string };
      objName = parsed.obj_name ?? parsed.object_name;
    }
  } catch (err) {
    console.error(`getProperties failed: ${(err as Error).message}`);
    console.error(`pass obj_name explicitly as argv[3] (last value seen on 6.8)`);
    process.exit(1);
  }
}
if (!objName) {
  console.error(`could not discover obj_name from siid 6 piid 8`);
  process.exit(1);
}

console.log(`fetching ${objName} ...`);
const fetcher = new OssFetcher();
const session = dreame.session!;
const bytes = await fetcher.fetchBlob({
  host: dreame.apiHost,
  accessToken: session.accessToken,
  region: dreame.region,
  country: dreame.country,
  lang: dreame.lang,
  did: device.did,
  model: device.model,
  filename: objName,
});
fs.writeFileSync(out, bytes);
console.log(`saved ${bytes.length} bytes → ${out}`);
process.exit(0);
