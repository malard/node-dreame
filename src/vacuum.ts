import type { DreameClient } from "./client.js";
import type { DreameDevice } from "./types.js";
import { TypedEmitter } from "./typed-emitter.js";
import type {
  DreameSubscription,
  EventOccuredPush,
  OtaEvent,
  PropertyChange,
} from "./mqtt.js";
import { DreameDeviceOfflineError, DreameTransportError } from "./errors.js";
import {
  MapDecoder,
  MapManager,
  OssFetcher,
  clientFrameRequester,
  type MapData,
  type MapSavedList,
  type OssInputBase,
} from "./map/index.js";
import { getCapabilities, type DeviceCapabilities } from "./capabilities.js";
import type { CallOptions } from "./commands.js";
import {
  BATTERY_PROP,
  CLOUD_OBJ_PROP,
  CONSUMABLE_PROP,
  CleaningMode,
  SETTINGS_PROP,
  SuctionLevel,
  TOTALS_PROP,
  VACUUM_ACTION,
  VACUUM_PROP,
  WaterVolume,
} from "./miot-spec.js";
import { APPLIERS, EMPTY_STATE, propKey, type VacuumState } from "./vacuum/state.js";
import {
  parseTaskCompleteEvent,
  type CleaningHistoryRecord,
} from "./vacuum/task-complete.js";
import { decodeSavedMapList } from "./vacuum/saved-maps.js";

export type { VacuumState } from "./vacuum/state.js";
export type { CleaningHistoryRecord } from "./vacuum/task-complete.js";
export { parseTaskCompleteEvent } from "./vacuum/task-complete.js";
export { decodeSavedMapList } from "./vacuum/saved-maps.js";

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
 * (X50 Ultra Complete).
 *
 * - Read paths verified for state / error / battery / charging /
 *   consumables / volume / suction / water.
 * - Action wire shapes VERIFIED on r2532a 2026-05-03 by firing the
 *   call against the live device while idle:
 *     LOCATE, TEST_SOUND, CLEAR_WARNING (already verified earlier);
 *     PAUSE, STOP, DOCK / goHome (returned code 0 when called while
 *     idle — wire correct, behaviour during an active task still
 *     untested);
 *     setSuction, setVolume (round-trip read-back confirmed).
 * - cleanSegments VERIFIED on r2532a 2026-05-03 — single-segment
 *   task accepted, robot transitioned through CleaningAlt (12) and
 *   MopCleaning (9) before being cancelled and recovering cleanly to
 *   ChargingComplete (13).
 * - Still untested end-to-end (would actually run the robot for
 *   longer): START, cleanZones / cleanSpot, startAutoEmpty. Wire
 *   shapes mirror Tasshack and `cleanSegments`'s verification covers
 *   the START_CUSTOM dispatch path.
 */
/**
 * Outcome of `Vacuum.refresh()`. Discriminated so callers can branch on
 * `result.kind` rather than inferring online-ness from `state.online`.
 *
 * - `"online"`: cloud round-trip succeeded; `state` reflects the latest
 *   property reads.
 * - `"offline"`: cloud returned `80001` (device didn't ACK within the
 *   broker timeout). `state` is the previous snapshot with `online`
 *   forced to `false` — likely stale.
 */
export type RefreshResult =
  | { kind: "online"; state: VacuumState }
  | { kind: "offline"; state: VacuumState };

/**
 * Cumulative lifetime stats from the device's totals service (siid 12).
 * Returned by `Vacuum.fetchTotals()`.
 */
export interface DeviceTotals {
  /** Date of the device's first cleaning task. `null` if never cleaned. */
  firstCleaningDate: Date | null;
  /** Total cleaning runtime in minutes, lifetime. */
  totalCleaningMinutes: number | null;
  /** Total number of cleaning tasks completed, lifetime. */
  cleaningCount: number | null;
  /** Total cleaned area in square metres, lifetime. */
  totalCleanedAreaSqm: number | null;
}

/** Mode values for the START_CUSTOM action's `STATUS` in-param (siid 4 piid 1). */
const CUSTOM_CLEAN_MODE = {
  SEGMENT: 18,
  ZONE: 19,
  SPOT: 20,
} as const;

/**
 * Common knobs for the segment / zone / spot cleaning helpers.
 * Defaults are picked from the cached `state.suctionRaw` /
 * `state.waterVolumeRaw` when present, falling back to Standard / Medium.
 */
export interface CleanOpts {
  /** Number of cleaning passes per target. Clamped to >= 1. Default 1. */
  repeats?: number;
  /** Suction level int (typically 0=Quiet, 1=Standard, 2=Intense, 3=Max). */
  fan?: number;
  /**
   * Water/mop level int. On self-wash docks (e.g. r2532a) the value
   * space may be a 1-32 humidity scale rather than the 1-3 enum — pass
   * through verbatim.
   */
  water?: number;
}

/**
 * Event payload map for `Vacuum`. Keys are the strings the class emits
 * via `this.emit(...)`; payloads must match the listener signature.
 *
 * - `change`: fires whenever the cached `state` materially changes
 *   (after refresh / property push / OTA snapshot update / online flip).
 * - `taskComplete`: fires once per `event_occured siid 4 eiid 1` push
 *   carrying the parsed per-task summary record.
 * - `ota`: convenience mirror of the underlying subscription's `ota`
 *   event after merge into the cached snapshot.
 * - `error`: forwarded from the underlying `DreameSubscription`.
 */
export type VacuumEvents = {
  change: [VacuumState];
  taskComplete: [CleaningHistoryRecord];
  ota: [OtaEvent];
  error: [Error];
};

export class Vacuum extends TypedEmitter<VacuumEvents> {
  readonly device: DreameDevice;
  readonly #client: DreameClient;
  #state: VacuumState = { ...EMPTY_STATE };
  #subscription: DreameSubscription | null = null;
  #mapManager: MapManager | null = null;
  #ossFetcher: OssFetcher | null = null;
  #capabilities: DeviceCapabilities | null = null;

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
   * Capabilities of this device's model — what the hardware supports
   * (mop, auto-empty, multi-floor, etc.) and which suction/water/etc.
   * values are accepted. Resolved from the model identifier on first
   * access and cached.
   *
   * For unknown models the returned record has `verified: false` and
   * conservative defaults (most hardware flags `false`); consumers
   * should branch on `verified` if they need to distinguish "feature
   * is absent" from "feature might be present, we don't know".
   */
  get capabilities(): DeviceCapabilities {
    if (!this.#capabilities) {
      this.#capabilities = getCapabilities(this.device.model);
    }
    return this.#capabilities;
  }

  /**
   * Pull all known properties once and update the cached state.
   *
   * Returns a `RefreshResult` discriminated by `kind`:
   *   - `"online"` — cloud round-trip succeeded; `state` reflects the
   *     latest property reads.
   *   - `"offline"` — cloud returned `80001` (device didn't ACK within
   *     the broker timeout). `state.online` is forced to `false` and
   *     the cached property values are likely stale.
   *
   * Any other error (network, auth, malformed response) bubbles up
   * rather than being collapsed into the offline outcome — those need
   * caller attention, not a quiet retry.
   */
  async refresh(opts: CallOptions = {}): Promise<RefreshResult> {
    const props = [
      VACUUM_PROP.STATE,
      VACUUM_PROP.ERROR,
      VACUUM_PROP.TASK_STATUS,
      VACUUM_PROP.SUCTION_LEVEL,
      VACUUM_PROP.WATER_VOLUME,
      VACUUM_PROP.CLEANING_MODE,
      VACUUM_PROP.CLEANING_TIME,
      VACUUM_PROP.CLEANED_AREA,
      VACUUM_PROP.TASK_PROGRESS_PCT,
      BATTERY_PROP.LEVEL,
      BATTERY_PROP.CHARGING_STATUS,
      SETTINGS_PROP.VOLUME,
      CONSUMABLE_PROP.MAIN_BRUSH_LEFT,
      CONSUMABLE_PROP.SIDE_BRUSH_LEFT,
      CONSUMABLE_PROP.FILTER_LEFT,
    ];
    let kind: "online" | "offline" = "online";
    try {
      const results = await this.#client.getProperties(this.device.did, props, opts);
      for (const r of results) {
        if (r.code === 0 && r.value !== undefined) {
          this.#applyChange(r.siid, r.piid, r.value);
        }
      }
      this.#setOnline(true);
    } catch (err) {
      if (err instanceof DreameDeviceOfflineError) {
        this.#setOnline(false);
        kind = "offline";
      } else {
        throw err;
      }
    }
    this.emit("change", this.state);
    return { kind, state: this.state };
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
    this.#subscription.on("event", (ev: EventOccuredPush) => {
      if (ev.siid === 4 && ev.eiid === 1) {
        const record = parseTaskCompleteEvent(ev);
        if (record) {
          this.emit("taskComplete", record);
        }
      }
    });
    this.#subscription.on("connect", () => this.#setOnline(true));
    this.#subscription.on("close", () => this.#setOnline(false));
    this.#subscription.on("error", (err) => this.emit("error", err));
  }

  async unwatch(): Promise<void> {
    if (this.#mapManager) {
      this.#mapManager.stop();
      this.#mapManager.reset();
      this.#mapManager = null;
    }
    const sub = this.#subscription;
    this.#subscription = null;
    if (sub) {
      await sub.close();
    }
  }

  /**
   * Live-map state machine for this device. Lazy: the underlying
   * `MapManager` is constructed on first access and bound to the
   * current MQTT subscription, so users who don't render maps don't
   * pay the dependency cost of decoding them.
   *
   * Requires `watch()` to have been called — without an open
   * subscription there's no source of property pushes to attach to.
   * Throws `DreameTransportError` otherwise.
   *
   * Listen on the returned manager:
   * ```ts
   * await vacuum.watch();
   * vacuum.map.on("map", (data) => render(data));
   * vacuum.map.on("error", (err) => console.error(err));
   * ```
   *
   * The manager auto-starts on first access; `unwatch()` stops it and
   * discards state. A subsequent `watch()` + `vacuum.map` access
   * returns a fresh manager bound to the new subscription.
   */
  get map(): MapManager {
    if (!this.#subscription) {
      throw new DreameTransportError("vacuum.map requires watch() to have been called first");
    }
    if (this.#mapManager) {
      return this.#mapManager;
    }
    const { fetcher } = this.#requireOssContext("vacuum.map");
    const client = this.#client;
    const device = this.device;
    this.#mapManager = new MapManager({
      source: this.#subscription,
      did: device.did,
      ossFetcher: fetcher,
      // ossInput is a callback so MapManager picks up a refreshed access
      // token / current session on each fetch (long-running connections
      // outlive the initial token's expiry). Re-derive via the shared
      // helper each call.
      ossInput: (): OssInputBase => this.#requireOssContext("vacuum.map").base,
      frameRequester: clientFrameRequester(client, device.did),
    });
    this.#mapManager.start();
    return this.#mapManager;
  }

  // ─── commands ──────────────────────────────────────────────────────

  /**
   * ASSUMED action mapping — would actually start cleaning, so not
   * fired during verification. Wire shape mirrors Tasshack.
   */
  start(): Promise<unknown> {
    return this.#client.callAction(this.device.did, { ...VACUUM_ACTION.START, in: [] });
  }

  /**
   * Wire VERIFIED on r2532a 2026-05-03 (returned code 0 when called
   * while idle). Behaviour during an active cleaning task — does it
   * actually pause? — still untested.
   */
  pause(): Promise<unknown> {
    return this.#client.callAction(this.device.did, { ...VACUUM_ACTION.PAUSE, in: [] });
  }

  /**
   * Wire VERIFIED on r2532a 2026-05-03 (returned code 0 when called
   * while idle). Behaviour during an active task still untested.
   */
  stop(): Promise<unknown> {
    return this.#client.callAction(this.device.did, { ...VACUUM_ACTION.STOP, in: [] });
  }

  /**
   * Wire VERIFIED on r2532a 2026-05-03 (returned code 0 when already
   * docked — idempotent). Behaviour mid-task — does it actually
   * recall the robot? — still untested.
   */
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

  // ─── semantic action helpers ──────────────────────────────────────
  //
  // Higher-level wrappers around START_CUSTOM (siid 4 aiid 1) — the
  // single device action that handles segment-, zone-, and spot-mode
  // cleaning, dispatched by a mode int on piid 1 plus a JSON payload
  // on piid 10. Tasshack reference: `dev` `device.py:4530-4787`. The
  // trailing `1` in each segment select is the "order" field — must
  // be 1 on r2532a (5th-gen); other values break the action there.

  /**
   * Start cleaning the named segments (rooms) in order. Each segment
   * id corresponds to a `MapSegment.id` from the live map.
   *
   * Defaults: 1 pass, current suction/water from cached state, falling
   * back to Standard suction / Medium water if state is unset.
   *
   * Throws `RangeError` if `ids` is empty.
   *
   * VERIFIED end-to-end on r2532a 2026-05-03 — single-segment task
   * accepted (code 0); state transitioned `ChargingComplete (13) →
   * CleaningAlt (12) → MopCleaning (9)` within ~10 s as the dock
   * prepared the mop pads. `cancelCurrentJob()` cleanly returned the
   * robot to `ChargingComplete (13)` ~30 s later. Battery untouched
   * (the cancel landed during dock-side mop prep, before the robot
   * actually drove).
   */
  cleanSegments(ids: number[], opts: CleanOpts = {}): Promise<unknown> {
    if (ids.length === 0) {
      throw new RangeError("cleanSegments: ids must not be empty");
    }
    const { repeats, fan, water } = this.#resolveCleanOpts(opts);
    const selects = ids.map((id) => [id, repeats, fan, water, 1]);
    return this.#startCustom(CUSTOM_CLEAN_MODE.SEGMENT, { selects });
  }

  /**
   * Clean one or more axis-aligned zones. Each zone is `(x0, y0)` →
   * `(x1, y1)` in the same mm world-frame as `MapData`. Coordinates
   * are rounded to integers before being sent (the device expects ints).
   *
   * ASSUMED action mapping (Tasshack `START_CUSTOM` mode 19) — NOT YET
   * verified on r2532a.
   */
  cleanZones(
    zones: Array<{ x0: number; y0: number; x1: number; y1: number }>,
    opts: CleanOpts = {},
  ): Promise<unknown> {
    if (zones.length === 0) {
      throw new RangeError("cleanZones: zones must not be empty");
    }
    const { repeats, fan, water } = this.#resolveCleanOpts(opts);
    const areas = zones.map((z) => [
      Math.round(z.x0),
      Math.round(z.y0),
      Math.round(z.x1),
      Math.round(z.y1),
      repeats,
      fan,
      water,
    ]);
    return this.#startCustom(CUSTOM_CLEAN_MODE.ZONE, { areas });
  }

  /**
   * Clean a small area around a single point — Tasshack notes ~1.5 m².
   * Coordinates in mm world-frame, rounded to integers before send.
   *
   * ASSUMED action mapping (Tasshack `START_CUSTOM` mode 20) — NOT YET
   * verified on r2532a.
   */
  cleanSpot(point: { x: number; y: number }, opts: CleanOpts = {}): Promise<unknown> {
    const { repeats, fan, water } = this.#resolveCleanOpts(opts);
    const points = [[Math.round(point.x), Math.round(point.y), repeats, fan, water]];
    return this.#startCustom(CUSTOM_CLEAN_MODE.SPOT, { points });
  }

  /** Resume a paused cleaning job. Same wire call as `start()`. */
  resume(): Promise<unknown> {
    return this.start();
  }

  /** Stop the current job (e.g. user pressed cancel). Same wire call as `stop()`. */
  cancelCurrentJob(): Promise<unknown> {
    return this.stop();
  }

  /** Send the robot back to its dock. Same wire call as `dock()`. */
  goHome(): Promise<unknown> {
    return this.dock();
  }

  // ─── lifetime totals ───────────────────────────────────────────────

  /**
   * Cumulative lifetime cleaning statistics for this device.
   *
   * Per-task history (a list of `{when, area, duration}` records for
   * every past task) is NOT exposed by this API — Dreame native
   * doesn't surface it the way Mi-cloud does, and the equivalent
   * endpoint is currently unknown. What you get here is the running
   * totals plus the date the device's first cleaning happened.
   *
   * VERIFIED on r2532a 2026-05-03 (matched Tasshack's
   * `types.py:657-660` mapping exactly).
   */
  async fetchTotals(opts: CallOptions = {}): Promise<DeviceTotals> {
    const results = await this.#client.getProperties(
      this.device.did,
      [
        TOTALS_PROP.FIRST_CLEANING_DATE,
        TOTALS_PROP.TOTAL_CLEANING_TIME,
        TOTALS_PROP.CLEANING_COUNT,
        TOTALS_PROP.TOTAL_CLEANED_AREA,
      ],
      opts,
    );
    const lookup = (siid: number, piid: number): number | null => {
      const r = results.find((x) => x.siid === siid && x.piid === piid);
      if (!r || r.code !== 0 || typeof r.value !== "number") {
        return null;
      }
      return r.value;
    };
    const firstEpochSec = lookup(12, 1);
    return {
      firstCleaningDate:
        firstEpochSec !== null && firstEpochSec > 0
          ? new Date(firstEpochSec * 1000)
          : null,
      totalCleaningMinutes: lookup(12, 2),
      cleaningCount: lookup(12, 3),
      totalCleanedAreaSqm: lookup(12, 4),
    };
  }

  // ─── per-task historical maps ──────────────────────────────────────

  /**
   * Fetch and decode a per-task cleaned-area map from OSS, given the
   * `logFileName` from a `CleaningHistoryRecord` (typically obtained
   * via the `'taskComplete'` event).
   *
   * The returned `MapData` carries the *full* cleaning path the robot
   * took during that task in `paths`, the same room layout in
   * `layers`/`segments`, the dock + final robot pose, and the
   * `cleanedArea` overlay (cleaned vs dirty pixels). Suitable as the
   * single input to render a "this is what was cleaned in task X"
   * historical view.
   *
   * VERIFIED on r2532a 2026-05-03 — uses the same `getDownloadUrl`
   * endpoint as live blobs (no separate "permanent" endpoint needed).
   */
  async fetchTaskMap(logFileName: string, opts: CallOptions = {}): Promise<MapData> {
    const { fetcher, base } = this.#requireOssContext("fetchTaskMap");
    const bytes = await fetcher.fetchBlob({ ...base, ...opts, filename: logFileName });
    return MapDecoder.decode(bytes.toString("utf8"));
  }

  // ─── saved maps ────────────────────────────────────────────────────

  /**
   * Fetch the device's saved-map list (all stored floors plus a
   * pointer to the currently-active one).
   *
   * Reads the OSS pointer from `siid 6 piid 8` (`MAP_LIST` /
   * `POINTER_JSON`) — a JSON `{object_name, md5}` — fetches the OSS blob
   * via `OssFetcher`, parses the wrapper JSON, and decodes each
   * inner saved-map blob via `MapDecoder`.
   *
   * **Wire-format ASSUMED** from Tasshack's Mi-cloud reference
   * (`dev` `map.py:1078-1115`):
   *   `{ mapstr: [{ map: "<base64>", name?, angle? }, ...], curr_id: <id> }`
   *
   * Verify against the live Dreame native cloud by running
   * `examples/probe-saved-maps.ts` and comparing — the wrapper key
   * names (`mapstr`, `curr_id`) and the inner `map`/`name`/`angle`
   * fields may differ on the Dreame side.
   *
   * Resolves to `null` when the device hasn't published a `MAP_LIST`
   * pointer yet (typical until the user does at least one cleaning
   * task that gets saved).
   */
  async fetchSavedMapList(opts: CallOptions = {}): Promise<MapSavedList | null> {
    const pointerResults = await this.#client.getProperties(
      this.device.did,
      [CLOUD_OBJ_PROP.POINTER_JSON],
      opts,
    );
    const pointer = pointerResults[0];
    if (!pointer || pointer.code !== 0 || typeof pointer.value !== "string" || !pointer.value) {
      return null;
    }
    let parsed: { object_name?: unknown; obj_name?: unknown };
    try {
      parsed = JSON.parse(pointer.value) as typeof parsed;
    } catch {
      return null;
    }
    // Dreame native publishes `object_name`; older notes / Tasshack docs
    // sometimes call it `obj_name`. Accept either.
    const objNameRaw = parsed.object_name ?? parsed.obj_name;
    if (typeof objNameRaw !== "string" || !objNameRaw) {
      return null;
    }
    const objName: string = objNameRaw;
    const { fetcher, base } = this.#requireOssContext("fetchSavedMapList");
    const bytes = await fetcher.fetchBlob({ ...base, ...opts, filename: objName });
    return decodeSavedMapList(bytes);
  }

  // ─── settings ──────────────────────────────────────────────────────

  /**
   * VERIFIED end-to-end on r2532a 2026-05-03 — round-trip
   * `Standard → Quiet → Standard` confirmed via property read-back.
   */
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

  /**
   * VERIFIED end-to-end on r2532a 2026-05-03 — round-trip
   * `90 → 50 → 90` confirmed via property read-back.
   */
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

  /**
   * Lazy-init the shared OssFetcher and pull a current OSS input base
   * (host/auth/region/etc.) from the live session. Throws
   * `DreameTransportError` if the client has no session yet.
   *
   * Used by `vacuum.map` (lazy MapManager construction), `fetchTaskMap`,
   * and `fetchSavedMapList` — each previously open-coded the same
   * `if (!this.#ossFetcher) … if (!session) throw …` pair.
   */
  #requireOssContext(opName: string): { fetcher: OssFetcher; base: OssInputBase } {
    if (!this.#ossFetcher) {
      this.#ossFetcher = new OssFetcher();
    }
    const session = this.#client.session;
    if (!session) {
      throw new DreameTransportError(
        `${opName}: no active session — call .login() first`,
      );
    }
    return {
      fetcher: this.#ossFetcher,
      base: {
        host: this.#client.apiHost,
        accessToken: session.accessToken,
        region: this.#client.region,
        country: this.#client.country,
        lang: this.#client.lang,
        did: this.device.did,
        model: this.device.model,
      },
    };
  }

  /** Resolve `CleanOpts` → concrete (repeats, fan, water) ints with state-aware defaults. */
  #resolveCleanOpts(opts: CleanOpts): { repeats: number; fan: number; water: number } {
    const repeats = Math.max(1, Math.trunc(opts.repeats ?? 1));
    const fan = opts.fan ?? this.#state.suctionRaw ?? SuctionLevel.Standard;
    const water = opts.water ?? this.#state.waterVolumeRaw ?? WaterVolume.Medium;
    return { repeats, fan, water };
  }

  /**
   * Dispatch the START_CUSTOM action with the given mode + payload object.
   * The payload is JSON-stringified (compact, no spaces) per Tasshack's
   * `device.py:4321` convention — the device parses the string itself.
   */
  #startCustom(mode: number, payload: Record<string, unknown>): Promise<unknown> {
    const json = JSON.stringify(payload);
    return this.#client.callAction(this.device.did, {
      ...VACUUM_ACTION.START_CUSTOM,
      in: [
        { piid: 1, value: mode },
        { piid: 10, value: json },
      ],
    });
  }

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

