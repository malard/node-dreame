import type { DreameRegion, DreameSession } from "./types.js";
import { DreameAuthError } from "./errors.js";
import {
  APP_META,
  APP_USER_AGENT,
  CONTENT_TYPE_FORM,
  OAUTH_BASIC_AUTH,
  TENANT_DREAME,
} from "./config.js";
import { buildRlcHeader, hashPassword } from "./crypto.js";
import { httpPostJson, RequestContext, type BaseResponse } from "./http.js";

export interface LoginInput {
  email: string;
  password: string;
  region: DreameRegion;
  /** ISO-3166 alpha-2. Defaults from region. */
  country?: string;
  /** ISO-639-1. Defaults from region. */
  lang?: string;
  /** Override host (advanced — for testing). */
  authHost?: string;
  /** Inject a fetch impl for testing. */
  fetchImpl?: typeof fetch;
}

export interface RefreshInput {
  refreshToken: string;
  region: DreameRegion;
  country?: string;
  lang?: string;
  authHost?: string;
  fetchImpl?: typeof fetch;
}

interface OAuthTokenResponse extends BaseResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  uid?: string | number;
  region?: string;
  country?: string;
  lang?: string;
  tenant_id?: string;
  // OAuth-style errors are at top level rather than the API's `code`/`msg`.
  error?: string;
  error_description?: string;
  // Loose — Dreame can add fields without breaking us.
  [key: string]: unknown;
}

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

function ctxFromInput(input: { region: DreameRegion; country?: string; lang?: string; authHost?: string; fetchImpl?: typeof fetch }): RequestContext {
  return RequestContext.from({ ...input, host: input.authHost });
}

/**
 * Authenticate against the Dreame native cloud and return a session.
 * Uses OAuth2 password grant with the app's static client credentials.
 */
export async function login(input: LoginInput): Promise<DreameSession> {
  const ctx = ctxFromInput(input);
  const body = new URLSearchParams({
    grant_type: "password",
    scope: "all",
    platform: "IOS",
    type: "account",
    username: input.email,
    password: hashPassword(input.password),
    country: ctx.country,
    lang: ctx.lang,
  });
  return postForToken(ctx, body);
}

/**
 * Exchange a refresh token for a fresh access token.
 * Refresh tokens are long-lived; access tokens expire after `expires_in` seconds
 * (typically 7200). Refresh ~100s before expiry to be safe.
 */
export async function refresh(input: RefreshInput): Promise<DreameSession> {
  const ctx = ctxFromInput(input);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  });
  return postForToken(ctx, body);
}

async function postForToken(ctx: RequestContext, body: URLSearchParams): Promise<DreameSession> {
  const data = await httpPostJson<OAuthTokenResponse>({
    ctx,
    url: ctx.url("/dreame-auth/oauth/token"),
    headers: ctx.headers(),
    body,
    context: "auth",
    errorClass: DreameAuthError,
    skipCodeCheck: true, // OAuth uses HTTP status + top-level error fields, not parsed.code
  });

  // Surface OAuth-style top-level error responses if HTTP was 200 but body says otherwise.
  if (data.error || data.error_description) {
    throw new DreameAuthError(
      `auth failed: ${data.error ?? "?"} — ${data.error_description ?? "no description"}`,
    );
  }

  if (!data.access_token || typeof data.access_token !== "string") {
    throw new DreameAuthError(
      `auth response missing access_token: ${JSON.stringify(data).slice(0, 200)}`,
    );
  }

  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 7200;
  const uid = data.uid !== undefined ? String(data.uid) : "";
  if (!uid) {
    throw new DreameAuthError("auth response missing uid");
  }
  const session: DreameSession = {
    accessToken: data.access_token,
    uid,
    expiresAt: Date.now() + expiresIn * 1000,
    region: ctx.region,
  };
  if (typeof data.refresh_token === "string") {
    session.refreshToken = data.refresh_token;
  }
  return session;
}
