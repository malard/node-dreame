import type { DreameClient } from "./client.js";
import type { DreameDevice } from "./types.js";
import { TypedEmitter } from "./typed-emitter.js";
import type {
  DreameSubscription,
  EventOccuredPush,
  MapInfoPush,
  OtaEvent,
  PropertyChange,
} from "./mqtt.js";
import { DreameDeviceOfflineError, DreameTransportError } from "./errors.js";
import {
  MapDecoder,
  MapManager,
  OssFetcher,
  clientFrameRequester,
  parsePointerJson,
  type MapData,
  type MapSavedList,
  type OssInputBase,
} from "./map/index.js";
import { getCapabilities, type DeviceCapabilities } from "./capabilities.js";
import type { CallOptions, MiotAction, MiotProp } from "./commands.js";
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
import {
  OssPointerCache,
  type OssPointer,
  type OssPointerStore,
} from "./vacuum/oss-pointer.js";

export type { VacuumState } from "./vacuum/state.js";
export type { CleaningHistoryRecord } from "./vacuum/task-complete.js";
export { parseTaskCompleteEvent } from "./vacuum/task-complete.js";
export { decodeSavedMapList } from "./vacuum/saved-maps.js";
export type { OssPointer, OssPointerStore } from "./vacuum/oss-pointer.js";

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
 * Outcome of any `Vacuum` method that issues an HTTP-side action
 * (start/dock/setSuction/etc.). Discriminated by whether the cloud's
 * HTTP-side ACK arrived in time.
 *
 * - `"acked"`: the cloud responded within the broker timeout. `value`
 *   is the raw cloud response — usually irrelevant for actions, but
 *   surfaced for the rare caller that needs it.
 * - `"no-ack"`: the cloud returned `80001` (HTTP-side ACK waiter
 *   timed out after ~8s). The action **may still have been delivered
 *   and executed** by the device — 80001 is not proof of failure
 *   (see `DreameDeviceOfflineError`). Watch the MQTT event stream
 *   to confirm the device-side response.
 *
 * Any non-80001 error (network, auth, malformed response) bubbles up
 * as a thrown error rather than collapsing into `"no-ack"` — those
 * need caller attention.
 */
export type ActionResult<T = unknown> =
  | { kind: "acked"; value: T }
  | { kind: "no-ack" };

/**
 * Outcome of `Vacuum.refresh()`. Discriminated by whether the cloud's
 * HTTP-side ACK arrived in time.
 *
 * - `"acked"`: the cloud round-trip completed and `state` reflects the
 *   latest property reads. `state.online` is also bumped to `true` —
 *   the HTTP ACK is fresh evidence the device is reachable.
 * - `"no-ack"`: the cloud returned `80001` (HTTP-side ACK waiter timed
 *   out after ~8s). The cached property values were not updated and
 *   are likely stale. `state.online` is **left untouched** — 80001 is
 *   NOT proof the device is offline (see `DreameDeviceOfflineError`),
 *   so the MQTT-driven `online` flag stays authoritative. The device
 *   may still be reachable; consumers should read MQTT echoes
 *   (`Vacuum.verifyMqtt()`) to confirm liveness rather than treating
 *   `"no-ack"` as offline.
 */
export type RefreshResult =
  | { kind: "acked"; state: VacuumState }
  | { kind: "no-ack"; state: VacuumState };

/**
 * Outcome of `Vacuum.verifyMqtt()`. Discriminated by `reason`.
 *
 * - `"ok"` — the broker echoed our trigger write back as a
 *   `properties_changed` push within the timeout. The MQTT push
 *   channel is healthy and live state pushes will flow whenever the
 *   device decides to push them.
 * - `"no-echo"` — no `properties_changed` echo arrived within the
 *   timeout. Either the device is genuinely unreachable (powered off,
 *   network lost, mid-reboot), or it's responsive but didn't generate
 *   an echo for the no-op write (rare). Try again, or extend
 *   `timeoutMs`. The HTTP-layer code 80001 ("device offline") is
 *   IGNORED here — that error is misleading on a healthy device (see
 *   `DreameDeviceOfflineError` for why) and would produce false
 *   negatives if used as the verify signal.
 * - `"not-watching"` — `vacuum.watch()` wasn't called first, so there
 *   is no subscription to verify against. Call `watch()` and retry.
 */
export type VerifyMqttResult =
  | { reason: "ok"; echoMs: number; echoCount: number }
  | { reason: "no-echo"; echoMs: null; echoCount: number }
  | { reason: "not-watching"; echoMs: null; echoCount: 0 };

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
  mapInfo: [MapInfoPush];
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
  #pointerCache = new OssPointerCache();
  #pointerCaptureAttached = false;

  constructor(client: DreameClient, device: DreameDevice) {
    super();
    this.#client = client;
    this.device = device;
  }

  /**
   * Last-known device state.
   *
   * Populated by two sources:
   *
   * 1. **`refresh()` returning `kind: "acked"`** — seeds every field
   *    in one HTTP round-trip. This is the fastest way to a fully-
   *    populated state, but it depends on the cloud's HTTP-side ACK
   *    waiter not timing out (~8s). When the cloud returns 80001
   *    (`refresh()` resolves to `kind: "no-ack"`), no seeding
   *    happens — fields stay at whatever they were before the call.
   *
   * 2. **MQTT `properties_changed` pushes** — the device emits these
   *    on every state change after `watch()` is called. They patch
   *    individual fields as values move. On a quiet idle device the
   *    push rate can be near zero, so a fresh subscription on a
   *    docked-and-charging robot may sit with most fields `null`
   *    for minutes.
   *
   * Practical implication for consumers: don't assume `state` is
   * fully populated immediately after `watch()`. Treat the
   * `'change'` event as the source of truth and re-render whenever
   * it fires, rather than reading `state` synchronously and
   * expecting non-null values across the board. Call `refresh()`
   * opportunistically — when it acks, you get a full snapshot;
   * when it no-acks, you've lost nothing.
   *
   * The returned object is the live internal snapshot — do not
   * mutate. A new snapshot is allocated on every property change,
   * so callers can compare references to detect "did anything
   * change" without a deep diff.
   */
  get state(): VacuumState {
    return this.#state;
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
   *   - `"acked"` — cloud round-trip completed; `state` reflects the
   *     latest property reads and `state.online` is bumped to `true`.
   *   - `"no-ack"` — cloud returned `80001` (HTTP-side ACK waiter
   *     timed out after ~8s). The cached property values were not
   *     updated. `state.online` is **left as it was** — 80001 is not
   *     proof of an offline device (see `DreameDeviceOfflineError`),
   *     so the MQTT-driven online flag stays authoritative.
   *
   * Any other error (network, auth, malformed response) bubbles up
   * rather than being collapsed into the no-ack outcome — those need
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
    let kind: "acked" | "no-ack" = "acked";
    try {
      const results = await this.#client.getProperties(this.device.did, props, opts);
      this.#applyBatch(results.filter((r) => r.code === 0 && r.value !== undefined));
      this.#setOnline(true);
    } catch (err) {
      if (err instanceof DreameDeviceOfflineError) {
        kind = "no-ack";
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
      if (this.#applyBatch(changes)) {
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
    this.#subscription.on("mapInfo", (push: MapInfoPush) => this.emit("mapInfo", push));
    this.#subscription.on("connect", () => this.#setOnline(true));
    this.#subscription.on("close", () => this.#setOnline(false));
    this.#subscription.on("error", (err) => this.emit("error", err));
  }

  /**
   * Actively verify that the MQTT subscription is receiving pushes.
   *
   * The MQTT subscription is an inherently passive channel — the device
   * only pushes when state changes. If you call `watch()` and then sit
   * waiting for events, you may see nothing for minutes at a time on a
   * quiet device, with no way to tell whether your subscription is
   * working or just waiting. This method removes the ambiguity: it
   * issues a no-op `VOLUME` write back to the current value, then
   * waits for the broker to echo it back as `properties_changed`.
   *
   * **The MQTT echo is the source of truth.** The HTTP layer's
   * code 80001 (`DreameDeviceOfflineError`) is misleading on a healthy
   * device — actions return 80001 even while the device is
   * simultaneously executing them and echoing state back over MQTT
   * (verified live 2026-05-04). This method therefore swallows any
   * HTTP error from the trigger write and judges purely on echo
   * arrival. If the device truly is offline, no echo will arrive and
   * the result will be `"no-echo"` — but a returning echo is unambiguous.
   *
   * Requires `watch()` to have been called first; returns
   * `"not-watching"` immediately otherwise. Default timeout 15000ms.
   */
  async verifyMqtt(opts: { timeoutMs?: number } = {}): Promise<VerifyMqttResult> {
    const sub = this.#subscription;
    if (!sub) {
      return { reason: "not-watching", echoMs: null, echoCount: 0 };
    }
    const timeoutMs = opts.timeoutMs ?? 15000;
    const start = Date.now();
    let echoCount = 0;
    let echoArrivedAt: number | null = null;
    const echoPromise = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        sub.off("properties", onProps);
        resolve(false);
      }, timeoutMs);
      const onProps = (changes: PropertyChange[]) => {
        echoCount += changes.length;
        if (echoArrivedAt === null) {
          echoArrivedAt = Date.now();
        }
        clearTimeout(timer);
        sub.off("properties", onProps);
        resolve(true);
      };
      sub.on("properties", onProps);
    });

    // Best-effort write VOLUME back to its current value as a true
    // no-op trigger. We MUST NOT write a guessed default here — the
    // device's voice volume is user-facing, and a verify probe that
    // silently bumps it to 50 is worse than failing to provoke an
    // echo. So: only write if we actually read the current value
    // back from the device; otherwise skip the trigger and rely on
    // organic pushes (mop pulse, washboard countdown, etc.) to
    // satisfy the echo wait. Either way, swallow 80001 from each
    // round-trip — that error is misleading on a healthy device
    // (see `DreameDeviceOfflineError`).
    let writeValue: number | null = null;
    try {
      const reads = await this.#client.getProperties(this.device.did, [SETTINGS_PROP.VOLUME]);
      const cur = reads[0];
      if (cur && cur.code === 0 && typeof cur.value === "number") {
        writeValue = cur.value;
      }
    } catch (err) {
      if (!(err instanceof DreameDeviceOfflineError)) {
        throw err;
      }
    }
    if (writeValue !== null) {
      try {
        await this.#client.setProperties(this.device.did, [
          { ...SETTINGS_PROP.VOLUME, value: writeValue },
        ]);
      } catch (err) {
        if (!(err instanceof DreameDeviceOfflineError)) {
          throw err;
        }
      }
    }

    const ok = await echoPromise;
    if (ok && echoArrivedAt !== null) {
      return { reason: "ok", echoMs: echoArrivedAt - start, echoCount };
    }
    return { reason: "no-echo", echoMs: null, echoCount };
  }

  async unwatch(): Promise<void> {
    if (this.#mapManager) {
      this.#mapManager.stop();
      this.#mapManager.reset();
      this.#mapManager = null;
    }
    const sub = this.#subscription;
    this.#subscription = null;
    // Pointer-capture is bound to the subscription's listener; once
    // the subscription closes, the listener goes with it. Clear the
    // attached flag so a subsequent watch() + rememberOssPointer()
    // re-attaches against the fresh subscription. The pointer cache
    // itself survives — the whole point is for it to outlive the
    // subscription.
    this.#pointerCaptureAttached = false;
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
   *
   * Resolves to an `ActionResult` — `"acked"` if the cloud responded,
   * `"no-ack"` if the cloud returned 80001 (the device may still have
   * executed the action; watch MQTT for confirmation).
   */
  start(): Promise<ActionResult> {
    return this.#emptyAction(VACUUM_ACTION.START);
  }

  /**
   * Wire VERIFIED on r2532a 2026-05-03 (returned code 0 when called
   * while idle). Behaviour during an active cleaning task — does it
   * actually pause? — still untested.
   */
  pause(): Promise<ActionResult> {
    return this.#emptyAction(VACUUM_ACTION.PAUSE);
  }

  /**
   * Wire VERIFIED on r2532a 2026-05-03 (returned code 0 when called
   * while idle). Behaviour during an active task still untested.
   */
  stop(): Promise<ActionResult> {
    return this.#emptyAction(VACUUM_ACTION.STOP);
  }

  /**
   * Wire VERIFIED on r2532a 2026-05-03 (returned code 0 when already
   * docked — idempotent). Behaviour mid-task — does it actually
   * recall the robot? — still untested.
   */
  dock(): Promise<ActionResult> {
    return this.#emptyAction(VACUUM_ACTION.CHARGE);
  }

  /** VERIFIED on r2532a 2026-05-02 — robot beeps. */
  locate(): Promise<ActionResult> {
    return this.#emptyAction(VACUUM_ACTION.LOCATE);
  }

  /** VERIFIED on r2532a 2026-05-02 — returned code 0 with no warning to clear. */
  clearWarning(): Promise<ActionResult> {
    return this.#emptyAction(VACUUM_ACTION.CLEAR_WARNING);
  }

  /** ASSUMED action mapping — NOT YET verified on r2532a. */
  startAutoEmpty(): Promise<ActionResult> {
    return this.#emptyAction(VACUUM_ACTION.START_AUTO_EMPTY);
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
  cleanSegments(ids: number[], opts: CleanOpts = {}): Promise<ActionResult> {
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
  ): Promise<ActionResult> {
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
  cleanSpot(point: { x: number; y: number }, opts: CleanOpts = {}): Promise<ActionResult> {
    const { repeats, fan, water } = this.#resolveCleanOpts(opts);
    const points = [[Math.round(point.x), Math.round(point.y), repeats, fan, water]];
    return this.#startCustom(CUSTOM_CLEAN_MODE.SPOT, { points });
  }

  /** Resume a paused cleaning job. Same wire call as `start()`. */
  resume(): Promise<ActionResult> {
    return this.start();
  }

  /** Stop the current job (e.g. user pressed cancel). Same wire call as `stop()`. */
  cancelCurrentJob(): Promise<ActionResult> {
    return this.stop();
  }

  /** Send the robot back to its dock. Same wire call as `dock()`. */
  goHome(): Promise<ActionResult> {
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

  // ─── current map (MQTT-driven) ─────────────────────────────────────

  /**
   * Fetch the current-floor map data via the live MQTT channel, with
   * lifecycle handled for you.
   *
   * This is the **MQTT-only path** — it doesn't depend on the cloud's
   * HTTP-side ACK waiter completing in time. Probed live on r2532a
   * 2026-05-06: when the Dreamehome cloud is in the 80001-from-HTTP
   * state (so `fetchSavedMapList()` returns `null`), the Dreamehome
   * mobile app gets the current floor plan via this same path —
   * watching MQTT for `siid 6 piid 3` (PATH) push, then fetching the
   * announced OSS object. `fetchCurrentMap()` exercises that path
   * directly so consumers don't have to.
   *
   * Lifecycle: if `watch()` is already active the existing
   * subscription is reused and left open. Otherwise a temporary
   * subscription is opened, the I-frame is fetched, and the
   * subscription is closed before resolving.
   *
   * Default timeout: 30000ms (matches `MapManager.whenReady`). Pass
   * `0` to wait indefinitely. Rejects with a clear error if the
   * device doesn't push a frame within the window — that case
   * typically means the device is genuinely unreachable (powered
   * off, mid-reboot), not just HTTP-slow.
   *
   * For multi-floor metadata (named maps, angles, the active-map
   * pointer) use `fetchSavedMapList()` instead — that path requires
   * the cloud's HTTP read to succeed.
   */
  async fetchCurrentMap(timeoutMs?: number): Promise<MapData> {
    const wasWatching = this.#subscription !== null;
    if (!wasWatching) {
      await this.watch();
    }
    try {
      return await this.map.whenReady(timeoutMs);
    } finally {
      if (!wasWatching) {
        await this.unwatch();
      }
    }
  }

  // ─── saved maps ────────────────────────────────────────────────────

  /**
   * Fetch the device's saved-map list — multi-floor metadata
   * (named maps, rotation angles, active-map pointer) plus the
   * decoded `MapData` for each.
   *
   * Reads the OSS pointer from `siid 6 piid 8` (`MAP_LIST` /
   * `POINTER_JSON`) via HTTP `getProperties`, fetches the OSS blob
   * via `OssFetcher`, parses the wrapper JSON, and decodes each
   * inner saved-map blob via `MapDecoder`. Wrapper shape
   * (`map.py:1078-1115`):
   *   `{ mapstr: [{ map: "<base64>", name?, angle? }, ...], curr_id: <id> }`
   *
   * **This method depends on the cloud's HTTP path** and frequently
   * returns `null` when the cloud's HTTP-side ACK waiter times out
   * (code 80001). The Dreamehome mobile app does NOT use this path
   * for rendering the current floor — it reads the live I-frame
   * over MQTT instead. **Single-floor consumers should prefer
   * `fetchCurrentMap()`**, which is MQTT-driven and works whether
   * or not the HTTP path is responsive. Reach for
   * `fetchSavedMapList()` only when you specifically need
   * per-floor names or the active-map pointer — i.e. for a
   * multi-floor home.
   *
   * Resolves to `null` when:
   *   - the device hasn't published a `MAP_LIST` pointer yet
   *     (typical until the user does at least one cleaning task
   *     that gets saved), OR
   *   - the cloud returns 80001 for the pointer read (folded into
   *     the same `null` outcome rather than thrown — see
   *     `DreameDeviceOfflineError`).
   */
  async fetchSavedMapList(opts: CallOptions = {}): Promise<MapSavedList | null> {
    let pointerResults;
    try {
      pointerResults = await this.#client.getProperties(
        this.device.did,
        [CLOUD_OBJ_PROP.POINTER_JSON],
        opts,
      );
    } catch (err) {
      if (err instanceof DreameDeviceOfflineError) {
        return null;
      }
      throw err;
    }
    const pointer = pointerResults[0];
    if (!pointer || pointer.code !== 0) {
      return null;
    }
    const parsed = parsePointerJson(pointer.value);
    if (!parsed) {
      return null;
    }
    const { fetcher, base } = this.#requireOssContext("fetchSavedMapList");
    const bytes = await fetcher.fetchBlob({ ...base, ...opts, filename: parsed.filename });
    return decodeSavedMapList(bytes);
  }

  // ─── OSS pointer caching ──────────────────────────────────────────

  /**
   * Memoise the most recent OSS-object pointers the device pushes via
   * MQTT. Once enabled, every `siid 6 piid 3` (PATH) and `siid 6 piid 8`
   * (POINTER_JSON) push is captured into an in-memory cache; consumers
   * pull the cached pointer via `lastOssPointer()` and turn it into a
   * decoded map via `fetchMapFromOss()` — no `getProperties` round-trip
   * required.
   *
   * **Why this exists:** the Dreamehome mobile app shows the saved map
   * immediately on open even when the device's HTTP path is in code-
   * 80001 ack-timeout state. It does this by caching the OSS object
   * name from a previous PATH push and re-fetching the OSS blob
   * directly. `fetchSavedMapList()` here depends on a successful
   * `getProperties(siid 6 piid 8)` and returns `null` when the cloud
   * 80001s; for an idle / sleeping device that's most of the time.
   * `rememberOssPointer()` + `fetchMapFromOss()` is the lib's path to
   * the same outcome — works whether the device is awake, asleep, or
   * even powered off (within the OSS object's TTL, which is
   * weeks-stable in practice).
   *
   * Requires `watch()` to be active — pointers arrive via the MQTT
   * subscription. Idempotent: a second call replaces the optional
   * `pointerStore` with the new one but doesn't double-subscribe.
   *
   * If `pointerStore.read()` returns previously-saved pointers, the
   * cache is seeded with them so `fetchMapFromOss()` works on first
   * call without waiting for a fresh push.
   *
   * `pointerStore.write()` is invoked when a pointer is captured for
   * the first time, when a pointer's filename changes, or when its
   * md5 changes (POINTER_JSON only) — same-pointer re-pushes are
   * deduped to avoid pointless writes.
   */
  rememberOssPointer(opts: { pointerStore?: OssPointerStore } = {}): void {
    if (!this.#subscription) {
      throw new DreameTransportError(
        "rememberOssPointer: no active MQTT subscription — call watch() first",
      );
    }
    if (opts.pointerStore !== undefined) {
      this.#pointerCache.attachStore(opts.pointerStore);
    }
    if (this.#pointerCaptureAttached) {
      return;
    }
    this.#pointerCaptureAttached = true;
    this.#subscription.on("properties", (changes: PropertyChange[]) => {
      let dirty = false;
      for (const c of changes) {
        if (this.#pointerCache.ingest(c)) {
          dirty = true;
        }
      }
      if (dirty) {
        this.#pointerCache.flushToStore();
      }
    });
  }

  /** Latest captured pointer for one source, or `null` if never seen. */
  lastOssPointer(source: "path" | "pointerJson" = "path"): OssPointer | null {
    return this.#pointerCache.get(source);
  }

  /** All captured pointers, latest-only per source. */
  lastOssPointers(): readonly OssPointer[] {
    return this.#pointerCache.list();
  }

  /**
   * Fetch and decode an OSS map blob using the cached pointer (or a
   * caller-supplied `filename`). No HTTP round-trip to the device.
   *
   * Requires `rememberOssPointer()` to have been called first (so a
   * pointer has been captured / restored), unless `opts.filename` is
   * passed explicitly.
   *
   * Throws `DreameTransportError` when no pointer is available.
   * Throws the underlying `OssFetcher` errors on network / decode
   * failure — those are real problems, not the cloud's misleading
   * 80001 case `fetchSavedMapList` swallows.
   */
  async fetchMapFromOss(opts: { filename?: string } = {}): Promise<MapData> {
    const filename = opts.filename ?? this.#pointerCache.get("path")?.filename;
    if (typeof filename !== "string" || filename.length === 0) {
      throw new DreameTransportError(
        "fetchMapFromOss: no PATH pointer cached — call rememberOssPointer() first or pass `filename`",
      );
    }
    const { fetcher, base } = this.#requireOssContext("fetchMapFromOss");
    const bytes = await fetcher.fetchBlob({ ...base, filename });
    return MapDecoder.decode(bytes.toString("utf8"));
  }

  // ─── settings ──────────────────────────────────────────────────────

  /**
   * VERIFIED end-to-end on r2532a 2026-05-03 — round-trip
   * `Standard → Quiet → Standard` confirmed via property read-back.
   */
  setSuction(level: SuctionLevel): Promise<ActionResult> {
    return this.#singlePropWrite(VACUUM_PROP.SUCTION_LEVEL, level);
  }

  /** ASSUMED enum — NOT YET verified end-to-end on r2532a. */
  setWaterVolume(level: WaterVolume): Promise<ActionResult> {
    return this.#singlePropWrite(VACUUM_PROP.WATER_VOLUME, level);
  }

  /**
   * ASSUMED enum AND known to be wrong-shape on r2532a (see CleaningMode docstring).
   * Caller is responsible for passing a correct raw int until the bitfield is decoded.
   */
  setCleaningMode(mode: CleaningMode | number): Promise<ActionResult> {
    return this.#singlePropWrite(VACUUM_PROP.CLEANING_MODE, mode);
  }

  /**
   * VERIFIED end-to-end on r2532a 2026-05-03 — round-trip
   * `90 → 50 → 90` confirmed via property read-back.
   */
  setVolume(volume: number): Promise<ActionResult> {
    if (volume < 0 || volume > 100) {
      throw new RangeError("volume must be 0-100");
    }
    return this.#singlePropWrite(SETTINGS_PROP.VOLUME, volume);
  }

  /**
   * Apply multiple settings in a single MQTT round-trip.
   * Each provided field becomes one entry in the `set_properties` array.
   *
   * Pass only the fields you want to change. `volume` is range-checked (0-100).
   *
   * Returns `{ kind: "acked", value: [] }` when no fields were passed
   * (no-op short-circuit, no HTTP call issued).
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
  }): Promise<ActionResult> {
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
      return Promise.resolve({ kind: "acked", value: [] });
    }
    return this.#tolerate80001(() =>
      this.#client.setProperties(this.device.did, writes),
    );
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
   *
   * Returns the same `ActionResult` shape the public callers do — the
   * 80001 ACK timeout is folded into `kind: "no-ack"`.
   */
  #startCustom(mode: number, payload: Record<string, unknown>): Promise<ActionResult> {
    const json = JSON.stringify(payload);
    return this.#tolerate80001(() =>
      this.#client.callAction(this.device.did, {
        ...VACUUM_ACTION.START_CUSTOM,
        in: [
          { piid: 1, value: mode },
          { piid: 10, value: json },
        ],
      }),
    );
  }

  /**
   * Run an HTTP-issuing call and fold the 80001 ACK timeout into a
   * `"no-ack"` `ActionResult`. Any other thrown error bubbles up.
   *
   * Used by every public action method on `Vacuum` so they all share
   * the same "device may have executed; watch MQTT to confirm"
   * semantics for the misleading code-80001 case.
   */
  async #tolerate80001<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
    try {
      const value = await fn();
      return { kind: "acked", value };
    } catch (err) {
      if (err instanceof DreameDeviceOfflineError) {
        return { kind: "no-ack" };
      }
      throw err;
    }
  }

  /** Dispatch a no-arg MIoT action through the 80001-tolerant wrapper. */
  #emptyAction(action: MiotAction): Promise<ActionResult> {
    return this.#tolerate80001(() =>
      this.#client.callAction(this.device.did, { ...action, in: [] }),
    );
  }

  /** Write a single MIoT property through the 80001-tolerant wrapper. */
  #singlePropWrite(prop: MiotProp, value: unknown): Promise<ActionResult> {
    return this.#tolerate80001(() =>
      this.#client.setProperties(this.device.did, [{ ...prop, value }]),
    );
  }

  #setOnline(online: boolean): void {
    if (this.#state.online === online) {
      return;
    }
    this.#state = { ...this.#state, online };
    this.emit("change", this.state);
  }

  /**
   * Apply a batch of property changes in a single state replacement.
   * Returns true if any change actually moved a field, false otherwise.
   *
   * Allocates at most one new state object per batch (vs the previous
   * per-change spread). Hot path: MQTT `properties_changed` pushes can
   * carry several entries, and high-frequency channels (mop rotation
   * pulse, washboard countdown) fire many times per second.
   */
  #applyBatch(
    changes: ReadonlyArray<{ siid: number; piid: number; value?: unknown }>,
  ): boolean {
    let next: VacuumState | null = null;
    for (const c of changes) {
      const handler = APPLIERS[propKey(c)];
      if (!handler) {
        continue;
      }
      const num = typeof c.value === "number" ? c.value : null;
      const patch = handler(num);
      const cur: VacuumState = next ?? this.#state;
      let differs = false;
      for (const k of Object.keys(patch) as Array<keyof VacuumState>) {
        if (cur[k] !== patch[k]) {
          differs = true;
          break;
        }
      }
      if (differs) {
        next = { ...cur, ...patch };
      }
    }
    if (next) {
      this.#state = next;
      return true;
    }
    return false;
  }
}

