import { EventEmitter } from "node:events";
import type { DreameClient } from "./client.js";
import type { DreameDevice } from "./types.js";
import type { DreameSubscription, OtaEvent, PropertyChange } from "./mqtt.js";
import { DreameDeviceOfflineError } from "./errors.js";
import {
  BATTERY_PROP,
  CONSUMABLE_PROP,
  CleaningMode,
  ChargingStatus,
  MiotState,
  SETTINGS_PROP,
  SuctionLevel,
  VACUUM_ACTION,
  VACUUM_PROP,
  WaterVolume,
} from "./miot-spec.js";

/**
 * Typed snapshot of the most-recently-known device state.
 *
 * Field naming convention:
 *   - `<name>` (typed)         → enum/struct value where we have a VERIFIED mapping
 *   - `raw<Name>` / `<name>Raw` → raw integer for fields where the enum is ASSUMED
 *                                 or value space is not yet decoded
 *
 * See `miot-spec.ts` for which siid/piid combos are verified vs assumed.
 */
export interface VacuumState {
  /** MIoT STATE (siid 2 piid 1). VERIFIED enum mapping for r2532a. */
  miotState: MiotState | null;
  /** Raw int from siid 2 piid 1 — present even when outside the known enum. */
  miotStateRaw: number | null;
  /** Error/fault code (siid 2 piid 2). 0 = clear. */
  errorCode: number | null;

  /**
   * Dreame "task status" raw int (siid 4 piid 1).
   * NOT enum-mapped: Tasshack's older-model enum does not match observed
   * r2532a values, and we don't yet have a translated keyDefine for it.
   */
  taskStatusRaw: number | null;

  /** Battery percentage (siid 3 piid 1). */
  battery: number | null;
  /** Charging status (siid 3 piid 2). ASSUMED enum from Tasshack. */
  charging: ChargingStatus | null;
  /** Same as `charging` but as the raw int — useful when value is outside the assumed enum. */
  chargingRaw: number | null;

  /** Suction level (siid 4 piid 4). ASSUMED enum from Tasshack. */
  suction: SuctionLevel | null;
  suctionRaw: number | null;

  /** Water volume (siid 4 piid 5). ASSUMED enum from Tasshack. */
  waterVolume: WaterVolume | null;
  waterVolumeRaw: number | null;

  /**
   * Cleaning mode (siid 4 piid 23). On r2532a returns values like 5120 that
   * don't fit the simple Tasshack enum — likely a packed bitfield. Raw only
   * until decoded.
   */
  cleaningModeRaw: number | null;
  /** Tentative enum value — only populated when raw is in 0-3 range. */
  cleaningMode: CleaningMode | null;

  /** Current job runtime in minutes (siid 4 piid 2). ASSUMED. */
  cleaningTimeMin: number | null;
  /** Area cleaned this job in m² (siid 4 piid 3). ASSUMED. */
  cleanedAreaSqm: number | null;
  /** Voice volume 0-100 (siid 7 piid 1). ASSUMED. */
  volume: number | null;

  /** Consumables — % remaining (ASSUMED siid/piid from Tasshack). */
  mainBrushLeftPct: number | null;
  sideBrushLeftPct: number | null;
  filterLeftPct: number | null;

  /**
   * Whether the device is currently reachable via the cloud. Updated by
   * MQTT connect/close events and by refresh() outcomes. `null` means
   * unknown (haven't connected/refreshed yet).
   */
  online: boolean | null;
  /**
   * Latest OTA event seen (state + progress). `null` once the OTA settles
   * back to `state: "idle"` or `state: "installed"`. Useful for UI progress bars.
   */
  ota: OtaEvent | null;
}

const EMPTY_STATE: VacuumState = {
  miotState: null,
  miotStateRaw: null,
  errorCode: null,
  taskStatusRaw: null,
  battery: null,
  charging: null,
  chargingRaw: null,
  suction: null,
  suctionRaw: null,
  waterVolume: null,
  waterVolumeRaw: null,
  cleaningModeRaw: null,
  cleaningMode: null,
  cleaningTimeMin: null,
  cleanedAreaSqm: null,
  volume: null,
  mainBrushLeftPct: null,
  sideBrushLeftPct: null,
  filterLeftPct: null,
  online: null,
  ota: null,
};

/**
 * High-level wrapper around a Dreame robot vacuum.
 *
 * ```ts
 * const vacuum = dreame.getVacuum(device);
 * await vacuum.refresh();
 * await vacuum.watch();
 * vacuum.on("change", (state) => console.log(state));
 * await vacuum.locate();
 * ```
 *
 * **Verification status:** built/tested against `dreame.vacuum.r2532a`
 * (X50 Ultra Complete). Read paths verified for state/error/battery/charging
 * and the consumable/volume reads. Action paths verified for LOCATE,
 * TEST_SOUND, and CLEAR_WARNING. START/PAUSE/STOP/DOCK and the various
 * setters are wired but NOT YET exercised against this hardware — they use
 * Tasshack's standard mappings which work on older Dreames.
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

  /** Last-known device state. */
  get state(): VacuumState {
    return { ...this.#state };
  }

  /**
   * Pull all known properties once and update the cached state.
   *
   * If the device is offline (cloud returns 80001), this does NOT throw —
   * it sets `state.online = false` and returns the (likely stale) snapshot.
   * Any other error bubbles up.
   */
  async refresh(): Promise<VacuumState> {
    const props = [
      VACUUM_PROP.STATE,
      VACUUM_PROP.ERROR,
      VACUUM_PROP.TASK_STATUS,
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
    try {
      const results = await this.#client.getProperties(this.device.did, props);
      for (const r of results) {
        if (r.code === 0 && r.value !== undefined) {
          this.#applyChange(r.siid, r.piid, r.value);
        }
      }
      this.#setOnline(true);
    } catch (err) {
      if (err instanceof DreameDeviceOfflineError) {
        this.#setOnline(false);
      } else {
        throw err;
      }
    }
    this.emit("change", this.state);
    return this.state;
  }

  /**
   * Subscribe to MQTT pushes and apply them to the local state.
   * Also updates `state.online` from MQTT connect/close events and
   * `state.ota` from `props` pushes that carry `ota_state`/`ota_progress`.
   */
  async watch(): Promise<void> {
    if (this.#subscription) {
      return;
    }
    this.#subscription = await this.#client.subscribe(this.device);
    this.#setOnline(true);

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
    this.#subscription.on("ota", (event: OtaEvent) => {
      // Merge into the cached OTA snapshot — state and progress can arrive separately.
      const cur = this.#state.ota ?? { did: this.device.did, state: null, progress: null };
      const merged: OtaEvent = {
        did: event.did,
        state: event.state ?? cur.state,
        progress: event.progress ?? cur.progress,
      };
      // Once the device reports idle/installed, clear the snapshot — OTA done.
      const settled = merged.state === "idle" || merged.state === "installed";
      this.#state = { ...this.#state, ota: settled ? null : merged };
      this.emit("change", this.state);
      this.emit("ota", merged);
    });
    this.#subscription.on("connect", () => this.#setOnline(true));
    this.#subscription.on("close", () => this.#setOnline(false));
    this.#subscription.on("error", (err) => this.emit("error", err));
  }

  async unwatch(): Promise<void> {
    const sub = this.#subscription;
    this.#subscription = null;
    if (sub) {
      await sub.close();
    }
  }

  // ─── commands ──────────────────────────────────────────────────────

  /** ASSUMED action mapping — NOT YET verified on r2532a. */
  start(): Promise<unknown> {
    return this.#client.callAction(this.device.did, { ...VACUUM_ACTION.START, in: [] });
  }

  /** ASSUMED action mapping — NOT YET verified on r2532a. */
  pause(): Promise<unknown> {
    return this.#client.callAction(this.device.did, { ...VACUUM_ACTION.PAUSE, in: [] });
  }

  /** ASSUMED action mapping — NOT YET verified on r2532a. */
  stop(): Promise<unknown> {
    return this.#client.callAction(this.device.did, { ...VACUUM_ACTION.STOP, in: [] });
  }

  /** ASSUMED action mapping — NOT YET verified on r2532a. */
  dock(): Promise<unknown> {
    return this.#client.callAction(this.device.did, { ...VACUUM_ACTION.CHARGE, in: [] });
  }

  /** VERIFIED on r2532a 2026-05-02 — robot beeps. */
  locate(): Promise<unknown> {
    return this.#client.callAction(this.device.did, { ...VACUUM_ACTION.LOCATE, in: [] });
  }

  /** VERIFIED on r2532a 2026-05-02 — returned code 0 with no warning to clear. */
  clearWarning(): Promise<unknown> {
    return this.#client.callAction(this.device.did, { ...VACUUM_ACTION.CLEAR_WARNING, in: [] });
  }

  /** ASSUMED action mapping — NOT YET verified on r2532a. */
  startAutoEmpty(): Promise<unknown> {
    return this.#client.callAction(this.device.did, { ...VACUUM_ACTION.START_AUTO_EMPTY, in: [] });
  }

  // ─── settings ──────────────────────────────────────────────────────

  /** ASSUMED enum — NOT YET verified end-to-end on r2532a. */
  setSuction(level: SuctionLevel): Promise<unknown> {
    return this.#client.setProperties(this.device.did, [
      { ...VACUUM_PROP.SUCTION_LEVEL, value: level },
    ]);
  }

  /** ASSUMED enum — NOT YET verified end-to-end on r2532a. */
  setWaterVolume(level: WaterVolume): Promise<unknown> {
    return this.#client.setProperties(this.device.did, [
      { ...VACUUM_PROP.WATER_VOLUME, value: level },
    ]);
  }

  /**
   * ASSUMED enum AND known to be wrong-shape on r2532a (see CleaningMode docstring).
   * Caller is responsible for passing a correct raw int until the bitfield is decoded.
   */
  setCleaningMode(mode: CleaningMode | number): Promise<unknown> {
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

  /**
   * Apply multiple settings in a single MQTT round-trip.
   * Each provided field becomes one entry in the `set_properties` array.
   *
   * Pass only the fields you want to change. `volume` is range-checked (0-100).
   *
   * ```ts
   * await vacuum.setSettings({ suction: SuctionLevel.Quiet, waterVolume: WaterVolume.Low });
   * ```
   */
  setSettings(opts: {
    suction?: SuctionLevel;
    waterVolume?: WaterVolume;
    cleaningMode?: CleaningMode | number;
    volume?: number;
  }): Promise<unknown> {
    const writes: Array<{ siid: number; piid: number; value: unknown }> = [];
    if (opts.suction !== undefined) {
      writes.push({ ...VACUUM_PROP.SUCTION_LEVEL, value: opts.suction });
    }
    if (opts.waterVolume !== undefined) {
      writes.push({ ...VACUUM_PROP.WATER_VOLUME, value: opts.waterVolume });
    }
    if (opts.cleaningMode !== undefined) {
      writes.push({ ...VACUUM_PROP.CLEANING_MODE, value: opts.cleaningMode });
    }
    if (opts.volume !== undefined) {
      if (opts.volume < 0 || opts.volume > 100) {
        throw new RangeError("volume must be 0-100");
      }
      writes.push({ ...SETTINGS_PROP.VOLUME, value: opts.volume });
    }
    if (writes.length === 0) {
      return Promise.resolve([]);
    }
    return this.#client.setProperties(this.device.did, writes);
  }

  // ─── internals ─────────────────────────────────────────────────────

  #setOnline(online: boolean): void {
    if (this.#state.online === online) {
      return;
    }
    this.#state = { ...this.#state, online };
    this.emit("change", this.state);
  }

  /** Returns true if the value actually changed. */
  #applyChange(siid: number, piid: number, value: unknown): boolean {
    const handler = APPLIERS[propKey({ siid, piid })];
    if (!handler) {
      return false;
    }
    const num = typeof value === "number" ? value : null;
    const patch = handler(num);
    let changed = false;
    for (const k of Object.keys(patch) as Array<keyof VacuumState>) {
      if (this.#state[k] !== patch[k]) {
        changed = true;
        break;
      }
    }
    if (changed) {
      this.#state = { ...this.#state, ...patch };
    }
    return changed;
  }
}

// ─── property-applier table ──────────────────────────────────────────
//
// Each handler maps a single MIoT property push (numeric value, possibly
// null if the device sent a non-number) to a partial state patch. The
// `#applyChange` method looks up the right handler by `siid.piid`,
// computes the patch, and merges it into state.
//
// Adding a new tracked property: add one entry here. No need to touch
// `#applyChange`.

type Patch = Partial<VacuumState>;
type Applier = (num: number | null) => Patch;

function propKey(p: { siid: number; piid: number }): string {
  return `${p.siid}.${p.piid}`;
}

/** Narrow a raw int to an enum member, or null if it's not a known value. */
function asEnum<T extends number>(num: number | null, enumObj: object): T | null {
  return num !== null && num in enumObj ? (num as T) : null;
}

const APPLIERS: Record<string, Applier> = {
  [propKey(VACUUM_PROP.STATE)]: (num) => ({
    miotStateRaw: num,
    miotState: asEnum<MiotState>(num, MiotState),
  }),
  [propKey(VACUUM_PROP.ERROR)]: (num) => ({ errorCode: num }),
  [propKey(VACUUM_PROP.TASK_STATUS)]: (num) => ({ taskStatusRaw: num }),
  [propKey(BATTERY_PROP.LEVEL)]: (num) => ({ battery: num }),
  [propKey(BATTERY_PROP.CHARGING_STATUS)]: (num) => ({
    chargingRaw: num,
    charging: asEnum<ChargingStatus>(num, ChargingStatus),
  }),
  [propKey(VACUUM_PROP.SUCTION_LEVEL)]: (num) => ({
    suctionRaw: num,
    suction: asEnum<SuctionLevel>(num, SuctionLevel),
  }),
  [propKey(VACUUM_PROP.WATER_VOLUME)]: (num) => ({
    waterVolumeRaw: num,
    waterVolume: asEnum<WaterVolume>(num, WaterVolume),
  }),
  [propKey(VACUUM_PROP.CLEANING_MODE)]: (num) => ({
    cleaningModeRaw: num,
    cleaningMode: num !== null && num >= 0 && num <= 3 ? (num as CleaningMode) : null,
  }),
  [propKey(VACUUM_PROP.CLEANING_TIME)]: (num) => ({ cleaningTimeMin: num }),
  [propKey(VACUUM_PROP.CLEANED_AREA)]: (num) => ({ cleanedAreaSqm: num }),
  [propKey(SETTINGS_PROP.VOLUME)]: (num) => ({ volume: num }),
  [propKey(CONSUMABLE_PROP.MAIN_BRUSH_LEFT)]: (num) => ({ mainBrushLeftPct: num }),
  [propKey(CONSUMABLE_PROP.SIDE_BRUSH_LEFT)]: (num) => ({ sideBrushLeftPct: num }),
  [propKey(CONSUMABLE_PROP.FILTER_LEFT)]: (num) => ({ filterLeftPct: num }),
};
