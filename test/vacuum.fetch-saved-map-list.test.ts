/**
 * Tests for `Vacuum.fetchSavedMapList()`'s 80001 tolerance.
 *
 * The cloud's HTTP-side ACK waiter often times out (code 80001) even
 * on healthy devices — see `DreameDeviceOfflineError`. This method
 * folds 80001 into the same `null` outcome as "no pointer published"
 * rather than throwing, so consumers using it as the static-map
 * fallback path don't have to handle a misleading exception.
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

function vacuumWithStubbedReader(
  getProperties: DreameClient["getProperties"],
): Vacuum {
  const client = {
    getProperties,
    session: { accessToken: "tok", uid: "u", expiresAt: Date.now() + 1e9, region: "eu" },
    apiHost: "eu.iot.dreame.tech:13267",
    country: "GB",
    lang: "en",
    region: "eu",
  } as unknown as DreameClient;
  return new Vacuum(client, DEVICE);
}

describe("Vacuum.fetchSavedMapList", () => {
  it("returns null on DreameDeviceOfflineError instead of throwing", async () => {
    const vacuum = vacuumWithStubbedReader(async () => {
      throw new DreameDeviceOfflineError("device offline: timeout", 200);
    });
    await expect(vacuum.fetchSavedMapList()).resolves.toBeNull();
  });

  it("rethrows non-80001 errors", async () => {
    const vacuum = vacuumWithStubbedReader(async () => {
      throw new Error("network down");
    });
    await expect(vacuum.fetchSavedMapList()).rejects.toThrow(/network down/);
  });

  it("returns null when the pointer property is absent (no MAP_LIST published yet)", async () => {
    const vacuum = vacuumWithStubbedReader(async () => [
      { siid: 6, piid: 8, code: -1, value: undefined },
    ]);
    await expect(vacuum.fetchSavedMapList()).resolves.toBeNull();
  });
});
