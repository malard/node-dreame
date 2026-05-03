/**
 * Tests for the semantic action helpers on `Vacuum`.
 *
 * Each helper is a wrapper around `client.callAction` that translates a
 * high-level intent into the raw `{siid, aiid, in: [...]}` shape. The
 * tests confirm the wire shape (siid, aiid, piid, JSON payload) without
 * actually round-tripping to a device.
 */

import { describe, expect, it } from "vitest";
import { Vacuum } from "../src/vacuum.js";
import type { DreameClient } from "../src/client.js";
import type { DreameDevice } from "../src/types.js";
import type { MiotAction } from "../src/commands.js";

const DEVICE: DreameDevice = {
  did: "DID-1",
  model: "dreame.vacuum.r2532a",
  name: "X50",
  online: true,
  raw: {},
};

interface Recorded {
  did: string;
  action: MiotAction;
}

function fakeClient(): { client: DreameClient; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const client = {
    callAction: async (did: string, action: MiotAction) => {
      calls.push({ did, action });
      return { code: 0 };
    },
  } as unknown as DreameClient;
  return { client, calls };
}

function makeVacuum(): { vacuum: Vacuum; calls: Recorded[] } {
  const { client, calls } = fakeClient();
  const vacuum = new Vacuum(client, DEVICE);
  return { vacuum, calls };
}

describe("Vacuum.cleanSegments", () => {
  it("dispatches START_CUSTOM (siid 4 aiid 1) with mode=18 + selects payload", async () => {
    const { vacuum, calls } = makeVacuum();
    await vacuum.cleanSegments([3, 5]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.did).toBe("DID-1");
    expect(calls[0]!.action.siid).toBe(4);
    expect(calls[0]!.action.aiid).toBe(1);
    expect(calls[0]!.action.in).toEqual([
      { piid: 1, value: 18 },
      { piid: 10, value: JSON.stringify({ selects: [[3, 1, 1, 2, 1], [5, 1, 1, 2, 1]] }) },
    ]);
  });

  it("applies repeats / fan / water options to every select", async () => {
    const { vacuum, calls } = makeVacuum();
    await vacuum.cleanSegments([1], { repeats: 3, fan: 2, water: 5 });
    const inJson = (calls[0]!.action.in as Array<{ piid: number; value: unknown }>)[1]!.value;
    expect(JSON.parse(inJson as string)).toEqual({ selects: [[1, 3, 2, 5, 1]] });
  });

  it("clamps repeats to >= 1", async () => {
    const { vacuum, calls } = makeVacuum();
    await vacuum.cleanSegments([1], { repeats: 0 });
    const inJson = (calls[0]!.action.in as Array<{ piid: number; value: unknown }>)[1]!.value;
    expect(JSON.parse(inJson as string)).toEqual({ selects: [[1, 1, 1, 2, 1]] });
  });

  it("throws RangeError synchronously on empty ids", () => {
    const { vacuum } = makeVacuum();
    expect(() => vacuum.cleanSegments([])).toThrow(RangeError);
  });
});

describe("Vacuum.cleanZones", () => {
  it("dispatches START_CUSTOM with mode=19 + areas payload (rounded coords)", async () => {
    const { vacuum, calls } = makeVacuum();
    await vacuum.cleanZones([{ x0: -1000.4, y0: 200.6, x1: 1000.5, y1: 800.4 }]);
    const inJson = (calls[0]!.action.in as Array<{ piid: number; value: unknown }>)[1]!.value;
    expect(calls[0]!.action.in![0]).toEqual({ piid: 1, value: 19 });
    expect(JSON.parse(inJson as string)).toEqual({ areas: [[-1000, 201, 1001, 800, 1, 1, 2]] });
  });

  it("throws RangeError synchronously on empty zones", () => {
    const { vacuum } = makeVacuum();
    expect(() => vacuum.cleanZones([])).toThrow(RangeError);
  });
});

describe("Vacuum.cleanSpot", () => {
  it("dispatches START_CUSTOM with mode=20 + points payload", async () => {
    const { vacuum, calls } = makeVacuum();
    await vacuum.cleanSpot({ x: 1500, y: -2000 }, { repeats: 2, fan: 3, water: 1 });
    const inJson = (calls[0]!.action.in as Array<{ piid: number; value: unknown }>)[1]!.value;
    expect(calls[0]!.action.in![0]).toEqual({ piid: 1, value: 20 });
    expect(JSON.parse(inJson as string)).toEqual({ points: [[1500, -2000, 2, 3, 1]] });
  });
});

describe("Vacuum action aliases", () => {
  it("resume() dispatches the same call as start() (siid 2 aiid 1)", async () => {
    const { vacuum, calls } = makeVacuum();
    await vacuum.resume();
    expect(calls[0]!.action.siid).toBe(2);
    expect(calls[0]!.action.aiid).toBe(1);
    expect(calls[0]!.action.in).toEqual([]);
  });

  it("cancelCurrentJob() dispatches stop (siid 4 aiid 2, empty in)", async () => {
    const { vacuum, calls } = makeVacuum();
    await vacuum.cancelCurrentJob();
    expect(calls[0]!.action.siid).toBe(4);
    expect(calls[0]!.action.aiid).toBe(2);
    expect(calls[0]!.action.in).toEqual([]);
  });

  it("goHome() dispatches dock (siid 3 aiid 1, empty in)", async () => {
    const { vacuum, calls } = makeVacuum();
    await vacuum.goHome();
    expect(calls[0]!.action.siid).toBe(3);
    expect(calls[0]!.action.aiid).toBe(1);
    expect(calls[0]!.action.in).toEqual([]);
  });
});
