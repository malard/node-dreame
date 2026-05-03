/**
 * Tests for `parseTaskCompleteEvent` — the helper that decodes the
 * `event_occured siid 4 eiid 1` payload Dreame native uses to ship
 * per-task summary records.
 *
 * Sample payload below is the actual capture from r2532a 2026-05-03
 * (a 93-minute "greasy areas" task that cleaned 76 m²).
 */

import { describe, expect, it } from "vitest";
import { parseTaskCompleteEvent } from "../src/vacuum.js";
import type { EventOccuredPush } from "../src/index.js";

const LIVE_SAMPLE: EventOccuredPush = {
  did: "660622937",
  siid: 4,
  eiid: 1,
  arguments: [
    { piid: 1, value: 2 },
    { piid: 2, value: 93 },
    { piid: 3, value: 76 },
    { piid: 6, value: 0 },
    { piid: 13, value: 1 },
    { piid: 8, value: 1777812255 },
    {
      piid: 9,
      value: "ali_dreame/2026/05/03/KB968216/660622937_144940446.2199.bin",
    },
    {
      piid: 10,
      value:
        '{"cleaningTime":93,"customeClean":0,"mooClean":0,"pet":0,"cmc":2,"ismultiple":1,"ctyo":2,"multime":1777765921}',
    },
  ],
};

describe("parseTaskCompleteEvent", () => {
  it("decodes the captured live r2532a payload into a typed record", () => {
    const out = parseTaskCompleteEvent(LIVE_SAMPLE);
    expect(out).not.toBeNull();
    expect(out!.startTime.toISOString()).toBe("2026-05-03T12:44:15.000Z");
    expect(out!.cleaningTimeMin).toBe(93);
    expect(out!.cleanedAreaSqm).toBe(76);
    expect(out!.completed).toBe(true);
    expect(out!.finalStatus).toBe(2);
    expect(out!.waterTank).toBe(0);
    expect(out!.logFileName).toBe(
      "ali_dreame/2026/05/03/KB968216/660622937_144940446.2199.bin",
    );
    expect(out!.cleaningProperties).toEqual({
      cleaningTime: 93,
      customeClean: 0,
      mooClean: 0,
      pet: 0,
      cmc: 2,
      ismultiple: 1,
      ctyo: 2,
      multime: 1777765921,
    });
  });

  it("returns null for events that aren't siid 4 eiid 1", () => {
    expect(
      parseTaskCompleteEvent({
        did: "X",
        siid: 4,
        eiid: 4,
        arguments: [{ piid: 8, value: 0 }],
      }),
    ).toBeNull();
    expect(
      parseTaskCompleteEvent({
        did: "X",
        siid: 2,
        eiid: 1,
        arguments: [{ piid: 8, value: 0 }],
      }),
    ).toBeNull();
  });

  it("returns null when required core fields (start/time/area) are missing", () => {
    expect(
      parseTaskCompleteEvent({
        did: "X",
        siid: 4,
        eiid: 1,
        arguments: [{ piid: 1, value: 2 }, { piid: 13, value: 1 }],
      }),
    ).toBeNull();
  });

  it("treats a missing CLEAN_LOG_STATUS as completed=false", () => {
    const out = parseTaskCompleteEvent({
      did: "X",
      siid: 4,
      eiid: 1,
      arguments: [
        { piid: 8, value: 1700000000 },
        { piid: 2, value: 30 },
        { piid: 3, value: 12 },
      ],
    });
    expect(out).not.toBeNull();
    expect(out!.completed).toBe(false);
    expect(out!.logFileName).toBeNull();
    expect(out!.cleaningProperties).toBeNull();
  });

  it("returns cleaningProperties=null on malformed inner JSON", () => {
    const out = parseTaskCompleteEvent({
      did: "X",
      siid: 4,
      eiid: 1,
      arguments: [
        { piid: 8, value: 1700000000 },
        { piid: 2, value: 5 },
        { piid: 3, value: 1 },
        { piid: 10, value: "{ not json" },
      ],
    });
    expect(out!.cleaningProperties).toBeNull();
  });

  it("preserves the raw arguments array on the record", () => {
    const out = parseTaskCompleteEvent(LIVE_SAMPLE);
    expect(out!.raw).toBe(LIVE_SAMPLE.arguments);
  });
});
