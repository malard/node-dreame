/**
 * Schedules service (siid 8) — recurring cleaning schedules.
 *
 * VERIFIED on r2532a 2026-05-02. The property at piid 2 is a string. When
 * multiple schedule slots are defined the slots are joined with `;` and each
 * slot is a 9-field dash-delimited string (separator confirmed by Tasshack/
 * dreame-vacuum's parser on older models — node-dreame's own observation
 * captured one slot only).
 *
 * **String format** (per slot, 9 dash-separated fields):
 *
 * ```
 * <id>-<enabled>-<HH:MM>-<weekdays>-<recurring>-<roomScope>-<wetness>-<config>-<rooms>
 *   1     0/1     22:00   1111111    0/1         0/1          0-32     <int>    <list>
 * ```
 *
 * - `id`         numeric schedule slot id (1 in our tests)
 * - `enabled`    0 = paused, 1 = active. Tasshack's parser additionally treats
 *                `2` as enabled and `3` as a "schedule invalid" sentinel; both
 *                values unobserved by node-dreame on r2532a.
 * - `HH:MM`      24h trigger time
 * - `weekdays`   7-char Mon-Sun bitmap, "1" = run, "0" = skip ("1111111" = daily)
 * - `recurring`  0 = one-shot (runs next matching day, then auto-disables), 1 = repeating
 * - `roomScope`  0 = whole map, 1 = specific rooms (Tasshack labels this field
 *                `map_id` — likely a multi-map disambiguation in older firmware
 *                that has been repurposed as a scope flag on r2532a)
 * - `wetness`    0 in non-Mop modes; 1-32 in Mop modes (16 = Standard default)
 * - `config`     mode-dependent — see below
 * - `rooms`      mode-dependent — see below
 *
 * **Bimodal config encoding:**
 *   - **CleanGenius preset** (`config` is small int 128-255):
 *       low byte = `<bit7 always-on>|<quality bits 4-5: 16=Normal,32=Deep>|<mode bits 0-3: 2=Vac+Mop, 4=MopAfterVac>`
 *       `rooms` = comma-separated list of segment IDs (e.g. `"7,4,2,3"`) or `"0"` for whole map
 *   - **Custom mode (global)** (`config` is large packed int):
 *       see `SCHEDULE_FIELD8` for bit layout (route/mode/suction/cycle-count)
 *       `rooms` = "0"
 *   - **Custom mode (per-room)** (`config` = `0`):
 *       `rooms` = comma-separated list of packed ints, ONE PER ROOM, where each int
 *       embeds both the segment ID and that room's per-room settings.
 *       Per-room packed-int layout NOT YET DECODED (see GitHub issue).
 */
export const SCHEDULE_PROP = {
  /**
   * VERIFIED on r2532a — primary cleaning schedule slot. See block doc for format.
   * Writes are committed atomically on the app's "Save" tap (no per-keystroke push).
   */
  SLOT_1: { siid: 8, piid: 2 } as const,
  /** VERIFIED — IANA timezone string (e.g. "Europe/London"). */
  TIMEZONE: { siid: 8, piid: 1 } as const,
  /**
   * VERIFIED on r2532a — small base64-zlib blob; appears to be a binary
   * companion to the schedule string. Decoded contents TBD.
   */
  SCHEDULE_BLOB: { siid: 8, piid: 5 } as const,
  /**
   * VERIFIED on r2532a 2026-05-02 — pulsed `0 → <int> → 0` (~12s) during a
   * mid-job dock-side maintenance window. Value `4` observed; likely a
   * **scheduled-task action trigger** indicator where the int indexes into
   * a list of schedule-driven actions. Other values not yet seen.
   */
  SCHEDULE_ACTION_TRIGGER: { siid: 8, piid: 4 } as const,
} as const;
