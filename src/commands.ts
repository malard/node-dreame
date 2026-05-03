import type { DreameRegion, DreameSession } from "./types.js";
import { COMMAND_FROM_FIELD, IOT_COM_PREFIX_DREAME } from "./config.js";
import { randomRequestId } from "./crypto.js";
import { DreameApiError } from "./errors.js";
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
  /**
   * Pre-built request context. When supplied, takes precedence over the
   * loose `country`/`lang`/`apiHost`/`fetchImpl` fields below — `DreameClient`
   * uses this so it doesn't pay to rebuild a `RequestContext` per call.
   */
  ctx?: RequestContext;
  country?: string;
  lang?: string;
  apiHost?: string;
  /** Brand prefix in the URL (default 10000 = Dreame, 20000 = Mova). */
  iotComPrefix?: number;
  fetchImpl?: typeof fetch;
  /** Caller-supplied AbortSignal — composed with the HTTP timeout. */
  signal?: AbortSignal;
  /** Per-request timeout override in ms. Pass `0` to disable. */
  timeoutMs?: number;
}

/**
 * Low-level dispatch to `/device/sendCommand`. Most callers should use
 * `getProperties`, `setProperties`, or `callAction` instead.
 *
 * Caller is responsible for `params` shape (array for property calls, object
 * for action calls) — see `SendCommandInput.params`.
 */
export async function sendCommand(input: SendCommandInput): Promise<SendCommandResponse> {
  const ctx = input.ctx ?? RequestContext.from({ ...input, host: input.apiHost });
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
    ...(input.signal !== undefined ? { signal: input.signal } : {}),
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
  });
}

interface CommonInput {
  session: DreameSession;
  region: DreameRegion;
  did: string;
  /** Pre-built request context — see `SendCommandInput.ctx`. */
  ctx?: RequestContext;
  country?: string;
  lang?: string;
  apiHost?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface CallOptions {
  /** Caller-supplied AbortSignal — composed with the HTTP timeout. */
  signal?: AbortSignal;
  /** Per-request timeout override in ms. Pass `0` to disable. */
  timeoutMs?: number;
}

/** Read one or more MIoT properties from a device. */
export async function getProperties(
  base: CommonInput,
  props: MiotProp[],
  opts: CallOptions = {},
): Promise<PropertyResult[]> {
  const params = props.map((p) => ({ did: base.did, siid: p.siid, piid: p.piid }));
  const res = await sendCommand({ ...base, ...opts, method: "get_properties", params });
  return extractResultArray(res, "get_properties");
}

/** Write one or more MIoT properties to a device. */
export async function setProperties(
  base: CommonInput,
  writes: PropertyWrite[],
  opts: CallOptions = {},
): Promise<PropertyResult[]> {
  const params = writes.map((p) => ({
    did: base.did,
    siid: p.siid,
    piid: p.piid,
    value: p.value,
  }));
  const res = await sendCommand({ ...base, ...opts, method: "set_properties", params });
  return extractResultArray(res, "set_properties");
}

/**
 * Invoke a single MIoT action on a device.
 *
 * Note: unlike `set_properties`/`get_properties`, the action call's `params`
 * is a single object, NOT an array. Passing an array here would surface as
 * a misleading "device offline" timeout (code 80001) from the Dreame cloud.
 */
export async function callAction(
  base: CommonInput,
  action: MiotAction,
  opts: CallOptions = {},
): Promise<unknown> {
  const params = {
    did: base.did,
    siid: action.siid,
    aiid: action.aiid,
    in: action.in ?? [],
  };
  const res = await sendCommand({ ...base, ...opts, method: "action", params });
  return res.data?.result ?? res.result ?? res;
}

/**
 * Pull the per-property result array out of a sendCommand response.
 * Dreame's response shape is consistent enough to type, but we still tolerate
 * the data being one nesting level shallower (some firmware variants).
 *
 * Throws `DreameApiError` if neither shape is present — silently returning
 * `[]` here masks bugs (e.g. an unexpected response envelope from a future
 * firmware change). Callers can catch and downgrade to `[]` if they want
 * the old behaviour.
 */
function extractResultArray(res: SendCommandResponse, context: string): PropertyResult[] {
  if (Array.isArray(res.data?.result)) {
    return res.data.result as PropertyResult[];
  }
  if (Array.isArray(res.result)) {
    return res.result as PropertyResult[];
  }
  throw new DreameApiError(
    `${context}: response did not contain a result array — ${JSON.stringify(res).slice(0, 200)}`,
    200,
    res,
  );
}
