/**
 * Tests for `parsePointerJson` — the shared `siid 6 piid 8` value
 * parser used by `MapManager`, `Vacuum.fetchSavedMapList()`, and
 * `Vacuum.rememberOssPointer()`.
 */

import { describe, expect, it } from "vitest";
import { parsePointerJson } from "../src/map/pointer-json.js";

describe("parsePointerJson", () => {
  it("parses object_name (Dreame-native form)", () => {
    expect(
      parsePointerJson(
        JSON.stringify({ object_name: "ali_dreame/UID/DID/9", md5: "deadbeef" }),
      ),
    ).toEqual({ filename: "ali_dreame/UID/DID/9", md5: "deadbeef" });
  });

  it("parses obj_name (Tasshack-doc form)", () => {
    expect(
      parsePointerJson(JSON.stringify({ obj_name: "ali_dreame/UID/DID/1" })),
    ).toEqual({ filename: "ali_dreame/UID/DID/1" });
  });

  it("prefers object_name when both keys are present", () => {
    expect(
      parsePointerJson(
        JSON.stringify({ object_name: "wins", obj_name: "loses" }),
      ),
    ).toEqual({ filename: "wins" });
  });

  it("accepts already-parsed object inputs (used by MapManager's pre-parsed branch)", () => {
    expect(
      parsePointerJson({ object_name: "ali_dreame/UID/DID/9", md5: "abc" }),
    ).toEqual({ filename: "ali_dreame/UID/DID/9", md5: "abc" });
  });

  it("returns null for non-string non-object inputs", () => {
    expect(parsePointerJson(null)).toBeNull();
    expect(parsePointerJson(undefined)).toBeNull();
    expect(parsePointerJson(42)).toBeNull();
    expect(parsePointerJson(true)).toBeNull();
  });

  it("returns null for empty / unparseable strings", () => {
    expect(parsePointerJson("")).toBeNull();
    expect(parsePointerJson("not json")).toBeNull();
    expect(parsePointerJson("{")).toBeNull();
  });

  it("returns null when neither alias is a non-empty string", () => {
    expect(parsePointerJson(JSON.stringify({}))).toBeNull();
    expect(
      parsePointerJson(JSON.stringify({ object_name: "" })),
    ).toBeNull();
    expect(
      parsePointerJson(JSON.stringify({ object_name: 42 })),
    ).toBeNull();
  });

  it("omits md5 when not a string in the wire payload", () => {
    expect(
      parsePointerJson(JSON.stringify({ object_name: "f", md5: 12345 })),
    ).toEqual({ filename: "f" });
  });
});
