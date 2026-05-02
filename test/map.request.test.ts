/**
 * Tests for the active-pull I-frame / P-frame helpers.
 *
 * These don't hit the cloud — they assert the action payload shape
 * (siid 6 aiid 1 with a single in-param at piid 2 carrying a JSON
 * string). The shape is taken straight from Tasshack `dev`
 * `device.py:1893` and `map.py:305`.
 */

import { describe, it, expect } from "vitest";
import { DreameClient } from "../src/client.js";
import { requestIFrame, requestPFrame } from "../src/map/index.js";

describe("requestIFrame", () => {
  it("calls action siid 6 aiid 1 with FRAME_INFO in-param carrying force-push JSON", async () => {
    let captured: unknown = null;
    const fakeClient = {
      callAction: async (did: string, action: unknown) => {
        captured = { did, action };
        return { code: 0 };
      },
    } as unknown as DreameClient;
    await requestIFrame(fakeClient, "DID-1");
    expect(captured).toEqual({
      did: "DID-1",
      action: {
        siid: 6,
        aiid: 1,
        in: [
          {
            piid: 2,
            value: JSON.stringify({ req_type: 1, frame_type: "I", force_type: 1 }),
          },
        ],
      },
    });
  });

  it("omits force_type when force=false", async () => {
    let captured: { did: string; action: { in: Array<{ value: string }> } } | null = null;
    const fakeClient = {
      callAction: async (did: string, action: unknown) => {
        captured = { did, action } as never;
        return { code: 0 };
      },
    } as unknown as DreameClient;
    await requestIFrame(fakeClient, "DID-1", { force: false });
    const value = JSON.parse(captured!.action.in[0]!.value) as Record<string, unknown>;
    expect(value).toEqual({ req_type: 1, frame_type: "I" });
    expect("force_type" in value).toBe(false);
  });

  it("includes startTime when provided", async () => {
    let captured: { did: string; action: { in: Array<{ value: string }> } } | null = null;
    const fakeClient = {
      callAction: async (did: string, action: unknown) => {
        captured = { did, action } as never;
        return { code: 0 };
      },
    } as unknown as DreameClient;
    await requestIFrame(fakeClient, "DID-1", { force: true, startTime: 1700000000 });
    const value = JSON.parse(captured!.action.in[0]!.value) as Record<string, unknown>;
    expect(value).toMatchObject({ frame_type: "I", time: 1700000000 });
  });
});

describe("requestPFrame", () => {
  it("targets a specific (map_id, frame_id)", async () => {
    let captured: { did: string; action: { in: Array<{ value: string }> } } | null = null;
    const fakeClient = {
      callAction: async (did: string, action: unknown) => {
        captured = { did, action } as never;
        return { code: 0 };
      },
    } as unknown as DreameClient;
    await requestPFrame(fakeClient, "DID-1", { mapId: 3, frameId: 612 });
    const value = JSON.parse(captured!.action.in[0]!.value) as Record<string, unknown>;
    expect(value).toEqual({ req_type: 1, frame_type: "P", map_id: 3, frame_id: 612 });
  });
});
