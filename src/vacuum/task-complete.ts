/**
 * Per-task summary parser.
 *
 * Decodes the `event_occured siid 4 eiid 1` MIoT event into a typed
 * `CleaningHistoryRecord`. The Vacuum class re-emits successful parses
 * as `'taskComplete'`.
 */

import type { EventOccuredPush } from "../mqtt.js";

/**
 * Per-task summary record extracted from the `event_occured siid 4
 * eiid 1` push the device fires at end-of-task.
 *
 * VERIFIED on r2532a 2026-05-03: Dreame native does NOT expose the
 * per-task fields as readable properties; they're only available
 * here as event arguments. `Vacuum` listens for the event on the
 * underlying `DreameSubscription` and emits a `'taskComplete'` event
 * with this record.
 */
export interface CleaningHistoryRecord {
  /** Task start time as a `Date` (parsed from unix epoch seconds). */
  startTime: Date;
  /** Cleaning runtime for this task in minutes. */
  cleaningTimeMin: number;
  /** Area cleaned during this task in square metres. */
  cleanedAreaSqm: number;
  /**
   * Completion status — `true` if the device flagged the task as a
   * clean success (`CLEAN_LOG_STATUS == 1`); `false` otherwise.
   */
  completed: boolean;
  /** Final value of the device's STATUS property at task end. */
  finalStatus: number;
  /** Water-tank state code at task end (raw `WATER_TANK` int). */
  waterTank: number | null;
  /**
   * OSS object name pointing at the per-task cleaned-area map.
   * Format: `ali_dreame/<YYYY>/<MM>/<DD>/<uid>/<did>_<taskId>.<fwBuild>.bin`.
   * Fetch via the existing OSS download endpoint.
   */
  logFileName: string | null;
  /**
   * Cleaning-properties JSON echoed from the original START_CUSTOM
   * request (or the device's own scheduling defaults). Shape varies;
   * keys observed include `cleaningTime`, `customeClean`, `mooClean`,
   * `pet`, `cmc`, `ismultiple`, `ctyo`, `multime`. Surfaced as the
   * raw object — consumers decode keys they care about.
   */
  cleaningProperties: Record<string, unknown> | null;
  /** Raw event arguments, in case the consumer needs untouched data. */
  raw: unknown;
}

/**
 * Decode the `event_occured siid 4 eiid 1` payload into a typed
 * `CleaningHistoryRecord`. Returns `null` if the event doesn't carry
 * the expected per-task fields (start time and area at minimum).
 *
 * Argument layout verified live on r2532a 2026-05-03:
 *   {piid 1}  STATUS final value
 *   {piid 2}  CLEANING_TIME (minutes)
 *   {piid 3}  CLEANED_AREA (m²)
 *   {piid 6}  WATER_TANK
 *   {piid 8}  CLEANING_START_TIME (unix epoch seconds)
 *   {piid 9}  CLEAN_LOG_FILE_NAME (OSS object path)
 *   {piid 10} CLEANING_PROPERTIES (compact JSON string)
 *   {piid 13} CLEAN_LOG_STATUS (1 = success)
 */
export function parseTaskCompleteEvent(ev: EventOccuredPush): CleaningHistoryRecord | null {
  if (ev.siid !== 4 || ev.eiid !== 1) {
    return null;
  }
  const args = new Map<number, unknown>();
  for (const arg of ev.arguments) {
    if (arg && typeof arg === "object" && "piid" in arg && "value" in arg) {
      const piid = (arg as { piid: unknown }).piid;
      if (typeof piid === "number") {
        args.set(piid, (arg as { value: unknown }).value);
      }
    }
  }
  const startEpoch = args.get(8);
  const cleaningTimeMin = args.get(2);
  const cleanedAreaSqm = args.get(3);
  if (typeof startEpoch !== "number" || typeof cleaningTimeMin !== "number" || typeof cleanedAreaSqm !== "number") {
    return null;
  }
  const finalStatus = args.get(1);
  const completedRaw = args.get(13);
  const waterTank = args.get(6);
  const logFileName = args.get(9);
  const cleaningPropertiesRaw = args.get(10);
  let cleaningProperties: Record<string, unknown> | null = null;
  if (typeof cleaningPropertiesRaw === "string" && cleaningPropertiesRaw.length > 0) {
    try {
      cleaningProperties = JSON.parse(cleaningPropertiesRaw) as Record<string, unknown>;
    } catch {
      cleaningProperties = null;
    }
  }
  return {
    startTime: new Date(startEpoch * 1000),
    cleaningTimeMin,
    cleanedAreaSqm,
    completed: completedRaw === 1,
    finalStatus: typeof finalStatus === "number" ? finalStatus : 0,
    waterTank: typeof waterTank === "number" ? waterTank : null,
    logFileName: typeof logFileName === "string" ? logFileName : null,
    cleaningProperties,
    raw: ev.arguments,
  };
}
