/**
 * Tests for src/capabilities.ts.
 *
 * Asserts the curated r2532a record matches what the spec annotations
 * claim, the unknown-model fallback is conservative, and Vacuum's
 * lazy `capabilities` getter resolves and memoises.
 */

import { describe, expect, it } from "vitest";
import {
  AutoEmptyFrequency,
  CarpetHandlingMode,
  MODEL_CAPABILITIES,
  MopDryMode,
  MopWashTemp,
  MopWashWaterLevel,
  ObstacleCrossingMode,
  SuctionLevel,
  WaterVolume,
  getCapabilities,
} from "../src/index.js";
import { Vacuum } from "../src/vacuum.js";
import type { DreameClient } from "../src/client.js";
import type { DreameDevice } from "../src/types.js";

const R2532A_DEVICE: DreameDevice = {
  did: "DID-1",
  model: "dreame.vacuum.r2532a",
  name: "X50",
  online: true,
  raw: {},
};

describe("getCapabilities (verified models)", () => {
  it("returns the curated r2532a record with verified=true", () => {
    const cap = getCapabilities("dreame.vacuum.r2532a");
    expect(cap.verified).toBe(true);
    expect(cap.model).toBe("dreame.vacuum.r2532a");
  });

  it("r2532a has all hardware flags set (X50 Ultra Complete is fully featured)", () => {
    const cap = getCapabilities("dreame.vacuum.r2532a");
    expect(cap.canMop).toBe(true);
    expect(cap.canAutoInstallMop).toBe(true);
    expect(cap.hasSideBrush).toBe(true);
    expect(cap.hasCamera).toBe(true);
    expect(cap.hasCarpetSensor).toBe(true);
    expect(cap.hasAiObstacleDetection).toBe(true);
    expect(cap.canAutoEmpty).toBe(true);
    expect(cap.canMopWash).toBe(true);
    expect(cap.canMopDry).toBe(true);
    expect(cap.canHeatMopWater).toBe(true);
    expect(cap.hasDetergentReservoir).toBe(true);
    expect(cap.canCleanPerRoom).toBe(true);
    expect(cap.supportsVirtualWalls).toBe(true);
    expect(cap.supportsNoGoZones).toBe(true);
    expect(cap.hasChildLock).toBe(true);
    expect(cap.supportsMultiFloor).toBe(true);
  });

  it("r2532a supported value sets cover the full enums", () => {
    const cap = getCapabilities("dreame.vacuum.r2532a");
    expect(cap.supportedSuctionLevels).toEqual([
      SuctionLevel.Quiet,
      SuctionLevel.Standard,
      SuctionLevel.Intense,
      SuctionLevel.Max,
    ]);
    expect(cap.supportedWaterVolumes).toEqual([
      WaterVolume.Low,
      WaterVolume.Medium,
      WaterVolume.High,
    ]);
    expect(cap.supportedCarpetHandlingModes).toContain(CarpetHandlingMode.Avoid);
    expect(cap.supportedCarpetHandlingModes).toContain(CarpetHandlingMode.Crossing);
    expect(cap.supportedObstacleCrossingModes).toEqual([
      ObstacleCrossingMode.HurdleStyle,
      ObstacleCrossingMode.SynchronisedDualLeg,
    ]);
    expect(cap.supportedMopWashTemps).toContain(MopWashTemp.Normal);
    expect(cap.supportedMopWashTemps).toContain(MopWashTemp.High);
    expect(cap.supportedMopWashWaterLevels).toContain(MopWashWaterLevel.Standard);
    expect(cap.supportedMopDryModes).toEqual([MopDryMode.Standard, MopDryMode.Mute]);
    expect(cap.supportedAutoEmptyFrequencies).toContain(AutoEmptyFrequency.Off);
    expect(cap.supportedAutoEmptyFrequencies).toContain(AutoEmptyFrequency.Standard);
  });

  it("returns the same object on repeat lookup (cache by reference)", () => {
    const a = getCapabilities("dreame.vacuum.r2532a");
    const b = getCapabilities("dreame.vacuum.r2532a");
    expect(a).toBe(b);
  });

  it("MODEL_CAPABILITIES exposes the table for inspection", () => {
    expect(MODEL_CAPABILITIES["dreame.vacuum.r2532a"]).toBeDefined();
    expect(MODEL_CAPABILITIES["dreame.vacuum.r2532a"]!.verified).toBe(true);
  });
});

describe("getCapabilities (unknown model fallback)", () => {
  it("returns verified=false for unknown models", () => {
    const cap = getCapabilities("dreame.vacuum.unknown999");
    expect(cap.verified).toBe(false);
    expect(cap.model).toBe("dreame.vacuum.unknown999");
  });

  it("conservative hardware defaults — most flags false", () => {
    const cap = getCapabilities("dreame.vacuum.unknown999");
    expect(cap.canMop).toBe(false);
    expect(cap.canAutoEmpty).toBe(false);
    expect(cap.canMopWash).toBe(false);
    expect(cap.hasCamera).toBe(false);
    expect(cap.supportsMultiFloor).toBe(false);
    // hasSideBrush is the one flag that defaults true (universal across the line)
    expect(cap.hasSideBrush).toBe(true);
  });

  it("supplies the standard suction/water enums even for unknown models", () => {
    const cap = getCapabilities("dreame.vacuum.unknown999");
    expect(cap.supportedSuctionLevels.length).toBe(4);
    expect(cap.supportedWaterVolumes.length).toBe(3);
  });

  it("dock/feature value sets are empty when the matching capability is false", () => {
    const cap = getCapabilities("dreame.vacuum.unknown999");
    expect(cap.supportedMopWashTemps).toEqual([]);
    expect(cap.supportedMopWashWaterLevels).toEqual([]);
    expect(cap.supportedAutoEmptyFrequencies).toEqual([]);
    expect(cap.supportedCarpetHandlingModes).toEqual([]);
  });

  it("each fallback call returns a fresh object (so consumers can mutate freely)", () => {
    const a = getCapabilities("dreame.vacuum.unknown999");
    const b = getCapabilities("dreame.vacuum.unknown999");
    expect(a).not.toBe(b);
    // They are deep-equal though.
    expect(a).toEqual(b);
  });
});

describe("Vacuum.capabilities", () => {
  function makeVacuum(device: DreameDevice): Vacuum {
    const client = {} as DreameClient;
    return new Vacuum(client, device);
  }

  it("resolves to the device's model capabilities", () => {
    const v = makeVacuum(R2532A_DEVICE);
    expect(v.capabilities.model).toBe("dreame.vacuum.r2532a");
    expect(v.capabilities.verified).toBe(true);
    expect(v.capabilities.canMop).toBe(true);
  });

  it("memoises the lookup", () => {
    const v = makeVacuum(R2532A_DEVICE);
    const a = v.capabilities;
    const b = v.capabilities;
    expect(a).toBe(b);
  });

  it("falls back gracefully for unknown models", () => {
    const v = makeVacuum({
      did: "DID-X",
      model: "dreame.vacuum.never-heard-of-it",
      name: "?",
      online: true,
      raw: {},
    });
    expect(v.capabilities.verified).toBe(false);
    expect(v.capabilities.canAutoEmpty).toBe(false);
  });
});
