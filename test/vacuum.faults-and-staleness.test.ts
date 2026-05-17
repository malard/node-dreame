/**
 * Tests for two GitHub-issue fixes shipped together:
 *
 *   - #8 — `state.faults` now unions in a non-zero `errorCode` so
 *     action-refusal codes (e.g. `MopPadsMissing = 120`) that push only
 *     on `ERROR` don't leave `state.faults` empty.
 *     Also catalogues code 120 + its `"mop-pads-missing"` abort reason.
 *
 *   - #7 (partial) — `state.lastStateUpdateAt` is stamped on every
 *     batch that actually moves a field, so consumers can detect
 *     staleness without inferring it from `null` fields.
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

function makeVacuumWithFakeSub(): { vacuum: Vacuum; sub: EventEmitter } {
  const sub = makeFakeSubscription();
  const client = { subscribe: async () => sub } as unknown as DreameClient;
  const vacuum = new Vacuum(client, DEVICE);
  return { vacuum, sub };
}

describe("MiotError code 120 (mop-pads-missing)", () => {
  it("catalogues `MopPadsMissing = 120`", () => {
    expect(MiotError.MopPadsMissing).toBe(120);
  });

  it("emits aborted with reason `mop-pads-missing` on errorCode 0 → 120", async () => {
    const { vacuum, sub } = makeVacuumWithFakeSub();
    const events: TaskLifecycle[] = [];
    vacuum.on("taskLifecycle", (ev) => events.push(ev));
    await vacuum.watch();
    // Seed errorCode to 0 then transition to 120 without any FAULTS_STR push.
    sub.emit("properties", [{ siid: 2, piid: 2, value: 0 }]);
    sub.emit("properties", [{ siid: 2, piid: 2, value: 120 }]);
    const aborted = events.find((e) => e.phase === "aborted");
    expect(aborted).toBeDefined();
    expect(aborted!.phase === "aborted" && aborted.reason).toBe("mop-pads-missing");
  });
});

describe("state.faults unions errorCode when FAULTS_STR is silent", () => {
  it("populates faults with errorCode when only ERROR pushes", async () => {
    const { vacuum, sub } = makeVacuumWithFakeSub();
    await vacuum.watch();
    expect(vacuum.state.faults).toEqual([]);
    sub.emit("properties", [{ siid: 2, piid: 2, value: 120 }]);
    expect(vacuum.state.errorCode).toBe(120);
    expect(vacuum.state.faults).toEqual([120]);
  });

  it("keeps faults at [] when errorCode is 0", async () => {
    const { vacuum, sub } = makeVacuumWithFakeSub();
    await vacuum.watch();
    sub.emit("properties", [{ siid: 2, piid: 2, value: 0 }]);
    expect(vacuum.state.faults).toEqual([]);
  });

  it("does not duplicate when errorCode is already in FAULTS_STR", async () => {
    const { vacuum, sub } = makeVacuumWithFakeSub();
    await vacuum.watch();
    sub.emit("properties", [
      { siid: 4, piid: 18, value: "107,18" },
      { siid: 2, piid: 2, value: 18 },
    ]);
    expect(vacuum.state.faults).toEqual([107, 18]);
  });

  it("adds errorCode to faults even when FAULTS_STR carries OTHER codes", async () => {
    const { vacuum, sub } = makeVacuumWithFakeSub();
    await vacuum.watch();
    sub.emit("properties", [
      { siid: 4, piid: 18, value: "107" },
      { siid: 2, piid: 2, value: 120 },
    ]);
    // errorCode=120 not in FAULTS_STR's list → prepended.
    expect(vacuum.state.faults).toEqual([120, 107]);
  });
});

describe("state.lastStateUpdateAt", () => {
  it("starts as null on a fresh Vacuum", () => {
    const { vacuum } = makeVacuumWithFakeSub();
    expect(vacuum.state.lastStateUpdateAt).toBeNull();
  });

  it("stamps a Date on the first batch that moves a field", async () => {
    const { vacuum, sub } = makeVacuumWithFakeSub();
    await vacuum.watch();
    const before = Date.now();
    sub.emit("properties", [{ siid: 3, piid: 1, value: 87 }]);
    const stamp = vacuum.state.lastStateUpdateAt;
    expect(stamp).toBeInstanceOf(Date);
    expect(stamp!.getTime()).toBeGreaterThanOrEqual(before);
    expect(stamp!.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("does not re-stamp on a no-op batch (same value as already in state)", async () => {
    const { vacuum, sub } = makeVacuumWithFakeSub();
    await vacuum.watch();
    sub.emit("properties", [{ siid: 3, piid: 1, value: 87 }]);
    const first = vacuum.state.lastStateUpdateAt!.getTime();
    // Same value re-pushed: applyBatch should detect "no change" and return false.
    await new Promise((r) => setTimeout(r, 5));
    sub.emit("properties", [{ siid: 3, piid: 1, value: 87 }]);
    expect(vacuum.state.lastStateUpdateAt!.getTime()).toBe(first);
  });

  it("advances on a subsequent batch that moves a different field", async () => {
    const { vacuum, sub } = makeVacuumWithFakeSub();
    await vacuum.watch();
    sub.emit("properties", [{ siid: 3, piid: 1, value: 87 }]);
    const first = vacuum.state.lastStateUpdateAt!.getTime();
    await new Promise((r) => setTimeout(r, 5));
    sub.emit("properties", [{ siid: 3, piid: 1, value: 86 }]);
    expect(vacuum.state.lastStateUpdateAt!.getTime()).toBeGreaterThan(first);
  });
});
