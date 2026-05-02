/**
 * One-shot probe: dump the headers of the OSS I-frame and every
 * pframe-named fixture so we can verify Phase 2's merge inputs:
 *
 *   - I-frame frame_id, mapId, dimensions
 *   - P-frame chain contiguity (frame_ids increase by 1)
 *   - P-frame bbox dimensions (some may be 0×0 for "no spatial change")
 *   - P-frame world-frame `left`/`top` (for bbox union vs the I-frame)
 *
 * Usage: npx tsx examples/probe-pframe-headers.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseMapHeader, unwrapEnvelope } from "../src/map/index.js";

const fixDir = path.resolve("test/fixtures/map");

interface FrameInfo {
  file: string;
  mapId: number;
  frameId: number;
  frameType: string;
  width: number;
  height: number;
  left: number;
  top: number;
  gridSize: number;
  robotX: number;
  robotY: number;
  robotA: number;
}

function inspect(envelopeOrInflated: string | Buffer, file: string): FrameInfo {
  const inflated =
    typeof envelopeOrInflated === "string" ? unwrapEnvelope(envelopeOrInflated) : envelopeOrInflated;
  const h = parseMapHeader(inflated);
  return {
    file,
    mapId: h.mapId,
    frameId: h.frameId,
    frameType: h.frameType,
    width: h.width,
    height: h.height,
    left: h.left,
    top: h.top,
    gridSize: h.gridSize,
    robotX: h.robotX,
    robotY: h.robotY,
    robotA: h.robotA,
  };
}

const ossEnv = fs.readFileSync(path.join(fixDir, "oss-ali_dreame_KB968216_660622937_0.envelope.txt"), "utf8");
const iframe = inspect(ossEnv, "oss-iframe");
console.log("I-frame:", iframe);
console.log("");

const pframeFiles = fs
  .readdirSync(fixDir)
  .filter((f) => f.endsWith("-piid1-pframe.meta.json"))
  .sort();

const pframes: FrameInfo[] = [];
for (const metaFile of pframeFiles) {
  const meta = JSON.parse(fs.readFileSync(path.join(fixDir, metaFile), "utf8")) as { rawValue: string };
  const info = inspect(meta.rawValue, metaFile);
  pframes.push(info);
}

console.log("P-frame chain:");
console.log("seq | frame_id | dims (w×h) | (left, top) | robot pose");
console.log("----+----------+------------+-------------+------------");
let prevFrameId: number | null = null;
let gaps = 0;
for (let i = 0; i < pframes.length; i++) {
  const p = pframes[i]!;
  const gap = prevFrameId !== null && p.frameId !== prevFrameId + 1 ? " ← GAP" : "";
  if (gap) {
    gaps++;
  }
  console.log(
    `${String(i + 1).padStart(3)} | ${String(p.frameId).padStart(8)} | ${String(p.width).padStart(4)}×${String(p.height).padEnd(4)} | (${String(p.left).padStart(5)},${String(p.top).padStart(5)}) | (${p.robotX},${p.robotY},${p.robotA}°)${gap}`,
  );
  prevFrameId = p.frameId;
}

console.log("");
console.log(`Total P-frames: ${pframes.length}, gaps: ${gaps}`);
console.log(`First P-frame frame_id: ${pframes[0]?.frameId}, expected (I.frame_id + 1): ${iframe.frameId + 1}`);
console.log(`Same map_id as I-frame? ${pframes.every((p) => p.mapId === iframe.mapId)}`);

const zeroBbox = pframes.filter((p) => p.width === 0 || p.height === 0);
console.log(`Zero-bbox P-frames (no spatial change): ${zeroBbox.length}`);

// Show bbox union check vs I-frame for non-zero P-frames.
console.log("");
console.log("Non-zero P-frames vs I-frame bbox containment:");
const ifLeft = iframe.left;
const ifTop = iframe.top;
const ifRight = iframe.left + iframe.width * iframe.gridSize;
const ifBottom = iframe.top + iframe.height * iframe.gridSize;
console.log(`  I-frame world bbox: (${ifLeft},${ifTop})..(${ifRight},${ifBottom})  size ${iframe.width}×${iframe.height}px @ ${iframe.gridSize}mm/px`);
for (const p of pframes) {
  if (p.width === 0 || p.height === 0) {
    continue;
  }
  const pRight = p.left + p.width * p.gridSize;
  const pBottom = p.top + p.height * p.gridSize;
  const within =
    p.left >= ifLeft && p.top >= ifTop && pRight <= ifRight && pBottom <= ifBottom;
  if (!within) {
    console.log(
      `  ${p.file}: (${p.left},${p.top})..(${pRight},${pBottom}) — extends OUTSIDE I-frame bbox`,
    );
  }
}
console.log("(silent = all non-zero P-frames fit inside the I-frame's bbox)");
