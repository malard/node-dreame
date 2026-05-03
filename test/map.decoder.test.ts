/**
 * Pure-decoder tests.
 *
 * Real-data tests use captured fixture #1 from r2532a (2026-05-02): a
 * P-frame on `map_id=3, frame_id=584`, idle robot, 12 obstacles. If
 * `test/fixtures/map/001-piid1-unknown.bin` is missing the real-data
 * tests skip gracefully — they're gated on the actual capture, not
 * synthesized content (which would just be testing our own assumptions).
 *
 * Synthetic tests cover what the captured fixtures don't exercise:
 *   - the pixel grid decoder (no segment data in any captured fixture
 *     yet — the device only emits seg_inf at session start / on map_id
 *     flip and we joined mid-stream)
 *   - the `tr` path parser (every captured fixture has empty `tr`)
 *   - the carpet/wall/floor pixel classifications.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import {
  MapDecoder,
  MapDecodeError,
  HEADER_SIZE,
  ANGLE_ABSENT,
  FRAME_TYPE,
  unwrapEnvelope,
  parseMapHeader,
  parseMapJsonTail,
  classifyPixelFsm1,
  decodePixelGridFsm1,
  parsePathTr,
  parseObstacles,
  parseVirtualWalls,
  parseCleanedAreaOverlay,
} from "../src/map/index.js";

const FIXTURE_DIR = path.resolve("test/fixtures/map");
const FIXTURE_001 = path.join(FIXTURE_DIR, "001-piid1-unknown.bin");
const FIXTURE_001_META = path.join(FIXTURE_DIR, "001-piid1-unknown.meta.json");
const FIXTURE_IFRAME_ENV = path.join(FIXTURE_DIR, "oss-ali_dreame_KB968216_660622937_0.envelope.txt");
const hasFixtures = fs.existsSync(FIXTURE_001);
const hasIFrame = fs.existsSync(FIXTURE_IFRAME_ENV);

const describeReal = hasFixtures ? describe : describe.skip;
const describeIFrame = hasIFrame ? describe : describe.skip;

// ─── envelope ────────────────────────────────────────────────────────

describe("unwrapEnvelope", () => {
  it("decodes URL-safe base64 with hyphen and underscore", () => {
    // Known zlib for the bytes [1,2,3,4]: x\x9ccdbf\x07\x00\x00\x14\x00\x0b
    // Base64: eJxjZGJmBwAAFAAL  (no URL-safe chars)  → use a constructed
    // payload below to exercise the URL-safe translation.
    const original = Buffer.from([1, 2, 3, 4]);
    const compressed = zlib.deflateSync(original);
    const standardB64 = compressed.toString("base64");
    const urlSafe = standardB64.replace(/\+/g, "-").replace(/\//g, "_");
    const out = unwrapEnvelope(urlSafe);
    expect(Buffer.compare(out, original)).toBe(0);
  });

  it("throws on empty input", () => {
    expect(() => unwrapEnvelope("")).toThrow(MapDecodeError);
  });

  it("throws when AES key supplied without IV", () => {
    expect(() => unwrapEnvelope("abc,somekey", { /* iv missing */ })).toThrow(/IV/);
  });
});

// ─── header ──────────────────────────────────────────────────────────

describe("parseMapHeader", () => {
  it("parses every field at the right offset", () => {
    const buf = Buffer.alloc(HEADER_SIZE);
    buf.writeInt16LE(7, 0);       // mapId
    buf.writeInt16LE(123, 2);     // frameId
    buf[4] = 73;                  // 'I'
    buf.writeInt16LE(-1500, 5);
    buf.writeInt16LE(2500, 7);
    buf.writeInt16LE(90, 9);
    buf.writeInt16LE(0, 11);
    buf.writeInt16LE(0, 13);
    buf.writeInt16LE(180, 15);
    buf.writeInt16LE(50, 17);
    buf.writeInt16LE(200, 19);
    buf.writeInt16LE(150, 21);
    buf.writeInt16LE(-5000, 23);
    buf.writeInt16LE(-3000, 25);
    const h = parseMapHeader(buf);
    expect(h).toEqual({
      mapId: 7,
      frameId: 123,
      frameType: "I",
      robotX: -1500,
      robotY: 2500,
      robotA: 90,
      chargerX: 0,
      chargerY: 0,
      chargerA: 180,
      gridSize: 50,
      width: 200,
      height: 150,
      left: -5000,
      top: -3000,
    });
  });

  it("throws on unknown frame_type byte", () => {
    const buf = Buffer.alloc(HEADER_SIZE);
    buf[4] = 99;
    expect(() => parseMapHeader(buf)).toThrow(/frame_type/);
  });

  it("throws when buffer is too short", () => {
    expect(() => parseMapHeader(Buffer.alloc(10))).toThrow(/27 bytes/);
  });
});

// ─── pixel decoder (path B / fsm:1) — synthetic ─────────────────────

describe("classifyPixelFsm1", () => {
  it("byte 0 → outside", () => {
    expect(classifyPixelFsm1(0)).toEqual({ kind: "outside" });
  });

  it("segment id 63 → wall regardless of meta bits", () => {
    expect(classifyPixelFsm1((63 << 2) | 0)).toEqual({ kind: "wall" });
    expect(classifyPixelFsm1((63 << 2) | 2)).toEqual({ kind: "wall" });
  });

  it("segment id 62 → floor", () => {
    expect(classifyPixelFsm1((62 << 2) | 0)).toEqual({ kind: "floor" });
  });

  it("segment id 61 → outside (UNKNOWN class)", () => {
    expect(classifyPixelFsm1((61 << 2) | 0)).toEqual({ kind: "outside" });
  });

  it("real segment ids 1..60 carry segmentId", () => {
    expect(classifyPixelFsm1((5 << 2) | 0)).toEqual({ kind: "segment", segmentId: 5 });
    expect(classifyPixelFsm1((42 << 2) | 0)).toEqual({ kind: "segment", segmentId: 42 });
  });

  it("low bits 10 with zero high bits = wall marker", () => {
    expect(classifyPixelFsm1(0b00000010)).toEqual({ kind: "wall" });
  });
});

describe("decodePixelGridFsm1", () => {
  it("groups consecutive same-class pixels into runs and never crosses rows", () => {
    // 4-wide, 2-row grid:
    //   row 0:  seg5 seg5 wall floor
    //   row 1:  seg5 seg7 seg7 outside
    const seg5 = (5 << 2) | 0;
    const seg7 = (7 << 2) | 0;
    const wall = (63 << 2) | 0;
    const floor = (62 << 2) | 0;
    const grid = Buffer.from([seg5, seg5, wall, floor, seg5, seg7, seg7, 0]);
    const layers = decodePixelGridFsm1(grid, 4, 2);
    const byType = (t: string, id?: number) =>
      layers.find((l) => l.type === t && (id === undefined || l.segmentId === id));
    expect(byType("wall")?.runs).toEqual([[2, 0, 1]]);
    expect(byType("floor")?.runs).toEqual([[3, 0, 1]]);
    expect(byType("segment", 5)?.runs).toEqual([
      [0, 0, 2],
      [0, 1, 1],
    ]);
    expect(byType("segment", 7)?.runs).toEqual([[1, 1, 2]]);
  });

  it("emits no layers for an all-outside grid", () => {
    const grid = Buffer.alloc(16);
    expect(decodePixelGridFsm1(grid, 4, 4)).toEqual([]);
  });
});

// ─── path parser (`tr`) — synthetic ──────────────────────────────────

describe("parsePathTr", () => {
  it("groups consecutive same-op points into one segment", () => {
    const tr = "L100,200L150,250L200,300S500,600S550,650";
    const out = parsePathTr(tr);
    expect(out).toEqual([
      { type: "line", points: [{ x: 100, y: 200 }, { x: 150, y: 250 }, { x: 200, y: 300 }] },
      { type: "sweep", points: [{ x: 500, y: 600 }, { x: 550, y: 650 }] },
    ]);
  });

  it("treats lowercase l (P-frame continuation) as L", () => {
    const out = parsePathTr("L10,20l30,40l50,60");
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("line");
    expect(out[0]!.points).toHaveLength(3);
  });

  it("handles negative coordinates", () => {
    expect(parsePathTr("M-100,-200")).toEqual([
      { type: "mop", points: [{ x: -100, y: -200 }] },
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(parsePathTr("")).toEqual([]);
  });
});

// ─── obstacle parser — synthetic ─────────────────────────────────────

describe("parseObstacles", () => {
  it("decodes a 14-field record into the public schema", () => {
    const raw = [
      [
        "-1313.026123",
        "3011.018555",
        "160",
        "0.749496",
        "1777753386.646569",
        "/data/record/ai_image/foo.jpg",
        "19729854450",
        "0.681641",
        "0.299603",
        "0.315048",
        "0.280838",
        "2",
        "0",
        "4",
      ],
    ];
    const out = parseObstacles(raw);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      id: 19729854450,
      x: -1313.026123,
      y: 3011.018555,
      type: 160,
      confidence: 75,
      photoFileName: "/data/record/ai_image/foo.jpg",
      photoKey: null,
    });
  });

  it("skips entries that are too short or non-numeric in required fields", () => {
    const raw = [
      [],
      ["x", "y", "type"], // x not numeric
      ["1", "2", "3", "0.5", "ts", "/p", "100"],
    ];
    expect(parseObstacles(raw)).toHaveLength(1);
  });
});

// ─── parseVirtualWalls ──────────────────────────────────────────────

describe("parseVirtualWalls", () => {
  it("returns empty arrays for an absent vw block", () => {
    const out = parseVirtualWalls(undefined);
    expect(out.virtualWalls).toEqual([]);
    expect(out.restrictedAreas).toEqual([]);
  });

  it("parses line segments as { from, to } pairs in raw mm", () => {
    const out = parseVirtualWalls({
      line: [
        [-1000, 2000, -1000, 3500],
        [500, 800, 1500, 800],
      ],
    });
    expect(out.virtualWalls).toEqual([
      { from: { x: -1000, y: 2000 }, to: { x: -1000, y: 3500 } },
      { from: { x: 500, y: 800 }, to: { x: 1500, y: 800 } },
    ]);
    expect(out.restrictedAreas).toEqual([]);
  });

  it("parses no-go rects as axis-aligned bboxes (corners sorted)", () => {
    const out = parseVirtualWalls({
      rect: [[3000, 5000, 1000, 2000]], // intentionally unsorted corners
    });
    expect(out.restrictedAreas).toEqual([
      {
        kind: "noGo",
        bbox: { xMin: 1000, yMin: 2000, xMax: 3000, yMax: 5000 },
      },
    ]);
  });

  it("captures the optional 5th element as `angle`", () => {
    const out = parseVirtualWalls({
      rect: [[0, 0, 100, 100, 45]],
    });
    expect(out.restrictedAreas).toHaveLength(1);
    expect(out.restrictedAreas[0]!.angle).toBe(45);
  });

  it("tags vw.mop entries with kind=noMop", () => {
    const out = parseVirtualWalls({
      rect: [[0, 0, 100, 100]],
      mop: [[200, 200, 400, 400]],
    });
    expect(out.restrictedAreas.map((a) => a.kind)).toEqual(["noGo", "noMop"]);
  });

  it("accepts string-typed numbers (Dreame ships some fields as strings)", () => {
    const out = parseVirtualWalls({
      line: [["100", "200", "300", "400"] as unknown as number[]],
    });
    expect(out.virtualWalls).toEqual([
      { from: { x: 100, y: 200 }, to: { x: 300, y: 400 } },
    ]);
  });

  it("skips malformed entries silently", () => {
    const out = parseVirtualWalls({
      line: [
        [1, 2, 3], // too short
        ["a", "b", "c", "d"], // non-numeric
        [1, 2, 3, 4],
      ],
      rect: [
        [], // empty
        [10, 20, 30, 40], // good
      ],
    });
    expect(out.virtualWalls).toHaveLength(1);
    expect(out.restrictedAreas).toHaveLength(1);
  });
});

// ─── parseCleanedAreaOverlay ────────────────────────────────────────

function buildDecmapEnvelope(opts: {
  width: number;
  height: number;
  pixels: number[];
  left?: number;
  top?: number;
  gridSize?: number;
  innerTail?: Record<string, unknown>;
}): string {
  const header = Buffer.alloc(HEADER_SIZE);
  header.writeInt16LE(1, 0);
  header.writeInt16LE(0, 2);
  header[4] = FRAME_TYPE.I;
  header.writeInt16LE(opts.gridSize ?? 50, 17);
  header.writeInt16LE(opts.width, 19);
  header.writeInt16LE(opts.height, 21);
  header.writeInt16LE(opts.left ?? 0, 23);
  header.writeInt16LE(opts.top ?? 0, 25);
  const pixels = Buffer.from(opts.pixels);
  const tail = Buffer.from(JSON.stringify(opts.innerTail ?? {}), "utf8");
  return zlib.deflateSync(Buffer.concat([header, pixels, tail])).toString("base64");
}

describe("parseCleanedAreaOverlay", () => {
  it("returns null for empty input", () => {
    expect(parseCleanedAreaOverlay("")).toBeNull();
  });

  it("returns null for malformed envelope", () => {
    expect(parseCleanedAreaOverlay("@@not-base64@@")).toBeNull();
  });

  it("decodes inner dimensions from the embedded blob's header", () => {
    const env = buildDecmapEnvelope({
      width: 4,
      height: 3,
      pixels: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      left: -1000,
      top: 500,
      gridSize: 50,
    });
    const out = parseCleanedAreaOverlay(env);
    expect(out).not.toBeNull();
    expect(out!.dimensions).toEqual({
      left: -1000,
      top: 500,
      width: 4,
      height: 3,
      gridSize: 50,
    });
    expect(out!.cleaned).toEqual([]);
    expect(out!.dirty).toEqual([]);
  });

  it("classifies pixels by their low 2 bits (1=cleaned, 2=dirty)", () => {
    // Row 0: [cleaned, cleaned, dirty, 0]
    // Row 1: [dirty, cleaned, dirty, dirty]
    // High bits are mixed in to verify only low 2 are used.
    const env = buildDecmapEnvelope({
      width: 4,
      height: 2,
      pixels: [
        0xfd, 0x05, 0xfe, 0x00, // 0xfd & 3 = 1, 0x05 & 3 = 1, 0xfe & 3 = 2, 0
        0xf2, 0xf1, 0x06, 0x06, // 2, 1, 2, 2
      ],
    });
    const out = parseCleanedAreaOverlay(env)!;
    // Cleaned runs: [0,0,2] (cols 0-1 row 0), [1,1,1] (col 1 row 1)
    expect(out.cleaned).toEqual([
      [0, 0, 2],
      [1, 1, 1],
    ]);
    // Dirty runs: [2,0,1] (col 2 row 0), [0,1,1] (col 0 row 1), [2,1,2] (cols 2-3 row 1)
    expect(out.dirty).toEqual([
      [2, 0, 1],
      [0, 1, 1],
      [2, 1, 2],
    ]);
  });

  it("captures the inner tail's CleanArea field as cleanedSegments", () => {
    const env = buildDecmapEnvelope({
      width: 1,
      height: 1,
      pixels: [1],
      innerTail: { CleanArea: { "1": 12.5, "2": 8.3 } },
    });
    const out = parseCleanedAreaOverlay(env)!;
    expect(out.cleanedSegments).toEqual({ "1": 12.5, "2": 8.3 });
  });

  it("omits cleanedSegments when CleanArea is absent", () => {
    const env = buildDecmapEnvelope({
      width: 1,
      height: 1,
      pixels: [1],
      innerTail: { other: "stuff" },
    });
    const out = parseCleanedAreaOverlay(env)!;
    expect(out.cleanedSegments).toBeUndefined();
  });
});

// ─── real fixture round-trip ─────────────────────────────────────────

describeReal("real fixture: 001-piid1 (r2532a P-frame, map_id=3, frame_id=584)", () => {
  // Lazy load — describe.skip doesn't prevent describe-block execution,
  // so reading the file here would ENOENT in CI when fixtures are absent.
  const loadMeta = () =>
    JSON.parse(fs.readFileSync(FIXTURE_001_META, "utf8")) as { rawValue: string };

  it("unwraps the MQTT base64+zlib envelope", () => {
    const meta = loadMeta();
    const inflated = unwrapEnvelope(meta.rawValue);
    expect(inflated.length).toBeGreaterThan(HEADER_SIZE);
  });

  it("parses the header to expected values", () => {
    const meta = loadMeta();
    const inflated = unwrapEnvelope(meta.rawValue);
    const header = parseMapHeader(inflated);
    expect(header.mapId).toBe(3);
    expect(header.frameId).toBe(584);
    expect(header.frameType).toBe("P");
    expect(header.robotX).toBe(-1118);
    expect(header.robotY).toBe(4544);
    expect(header.gridSize).toBe(50);
    expect(header.width).toBe(157);
    expect(header.height).toBe(115);
  });

  it("parses the JSON tail with the keys v1 cares about", () => {
    const meta = loadMeta();
    const inflated = unwrapEnvelope(meta.rawValue);
    const header = parseMapHeader(inflated);
    const tailText = inflated.subarray(HEADER_SIZE + header.width * header.height).toString("utf8");
    const tail = parseMapJsonTail(tailText);
    expect(tail.timestamp_ms).toBeGreaterThan(0);
    expect(tail.origin).toEqual([-7200, 2450]);
    expect(tail.mra).toBe(90);
    expect(tail.fsm).toBe(1);
    expect(tail.ai_obstacle).toBeDefined();
    expect(tail.ai_obstacle!.length).toBe(12);
  });

  it("MapDecoder.decode returns a complete MapData", () => {
    const meta = loadMeta();
    const md = MapDecoder.decode(meta.rawValue);
    expect(md.mapId).toBe(3);
    expect(md.frameId).toBe(584);
    expect(md.frameType).toBe("P");
    // No virtual walls / no-go zones configured on this device.
    expect(md.virtualWalls).toEqual([]);
    expect(md.restrictedAreas).toEqual([]);
    // No decmap on idle live-stream P-frames.
    expect(md.cleanedArea).toBeNull();
    expect(md.dimensions).toEqual({
      left: -7200,
      top: 2450,
      width: 157,
      height: 115,
      gridSize: 50,
    });
    expect(md.robot).toEqual({ x: -1118, y: 4544, angle: 254 });
    expect(md.dock).toEqual({ x: -137, y: 1936, angle: 178 });
    expect(md.docked).toBe(false); // `oc` not present in this idle fixture
    expect(md.rotation).toBe(90);
    expect(md.obstacles).toHaveLength(12);
    // P-frame pixel data is delta-encoded — without an I-frame to merge
    // onto, the per-pixel classifications are not meaningful, so we
    // only assert the layer shape is well-formed, not the contents.
    expect(Array.isArray(md.layers)).toBe(true);
    expect(md.paths).toEqual([]); // empty `tr` in this idle fixture
    expect(md.segments).toEqual([]); // no `seg_inf` until next session boundary
  });

  it("absent-angle sentinel test: ANGLE_ABSENT = 0x7FFF", () => {
    expect(ANGLE_ABSENT).toBe(0x7fff);
  });
});

// ─── real I-frame fixture (fetched from OSS via PATH push) ──────────

describeIFrame("real I-frame fixture (OSS-fetched on r2532a)", () => {
  const loadEnvelope = () => fs.readFileSync(FIXTURE_IFRAME_ENV, "utf8");

  it("decodes the full I-frame end-to-end", () => {
    const envelope = loadEnvelope();
    const md = MapDecoder.decode(envelope);
    expect(md.frameType).toBe("I");
    expect(md.mapId).toBe(3);
    expect(md.dimensions).toEqual({
      left: -9950,
      top: -650,
      width: 348,
      height: 470,
      gridSize: 50,
    });
    expect(md.robot).toEqual({ x: -4099, y: 12870, angle: 175 });
    expect(md.dock).toEqual({ x: -134, y: 1930, angle: 177 });
  });

  it("decodes layers (wall + floor + per-segment)", () => {
    const envelope = loadEnvelope();
    const md = MapDecoder.decode(envelope);
    const types = md.layers.map((l) => l.type);
    expect(types).toContain("wall");
    expect(types).toContain("floor");
    expect(types.filter((t) => t === "segment").length).toBeGreaterThan(0);
    // Every layer should have at least one run.
    for (const l of md.layers) {
      expect(l.runs.length).toBeGreaterThan(0);
    }
  });

  it("collects sensible segments (each with non-zero bbox area)", () => {
    const envelope = loadEnvelope();
    const md = MapDecoder.decode(envelope);
    expect(md.segments.length).toBeGreaterThanOrEqual(5);
    for (const s of md.segments) {
      const w = s.bbox.xMax - s.bbox.xMin;
      const h = s.bbox.yMax - s.bbox.yMin;
      expect(w).toBeGreaterThan(0);
      expect(h).toBeGreaterThan(0);
      // Centroid lies inside the bbox.
      expect(s.centroid.x).toBeGreaterThanOrEqual(s.bbox.xMin);
      expect(s.centroid.x).toBeLessThanOrEqual(s.bbox.xMax);
      expect(s.centroid.y).toBeGreaterThanOrEqual(s.bbox.yMin);
      expect(s.centroid.y).toBeLessThanOrEqual(s.bbox.yMax);
    }
  });

  it("decodes obstacles", () => {
    const envelope = loadEnvelope();
    const md = MapDecoder.decode(envelope);
    expect(md.obstacles.length).toBeGreaterThan(0);
    for (const o of md.obstacles) {
      expect(Number.isFinite(o.x)).toBe(true);
      expect(Number.isFinite(o.y)).toBe(true);
      expect(o.confidence).toBeGreaterThanOrEqual(0);
      expect(o.confidence).toBeLessThanOrEqual(100);
    }
  });
});
