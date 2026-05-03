/**
 * Tests for the saved-map list decoder.
 *
 * The exported `decodeSavedMapList` helper takes the OSS-fetched bytes
 * (a JSON wrapper `{mapstr: [...], curr_id}`) and produces a
 * `MapSavedList`. Wire format is ASSUMED from Tasshack — these tests
 * pin the parsing of synthetic wrappers that match that assumption.
 *
 * The full `Vacuum.fetchSavedMapList` end-to-end (auth → property read
 * → OSS fetch → decode) is gated on a real device and not unit-tested.
 */

import { describe, expect, it } from "vitest";
import * as zlib from "node:zlib";
import { decodeSavedMapList } from "../src/vacuum.js";
import { FRAME_TYPE, HEADER_SIZE } from "../src/map/index.js";

function buildSavedMapBlob(opts: {
  mapId: number;
  width?: number;
  height?: number;
}): string {
  const width = opts.width ?? 4;
  const height = opts.height ?? 4;
  const header = Buffer.alloc(HEADER_SIZE);
  header.writeInt16LE(opts.mapId, 0);
  header.writeInt16LE(0, 2);
  header[4] = FRAME_TYPE.I;
  header.writeInt16LE(50, 17);
  header.writeInt16LE(width, 19);
  header.writeInt16LE(height, 21);
  const pixels = Buffer.alloc(width * height);
  const tail = Buffer.from(JSON.stringify({}), "utf8");
  return zlib.deflateSync(Buffer.concat([header, pixels, tail])).toString("base64");
}

function buildWrapper(payload: unknown): Buffer {
  return Buffer.from(JSON.stringify(payload), "utf8");
}

describe("decodeSavedMapList", () => {
  it("returns null for non-JSON bodies", () => {
    expect(decodeSavedMapList(Buffer.from("@@not-json@@"))).toBeNull();
  });

  it("returns null when the wrapper lacks `mapstr`", () => {
    expect(decodeSavedMapList(buildWrapper({ other: "thing" }))).toBeNull();
  });

  it("returns null when no entry has a usable `map` blob", () => {
    expect(
      decodeSavedMapList(buildWrapper({ mapstr: [{ name: "Empty" }, {}] })),
    ).toBeNull();
  });

  it("decodes a single-map wrapper", () => {
    const wrapper = buildWrapper({
      mapstr: [{ map: buildSavedMapBlob({ mapId: 7 }), name: "Ground", angle: 90 }],
      curr_id: 7,
    });
    const out = decodeSavedMapList(wrapper)!;
    expect(out.activeMapId).toBe(7);
    expect(out.maps).toHaveLength(1);
    expect(out.maps[0]!.mapId).toBe(7);
    expect(out.maps[0]!.name).toBe("Ground");
    expect(out.maps[0]!.angle).toBe(90);
    expect(out.maps[0]!.data.frameType).toBe("I");
  });

  it("decodes multiple maps and respects curr_id", () => {
    const wrapper = buildWrapper({
      mapstr: [
        { map: buildSavedMapBlob({ mapId: 1 }), name: "First Floor" },
        { map: buildSavedMapBlob({ mapId: 2 }), name: "Second Floor", angle: 0 },
      ],
      curr_id: 2,
    });
    const out = decodeSavedMapList(wrapper)!;
    expect(out.activeMapId).toBe(2);
    expect(out.maps.map((m) => m.mapId)).toEqual([1, 2]);
    expect(out.maps[0]!.name).toBe("First Floor");
    expect(out.maps[0]!.angle).toBe(0); // missing angle defaults to 0
  });

  it("falls back to first map's id when curr_id is absent", () => {
    const wrapper = buildWrapper({
      mapstr: [{ map: buildSavedMapBlob({ mapId: 5 }) }],
    });
    const out = decodeSavedMapList(wrapper)!;
    expect(out.activeMapId).toBe(5);
    expect(out.maps[0]!.name).toBeNull();
  });

  it("accepts string-typed numeric fields (curr_id, angle)", () => {
    const wrapper = buildWrapper({
      mapstr: [{ map: buildSavedMapBlob({ mapId: 3 }), angle: "180" }],
      curr_id: "3",
    });
    const out = decodeSavedMapList(wrapper)!;
    expect(out.activeMapId).toBe(3);
    expect(out.maps[0]!.angle).toBe(180);
  });

  it("skips entries whose `map` fails to decode", () => {
    const wrapper = buildWrapper({
      mapstr: [
        { map: "not-a-valid-base64-zlib-blob" },
        { map: buildSavedMapBlob({ mapId: 9 }), name: "OK" },
      ],
      curr_id: 9,
    });
    const out = decodeSavedMapList(wrapper)!;
    expect(out.maps).toHaveLength(1);
    expect(out.maps[0]!.mapId).toBe(9);
  });
});
