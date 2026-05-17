/**
 * Tests for the v0.4 event additions on `Vacuum`:
 *   - `stuck` / `unstuck` from STUCK_NOTIFICATION_ACTIVE
 *   - `batteryLifecycle` threshold crossings (low / critical / depleted / recovered)
 *   - `taskLifecycle.aborted` with `inferred: "initial-state"`
 *   - `taskLifecycle.aborted` with `reason: "disappeared"` on mid-task disconnect
 *   - `state.faults` parsed from the multi-value FAULTS_STR mirror
 *   - `state.activeMapId` / `savedMapIds` seeded from mapInfo
 */

import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  MiotError,
  Vacuum,
  type BatteryLifecycle,
  type TaskLifecycle,
} from "../src/index.js";
import type { DreameClient } from "../src/client.js";
import type { DreameDevice } from "../src/types.js";

const DEVICE: DreameDevice = {
  did: "DID-1",
  model: "dreame.vacuum.r2532a",
  name: "X50",
  online: true,
  raw: {},
};

function makeFakeSubscription(): EventEmitter & { close: () => Promise<void> } {
  const e = new EventEmitter() as EventEmitter & { close: () => Promise<void> };
  e.close = async () => {};
  return e;
}

interface Harness {
  vacuum: Vacuum;
  sub: EventEmitter;
  lifecycle: TaskLifecycle[];
  battery: BatteryLifecycle[];
  stuck: Array<{ at: Date; errorCode: number | null; faults: readonly number[]; miotState: number | null }>;
  unstuck: Array<{ at: Date }>;
}

function makeHarness(): Harness {
  const sub = makeFakeSubscription();
  const client = { subscribe: async () => sub } as unknown as DreameClient;
  const vacuum = new Vacuum(client, DEVICE);
  const lifecycle: TaskLifecycle[] = [];
  const battery: BatteryLifecycle[] = [];
  const stuck: Harness["stuck"] = [];
  const unstuck: Harness["unstuck"] = [];
  vacuum.on("taskLifecycle", (ev) => lifecycle.push(ev));
  vacuum.on("batteryLifecycle", (ev) => battery.push(ev));
  vacuum.on("stuck", (ev) => stuck.push(ev));
  vacuum.on("unstuck", (ev) => unstuck.push(ev));
  return { vacuum, sub, lifecycle, battery, stuck, unstuck };
}

describe("Vacuum FAULTS multi-code parsing", () => {
  it("parses a single-code fault string into state.faults", async () => {
    const { vacuum, sub } = makeHarness();
    await vacuum.watch();
    sub.emit("properties", [{ siid: 4, piid: 18, value: "107" }]);
    expect(vacuum.state.faults).toEqual([107]);
  });

  it("parses a comma-separated multi-code fault string into state.faults", async () => {
    const { vacuum, sub } = makeHarness();
    await vacuum.watch();
    sub.emit("properties", [{ siid: 4, piid: 18, value: "18,107,105" }]);
    expect(vacuum.state.faults).toEqual([18, 107, 105]);
  });

  it("treats '0' as empty (no active faults)", async () => {
    const { vacuum, sub } = makeHarness();
    await vacuum.watch();
    sub.emit("properties", [{ siid: 4, piid: 18, value: "107" }]);
    expect(vacuum.state.faults).toEqual([107]);
    sub.emit("properties", [{ siid: 4, piid: 18, value: "0" }]);
    expect(vacuum.state.faults).toEqual([]);
  });

  it("accepts a bare numeric value (not string-encoded)", async () => {
    const { vacuum, sub } = makeHarness();
    await vacuum.watch();
    sub.emit("properties", [{ siid: 4, piid: 18, value: 18 }]);
    expect(vacuum.state.faults).toEqual([18]);
  });
});

describe("Vacuum stuck/unstuck events", () => {
  it("emits `stuck` when STUCK_NOTIFICATION_ACTIVE transitions null → 1", async () => {
    const { vacuum, sub, stuck } = makeHarness();
    await vacuum.watch();
    sub.emit("properties", [{ siid: 14, piid: 4, value: 1 }]);
    expect(stuck).toHaveLength(1);
    expect(vacuum.state.stuck).toBe(true);
  });

  it("emits `stuck` when transitioning 0 → 1, then `unstuck` on 1 → 0", async () => {
    const { vacuum, sub, stuck, unstuck } = makeHarness();
    await vacuum.watch();
    sub.emit("properties", [{ siid: 14, piid: 4, value: 0 }]);
    expect(vacuum.state.stuck).toBe(false);
    sub.emit("properties", [{ siid: 14, piid: 4, value: 1 }]);
    expect(stuck).toHaveLength(1);
    sub.emit("properties", [{ siid: 14, piid: 4, value: 0 }]);
    expect(unstuck).toHaveLength(1);
    expect(vacuum.state.stuck).toBe(false);
  });

  it("`stuck` payload carries current errorCode + faults snapshot", async () => {
    const { vacuum, sub, stuck } = makeHarness();
    await vacuum.watch();
    // Seed errorCode 0 and faults, THEN flip stuck flag.
    sub.emit("properties", [{ siid: 2, piid: 2, value: 18 }]);
    sub.emit("properties", [{ siid: 4, piid: 18, value: "18" }]);
    sub.emit("properties", [{ siid: 14, piid: 4, value: 1 }]);
    expect(stuck).toHaveLength(1);
    expect(stuck[0]!.errorCode).toBe(18);
    expect(stuck[0]!.faults).toEqual([18]);
  });

  it("does NOT emit `stuck` on a redundant 1 → 1 push", async () => {
    const { vacuum, sub, stuck } = makeHarness();
    await vacuum.watch();
    sub.emit("properties", [{ siid: 14, piid: 4, value: 1 }]);
    sub.emit("properties", [{ siid: 14, piid: 4, value: 1 }]);
    expect(stuck).toHaveLength(1);
  });
});

describe("Vacuum batteryLifecycle", () => {
  it("emits `low` when battery drops to <= 20 while not charging", async () => {
    const { vacuum, sub, battery } = makeHarness();
    await vacuum.watch();
    // Seed charging=2 (discharging) so the gating fires.
    sub.emit("properties", [{ siid: 3, piid: 2, value: 2 }]);
    sub.emit("properties", [{ siid: 3, piid: 1, value: 30 }]);
    expect(battery).toHaveLength(0);
    sub.emit("properties", [{ siid: 3, piid: 1, value: 18 }]);
    expect(battery).toHaveLength(1);
    expect(battery[0]!.phase).toBe("low");
  });

  it("emits `critical` when battery drops to <= 10 while discharging", async () => {
    const { vacuum, sub, battery } = makeHarness();
    await vacuum.watch();
    sub.emit("properties", [{ siid: 3, piid: 2, value: 2 }]);
    sub.emit("properties", [{ siid: 3, piid: 1, value: 9 }]);
    // Both low and critical fire on first crossing through both bands.
    expect(battery.find((e) => e.phase === "critical")).toBeDefined();
  });

  it("emits `depleted` on battery reaching 0 regardless of charging state", async () => {
    const { vacuum, sub, battery } = makeHarness();
    await vacuum.watch();
    // Even with charging=1, depleted should fire at 0.
    sub.emit("properties", [{ siid: 3, piid: 2, value: 1 }]);
    sub.emit("properties", [{ siid: 3, piid: 1, value: 0 }]);
    expect(battery.find((e) => e.phase === "depleted")).toBeDefined();
  });

  it("emits `recovered` once battery climbs back above 25 after a low event", async () => {
    const { vacuum, sub, battery } = makeHarness();
    await vacuum.watch();
    sub.emit("properties", [{ siid: 3, piid: 2, value: 2 }]);
    sub.emit("properties", [{ siid: 3, piid: 1, value: 15 }]); // fires low
    sub.emit("properties", [{ siid: 3, piid: 1, value: 50 }]); // fires recovered
    expect(battery.find((e) => e.phase === "low")).toBeDefined();
    expect(battery.find((e) => e.phase === "recovered")).toBeDefined();
  });

  it("suppresses `low` while charging", async () => {
    const { vacuum, sub, battery } = makeHarness();
    await vacuum.watch();
    sub.emit("properties", [{ siid: 3, piid: 2, value: 1 }]); // charging
    sub.emit("properties", [{ siid: 3, piid: 1, value: 15 }]);
    expect(battery.find((e) => e.phase === "low")).toBeUndefined();
  });

  it("does NOT emit `recovered` on first high reading without any armed band", async () => {
    const { vacuum, sub, battery } = makeHarness();
    await vacuum.watch();
    sub.emit("properties", [{ siid: 3, piid: 1, value: 100 }]);
    expect(battery).toHaveLength(0);
  });
});

describe("Vacuum aborted edge cases", () => {
  it("fires `aborted` with `inferred: initial-state` on first observed non-zero error", async () => {
    const { vacuum, sub, lifecycle } = makeHarness();
    await vacuum.watch();
    // First-ever error observation is a non-zero refusal code.
    sub.emit("properties", [{ siid: 2, piid: 2, value: MiotError.CleanWaterTankEmpty }]);
    expect(lifecycle).toHaveLength(1);
    expect(lifecycle[0]!.phase).toBe("aborted");
    if (lifecycle[0]!.phase === "aborted") {
      expect(lifecycle[0]!.inferred).toBe("initial-state");
      expect(lifecycle[0]!.errorCode).toBe(MiotError.CleanWaterTankEmpty);
    }
  });

  it("does NOT mark a normal 0 → error transition as initial-state", async () => {
    const { vacuum, sub, lifecycle } = makeHarness();
    await vacuum.watch();
    sub.emit("properties", [{ siid: 2, piid: 2, value: 0 }]);
    sub.emit("properties", [{ siid: 2, piid: 2, value: MiotError.RobotLifted }]);
    expect(lifecycle).toHaveLength(1);
    if (lifecycle[0]!.phase === "aborted") {
      expect(lifecycle[0]!.inferred).toBeUndefined();
    }
  });

  it("carries `state.faults` on the aborted payload", async () => {
    const { vacuum, sub, lifecycle } = makeHarness();
    await vacuum.watch();
    sub.emit("properties", [{ siid: 2, piid: 2, value: 0 }]);
    sub.emit("properties", [
      { siid: 2, piid: 2, value: MiotError.RobotLifted },
      { siid: 4, piid: 18, value: "18,107" },
    ]);
    expect(lifecycle).toHaveLength(1);
    if (lifecycle[0]!.phase === "aborted") {
      expect(lifecycle[0]!.faults).toEqual([18, 107]);
    }
  });

  it("includes `disappeared` reason on close while task is active", async () => {
    const { vacuum, sub, lifecycle } = makeHarness();
    await vacuum.watch();
    // Seed an active task.
    sub.emit("properties", [{ siid: 4, piid: 1, value: 6 }]);
    sub.emit("properties", [{ siid: 4, piid: 1, value: 2 }]);
    expect(lifecycle.find((e) => e.phase === "started")).toBeDefined();
    // Now drop the connection.
    sub.emit("close");
    const aborted = lifecycle.find(
      (e) => e.phase === "aborted" && e.reason === "disappeared",
    );
    expect(aborted).toBeDefined();
    if (aborted && aborted.phase === "aborted") {
      expect(aborted.inferred).toBe("mqtt-disconnect");
    }
  });

  it("does NOT fire `disappeared` on close when task wasn't running", async () => {
    const { vacuum, sub, lifecycle } = makeHarness();
    await vacuum.watch();
    sub.emit("properties", [{ siid: 4, piid: 1, value: 6 }]); // idle on dock
    sub.emit("close");
    expect(lifecycle.find((e) => e.phase === "aborted" && e.reason === "disappeared"))
      .toBeUndefined();
  });

  it("co-fires `depleted` on close when battery was critical mid-task", async () => {
    const { vacuum, sub, lifecycle, battery } = makeHarness();
    await vacuum.watch();
    sub.emit("properties", [{ siid: 3, piid: 2, value: 2 }]); // discharging
    sub.emit("properties", [{ siid: 4, piid: 1, value: 6 }]);
    sub.emit("properties", [{ siid: 4, piid: 1, value: 2 }]); // active task
    sub.emit("properties", [{ siid: 3, piid: 1, value: 5 }]); // critical
    expect(battery.find((e) => e.phase === "critical")).toBeDefined();
    sub.emit("close");
    expect(lifecycle.find((e) => e.phase === "aborted" && e.reason === "disappeared"))
      .toBeDefined();
    expect(battery.find((e) => e.phase === "depleted")).toBeDefined();
  });
});

describe("Vacuum mapInfo savedMapIds", () => {
  it("seeds state.activeMapId and savedMapIds from a mapInfo push", async () => {
    const { vacuum, sub } = makeHarness();
    await vacuum.watch();
    sub.emit("mapInfo", {
      did: "DID-1",
      maps: new Map([
        [0, [5, 10]],
        [3, [0]],
        [7, [0]],
      ]),
      activeMapId: 0,
      savedMapIds: Object.freeze([0, 3, 7]) as readonly number[],
    });
    expect(vacuum.state.activeMapId).toBe(0);
    expect(vacuum.state.savedMapIds).toEqual([0, 3, 7]);
  });
});
