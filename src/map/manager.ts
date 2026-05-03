/**
 * Live-map state machine.
 *
 * Subscribes to the three siid-6 channels the device uses to ship map
 * data and ties the pure decoder, merge, and OSS fetcher together into
 * a running render-ready `MapData`:
 *
 *   - `siid 6 piid 1` (MAP_DATA)     — inline P-frame deltas (and, in
 *     theory, inline I-frames; on r2532a's `fsm:1` mode only P-frames
 *     have been observed flowing here).
 *   - `siid 6 piid 3` (PATH)         — OSS object name string. The
 *     device parks the current I-frame in OSS and advertises the path
 *     here on first push and on map_id changes.
 *   - `siid 6 piid 8` (POINTER_JSON) — `{object_name, md5}` pointer. Same
 *     idea as PATH, used after OTAs / fresh-snapshot triggers.
 *
 * The manager:
 *
 *   1. Keeps a running inflated I-frame buffer (the running merged
 *      state).
 *   2. Applies in-order P-frames via `mergePFrame` and emits the
 *      decoded `MapData` on `'map'`.
 *   3. Queues out-of-order P-frames; once the queue exceeds
 *      `recoverGap` it asks the device to re-send the missing P-frame,
 *      and once it exceeds `pendingMax` it gives up on the chain and
 *      asks for a fresh I-frame.
 *   4. Resolves PATH / POINTER_JSON OSS pointers via `OssFetcher` and
 *      ingests the result as an I-frame. Dedupes back-to-back pushes
 *      with the same object name.
 *   5. Drops stale frames silently (P-frames with `frame_id <= current`,
 *      I-frames with the same `map_id` but a strictly older `frame_id`).
 *
 * Constructed with primitives so it's testable without a live MQTT
 * connection: `source` is any `EventEmitter` that emits `'properties'`
 * with a `PropertyChange[]` payload, `frameRequester` is a tiny
 * 2-method abstraction over `requestIFrame`/`requestPFrame`, and
 * `OssFetcher` already accepts an injected `fetch`.
 */

import type { EventEmitter } from "node:events";
import type { PropertyChange } from "../mqtt.js";
import type { DreameLogger } from "../types.js";
import { CLOUD_OBJ_PROP } from "../miot-spec.js";
import { TypedEmitter } from "../typed-emitter.js";
import {
  MapDecodeError,
  MapDecoder,
  parseMapHeader,
  unwrapEnvelope,
} from "./decoder.js";
import { mergePFrame, OutOfOrderFrameError } from "./merge.js";
import type { MapData } from "./types.js";
import type { OssFetchInput, OssFetcher } from "./oss-fetch.js";
import {
  requestIFrame,
  requestPFrame,
  type RequestIFrameOptions,
  type RequestPFrameOptions,
} from "./request.js";
import type { DreameClient } from "../client.js";

const DEFAULT_RECOVER_GAP = 4;
const DEFAULT_PENDING_MAX = 8;

export interface FrameRequester {
  requestIFrame(opts?: RequestIFrameOptions): Promise<unknown>;
  requestPFrame(opts: RequestPFrameOptions): Promise<unknown>;
}

/** Static fields the OssFetcher needs (host, auth, region, etc.) for one resolve call. */
export type OssInputBase = Pick<
  OssFetchInput,
  "host" | "accessToken" | "region" | "country" | "lang" | "did" | "model"
>;

/**
 * Either a static OssInputBase or a function that returns one. The function
 * form lets the manager pick up a refreshed access token between fetches —
 * `Vacuum.map` uses it so a long-running session stays valid across token
 * refreshes.
 */
export type OssInputProvider = OssInputBase | (() => OssInputBase);

export interface MapManagerOpts {
  /** Source of property pushes — emits `'properties'` with `PropertyChange[]`. */
  source: EventEmitter;
  /** Device id whose pushes we track — pushes for any other did are ignored. */
  did: string;
  /** Shared OssFetcher (one per session is fine — its URL cache is per-instance). */
  ossFetcher: OssFetcher;
  /**
   * Per-call fields the OssFetcher needs. Pass an object for static values
   * or a function for late-binding (e.g. to follow access-token refreshes).
   */
  ossInput: OssInputProvider;
  /** Active-pull abstraction. Use `clientFrameRequester(client, did)` for the production wiring. */
  frameRequester: FrameRequester;
  /** Pending-queue size after which we ask the device to re-send the missing P-frame. Default 4. */
  recoverGap?: number;
  /** Pending-queue size after which we abandon the chain and request a fresh I-frame. Default 8. */
  pendingMax?: number;
  /** Optional structured logger — see `DreameLogger`. */
  logger?: DreameLogger;
}

/**
 * Bridge a `DreameClient` + did pair into the `FrameRequester` interface.
 * Caller owns the client lifecycle.
 */
export function clientFrameRequester(client: DreameClient, did: string): FrameRequester {
  return {
    requestIFrame: (opts) => requestIFrame(client, did, opts),
    requestPFrame: (opts) => requestPFrame(client, did, opts),
  };
}

/**
 * Event payload map for `MapManager`. `'map'` carries the latest decoded
 * `MapData` (after I-frame ingest or P-frame merge); `'error'` carries
 * any decoder/transport/merge failure surfaced via `#emitError`.
 */
export type MapManagerEvents = {
  map: [MapData];
  error: [Error];
};

export class MapManager extends TypedEmitter<MapManagerEvents> {
  readonly #source: EventEmitter;
  readonly #did: string;
  readonly #ossFetcher: OssFetcher;
  readonly #ossInput: OssInputProvider;
  readonly #frameRequester: FrameRequester;
  readonly #recoverGap: number;
  readonly #pendingMax: number;
  readonly #logger?: DreameLogger;
  readonly #onProperties: (changes: PropertyChange[]) => void;

  #currentBuffer: Buffer | null = null;
  #current: MapData | null = null;
  #lastIFrameObjName: string | null = null;
  #pending = new Map<number, Buffer>();
  #started = false;
  /**
   * Serialises OSS-pointer ingests. Without this, PATH and POINTER_JSON
   * pushes for two distinct objNames arriving milliseconds apart could
   * resolve out of order and let a stale I-frame overwrite a fresher one
   * — the existing `frameId > decoded.frameId` guard only catches same-
   * mapId regressions and wouldn't catch e.g. a slow PATH followed by a
   * fast POINTER_JSON for the same generation.
   */
  #ingestQueue: Promise<void> = Promise.resolve();

  constructor(opts: MapManagerOpts) {
    super();
    this.#source = opts.source;
    this.#did = opts.did;
    this.#ossFetcher = opts.ossFetcher;
    this.#ossInput = opts.ossInput;
    this.#frameRequester = opts.frameRequester;
    this.#recoverGap = opts.recoverGap ?? DEFAULT_RECOVER_GAP;
    this.#pendingMax = opts.pendingMax ?? DEFAULT_PENDING_MAX;
    if (opts.logger !== undefined) {
      this.#logger = opts.logger;
    }
    this.#onProperties = (changes) => this.#handleProperties(changes);
  }

  /** Latest decoded map (I-frame baseline or running merged P-chain). */
  get current(): MapData | null {
    return this.#current;
  }
  get currentMapId(): number | null {
    return this.#current?.mapId ?? null;
  }
  get currentFrameId(): number | null {
    return this.#current?.frameId ?? null;
  }
  /** Number of out-of-order P-frames currently buffered. */
  get pendingCount(): number {
    return this.#pending.size;
  }

  /** Begin listening for property pushes. Idempotent. */
  start(): void {
    if (this.#started) {
      return;
    }
    this.#started = true;
    this.#source.on("properties", this.#onProperties);
  }

  /** Stop listening. Does not clear running state — call `reset()` for that. */
  stop(): void {
    if (!this.#started) {
      return;
    }
    this.#started = false;
    this.#source.off("properties", this.#onProperties);
  }

  /** Discard running state and pending queue. Useful when the underlying connection cycles. */
  reset(): void {
    this.#currentBuffer = null;
    this.#current = null;
    this.#lastIFrameObjName = null;
    this.#pending.clear();
  }

  // ── push routing ────────────────────────────────────────────────────

  #handleProperties(changes: PropertyChange[]): void {
    for (const c of changes) {
      if (c.did !== this.#did) {
        continue;
      }
      if (c.siid !== CLOUD_OBJ_PROP.MAP_DATA.siid) {
        continue;
      }
      try {
        if (c.piid === CLOUD_OBJ_PROP.MAP_DATA.piid) {
          this.#handleInlineMapData(c.value);
        } else if (c.piid === CLOUD_OBJ_PROP.PATH.piid) {
          void this.#handlePathPush(c.value);
        } else if (c.piid === CLOUD_OBJ_PROP.POINTER_JSON.piid) {
          void this.#handlePointerJsonPush(c.value);
        }
      } catch (err) {
        this.#emitError(err);
      }
    }
  }

  // ── inline frame (siid 6 piid 1) ────────────────────────────────────

  #handleInlineMapData(value: unknown): void {
    if (typeof value !== "string" || value.length === 0) {
      return;
    }
    let inflated: Buffer;
    try {
      inflated = unwrapEnvelope(value);
    } catch (err) {
      this.#emitError(err);
      return;
    }
    this.#ingestFrame(inflated);
  }

  // ── OSS-pointer frames (siid 6 piid 3, piid 8) ──────────────────────

  async #handlePathPush(value: unknown): Promise<void> {
    if (typeof value !== "string" || value.length === 0) {
      return;
    }
    await this.#fetchAndIngestOssBlob(value);
  }

  async #handlePointerJsonPush(value: unknown): Promise<void> {
    let parsed: { object_name?: unknown; obj_name?: unknown };
    if (typeof value === "string") {
      try {
        parsed = JSON.parse(value) as typeof parsed;
      } catch (err) {
        this.#emitError(new MapDecodeError(`POINTER_JSON: invalid JSON ${String(err)}`));
        return;
      }
    } else if (value && typeof value === "object") {
      parsed = value as typeof parsed;
    } else {
      return;
    }
    // Dreame native publishes `object_name`; older notes / Tasshack docs
    // sometimes say `obj_name`. Accept either.
    const objName = parsed.object_name ?? parsed.obj_name;
    if (typeof objName !== "string" || objName.length === 0) {
      return;
    }
    await this.#fetchAndIngestOssBlob(objName);
  }

  /**
   * Resolve an OSS-pointer push to bytes and ingest as an I-frame.
   *
   * Serialised through `#ingestQueue`: each invocation chains onto the
   * previous one, so two near-simultaneous pushes (e.g. a PATH and
   * POINTER_JSON each carrying a distinct objName) can never apply out
   * of order. The dedupe-by-objName check happens INSIDE the queued
   * step so we don't accidentally drop a fresh objName that arrived
   * while we were still serving the previous one.
   */
  #fetchAndIngestOssBlob(objName: string): Promise<void> {
    const next = this.#ingestQueue.then(() => this.#fetchAndIngestOssBlobNow(objName));
    // Swallow rejections on the chain itself — errors are surfaced via
    // `emit('error')` inside `#fetchAndIngestOssBlobNow`. We don't want
    // a single failure to break the chain for subsequent pushes.
    this.#ingestQueue = next.catch(() => undefined);
    return next;
  }

  async #fetchAndIngestOssBlobNow(objName: string): Promise<void> {
    if (objName === this.#lastIFrameObjName) {
      return;
    }
    this.#lastIFrameObjName = objName;
    let bytes: Buffer;
    try {
      const baseInput =
        typeof this.#ossInput === "function" ? this.#ossInput() : this.#ossInput;
      bytes = await this.#ossFetcher.fetchBlob({
        ...baseInput,
        filename: objName,
      });
    } catch (err) {
      this.#lastIFrameObjName = null;
      this.#emitError(err);
      return;
    }
    let inflated: Buffer;
    try {
      inflated = unwrapEnvelope(bytes.toString("utf8"));
    } catch (err) {
      this.#emitError(err);
      return;
    }
    this.#ingestFrame(inflated);
  }

  // ── frame ingestion ─────────────────────────────────────────────────

  #ingestFrame(inflated: Buffer): void {
    let header;
    try {
      header = parseMapHeader(inflated);
    } catch (err) {
      this.#emitError(err);
      return;
    }
    if (header.frameType === "I") {
      this.#applyIFrame(inflated);
    } else if (header.frameType === "P") {
      this.#applyPFrame(inflated, header.mapId, header.frameId);
    }
    // W-frames (wifi maps) are out of scope for v1 — drop silently.
  }

  #applyIFrame(inflated: Buffer): void {
    let decoded: MapData;
    try {
      decoded = MapDecoder.decode(inflated);
    } catch (err) {
      this.#emitError(err);
      return;
    }
    if (
      this.#current &&
      this.#current.mapId === decoded.mapId &&
      this.#current.frameId > decoded.frameId
    ) {
      this.#log("debug", "dropping stale I-frame", {
        currentFrameId: this.#current.frameId,
        incoming: decoded.frameId,
      });
      return;
    }
    this.#currentBuffer = inflated;
    this.#current = decoded;
    this.emit("map", decoded);
    this.#drainPending();
  }

  #applyPFrame(inflated: Buffer, mapId: number, frameId: number): void {
    if (!this.#currentBuffer || !this.#current) {
      this.#log("info", "P-frame before any I-frame, requesting baseline");
      this.#triggerIFrameRequest();
      return;
    }
    if (mapId !== this.#current.mapId) {
      this.#log("warn", "P-frame map_id mismatch — discarding state", {
        currentMapId: this.#current.mapId,
        incomingMapId: mapId,
      });
      this.reset();
      this.#triggerIFrameRequest();
      return;
    }
    if (frameId <= this.#current.frameId) {
      return;
    }
    if (frameId === this.#current.frameId + 1) {
      this.#mergeAndAdvance(inflated);
      this.#drainPending();
      return;
    }
    this.#pending.set(frameId, inflated);
    this.#considerRecovery();
  }

  #mergeAndAdvance(pframeInflated: Buffer): void {
    let merged: Buffer;
    try {
      merged = mergePFrame(this.#currentBuffer!, pframeInflated);
    } catch (err) {
      if (err instanceof OutOfOrderFrameError) {
        return;
      }
      this.#emitError(err);
      return;
    }
    let decoded: MapData;
    try {
      decoded = MapDecoder.decode(merged);
    } catch (err) {
      this.#emitError(err);
      return;
    }
    this.#currentBuffer = merged;
    this.#current = decoded;
    this.emit("map", decoded);
  }

  #drainPending(): void {
    while (this.#current) {
      const nextFrameId = this.#current.frameId + 1;
      const next = this.#pending.get(nextFrameId);
      if (!next) {
        break;
      }
      this.#pending.delete(nextFrameId);
      this.#mergeAndAdvance(next);
    }
    if (this.#current) {
      const cutoff = this.#current.frameId;
      for (const fid of [...this.#pending.keys()]) {
        if (fid <= cutoff) {
          this.#pending.delete(fid);
        }
      }
    }
  }

  #considerRecovery(): void {
    if (this.#pending.size > this.#pendingMax) {
      this.#log("warn", "pending queue exceeded pendingMax — requesting fresh I-frame", {
        pendingSize: this.#pending.size,
      });
      this.#pending.clear();
      this.#triggerIFrameRequest();
      return;
    }
    if (this.#pending.size > this.#recoverGap && this.#current) {
      const missing = this.#current.frameId + 1;
      this.#log("info", "pending queue exceeded recoverGap — requesting missing P-frame", {
        pendingSize: this.#pending.size,
        missingFrameId: missing,
        mapId: this.#current.mapId,
      });
      this.#triggerPFrameRequest({ mapId: this.#current.mapId, frameId: missing });
    }
  }

  #triggerIFrameRequest(): void {
    void Promise.resolve(this.#frameRequester.requestIFrame()).catch((err) =>
      this.#emitError(err),
    );
  }

  #triggerPFrameRequest(opts: RequestPFrameOptions): void {
    void Promise.resolve(this.#frameRequester.requestPFrame(opts)).catch((err) =>
      this.#emitError(err),
    );
  }

  #emitError(err: unknown): void {
    const e = err instanceof Error ? err : new Error(String(err));
    this.emit("error", e);
  }

  #log(
    level: "debug" | "info" | "warn" | "error",
    msg: string,
    meta?: Record<string, unknown>,
  ): void {
    this.#logger?.(level, `map: ${msg}`, meta);
  }
}
