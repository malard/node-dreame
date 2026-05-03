/**
 * Dreame request-header builder.
 *
 * Lives in its own module so neither `auth.ts` nor `http.ts` has to
 * import from the other (the previous arrangement created a circular
 * `auth → http → auth` import chain). `http.ts` and `RequestContext`
 * use this directly; `auth.ts` re-exports for backwards compatibility
 * with consumers (and the test suite) that import the builder from
 * there.
 */

import type { DreameRegion } from "./types.js";
import {
  APP_META,
  APP_USER_AGENT,
  CONTENT_TYPE_FORM,
  OAUTH_BASIC_AUTH,
  TENANT_DREAME,
} from "./config.js";
import { buildRlcHeader } from "./crypto.js";

/**
 * Compose the static request headers the Dreame backend expects on every call.
 * Pass `accessToken` after login; omit (or pass `null`) for the unauthenticated
 * login request itself.
 */
export function buildHeaders(opts: {
  region: DreameRegion;
  country: string;
  lang: string;
  accessToken?: string | null;
  contentType?: string;
}): Record<string, string> {
  const auth = opts.accessToken ? `bearer ${opts.accessToken}` : "bearer";
  return {
    "user-agent": APP_USER_AGENT,
    authorization: OAUTH_BASIC_AUTH,
    "content-type": opts.contentType ?? CONTENT_TYPE_FORM,
    "dreame-auth": auth,
    "dreame-meta": APP_META,
    "dreame-rlc": buildRlcHeader(opts.region, opts.lang, opts.country),
    "tenant-id": TENANT_DREAME,
  };
}
