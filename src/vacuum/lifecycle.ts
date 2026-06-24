/**
 * Lifecycle event types + abort-reason mapping for `Vacuum`.
 *
 * Pulled out of `vacuum.ts` so the class file stays focused on
 * orchestration. The detection logic itself still lives on `Vacuum`
 * (it mutates per-instance arming state) — only the pure types,
 * constants, and label helper live here.
 */

import { MiotError } from "../miot-spec.js";
import type { CleaningHistoryRecord } from "./task-complete.js";

/**
 * Cleaning-job lifecycle envelope. One event for everything a
 * notification-style consumer typically cares about: did a job just
 * start, did it finish, or did it get refused / aborted (with reason).
 *
 * Detection rules:
 *
 * - `started` — `TASK_STATUS` (siid 4 piid 1) transitions to `2`
 *   (active task running) from any other value.
 * - `completed` — fires alongside `taskComplete`, carrying the same
 *   parsed `CleaningHistoryRecord`. Driven by the
 *   `event_occured siid 4 eiid 1` push.
 * - `aborted` — `errorCode` (siid 2 piid 2) transitions to a non-zero
 *   value that is NOT the benign end-of-task code `MiotError.TaskComplete`
 *   (68). Covers both "refused to start" (e.g. empty clean-water tank →
 *   code 107) and mid-task failure (e.g. robot lifted → code 18). The
 *   v0.4 detector also fires when our subscription joins while the
 *   device is *already* latched in an error state (so a consumer that
 *   subscribes mid-incident still hears about it); these carry
 *   `inferred: "initial-state"`.
 * - `aborted` with `reason: "disappeared"` — the active task was
 *   running (`taskStatusRaw === 2`) and the MQTT subscription dropped
 *   without a clean completion or explicit error. Inferred at the
 *   moment of disconnect, carries `inferred: "mqtt-disconnect"`.
 *
 * `reason` is a kebab-case label derived from `MiotError` when the
 * code is known, or `"error-<n>"` for raw codes pending cataloguing,
 * or one of the dedicated string reasons (`"disappeared"`).
 *
 * `inferred` is present on aborts the library deduced from
 * surrounding signals rather than from a direct `errorCode` transition:
 *
 *   - `"initial-state"` — first observation of an already-latched
 *     error after subscribing. The errorCode/faults reflect what the
 *     device was already in when we joined.
 *   - `"mqtt-disconnect"` — connection dropped during an active task.
 *     `errorCode` will be `0` (Clear) because no explicit fault
 *     transition occurred — the abort is inferred from the disconnect.
 */
export type TaskLifecycle =
  | { phase: "started"; at: Date }
  | { phase: "completed"; at: Date; record: CleaningHistoryRecord }
  | {
      phase: "aborted";
      at: Date;
      errorCode: number;
      reason: string;
      faults: readonly number[];
      inferred?: "initial-state" | "mqtt-disconnect";
    };

/**
 * Battery-level lifecycle envelope. Debounced threshold crossings on
 * the battery percentage — designed for consumers (dunbar-os, push-
 * notification gateways) that want to alert on "battery getting low"
 * without polling the raw number themselves.
 *
 * Phases (raise on first crossing into the band, suppress while still
 * inside it, re-arm once battery climbs back above the next band up):
 *
 *   - `low` — battery dropped below 20% while not charging.
 *   - `critical` — battery dropped below 10% while not charging.
 *   - `depleted` — battery reached `0` OR the device went offline
 *     while battery was already in `critical`. This is the closest
 *     signal we can give to "robot powered itself off because the
 *     battery ran out mid-job."
 *   - `recovered` — battery climbed back above 25% (clears `low`
 *     and `critical` arming). Always fires before a fresh `low`.
 */
export type BatteryLifecycle =
  | { phase: "low"; at: Date; battery: number }
  | { phase: "critical"; at: Date; battery: number }
  | { phase: "depleted"; at: Date; battery: number | null; cause: "zero" | "offline-while-critical" }
  | { phase: "recovered"; at: Date; battery: number };

/**
 * `MiotError` code → kebab-case `reason` label used by the
 * `aborted` payload. Codes not present in the table fall through to
 * `error-<n>` via {@link abortReason}.
 */
export const ABORT_REASONS: Record<number, string> = {
  [MiotError.WheelRotationAnomaly]: "wheel-rotation-anomaly",
  [MiotError.RobotLifted]: "robot-lifted",
  [MiotError.ManualMopInstallRequired]: "manual-mop-install-required",
  [MiotError.MopPadsMissing]: "mop-pads-missing",
  [MiotError.WastewaterTankFull]: "wastewater-tank-full",
  [MiotError.CleanWaterTankEmpty]: "clean-water-tank-empty",
  [MiotError.WashboardFilterNeedsCleaning]: "washboard-filter-needs-cleaning",
  [MiotError.BatteryLow]: "battery-low",
  [MiotError.ChargeFault]: "charge-fault",
  [MiotError.BatteryPercentageAnomaly]: "battery-percentage-anomaly",
  [MiotError.ChargeNoElectric]: "charge-no-electric",
  [MiotError.BatteryFault]: "battery-fault",
  [MiotError.LowBatteryTurnOff]: "low-battery-turn-off",
  [MiotError.RobotStuck]: "robot-stuck",
  [MiotError.RobotStuckRepeat]: "robot-stuck-repeat",
  [MiotError.RobotStuck2]: "robot-stuck",
  [MiotError.RobotStuckOnTables]: "robot-stuck-on-tables",
  [MiotError.RobotStuckOnPassage]: "robot-stuck-on-passage",
  [MiotError.RobotStuckOnThreshold]: "robot-stuck-on-threshold",
  [MiotError.RobotStuckOnLowLyingArea]: "robot-stuck-on-low-lying-area",
  [MiotError.RobotStuckOnRamp]: "robot-stuck-on-ramp",
  [MiotError.RobotStuckOnObstacle]: "robot-stuck-on-obstacle",
  [MiotError.RobotStuckOnPet]: "robot-stuck-on-pet",
  [MiotError.RobotStuckOnSlipperySurface]: "robot-stuck-on-slippery-surface",
  [MiotError.RobotStuckOnCarpet]: "robot-stuck-on-carpet",
  [MiotError.RobotStuckOnCurtain]: "robot-stuck-on-curtain",
  [MiotError.BinFull]: "bin-full",
  [MiotError.StationDisconnected]: "station-disconnected",
  [MiotError.DustBagFull]: "dust-bag-full",
  [MiotError.Route2]: "route-2",
  [MiotError.Route]: "route",
  [MiotError.NoGoZone]: "no-go-zone",
  [MiotError.Ultrasonic]: "ultrasonic",
  [MiotError.Blocked]: "blocked",
  [MiotError.Blocked2]: "blocked-2",
  [MiotError.Blocked3]: "blocked-3",
  [MiotError.Restricted]: "restricted",
};

/**
 * Resolve a numeric MIoT error code to its kebab-case lifecycle
 * `reason` label. Unknown codes get an `error-<n>` placeholder so
 * downstream consumers can still pattern-match on the string.
 */
export function abortReason(code: number): string {
  return ABORT_REASONS[code] ?? `error-${code}`;
}

/** Battery thresholds. Hysteresis on the recovered edge avoids flapping. */
export const BATTERY_LOW_THRESHOLD = 20;
export const BATTERY_CRITICAL_THRESHOLD = 10;
export const BATTERY_RECOVERED_THRESHOLD = 25;
