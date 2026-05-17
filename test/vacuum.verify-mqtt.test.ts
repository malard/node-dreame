/**
 * Tests for `Vacuum.verifyMqtt()` — first-class "is the subscription
 * actually receiving pushes?" check.
 *
 * Each branch of the `VerifyMqttResult` discriminator gets exercised
 * with a stubbed DreameClient and a bare EventEmitter standing in for
 * `DreameSubscription`. No real cloud / broker.
 */

import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { Vacuum } from "../src/vacuum.js";
import type { DreameClient } from "../src/client.js";
import type { DreameDevice } from "../src/types.js";
import type { DreameSubscription } from "../src/mqtt.js";
import { DreameDeviceOfflineError } from "../src/errors.js";

const DEVICE: DreameDevice = {
  did: "DID-1",
  model: "dreame.vacuum.r2532a",
  name: "X50",
  online: true,
  raw: {},
};

interface FakeClientOpts {
  /** Override the read result. Default returns code=0 value=1 for WATER_VOLUME. */
  reads?: () => Promise<unknown[]>;
  /** Override the write behaviour. Default returns success. */
  writes?: () => Promise<unknown[]>;
}

class FakeSubscription extends EventEmitter {
  closed = false;
  async close(): Promise<void> {
    this.closed = true;
  }
}

function fakeClient(opts: FakeClientOpts, sub: FakeSubscription): DreameClient {
  const reads = opts.reads ?? (async () => [{ siid: 4, piid: 5, value: 1, code: 0 }]);
  const writes = opts.writes ?? (async () => [{ siid: 4, piid: 5, code: 0 }]);
  return {
    session: {
      accessToken: "TOK",
      uid: "UID",
      expiresAt: Date.now() + 1_000_000,
      region: "eu",
    },
    apiHost: "eu.iot.dreame.tech:13267",
    country: "GB",
    lang: "en",
    region: "eu",
    getProperties: reads,
    setProperties: writes,
    subscribe: async () => sub as unknown as DreameSubscription,
  } as unknown as DreameClient;
}

describe("Vacuum.verifyMqtt", () => {
  it("returns reason='not-watching' when watch() has not been called", async () => {
    const sub = new FakeSubscription();
    const vacuum = new Vacuum(fakeClient({}, sub), DEVICE);
    const result = await vacuum.verifyMqtt({ timeoutMs: 50 });
    expect(result.reason).toBe("not-watching");
    expect(result.echoCount).toBe(0);
    expect(result.echoMs).toBeNull();
  });

  it("returns reason='ok' with the round-trip ms when the broker echoes back", async () => {
    const sub = new FakeSubscription();
    const vacuum = new Vacuum(fakeClient({}, sub), DEVICE);
    await vacuum.watch();
    // Emit an echo on the next tick so the verify race resolves before the timeout.
    setImmediate(() => {
      sub.emit("properties", [{ did: "DID-1", siid: 7, piid: 1, value: 50 }]);
    });
    const result = await vacuum.verifyMqtt({ timeoutMs: 1000 });
    expect(result.reason).toBe("ok");
    if (result.reason === "ok") {
      expect(result.echoCount).toBeGreaterThanOrEqual(1);
      expect(result.echoMs).toBeGreaterThanOrEqual(0);
    }
    await vacuum.unwatch();
  });

  it("returns reason='ok' even when the trigger write hits 80001 — echo wins", async () => {
    // Verifies the fix for the misleading-80001 issue: code 80001 from
    // the HTTP layer is NOT proof the device is offline, and verifyMqtt
    // must not let it short-circuit a successful MQTT-side echo.
    const sub = new FakeSubscription();
    const vacuum = new Vacuum(
      fakeClient(
        {
          writes: async () => {
            // Simulate the device echoing back over MQTT before the HTTP
            // layer's 80001 timeout — this matches what was observed live
            // 2026-05-04 (echo arrived seconds before the HTTP error).
            setImmediate(() => {
              sub.emit("properties", [{ did: "DID-1", siid: 7, piid: 1, value: 50 }]);
            });
            throw new DreameDeviceOfflineError("device offline: timeout", 200);
          },
        },
        sub,
      ),
      DEVICE,
    );
    await vacuum.watch();
    const result = await vacuum.verifyMqtt({ timeoutMs: 1000 });
    expect(result.reason).toBe("ok");
    await vacuum.unwatch();
  });

  it("returns reason='no-echo' when the write hits 80001 AND no echo arrives", async () => {
    // The actual "device truly unreachable" case: HTTP errored AND no
    // echo. This is the only signal that genuinely means "device down".
    const sub = new FakeSubscription();
    const vacuum = new Vacuum(
      fakeClient(
        {
          writes: async () => {
            throw new DreameDeviceOfflineError("device offline: timeout", 200);
          },
        },
        sub,
      ),
      DEVICE,
    );
    await vacuum.watch();
    const result = await vacuum.verifyMqtt({ timeoutMs: 50 });
    expect(result.reason).toBe("no-echo");
    expect(result.echoMs).toBeNull();
    await vacuum.unwatch();
  });

  it("returns reason='no-echo' when the write succeeds HTTP-wise but no echo arrives", async () => {
    const sub = new FakeSubscription();
    const vacuum = new Vacuum(fakeClient({}, sub), DEVICE);
    await vacuum.watch();
    const result = await vacuum.verifyMqtt({ timeoutMs: 30 });
    expect(result.reason).toBe("no-echo");
    expect(result.echoMs).toBeNull();
    expect(result.echoCount).toBe(0);
    await vacuum.unwatch();
  });

  it("skips the trigger write when the read can't surface a current value", async () => {
    // Regression: previously the verify probe fell through to a hardcoded
    // value=50 default when the read returned code !== 0, silently mutating
    // the user's voice volume. The probe must NEVER write a guessed value
    // — if we don't know the current value, skip the trigger and rely on
    // organic pushes (or no-echo) for the result.
    const sub = new FakeSubscription();
    let writes = 0;
    const vacuum = new Vacuum(
      fakeClient(
        {
          reads: async () => [{ siid: 7, piid: 1, value: undefined, code: -1 }],
          writes: async () => {
            writes++;
            return [{ siid: 7, piid: 1, code: 0 }];
          },
        },
        sub,
      ),
      DEVICE,
    );
    await vacuum.watch();
    const result = await vacuum.verifyMqtt({ timeoutMs: 30 });
    expect(writes).toBe(0);
    expect(result.reason).toBe("no-echo");
    await vacuum.unwatch();
  });

  it("rethrows non-80001 errors from the cloud round-trip", async () => {
    const sub = new FakeSubscription();
    const vacuum = new Vacuum(
      fakeClient(
        {
          writes: async () => {
            throw new Error("network down");
          },
        },
        sub,
      ),
      DEVICE,
    );
    await vacuum.watch();
    await expect(vacuum.verifyMqtt({ timeoutMs: 50 })).rejects.toThrow(/network down/);
    await vacuum.unwatch();
  });
});
