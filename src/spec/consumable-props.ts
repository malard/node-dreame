/**
 * Consumables.
 *
 * **Unit convention varies by consumable** — Dreame doesn't keep the same
 * piid layout across services. Numbers below are the conventions verified
 * on r2532a (X50 Ultra Complete) firmware 4.3.9_2199:
 *
 * |           | piid 1       | piid 2       | piid 3 |
 * |-----------|--------------|--------------|--------|
 * | brush 9   | hours-left   | **% left**   | flag=1 |
 * | brush 10  | hours-left   | **% left**   | flag=1 |
 * | filter 11 | **% left**   | hours-left   | flag=1 |
 * | sensor 16 | hours-left   | **days-left** | flag=1 |
 *
 * Whichever counter hits zero first triggers the in-app maintenance
 * notification. Reset action for each is at `siid <X> aiid 1`.
 */
export const CONSUMABLE_PROP = {
  /** VERIFIED on r2532a — hours of operation remaining before next service. */
  MAIN_BRUSH_TIME_LEFT: { siid: 9, piid: 1 } as const,
  /** VERIFIED on r2532a — % of life remaining (returned 65 in field). */
  MAIN_BRUSH_LEFT: { siid: 9, piid: 2 } as const,
  /** VERIFIED on r2532a — hours of operation remaining. */
  SIDE_BRUSH_TIME_LEFT: { siid: 10, piid: 1 } as const,
  /** VERIFIED on r2532a — % of life remaining (returned 48 in field). */
  SIDE_BRUSH_LEFT: { siid: 10, piid: 2 } as const,
  /** VERIFIED on r2532a — % of life remaining (returned 30 in field). NOTE convention is reversed from brush. */
  FILTER_LEFT: { siid: 11, piid: 1 } as const,
  /** VERIFIED on r2532a — hours of operation remaining (returned 46 in field). */
  FILTER_TIME_LEFT: { siid: 11, piid: 2 } as const,
  /** VERIFIED on r2532a 2026-05-02 — hours of cleaning operation remaining. After in-app reset: jumped from 0 → 100. */
  SENSOR_HOURS_LEFT: { siid: 16, piid: 1 } as const,
  /** VERIFIED on r2532a 2026-05-02 — DAYS remaining (NOT %). After in-app reset: jumped from 0 → 30. Triggers a "Clean sensors" notification when either this or piid 1 hits 0. */
  SENSOR_DAYS_LEFT: { siid: 16, piid: 2 } as const,
  /** VERIFIED on r2532a 2026-05-02 — DAYS remaining for the dock's Scale Inhibitor cartridge (returned 976 in field). */
  SCALE_INHIBITOR_DAYS_LEFT: { siid: 31, piid: 1 } as const,
  /** VERIFIED on r2532a 2026-05-02 — % of life remaining for the Scale Inhibitor (returned 89 in field). */
  SCALE_INHIBITOR_LEFT: { siid: 31, piid: 2 } as const,
} as const;
