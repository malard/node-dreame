/**
 * Tests for `Vacuum.refresh()` — discriminated `RefreshResult` outcome.
 *
 * Exercises both the online and offline paths without going near a real
 * cloud: the test stubs `DreameClient.getProperties` and observes the
 * returned `{ kind, state }` shape and the `state.online` flag mutation.
 */

import { describe, expect, it } from "vitest";
import { Vacuum } from "../src/vacuum.js";
import type { DreameClient } from "../src/client.js";
import type { DreameDevice } from "../src/types.js";
import { DreameDeviceOfflineError } from "../src/errors.js";

const DEVICE: DreameDevice = {
  did: "DID-1",
  model: "dreame.vacuum.r2532a",
  name: "X50",
  online: true,
  raw: {},
};

function vacuumWithStubbedClient(getProperties: DreameClient["getProperties"]): Vacuum {
  const client = { getProperties } as unknown as DreameClient;
  return new Vacuum(client, DEVICE);
}

describe("Vacuum.refresh", () => {
  it("returns kind=acked and applies values when the cloud responds", async () => {
    const stub: DreameClient["getProperties"] = async () => [
      { siid: 3, piid: 1, value: 87, code: 0 }, // BATTERY_PROP.LEVEL
    ];
    const vacuum = vacuumWithStubbedClient(stub);

    const result = await vacuum.refresh();
    expect(result.kind).toBe("acked");
    expect(result.state.online).toBe(true);
    expect(result.state.battery).toBe(87);
  });

  it("returns kind=no-ack and leaves state.online untouched on 80001", async () => {
    const stub: DreameClient["getProperties"] = async () => {
      throw new DreameDeviceOfflineError("device offline: timeout", 200);
    };
    const vacuum = vacuumWithStubbedClient(stub);

    const result = await vacuum.refresh();
    expect(result.kind).toBe("no-ack");
    // 80001 is NOT proof of offline — leave online flag at its
    // pre-refresh value (null in this fresh-instance test). MQTT
    // connect/close events are the authoritative source for online.
    expect(result.state.online).toBeNull();
    // Cached property values remain at their pre-refresh defaults (null).
    expect(result.state.battery).toBeNull();
  });

  it("rethrows any error other than DreameDeviceOfflineError", async () => {
    const stub: DreameClient["getProperties"] = async () => {
      throw new Error("network down");
    };
    const vacuum = vacuumWithStubbedClient(stub);

    await expect(vacuum.refresh()).rejects.toThrow(/network down/);
  });
});
