/**
 * Tests for Vacuum.fetchTotals — reads siid 12 piid 1-4 (Tasshack
 * `types.py:657-660` mapping) and converts the unix-epoch first-clean
 * timestamp to a Date.
 */

import { describe, expect, it } from "vitest";
import { Vacuum } from "../src/vacuum.js";
import type { DreameClient } from "../src/client.js";
import type { DreameDevice } from "../src/types.js";
import type { MiotProp, PropertyResult } from "../src/commands.js";

const DEVICE: DreameDevice = {
  did: "DID-1",
  model: "dreame.vacuum.r2532a",
  name: "X50",
  online: true,
  raw: {},
};

function fakeClient(values: Record<string, number | undefined>): DreameClient {
  return {
    getProperties: async (_did: string, props: MiotProp[]): Promise<PropertyResult[]> =>
      props.map((p) => {
        const key = `${p.siid}.${p.piid}`;
        const v = values[key];
        if (v === undefined) {
          return { siid: p.siid, piid: p.piid, code: -1 };
        }
        return { siid: p.siid, piid: p.piid, code: 0, value: v };
      }),
  } as unknown as DreameClient;
}

describe("Vacuum.fetchTotals", () => {
  it("converts FIRST_CLEANING_DATE epoch seconds to a Date", async () => {
    const client = fakeClient({
      "12.1": 1743582390,
      "12.2": 6359,
      "12.3": 80,
      "12.4": 5621,
    });
    const v = new Vacuum(client, DEVICE);
    const t = await v.fetchTotals();
    expect(t.firstCleaningDate?.toISOString()).toBe("2025-04-02T08:26:30.000Z");
    expect(t.totalCleaningMinutes).toBe(6359);
    expect(t.cleaningCount).toBe(80);
    expect(t.totalCleanedAreaSqm).toBe(5621);
  });

  it("returns nulls for fields the device didn't return", async () => {
    const client = fakeClient({
      "12.1": 0,
      "12.2": undefined,
      "12.3": 0,
      "12.4": undefined,
    });
    const v = new Vacuum(client, DEVICE);
    const t = await v.fetchTotals();
    // FIRST_CLEANING_DATE = 0 → never cleaned → null Date
    expect(t.firstCleaningDate).toBeNull();
    // missing read codes return null
    expect(t.totalCleaningMinutes).toBeNull();
    expect(t.cleaningCount).toBe(0);
    expect(t.totalCleanedAreaSqm).toBeNull();
  });
});
