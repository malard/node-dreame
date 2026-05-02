import { describe, it, expect } from "vitest";
import {
  callAction,
  getProperties,
  setProperties,
  sendCommand,
} from "../src/commands.js";
import { DreameDeviceOfflineError } from "../src/errors.js";
import type { DreameSession } from "../src/types.js";
import { mockFetch } from "./_helpers.js";

const SESSION: DreameSession = {
  accessToken: "TOK",
  uid: "u1",
  expiresAt: Date.now() + 1_000_000,
  region: "eu",
};

const COMMON = { session: SESSION, region: "eu" as const, did: "DID-123" };

describe("getProperties", () => {
  it("posts to /dreame-iot-com-10000/device/sendCommand with method=get_properties + array params", async () => {
    const fetchImpl = mockFetch({
      "POST /device/sendCommand": {
        status: 200,
        json: {
          code: 0,
          data: {
            result: [
              { siid: 3, piid: 1, value: 100, code: 0 },
              { siid: 3, piid: 2, value: 1, code: 0 },
            ],
          },
        },
      },
    });

    const out = await getProperties(
      { ...COMMON, fetchImpl },
      [{ siid: 3, piid: 1 }, { siid: 3, piid: 2 }],
    );

    expect(out).toHaveLength(2);
    expect(out[0]!.value).toBe(100);

    const call = fetchImpl.calls[0]!;
    expect(call.url).toContain("/dreame-iot-com-10000/device/sendCommand");
    const body = call.bodyJson as { data: { method: string; params: unknown[] } };
    expect(body.data.method).toBe("get_properties");
    expect(Array.isArray(body.data.params)).toBe(true);
    expect(body.data.params).toHaveLength(2);
  });

  it("returns empty array when the cloud sends no result field", async () => {
    const fetchImpl = mockFetch({
      "POST /device/sendCommand": { status: 200, json: { code: 0, data: {} } },
    });
    const out = await getProperties({ ...COMMON, fetchImpl }, [{ siid: 1, piid: 1 }]);
    expect(out).toEqual([]);
  });
});

describe("setProperties", () => {
  it("includes value field in each param entry", async () => {
    const fetchImpl = mockFetch({
      "POST /device/sendCommand": {
        status: 200,
        json: { code: 0, data: { result: [{ siid: 4, piid: 27, code: 0 }] } },
      },
    });

    await setProperties({ ...COMMON, fetchImpl }, [{ siid: 4, piid: 27, value: 1 }]);

    const body = fetchImpl.calls[0]!.bodyJson as {
      data: { method: string; params: Array<{ value: unknown }> };
    };
    expect(body.data.method).toBe("set_properties");
    expect(body.data.params[0]!.value).toBe(1);
  });
});

describe("callAction", () => {
  it("uses method=action with **object** params (not array)", async () => {
    const fetchImpl = mockFetch({
      "POST /device/sendCommand": {
        status: 200,
        json: { code: 0, data: { result: { siid: 7, aiid: 1, out: [], code: 0 } } },
      },
    });

    await callAction({ ...COMMON, fetchImpl }, { siid: 7, aiid: 1, in: [] });

    const body = fetchImpl.calls[0]!.bodyJson as {
      data: { method: string; params: unknown };
    };
    expect(body.data.method).toBe("action");
    expect(Array.isArray(body.data.params)).toBe(false);
    expect(body.data.params).toMatchObject({ siid: 7, aiid: 1 });
  });

  it("defaults `in` to [] when not provided", async () => {
    const fetchImpl = mockFetch({
      "POST /device/sendCommand": { status: 200, json: { code: 0 } },
    });
    await callAction({ ...COMMON, fetchImpl }, { siid: 7, aiid: 1 });

    const body = fetchImpl.calls[0]!.bodyJson as {
      data: { params: { in: unknown[] } };
    };
    expect(body.data.params.in).toEqual([]);
  });
});

describe("sendCommand low-level", () => {
  it("includes did in both the envelope and the data block; from = 'XXXXXX'", async () => {
    const fetchImpl = mockFetch({
      "POST /device/sendCommand": { status: 200, json: { code: 0 } },
    });
    await sendCommand({
      ...COMMON,
      method: "get_properties",
      params: [],
      fetchImpl,
    });
    const body = fetchImpl.calls[0]!.bodyJson as {
      did: string;
      data: { did: string; from: string };
    };
    expect(body.did).toBe("DID-123");
    expect(body.data.did).toBe("DID-123");
    expect(body.data.from).toBe("XXXXXX");
  });

  it("respects iotComPrefix override (Mova brand = 20000)", async () => {
    const fetchImpl = mockFetch({
      "POST /device/sendCommand": { status: 200, json: { code: 0 } },
    });
    await sendCommand({
      ...COMMON,
      method: "get_properties",
      params: [],
      iotComPrefix: 20000,
      fetchImpl,
    });
    expect(fetchImpl.calls[0]!.url).toContain("/dreame-iot-com-20000/");
  });

  it("propagates DreameDeviceOfflineError when the cloud returns code 80001", async () => {
    const fetchImpl = mockFetch({
      "POST /device/sendCommand": {
        status: 200,
        json: { code: 80001, msg: "设备可能不在线" },
      },
    });
    await expect(
      callAction({ ...COMMON, fetchImpl }, { siid: 7, aiid: 1 }),
    ).rejects.toBeInstanceOf(DreameDeviceOfflineError);
  });
});
