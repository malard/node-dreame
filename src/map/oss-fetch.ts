/**
 * Resolve a Dreame OSS object name (advertised via the PATH push,
 * `siid 6 piid 3`) to a signed download URL and fetch the blob.
 *
 * Endpoint: `POST /dreame-user-iot/iotfile/getDownloadUrl`
 * Body:     `{ did, model, filename, region }`
 * Response: `{ code: 0, data: "<signed-url-string>" }` — `data` is the
 *           URL string itself, not a nested `{ url }` object.
 *
 * The signed URL is good for ~1 hour (Aliyun signature). We cache it
 * for 30 min by default and on cache hit append `current=<unix_ts>` to
 * bust any intermediate caches (Tasshack convention).
 *
 * v1 only handles live blobs (the I-frame parked in OSS by the device).
 * Permanent saved-map blobs use `getOss1dDownloadUrl` and a different
 * filename mangling — deferred.
 */

import type { DreameRegion } from "../types.js";
import { RequestContext, httpPostJson } from "../http.js";
import { DreameApiError, DreameTransportError } from "../errors.js";

const OSS_DOWNLOAD_PATH = "/dreame-user-iot/iotfile/getDownloadUrl";
const DEFAULT_TTL_MS = 30 * 60 * 1000;

export interface OssFetchInput {
  /** Resolved API host (e.g. `eu.iot.dreame.tech:13267`). */
  host: string;
  /** Bearer token from the active `DreameSession`. */
  accessToken: string;
  /** Region — used for header construction and the body's `region` field. */
  region: DreameRegion;
  /** Optional `country` override for headers (defaults from region). */
  country?: string;
  /** Optional `lang` override for headers (defaults from region). */
  lang?: string;
  /** Device id. */
  did: string;
  /** Device model. */
  model: string;
  /** OSS object name (`ali_dreame/<uid>/<did>/<n>`). */
  filename: string;
}

export interface OssFetcherOpts {
  /** Cache TTL in ms. Default 30 min. */
  ttlMs?: number;
  /** Inject a clock (for tests). Default `Date.now`. */
  now?: () => number;
  /** Inject fetch (for tests). Default global `fetch`. */
  fetchImpl?: typeof fetch;
}

interface OssResolveResponse {
  code?: number;
  msg?: string;
  data?: string;
}

interface CacheEntry {
  url: string;
  expiresAt: number;
}

export class OssFetcher {
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly fetchImpl: typeof fetch;
  private readonly cache = new Map<string, CacheEntry>();
  /** In-flight fetchBlob calls, keyed `did:filename`. Lets us coalesce concurrent fetches for the same blob. */
  private readonly inflight = new Map<string, Promise<Buffer>>();

  constructor(opts: OssFetcherOpts = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.now = opts.now ?? Date.now;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /**
   * Resolve `input.filename` to a signed download URL. Uses the cache
   * when fresh; on cache hit returns the cached URL with
   * `current=<unix_ts>` appended (using `&` if the URL already has a
   * query string — Aliyun signed URLs always do).
   */
  async resolveUrl(input: OssFetchInput): Promise<string> {
    const key = `${input.did}:${input.filename}`;
    const now = this.now();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) {
      const sep = cached.url.includes("?") ? "&" : "?";
      return `${cached.url}${sep}current=${Math.floor(now / 1000)}`;
    }

    const ctx = RequestContext.from({ ...input, fetchImpl: this.fetchImpl });

    const resp = await httpPostJson<OssResolveResponse>({
      ctx,
      url: ctx.url(OSS_DOWNLOAD_PATH),
      headers: ctx.headers({
        accessToken: input.accessToken,
        contentType: "application/json",
      }),
      body: JSON.stringify({
        did: input.did,
        model: input.model,
        filename: input.filename,
        region: input.region,
      }),
      context: "oss download url",
    });

    if (typeof resp.data !== "string" || resp.data.length === 0) {
      throw new DreameApiError(
        `oss download url response missing data: ${JSON.stringify(resp).slice(0, 200)}`,
        200,
        resp,
      );
    }

    this.cache.set(key, { url: resp.data, expiresAt: now + this.ttlMs });
    return resp.data;
  }

  /**
   * Resolve, GET the signed URL, and return the raw bytes.
   *
   * Concurrent calls for the same `(did, filename)` pair are coalesced
   * into a single network request — the second caller awaits the first's
   * Promise instead of issuing a duplicate fetch.
   */
  async fetchBlob(input: OssFetchInput): Promise<Buffer> {
    const key = `${input.did}:${input.filename}`;
    const existing = this.inflight.get(key);
    if (existing) {
      return existing;
    }
    const promise = this.#doFetchBlob(input).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }

  async #doFetchBlob(input: OssFetchInput): Promise<Buffer> {
    const url = await this.resolveUrl(input);
    let res: Response;
    try {
      res = await this.fetchImpl(url, { method: "GET" });
    } catch (err) {
      throw new DreameTransportError(`oss download network error`, err);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new DreameApiError(
        `oss download failed: ${res.status} ${text.slice(0, 200)}`,
        res.status,
      );
    }
    return Buffer.from(await res.arrayBuffer());
  }

  /** Drop all cached URLs. */
  clearCache(): void {
    this.cache.clear();
  }
}
