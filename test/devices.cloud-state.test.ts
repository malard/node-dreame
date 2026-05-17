/**
 * Tests for the cloud-cached device state surfaced by listDevices().
 *
 * Specifically: `latestStatus`, `battery`, `videoStatus`, `featureCode2`,
 * `ver`, `sn`, and the `property` JSON-string with the nested `lwt` flag.
 */

import { describe, expect, it } from "vitest";
import { listDevices } from "../src/devices.js";
import type { DreameSession } from "../src/types.js";

const SESSION: DreameSession = {
  accessToken: "token-1",
  uid: "uid-1",
  expiresAt: Date.now() + 60_000,
  region: "eu",
};

function fakeFetch(record: Record<string, unknown>): typeof fetch {
  return (async () => {
    return new Response(
      JSON.stringify({ code: 0, data: { page: { records: [record] } } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
}

describe("listDevices cloud state parsing", () => {
  it("populates cloudState from latestStatus / battery / videoStatus / featureCode2", async () => {
    const devices = await listDevices({
      session: SESSION,
      region: "eu",
      apiHost: "https://example.invalid",
      fetchImpl: fakeFetch({
        did: "DID-1",
        model: "dreame.vacuum.r2532a",
        online: true,
        latestStatus: 13,
        battery: 100,
        videoStatus: '{"operType":"end","operation":"monitor","result":0,"status":0}',
        featureCode2: 31,
      }),
    });
    expect(devices).toHaveLength(1);
    const d = devices[0]!;
    expect(d.cloudState).toEqual({
      latestStatus: 13,
      battery: 100,
      videoActive: false,
      featureCode2: 31,
    });
  });

  it("marks videoActive=true when the videoStatus session is monitoring", async () => {
    const devices = await listDevices({
      session: SESSION,
      region: "eu",
      apiHost: "https://example.invalid",
      fetchImpl: fakeFetch({
        did: "DID-1",
        model: "dreame.vacuum.r2532a",
        online: true,
        latestStatus: 23,
        battery: 80,
        videoStatus:
          '{"token":"alify","channelId":"x","operType":"monitor","operation":"start","status":1}',
        featureCode2: 31,
      }),
    });
    expect(devices[0]!.cloudState?.videoActive).toBe(true);
  });

  it("surfaces firmwareVersion and serialNumber as top-level fields", async () => {
    const devices = await listDevices({
      session: SESSION,
      region: "eu",
      apiHost: "https://example.invalid",
      fetchImpl: fakeFetch({
        did: "DID-1",
        model: "dreame.vacuum.r2532a",
        online: true,
        ver: "4.3.9_2199",
        sn: "R2532D4C8UK0426933",
      }),
    });
    expect(devices[0]!.firmwareVersion).toBe("4.3.9_2199");
    expect(devices[0]!.serialNumber).toBe("R2532D4C8UK0426933");
  });

  it("honours nested `lwt` in the `property` JSON-string for online detection", async () => {
    const devices = await listDevices({
      session: SESSION,
      region: "eu",
      apiHost: "https://example.invalid",
      fetchImpl: fakeFetch({
        did: "DID-1",
        model: "dreame.vacuum.r2532a",
        property: '{"iotId":"abc","lwt":1,"mac":"00:11:22:33:44:55"}',
        // online flag deliberately absent.
      }),
    });
    expect(devices[0]!.online).toBe(true);
  });

  it("handles malformed `videoStatus` JSON without throwing", async () => {
    const devices = await listDevices({
      session: SESSION,
      region: "eu",
      apiHost: "https://example.invalid",
      fetchImpl: fakeFetch({
        did: "DID-1",
        model: "dreame.vacuum.r2532a",
        online: true,
        videoStatus: "not-json-at-all",
      }),
    });
    expect(devices[0]!.cloudState?.videoActive).toBe(null);
  });
});
