/**
 * One-shot probe: do `tail.origin` and `header.left/top` agree for
 * P-frames in fsm:1 mode? The merge needs to know whether the tail's
 * origin is the global map origin (overrides header for I-frames only)
 * or the per-frame bbox origin (matches header for all frame types).
 *
 * Usage: npx tsx examples/probe-origin-vs-header.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseMapHeader, parseMapJsonTail, sliceTailText, unwrapEnvelope } from "../src/map/index.js";

const fixDir = path.resolve("test/fixtures/map");

function inspect(input: string | Buffer, label: string): void {
  const inflated = typeof input === "string" ? unwrapEnvelope(input) : input;
  const h = parseMapHeader(inflated);
  const t = parseMapJsonTail(sliceTailText(inflated, h));
  console.log(
    `${label}: type=${h.frameType} fid=${h.frameId} hdr.left/top=(${h.left},${h.top}) hdr.w/h=${h.width}×${h.height} tail.origin=${JSON.stringify(t.origin)}`,
  );
}

const ossEnv = fs.readFileSync(
  path.join(fixDir, "oss-ali_dreame_KB968216_660622937_0.envelope.txt"),
  "utf8",
);
inspect(ossEnv, "I-frame  ");

const ids = ["002", "003", "004", "010", "020", "024"];
for (const id of ids) {
  const metaPath = path.join(fixDir, `${id}-piid1-pframe.meta.json`);
  if (!fs.existsSync(metaPath)) {
    continue;
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as { rawValue: string };
  inspect(meta.rawValue, `P #${id}    `);
}
