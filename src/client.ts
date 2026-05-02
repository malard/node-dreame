import type {
  DreameClientOptions,
  DreameSession,
  DreameDevice,
  DreameRegion,
} from "./types.js";
import { DreameAuthError } from "./errors.js";

const DEFAULT_REGION: DreameRegion = "eu";

/**
 * Top-level client for the Dreame native cloud.
 *
 * Auth flow + transport are being reverse-engineered; this is a skeleton
 * with the public surface in place. Methods will throw `Error("not implemented")`
 * until each is wired up.
 */
export class DreameClient {
  readonly #opts: Required<Pick<DreameClientOptions, "email" | "password">> &
    DreameClientOptions;
  readonly #region: DreameRegion;
  #session: DreameSession | null = null;

  constructor(opts: DreameClientOptions) {
    if (!opts.email || !opts.password) {
      throw new DreameAuthError("email and password are required");
    }
    this.#opts = opts;
    this.#region = opts.region ?? DEFAULT_REGION;
  }

  get region(): DreameRegion {
    return this.#region;
  }

  get session(): DreameSession | null {
    return this.#session;
  }

  /**
   * Authenticate against the Dreame native cloud and stash the session.
   * Returns the session object on success.
   */
  async login(): Promise<DreameSession> {
    throw new Error("not implemented: login");
  }

  /**
   * List devices visible to the authenticated account.
   * Auto-logs-in if no session is present.
   */
  async getDevices(): Promise<DreameDevice[]> {
    throw new Error("not implemented: getDevices");
  }

  /**
   * Discard the current session. Does not call any logout endpoint
   * (the cloud has no per-session revocation we care about).
   */
  logout(): void {
    this.#session = null;
  }
}
