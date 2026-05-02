import type { DreameDevice, DreameRegion, DreameSession } from "./types.js";
import { DreameApiError, DreameTransportError } from "./errors.js";
import { buildHeaders } from "./auth.js";
import { REGION_DEFAULT_COUNTRY, REGION_DEFAULT_LANG, REGION_HOSTS } from "./config.js";

export interface ListDevicesInput {
  session: DreameSession;
  region: DreameRegion;
  country?: string;
  lang?: string;
  apiHost?: string;
}

interface DeviceListResponse {
  code?: number;
  msg?: string;
  data?: {
    page?: {
      records?: RawDevice[];
    };
    records?: RawDevice[];
  };
  // Tolerate older response shapes that returned records at the top level.
  records?: RawDevice[];
  [key: string]: unknown;
}

interface RawDevice {
  did?: string;
  model?: string;
  customName?: string;
  deviceName?: string;
  mac?: string;
  online?: boolean;
  lwt?: number;
  bindDomain?: string;
  master?: boolean;
  [key: string]: unknown;
}

/**
 * Enumerate the devices visible to the authenticated account.
 * Returns one entry per bound device, including shared (non-master) devices.
 */
export async function listDevices(input: ListDevicesInput): Promise<DreameDevice[]> {
  const country = input.country ?? REGION_DEFAULT_COUNTRY[input.region];
  const lang = input.lang ?? REGION_DEFAULT_LANG[input.region];
  const host = input.apiHost ?? REGION_HOSTS[input.region];

  const url = `https://${host}/dreame-user-iot/iotuserbind/device/listV2`;
  const headers = buildHeaders({
    region: input.region,
    country,
    lang,
    accessToken: input.session.accessToken,
    contentType: "application/json",
  });
  const body = JSON.stringify({
    sharedStatus: 1,
    current: 1,
    size: 100,
    lang,
    timestamp: Date.now(),
  });

  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers, body });
  } catch (err) {
    throw new DreameTransportError(`network error contacting ${url}`, err);
  }

  const text = await res.text();
  let parsed: DeviceListResponse | null = null;
  try {
    parsed = text ? (JSON.parse(text) as DeviceListResponse) : null;
  } catch {
    // fallthrough — handled below
  }

  if (!res.ok) {
    throw new DreameApiError(
      `device list failed: ${res.status} ${text.slice(0, 200)}`,
      res.status,
      parsed,
    );
  }
  if (!parsed) {
    throw new DreameApiError(
      `device list response was not JSON (status ${res.status})`,
      res.status,
    );
  }
  if (parsed.code !== undefined && parsed.code !== 0) {
    throw new DreameApiError(
      `device list rejected: code=${parsed.code} msg=${parsed.msg ?? "?"}`,
      res.status,
      parsed,
    );
  }

  const records = parsed.data?.page?.records ?? parsed.data?.records ?? parsed.records ?? [];
  return records.map(toDevice);
}

function toDevice(raw: RawDevice): DreameDevice {
  const did = String(raw.did ?? "");
  const model = String(raw.model ?? "");
  const name = String(raw.customName || raw.deviceName || model || did);
  const online = raw.online === true || raw.lwt === 1;
  const device: DreameDevice = {
    did,
    model,
    name,
    online,
    raw: raw as Record<string, unknown>,
  };
  if (raw.mac) {
    device.mac = String(raw.mac);
  }
  return device;
}
