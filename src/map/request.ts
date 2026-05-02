/**
 * Map request helpers — actively pull a fresh frame from the device
 * instead of waiting for it to push one.
 *
 * The device only emits an I-frame at session start or on a `map_id`
 * change; for a long-running connection, requesting one explicitly is
 * the only way to get a current snapshot. Tasshack uses this to detect
 * staleness (`>15s` since last push) and to recover from missed P-frames.
 */

import type { DreameClient } from "../client.js";
import { CLOUD_OBJ_PROP, MAP_ACTION } from "../miot-spec.js";

export interface RequestIFrameOptions {
  /**
   * Force the device to push a fresh I-frame even if it thinks the
   * client is already in sync. Default `true` — use `false` only if you
   * specifically want a no-op when the client state is current.
   */
  force?: boolean;
  /**
   * Optional `start_time` field (epoch seconds). Tasshack adds this
   * when recovering after a known disconnect — the device replays from
   * the timestamp. Omit to request "current state".
   */
  startTime?: number;
}

export interface RequestPFrameOptions {
  /** The map id to fill. */
  mapId: number;
  /** The next expected frame id. */
  frameId: number;
}

/**
 * Ask the device to push a fresh I-frame on the live `MAP_DATA` channel
 * (siid 6 piid 1). Returns when the cloud has acknowledged the action;
 * the actual frame arrives later via the existing MQTT subscription.
 *
 * Resolves to the cloud's raw action result (typically `{ code: 0 }`).
 */
export async function requestIFrame(
  client: DreameClient,
  did: string,
  opts: RequestIFrameOptions = {},
): Promise<unknown> {
  const force = opts.force ?? true;
  const payload: Record<string, unknown> = {
    req_type: 1,
    frame_type: "I",
  };
  if (force) {
    payload["force_type"] = 1;
  }
  if (opts.startTime !== undefined) {
    payload["time"] = opts.startTime;
  }
  return client.callAction(did, {
    ...MAP_ACTION.REQUEST_MAP,
    in: [{ piid: CLOUD_OBJ_PROP.FRAME_INFO.piid, value: JSON.stringify(payload) }],
  });
}

/**
 * Ask the device to re-send a specific P-frame by `(map_id, frame_id)`.
 * Use this when the local frame chain has a gap (Phase 2 will call this
 * automatically when `OutOfOrderFrameError` fires repeatedly).
 */
export async function requestPFrame(
  client: DreameClient,
  did: string,
  opts: RequestPFrameOptions,
): Promise<unknown> {
  const payload = JSON.stringify({
    req_type: 1,
    frame_type: "P",
    map_id: opts.mapId,
    frame_id: opts.frameId,
  });
  return client.callAction(did, {
    ...MAP_ACTION.REQUEST_MAP,
    in: [{ piid: CLOUD_OBJ_PROP.FRAME_INFO.piid, value: payload }],
  });
}
