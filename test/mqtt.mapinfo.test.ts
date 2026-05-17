/**
 * Tests for the `parseMapInfo()` active/saved-map ID derivation.
 */

import { describe, expect, it } from "vitest";
import { parseMapInfo } from "../src/mqtt.js";

describe("parseMapInfo savedMapIds + activeMapId", () => {
  it("picks the multi-element token as active and lists all IDs", () => {
    const push = parseMapInfo("DID-1", {
      map_info: JSON.stringify({
        "0": [5, 10],
        "1": [0],
        "3": [0],
        "4": [0],
        "7": [0],
      }),
    });
    expect(push).not.toBeNull();
    expect(push!.activeMapId).toBe(0);
    expect(push!.savedMapIds).toEqual([0, 1, 3, 4, 7]);
  });

  it("falls back to null active when every map has a [0] token", () => {
    const push = parseMapInfo("DID-1", {
      map_info: JSON.stringify({ "0": [0], "1": [0] }),
    });
    expect(push!.activeMapId).toBeNull();
    expect(push!.savedMapIds).toEqual([0, 1]);
  });

  it("returns null on unparseable map_info", () => {
    const push = parseMapInfo("DID-1", { map_info: "not-json" });
    expect(push).toBeNull();
  });

  it("treats a [non-zero] single-element token as active too", () => {
    const push = parseMapInfo("DID-1", {
      map_info: JSON.stringify({ "0": [0], "5": [3] }),
    });
    expect(push!.activeMapId).toBe(5);
  });
});
