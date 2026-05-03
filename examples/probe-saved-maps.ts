/**
 * One-shot probe: verify the saved-map list wire format on the live
 * Dreame native cloud.
 *
 * Logs in, reads `siid 6 piid 8` (`MAP_LIST` / `POINTER_JSON`) to get
 * the OSS object name, fetches the OSS blob via the existing
 * `getDownloadUrl` endpoint, and tries to parse it as Tasshack's
 * Mi-cloud wrapper shape (`{ mapstr: [{ map, name?, angle? }, ...],
 * curr_id }`). Reports whether the shape matches.
 *
 * Use to confirm or adjust the ASSUMED wire format in
 * `Vacuum.fetchSavedMapList()` / `decodeSavedMapList()` before
 * relying on the parsed structure.
 *
 * Run:
 *   npx tsx examples/probe-saved-maps.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { DreameClient } from "../src/index.js";
import { CLOUD_OBJ_PROP } from "../src/miot-spec.js";
import { OssFetcher } from "../src/map/index.js";
import { decodeSavedMapList } from "../src/vacuum.js";

const dreame = new DreameClient({
  email: process.env.DREAME_EMAIL!,
  password: process.env.DREAME_PASSWORD!,
  region: "eu",
});

await dreame.login();
const session = dreame.session!;
const device = (await dreame.getDevices())[0]!;
console.log(`device: ${device.name} (${device.did}, ${device.model})`);

console.log(`reading siid 6 piid 8 (MAP_LIST pointer)...`);
const props = await dreame.getProperties(device.did, [CLOUD_OBJ_PROP.POINTER_JSON]);
const pointer = props[0];
console.log(`pointer:`, pointer);

if (!pointer || pointer.code !== 0 || typeof pointer.value !== "string" || !pointer.value) {
  console.error("no MAP_LIST pointer published yet — try after a cleaning task");
  process.exit(1);
}

let parsed: { obj_name?: unknown; md5?: unknown };
try {
  parsed = JSON.parse(pointer.value) as { obj_name?: unknown };
} catch (err) {
  console.error("MAP_LIST pointer not JSON:", err);
  process.exit(1);
}
console.log(`obj_name: ${parsed.obj_name}`);
console.log(`md5:      ${parsed.md5 ?? "(none)"}`);

if (typeof parsed.obj_name !== "string") {
  console.error("MAP_LIST.obj_name not a string");
  process.exit(1);
}

const fetcher = new OssFetcher();
const bytes = await fetcher.fetchBlob({
  host: dreame.apiHost,
  accessToken: session.accessToken,
  region: dreame.region,
  country: dreame.country,
  lang: dreame.lang,
  did: device.did,
  model: device.model,
  filename: parsed.obj_name,
});
console.log(`OSS body: ${bytes.length} bytes`);
console.log(`first 200 chars:\n${bytes.toString("utf8").slice(0, 200)}`);

const outDir = path.resolve("test/fixtures/map");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "saved-maps-list-raw.json");
fs.writeFileSync(outFile, bytes);
console.log(`wrote raw body to: ${outFile}`);

console.log(`\nattempting Tasshack wrapper decode...`);
const decoded = decodeSavedMapList(bytes);
if (!decoded) {
  console.error(
    "decodeSavedMapList returned null — the wire format does NOT match the assumed wrapper.\n" +
      "Inspect the raw body above and update src/vacuum.ts:decodeSavedMapList accordingly.",
  );
  process.exit(2);
}

console.log(`\nSUCCESS: wrapper format matches the Tasshack assumption.`);
console.log(`  activeMapId: ${decoded.activeMapId}`);
console.log(`  ${decoded.maps.length} map(s):`);
for (const m of decoded.maps) {
  console.log(
    `    mapId=${m.mapId} name=${m.name ?? "(unnamed)"} angle=${m.angle}° ` +
      `dim=${m.data.dimensions.width}x${m.data.dimensions.height}@${m.data.dimensions.gridSize}mm ` +
      `segments=${m.data.segments.length}`,
  );
}
process.exit(0);
