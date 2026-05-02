/**
 * One-shot smoke test: load OSS I-frame, sequentially merge all 23
 * pframe-named fixtures, log the running state after each step. Used
 * to sanity-check Phase 2 before adding proper vitest assertions.
 *
 * Usage: npx tsx examples/probe-merge-smoke.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { MapDecoder, unwrapEnvelope } from "../src/map/index.js";

const fixDir = path.resolve("test/fixtures/map");

const ossEnv = fs.readFileSync(
  path.join(fixDir, "oss-ali_dreame_KB968216_660622937_0.envelope.txt"),
  "utf8",
);

let buffer = unwrapEnvelope(ossEnv);
let data = MapDecoder.decode(buffer);
console.log(
  `I-frame  fid=${data.frameId} dims=${data.dimensions.width}×${data.dimensions.height} segs=${data.segments.length} layers=${data.layers.length} pathPts=${data.paths.reduce((a, p) => a + p.points.length, 0)} obstacles=${data.obstacles.length} robot=(${data.robot?.x},${data.robot?.y},${data.robot?.angle}°)`,
);

const pframeFiles = fs
  .readdirSync(fixDir)
  .filter((f) => f.endsWith("-piid1-pframe.meta.json"))
  .sort();

for (const f of pframeFiles) {
  const meta = JSON.parse(fs.readFileSync(path.join(fixDir, f), "utf8")) as {
    rawValue: string;
  };
  const result = MapDecoder.applyPFrame(buffer, meta.rawValue);
  buffer = result.buffer;
  data = result.data;
  const carpetLayer = data.layers.find((l) => l.type === "carpet");
  console.log(
    `${f.padEnd(32)} fid=${data.frameId} dims=${data.dimensions.width}×${data.dimensions.height} segs=${data.segments.length} layers=${data.layers.length} carpetRuns=${carpetLayer?.runs.length ?? 0} pathPts=${data.paths.reduce((a, p) => a + p.points.length, 0)} obstacles=${data.obstacles.length} robot=(${data.robot?.x},${data.robot?.y},${data.robot?.angle}°)`,
  );
}

console.log("");
console.log("Final segment count by id:");
for (const seg of data.segments) {
  console.log(
    `  seg ${String(seg.id).padStart(2)}: bbox=(${seg.bbox.xMin},${seg.bbox.yMin})..(${seg.bbox.xMax},${seg.bbox.yMax}) centroid=(${seg.centroid.x.toFixed(0)},${seg.centroid.y.toFixed(0)}) name=${seg.name}`,
  );
}
