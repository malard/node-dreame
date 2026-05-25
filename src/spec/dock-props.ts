/**
 * Dock service (siid 27 + siid 28 cluster — sister services on r2532a's base station)
 * plus the washboard cleaning service (siid 4 piid 61).
 *
 * The dock-side settings (mop-wash temperature, mop-drying mode, hair compression,
 * smart-mode master toggle, mast control) are split across these two siids in a
 * way Tasshack's older mapping doesn't cover. All entries here are VERIFIED by
 * directly toggling them in the Dreamehome app and observing the MQTT echo.
 */
export const DOCK_PROP = {
  /**
   * VERIFIED on r2532a — boolean for the **elevating LiDAR/camera mast**
   * (the X50 Ultra Complete's signature feature — extends ~10cm above the
   * robot body so the LiDAR can see over low obstacles).
   *   1 = mast raised
   *   0 = mast lowered
   */
  MAST_RAISED: { siid: 27, piid: 6 } as const,
  /**
   * VERIFIED on r2532a — hot-water status read.
   * Tasshack/dreame-vacuum labels this `HOT_WATER_STATUS` (a status, not a
   * toggle). On r2532a we observed it tracking `MOP_WASH_TEMP > 0` exactly:
   * when MOP_WASH_TEMP is set to 0 (no heating), this drops to 0 in the same
   * MQTT batch. So in practice it behaves as a derived "heater currently on"
   * flag — but the underlying property is a status field, not a writable toggle.
   */
  HOT_WATER_STATUS: { siid: 27, piid: 15 } as const,
  /**
   * VERIFIED on r2449a 2026-05-21 — CleanGenius sub-mode enum. Selects
   * the sub-mode applied while CleanGenius is enabled (`FEATURE_CONFIG_
   * KEYS.SmartHost` != 0). Values: `2 = Vac + Mop`, `3 = Mop after Vac`.
   * CleanGenius does NOT expose Vac-only or Mop-only sub-modes (mirrors
   * the Dreamehome app's UI). Use the `CleanGeniusSubMode` enum.
   */
  CLEAN_GENIUS_SUB_MODE: { siid: 28, piid: 5 } as const,
  /**
   * VERIFIED on r2449a 2026-05-25 — fine-grained per-job mop-water
   * volume. Integer slider, range `1..32`. This is the axis the
   * Dreamehome app surfaces in the per-mode water controls — the
   * coarse `VACUUM_PROP.WATER_VOLUME` (siid 4 piid 5) 3-step
   * `Low/Medium/High` enum is a legacy field; new code should write
   * here. Observation probe (drag the app slider through several
   * values) echoed back cleanly: `1`, `8`, `16`, `32`. No `WaterVolume`
   * enum is defined — values are written as bare integers.
   *
   * **r2532a — not yet observed.** Likely shared given that all other
   * dock-cluster properties on `siid 28` are present on both models,
   * but the slider hasn't been confirmed live on r2532a.
   */
  WATER_VOLUME_FINE: { siid: 28, piid: 1 } as const,
  /**
   * VERIFIED on r2532a — Mop-Washing Water Temperature enum (4 values).
   *   0 = Normal (no heating)
   *   1 = Mild
   *   2 = Warm
   *   3 = High Temperature
   * Use the `MopWashTemp` enum.
   */
  MOP_WASH_TEMP: { siid: 28, piid: 8 } as const,
  /**
   * VERIFIED on r2532a — Smart Mop-Washing master toggle.
   * When `1`, the device chooses water level / temperature / frequency
   * automatically; the manual settings get greyed out in the app.
   * Distinct from `SmartAutoWash` in `FEATURE_CONFIG_JSON` — that's a
   * different feature ("Auto Mop-Rewashing" mid-job).
   */
  SMART_MOP_WASH: { siid: 28, piid: 22 } as const,
  /**
   * VERIFIED on r2532a — Mop-Drying Mode boolean.
   *   0 = Standard
   *   1 = Mute (slower, quieter)
   * Duration is independent — see `DRYING_TIME` (siid 4 piid 40).
   */
  MOP_DRY_MODE: { siid: 28, piid: 27 } as const,
  /**
   * VERIFIED on r2532a — Hair Compression boolean (dock compacts collected hair).
   */
  HAIR_COMPRESSION: { siid: 28, piid: 28 } as const,
  /**
   * VERIFIED on r2532a — Robot "in motion" flag. Flips 0→1 when the robot
   * undocks / starts moving and 1→0 when it docks / stops. Useful for cleanly
   * detecting motion start/stop edges without polling status.
   */
  MOTION_FLAG: { siid: 28, piid: 4 } as const,
  /**
   * VERIFIED on r2532a 2026-05-02 — "Clean Carpets First" checkbox boolean.
   * If true, the robot prioritises carpet areas at the start of a cleaning
   * job (so they get the freshest mop / fullest battery).
   */
  CLEAN_CARPETS_FIRST: { siid: 28, piid: 2 } as const,
  /**
   * VERIFIED on r2532a 2026-05-02 — "Side Brush Rotating on Carpet" checkbox.
   * Whether the side brush spins when the robot is on carpet (it normally
   * doesn't to avoid flinging debris).
   */
  SIDE_BRUSH_ROTATING_ON_CARPET: { siid: 28, piid: 29 } as const,
  /**
   * VERIFIED on r2532a 2026-05-02 — Obstacle Crossing Mode (X50-specific).
   * Refers to how the motorised chassis lift handles thresholds:
   *   0 = Hurdle-Style (one wheel at a time, like jumping a hurdle)
   *   1 = Synchronised Dual-Leg (both wheels together)
   * Use the `ObstacleCrossingMode` enum.
   */
  OBSTACLE_CROSSING_MODE: { siid: 28, piid: 38 } as const,
  /** VERIFIED on r2532a 2026-05-02 — Power-Saving Cleaning boolean. */
  POWER_SAVING_CLEANING: { siid: 28, piid: 63 } as const,
} as const;

/**
 * Washboard / dock cleaning service properties (live state during a wash cycle).
 *
 * Note: the previous `STEP` entry (siid 4 piid 7) was moved to
 * `VACUUM_PROP.STEP_INDICATOR` on 2026-05-02 — it turned out to be a
 * general-purpose task-step indicator, not washboard-specific.
 */
export const WASHBOARD_PROP = {
  /**
   * VERIFIED on r2532a — `1`-Hz countdown of seconds remaining in the current
   * washboard cleaning cycle. Pushed once per second via `properties_changed`
   * while the cycle runs. The Dreamehome app's countdown timer is just rendering
   * this property — it's actual device-side feedback, not a UI estimate.
   */
  COUNTDOWN_SECS: { siid: 4, piid: 61 } as const,
} as const;
