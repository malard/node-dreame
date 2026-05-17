/**
 * Helpers for `Vacuum.refreshFromCloud()` — the HTTP-fallback path
 * that reads cached device state from the cloud's device-list
 * endpoint, useful when `getProperties` is 80001-spinning.
 *
 * Kept separate from `vacuum.ts` so the class file stays focused on
 * MQTT/state orchestration.
 */

import { MiotState } from "../miot-spec.js";
import type { DreameCloudState } from "../types.js";
import type { VacuumState } from "./state.js";

/**
 * Outcome of `Vacuum.refreshFromCloud()`. Discriminated by `kind`.
 *
 *  - `"acked"` — cloud device-list call returned a record for this
 *    device. `state.battery` and `state.miotState` were seeded from
 *    the cached fields. `cloudState` carries the full parsed snapshot.
 *  - `"missing"` — the device-list returned but didn't include this
 *    `did`. The state was not modified. This is unusual; typically
 *    means the device was unbound from the account.
 */
export type CloudRefreshResult =
  | { kind: "acked"; state: VacuumState; cloudState: DreameCloudState }
  | { kind: "missing"; state: VacuumState };

/**
 * Compute the state patch produced by seeding `VacuumState` from a
 * cloud-cached snapshot. Pure: doesn't touch any class state. Returned
 * patch is empty when nothing material would change.
 *
 * `online` is the cloud's per-device online flag (composed from
 * `online: true` and the nested `property.lwt` JSON-encoded field by
 * the device-list parser).
 */
export function buildCloudPatch(
  prev: VacuumState,
  cs: DreameCloudState,
  online: boolean,
): Partial<VacuumState> {
  const patch: Partial<VacuumState> = {};
  if (cs.battery !== null) {
    patch.battery = cs.battery;
  }
  if (cs.latestStatus !== null) {
    patch.miotStateRaw = cs.latestStatus;
    patch.miotState =
      cs.latestStatus in (MiotState as unknown as object)
        ? (cs.latestStatus as MiotState)
        : null;
  }
  if (online !== prev.online) {
    patch.online = online;
  }
  return patch;
}
