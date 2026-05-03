/**
 * P-frame merging tests.
 *
 * Real-data tests (gated on the OSS I-frame fixture being present)
 * exercise the full chain: decode the I-frame, then sequentially apply
 * the 23 captured P-frames (frame_id 1265..1287) and assert the
 * invariants — frame_id advances, dimensions stay sensible, segment
 * count is stable, robot pose tracks each P-frame, the cleaning path
 * grows monotonically, and `OutOfOrderFrameError` fires on a deliberate
 * gap.
 *
 * Synthetic tests cover the things the captured chain doesn't exercise:
 *   - bbox union when a P-frame extends beyond the previous frame
 *   - byte-add wrap behaviour at the 0xFF boundary
 *   - rejection of map_id mismatch and grid_size mismatch
 *   - zero-bbox P-frame skipping the pixel-merge step
 *   - JSON tail merge: prev.tr + p.tr concatenation, seg_inf fallback
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  FRAME_TYPE,
  HEADER_SIZE,
  MapDecoder,
  OutOfOrderFrameError,
  mergePFrame,
  parseMapHeader,
  parseMapJsonTail,
  sliceTailText,
  unwrapEnvelope,
} from "../src/map/index.js";

const FIXTURE_DIR = path.resolve("test/fixtures/map");
const IFRAME_ENV_PATH = path.join(FIXTURE_DIR, "oss-ali_dreame_KB968216_660622937_0.envelope.txt");
const hasIFrame = fs.existsSync(IFRAME_ENV_PATH);
const describeReal = hasIFrame ? describe : describe.skip;

// ─── Synthetic frame builders ───────────────────────────────────────

interface SynthFrame {
  mapId?: number;
  frameId: number;
  frameType: "I" | "P";
  width: number;
  height: number;
  left: number;
  top: number;
  gridSize?: number;
  robot?: [number, number, number];
  charger?: [number, number, number];
  pixels?: Buffer | number[];
  tail?: Record<string, unknown>;
}

function buildFrame(f: SynthFrame): Buffer {
  const header = Buffer.alloc(HEADER_SIZE);
  header.writeInt16LE(f.mapId ?? 1, 0);
  header.writeInt16LE(f.frameId, 2);
  header[4] = f.frameType === "I" ? FRAME_TYPE.I : FRAME_TYPE.P;
  const robot = f.robot ?? [0, 0, 0];
  header.writeInt16LE(robot[0], 5);
  header.writeInt16LE(robot[1], 7);
  header.writeInt16LE(robot[2], 9);
  const charger = f.charger ?? [0, 0, 0];
  header.writeInt16LE(charger[0], 11);
  header.writeInt16LE(charger[1], 13);
  header.writeInt16LE(charger[2], 15);
  header.writeInt16LE(f.gridSize ?? 50, 17);
  header.writeInt16LE(f.width, 19);
  header.writeInt16LE(f.height, 21);
  header.writeInt16LE(f.left, 23);
  header.writeInt16LE(f.top, 25);

  const pixelLen = f.width * f.height;
  let pixels: Buffer;
  if (f.pixels === undefined) {
    pixels = Buffer.alloc(pixelLen);
  } else if (Buffer.isBuffer(f.pixels)) {
    pixels = f.pixels;
  } else {
    pixels = Buffer.from(f.pixels);
  }
  if (pixels.length !== pixelLen) {
    throw new Error(`buildFrame: pixel buffer length ${pixels.length} !== width*height ${pixelLen}`);
  }

  const tail = Buffer.from(JSON.stringify(f.tail ?? {}), "utf8");
  return Buffer.concat([header, pixels, tail]);
}

// ─── Synthetic merge tests ───────────────────────────────────────────

describe("mergePFrame: header + sequencing", () => {
  it("re-stamps the merged frame as I-frame and advances frame_id", () => {
    const prev = buildFrame({ frameId: 10, frameType: "I", width: 4, height: 4, left: 0, top: 0 });
    const p = buildFrame({ frameId: 11, frameType: "P", width: 0, height: 0, left: 0, top: 0 });
    const merged = mergePFrame(prev, p);
    const h = parseMapHeader(merged);
    expect(h.frameType).toBe("I");
    expect(h.frameId).toBe(11);
    expect(h.mapId).toBe(1);
  });

  it("throws OutOfOrderFrameError when frame_id is not prev+1", () => {
    const prev = buildFrame({ frameId: 10, frameType: "I", width: 4, height: 4, left: 0, top: 0 });
    const p = buildFrame({ frameId: 12, frameType: "P", width: 0, height: 0, left: 0, top: 0 });
    expect(() => mergePFrame(prev, p)).toThrow(OutOfOrderFrameError);
    try {
      mergePFrame(prev, p);
    } catch (err) {
      expect(err).toBeInstanceOf(OutOfOrderFrameError);
      const e = err as OutOfOrderFrameError;
      expect(e.expectedFrameId).toBe(11);
      expect(e.actualFrameId).toBe(12);
    }
  });

  it("throws when input is not a P-frame", () => {
    const prev = buildFrame({ frameId: 10, frameType: "I", width: 4, height: 4, left: 0, top: 0 });
    const notP = buildFrame({ frameId: 11, frameType: "I", width: 4, height: 4, left: 0, top: 0 });
    expect(() => mergePFrame(prev, notP)).toThrow(/expected P-frame/);
  });

  it("throws on map_id mismatch", () => {
    const prev = buildFrame({ mapId: 1, frameId: 10, frameType: "I", width: 4, height: 4, left: 0, top: 0 });
    const p = buildFrame({ mapId: 2, frameId: 11, frameType: "P", width: 0, height: 0, left: 0, top: 0 });
    expect(() => mergePFrame(prev, p)).toThrow(/map_id mismatch/);
  });

  it("throws on grid_size mismatch (non-zero P-frame)", () => {
    const prev = buildFrame({ frameId: 10, frameType: "I", width: 4, height: 4, left: 0, top: 0, gridSize: 50 });
    const p = buildFrame({ frameId: 11, frameType: "P", width: 4, height: 4, left: 0, top: 0, gridSize: 25 });
    expect(() => mergePFrame(prev, p)).toThrow(/grid_size changed/);
  });
});

describe("mergePFrame: pixel byte-add", () => {
  it("byte-adds P-frame pixels onto the previous frame in-place", () => {
    // 2×2 prev: [10, 20, 30, 40]
    // 2×2 P:    [ 1,  2,  3,  4]
    // expect merged: [11, 22, 33, 44]
    const prev = buildFrame({
      frameId: 5,
      frameType: "I",
      width: 2,
      height: 2,
      left: 0,
      top: 0,
      pixels: [10, 20, 30, 40],
    });
    const p = buildFrame({
      frameId: 6,
      frameType: "P",
      width: 2,
      height: 2,
      left: 0,
      top: 0,
      pixels: [1, 2, 3, 4],
    });
    const merged = mergePFrame(prev, p);
    expect(Array.from(merged.subarray(HEADER_SIZE, HEADER_SIZE + 4))).toEqual([11, 22, 33, 44]);
  });

  it("byte-add wraps modulo 256 (intentional, matches Tasshack)", () => {
    const prev = buildFrame({
      frameId: 5,
      frameType: "I",
      width: 1,
      height: 1,
      left: 0,
      top: 0,
      pixels: [200],
    });
    const p = buildFrame({
      frameId: 6,
      frameType: "P",
      width: 1,
      height: 1,
      left: 0,
      top: 0,
      pixels: [100],
    });
    const merged = mergePFrame(prev, p);
    expect(merged[HEADER_SIZE]).toBe(44); // (200 + 100) & 0xFF
  });

  it("zero-bbox P-frame leaves pixel grid untouched", () => {
    const prev = buildFrame({
      frameId: 5,
      frameType: "I",
      width: 2,
      height: 2,
      left: -100,
      top: -100,
      pixels: [10, 20, 30, 40],
    });
    const p = buildFrame({
      frameId: 6,
      frameType: "P",
      width: 0,
      height: 0,
      left: 0,
      top: 0,
      robot: [50, 60, 90],
    });
    const merged = mergePFrame(prev, p);
    const h = parseMapHeader(merged);
    expect(h.width).toBe(2);
    expect(h.height).toBe(2);
    expect(h.left).toBe(-100);
    expect(h.top).toBe(-100);
    expect(Array.from(merged.subarray(HEADER_SIZE, HEADER_SIZE + 4))).toEqual([10, 20, 30, 40]);
    // Robot pose is taken from the P-frame.
    expect(h.robotX).toBe(50);
    expect(h.robotY).toBe(60);
    expect(h.robotA).toBe(90);
  });
});

describe("mergePFrame: bbox union", () => {
  it("expands union when P-frame extends past prev's right/bottom edge", () => {
    // prev: 2×2 at (0,0) → world bbox (0,0)..(100,100) at gridSize=50
    // p:    2×2 at (50,50) → world bbox (50,50)..(150,150)
    // union: (0,0)..(150,150) → 3×3 grid
    const prev = buildFrame({
      frameId: 5,
      frameType: "I",
      width: 2,
      height: 2,
      left: 0,
      top: 0,
      pixels: [10, 20, 30, 40],
    });
    const p = buildFrame({
      frameId: 6,
      frameType: "P",
      width: 2,
      height: 2,
      left: 50,
      top: 50,
      pixels: [1, 2, 3, 4],
    });
    const merged = mergePFrame(prev, p);
    const h = parseMapHeader(merged);
    expect(h.width).toBe(3);
    expect(h.height).toBe(3);
    expect(h.left).toBe(0);
    expect(h.top).toBe(0);
    // Union grid (3×3, row-major):
    //   prev pixels at (0,0)..(1,1):   [10,20,_, 30,40,_, _,_,_]
    //   P pixels added at (1,1)..(2,2): adds 1@(1,1), 2@(2,1), 3@(1,2), 4@(2,2)
    // Combined: [10, 20, 0,  30, 41, 2,  0, 3, 4]
    expect(Array.from(merged.subarray(HEADER_SIZE, HEADER_SIZE + 9))).toEqual([
      10, 20, 0,
      30, 41, 2,
      0, 3, 4,
    ]);
  });

  it("expands union when P-frame extends past prev's left/top edge", () => {
    // prev: 2×2 at (50,50). p: 2×2 at (0,0). union: (0,0)..(150,150) → 3×3.
    const prev = buildFrame({
      frameId: 5,
      frameType: "I",
      width: 2,
      height: 2,
      left: 50,
      top: 50,
      pixels: [10, 20, 30, 40],
    });
    const p = buildFrame({
      frameId: 6,
      frameType: "P",
      width: 2,
      height: 2,
      left: 0,
      top: 0,
      pixels: [1, 2, 3, 4],
    });
    const merged = mergePFrame(prev, p);
    const h = parseMapHeader(merged);
    expect(h.width).toBe(3);
    expect(h.height).toBe(3);
    expect(h.left).toBe(0);
    expect(h.top).toBe(0);
    // p pixels at (0,0)..(1,1): [1,2,_, 3,4,_, _,_,_]
    // prev pixels added at (1,1)..(2,2): +10@(1,1), +20@(2,1), +30@(1,2), +40@(2,2)
    expect(Array.from(merged.subarray(HEADER_SIZE, HEADER_SIZE + 9))).toEqual([
      1, 2, 0,
      3, 14, 20,
      0, 30, 40,
    ]);
  });

  it("rejects P-frame whose origin is not aligned to prev's grid", () => {
    const prev = buildFrame({
      frameId: 5,
      frameType: "I",
      width: 2,
      height: 2,
      left: 0,
      top: 0,
      gridSize: 50,
    });
    const p = buildFrame({
      frameId: 6,
      frameType: "P",
      width: 2,
      height: 2,
      left: 25, // not a multiple of 50 from prev.left
      top: 0,
      gridSize: 50,
    });
    expect(() => mergePFrame(prev, p)).toThrow(/not aligned to prev grid/);
  });
});

describe("mergePFrame: JSON tail", () => {
  it("appends P-frame's tr to prev's tr (path is incremental)", () => {
    const prev = buildFrame({
      frameId: 5,
      frameType: "I",
      width: 1,
      height: 1,
      left: 0,
      top: 0,
      tail: { tr: "L0,0L10,10", timestamp_ms: 100 },
    });
    const p = buildFrame({
      frameId: 6,
      frameType: "P",
      width: 0,
      height: 0,
      left: 0,
      top: 0,
      tail: { tr: "l20,20l30,30", timestamp_ms: 200 },
    });
    const merged = mergePFrame(prev, p);
    const h = parseMapHeader(merged);
    const tail = parseMapJsonTail(sliceTailText(merged, h));
    expect(tail.tr).toBe("L0,0L10,10l20,20l30,30");
    expect(tail.timestamp_ms).toBe(200); // P's timestamp wins
  });

  it("falls back to prev's seg_inf when P doesn't carry one", () => {
    const prev = buildFrame({
      frameId: 5,
      frameType: "I",
      width: 1,
      height: 1,
      left: 0,
      top: 0,
      tail: { seg_inf: { "1": { name: "a2l0aw==" } } },
    });
    const p = buildFrame({
      frameId: 6,
      frameType: "P",
      width: 0,
      height: 0,
      left: 0,
      top: 0,
      tail: { timestamp_ms: 99 },
    });
    const merged = mergePFrame(prev, p);
    const h = parseMapHeader(merged);
    const tail = parseMapJsonTail(sliceTailText(merged, h));
    expect(tail.seg_inf).toEqual({ "1": { name: "a2l0aw==" } });
  });

  it("uses P's seg_inf when present (overrides prev)", () => {
    const prev = buildFrame({
      frameId: 5,
      frameType: "I",
      width: 1,
      height: 1,
      left: 0,
      top: 0,
      tail: { seg_inf: { "1": { name: "old" } } },
    });
    const p = buildFrame({
      frameId: 6,
      frameType: "P",
      width: 0,
      height: 0,
      left: 0,
      top: 0,
      tail: { seg_inf: { "1": { name: "new" }, "2": { name: "added" } } },
    });
    const merged = mergePFrame(prev, p);
    const h = parseMapHeader(merged);
    const tail = parseMapJsonTail(sliceTailText(merged, h));
    expect(tail.seg_inf).toEqual({ "1": { name: "new" }, "2": { name: "added" } });
  });

  it("rewrites origin to the union origin", () => {
    const prev = buildFrame({
      frameId: 5,
      frameType: "I",
      width: 2,
      height: 2,
      left: 50,
      top: 50,
      tail: { origin: [50, 50] },
    });
    const p = buildFrame({
      frameId: 6,
      frameType: "P",
      width: 2,
      height: 2,
      left: 0,
      top: 0,
      tail: { origin: [0, 0] },
    });
    const merged = mergePFrame(prev, p);
    const h = parseMapHeader(merged);
    const tail = parseMapJsonTail(sliceTailText(merged, h));
    expect(tail.origin).toEqual([0, 0]);
    expect(h.left).toBe(0);
    expect(h.top).toBe(0);
  });

  it("falls back to prev's vw when P doesn't carry one", () => {
    const prev = buildFrame({
      frameId: 5,
      frameType: "I",
      width: 1,
      height: 1,
      left: 0,
      top: 0,
      tail: { vw: { line: [[0, 0, 100, 0]] } },
    });
    const p = buildFrame({
      frameId: 6,
      frameType: "P",
      width: 0,
      height: 0,
      left: 0,
      top: 0,
      tail: { timestamp_ms: 99 },
    });
    const merged = mergePFrame(prev, p);
    const h = parseMapHeader(merged);
    const tail = parseMapJsonTail(sliceTailText(merged, h));
    expect(tail.vw).toEqual({ line: [[0, 0, 100, 0]] });
  });

  it("uses P's vw when present (overrides prev)", () => {
    const prev = buildFrame({
      frameId: 5,
      frameType: "I",
      width: 1,
      height: 1,
      left: 0,
      top: 0,
      tail: { vw: { line: [[0, 0, 100, 0]] } },
    });
    const p = buildFrame({
      frameId: 6,
      frameType: "P",
      width: 0,
      height: 0,
      left: 0,
      top: 0,
      tail: { vw: { rect: [[200, 200, 400, 400]] } },
    });
    const merged = mergePFrame(prev, p);
    const h = parseMapHeader(merged);
    const tail = parseMapJsonTail(sliceTailText(merged, h));
    expect(tail.vw).toEqual({ rect: [[200, 200, 400, 400]] });
  });

  it("falls back to prev's decmap when P doesn't carry one", () => {
    const prev = buildFrame({
      frameId: 5,
      frameType: "I",
      width: 1,
      height: 1,
      left: 0,
      top: 0,
      tail: { decmap: "PAYLOAD-A" },
    });
    const p = buildFrame({
      frameId: 6,
      frameType: "P",
      width: 0,
      height: 0,
      left: 0,
      top: 0,
      tail: {},
    });
    const merged = mergePFrame(prev, p);
    const h = parseMapHeader(merged);
    const tail = parseMapJsonTail(sliceTailText(merged, h));
    expect(tail.decmap).toBe("PAYLOAD-A");
  });
});

// ─── Real fixture chain ─────────────────────────────────────────────

describeReal("mergePFrame: real fixture chain (I-frame 1264 + 23 P-frames)", () => {
  function loadAll() {
    const ossEnv = fs.readFileSync(IFRAME_ENV_PATH, "utf8");
    const pframeFiles = fs
      .readdirSync(FIXTURE_DIR)
      .filter((f) => f.endsWith("-piid1-pframe.meta.json"))
      .sort();
    const pframes = pframeFiles.map((f) => {
      const meta = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, f), "utf8")) as {
        rawValue: string;
      };
      return { file: f, env: meta.rawValue };
    });
    return { ossEnv, pframes };
  }

  it("decodes the I-frame and applies all 23 P-frames in order without errors", () => {
    const { ossEnv, pframes } = loadAll();
    let buffer = unwrapEnvelope(ossEnv);
    let data = MapDecoder.decode(buffer);
    expect(data.frameId).toBe(1264);
    expect(data.frameType).toBe("I");

    const initialSegCount = data.segments.length;
    const initialDims = { ...data.dimensions };
    let prevPathPts = data.paths.reduce((a, p) => a + p.points.length, 0);
    let prevFrameId = data.frameId;

    for (const { env } of pframes) {
      const r = MapDecoder.applyPFrame(buffer, env);
      buffer = r.buffer;
      data = r.data;
      // frame_id strictly +1
      expect(data.frameId).toBe(prevFrameId + 1);
      prevFrameId = data.frameId;
      // dimensions never shrink
      expect(data.dimensions.width).toBeGreaterThanOrEqual(initialDims.width);
      expect(data.dimensions.height).toBeGreaterThanOrEqual(initialDims.height);
      // segment count never collapses
      expect(data.segments.length).toBeGreaterThanOrEqual(initialSegCount);
      // path is monotonic non-decreasing
      const pts = data.paths.reduce((a, p) => a + p.points.length, 0);
      expect(pts).toBeGreaterThanOrEqual(prevPathPts);
      prevPathPts = pts;
      // merged frame is re-stamped as I
      expect(data.frameType).toBe("I");
    }

    expect(prevFrameId).toBe(1287);
    expect(data.segments.length).toBe(initialSegCount); // stable across the chain
    expect(data.dimensions).toEqual(initialDims); // all P-frames fit inside the I-frame here
    expect(data.robot?.x).toBe(-6957);
    expect(data.robot?.y).toBe(13628);
  });

  it("emits a carpet overlay layer derived from path-B low-bits-11 pixels", () => {
    const { ossEnv, pframes } = loadAll();
    let buffer = unwrapEnvelope(ossEnv);
    for (const { env } of pframes) {
      buffer = MapDecoder.applyPFrame(buffer, env).buffer;
    }
    const data = MapDecoder.decode(buffer);
    const carpet = data.layers.find((l) => l.type === "carpet");
    expect(carpet).toBeDefined();
    expect(carpet!.runs.length).toBeGreaterThan(0);
  });

  it("OutOfOrderFrameError fires when a P-frame is applied with a gap", () => {
    const { ossEnv, pframes } = loadAll();
    const buffer = unwrapEnvelope(ossEnv);
    // skip the first P-frame (1265) and try to apply the second (1266)
    expect(() => MapDecoder.applyPFrame(buffer, pframes[1]!.env)).toThrow(OutOfOrderFrameError);
  });

  it("merging is idempotent w.r.t. starting buffer (no in-place mutation)", () => {
    const { ossEnv, pframes } = loadAll();
    const baseBuffer = unwrapEnvelope(ossEnv);
    const snapshot = Buffer.from(baseBuffer); // independent copy
    MapDecoder.applyPFrame(baseBuffer, pframes[0]!.env);
    expect(Buffer.compare(baseBuffer, snapshot)).toBe(0);
  });
});

