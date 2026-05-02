import type {
  DreameClientOptions,
  DreameSession,
  DreameDevice,
  DreameRegion,
} from "./types.js";
import { DreameAuthError } from "./errors.js";
import { login, refresh } from "./auth.js";
import { listDevices } from "./devices.js";
import { REGION_DEFAULT_COUNTRY, REGION_DEFAULT_LANG, REGION_HOSTS } from "./config.js";

const DEFAULT_REGION: DreameRegion = "eu";
/** Refresh the access token this many seconds before it expires. */
const REFRESH_LEEWAY_SECS = 100;

/**
 * Top-level client for the Dreame native cloud (Dreamehome backend).
 *
 * ```ts
 * const dreame = new DreameClient({ email, password, region: "eu" });
 * await dreame.login();
 * const devices = await dreame.getDevices();
 * ```
 */
export class DreameClient {
  readonly #opts: DreameClientOptions;
  readonly #region: DreameRegion;
  readonly #country: string;
  readonly #lang: string;
  readonly #authHost: string;
  #session: DreameSession | null = null;

  constructor(opts: DreameClientOptions) {
    if (!opts.email || !opts.password) {
      throw new DreameAuthError("email and password are required");
    }
    this.#opts = opts;
    this.#region = opts.region ?? DEFAULT_REGION;
    this.#country = REGION_DEFAULT_COUNTRY[this.#region];
    this.#lang = REGION_DEFAULT_LANG[this.#region];
    this.#authHost = opts.authHost ?? REGION_HOSTS[this.#region];
  }

  get region(): DreameRegion {
    return this.#region;
  }

  get session(): DreameSession | null {
    return this.#session;
  }

  /**
   * Authenticate against the Dreame cloud and stash the resulting session.
   * Subsequent calls reuse the session unless it has expired (in which case
   * `ensureSession()` will refresh transparently).
   */
  async login(): Promise<DreameSession> {
    this.#log("login: requesting token");
    this.#session = await login({
      email: this.#opts.email,
      password: this.#opts.password,
      region: this.#region,
      country: this.#country,
      lang: this.#lang,
      authHost: this.#authHost,
    });
    this.#log("login: got session", {
      uid: this.#session.uid,
      expiresAt: this.#session.expiresAt,
    });
    return this.#session;
  }

  /**
   * Returns a valid session — logging in or refreshing if necessary.
   * All API calls go through this.
   */
  async ensureSession(): Promise<DreameSession> {
    if (!this.#session) {
      return this.login();
    }
    if (Date.now() >= this.#session.expiresAt - REFRESH_LEEWAY_SECS * 1000) {
      if (this.#session.refreshToken) {
        this.#log("session: refreshing");
        try {
          this.#session = await refresh({
            refreshToken: this.#session.refreshToken,
            region: this.#region,
            country: this.#country,
            lang: this.#lang,
            authHost: this.#authHost,
          });
          return this.#session;
        } catch (err) {
          this.#log("session: refresh failed, falling back to full login", {
            error: String(err),
          });
        }
      }
      return this.login();
    }
    return this.#session;
  }

  /** List devices on the account. Auto-logs-in if needed. */
  async getDevices(): Promise<DreameDevice[]> {
    const session = await this.ensureSession();
    this.#log("getDevices: requesting list");
    const devices = await listDevices({
      session,
      region: this.#region,
      country: this.#country,
      lang: this.#lang,
      apiHost: this.#authHost,
    });
    this.#log("getDevices: got list", { count: devices.length });
    return devices;
  }

  /** Discard the current session. */
  logout(): void {
    this.#session = null;
  }

  #log(msg: string, meta?: Record<string, unknown>): void {
    if (this.#opts.logger) {
      if (meta !== undefined) {
        this.#opts.logger(msg, meta);
      } else {
        this.#opts.logger(msg);
      }
    }
  }
}
