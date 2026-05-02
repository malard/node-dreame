import { describe, it, expect } from "vitest";
import {
  AutoEmptyFrequency,
  ChargingStatus,
  CleaningMode,
  FEATURE_CONFIG_KEYS,
  MiotState,
  MopDryMode,
  MopWashTemp,
  MopWashWaterLevel,
  ScheduleCleaningMode,
  ScheduleRoute,
  SuctionLevel,
  WaterVolume,
  SCHEDULE_FIELD8,
  VACUUM_PROP,
  VACUUM_ACTION,
  BATTERY_PROP,
  CONSUMABLE_PROP,
  DOCK_PROP,
  AUTO_EMPTY_PROP,
  CAMERA_PROP,
  SCHEDULE_PROP,
  WASHBOARD_PROP,
} from "../src/miot-spec.js";

describe("MiotState enum", () => {
  it("contains the canonical translated values from r2532a's keyDefine", () => {
    expect(MiotState.Cleaning).toBe(1);
    expect(MiotState.Standby).toBe(2);
    expect(MiotState.Paused).toBe(3);
    expect(MiotState.ReturningToCharge).toBe(5);
    expect(MiotState.Charging).toBe(6);
    expect(MiotState.ChargingComplete).toBe(13);
    expect(MiotState.Updating).toBe(14);
    expect(MiotState.RemoteCleaning).toBe(23);
    expect(MiotState.CleanWashboardBase).toBe(30);
  });
});

describe("ChargingStatus enum (corrected for r2532a)", () => {
  it("uses the verified r2532a values, not the older Tasshack mapping", () => {
    expect(ChargingStatus.Charging).toBe(1);
    expect(ChargingStatus.Discharging).toBe(2);
    expect(ChargingStatus.Returning).toBe(5);
  });
});

describe("SuctionLevel enum (renamed for r2532a)", () => {
  it("uses Quiet/Standard/Intense/Max — same numeric values as Tasshack", () => {
    expect(SuctionLevel.Quiet).toBe(0);
    expect(SuctionLevel.Standard).toBe(1);
    expect(SuctionLevel.Intense).toBe(2);
    expect(SuctionLevel.Max).toBe(3);
  });
});

describe("Other dock-setting enums", () => {
  it("MopWashTemp is 0..3 (Normal..High)", () => {
    expect(MopWashTemp.Normal).toBe(0);
    expect(MopWashTemp.Mild).toBe(1);
    expect(MopWashTemp.Warm).toBe(2);
    expect(MopWashTemp.High).toBe(3);
  });
  it("MopWashWaterLevel is 0..2 (Saving..Deep)", () => {
    expect(MopWashWaterLevel.WaterSaving).toBe(0);
    expect(MopWashWaterLevel.Standard).toBe(1);
    expect(MopWashWaterLevel.Deep).toBe(2);
  });
  it("MopDryMode is 0..1 (Standard/Mute)", () => {
    expect(MopDryMode.Standard).toBe(0);
    expect(MopDryMode.Mute).toBe(1);
  });
  it("AutoEmptyFrequency uses the non-monotonic device ordering", () => {
    expect(AutoEmptyFrequency.Off).toBe(0);
    expect(AutoEmptyFrequency.Standard).toBe(1);
    expect(AutoEmptyFrequency.HighFrequency).toBe(2);
    expect(AutoEmptyFrequency.LowFrequency).toBe(3);
  });
});

describe("Schedule enums", () => {
  it("ScheduleRoute uses small-int encoding (1..4)", () => {
    expect(ScheduleRoute.Standard).toBe(1);
    expect(ScheduleRoute.Intensive).toBe(2);
    expect(ScheduleRoute.Deep).toBe(3);
    expect(ScheduleRoute.Quick).toBe(4);
  });
  it("ScheduleCleaningMode uses Dreame's arbitrary 1..4 ordering", () => {
    expect(ScheduleCleaningMode.VacOnly).toBe(1);
    expect(ScheduleCleaningMode.VacAndMop).toBe(2);
    expect(ScheduleCleaningMode.MopOnly).toBe(3);
    expect(ScheduleCleaningMode.MopAfterVac).toBe(4);
  });
});

describe("SCHEDULE_FIELD8 bit-position constants", () => {
  it("packs route, mode, suction and cycle-count without overlapping", () => {
    const fields = [
      SCHEDULE_FIELD8.ROUTE_BITS,
      SCHEDULE_FIELD8.MODE_BITS,
      SCHEDULE_FIELD8.SUCTION_BITS,
      SCHEDULE_FIELD8.CYCLE_COUNT_BITS,
    ];
    // Build a coverage bitmap and assert no field overlaps any other.
    let covered = 0;
    for (const f of fields) {
      const mask = ((1 << f.width) - 1) << f.offset;
      expect(covered & mask).toBe(0);
      covered |= mask;
    }
  });
});

describe("FEATURE_CONFIG_KEYS catalog", () => {
  it("each entry maps to the same string as its key (identity catalog)", () => {
    for (const [k, v] of Object.entries(FEATURE_CONFIG_KEYS)) {
      expect(v).toBe(k);
    }
  });
  it("includes the three keys we verified live", () => {
    expect(FEATURE_CONFIG_KEYS.AutoDry).toBeDefined();
    expect(FEATURE_CONFIG_KEYS.UVLight).toBeDefined();
    expect(FEATURE_CONFIG_KEYS.SmartAutoWash).toBeDefined();
  });
});

describe("Property bundle siids do not collide", () => {
  it("VACUUM_PROP, BATTERY_PROP, CONSUMABLE_PROP, DOCK_PROP, AUTO_EMPTY_PROP, CAMERA_PROP, SCHEDULE_PROP, WASHBOARD_PROP all have unique siid:piid", () => {
    const all = [
      ...Object.values(VACUUM_PROP),
      ...Object.values(BATTERY_PROP),
      ...Object.values(CONSUMABLE_PROP),
      ...Object.values(DOCK_PROP),
      ...Object.values(AUTO_EMPTY_PROP),
      ...Object.values(CAMERA_PROP),
      ...Object.values(SCHEDULE_PROP),
      ...Object.values(WASHBOARD_PROP),
    ];
    const seen = new Map<string, string>();
    for (const p of all) {
      const key = `${p.siid}.${p.piid}`;
      // Allow same siid:piid documented in two namespaces (e.g. SERIAL vs SERIAL_ALT
      // intentionally point at different addresses), but flag accidental dupes.
      const prev = seen.get(key);
      if (prev) {
        // Only fail if the reverse-engineered addresses really collide
        // unintentionally — currently we expect no collisions at all.
        throw new Error(`siid:piid ${key} appears twice — collision`);
      }
      seen.set(key, key);
    }
    expect(seen.size).toBe(all.length);
  });

  it("VACUUM_ACTION entries also do not collide on siid:aiid", () => {
    const seen = new Set<string>();
    for (const a of Object.values(VACUUM_ACTION)) {
      const key = `${a.siid}.${a.aiid}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

describe("CleaningMode + WaterVolume (kept for back-compat with Tasshack callers)", () => {
  it("CleaningMode covers the standard 0..3", () => {
    expect(CleaningMode.Sweeping).toBe(0);
    expect(CleaningMode.MopAfterSweep).toBe(3);
  });
  it("WaterVolume covers Low/Medium/High = 1/2/3", () => {
    expect(WaterVolume.Low).toBe(1);
    expect(WaterVolume.High).toBe(3);
  });
});
