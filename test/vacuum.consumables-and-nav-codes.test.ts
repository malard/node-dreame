/**
 * Two additive surface improvements:
 *
 *   - Navigation / routing error codes are now catalogued in `MiotError`
 *     (+ `ABORT_REASONS`). Code 62 (`Route2`) was OBSERVED live on
 *     r2532a 2026-06-23; the integer is confirmed, the meaning is
 *     borrowed from Tasshack's `ROUTE_2` label (a path-planning fault).
 *     Before this it surfaced as the opaque `error-62`.
 *
 *   - The sensor (siid 16) and scale-inhibitor (siid 31) consumable-life
 *     counters are now reduced into `Vacuum.state`. Previously the
 *     constants existed but the in-app "clean the sensors" 0% warning had
 *     no path into the library's state for a consumer to act on.
 */

import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  MiotError,
  Vacuum,
  type DreameClient,
  type DreameDevice,
  type TaskLifecycle,
} from "../src/index.js";

const DEVICE: DreameDevice = {
  did: "DID-1",
  model: "dreame.vacuum.r2532a",
  name: "X50",
  online: true,
  raw: {},
};

function makeVacuumWithFakeSub(): { vacuum: Vacuum; sub: EventEmitter } {
  const sub = new EventEmitter() as EventEmitter & { close: () => Promise<void> };
  sub.close = async () => {};
  const client = { subscribe: async () => sub } as unknown as DreameClient;
  const vacuum = new Vacuum(client, DEVICE);
  return { vacuum, sub };
}

describe("navigation / routing MiotError codes", () => {
  it("catalogues the navigation family at the Tasshack integers", () => {
    expect(MiotError.Route2).toBe(62);
    expect(MiotError.Route).toBe(61);
    expect(MiotError.NoGoZone).toBe(59);
    expect(MiotError.Ultrasonic).toBe(58);
    expect(MiotError.Blocked).toBe(47);
    expect(MiotError.Blocked2).toBe(63);
    expect(MiotError.Blocked3).toBe(64);
    expect(MiotError.Restricted).toBe(65);
  });

  it("emits aborted with reason `route-2` on errorCode 0 → 62 (was `error-62`)", async () => {
    const { vacuum, sub } = makeVacuumWithFakeSub();
    const events: TaskLifecycle[] = [];
    vacuum.on("taskLifecycle", (ev) => events.push(ev));
    await vacuum.watch();
    sub.emit("properties", [{ siid: 2, piid: 2, value: 0 }]);
    sub.emit("properties", [{ siid: 2, piid: 2, value: 62 }]);
    const aborted = events.find((e) => e.phase === "aborted");
    expect(aborted).toBeDefined();
    expect(aborted!.phase === "aborted" && aborted.reason).toBe("route-2");
    expect(aborted!.phase === "aborted" && aborted.errorCode).toBe(62);
  });
});

describe("sensor + scale-inhibitor consumables in state", () => {
  it("starts null on a fresh Vacuum", () => {
    const { vacuum } = makeVacuumWithFakeSub();
    expect(vacuum.state.sensorHoursLeft).toBeNull();
    expect(vacuum.state.sensorDaysLeft).toBeNull();
    expect(vacuum.state.scaleInhibitorDaysLeft).toBeNull();
    expect(vacuum.state.scaleInhibitorLeftPct).toBeNull();
  });

  it("reduces siid 16 (sensor: hours @ piid 1, DAYS @ piid 2) into state", async () => {
    const { vacuum, sub } = makeVacuumWithFakeSub();
    await vacuum.watch();
    sub.emit("properties", [
      { siid: 16, piid: 1, value: 0 },
      { siid: 16, piid: 2, value: 0 },
    ]);
    // The "clean the sensors" 0% case is now visible to consumers.
    expect(vacuum.state.sensorHoursLeft).toBe(0);
    expect(vacuum.state.sensorDaysLeft).toBe(0);
  });

  it("reduces siid 31 (scale inhibitor: days @ piid 1, % @ piid 2) into state", async () => {
    const { vacuum, sub } = makeVacuumWithFakeSub();
    await vacuum.watch();
    sub.emit("properties", [
      { siid: 31, piid: 1, value: 976 },
      { siid: 31, piid: 2, value: 89 },
    ]);
    expect(vacuum.state.scaleInhibitorDaysLeft).toBe(976);
    expect(vacuum.state.scaleInhibitorLeftPct).toBe(89);
  });
});
