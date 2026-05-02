export type DreameRegion = "eu" | "us" | "cn" | "ru" | "sg" | "in" | "de" | "tw";

export interface DreameClientOptions {
  email: string;
  password: string;
  region?: DreameRegion;
  /** Optional override for the auth host (advanced use). */
  authHost?: string;
  /** Optional override for the API host (advanced use). */
  apiHost?: string;
  /** Logger hook — receives debug-level messages. */
  logger?: (msg: string, meta?: Record<string, unknown>) => void;
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
