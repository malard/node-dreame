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

/** Raw MQTT envelope as received from the broker, before flattening. */
export interface RawMqttEvent {
  id?: number;
  did?: string;
  data?: {
    id?: number;
    method?: string;
    params?: Array<{ did?: string; siid?: number; piid?: number; value?: unknown }>;
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
 *   `properties` (PropertyChange[]) — one event per `properties_changed` push
 *   `message`    (RawMqttEvent)     — the raw envelope, for low-level inspection
 *   `connect`    ()                  — when the underlying broker connects
 *   `close`      ()                  — when the connection drops
 *   `error`      (Error)             — transport / parse errors
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
    if (parsed.data?.method === "properties_changed" && Array.isArray(parsed.data.params)) {
      const changes: PropertyChange[] = [];
      for (const p of parsed.data.params) {
        if (typeof p.siid === "number" && typeof p.piid === "number") {
          changes.push({
            did: String(p.did ?? parsed.did ?? this.#device.did),
            siid: p.siid,
            piid: p.piid,
            value: p.value,
          });
        }
      }
      if (changes.length > 0) {
        this.emit("properties", changes);
      }
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
