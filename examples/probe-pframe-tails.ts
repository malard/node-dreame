/**
 * One-shot probe: inspect the JSON tail of the OSS I-frame and a few
 * sample P-frames to figure out what fields a merge needs to preserve,
 * overwrite, or accumulate.
 *
 * Usage: npx tsx examples/probe-pframe-tails.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseMapHeader, parseMapJsonTail, sliceTailText, unwrapEnvelope } from "../src/map/index.js";

const fixDir = path.resolve("test/fixtures/map");

function tail(input: string | Buffer): { keys: string[]; tail: Record<string, unknown>; trLen: number } {
  const buf = typeof input === "string" ? unwrapEnvelope(input) : input;
  const h = parseMapHeader(buf);
  const tailText = sliceTailText(buf, h);
  const t = parseMapJsonTail(tailText);
  const trLen = typeof t.tr === "string" ? t.tr.length : 0;
  return { keys: Object.keys(t).sort(), tail: t, trLen };
}

const ossEnv = fs.readFileSync(path.join(fixDir, "oss-ali_dreame_KB968216_660622937_0.envelope.txt"), "utf8");
const iframe = tail(ossEnv);
console.log("I-frame keys:", iframe.keys);
console.log("I-frame tr length:", iframe.trLen);
console.log("I-frame seg_inf segment count:", iframe.tail.seg_inf ? Object.keys(iframe.tail.seg_inf as object).length : 0);
console.log("");

const samplePframes = ["002", "003", "010", "020", "024"];
for (const seq of samplePframes) {
  const metaPath = path.join(fixDir, `${seq}-piid1-pframe.meta.json`);
  if (!fs.existsSync(metaPath)) {
    continue;
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as { rawValue: string };
  const t = tail(meta.rawValue);
  console.log(`P-frame ${seq}: keys=${t.keys.join(",")}, tr.len=${t.trLen}, has seg_inf=${"seg_inf" in t.tail}, has ai_obstacle=${"ai_obstacle" in t.tail}`);
  if (t.trLen > 0 && t.trLen < 200) {
    console.log(`  tr: ${(t.tail.tr as string).slice(0, 200)}`);
  } else if (t.trLen > 0) {
    console.log(`  tr (truncated): ${(t.tail.tr as string).slice(0, 100)}...`);
  }
}

// Show I-frame tr first 200 chars (since we'd need to append P tr to it)
if (iframe.trLen > 0) {
  console.log("");
  console.log(`I-frame tr (first 200): ${(iframe.tail.tr as string).slice(0, 200)}`);
}

// Show full seg_inf of I-frame to understand the structure
console.log("");
console.log("I-frame seg_inf entries:");
const segInf = iframe.tail.seg_inf as Record<string, unknown> | undefined;
if (segInf) {
  for (const [id, info] of Object.entries(segInf)) {
    console.log(`  ${id}: ${JSON.stringify(info).slice(0, 200)}`);
  }
}
