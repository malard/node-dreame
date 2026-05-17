/**
 * Notification / status-flag service (siid 14) — robot-side advisory flags
 * surfaced into the Dreamehome app as "needs attention" prompts.
 */
export const NOTIFICATION_PROP = {
  /**
   * VERIFIED on r2532a 2026-05-02..03 — generic **"device needs user
   * attention"** flag (despite the name). Multiple distinct triggers
   * observed live:
   *   - Navigation concerns / preemptive stuck warnings (the original
   *     observation that gave it the name).
   *   - Post-task **water-tank service alerts** ("clean water tank
   *     low / dirty water tank full, please refill/empty") — fires
   *     once after the dock finishes washing the mop. User confirmed
   *     2026-05-03 by reporting the matching app prompt.
   *   - Genuine stuck cases keep it pinned to `1` until the user
   *     intervenes (observed sticky for 2 hours in a real stuck event).
   *
   * Treat as "robot may need attention" — disambiguate by:
   *   - stickiness (>5 min suggests a real stuck condition)
   *   - correlation with ERROR codes (`siid 2 piid 2`)
   *   - state context (e.g. fires during state 8 MopDrying ⇒ likely
   *     water-tank prompt, not navigation)
   *   - Dreame app's own message overlay (the canonical UX surface).
   */
  STUCK_NOTIFICATION_ACTIVE: { siid: 14, piid: 4 } as const,
} as const;
