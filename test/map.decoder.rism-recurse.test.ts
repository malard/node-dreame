/**
 * `MapDecoder.decode` rism-recurse path.
 *
 * Live-verified 2026-05-07 on r2532a fw 4.3.9_2199 (wealth-monitor's
 * `dreame-integration-gaps-2026-05-07.md`): the live I-frame's
 * top-level tail does not carry the `vw` user-geometry block; the
 * geometry lives inside `tail.rism`, itself a base64-encoded map
 * envelope (the persistent saved-map). The decoder recurses one
 * level into rism and merges the inner geometry onto the outer
 * `MapData` so consumers see "all walls for this floor" regardless
 * of where the device chose to put them.
 *
 * Fixture: `test/fixtures/saved-maps/r2532a-with-vws.json` is the
 * `/9` saved-map-list wrapper; `mapstr[0].map` is itself the saved-
 * map blob (i.e. the same shape the device embeds as
 * `tail.rism` in a live I-frame). For this test we feed the saved-
 * map blob directly — `MapDecoder.decode` should populate
 * virtualWalls / restrictedAreas from its top-level `vw` block. The
 * rism-recursion code path is exercised separately by synthesising
 * an outer envelope whose tail carries the saved-map blob as `rism`.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { MapDecoder, HEADER_SIZE } from "../src/map/index.js";

const FIXTURE = path.resolve("test/fixtures/saved-maps/r2532a-with-vws.json");

interface SavedMapWrapper {
  mapstr?: { id?: number; name?: string; angle?: string | number; map?: string }[];
  curr_id?: number;
}

describe("MapDecoder.decode — rism recurse (A1)", () => {
  it("decodes vw + vws from a saved-map blob's top-level tail (no recursion needed)", () => {
    if (!fs.existsSync(FIXTURE)) {
      // Fixture is required; surface a helpful error rather than skipping
      // silently — CI shouldn't pretend all is well if the fixture is gone.
      throw new Error(`fixture missing: ${FIXTURE}`);
    }
    const wrapper = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as SavedMapWrapper;
    const innerB64 = wrapper.mapstr?.[0]?.map;
    expect(typeof innerB64).toBe("string");
    expect(innerB64!.length).toBeGreaterThan(0);

    const data = MapDecoder.decode(innerB64!);
    // Fixture provenance (test/fixtures/saved-maps/README.md):
    //   vw.line  = 2 virtual walls       → kind: "wall" (or absent)
    //   vw.nocpt = 1 no-go rect          → restrictedAreas
    //   vws.vwsl    = 3 passable thresholds  → kind: "threshold", passable: true
    //                                         (because npthrsd is also present)
    //   vws.npthrsd = 2 impassable thresholds → kind: "threshold", passable: false
    expect(data.virtualWalls.length).toBe(2 + 3 + 2);
    const walls = data.virtualWalls.filter((w) => (w.kind ?? "wall") === "wall");
    const passable = data.virtualWalls.filter(
      (w) => w.kind === "threshold" && w.passable === true,
    );
    const impassable = data.virtualWalls.filter(
      (w) => w.kind === "threshold" && w.passable === false,
    );
    expect(walls).toHaveLength(2);
    expect(passable).toHaveLength(3);
    expect(impassable).toHaveLength(2);
    // vw.nocpt → 1 additional no-go rect alongside the empty vw.rect/mop.
    const noGo = data.restrictedAreas.filter((a) => a.kind === "noGo");
    expect(noGo).toHaveLength(1);
  });

  it("recurses into tail.rism when outer tail has no vw block", () => {
    if (!fs.existsSync(FIXTURE)) {
      throw new Error(`fixture missing: ${FIXTURE}`);
    }
    const wrapper = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as SavedMapWrapper;
    const savedMapB64 = wrapper.mapstr?.[0]?.map;
    expect(typeof savedMapB64).toBe("string");

    // Synthesize an outer envelope whose tail JSON has NO vw block but
    // does have `rism: <saved-map blob>`. Re-use the saved-map blob
    // bytes wholesale as the embedded rism — that's exactly the
    // shape r2532a's live I-frame uses.
    const outer = buildOuterEnvelopeWithRism(savedMapB64!);
    const data = MapDecoder.decode(outer);

    // Outer had no vw; rism recurse should surface ALL inner walls
    // (2 vw.line + 3 vws.vwsl + 2 vws.npthrsd = 7).
    expect(data.virtualWalls.length).toBe(7);
  });

  it("prefers the outer's vw when the outer has its own non-empty vw", () => {
    if (!fs.existsSync(FIXTURE)) {
      throw new Error(`fixture missing: ${FIXTURE}`);
    }
    const wrapper = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as SavedMapWrapper;
    const savedMapB64 = wrapper.mapstr?.[0]?.map;
    expect(typeof savedMapB64).toBe("string");

    // Outer has a single sentinel wall; rism has 2. Outer wins (rism
    // is fallback only when outer is empty).
    const outer = buildOuterEnvelopeWithRism(savedMapB64!, {
      vw: { line: [[0, 0, 100, 0]] },
    });
    const data = MapDecoder.decode(outer);
    expect(data.virtualWalls.length).toBe(1);
    expect(data.virtualWalls[0]?.from).toEqual({ x: 0, y: 0 });
    expect(data.virtualWalls[0]?.to).toEqual({ x: 100, y: 0 });
  });

  it("does not throw when rism is corrupt — outer frame still decodes", () => {
    const outer = buildOuterEnvelopeWithRism("not-a-valid-base64-envelope!!!");
    expect(() => MapDecoder.decode(outer)).not.toThrow();
    const data = MapDecoder.decode(outer);
    expect(data.virtualWalls).toEqual([]);
    expect(data.restrictedAreas).toEqual([]);
  });
});

/**
 * Build a minimal valid I-frame envelope that carries an arbitrary
 * tail JSON object — used to plant `rism` (and optionally `vw`) on
 * the outer tail without depending on a live capture.
 *
 * Header layout matches `parseMapHeader`'s expectations:
 *   bytes  0..1   robotX (int16 LE)
 *   bytes  2..3   robotY (int16 LE)
 *   byte   4      frame_type (73 = I)
 *   bytes  5..6   robotA (int16 LE)
 *   bytes  7..8   width  (int16 LE)
 *   bytes  9..10  height (int16 LE)
 *   bytes 11..14  left   (int32 LE)
 *   bytes 15..18  top    (int32 LE)
 *   byte  19      grid_size
 *   bytes 20..21  chargerX (int16 LE)
 *   bytes 22..23  chargerY (int16 LE)
 *   bytes 24..25  chargerA (int16 LE)
 *   byte  26      mapId
 *   then 0 pixel bytes (width=0,height=0), then UTF-8 tail JSON.
 *
 * Then zlib-deflate, base64-encode (URL-safe), return the string.
 */
function buildOuterEnvelopeWithRism(
  rism: string,
  tailExtra: Record<string, unknown> = {},
): string {
  const header = Buffer.alloc(HEADER_SIZE);
  // All zeros for poses / dims; just frame_type and grid_size matter
  // for header validation. width=0/height=0 means no pixel grid.
  header.writeInt16LE(0, 0); // robotX
  header.writeInt16LE(0, 2); // robotY
  header.writeUInt8(73, 4); // frame_type = 'I'
  header.writeInt16LE(0, 5); // robotA
  header.writeUInt16LE(0, 7); // width = 0
  header.writeUInt16LE(0, 9); // height = 0
  header.writeInt32LE(0, 11); // left
  header.writeInt32LE(0, 15); // top
  header.writeUInt8(50, 19); // grid_size 50mm
  header.writeInt16LE(0, 20); // chargerX
  header.writeInt16LE(0, 22); // chargerY
  header.writeInt16LE(0, 24); // chargerA
  header.writeUInt8(0, 26); // mapId

  const tail = Buffer.from(JSON.stringify({ rism, ...tailExtra }), "utf8");
  const inflated = Buffer.concat([header, tail]);
  const deflated = zlib.deflateSync(inflated);
  // URL-safe base64
  return deflated.toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
}
