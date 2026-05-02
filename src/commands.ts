import type { DreameRegion, DreameSession } from "./types.js";
import { COMMAND_FROM_FIELD, IOT_COM_PREFIX_DREAME } from "./config.js";
import { randomRequestId } from "./crypto.js";
import { httpPostJsonBody, RequestContext, type BaseResponse } from "./http.js";

/** A single MIoT property reference (service + property id). */
export interface MiotProp {
  siid: number;
  piid: number;
}

/** A single MIoT action reference (service + action id). */
export interface MiotAction {
  siid: number;
  aiid: number;
  /** Optional input arguments. */
  in?: unknown[];
}

/** Property write — `MiotProp` plus the value to set. */
export interface PropertyWrite extends MiotProp {
  value: unknown;
}

/** Per-property result returned by the cloud. */
export interface PropertyResult {
  siid: number;
  piid: number;
  value?: unknown;
  code?: number;
  [key: string]: unknown;
}

/** Top-level shape of a `/device/sendCommand` response. */
interface SendCommandResponse extends BaseResponse {
  data?: {
    /** Property reads/writes return their per-property results here as an array. */
    result?: PropertyResult[] | unknown;
    [key: string]: unknown;
  };
  /** Some firmware variants return `result` at the top level instead of inside `data`. */
  result?: PropertyResult[] | unknown;
}

interface SendCommandInput {
  session: DreameSession;
  region: DreameRegion;
  did: string;
  /** MIoT method: `get_properties`, `set_properties`, `action`. */
  method: string;
  /**
   * For `get_properties` / `set_properties`: an array of property descriptors.
   * For `action`: a single object descriptor (NOT wrapped in an array — Dreame
   * surfaces the wrong shape as a misleading code 80001 "device offline" error).
   */
  params: unknown;
  country?: string;
  lang?: string;
  apiHost?: string;
  /** Brand prefix in the URL (default 10000 = Dreame, 20000 = Mova). */
  iotComPrefix?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Low-level dispatch to `/device/sendCommand`. Most callers should use
 * `getProperties`, `setProperties`, or `callAction` instead.
 *
 * Caller is responsible for `params` shape (array for property calls, object
 * for action calls) — see `SendCommandInput.params`.
 */
export async function sendCommand(input: SendCommandInput): Promise<SendCommandResponse> {
  const ctx = new RequestContext({
    region: input.region,
    ...(input.country !== undefined ? { country: input.country } : {}),
    ...(input.lang !== undefined ? { lang: input.lang } : {}),
    ...(input.apiHost !== undefined ? { host: input.apiHost } : {}),
    ...(input.fetchImpl !== undefined ? { fetchImpl: input.fetchImpl } : {}),
  });
  const prefix = input.iotComPrefix ?? IOT_COM_PREFIX_DREAME;
  const id = randomRequestId();

  return httpPostJsonBody<SendCommandResponse>({
    ctx,
    path: `/dreame-iot-com-${prefix}/device/sendCommand`,
    accessToken: input.session.accessToken,
    body: {
      did: input.did,
      id,
      data: {
        did: input.did,
        id,
        method: input.method,
        params: input.params,
        from: COMMAND_FROM_FIELD,
      },
    },
    context: input.method,
  });
}

interface CommonInput {
  session: DreameSession;
  region: DreameRegion;
  did: string;
  country?: string;
  lang?: string;
  apiHost?: string;
  fetchImpl?: typeof fetch;
}

/** Read one or more MIoT properties from a device. */
export async function getProperties(
  base: CommonInput,
  props: MiotProp[],
): Promise<PropertyResult[]> {
  const params = props.map((p) => ({ did: base.did, siid: p.siid, piid: p.piid }));
  const res = await sendCommand({ ...base, method: "get_properties", params });
  return extractResultArray(res);
}

/** Write one or more MIoT properties to a device. */
export async function setProperties(
  base: CommonInput,
  writes: PropertyWrite[],
): Promise<PropertyResult[]> {
  const params = writes.map((p) => ({
    did: base.did,
    siid: p.siid,
    piid: p.piid,
    value: p.value,
  }));
  const res = await sendCommand({ ...base, method: "set_properties", params });
  return extractResultArray(res);
}

/**
 * Invoke a single MIoT action on a device.
 *
 * Note: unlike `set_properties`/`get_properties`, the action call's `params`
 * is a single object, NOT an array. Passing an array here would surface as
 * a misleading "device offline" timeout (code 80001) from the Dreame cloud.
 */
export async function callAction(base: CommonInput, action: MiotAction): Promise<unknown> {
  const params = {
    did: base.did,
    siid: action.siid,
    aiid: action.aiid,
    in: action.in ?? [],
  };
  const res = await sendCommand({ ...base, method: "action", params });
  return res.data?.result ?? res.result ?? res;
}

/**
 * Pull the per-property result array out of a sendCommand response.
 * Dreame's response shape is consistent enough to type, but we still tolerate
 * the data being one nesting level shallower (some firmware variants).
 */
function extractResultArray(res: SendCommandResponse): PropertyResult[] {
  if (Array.isArray(res.data?.result)) {
    return res.data.result as PropertyResult[];
  }
  if (Array.isArray(res.result)) {
    return res.result as PropertyResult[];
  }
  return [];
}
