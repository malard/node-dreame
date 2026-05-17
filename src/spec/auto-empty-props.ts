/**
 * Auto-Empty service (siid 15) — dust bag / debris evacuation.
 */
export const AUTO_EMPTY_PROP = {
  /**
   * VERIFIED on r2532a — Auto-Empty frequency mode enum (4 values).
   *   0 = Off
   *   1 = Standard
   *   2 = High Frequency
   *   3 = Low Frequency
   * Note the values are arbitrary mode ids, not a numeric "frequency" scale —
   * 2 and 3 are not in expected order. Use the `AutoEmptyFrequency` enum.
   */
  FREQUENCY: { siid: 15, piid: 1 } as const,
  /**
   * VERIFIED on r2532a — boolean asserting when the robot is on the dock
   * and the auto-empty service is ready (1 = docked & idle, 0 = away).
   */
  ON_DOCK_FLAG: { siid: 15, piid: 3 } as const,
  /**
   * VERIFIED on r2532a 2026-05-02 — auto-empty trigger flag. Pulses
   * `0 → 1 → 0` only when an auto-empty cycle is initiated (does NOT fire
   * on other dock visits). Useful as a precise "the dock is about to suck
   * out the dustbin" edge signal — fires immediately on dock arrival,
   * before the MiotState transition to `22` (AutoEmptying).
   */
  TRIGGER_FLAG: { siid: 15, piid: 5 } as const,
} as const;
