/**
 * Device-info MIoT properties — basic identity (siid 1) plus the
 * undocumented diagnostic-telemetry service (siid 99).
 *
 * Re-exported from `miot-spec.ts` for back-compat; new code may import
 * directly from here.
 */

/** Device-info service (siid 1). */
export const DEVICE_PROP = {
  /** Manufacturer. VERIFIED returns "dreame" on r2532a. */
  MANUFACTURER: { siid: 1, piid: 1 } as const,
  /** Model string. VERIFIED returns "dreame.vacuum.r2532a". */
  MODEL: { siid: 1, piid: 2 } as const,
  /** Device id (did). VERIFIED matches DreameDevice.did. */
  DID: { siid: 1, piid: 3 } as const,
  /** Firmware build number string (e.g. "2033", "2199"). VERIFIED transitioned 2033→2199 across an OTA on r2532a. */
  FIRMWARE_BUILD: { siid: 1, piid: 4 } as const,
  /** Serial number. VERIFIED returns the printed serial on r2532a. */
  SERIAL: { siid: 1, piid: 5 } as const,
} as const;

/**
 * "Diagnostic" service (siid 99) — undocumented vendor-specific telemetry.
 * Most fields are uninteresting counters but a few carry firmware metadata.
 */
export const DIAGNOSTIC_PROP = {
  /**
   * VERIFIED on r2532a: comma-separated firmware-build line, e.g.
   * `"2025-04-29 16:45:02,4.3.9_2033_release,,"` then post-OTA
   * `"2026-01-20 18:05:37,4.3.9_2199_release,,x50pro-en-001.002.1019.f6598f8-20240920.tar"`.
   */
  FIRMWARE_INFO_LINE: { siid: 99, piid: 17 } as const,
  /**
   * VERIFIED on r2532a: JSON object `{fw_ver, mcu_ver, speech_ver}` — separate
   * version strings for the main firmware, MCU, and voice pack.
   */
  VERSIONS_JSON: { siid: 99, piid: 31 } as const,
  /**
   * VERIFIED on r2532a: JSON `{platform, models[]}` enumerating the on-device AI
   * models (e.g. human v2.0.2, obstacle_instance v4.5.7) and MR527 platform name.
   */
  AI_MODELS_JSON: { siid: 99, piid: 94 } as const,
  /**
   * VERIFIED on r2532a 2026-05-02 — slow-growing usage counter. Observed
   * incrementing by 5 (45 → 50 → 55 → 60) over ~6 hours, irregularly spaced
   * (9-45 min apart). Plausible as cumulative cleaning quarter-hours or a
   * similar coarse usage stat. Not time-aligned to any clean schedule.
   */
  USAGE_COUNTER: { siid: 99, piid: 22 } as const,
} as const;
