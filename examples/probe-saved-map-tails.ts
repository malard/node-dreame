/**
 * Fetch the saved-map list (siid 6 piid 8 → `/9` OSS slot) and dump
 * the tail JSON of every inner saved-map blob (`mapstr[*].map`). Also
 * recursively decodes any `rism` field encountered. Use to discover
 * fields that carry user geometry (impassable thresholds, ramps,
 * cliffs, low-lying / sneak areas, ...).
 *
 * Usage:
 *   npx tsx examples/probe-saved-map-tails.ts [obj_name]
 *
 * If `obj_name` is omitted, reads it from siid 6 piid 8 (which may
 * 80001 — pass it explicitly from a recent JSONL capture if so).
 */
import { DreameClient } from "../src/index.js";
import { OssFetcher } from "../src/map/oss-fetch.js";
import { unwrapEnvelope, parseMapHeader, sliceTailText } from "../src/map/decoder.js";

const dreame = new DreameClient({
  email: process.env.DREAME_EMAIL!,
  password: process.env.DREAME_PASSWORD!,
  region: "eu",
});

const device = (await dreame.getDevices())[0]!;
console.log(`logged in as ${device.name} (${device.model}, did=${device.did})`);

let objName = process.argv[2];
if (!objName) {
  console.log(`reading siid 6 piid 8 to discover saved-map list pointer ...`);
  try {
    const res = await dreame.getProperties(device.did, [{ siid: 6, piid: 8 }]);
    const v = res[0]?.value;
    if (typeof v === "string" && v.length > 0) {
      const parsed = JSON.parse(v) as { obj_name?: string; object_name?: string; md5?: string };
      objName = parsed.obj_name ?? parsed.object_name;
      console.log(`pointer: ${objName} (md5=${parsed.md5})`);
    }
  } catch (err) {
    console.error(`getProperties failed: ${(err as Error).message}`);
    console.error(`pass the obj_name explicitly as argv[2] (last value seen on 6.8)`);
    process.exit(1);
  }
}
if (!objName) {
  console.error(`no obj_name available`);
  process.exit(1);
}

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

console.log(`fetching ${objName} ...`);
const wrapperBytes = await fetcher.fetchBlob({ ...base, filename: objName });
const wrapperText = wrapperBytes.toString("utf8");
let wrapper: { mapstr?: { id?: number; name?: string; angle?: string | number; map?: string }[]; curr_id?: number };
try {
  wrapper = JSON.parse(wrapperText);
} catch (err) {
  console.error(`wrapper JSON parse failed: ${(err as Error).message}`);
  console.error(`first 200 bytes hex: ${wrapperBytes.subarray(0, 200).toString("hex")}`);
  process.exit(1);
}

console.log(`wrapper: curr_id=${wrapper.curr_id} mapstr.length=${wrapper.mapstr?.length ?? 0}`);

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

function dumpTail(label: string, b64: string, depth = 0): void {
  const indent = "  ".repeat(depth);
  console.log(`\n${indent}=== ${label} ===`);
  let inflated: Buffer;
  try {
    inflated = unwrapEnvelope(b64);
  } catch (err) {
    console.log(`${indent}unwrap failed: ${(err as Error).message}`);
    return;
  }
  const header = parseMapHeader(inflated);
  console.log(`${indent}frameType=${header.frameType} frameId=${header.frameId} mapId=${header.mapId} dim=${header.width}x${header.height}`);
  if (header.frameType !== "I") {
    return;
  }
  const tailText = sliceTailText(inflated, header);
  let tail: Record<string, unknown>;
  try {
    tail = JSON.parse(tailText);
  } catch (err) {
    console.log(`${indent}tail parse failed: ${(err as Error).message}`);
    return;
  }
  console.log(`${indent}tail keys (${Object.keys(tail).length}): ${Object.keys(tail).sort().join(", ")}`);
  // Highlight geometry-bearing keys explicitly.
  const geomKeys = ["vw", "vws", "rec_vws", "sneak_areas", "sneak_areas_end", "ai_outborders_user"];
  for (const k of geomKeys) {
    if (k in tail) {
      console.log(`${indent}  ${k}: ${summarise(tail[k])}`);
    }
  }
  // Print the FULL tail JSON so we don't miss anything.
  console.log(`${indent}--- FULL TAIL JSON ---`);
  console.log(JSON.stringify(tail, null, 2).split("\n").map((l) => indent + l).join("\n"));
  // Recurse into rism if present.
  if (typeof tail["rism"] === "string" && depth < 2) {
    dumpTail(`${label} → rism`, tail["rism"] as string, depth + 1);
  }
}

const mapstr = wrapper.mapstr ?? [];
for (let i = 0; i < mapstr.length; i++) {
  const entry = mapstr[i]!;
  console.log(`\n========== mapstr[${i}] id=${entry.id} name=${JSON.stringify(entry.name)} angle=${entry.angle} ==========`);
  if (typeof entry.map === "string" && entry.map.length > 0) {
    dumpTail(`mapstr[${i}].map`, entry.map);
  } else {
    console.log(`(no .map payload)`);
  }
}

process.exit(0);
