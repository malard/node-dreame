import { EventEmitter } from "node:events";
import type { DreameClient } from "./client.js";
import type { DreameDevice } from "./types.js";
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
  type MapSaved,
  type MapSavedList,
  type OssInputBase,
} from "./map/index.js";
import { getCapabilities, type DeviceCapabilities } from "./capabilities.js";
import {
  BATTERY_PROP,
  CLOUD_OBJ_PROP,
  CONSUMABLE_PROP,
  CleaningMode,
  ChargingStatus,
  MiotState,
  SETTINGS_PROP,
  SuctionLevel,
  TOTALS_PROP,
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
  /**
   * Task progress percentage (siid 4 piid 63), 0..100. Hits 100 at
   * end-of-task right before the `taskComplete` event fires, then
   * resets to 0. VERIFIED on r2532a 2026-05-03.
   */
  taskProgressPct: number | null;
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
  taskProgressPct: null,
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
 * Per-task summary record extracted from the `event_occured siid 4
 * eiid 1` push the device fires at end-of-task.
 *
 * VERIFIED on r2532a 2026-05-03: Dreame native does NOT expose the
 * per-task fields as readable properties; they're only available
 * here as event arguments. `Vacuum` listens for the event on the
 * underlying `DreameSubscription` and emits a `'taskComplete'` event
 * with this record.
 */
export interface CleaningHistoryRecord {
  /** Task start time as a `Date` (parsed from unix epoch seconds). */
  startTime: Date;
  /** Cleaning runtime for this task in minutes. */
  cleaningTimeMin: number;
  /** Area cleaned during this task in square metres. */
  cleanedAreaSqm: number;
  /**
   * Completion status — `true` if the device flagged the task as a
   * clean success (`CLEAN_LOG_STATUS == 1`); `false` otherwise.
   */
  completed: boolean;
  /** Final value of the device's STATUS property at task end. */
  finalStatus: number;
  /** Water-tank state code at task end (raw `WATER_TANK` int). */
  waterTank: number | null;
  /**
   * OSS object name pointing at the per-task cleaned-area map.
   * Format: `ali_dreame/<YYYY>/<MM>/<DD>/<uid>/<did>_<taskId>.<fwBuild>.bin`.
   * Fetch via the existing OSS download endpoint.
   */
  logFileName: string | null;
  /**
   * Cleaning-properties JSON echoed from the original START_CUSTOM
   * request (or the device's own scheduling defaults). Shape varies;
   * keys observed include `cleaningTime`, `customeClean`, `mooClean`,
   * `pet`, `cmc`, `ismultiple`, `ctyo`, `multime`. Surfaced as the
   * raw object — consumers decode keys they care about.
   */
  cleaningProperties: Record<string, unknown> | null;
  /** Raw event arguments, in case the consumer needs untouched data. */
  raw: unknown;
}

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

export class Vacuum extends EventEmitter {
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
      VACUUM_PROP.TASK_PROGRESS_PCT,
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
    if (!this.#ossFetcher) {
      this.#ossFetcher = new OssFetcher();
    }
    const client = this.#client;
    const device = this.device;
    this.#mapManager = new MapManager({
      source: this.#subscription,
      did: device.did,
      ossFetcher: this.#ossFetcher,
      ossInput: (): OssInputBase => {
        const session = client.session;
        if (!session) {
          throw new DreameTransportError("vacuum.map: no active session for OSS fetch");
        }
        return {
          host: client.apiHost,
          accessToken: session.accessToken,
          region: client.region,
          country: client.country,
          lang: client.lang,
          did: device.did,
          model: device.model,
        };
      },
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
  async fetchTotals(): Promise<DeviceTotals> {
    const results = await this.#client.getProperties(this.device.did, [
      TOTALS_PROP.FIRST_CLEANING_DATE,
      TOTALS_PROP.TOTAL_CLEANING_TIME,
      TOTALS_PROP.CLEANING_COUNT,
      TOTALS_PROP.TOTAL_CLEANED_AREA,
    ]);
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
  async fetchSavedMapList(): Promise<MapSavedList | null> {
    const pointerResults = await this.#client.getProperties(this.device.did, [
      CLOUD_OBJ_PROP.POINTER_JSON,
    ]);
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

    if (!this.#ossFetcher) {
      this.#ossFetcher = new OssFetcher();
    }
    const session = this.#client.session;
    if (!session) {
      throw new DreameTransportError(
        "fetchSavedMapList: no active session — call .login() first",
      );
    }
    const bytes = await this.#ossFetcher.fetchBlob({
      host: this.#client.apiHost,
      accessToken: session.accessToken,
      region: this.#client.region,
      country: this.#client.country,
      lang: this.#client.lang,
      did: this.device.did,
      model: this.device.model,
      filename: objName,
    });

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

  /** Resolve `CleanOpts` → concrete (repeats, fan, water) ints with state-aware defaults. */
  #resolveCleanOpts(opts: CleanOpts): { repeats: number; fan: number; water: number } {
    const repeats = Math.max(1, Math.trunc(opts.repeats ?? 1));
    const fan = opts.fan ?? this.#state.suctionRaw ?? 1;
    const water = opts.water ?? this.#state.waterVolumeRaw ?? 2;
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
  [propKey(VACUUM_PROP.TASK_PROGRESS_PCT)]: (num) => ({ taskProgressPct: num }),
  [propKey(SETTINGS_PROP.VOLUME)]: (num) => ({ volume: num }),
  [propKey(CONSUMABLE_PROP.MAIN_BRUSH_LEFT)]: (num) => ({ mainBrushLeftPct: num }),
  [propKey(CONSUMABLE_PROP.SIDE_BRUSH_LEFT)]: (num) => ({ sideBrushLeftPct: num }),
  [propKey(CONSUMABLE_PROP.FILTER_LEFT)]: (num) => ({ filterLeftPct: num }),
};

// ─── task-complete event parser ──────────────────────────────────────

/**
 * Decode the `event_occured siid 4 eiid 1` payload into a typed
 * `CleaningHistoryRecord`. Returns `null` if the event doesn't carry
 * the expected per-task fields (start time and area at minimum).
 *
 * Argument layout verified live on r2532a 2026-05-03:
 *   {piid 1}  STATUS final value
 *   {piid 2}  CLEANING_TIME (minutes)
 *   {piid 3}  CLEANED_AREA (m²)
 *   {piid 6}  WATER_TANK
 *   {piid 8}  CLEANING_START_TIME (unix epoch seconds)
 *   {piid 9}  CLEAN_LOG_FILE_NAME (OSS object path)
 *   {piid 10} CLEANING_PROPERTIES (compact JSON string)
 *   {piid 13} CLEAN_LOG_STATUS (1 = success)
 */
export function parseTaskCompleteEvent(ev: EventOccuredPush): CleaningHistoryRecord | null {
  if (ev.siid !== 4 || ev.eiid !== 1) {
    return null;
  }
  const args = new Map<number, unknown>();
  for (const arg of ev.arguments) {
    if (arg && typeof arg === "object" && "piid" in arg && "value" in arg) {
      const piid = (arg as { piid: unknown }).piid;
      if (typeof piid === "number") {
        args.set(piid, (arg as { value: unknown }).value);
      }
    }
  }
  const startEpoch = args.get(8);
  const cleaningTimeMin = args.get(2);
  const cleanedAreaSqm = args.get(3);
  if (typeof startEpoch !== "number" || typeof cleaningTimeMin !== "number" || typeof cleanedAreaSqm !== "number") {
    return null;
  }
  const finalStatus = args.get(1);
  const completedRaw = args.get(13);
  const waterTank = args.get(6);
  const logFileName = args.get(9);
  const cleaningPropertiesRaw = args.get(10);
  let cleaningProperties: Record<string, unknown> | null = null;
  if (typeof cleaningPropertiesRaw === "string" && cleaningPropertiesRaw.length > 0) {
    try {
      cleaningProperties = JSON.parse(cleaningPropertiesRaw) as Record<string, unknown>;
    } catch {
      cleaningProperties = null;
    }
  }
  return {
    startTime: new Date(startEpoch * 1000),
    cleaningTimeMin,
    cleanedAreaSqm,
    completed: completedRaw === 1,
    finalStatus: typeof finalStatus === "number" ? finalStatus : 0,
    waterTank: typeof waterTank === "number" ? waterTank : null,
    logFileName: typeof logFileName === "string" ? logFileName : null,
    cleaningProperties,
    raw: ev.arguments,
  };
}

// ─── saved-map list decoder ──────────────────────────────────────────

interface SavedMapEntry {
  map?: string;
  name?: string;
  angle?: number | string;
}

interface SavedMapWrapper {
  mapstr?: SavedMapEntry[];
  curr_id?: number | string;
}

/**
 * Decode the OSS-fetched saved-map list blob into a `MapSavedList`.
 * Wrapper format mirrors Tasshack `dev` `map.py:1078-1115` —
 * `{ mapstr: [{ map, name, angle }, ...], curr_id }`.
 *
 * Returns `null` if the body isn't valid JSON or doesn't have the
 * expected shape — caller can then fall back to whatever recovery
 * strategy fits (re-fetch, treat the whole blob as a single map, etc.).
 */
export function decodeSavedMapList(bytes: Buffer): MapSavedList | null {
  let parsed: SavedMapWrapper;
  try {
    parsed = JSON.parse(bytes.toString("utf8")) as SavedMapWrapper;
  } catch {
    return null;
  }
  if (!parsed.mapstr || !Array.isArray(parsed.mapstr)) {
    return null;
  }
  const maps: MapSaved[] = [];
  for (const entry of parsed.mapstr) {
    if (!entry || typeof entry.map !== "string" || !entry.map) {
      continue;
    }
    let data;
    try {
      data = MapDecoder.decode(entry.map);
    } catch {
      continue;
    }
    const angle =
      typeof entry.angle === "number"
        ? entry.angle
        : typeof entry.angle === "string"
          ? Number(entry.angle) || 0
          : 0;
    maps.push({
      mapId: data.mapId,
      name: typeof entry.name === "string" ? entry.name : null,
      angle,
      data,
    });
  }
  if (maps.length === 0) {
    return null;
  }
  const currId =
    typeof parsed.curr_id === "number"
      ? parsed.curr_id
      : typeof parsed.curr_id === "string"
        ? Number(parsed.curr_id)
        : NaN;
  const activeMapId = Number.isFinite(currId) ? currId : maps[0]!.mapId;
  return { activeMapId, maps };
}
