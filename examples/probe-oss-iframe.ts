/**
 * One-shot probe: fetch a Dreame OSS-stored map blob by `obj_name` and
 * decode it. Used to test the hypothesis that the device parks I-frames
 * in OSS (advertised via the PATH push, siid 6 piid 3) instead of
 * pushing them inline.
 *
 * Usage:
 *   DREAME_EMAIL=… DREAME_PASSWORD=… npx tsx examples/probe-oss-iframe.ts <obj_name>
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { DreameClient } from "../src/index.js";
import { buildHeaders } from "../src/auth.js";
import { REGION_HOSTS } from "../src/config.js";
import { MapDecoder, parseMapHeader, unwrapEnvelope } from "../src/map/index.js";

const objName = process.argv[2];
if (!objName) {
  console.error("usage: probe-oss-iframe.ts <obj_name>");
  process.exit(1);
}

const dreame = new DreameClient({
  email: process.env.DREAME_EMAIL!,
  password: process.env.DREAME_PASSWORD!,
  region: "eu",
});
await dreame.login();
const session = dreame.session!;
const devices = await dreame.getDevices();
const device = devices[0]!;
const apiHost = REGION_HOSTS[dreame.region];

// Dreamehome interim file URL (live blob): POST /dreame-user-iot/iotfile/getDownloadUrl
// Body must include filename/model/region/did. Response.data is the URL string itself.
const url = `https://${apiHost}/dreame-user-iot/iotfile/getDownloadUrl`;
const headers = buildHeaders({
  region: dreame.region,
  country: "GB",
  lang: "en",
  accessToken: session.accessToken,
  contentType: "application/json",
});

console.log(`resolving: ${objName}`);
const resolveRes = await fetch(url, {
  method: "POST",
  headers,
  body: JSON.stringify({
    did: device.did,
    model: device.model,
    filename: objName,
    region: "eu",
  }),
});
const resolveText = await resolveRes.text();
console.log(`resolve status: ${resolveRes.status}`);
console.log(`resolve body:   ${resolveText.slice(0, 500)}`);

let resolved: { code?: number; data?: string | { url?: string } };
try {
  resolved = JSON.parse(resolveText);
} catch {
  console.error("response was not JSON");
  process.exit(1);
}

// Tasshack: response.data is the URL string itself.
const fileUrl =
  typeof resolved.data === "string"
    ? resolved.data
    : (resolved.data as { url?: string } | undefined)?.url;
if (!fileUrl) {
  console.error("no URL in response — trying permanent endpoint /dreame-user-iot/iotfile/getOss1dDownloadUrl");
  const fallbackUrl = `https://${apiHost}/dreame-user-iot/iotfile/getOss1dDownloadUrl`;
  // Permanent endpoint strips the leading char of the obj_name per Tasshack.
  const fbRes = await fetch(fallbackUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      did: device.did,
      uid: session.uid,
      model: device.model,
      filename: objName.slice(1),
      region: "eu",
    }),
  });
  console.log(`fallback status: ${fbRes.status}`);
  console.log(`fallback body:   ${(await fbRes.text()).slice(0, 500)}`);
  process.exit(1);
}

console.log(`signed URL: ${fileUrl.slice(0, 120)}...`);
const fileRes = await fetch(fileUrl);
if (!fileRes.ok) {
  console.error(`download failed: ${fileRes.status}`);
  process.exit(1);
}
const bytes = Buffer.from(await fileRes.arrayBuffer());
console.log(`downloaded: ${bytes.length} bytes`);
console.log(`first 32 bytes (text): ${bytes.slice(0, 32).toString("utf8")}`);

// OSS stores the same URL-safe base64 envelope as the live MQTT channel.
const envelope = bytes.toString("utf8");
const inflated = unwrapEnvelope(envelope);
console.log(`unwrapped: ${inflated.length} bytes`);

const header = parseMapHeader(inflated);
console.log(`header:`, header);

const outDir = path.resolve("test/fixtures/map");
fs.mkdirSync(outDir, { recursive: true });
const sanitized = objName.replace(/[^a-zA-Z0-9_-]/g, "_");
fs.writeFileSync(path.join(outDir, `oss-${sanitized}.envelope.txt`), envelope);
fs.writeFileSync(path.join(outDir, `oss-${sanitized}.bin`), inflated);
console.log(`wrote inflated bytes to: ${outDir}/oss-${sanitized}.bin`);

if (header.frameType === "I") {
  console.log("\n>>> THIS IS AN I-FRAME — pixel decoder unblocked! <<<");
  const md = MapDecoder.decode(envelope);
  console.log(`MapData: layers=${md.layers.length} segments=${md.segments.length} obstacles=${md.obstacles.length}`);
  for (const seg of md.segments) {
    console.log(`  segment ${seg.id}: bbox=(${seg.bbox.xMin},${seg.bbox.yMin})..(${seg.bbox.xMax},${seg.bbox.yMax}) centroid=(${seg.centroid.x.toFixed(0)},${seg.centroid.y.toFixed(0)}) name=${seg.name}`);
  }
}
void zlib; // keep import in case future probe needs raw zlib

process.exit(0);
