import { EventEmitter } from "node:events";
import mqtt, { type MqttClient } from "mqtt";
import type { DreameDevice, DreameRegion, DreameSession } from "./types.js";
import { DreameTransportError } from "./errors.js";
import { randomMqttClientId } from "./crypto.js";

/** A single property update pushed by the device. */
export interface PropertyChange {
  did: string;
  siid: number;
  piid: number;
  value: unknown;
}

/**
 * Untyped key/value push from the device on method `"props"` (note: distinct
 * from `properties_changed`). Used by Dreame for non-MIoT signals — most
 * notably OTA progress (`{"ota_progress": 0..100}`) and OTA state
 * (`{"ota_state": "downloading"|"dowloaded"|"installing"|"installed"|"idle"}`).
 *
 * Yes, "dowloaded" is the literal string the device sends — Dreame's typo.
 */
export interface PropsPush {
  did: string;
  params: Record<string, unknown>;
}

/**
 * Periodic device self-info push on method `"_otc.info"`. Confirmed fields:
 *   hw_ver, fw_ver, model
 *   ap.siid (SSID — yes named `siid`), ap.bssid, ap.rssi
 *   netif.localIp, netif.mask, netif.gw
 */
export interface InfoPush {
  did: string;
  hwVer: string | null;
  fwVer: string | null;
  model: string | null;
  ap: { ssid: string | null; bssid: string | null; rssi: number | null };
  netif: { localIp: string | null; mask: string | null; gw: string | null };
  /** Original `params` block, in case more fields appear. */
  raw: Record<string, unknown>;
}

/**
 * Convenience event combining `ota_state` and `ota_progress` from the
 * `props` channel. Either field may be null on any single event — the
 * device emits state and progress as separate pushes.
 */
export interface OtaEvent {
  did: string;
  state: string | null;
  /** 0–100 integer when present. */
  progress: number | null;
}

/**
 * MIoT event push (`method: "event_occured"`, with the typo) — the
 * MIoT-defined event-bus channel for things that aren't property
 * changes. Verified live on r2532a 2026-05-03 — three distinct events
 * observed during a cleaning task:
 *
 *   - `siid 2 eiid 2` — generic "status changed" (no arguments)
 *   - `siid 4 eiid 3` — "task ended" (no arguments)
 *   - `siid 4 eiid 4` — generic vacuum-service event (no arguments)
 *   - **`siid 4 eiid 1` — TASK SUMMARY** — fires at end-of-task with
 *     the full per-task record packed into `arguments`. This is the
 *     primary mechanism Dreame native uses to expose cleaning history
 *     (the per-task piids are NOT readable as properties on r2532a;
 *     they only surface here). Argument piids include 2 (cleaning
 *     time), 3 (cleaned area), 8 (start time), 9 (per-task map
 *     filename), 10 (cleaning-properties JSON), 13 (success status).
 *
 * Subscribe via `DreameSubscription.on('event', cb)` to capture all
 * four. Filter by `siid`/`eiid` to discriminate.
 */
export interface EventOccuredPush {
  did: string;
  /** MIoT service id. */
  siid: number;
  /** MIoT event id. */
  eiid: number;
  /** Event arguments — shape varies per (siid, eiid). Usually empty. */
  arguments: unknown[];
}

/** Raw MQTT envelope as received from the broker, before flattening. */
export interface RawMqttEvent {
  id?: number;
  did?: string | number;
  data?: {
    id?: number;
    method?: string;
    /** Array shape for properties_changed; object shape for props/_otc.info. */
    params?: unknown;
  };
  [key: string]: unknown;
}

interface SubscriptionInput {
  device: DreameDevice;
  session: DreameSession;
  region: DreameRegion;
}

/**
 * Live MQTT subscription to a single device. Emits:
 *   `properties`     (PropertyChange[]) — one event per `properties_changed` push
 *   `event`          (EventOccuredPush)  — one event per MIoT event-bus push
 *                                          (`method: "event_occured"` — yes, typo)
 *   `props`          (PropsPush)         — one event per `props` push (k/v map)
 *   `info`           (InfoPush)          — one event per `_otc.info` push (typed)
 *   `ota`            (OtaEvent)          — convenience: extracted from `props` when
 *                                          params contains ota_state or ota_progress
 *   `message`        (RawMqttEvent)      — the raw envelope, for low-level inspection
 *   `connect`        ()                  — when the underlying broker connects
 *   `close`          ()                  — when the connection drops
 *   `error`          (Error)             — transport / parse errors
 *
 * Call `.close()` to tear down. Closed subscriptions cannot be reopened —
 * call `client.subscribe(did)` again to make a new one.
 */
export class DreameSubscription extends EventEmitter {
  readonly #device: DreameDevice;
  readonly #session: DreameSession;
  readonly #region: DreameRegion;
  readonly #topic: string;
  #client: MqttClient | null = null;
  #closed = false;

  constructor(input: SubscriptionInput) {
    super();
    this.#device = input.device;
    this.#session = input.session;
    this.#region = input.region;
    this.#topic = buildStatusTopic(this.#device, this.#session.uid, this.#region);
  }

  /** The MQTT topic this subscription is listening on. */
  get topic(): string {
    return this.#topic;
  }

  /** Open the connection. Resolves when the subscribe ACK comes back. */
  async open(): Promise<void> {
    if (this.#closed) {
      throw new DreameTransportError("subscription is closed");
    }
    if (this.#client) {
      return;
    }
    const broker = brokerUrl(this.#device);
    const client = mqtt.connect(broker, {
      username: this.#session.uid,
      password: this.#session.accessToken,
      clientId: randomMqttClientId(),
      protocolVersion: 4,
      reconnectPeriod: 5000,
      connectTimeout: 15000,
      // Dreame's per-device broker (`bindDomain`) presents a cert that doesn't
      // chain to a public CA — the Dreamehome app skips verification too. We
      // accept the connection without verification and rely on the access
      // token (passed as the MQTT password) for authentication. Pinning the
      // expected leaf cert here would be safer; we don't have a stable
      // fingerprint across regions/devices yet to do so.
      rejectUnauthorized: false,
      clean: true,
    });
    this.#client = client;

    client.on("connect", () => {
      this.emit("connect");
    });
    client.on("close", () => {
      this.emit("close");
    });
    client.on("error", (err) => {
      this.emit("error", err);
    });
    client.on("message", (_topic, payload) => {
      this.#handleMessage(payload);
    });

    return new Promise((resolve, reject) => {
      const onConnect = () => {
        client.subscribe(this.#topic, { qos: 0 }, (err) => {
          if (err) {
            reject(new DreameTransportError(`mqtt subscribe failed: ${err.message}`, err));
            return;
          }
          resolve();
        });
        client.removeListener("error", onError);
      };
      const onError = (err: Error) => {
        client.removeListener("connect", onConnect);
        reject(new DreameTransportError(`mqtt connect failed: ${err.message}`, err));
      };
      client.once("connect", onConnect);
      client.once("error", onError);
    });
  }

  /** Tear down the connection and stop emitting. */
  async close(): Promise<void> {
    this.#closed = true;
    const client = this.#client;
    this.#client = null;
    if (!client) {
      return;
    }
    return new Promise((resolve) => {
      client.end(false, {}, () => resolve());
    });
  }

  #handleMessage(payload: Buffer): void {
    let parsed: RawMqttEvent;
    try {
      parsed = JSON.parse(payload.toString("utf8")) as RawMqttEvent;
    } catch (err) {
      this.emit("error", new DreameTransportError("invalid mqtt payload", err));
      return;
    }
    this.emit("message", parsed);

    const did = String(parsed.did ?? this.#device.did);
    const method = parsed.data?.method;
    const params = parsed.data?.params;

    if (method === "properties_changed" && Array.isArray(params)) {
      const changes: PropertyChange[] = [];
      for (const p of params as Array<{
        did?: string | number;
        siid?: number;
        piid?: number;
        value?: unknown;
      }>) {
        if (typeof p.siid === "number" && typeof p.piid === "number") {
          changes.push({
            did: String(p.did ?? did),
            siid: p.siid,
            piid: p.piid,
            value: p.value,
          });
        }
      }
      if (changes.length > 0) {
        this.emit("properties", changes);
      }
      return;
    }

    if (method === "event_occured" && params && typeof params === "object" && !Array.isArray(params)) {
      const ev = parseEventOccured(did, params as Record<string, unknown>);
      if (ev) {
        this.emit("event", ev);
      }
      return;
    }

    if (method === "props" && params && typeof params === "object" && !Array.isArray(params)) {
      const kv = params as Record<string, unknown>;
      this.emit("props", { did, params: kv } satisfies PropsPush);
      const hasOta = "ota_state" in kv || "ota_progress" in kv;
      if (hasOta) {
        const stateValue = kv["ota_state"];
        const progressValue = kv["ota_progress"];
        const event: OtaEvent = {
          did,
          state: typeof stateValue === "string" ? stateValue : null,
          progress: typeof progressValue === "number" ? progressValue : null,
        };
        this.emit("ota", event);
      }
      return;
    }

    if (method === "_otc.info" && params && typeof params === "object") {
      this.emit("info", parseInfoPush(did, params as Record<string, unknown>));
      return;
    }
  }
}

export function brokerUrl(device: DreameDevice): string {
  const bindDomain = (device.raw["bindDomain"] as string | undefined) ?? "";
  if (!bindDomain) {
    throw new DreameTransportError(`device ${device.did} has no bindDomain — cannot connect MQTT`);
  }
  return `mqtts://${bindDomain}`;
}

export function buildStatusTopic(
  device: DreameDevice,
  uid: string,
  region: DreameRegion,
): string {
  // Trailing slash is mandatory — the broker matches it literally.
  return `/status/${device.did}/${uid}/${device.model}/${region}/`;
}

export function parseEventOccured(
  fallbackDid: string,
  params: Record<string, unknown>,
): EventOccuredPush | null {
  const siid = params["siid"];
  const eiid = params["eiid"];
  if (typeof siid !== "number" || typeof eiid !== "number") {
    return null;
  }
  const did = params["did"];
  const args = params["arguments"];
  return {
    did: typeof did === "string" || typeof did === "number" ? String(did) : fallbackDid,
    siid,
    eiid,
    arguments: Array.isArray(args) ? args : [],
  };
}

export function parseInfoPush(did: string, params: Record<string, unknown>): InfoPush {
  const ap = (params["ap"] as Record<string, unknown> | undefined) ?? {};
  const netif = (params["netif"] as Record<string, unknown> | undefined) ?? {};
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  return {
    did,
    hwVer: str(params["hw_ver"]),
    fwVer: str(params["fw_ver"]),
    model: str(params["model"]),
    ap: {
      // Yes — the device puts the SSID under the key `siid`. Also under `ssid`
      // on some builds. Try both.
      ssid: str(ap["ssid"] ?? ap["siid"]),
      bssid: str(ap["bssid"]),
      rssi: num(ap["rssi"]),
    },
    netif: {
      localIp: str(netif["localIp"]),
      mask: str(netif["mask"]),
      gw: str(netif["gw"]),
    },
    raw: params,
  };
}
