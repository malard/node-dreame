/**
 * One-shot: decode the X50 (r2532a) map fixtures we already captured and
 * dump the JSON-tail key set, to determine whether this device emits the
 * Tasshack "version 3" (map_v2) frame layout.
 *
 * Upstream detects v3 from tail keys `saveMapId` / `cover` / `diff` /
 * `curtain` (map.py:4101-4112). If none appear here, the v3 pixel-decode
 * divergence does not apply to our tested hardware.
 *
 * Run: npx tsx examples/probe-map-version.ts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unwrapEnvelope } from "../src/map/envelope.js";
import { parseFrame } from "../src/map/tail.js";

const here = dirname(fileURLToPath(import.meta.url));
const fx = join(here, "..", "test", "fixtures");

const V3_MARKERS = ["saveMapId", "cover", "diff", "curtain"];

function report(label: string, value: string): void {
  let inflated: Buffer;
  try {
    inflated = unwrapEnvelope(value);
  } catch (err) {
    console.log(`\n${label}: unwrap FAILED — ${(err as Error).message}`);
    return;
  }
  let frame;
  try {
    frame = parseFrame(inflated);
  } catch (err) {
    console.log(`\n${label}: parseFrame FAILED — ${(err as Error).message}`);
    return;
  }
  const keys = Object.keys(frame.tail).sort();
  const hits = V3_MARKERS.filter((m) => m in frame.tail);
  console.log(`\n${label}`);
  console.log(`  frameType=${frame.header.frameType} ${frame.header.width}x${frame.header.height}`);
  console.log(`  tail keys: ${keys.join(", ")}`);
  console.log(`  v3 markers present: ${hits.length ? hits.join(", ") : "NONE"}`);
}

// 1) The big OSS I-frame capture.
const oss = readFileSync(join(fx, "map", "oss-ali_dreame_KB968216_660622937_0.bin"), "utf8").trim();
report("OSS I-frame (r2532a)", oss);

// 2) Each storey map string inside the saved-map JSON.
const saved = JSON.parse(readFileSync(join(fx, "saved-maps", "r2532a-with-vws.json"), "utf8"));
for (const entry of saved.mapstr ?? []) {
  report(`saved-map "${entry.name?.trim()}" (id=${entry.id})`, entry.map);
}
