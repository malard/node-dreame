import type { DreameCloudState, DreameDevice, DreameRegion, DreameSession } from "./types.js";
import { httpPostJsonBody, RequestContext, type BaseResponse } from "./http.js";

export interface ListDevicesInput {
  session: DreameSession;
  region: DreameRegion;
  /** Pre-built request context. When supplied, takes precedence over the loose host/country/lang/fetchImpl fields below. */
  ctx?: RequestContext;
  country?: string;
  lang?: string;
  apiHost?: string;
  fetchImpl?: typeof fetch;
  /** Caller-supplied AbortSignal — composed with the HTTP timeout. */
  signal?: AbortSignal;
  /** Per-request timeout override in ms. Pass `0` to disable. */
  timeoutMs?: number;
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
  const ctx = input.ctx ?? RequestContext.from({ ...input, host: input.apiHost });

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
    ...(input.signal !== undefined ? { signal: input.signal } : {}),
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
  });

  const records =
    parsed.data?.page?.records ?? parsed.data?.records ?? parsed.records ?? [];
  return records.map(toDevice);
}

function toDevice(raw: RawDevice): DreameDevice {
  const did = String(raw.did ?? "");
  const model = String(raw.model ?? "");
  const name = String(raw.customName || raw.deviceName || model || did);
  // The cloud response uses two ways to express online: `online: true`
  // OR a nested `property` JSON-string carrying `lwt: 1`. Honour both.
  let lwtFlag = 0;
  if (typeof raw["property"] === "string") {
    try {
      const parsed = JSON.parse(raw["property"] as string) as { lwt?: number };
      if (parsed && typeof parsed.lwt === "number") {
        lwtFlag = parsed.lwt;
      }
    } catch {
      // ignore malformed JSON — fall back to `online`/top-level `lwt`
    }
  }
  const online = raw.online === true || raw.lwt === 1 || lwtFlag === 1;
  const device: DreameDevice = {
    did,
    model,
    name,
    online,
    raw: raw as Record<string, unknown>,
    cloudState: parseCloudState(raw),
  };
  if (raw.mac) {
    device.mac = String(raw.mac);
  }
  if (typeof raw["ver"] === "string") {
    device.firmwareVersion = raw["ver"];
  }
  if (typeof raw["sn"] === "string") {
    device.serialNumber = raw["sn"];
  }
  return device;
}

function parseCloudState(raw: RawDevice): DreameCloudState {
  // `latestStatus` and `battery` come through as numbers at the top
  // level of the list record. `videoStatus` is a JSON-encoded string
  // whose `operation`/`status` fields tell us whether a session is
  // active. `featureCode2` is the numeric capability bitfield.
  const latestStatus = typeof raw["latestStatus"] === "number" ? raw["latestStatus"] : null;
  const battery = typeof raw["battery"] === "number" ? raw["battery"] : null;
  const featureCode2 = typeof raw["featureCode2"] === "number" ? raw["featureCode2"] : null;
  let videoActive: boolean | null = null;
  if (typeof raw["videoStatus"] === "string") {
    try {
      const parsed = JSON.parse(raw["videoStatus"] as string) as {
        operType?: string;
        status?: number;
      };
      // `operType: "end"` means session ended; `status: 1` + `operType: "monitor"`
      // means an active stream. Any non-end / non-zero state counts as active.
      if (parsed?.operType === "end" || parsed?.status === 0) {
        videoActive = false;
      } else if (parsed?.operType || parsed?.status) {
        videoActive = true;
      }
    } catch {
      // ignore malformed JSON
    }
  }
  return { latestStatus, battery, videoActive, featureCode2 };
}
