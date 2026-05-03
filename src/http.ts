import type { DreameRegion } from "./types.js";
import {
  DreameApiError,
  DreameAuthError,
  DreameDeviceOfflineError,
  DreameTransportError,
} from "./errors.js";
import {
  CONTENT_TYPE_JSON,
  REGION_DEFAULT_COUNTRY,
  REGION_DEFAULT_LANG,
  REGION_HOSTS,
} from "./config.js";
import { buildHeaders } from "./headers.js";

/** Cloud response code that means "device didn't ACK; may be offline". */
const CODE_DEVICE_OFFLINE = 80001;

/**
 * Holds the resolved per-request context — region defaults, host, fetch
 * impl. Used by every HTTP-emitting module so they don't each re-resolve
 * the `region → country/lang/host` table.
 *
 * The `fetchImpl` slot lets tests inject a mock without monkey-patching
 * the global.
 */
export interface RequestContextOpts {
  region: DreameRegion;
  /** Defaults from `REGION_DEFAULT_COUNTRY[region]`. */
  country?: string;
  /** Defaults from `REGION_DEFAULT_LANG[region]`. */
  lang?: string;
  /** Override the host (advanced — for testing). Defaults from `REGION_HOSTS[region]`. */
  host?: string;
  /** Override the fetch impl (for tests). Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * Loose-shape input accepted by `RequestContext.from` — the same `{region,
 * country?, lang?, host?, fetchImpl?}` keys that several modules pass
 * around. Shape kept open so callers can pass their own input types
 * without an explicit conversion. `undefined` is accepted on every
 * optional field (the constructor coalesces them to per-region defaults)
 * so callers don't have to strip `undefined` themselves.
 */
export interface RequestContextInput {
  region: DreameRegion;
  country?: string | undefined;
  lang?: string | undefined;
  /** Override the host (defaults from `REGION_HOSTS[region]`). Some callers spell this `authHost` or `apiHost` — pass that here. */
  host?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
}

export class RequestContext {
  readonly region: DreameRegion;
  readonly country: string;
  readonly lang: string;
  readonly host: string;
  readonly fetchImpl: typeof fetch;

  constructor(opts: RequestContextOpts) {
    this.region = opts.region;
    this.country = opts.country ?? REGION_DEFAULT_COUNTRY[opts.region];
    this.lang = opts.lang ?? REGION_DEFAULT_LANG[opts.region];
    this.host = opts.host ?? REGION_HOSTS[opts.region];
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /**
   * Construct a `RequestContext` from any object carrying the
   * `RequestContextInput` keys, applying the same conditional-spread
   * pattern that several modules used to open-code. `undefined`-valued
   * fields are stripped so they don't override the `RequestContext`
   * defaults under `exactOptionalPropertyTypes`.
   */
  static from(input: RequestContextInput): RequestContext {
    return new RequestContext({
      region: input.region,
      ...(input.country !== undefined ? { country: input.country } : {}),
      ...(input.lang !== undefined ? { lang: input.lang } : {}),
      ...(input.host !== undefined ? { host: input.host } : {}),
      ...(input.fetchImpl !== undefined ? { fetchImpl: input.fetchImpl } : {}),
    });
  }

  /** `https://<host><path>` — pass a path with a leading slash. */
  url(path: string): string {
    return `https://${this.host}${path}`;
  }

  /** Build the static Dreame headers, optionally with a bearer token + content-type. */
  headers(opts: { accessToken?: string | null; contentType?: string } = {}): Record<string, string> {
    return buildHeaders({
      region: this.region,
      country: this.country,
      lang: this.lang,
      ...(opts.accessToken !== undefined ? { accessToken: opts.accessToken } : {}),
      ...(opts.contentType !== undefined ? { contentType: opts.contentType } : {}),
    });
  }
}

/** Minimal common shape every Dreame JSON response carries. */
export interface BaseResponse {
  code?: number;
  msg?: string;
}

/**
 * POST a body, parse JSON, classify errors. Used for both API calls and
 * (with a flag) the auth token endpoint.
 *
 * Throws:
 *   - `DreameTransportError` on network failure
 *   - `DreameDeviceOfflineError` when `parsed.code === 80001`
 *   - `errorClass` (default `DreameApiError`) for any other error
 */
export async function httpPostJson<T extends BaseResponse>(input: {
  ctx: RequestContext;
  url: string;
  headers: Record<string, string>;
  body: string | URLSearchParams;
  /** Used in error messages, e.g. "sendCommand", "device list", "auth". */
  context: string;
  /** Override the error class (default `DreameApiError`). Use `DreameAuthError` for auth. */
  errorClass?: typeof DreameApiError | typeof DreameAuthError;
  /** Skip the `parsed.code !== 0` check (auth endpoint doesn't use it). */
  skipCodeCheck?: boolean;
}): Promise<T> {
  const Err = input.errorClass ?? DreameApiError;

  let res: Response;
  try {
    res = await input.ctx.fetchImpl(input.url, {
      method: "POST",
      headers: input.headers,
      body: input.body,
    });
  } catch (err) {
    throw new DreameTransportError(`network error contacting ${input.url}`, err);
  }

  const text = await res.text();
  let parsed: T | null = null;
  if (text) {
    try {
      parsed = JSON.parse(text) as T;
    } catch {
      // leave parsed null
    }
  }

  if (!res.ok) {
    throw new Err(
      `${input.context} failed: ${res.status} ${text.slice(0, 200)}`,
      res.status,
      parsed,
    );
  }
  if (!parsed) {
    throw new Err(
      `${input.context} response was not JSON (status ${res.status})`,
      res.status,
    );
  }

  if (!input.skipCodeCheck && parsed.code !== undefined && parsed.code !== 0) {
    if (parsed.code === CODE_DEVICE_OFFLINE) {
      throw new DreameDeviceOfflineError(
        `device offline: ${parsed.msg ?? "timeout"}`,
        res.status,
        parsed,
      );
    }
    throw new Err(
      `${input.context} rejected: code=${parsed.code} msg=${parsed.msg ?? "?"}`,
      res.status,
      parsed,
    );
  }

  return parsed;
}

/** Convenience: same as `httpPostJson` but stringifies + sets JSON content-type for you. */
export async function httpPostJsonBody<T extends BaseResponse>(input: {
  ctx: RequestContext;
  path: string;
  accessToken?: string;
  body: unknown;
  context: string;
}): Promise<T> {
  return httpPostJson<T>({
    ctx: input.ctx,
    url: input.ctx.url(input.path),
    headers: input.ctx.headers({
      ...(input.accessToken !== undefined ? { accessToken: input.accessToken } : {}),
      contentType: CONTENT_TYPE_JSON,
    }),
    body: JSON.stringify(input.body),
    context: input.context,
  });
}
