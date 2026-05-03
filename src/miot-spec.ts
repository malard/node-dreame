/**
 * MIoT siid/piid/aiid catalogue for the modern Dreame vacuum series.
 *
 * Each entry is annotated:
 *   VERIFIED <model>  → observed working against that exact device
 *   ASSUMED  <source> → borrowed from another project; not yet confirmed
 *
 * Verifications below were all done against `dreame.vacuum.r2532a`
 * (Dreame X50 Ultra Complete, EU region, firmware 4.3.9_2199) on 2026-05-02.
 *
 * Borrowed entries come from Tasshack/dreame-vacuum (Mi cloud, generic
 * Dreame profile spanning r2228/r2389/r2449). They tend to hold across the
 * generation, but some siid/piid/aiid numbers and especially enum *value*
 * meanings can shift on newer firmware. Don't trust an "ASSUMED" entry as
 * a label; treat the integer as raw until you've seen it move with the
 * device in a known state.
 */

// ─── Properties ────────────────────────────────────────────────────────

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

/** Vacuum service properties. */
export const VACUUM_PROP = {
  /**
   * MIoT vacuum-status enum. See `MiotState`.
   * VERIFIED 19 distinct values live on r2532a 2026-05-02: 1, 2, 3, 4, 5, 6,
   * 8, 9, 10, 12, 13, 14, 17, 18, 20, 22, 23, 28, 30. Captured across an
   * end-to-end cleaning task incl. multiple mid-job dock cycles and a full
   * end-of-task dry-down. Sub-mode hypothesis confirmed across 6 transitions:
   * value 1 = vacuum-only, value 12 = vacuum+mop.
   */
  STATE: { siid: 2, piid: 1 } as const,
  /**
   * Error/fault code. See `MiotError` enum for the 6 catalogued values.
   * VERIFIED on r2532a 2026-05-02: 0/1/18/68/74/114 all observed. Most codes
   * auto-clear when the underlying cause is resolved (no CLEAR_WARNING needed).
   * The string-typed mirror at `ERROR_STR_MIRROR` (piid 18) co-fires within ~1ms.
   */
  ERROR: { siid: 2, piid: 2 } as const,
  /**
   * VERIFIED on r2532a 2026-05-02 — string-typed mirror of `ERROR` (siid 2 piid 2).
   * Co-fires within ~1ms of every ERROR transition (e.g. "0" → "74" → "0").
   * Useful when consuming MIoT properties_changed batches where the int+string
   * pair lets you correlate the error transition without a separate read.
   */
  ERROR_STR_MIRROR: { siid: 4, piid: 18 } as const,
  /**
   * VERIFIED on r2532a 2026-05-02 — mop-pad availability/transition state.
   * Observed values: `2` and `0`. Transitions are tightly synchronised with
   * MiotState 17 (ReturnInstallMop) and 18 (ReturnRemoveMop) edges.
   *
   * **Semantics NOT YET fully decoded.** The "available vs in-active-use"
   * model fits some transitions but contradicts others (e.g. `0 → 2` was
   * observed at the moment the device prepared to *drop* pads, which the
   * "available = parked at dock" reading would predict the opposite of).
   * Treat as raw int and correlate against `CLEANING_MODE` bit 1 — the bit
   * tracks physical attachment more reliably.
   */
  MOP_PADS_STATE: { siid: 2, piid: 6 } as const,

  /**
   * VERIFIED on r2532a 2026-05-02 — Dreame "task status" enum. See `TaskStatus`.
   * 6 values catalogued live during an end-to-end cleaning task: 1, 2, 3, 6,
   * 12, 14. Note: this is a DIFFERENT property from `STATE` (siid 2 piid 1) —
   * different value space, different semantics. TaskStatus is roughly "what
   * is the user-visible task doing" (paused/active/transitioning/docked),
   * MiotState is the lower-level vacuum-mode state machine.
   */
  TASK_STATUS: { siid: 4, piid: 1 } as const,
  /** ASSUMED Tasshack types.py:573 — current job runtime in minutes. */
  CLEANING_TIME: { siid: 4, piid: 2 } as const,
  /** ASSUMED Tasshack types.py:574 — area cleaned in m². */
  CLEANED_AREA: { siid: 4, piid: 3 } as const,
  /** ASSUMED Tasshack types.py:575 — suction level enum (see SuctionLevel). */
  SUCTION_LEVEL: { siid: 4, piid: 4 } as const,
  /**
   * VERIFIED on r2532a 2026-05-02 — mop-install attempt indicator. Pulses
   * `0 → 10 → 0` each time the dock attempts to auto-install pads onto
   * the robot (~13s per attempt). Two consecutive pulses with no value-2
   * between them means the auto-install failed; the next event is usually
   * an ERROR=74 to prompt manual install.
   */
  MOP_INSTALL_ATTEMPT: { siid: 4, piid: 6 } as const,
  /**
   * VERIFIED on r2532a 2026-05-02 — multi-purpose **task step indicator**.
   * Catalogued values (with the contexts they fired in):
   *   1  = active cleaning step
   *   6  = post-clean idle (between phases)
   *   16 = intermediate / unknown step
   *   25 = mop-install attempt step
   *   26 = mop-remove step
   * Useful as a finer "what is the robot trying to do right now" signal
   * than MiotState alone — distinguishes the sub-step within e.g. a
   * mop-install sequence. Previously misnamed `WASHBOARD_PROP.STEP`
   * (it's a general task-step indicator, not washboard-specific).
   *
   * NOTE: Tasshack (`types.py:578`) labels this same piid as `TASK_STATUS`.
   * The label difference is semantic — values 1/6/16/25/26 we observed
   * fit either reading.
   */
  STEP_INDICATOR: { siid: 4, piid: 7 } as const,
  /**
   * VERIFIED 2026-05-03 — unix-epoch start time of the most-recent
   * cleaning task. **Not readable as a property** (returns code = -1
   * even mid-task), but **emitted as an argument of the
   * `event_occured siid 4 eiid 1` "task summary" event** at end-of-
   * task. Subscribe to `DreameSubscription.on('event', ...)` to capture.
   */
  CLEANING_START_TIME: { siid: 4, piid: 8 } as const,
  /**
   * VERIFIED 2026-05-03 — per-task cleaned-area map filename. Same
   * delivery as `CLEANING_START_TIME` — emitted as an argument of the
   * `event_occured siid 4 eiid 1` event, not readable as a property.
   *
   * Path format: `ali_dreame/<YYYY>/<MM>/<DD>/<uid>/<did>_<taskId>.<fwBuild>.bin`
   * e.g. `ali_dreame/2026/05/03/KB968216/660622937_144940446.2199.bin`.
   *
   * Fetch via the existing OSS download endpoint to retrieve the
   * per-task cleaned-area map blob.
   */
  CLEAN_LOG_FILE_NAME: { siid: 4, piid: 9 } as const,
  /**
   * Per-call parameters echoed back at task end — same JSON-string
   * shape as the START_CUSTOM in-param. Emitted in
   * `event_occured siid 4 eiid 1`. Useful to discriminate which
   * cleaning mode produced this task summary.
   *
   * Fields observed (greasy-area task on r2532a 2026-05-03):
   *   `{cleaningTime, customeClean, mooClean, pet, cmc, ismultiple, ctyo, multime}`
   */
  CLEANING_PROPERTIES: { siid: 4, piid: 10 } as const,
  /**
   * VERIFIED 2026-05-03 — task completion status (1 = success).
   * Same delivery as `CLEANING_START_TIME` — emitted as event arg.
   */
  CLEAN_LOG_STATUS: { siid: 4, piid: 13 } as const,
  /**
   * ASSUMED Tasshack types.py:576 — water flow level **during active cleaning**
   * (mop on the floor). NOT to be confused with `MOP_WASH_WATER_LEVEL` (siid 4
   * piid 46) which is the dock's wash-cycle water amount.
   */
  WATER_VOLUME: { siid: 4, piid: 5 } as const,
  /** VERIFIED on r2532a 2026-05-02 — boolean for "Resume Cleaning Mode" (auto-resume after dock/charge). */
  RESUME_CLEANING: { siid: 4, piid: 11 } as const,
  /** VERIFIED on r2532a 2026-05-02 — Carpet Boost boolean (paired with FEATURE_CONFIG_JSON.RobotCarpetPressEnable). The JSON mirror is 3-state (-1 = blocked when carpet mode = Avoid; 0 = user-disabled; 1 = enabled). */
  CARPET_BOOST: { siid: 4, piid: 12 } as const,
  /** ASSUMED Tasshack types.py:587 — JSON payload for joystick control. Note: live joystick during the camera/remote-control session appears to bypass this and use a side-channel through the Aliyun video session (no MQTT echoes for joystick movement). */
  REMOTE_CONTROL: { siid: 4, piid: 15 } as const,
  /**
   * VERIFIED on r2532a 2026-05-02 — packed bitfield for AI / obstacle-detection
   * sub-options (everything under "Intelligent Obstacle Avoidance" in the app).
   * Each bit is one toggle.
   *
   * Verified-by-toggle on r2532a:
   *   bit 1 (=2)   Intelligent Obstacle Avoidance (master)
   *   bit 2 (=4)   Pictures (capture obstacle photos)
   *   bit 4 (=16)  Pet Recognition (mirrors FEATURE_CONFIG_JSON.PetPartClean)
   *
   * Always set in every observation (role TBD — could be "supported" flags,
   * could be toggles we never moved, could mean those features are non-toggleable
   * on this generation):
   *   bit 0 (=1), bit 8 (=256)
   *
   * Unobserved on r2532a:
   *   bit 3 (=8), bits 5–7
   *
   * ASSUMED from Tasshack/dreame-vacuum (older-model decoding — NOT verified
   * to apply on r2532a; layout may differ on this generation):
   *   bit 0 = furniture detection
   *   bit 3 = fluid detection
   *   bit 5 = obstacle image upload
   *   bit 6 = AI picture
   * Bits 1, 2, 4 in Tasshack's older-model decoding match what we verified on
   * r2532a; the assumed bits above are plausible candidates for the unobserved
   * positions but should be treated as guesses until toggled.
   *
   * NB: enabling Pet Recognition also auto-bumps `AUTO_EMPTY_PROP.FREQUENCY`
   * from Standard to HighFrequency (asymmetric coupling — disabling Pet
   * Recognition does NOT revert it).
   */
  AI_OBSTACLE_BITFIELD: { siid: 4, piid: 22 } as const,
  /**
   * VERIFIED on r2532a 2026-05-02 — finer-grained sub-task phase indicator.
   * See `TaskPhase` enum. 4 values catalogued: 0/1/3/5. Co-varies with
   * `TASK_STATUS` but moves on a finer cadence (changes during the wash/
   * refill sub-cycles within a single TaskStatus state).
   */
  TASK_PHASE: { siid: 4, piid: 25 } as const,
  /**
   * ASSUMED Tasshack types.py:594 — cleaning mode (sweep/mop/both). VERIFIED
   * on r2532a — packed bitfield, the simple `CleaningMode` enum below does
   * NOT apply.
   *
   * **Decoded so far:**
   *   bit 1 (=2) = mop pads currently attached to robot. Observed
   *                `5120 ↔ 5122` transitions tracking install/remove.
   *
   * Other bits in `5120` (`0x1400` = bits 10 + 12) are constant across all
   * observations — likely "always-on" capability flags for this hardware
   * generation; their meanings remain undecoded.
   */
  CLEANING_MODE: { siid: 4, piid: 23 } as const,
  /** VERIFIED on r2532a 2026-05-02 — Child Lock boolean (locks the on-device buttons). */
  CHILD_LOCK: { siid: 4, piid: 27 } as const,
  /**
   * VERIFIED on r2532a 2026-05-02 — secondary carpet-mode flag.
   * Tracks the `CARPET_HANDLING_MODE` field but doesn't have a 1:1 mapping —
   * value `3` only seen in Ignore mode; value `1` shared by Crossing/Avoid/Vacuum.
   * Likely a derived "treat-carpet-as-floor" flag specific to Ignore mode.
   */
  CARPET_SECONDARY_FLAG: { siid: 4, piid: 33 } as const,
  /**
   * VERIFIED on r2532a 2026-05-02 — Carpet Handling Mode enum (5 values).
   * The app's two-level menu (parent: Crossing/Ignore/Avoid/Vacuum → sub:
   * Remove/Lift inside Vacuum) flattens into this single multiplexed int.
   *   1 = Avoid                  (don't drive on carpets)
   *   2 = Vacuum + Mop Lift      (Vacuum mode, mop physically lifted)
   *   3 = Vacuum + Remove Mop    (Vacuum mode, dock holds the pads)
   *   6 = Ignore                 (drive on, treat-as-floor)
   *   7 = Crossing Carpets       (drive on, full vacuum + mop)
   * Use the `CarpetHandlingMode` enum.
   */
  CARPET_HANDLING_MODE: { siid: 4, piid: 36 } as const,
  /**
   * VERIFIED on r2532a 2026-05-02 — the **Auto Mop-Washing** boolean
   * (auto-rewashes the mop pad mid-job at intervals).
   * Observed transitions: 1 → 0 → 1 with each app toggle.
   * Tasshack labelled this `SELF_CLEAN`; we keep that name for back-compat
   * but `AUTO_MOP_WASH` is the user-facing label on r2532a.
   */
  SELF_CLEAN: { siid: 4, piid: 34 } as const,
  /**
   * VERIFIED on r2532a 2026-05-02 — Mop-Drying duration in hours, bounded enum.
   * Confirmed values: 2, 3, 4. Other values not selectable in app.
   * Use the `DryingTimeHours` type for type-safe writes.
   */
  DRYING_TIME: { siid: 4, piid: 40 } as const,
  /**
   * VERIFIED on r2532a 2026-05-02 — boolean for "Mop-Washing with Detergent"
   * (whether the dock injects detergent during the mop wash cycle).
   */
  MOP_WASH_DETERGENT_ENABLED: { siid: 4, piid: 37 } as const,
  /**
   * VERIFIED on r2532a 2026-05-02 — Mop-Washing Water Level enum (how much
   * water the dock uses for the wash cycle — NOT the cleaning-time water flow).
   *   0 = Water Saving
   *   1 = Standard
   *   2 = Deep
   * Use the `MopWashWaterLevel` enum.
   */
  MOP_WASH_WATER_LEVEL: { siid: 4, piid: 46 } as const,
  /**
   * VERIFIED on r2532a — appeared synchronously with detergent toggle. Likely detergent dosage units (value 11 observed).
   * TODO: revalidate. Tasshack/dreame-vacuum (dev branch) labels siid 4 piid 56 as
   * `NUMERIC_MESSAGE_PROMPT`, not a detergent property. The co-firing with the detergent
   * toggle on r2532a is suggestive but not conclusive — re-toggle detergent in isolation
   * and toggle each app-side message-prompt setting to confirm which interpretation holds.
   */
  DETERGENT_DOSAGE_INT: { siid: 4, piid: 56 } as const,
  /**
   * VERIFIED on r2532a — string-typed twin of DETERGENT_DOSAGE_INT (e.g. "11"). Purpose unclear but co-fires with the int field.
   * TODO: revalidate. Tasshack/dreame-vacuum (dev branch) labels siid 4 piid 57 as
   * `MESSAGE_PROMPT`. Same caveat as piid 56 above.
   */
  DETERGENT_DOSAGE_STR: { siid: 4, piid: 57 } as const,
  /**
   * VERIFIED on r2532a 2026-05-02 — mop-install in-progress flag. Pulses
   * `0 → 1 → 0` in lockstep with `MOP_INSTALL_ATTEMPT` (piid 6). When piid 6
   * fires `10` this flag is `1`; when piid 6 returns to `0` this flag returns
   * to `0` too. Use either field as the "auto-install machinery is running"
   * gate; the pair distinguishes attempt-start (level=1, attempt=10) from
   * attempt-end (level=0, attempt=0).
   */
  MOP_INSTALL_INPROGRESS: { siid: 4, piid: 53 } as const,
  /**
   * VERIFIED on r2532a 2026-05-02 — mop-rotation phase pulse. Alternates
   * `9 ↔ 17` every ~3-10s while the mop pads are physically attached and the
   * robot is actively cleaning. **Silent during vacuum-only cleaning**
   * (MiotState=1) — confirmed across 3 consecutive vacuum-only windows
   * with zero pulses, then 30-69 pulses/window once mop pads went back on.
   * Likely encodes the mop spinner's rotation direction or phase. Useful
   * as a "are the mop pads currently spinning" signal independent of
   * MiotState/TASK_STATUS.
   */
  MOP_ROTATION_PULSE: { siid: 4, piid: 58 } as const,
  /**
   * VERIFIED on r2532a 2026-05-03 — **task progress percentage**.
   * Counts up monotonically from 0 → 100 during an active cleaning
   * task (with occasional small jumps both up and down as the device
   * re-estimates remaining work). Hits exactly `100` at the moment
   * the device flags the task as complete (right before the
   * `event_occured siid 4 eiid 1` summary event), then snaps to `0`
   * once the post-task cycle settles.
   *
   * Reliable signal for "show a progress bar in the UI" — far more
   * stable than trying to infer from MiotState.
   */
  TASK_PROGRESS_PCT: { siid: 4, piid: 63 } as const,
  /**
   * VERIFIED on r2532a 2026-05-02..03 — generic **device-activity
   * counter**. Resets to 0 at end-of-task (cleaning task summary
   * fires) and then increments roughly once per minute for as long as
   * the device is doing anything (cleaning, mop wash, mop dry, etc.).
   *
   * Originally labelled "task-sequence counter resets at task end" —
   * the reset behaviour was correct, but the post-task increments
   * (observed 2026-05-03 ticking through 0→7+ during MopDrying)
   * showed the counter is broader than just active cleaning. Useful
   * as a "device is doing something" heartbeat.
   *
   * Previously this property was misidentified as a schedule-edit
   * counter (`SCHEDULE_PROP.EDIT_COUNTER`). The end-of-task reset
   * captured on 2026-05-02 disproved that and confirmed the
   * activity-scope interpretation.
   */
  TASK_RESET_COUNTER: { siid: 4, piid: 64 } as const,
  /**
   * VERIFIED on r2532a 2026-05-02 — firmware-capability bitfield, fired once
   * per device reconnect. Observed value `31 = 0b11111` (5 capability bits
   * all set). The exact meaning of each bit is UNDECODED — likely advertises
   * which feature subsystems this build supports (e.g. live-map, OTA channel,
   * AI obstacle, etc.).
   */
  FIRMWARE_CAPABILITY: { siid: 4, piid: 83 } as const,
  /**
   * VERIFIED on r2532a: returns a JSON string (yes — string-encoded JSON, not native JSON)
   * containing an array of `{k, v}` objects representing the full feature toggle config:
   * AutoDry, FillinLight, StainIdentify, SuperWash, MopExtrSwitch, RobotCarpetPressEnable,
   * SmartAutoMop, LacuneMopScalable, SbrushExtrSwitch, MonitorHumanFollow, MopEffectSwitch,
   * SmartHost, CleanRoute, MopEffectState, MopFullyScalable, PetPartClean, MopScalable2,
   * SmartAutoWash, MaterialDirectionClean, DetergentNote, SmartCharge, CarpetOnlyClean,
   * CarpetFineClean, SuctionMax, UVLight, MonitorPromptLevel, SmartDrying, HotWash,
   * BackWashType, ExtrFreq, MopScalableVersion, MeticulousTwist, FluctuationConfirmResult,
   * FluctuationTestResult, CleanType, LessColl, plus a few more — ~36 keys total.
   */
  FEATURE_CONFIG_JSON: { siid: 4, piid: 50 } as const,
  /** VERIFIED on r2532a: returns the printed serial number (alternative to siid 1 piid 5). */
  SERIAL_ALT: { siid: 4, piid: 14 } as const,
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

/**
 * Dock service (siid 27 + siid 28 cluster — sister services on r2532a's base station).
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

/**
 * Cloud-storage / map-data service (siid 6).
 *
 * This is the channel the live-map decoder reads from. Inline and
 * out-of-band (OSS-pointer) variants both flow through here; see
 * `docs/live-map-roadmap.md` for the full envelope format.
 */
export const CLOUD_OBJ_PROP = {
  /**
   * ASSUMED Tasshack `dev` `map.py` (live MAP_DATA channel) — inline map
   * blob delivered directly via MQTT. Expected to be a base64 string,
   * optionally with a trailing `,<aes-key>` suffix per the outer-envelope
   * convention. NOT YET observed flowing on r2532a; capture via
   * `examples/capture-map-fixtures.ts` to confirm.
   */
  MAP_DATA: { siid: 6, piid: 1 } as const,
  /**
   * VERIFIED on r2532a: object path string `ali_dreame/<uid>/<did>/<n>`
   * pointing at the OSS-stored live I-frame.
   *
   * The integer suffix is **not monotonic** — verified live during a
   * cleaning task on 2026-05-03, the device cycles through a small
   * ring of slots (0..6 observed). Each push means "the I-frame at
   * this slot has been refreshed; come fetch it." The same slot may
   * be revisited; treat each push as a fresh I-frame regardless of
   * the integer suffix.
   *
   * Implication: dedupe consecutive PATH pushes by `obj_name` (which
   * `MapManager` does), not by tracking a high-water-mark integer.
   */
  PATH: { siid: 6, piid: 3 } as const,
  /**
   * VERIFIED on r2532a 2026-05-03: JSON `{object_name, md5}` pointing at a
   * cloud-stored binary blob — the saved-map list / fresh map snapshot
   * fetched via the Aliyun OSS bucket. Path format:
   * `ali_dreame/<uid>/<did>/<n>`.
   *
   * Note: earlier versions of this file (and some Tasshack-derived docs)
   * called the key `obj_name`. The Dreame native cloud uses
   * `object_name` — but consumer code accepts both for compatibility.
   */
  POINTER_JSON: { siid: 6, piid: 8 } as const,
  /**
   * ASSUMED Tasshack `dev` `map.py` (OLD_MAP_DATA channel) — multiplexed
   * inline-or-pointer string of the form `"<flag>,<payload>[,<key>]"`,
   * where `flag=0` means inline base64, `flag=1` means OSS object name.
   * NOT YET observed on r2532a; capture and disambiguate before relying.
   */
  OLD_MAP_DATA: { siid: 6, piid: 13 } as const,
  /**
   * ASSUMED Tasshack `dev` `device.py:1893` — `FRAME_INFO`, the in-param
   * target for the `REQUEST_MAP` action below. The action's `in` array
   * carries `[{ piid: 2, value: "<json-string>" }]`; see
   * `src/map/request.ts:requestIFrame`.
   */
  FRAME_INFO: { siid: 6, piid: 2 } as const,
} as const;

/**
 * Map-control actions (siid 6).
 */
export const MAP_ACTION = {
  /**
   * ASSUMED Tasshack `dev` `device.py:1893` — request the device to push
   * a fresh map frame. The action's `in` array carries a single MIoT
   * in-param targeting `FRAME_INFO` (piid 2) with a JSON-string value
   * describing the request shape (frame type, force flag, optional
   * map_id/frame_id). Use `requestIFrame` from `src/map/request.ts`.
   */
  REQUEST_MAP: { siid: 6, aiid: 1 } as const,
} as const;

/**
 * Camera / video-stream service (siid 10001).
 *
 * VERIFIED on r2532a 2026-05-02 — observed transitions when the user enabled
 * "Remote control" in the Dreamehome app, entered the security PIN, and
 * began streaming the onboard camera.
 *
 * The video stream itself runs over **Aliyun LinkVisual** (Aliyun's IoT
 * video product), not a Dreame-specific protocol — the device's
 * `feature` field reads `"video_ali,fastCommand"` to confirm.
 *
 * The session metadata pushed here contains everything an Aliyun
 * LinkVisual SDK client would need to subscribe to the stream
 * (channelId, session, encryptionKey). The PIN is validated server-side
 * before the session is created — it never appears on this channel.
 */
export const CAMERA_PROP = {
  /**
   * VERIFIED — JSON-string with the active stream session.
   * On idle: `{operType: "end", operation: "monitor", result: 0, status: 0}`.
   * On start: `{token: "alify", channelId: <iotId>, area: "4",
   *            operType: "monitor", operation: "start", session: <sessionId>,
   *            encryptionKey: <hexAesKey>, result: 0, status: 1, df: 1}`.
   */
  STREAM_SESSION_JSON: { siid: 10001, piid: 1 } as const,
  /**
   * VERIFIED on r2532a 2026-05-02 — front camera fill-light brightness as
   * a string-typed integer.
   *
   *   "0"–"100"  — manual brightness percentage (perceptually logarithmic
   *                in the app slider — "half way" on the slider reads ~70-76)
   *   "101"      — sentinel meaning auto / off (set when not in manual mode)
   *
   * The slider is roughly square-root scaled (slider position² / 100 ≈ value).
   * (Previous tentative label `STREAM_TASK_ID` was wrong — the value "101"
   * just coincided with stream-start, when the light was in auto mode.)
   */
  FILL_LIGHT_BRIGHTNESS: { siid: 10001, piid: 9 } as const,
  /**
   * VERIFIED on r2532a 2026-05-02 — real-time on-device AI object detection
   * feed, pushed via MQTT at ~10-30 fps while the camera is active.
   * Each push is a JSON-string of:
   *   `{ timestamp: <microseconds>, boxlist: [{type: <classId>, bbox: [x,y,w,h]}, ...] }`
   * Coordinates are normalized 0-1. `type` is an integer class id; class 160
   * appears repeatedly during dock-hunting (likely "obstacle/unknown").
   * The model catalog itself lives at `DIAGNOSTIC_PROP.AI_MODELS_JSON`.
   */
  AI_DETECTION_FEED: { siid: 10001, piid: 112 } as const,
  /**
   * VERIFIED on r2532a 2026-05-02 — JSON-string carrying a cloud-sync result.
   * Observed payloads:
   *   `{operType:"clould",operation:"update",session:"null",result:12546,status:0,df:1|2}`
   * (Note Dreame's typo: `"clould"` not `"cloud"` — same family of typos as
   * `"dowloaded"` in the OTA flow.) Fires sporadically; likely a
   * "settings cloud-sync result" channel.
   */
  CLOUD_SYNC_RESULT_JSON: { siid: 10001, piid: 8 } as const,
} as const;

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

/** Battery service. */
export const BATTERY_PROP = {
  /** VERIFIED returns 100 while docked on r2532a. Standard MIoT battery percentage. */
  LEVEL: { siid: 3, piid: 1 } as const,
  /** VERIFIED returns 1 while charging on r2532a. */
  CHARGING_STATUS: { siid: 3, piid: 2 } as const,
} as const;

/** Settings service. */
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

// ─── Actions ───────────────────────────────────────────────────────────

/**
 * Note: action calls require a single-object `params` field, not an array.
 * Dispatch is handled by `commands.ts:callAction` which builds the right shape.
 */
export const VACUUM_ACTION = {
  /** ASSUMED Tasshack — start cleaning. NOT YET VERIFIED on r2532a (would actually run the robot). */
  START: { siid: 2, aiid: 1 } as const,
  /** ASSUMED Tasshack — pause. NOT YET VERIFIED on r2532a. */
  PAUSE: { siid: 2, aiid: 2 } as const,
  /** ASSUMED Tasshack — return to dock. NOT YET VERIFIED on r2532a. */
  CHARGE: { siid: 3, aiid: 1 } as const,
  /** ASSUMED Tasshack — start zone/segment clean (needs `in` payload). NOT YET VERIFIED on r2532a. */
  START_CUSTOM: { siid: 4, aiid: 1 } as const,
  /** ASSUMED Tasshack — stop. NOT YET VERIFIED on r2532a. */
  STOP: { siid: 4, aiid: 2 } as const,
  /** VERIFIED 2026-05-02 on r2532a — returned code 0. */
  CLEAR_WARNING: { siid: 4, aiid: 3 } as const,
  /** ASSUMED Tasshack — start dock mop wash. NOT YET VERIFIED on r2532a. */
  START_WASHING: { siid: 4, aiid: 4 } as const,
  /** VERIFIED 2026-05-02 on r2532a — robot beeped, returned code 0. */
  LOCATE: { siid: 7, aiid: 1 } as const,
  /** VERIFIED 2026-05-02 on r2532a — robot played sound, returned code 0. */
  TEST_SOUND: { siid: 7, aiid: 2 } as const,
  /** ASSUMED Tasshack — manual auto-empty trigger. NOT YET VERIFIED on r2532a. */
  START_AUTO_EMPTY: { siid: 15, aiid: 1 } as const,
  /** ASSUMED Tasshack — reset main brush life. NOT YET VERIFIED on r2532a. */
  RESET_MAIN_BRUSH: { siid: 9, aiid: 1 } as const,
  /** ASSUMED Tasshack. */
  RESET_SIDE_BRUSH: { siid: 10, aiid: 1 } as const,
  /** ASSUMED Tasshack. */
  RESET_FILTER: { siid: 11, aiid: 1 } as const,
  /** ASSUMED Tasshack. */
  RESET_SENSOR: { siid: 16, aiid: 1 } as const,
  /** ASSUMED Tasshack. */
  RESET_SECONDARY_FILTER: { siid: 17, aiid: 1 } as const,
  /** ASSUMED Tasshack. */
  RESET_MOP_PAD: { siid: 18, aiid: 1 } as const,
  /** ASSUMED Tasshack. */
  RESET_SILVER_ION: { siid: 19, aiid: 1 } as const,
  /** ASSUMED Tasshack. */
  RESET_DETERGENT: { siid: 20, aiid: 1 } as const,
} as const;

// ─── Enums + feature-config (re-exports) ──────────────────────────────
//
// The enum catalogue and FEATURE_CONFIG_KEYS payload table were extracted
// into sibling modules under `spec/` (review #16). They're re-exported
// here so consumers that import from `node-dreame` keep working without
// having to know about the new layout.

export {
  MiotState,
  ChargingStatus,
  MiotError,
  TaskStatus,
  TaskPhase,
  SuctionLevel,
  WaterVolume,
  CleaningMode,
  MopWashTemp,
  MopWashWaterLevel,
  MopDryMode,
  AutoEmptyFrequency,
  CarpetHandlingMode,
  ObstacleCrossingMode,
  LiveVideoPrompts,
  ScheduleRoute,
  ScheduleCleaningMode,
  SCHEDULE_FIELD8,
} from "./spec/enums.js";
export type { DryingTimeHours } from "./spec/enums.js";

export { FEATURE_CONFIG_KEYS } from "./spec/feature-config.js";
export type { FeatureConfigKey, FeatureConfigEntry } from "./spec/feature-config.js";
