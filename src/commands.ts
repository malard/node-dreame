import type { DreameRegion, DreameSession } from "./types.js";
import { DreameApiError, DreameTransportError } from "./errors.js";
import { buildHeaders } from "./auth.js";
import { REGION_DEFAULT_COUNTRY, REGION_DEFAULT_LANG, REGION_HOSTS } from "./config.js";
import { randomRequestId } from "./crypto.js";

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

interface SendCommandInput {
  session: DreameSession;
  region: DreameRegion;
  did: string;
  method: string;
  params: unknown[];
  country?: string;
  lang?: string;
  apiHost?: string;
  /** Brand prefix in the URL: 10000 = Dreame, 20000 = Mova. */
  iotComPrefix?: number;
}

interface SendCommandResponse {
  code?: number;
  msg?: string;
  data?: {
    result?: unknown;
    [key: string]: unknown;
  };
  result?: unknown;
  [key: string]: unknown;
}

/**
 * Low-level dispatch to /device/sendCommand.
 * Most callers should use `getProperties`, `setProperties`, or `callAction` instead.
 */
export async function sendCommand(input: SendCommandInput): Promise<SendCommandResponse> {
  const country = input.country ?? REGION_DEFAULT_COUNTRY[input.region];
  const lang = input.lang ?? REGION_DEFAULT_LANG[input.region];
  const host = input.apiHost ?? REGION_HOSTS[input.region];
  const prefix = input.iotComPrefix ?? 10000;
  const id = randomRequestId();

  const url = `https://${host}/dreame-iot-com-${prefix}/device/sendCommand`;
  const headers = buildHeaders({
    region: input.region,
    country,
    lang,
    accessToken: input.session.accessToken,
    contentType: "application/json",
  });
  const body = JSON.stringify({
    did: input.did,
    id,
    data: {
      did: input.did,
      id,
      method: input.method,
      params: input.params,
      from: "XXXXXX",
    },
  });

  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers, body });
  } catch (err) {
    throw new DreameTransportError(`network error contacting ${url}`, err);
  }

  const text = await res.text();
  let parsed: SendCommandResponse | null = null;
  try {
    parsed = text ? (JSON.parse(text) as SendCommandResponse) : null;
  } catch {
    // fallthrough
  }

  if (!res.ok) {
    throw new DreameApiError(
      `sendCommand failed: ${res.status} ${text.slice(0, 200)}`,
      res.status,
      parsed,
    );
  }
  if (!parsed) {
    throw new DreameApiError(
      `sendCommand response was not JSON (status ${res.status})`,
      res.status,
    );
  }
  if (parsed.code !== undefined && parsed.code !== 0) {
    // 80001 is the documented timeout code; surface it but as a typed error.
    throw new DreameApiError(
      `sendCommand rejected: code=${parsed.code} msg=${parsed.msg ?? "?"}`,
      res.status,
      parsed,
    );
  }
  return parsed;
}

interface CommonInput {
  session: DreameSession;
  region: DreameRegion;
  did: string;
  country?: string;
  lang?: string;
  apiHost?: string;
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
  // Bypass sendCommand's array-shaped helper since action params is an object.
  return sendActionCommand({ ...base, action });
}

async function sendActionCommand(input: CommonInput & { action: MiotAction }): Promise<unknown> {
  const country = input.country ?? REGION_DEFAULT_COUNTRY[input.region];
  const lang = input.lang ?? REGION_DEFAULT_LANG[input.region];
  const host = input.apiHost ?? REGION_HOSTS[input.region];
  const id = randomRequestId();
  const url = `https://${host}/dreame-iot-com-10000/device/sendCommand`;
  const headers = buildHeaders({
    region: input.region,
    country,
    lang,
    accessToken: input.session.accessToken,
    contentType: "application/json",
  });
  const body = JSON.stringify({
    did: input.did,
    id,
    data: {
      did: input.did,
      id,
      method: "action",
      params: {
        did: input.did,
        siid: input.action.siid,
        aiid: input.action.aiid,
        in: input.action.in ?? [],
      },
      from: "XXXXXX",
    },
  });

  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers, body });
  } catch (err) {
    throw new DreameTransportError(`network error contacting ${url}`, err);
  }

  const text = await res.text();
  let parsed: SendCommandResponse | null = null;
  try {
    parsed = text ? (JSON.parse(text) as SendCommandResponse) : null;
  } catch {
    // fallthrough
  }
  if (!res.ok) {
    throw new DreameApiError(
      `action failed: ${res.status} ${text.slice(0, 200)}`,
      res.status,
      parsed,
    );
  }
  if (!parsed) {
    throw new DreameApiError(
      `action response was not JSON (status ${res.status})`,
      res.status,
    );
  }
  if (parsed.code !== undefined && parsed.code !== 0) {
    throw new DreameApiError(
      `action rejected: code=${parsed.code} msg=${parsed.msg ?? "?"}`,
      res.status,
      parsed,
    );
  }
  return parsed.data?.result ?? parsed.result ?? parsed;
}

function extractResultArray(res: SendCommandResponse): PropertyResult[] {
  const candidate =
    (res.data?.result as unknown) ??
    (res.result as unknown) ??
    (res.data as unknown);
  if (Array.isArray(candidate)) {
    return candidate as PropertyResult[];
  }
  return [];
}
