import type {
  DreameClientOptions,
  DreameSession,
  DreameDevice,
  DreameRegion,
} from "./types.js";
import { DreameAuthError } from "./errors.js";
import { login, refresh } from "./auth.js";
import { listDevices } from "./devices.js";
import { DreameSubscription } from "./mqtt.js";
import { Vacuum } from "./vacuum.js";
import {
  callAction,
  getProperties,
  setProperties,
  type MiotAction,
  type MiotProp,
  type PropertyResult,
  type PropertyWrite,
} from "./commands.js";
import { RequestContext } from "./http.js";

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
  readonly #ctx: RequestContext;
  #session: DreameSession | null = null;

  constructor(opts: DreameClientOptions) {
    if (!opts.email || !opts.password) {
      throw new DreameAuthError("email and password are required");
    }
    this.#opts = opts;
    this.#ctx = new RequestContext({
      region: opts.region ?? DEFAULT_REGION,
      ...(opts.authHost !== undefined ? { host: opts.authHost } : {}),
    });
  }

  get region(): DreameRegion {
    return this.#ctx.region;
  }

  /** Resolved API host (`<region>.iot.dreame.tech:13267` by default). */
  get apiHost(): string {
    return this.#ctx.host;
  }

  /** Resolved country header value (ISO-3166 alpha-2). */
  get country(): string {
    return this.#ctx.country;
  }

  /** Resolved language header value (ISO-639-1). */
  get lang(): string {
    return this.#ctx.lang;
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
      region: this.#ctx.region,
      country: this.#ctx.country,
      lang: this.#ctx.lang,
      authHost: this.#ctx.host,
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
            region: this.#ctx.region,
            country: this.#ctx.country,
            lang: this.#ctx.lang,
            authHost: this.#ctx.host,
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
      region: this.#ctx.region,
      country: this.#ctx.country,
      lang: this.#ctx.lang,
      apiHost: this.#ctx.host,
    });
    this.#log("getDevices: got list", { count: devices.length });
    return devices;
  }

  /** Read MIoT properties from a device. */
  async getProperties(did: string, props: MiotProp[]): Promise<PropertyResult[]> {
    const session = await this.ensureSession();
    return getProperties(this.#commonInput(did, session), props);
  }

  /** Write MIoT properties on a device. */
  async setProperties(did: string, writes: PropertyWrite[]): Promise<PropertyResult[]> {
    const session = await this.ensureSession();
    return setProperties(this.#commonInput(did, session), writes);
  }

  /** Invoke a MIoT action on a device. */
  async callAction(did: string, action: MiotAction): Promise<unknown> {
    const session = await this.ensureSession();
    return callAction(this.#commonInput(did, session), action);
  }

  /**
   * Subscribe to live property changes from a device over MQTT.
   * Returns an opened subscription — call `.close()` when done.
   */
  async subscribe(device: DreameDevice): Promise<DreameSubscription> {
    const session = await this.ensureSession();
    const sub = new DreameSubscription({ device, session, region: this.#ctx.region });
    await sub.open();
    return sub;
  }

  /** High-level wrapper around a vacuum device. */
  getVacuum(device: DreameDevice): Vacuum {
    return new Vacuum(this, device);
  }

  /** Discard the current session. */
  logout(): void {
    this.#session = null;
  }

  #commonInput(did: string, session: DreameSession) {
    return {
      session,
      region: this.#ctx.region,
      did,
      country: this.#ctx.country,
      lang: this.#ctx.lang,
      apiHost: this.#ctx.host,
    };
  }

  #log(msg: string, meta?: Record<string, unknown>): void {
    this.#opts.logger?.(msg, meta);
  }
}
