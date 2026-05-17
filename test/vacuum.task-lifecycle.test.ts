/**
 * Tests for the `taskLifecycle` event on `Vacuum`.
 *
 * Detection rules under test:
 *   - `started` — TASK_STATUS (siid 4 piid 1) transitions to 2.
 *   - `aborted` — errorCode (siid 2 piid 2) transitions 0 → non-zero
 *                 (excluding the benign end-of-task code 68).
 *   - `completed` — fires alongside `taskComplete` from the
 *                   `event_occured siid 4 eiid 1` push.
 *
 * The Vacuum is driven via a fake DreameSubscription so the test owns
 * the event stream end-to-end.
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

function makeFakeSubscription(): EventEmitter & { close: () => Promise<void> } {
  const e = new EventEmitter() as EventEmitter & { close: () => Promise<void> };
  e.close = async () => {};
  return e;
}

function makeVacuumWithFakeSub(): {
  vacuum: Vacuum;
  sub: EventEmitter;
  events: TaskLifecycle[];
} {
  const sub = makeFakeSubscription();
  const client = {
    subscribe: async () => sub,
  } as unknown as DreameClient;
  const vacuum = new Vacuum(client, DEVICE);
  const events: TaskLifecycle[] = [];
  vacuum.on("taskLifecycle", (ev) => events.push(ev));
  return { vacuum, sub, events };
}

describe("Vacuum taskLifecycle", () => {
  it("emits `started` when TASK_STATUS transitions to 2 from a known value", async () => {
    const { vacuum, sub, events } = makeVacuumWithFakeSub();
    await vacuum.watch();
    // Seed prev TASK_STATUS to 6 (on dock idle) — non-null, non-2.
    sub.emit("properties", [{ siid: 4, piid: 1, value: 6 }]);
    expect(events).toHaveLength(0);
    // Transition to 2 → expect a `started`.
    sub.emit("properties", [{ siid: 4, piid: 1, value: 2 }]);
    expect(events).toHaveLength(1);
    expect(events[0]!.phase).toBe("started");
  });

  it("suppresses `started` on the initial null → 2 transition", async () => {
    const { vacuum, sub, events } = makeVacuumWithFakeSub();
    await vacuum.watch();
    // First push seeds the state from null. Should NOT fire started.
    sub.emit("properties", [{ siid: 4, piid: 1, value: 2 }]);
    expect(events).toHaveLength(0);
  });

  it("emits `aborted` with the empty-tank reason on errorCode 0 → 107", async () => {
    const { vacuum, sub, events } = makeVacuumWithFakeSub();
    await vacuum.watch();
    // Seed errorCode to 0.
    sub.emit("properties", [{ siid: 2, piid: 2, value: 0 }]);
    expect(events).toHaveLength(0);
    // Transition to 107 (clean-water tank empty).
    sub.emit("properties", [{ siid: 2, piid: 2, value: MiotError.CleanWaterTankEmpty }]);
    expect(events).toHaveLength(1);
    expect(events[0]!.phase).toBe("aborted");
    if (events[0]!.phase === "aborted") {
      expect(events[0]!.errorCode).toBe(107);
      expect(events[0]!.reason).toBe("clean-water-tank-empty");
    }
  });

  it("emits `aborted` with the wastewater reason on errorCode 0 → 105", async () => {
    const { vacuum, sub, events } = makeVacuumWithFakeSub();
    await vacuum.watch();
    sub.emit("properties", [{ siid: 2, piid: 2, value: 0 }]);
    sub.emit("properties", [{ siid: 2, piid: 2, value: MiotError.WastewaterTankFull }]);
    expect(events).toHaveLength(1);
    if (events[0]!.phase === "aborted") {
      expect(events[0]!.reason).toBe("wastewater-tank-full");
    }
  });

  it("emits raw `error-<n>` reason for uncatalogued error codes", async () => {
    const { vacuum, sub, events } = makeVacuumWithFakeSub();
    await vacuum.watch();
    sub.emit("properties", [{ siid: 2, piid: 2, value: 0 }]);
    sub.emit("properties", [{ siid: 2, piid: 2, value: 999 }]);
    expect(events).toHaveLength(1);
    if (events[0]!.phase === "aborted") {
      expect(events[0]!.reason).toBe("error-999");
    }
  });

  it("does NOT emit `aborted` when errorCode flips to 68 (TaskComplete is benign)", async () => {
    const { vacuum, sub, events } = makeVacuumWithFakeSub();
    await vacuum.watch();
    sub.emit("properties", [{ siid: 2, piid: 2, value: 0 }]);
    sub.emit("properties", [{ siid: 2, piid: 2, value: MiotError.TaskComplete }]);
    expect(events).toHaveLength(0);
  });

  it("emits `completed` alongside taskComplete on the siid 4 eiid 1 event", async () => {
    const { vacuum, sub, events } = makeVacuumWithFakeSub();
    await vacuum.watch();
    sub.emit("event", {
      did: "DID-1",
      siid: 4,
      eiid: 1,
      arguments: [
        { piid: 1, value: 2 },
        { piid: 2, value: 30 },
        { piid: 3, value: 12 },
        { piid: 13, value: 1 },
        { piid: 8, value: 1777812255 },
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.phase).toBe("completed");
    if (events[0]!.phase === "completed") {
      expect(events[0]!.record.cleaningTimeMin).toBe(30);
      expect(events[0]!.record.cleanedAreaSqm).toBe(12);
    }
  });
});
