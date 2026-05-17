export type DreameRegion = "eu" | "us" | "cn" | "ru" | "sg" | "in" | "de" | "tw";

/**
 * Severity levels used by the logger callback. Roughly:
 *   - `debug` — fine-grained diagnostic noise (per-request, per-frame).
 *   - `info`  — single-shot lifecycle events (login, refresh, subscribe).
 *   - `warn`  — recoverable anomalies (stale frame dropped, refresh fallback).
 *   - `error` — irrecoverable failures the caller should attend to.
 */
export type DreameLogLevel = "debug" | "info" | "warn" | "error";

/**
 * Logger callback. Consumers can filter by `level` and forward the rest to
 * their own logging stack. `meta` is structured context — never PII unless
 * caller-supplied content already contained it.
 */
export type DreameLogger = (
  level: DreameLogLevel,
  msg: string,
  meta?: Record<string, unknown>,
) => void;

export interface DreameClientOptions {
  email: string;
  password: string;
  region?: DreameRegion;
  /** Optional override for the auth host (advanced use). */
  authHost?: string;
  /** Optional override for the API host (advanced use). */
  apiHost?: string;
  /** Logger hook — receives debug-level messages. */
  logger?: DreameLogger;
}

export interface DreameSession {
  accessToken: string;
  refreshToken?: string | undefined;
  uid: string;
  expiresAt: number;
  region: DreameRegion;
}

export interface DreameDevice {
  did: string;
  model: string;
  name: string;
  mac?: string | undefined;
  online: boolean;
  /** Raw record from the cloud, kept for forward compatibility. */
  raw: Record<string, unknown>;
  /**
   * Firmware version string from the cloud listing (e.g. `"4.3.9_2199"`).
   * Surfaces `raw.ver` as a typed top-level field.
   */
  firmwareVersion?: string;
  /** Serial number from the cloud listing. Surfaces `raw.sn`. */
  serialNumber?: string;
  /**
   * Cloud-cached device state, distilled from the `device list` HTTP
   * response. The cloud serves these fields reliably even when
   * `getProperties` is timing out (code 80001) — useful as a fallback
   * snapshot for an otherwise-silent device.
   *
   * `null` fields indicate the cloud didn't include that field in the
   * response (rare). The numbers carry the device's last-known values
   * — they may lag a few seconds behind reality.
   */
  cloudState?: DreameCloudState;
}

/**
 * Cloud-cached subset of device state, parsed from the device-list
 * response. Each field has a direct equivalent in the live MIoT
 * property catalogue, but is served via the lighter-weight HTTP
 * endpoint that handles 80001-prone devices gracefully.
 */
export interface DreameCloudState {
  /**
   * Most-recent MIoT state int (mirrors `VACUUM_PROP.STATE`, siid 2 piid 1).
   * E.g. `13` = ChargingComplete, `2` = Standby/Cleaning. Cross-reference
   * with `MiotState`.
   */
  latestStatus: number | null;
  /** Battery percentage 0-100 (mirrors `BATTERY_PROP.LEVEL`). */
  battery: number | null;
  /**
   * Camera streaming session state. `true` when an Aliyun LinkVisual
   * video session is currently active; `false` when ended. Derived from
   * the JSON-string `videoStatus` field in the cloud response.
   */
  videoActive: boolean | null;
  /**
   * `featureCode2` — same value space as `VACUUM_PROP.FIRMWARE_CAPABILITY`
   * (siid 4 piid 83). Bitfield advertising what feature subsystems the
   * firmware supports (live-map, OTA channel, AI obstacle, …).
   */
  featureCode2: number | null;
}
