/**
 * Cumulative-totals service (siid 12) — lifetime cleaning statistics.
 *
 * VERIFIED on r2532a 2026-05-03: all four piids return the matching
 * Tasshack-named values (`types.py:657-660`). siid 12 piids 5/6 also
 * read as 0 but Tasshack's mapping doesn't claim them — likely
 * unallocated padding on this firmware.
 */
export const TOTALS_PROP = {
  /** Unix epoch (seconds) of the device's first cleaning task. */
  FIRST_CLEANING_DATE: { siid: 12, piid: 1 } as const,
  /** Cumulative cleaning runtime in minutes, across the device's lifetime. */
  TOTAL_CLEANING_TIME: { siid: 12, piid: 2 } as const,
  /** Total number of cleaning tasks completed since first use. */
  CLEANING_COUNT: { siid: 12, piid: 3 } as const,
  /** Cumulative cleaned area in square metres, across the device's lifetime. */
  TOTAL_CLEANED_AREA: { siid: 12, piid: 4 } as const,
} as const;
