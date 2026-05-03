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
}
