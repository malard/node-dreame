import { EventEmitter } from "node:events";
import type { DreameClient } from "./client.js";
import type { DreameDevice } from "./types.js";
import type { DreameSubscription, PropertyChange } from "./mqtt.js";
import {
  BATTERY_PROP,
  CONSUMABLE_PROP,
  CleaningMode,
  ChargingStatus,
  SETTINGS_PROP,
  SuctionLevel,
  VACUUM_ACTION,
  VACUUM_PROP,
  VacuumStatus,
  WaterVolume,
} from "./miot-spec.js";

/** Typed snapshot of the most-recently-known device state. */
export interface VacuumState {
  status: VacuumStatus | null;
  /** Raw status integer (in case it's outside the enum we know). */
  rawStatus: number | null;
  errorCode: number | null;
  battery: number | null;
  charging: ChargingStatus | null;
  suction: SuctionLevel | null;
  waterVolume: WaterVolume | null;
  cleaningMode: CleaningMode | null;
  cleaningTimeMin: number | null;
  cleanedAreaSqm: number | null;
  volume: number | null;
  /** Consumables (% remaining). */
  mainBrushLeftPct: number | null;
  sideBrushLeftPct: number | null;
  filterLeftPct: number | null;
}

const EMPTY_STATE: VacuumState = {
  status: null,
  rawStatus: null,
  errorCode: null,
  battery: null,
  charging: null,
  suction: null,
  waterVolume: null,
  cleaningMode: null,
  cleaningTimeMin: null,
  cleanedAreaSqm: null,
  volume: null,
  mainBrushLeftPct: null,
  sideBrushLeftPct: null,
  filterLeftPct: null,
};

/**
 * High-level wrapper around a Dreame robot vacuum.
 *
 * Manages a single live state snapshot, kept fresh by an optional MQTT
 * subscription, and exposes typed start/pause/stop/dock/locate methods.
 *
 * ```ts
 * const vacuum = await dreame.getVacuum(device);
 * await vacuum.refresh();   // initial fetch
 * await vacuum.watch();     // subscribe to live updates
 * vacuum.on("change", (state) => console.log(state));
 * await vacuum.start();
 * ```
 */
export class Vacuum extends EventEmitter {
  readonly device: DreameDevice;
  readonly #client: DreameClient;
  #state: VacuumState = { ...EMPTY_STATE };
  #subscription: DreameSubscription | null = null;

  constructor(client: DreameClient, device: DreameDevice) {
    super();
    this.#client = client;
    this.device = device;
  }

  /** Last-known device state. Updated by `refresh()` and any active subscription. */
  get state(): VacuumState {
    return { ...this.#state };
  }

  /** Pull all known properties once and update the cached state. */
  async refresh(): Promise<VacuumState> {
    const props = [
      VACUUM_PROP.STATUS,
      VACUUM_PROP.ERROR,
      VACUUM_PROP.SUCTION_LEVEL,
      VACUUM_PROP.WATER_VOLUME,
      VACUUM_PROP.CLEANING_MODE,
      VACUUM_PROP.CLEANING_TIME,
      VACUUM_PROP.CLEANED_AREA,
      BATTERY_PROP.LEVEL,
      BATTERY_PROP.CHARGING_STATUS,
      SETTINGS_PROP.VOLUME,
      CONSUMABLE_PROP.MAIN_BRUSH_LEFT,
      CONSUMABLE_PROP.SIDE_BRUSH_LEFT,
      CONSUMABLE_PROP.FILTER_LEFT,
    ];
    const results = await this.#client.getProperties(this.device.did, props);
    for (const r of results) {
      if (r.code === 0 && r.value !== undefined) {
        this.#applyChange(r.siid, r.piid, r.value);
      }
    }
    this.emit("change", this.state);
    return this.state;
  }

  /** Subscribe to MQTT pushes and apply them to the local state. */
  async watch(): Promise<void> {
    if (this.#subscription) {
      return;
    }
    this.#subscription = await this.#client.subscribe(this.device);
    this.#subscription.on("properties", (changes: PropertyChange[]) => {
      let dirty = false;
      for (const c of changes) {
        if (this.#applyChange(c.siid, c.piid, c.value)) {
          dirty = true;
        }
      }
      if (dirty) {
        this.emit("change", this.state);
      }
    });
    this.#subscription.on("error", (err) => this.emit("error", err));
  }

  /** Tear down the MQTT subscription if active. */
  async unwatch(): Promise<void> {
    const sub = this.#subscription;
    this.#subscription = null;
    if (sub) {
      await sub.close();
    }
  }

  // ─── commands ──────────────────────────────────────────────────────

  /** Begin a default cleaning task. */
  start(): Promise<unknown> {
    return this.#client.callAction(this.device.did, { ...VACUUM_ACTION.START, in: [] });
  }

  pause(): Promise<unknown> {
    return this.#client.callAction(this.device.did, { ...VACUUM_ACTION.PAUSE, in: [] });
  }

  stop(): Promise<unknown> {
    return this.#client.callAction(this.device.did, { ...VACUUM_ACTION.STOP, in: [] });
  }

  /** Return to dock. */
  dock(): Promise<unknown> {
    return this.#client.callAction(this.device.did, { ...VACUUM_ACTION.CHARGE, in: [] });
  }

  /** Beep so a human can find the robot. */
  locate(): Promise<unknown> {
    return this.#client.callAction(this.device.did, { ...VACUUM_ACTION.LOCATE, in: [] });
  }

  /** Acknowledge the current warning/error. */
  clearWarning(): Promise<unknown> {
    return this.#client.callAction(this.device.did, { ...VACUUM_ACTION.CLEAR_WARNING, in: [] });
  }

  /** Trigger the dock to empty the dustbin. */
  startAutoEmpty(): Promise<unknown> {
    return this.#client.callAction(this.device.did, { ...VACUUM_ACTION.START_AUTO_EMPTY, in: [] });
  }

  // ─── settings ──────────────────────────────────────────────────────

  setSuction(level: SuctionLevel): Promise<unknown> {
    return this.#client.setProperties(this.device.did, [
      { ...VACUUM_PROP.SUCTION_LEVEL, value: level },
    ]);
  }

  setWaterVolume(level: WaterVolume): Promise<unknown> {
    return this.#client.setProperties(this.device.did, [
      { ...VACUUM_PROP.WATER_VOLUME, value: level },
    ]);
  }

  setCleaningMode(mode: CleaningMode): Promise<unknown> {
    return this.#client.setProperties(this.device.did, [
      { ...VACUUM_PROP.CLEANING_MODE, value: mode },
    ]);
  }

  setVolume(volume: number): Promise<unknown> {
    if (volume < 0 || volume > 100) {
      throw new RangeError("volume must be 0-100");
    }
    return this.#client.setProperties(this.device.did, [
      { ...SETTINGS_PROP.VOLUME, value: volume },
    ]);
  }

  // ─── internals ─────────────────────────────────────────────────────

  /** Update one cached field. Returns true if the value actually changed. */
  #applyChange(siid: number, piid: number, value: unknown): boolean {
    const key = `${siid}.${piid}`;
    const next = { ...this.#state };
    switch (key) {
      case `${VACUUM_PROP.STATUS.siid}.${VACUUM_PROP.STATUS.piid}`:
        next.rawStatus = numOr(value);
        next.status = next.rawStatus !== null && next.rawStatus in VacuumStatus
          ? (next.rawStatus as VacuumStatus)
          : null;
        break;
      case `${VACUUM_PROP.ERROR.siid}.${VACUUM_PROP.ERROR.piid}`:
        next.errorCode = numOr(value);
        break;
      case `${BATTERY_PROP.LEVEL.siid}.${BATTERY_PROP.LEVEL.piid}`:
        next.battery = numOr(value);
        break;
      case `${BATTERY_PROP.CHARGING_STATUS.siid}.${BATTERY_PROP.CHARGING_STATUS.piid}`:
        next.charging = numOr(value) as ChargingStatus | null;
        break;
      case `${VACUUM_PROP.SUCTION_LEVEL.siid}.${VACUUM_PROP.SUCTION_LEVEL.piid}`:
        next.suction = numOr(value) as SuctionLevel | null;
        break;
      case `${VACUUM_PROP.WATER_VOLUME.siid}.${VACUUM_PROP.WATER_VOLUME.piid}`:
        next.waterVolume = numOr(value) as WaterVolume | null;
        break;
      case `${VACUUM_PROP.CLEANING_MODE.siid}.${VACUUM_PROP.CLEANING_MODE.piid}`:
        next.cleaningMode = numOr(value) as CleaningMode | null;
        break;
      case `${VACUUM_PROP.CLEANING_TIME.siid}.${VACUUM_PROP.CLEANING_TIME.piid}`:
        next.cleaningTimeMin = numOr(value);
        break;
      case `${VACUUM_PROP.CLEANED_AREA.siid}.${VACUUM_PROP.CLEANED_AREA.piid}`:
        next.cleanedAreaSqm = numOr(value);
        break;
      case `${SETTINGS_PROP.VOLUME.siid}.${SETTINGS_PROP.VOLUME.piid}`:
        next.volume = numOr(value);
        break;
      case `${CONSUMABLE_PROP.MAIN_BRUSH_LEFT.siid}.${CONSUMABLE_PROP.MAIN_BRUSH_LEFT.piid}`:
        next.mainBrushLeftPct = numOr(value);
        break;
      case `${CONSUMABLE_PROP.SIDE_BRUSH_LEFT.siid}.${CONSUMABLE_PROP.SIDE_BRUSH_LEFT.piid}`:
        next.sideBrushLeftPct = numOr(value);
        break;
      case `${CONSUMABLE_PROP.FILTER_LEFT.siid}.${CONSUMABLE_PROP.FILTER_LEFT.piid}`:
        next.filterLeftPct = numOr(value);
        break;
      default:
        return false;
    }
    const changed = JSON.stringify(this.#state) !== JSON.stringify(next);
    this.#state = next;
    return changed;
  }
}

function numOr(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}
