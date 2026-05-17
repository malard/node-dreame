/** Settings service properties (DND, voice, timezone, off-peak charging). */
export const SETTINGS_PROP = {
  /** ASSUMED Tasshack types.py — DND master toggle (boolean). The structured form lives at `DND_CONFIG_JSON`. */
  DND: { siid: 5, piid: 1 } as const,
  /**
   * VERIFIED on r2532a 2026-05-02 — DND windows as a JSON-string array.
   * Each entry: `{id, en: bool, st: "HH:MM", et: "HH:MM", wk: <weekday-bitmap>, ss: 0}`
   * where `wk` is the same 7-bit Mon-Sun bitmap as the cleaning schedule
   * (decimal `127` = all days). Multiple windows possible; only one slot
   * observed on test device.
   *
   * (Earlier versions of this file misplaced this constant at siid 3 piid 3
   * — that location is actually `OFF_PEAK_CHARGING_CONFIG_JSON`, which has
   * a different shape. Corrected 2026-05-02 by direct observation.)
   */
  DND_CONFIG_JSON: { siid: 5, piid: 4 } as const,
  /**
   * VERIFIED on r2532a 2026-05-02 — Off-Peak Charging window as a JSON-string.
   * Shape: `{enable: bool, startTime: "HH:MM", endTime: "HH:MM"}`.
   * Lives on the battery service (siid 3) — the dock prefers to charge
   * during this window for time-of-use electricity tariffs.
   */
  OFF_PEAK_CHARGING_CONFIG_JSON: { siid: 3, piid: 3 } as const,
  /** ASSUMED Tasshack types.py:642 — voice volume 0-100. VERIFIED returned 90 on r2532a (plausible). */
  VOLUME: { siid: 7, piid: 1 } as const,
  /** VERIFIED on r2532a: returns "Europe/London" — IANA timezone string. */
  TIMEZONE: { siid: 8, piid: 1 } as const,
} as const;
