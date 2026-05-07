/**
 * Fetch OSS blobs by known object name and dump raw tail JSON keys.
 * Use to discover map-frame fields the decoder doesn't currently parse.
 *
 * Pass live-I-frame object names as argv (e.g. those captured from
 * `siid 6 piid 3` PATH pushes). For saved-map list pointers (the
 * `obj_name` from siid 6 piid 8) the body is a JSON wrapper, not a
 * map envelope — this script falls back to dumping the wrapper keys
 * + first 4KB of text. Use `probe-saved-map-tails.ts` instead to
 * decode each `mapstr[*].map` blob inside.
 *
 * Usage:
 *   npx tsx examples/probe-tail-fields.ts ali_dreame/.../1 ali_dreame/.../9
 */
import { DreameClient } from "../src/index.js";
import { OssFetcher } from "../src/map/oss-fetch.js";
import { unwrapEnvelope, parseMapHeader, sliceTailText } from "../src/map/decoder.js";

const dreame = new DreameClient({
  email: process.env.DREAME_EMAIL!,
  password: process.env.DREAME_PASSWORD!,
  region: "eu",
});

const objNames = process.argv.slice(2);
if (objNames.length === 0) {
  console.error("usage: probe-tail-fields.ts <obj_name> [<obj_name> ...]");
  process.exit(1);
}

const device = (await dreame.getDevices())[0]!;
console.log(`logged in as ${device.name} (${device.model}, did=${device.did})`);

const fetcher = new OssFetcher();
const session = dreame.session!;
const base = {
  host: dreame.apiHost,
  accessToken: session.accessToken,
  region: dreame.region,
  country: dreame.country,
  lang: dreame.lang,
  did: device.did,
  model: device.model,
};

function summarise(v: unknown): string {
  if (typeof v === "string") {
    return `string(len=${v.length})${v.length < 200 ? `=${JSON.stringify(v)}` : ""}`;
  }
  if (Array.isArray(v)) {
    return `array(len=${v.length})${v.length === 0 ? " []" : ` first=${JSON.stringify(v[0]).slice(0, 200)}`}`;
  }
  if (typeof v === "object" && v !== null) {
    return `object keys=[${Object.keys(v).join(",")}] full=${JSON.stringify(v).slice(0, 600)}`;
  }
  return JSON.stringify(v);
}

for (const objName of objNames) {
  console.log(`\n========== ${objName} ==========`);
  let bytes: Buffer;
  try {
    bytes = await fetcher.fetchBlob({ ...base, filename: objName });
  } catch (err) {
    console.error(`fetch failed:`, (err as Error).message);
    continue;
  }
  console.log(`raw bytes length=${bytes.length}`);

  // Try to interpret as a map-frame envelope (utf8 → unwrapEnvelope).
  let inflated: Buffer | null = null;
  try {
    inflated = unwrapEnvelope(bytes.toString("utf8"));
  } catch (err) {
    console.log(`not a map-frame envelope (${(err as Error).message})`);
  }

  if (inflated) {
    let header;
    try {
      header = parseMapHeader(inflated);
    } catch (err) {
      console.log(`failed to parse map header: ${(err as Error).message}`);
    }
    if (header) {
      console.log(`map-frame: type=${header.frameType} frameId=${header.frameId} mapId=${header.mapId} dim=${header.width}x${header.height}`);
      if (header.frameType === "I") {
        const tailText = sliceTailText(inflated, header);
        try {
          const tail = JSON.parse(tailText) as Record<string, unknown>;
          console.log(`\n--- TAIL KEYS (${Object.keys(tail).length}) ---`);
          console.log(`  ${Object.keys(tail).sort().join(", ")}\n`);
          console.log(`--- PER-KEY ---`);
          for (const k of Object.keys(tail).sort()) {
            console.log(`  ${k}: ${summarise(tail[k])}`);
          }
          console.log(`\n--- FULL JSON (truncated to 8000 chars) ---`);
          console.log(JSON.stringify(tail, null, 2).slice(0, 8000));
        } catch (err) {
          console.log(`tail JSON parse failed: ${(err as Error).message}`);
          console.log(`tail bytes: ${tailText.slice(0, 400)}`);
        }
      }
      continue;
    }
  }

  // Fall back: try interpreting as a JSON wrapper (saved-map list).
  try {
    const text = bytes.toString("utf8");
    const parsed = JSON.parse(text);
    console.log(`JSON wrapper, top-level keys: ${Object.keys(parsed).join(", ")}`);
    console.log(`full (first 4000): ${text.slice(0, 4000)}`);
  } catch {
    console.log(`bytes are neither a map-frame envelope nor JSON; first 80 hex: ${bytes.subarray(0, 80).toString("hex")}`);
  }
}

process.exit(0);
