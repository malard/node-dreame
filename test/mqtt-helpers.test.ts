import { describe, it, expect } from "vitest";
import { brokerUrl, buildStatusTopic, parseEventOccured, parseInfoPush, parseMapInfo } from "../src/mqtt.js";
import type { DreameDevice } from "../src/types.js";

function makeDevice(overrides: Partial<DreameDevice> = {}): DreameDevice {
  return {
    did: "660622937",
    model: "dreame.vacuum.r2532a",
    name: "Robot Cleaner",
    online: true,
    raw: { bindDomain: "10000.mt.eu.iot.dreame.tech:19973" },
    ...overrides,
  };
}

describe("brokerUrl", () => {
  it("derives mqtts:// from the device's bindDomain", () => {
    expect(brokerUrl(makeDevice())).toBe("mqtts://10000.mt.eu.iot.dreame.tech:19973");
  });

  it("throws if bindDomain is missing", () => {
    expect(() => brokerUrl(makeDevice({ raw: {} }))).toThrowError(/bindDomain/);
  });
});

describe("buildStatusTopic", () => {
  it("produces the Dreame status topic with a trailing slash (required by the broker)", () => {
    const topic = buildStatusTopic(makeDevice(), "KB123456", "eu");
    expect(topic).toBe("/status/660622937/KB123456/dreame.vacuum.r2532a/eu/");
  });
});

describe("parseInfoPush", () => {
  it("flattens the nested ap/netif blocks into a typed shape", () => {
    const out = parseInfoPush("did-123", {
      hw_ver: "Linux",
      fw_ver: "4.3.9_2199",
      model: "dreame.vacuum.r2532a",
      ap: { ssid: "MySSID", bssid: "aa:bb:cc:dd:ee:ff", rssi: -68 },
      netif: { localIp: "192.168.1.10", mask: "255.255.255.0", gw: "192.168.1.1" },
    });
    expect(out).toEqual({
      did: "did-123",
      hwVer: "Linux",
      fwVer: "4.3.9_2199",
      model: "dreame.vacuum.r2532a",
      ap: { ssid: "MySSID", bssid: "aa:bb:cc:dd:ee:ff", rssi: -68 },
      netif: { localIp: "192.168.1.10", mask: "255.255.255.0", gw: "192.168.1.1" },
      raw: expect.any(Object),
    });
  });

  it("falls back to params.ap.siid when params.ap.ssid is absent (firmware quirk)", () => {
    const out = parseInfoPush("did-123", {
      ap: { siid: "FromSiidField", bssid: "x", rssi: -50 },
    });
    expect(out.ap.ssid).toBe("FromSiidField");
  });

  it("returns null fields when the device omits them", () => {
    const out = parseInfoPush("did-123", {});
    expect(out.hwVer).toBeNull();
    expect(out.fwVer).toBeNull();
    expect(out.model).toBeNull();
    expect(out.ap).toEqual({ ssid: null, bssid: null, rssi: null });
    expect(out.netif).toEqual({ localIp: null, mask: null, gw: null });
  });

  it("preserves the raw params block for forward-compat", () => {
    const params = { hw_ver: "Linux", future_field: 42 };
    const out = parseInfoPush("did-123", params);
    expect(out.raw).toBe(params);
  });
});

describe("parseEventOccured", () => {
  it("parses a typical event_occured push", () => {
    const out = parseEventOccured("fallback-did", {
      did: "660622937",
      siid: 4,
      eiid: 4,
      arguments: [],
    });
    expect(out).toEqual({
      did: "660622937",
      siid: 4,
      eiid: 4,
      arguments: [],
    });
  });

  it("falls back to the supplied did when params.did is absent", () => {
    const out = parseEventOccured("fallback-did", {
      siid: 2,
      eiid: 2,
      arguments: [],
    });
    expect(out?.did).toBe("fallback-did");
  });

  it("coerces a numeric did from params to a string", () => {
    const out = parseEventOccured("fallback-did", {
      did: 660622937,
      siid: 4,
      eiid: 4,
    });
    expect(out?.did).toBe("660622937");
  });

  it("treats missing arguments as an empty array", () => {
    const out = parseEventOccured("did", { siid: 1, eiid: 1 });
    expect(out?.arguments).toEqual([]);
  });

  it("returns null when siid or eiid is missing or non-numeric", () => {
    expect(parseEventOccured("did", { eiid: 1 })).toBeNull();
    expect(parseEventOccured("did", { siid: 1 })).toBeNull();
    expect(parseEventOccured("did", { siid: "1", eiid: 1 })).toBeNull();
  });
});

describe("parseMapInfo", () => {
  it("decodes the doubly-JSON-encoded map_info from a real r2532a capture", () => {
    // Captured live 2026-05-06 in probe-saved-map-noack.ts phase 3.
    const out = parseMapInfo("660622937", {
      map_info: '{"0":[5,10],"1":[0],"3":[0],"4":[0],"7":[0],"8":[0],"9":[0],"12":[0],"14":[0]}',
    });
    expect(out).not.toBeNull();
    expect(out?.did).toBe("660622937");
    expect(out?.maps.size).toBe(9);
    expect(out?.maps.get(0)).toEqual([5, 10]);
    expect(out?.maps.get(1)).toEqual([0]);
    expect(out?.maps.get(14)).toEqual([0]);
  });

  it("returns null when map_info is missing or not a string", () => {
    expect(parseMapInfo("did", {})).toBeNull();
    expect(parseMapInfo("did", { map_info: 123 })).toBeNull();
  });

  it("returns null when the inner JSON is malformed", () => {
    expect(parseMapInfo("did", { map_info: "{not json" })).toBeNull();
  });

  it("returns null when the inner JSON is an array, not an object", () => {
    expect(parseMapInfo("did", { map_info: "[1,2,3]" })).toBeNull();
  });

  it("skips entries with non-numeric keys or non-array values", () => {
    const out = parseMapInfo("did", {
      map_info: '{"5":[1,2],"NaN":[1],"x":[1],"6":"not-array","7":[3,"4",5]}',
    });
    expect(out?.maps.size).toBe(2);
    expect(out?.maps.get(5)).toEqual([1, 2]);
    // Non-numeric values within the array are filtered out.
    expect(out?.maps.get(7)).toEqual([3, 5]);
  });

  it("prefers params.did over the fallback when present", () => {
    const out = parseMapInfo("fallback", { did: 660622937, map_info: '{"0":[1]}' });
    expect(out?.did).toBe("660622937");
  });
});
