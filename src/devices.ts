import type { DreameDevice, DreameRegion, DreameSession } from "./types.js";
import { httpPostJsonBody, RequestContext, type BaseResponse } from "./http.js";

export interface ListDevicesInput {
  session: DreameSession;
  region: DreameRegion;
  country?: string;
  lang?: string;
  apiHost?: string;
  fetchImpl?: typeof fetch;
}

interface DeviceListResponse extends BaseResponse {
  data?: {
    page?: { records?: RawDevice[] };
    records?: RawDevice[];
  };
  // Tolerate older response shapes that returned records at the top level.
  records?: RawDevice[];
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
  const ctx = RequestContext.from({ ...input, host: input.apiHost });

  const parsed = await httpPostJsonBody<DeviceListResponse>({
    ctx,
    path: "/dreame-user-iot/iotuserbind/device/listV2",
    accessToken: input.session.accessToken,
    body: {
      sharedStatus: 1,
      current: 1,
      size: 100,
      lang: ctx.lang,
      timestamp: Date.now(),
    },
    context: "device list",
  });

  const records =
    parsed.data?.page?.records ?? parsed.data?.records ?? parsed.records ?? [];
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
