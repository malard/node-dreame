import type { DreameRegion, DreameSession } from "./types.js";
import { DreameAuthError, DreameTransportError } from "./errors.js";
import {
  APP_META,
  APP_USER_AGENT,
  OAUTH_BASIC_AUTH,
  REGION_DEFAULT_COUNTRY,
  REGION_DEFAULT_LANG,
  REGION_HOSTS,
  TENANT_DREAME,
} from "./config.js";
import { buildRlcHeader, hashPassword } from "./crypto.js";

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
}

export interface RefreshInput {
  refreshToken: string;
  region: DreameRegion;
  country?: string;
  lang?: string;
  authHost?: string;
}

interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  uid?: string | number;
  region?: string;
  country?: string;
  lang?: string;
  tenant_id?: string;
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
    "content-type": opts.contentType ?? "application/x-www-form-urlencoded",
    "dreame-auth": auth,
    "dreame-meta": APP_META,
    "dreame-rlc": buildRlcHeader(opts.region, opts.lang, opts.country),
    "tenant-id": TENANT_DREAME,
  };
}

/**
 * Authenticate against the Dreame native cloud and return a session.
 * Uses OAuth2 password grant with the app's static client credentials.
 */
export async function login(input: LoginInput): Promise<DreameSession> {
  const country = input.country ?? REGION_DEFAULT_COUNTRY[input.region];
  const lang = input.lang ?? REGION_DEFAULT_LANG[input.region];
  const host = input.authHost ?? REGION_HOSTS[input.region];

  const body = new URLSearchParams({
    grant_type: "password",
    scope: "all",
    platform: "IOS",
    type: "account",
    username: input.email,
    password: hashPassword(input.password),
    country,
    lang,
  });

  const url = `https://${host}/dreame-auth/oauth/token`;
  const headers = buildHeaders({ region: input.region, country, lang });

  const data = await postForToken(url, headers, body);
  return toSession(data, input.region);
}

/**
 * Exchange a refresh token for a fresh access token.
 * Refresh tokens are long-lived; access tokens expire after `expires_in` seconds
 * (typically 7200). Refresh ~100s before expiry to be safe.
 */
export async function refresh(input: RefreshInput): Promise<DreameSession> {
  const country = input.country ?? REGION_DEFAULT_COUNTRY[input.region];
  const lang = input.lang ?? REGION_DEFAULT_LANG[input.region];
  const host = input.authHost ?? REGION_HOSTS[input.region];

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  });

  const url = `https://${host}/dreame-auth/oauth/token`;
  const headers = buildHeaders({ region: input.region, country, lang });

  const data = await postForToken(url, headers, body);
  return toSession(data, input.region);
}

async function postForToken(
  url: string,
  headers: Record<string, string>,
  body: URLSearchParams,
): Promise<OAuthTokenResponse> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers, body });
  } catch (err) {
    throw new DreameTransportError(`network error contacting ${url}`, err);
  }

  let parsed: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // leave as text
    }
  }

  if (!res.ok) {
    const msg = describeAuthError(parsed, text, res.status);
    throw new DreameAuthError(msg, res.status);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new DreameAuthError(`auth response was not JSON (status ${res.status})`);
  }

  const data = parsed as OAuthTokenResponse;
  if (!data.access_token || typeof data.access_token !== "string") {
    throw new DreameAuthError(
      `auth response missing access_token: ${JSON.stringify(data).slice(0, 200)}`,
    );
  }

  return data;
}

function describeAuthError(parsed: unknown, raw: string, status: number): string {
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const code = obj["error"] ?? obj["code"];
    const desc = obj["error_description"] ?? obj["msg"] ?? obj["message"];
    if (code || desc) {
      return `auth failed (${status}): ${code ?? "?"} — ${desc ?? "no description"}`;
    }
  }
  return `auth failed (${status}): ${raw.slice(0, 200)}`;
}

function toSession(data: OAuthTokenResponse, region: DreameRegion): DreameSession {
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 7200;
  const uid = data.uid !== undefined ? String(data.uid) : "";
  if (!uid) {
    throw new DreameAuthError("auth response missing uid");
  }
  const session: DreameSession = {
    accessToken: data.access_token,
    uid,
    expiresAt: Date.now() + expiresIn * 1000,
    region,
  };
  if (typeof data.refresh_token === "string") {
    session.refreshToken = data.refresh_token;
  }
  return session;
}
