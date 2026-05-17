/**
 * Vacuum service properties (siid 2 + siid 4) and actions.
 *
 * The vacuum service is split across two siids in practice: siid 2
 * holds the high-level state machine + error register, and siid 4
 * holds the cleaning-task fields, dock/wash sub-settings, and the
 * actions cluster. Both live here because they share semantics —
 * splitting them by siid would scatter related fields.
 *
 * Re-exported from `miot-spec.ts` for back-compat.
 */

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
   * Error/fault code. See `MiotError` enum for the 8 catalogued values
   * verified on r2532a: 0/1/18/68/74/105/107/114. Most codes auto-clear when
   * the underlying cause is resolved (no CLEAR_WARNING needed). The
   * string-typed mirror at `ERROR_STR_MIRROR` (piid 18) co-fires within ~1ms.
   *
   * `TaskComplete = 68` is the benign end-of-task signal — filter it out of
   * any "needs attention" UX. `WastewaterTankFull = 105` and
   * `CleanWaterTankEmpty = 107` are the most user-actionable faults on the
   * X50 (dock refill/empty prompts).
   */
  ERROR: { siid: 2, piid: 2 } as const,
  /**
   * Fault-list mirror — co-fires within ~1ms of every `ERROR` (siid 2 piid 2)
   * transition. VERIFIED on r2532a 2026-05-02 to track ERROR for single-fault
   * cases (e.g. "0" → "74" → "0").
   *
   * **Multi-value semantics** (per Tasshack/dreame-vacuum `device.py:1342-1372`
   * on dev branch): the device emits this as a **comma-separated string of
   * fault codes** when more than one condition is latched simultaneously
   * (e.g. `"18,107"` = robot lifted AND clean-water tank empty). `ERROR`
   * itself only holds a single int, so this field is the source of truth
   * for "everything currently wrong with the device."
   *
   * `Vacuum` parses this into `state.faults: MiotError[]`. The single-code
   * case still echoes the same int into `state.errorCode` via `ERROR`, so
   * consumers that only care about the most-recent code don't need to
   * touch this field.
   *
   * Previously named `ERROR_STR_MIRROR` (pre-v0.4); the rename reflects
   * the actual multi-value semantics.
   */
  FAULTS_STR: { siid: 4, piid: 18 } as const,
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
  /**
   * ASSUMED from Tasshack/dreame-vacuum `types.py:1479` — relocation
   * state machine. Values per Tasshack `DreameVacuumRelocationStatus`:
   *   0  = Located
   *   1  = Locating (re-localising — typically right after pickup)
   *   10 = Failed
   *   11 = Success
   *
   * Useful for detecting "user picked the robot up and put it down
   * somewhere else" — a 0→1 transition is the canonical signal that
   * the robot needs to re-establish its position. NOT YET observed
   * live on r2532a; treat values as raw.
   */
  RELOCATION_STATUS: { siid: 4, piid: 20 } as const,
  /**
   * ASSUMED from Tasshack/dreame-vacuum `types.py:1506` — boolean
   * marker for "this task was started by a schedule" (1/2/4 per
   * Tasshack `device.py:8549`, 0 otherwise). Useful for disambiguating
   * scheduled-clean failures from manual-trigger failures. NOT YET
   * observed live on r2532a.
   */
  SCHEDULED_CLEAN: { siid: 4, piid: 47 } as const,
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
   * General-purpose numeric notification prompt — used by the device
   * home page to display arbitrary numeric messages. NOT a detergent
   * property: the maintainer of Tasshack/dreame-vacuum confirmed on
   * 2026-05-06 that this is a generic message-prompt channel, and the
   * synchronous firing observed when toggling detergent dosage on
   * r2532a was coincidental notification traffic, not the dosage
   * value itself.
   */
  NUMERIC_MESSAGE_PROMPT: { siid: 4, piid: 56 } as const,
  /**
   * General-purpose string notification prompt — string-typed twin of
   * `NUMERIC_MESSAGE_PROMPT`. Same generic-message semantics; not a
   * detergent property despite earlier mislabelling on r2532a.
   */
  MESSAGE_PROMPT: { siid: 4, piid: 57 } as const,
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
   * **Mop-drying progress counter** — ticks once per minute through the
   * dock's drying cycle. VERIFIED on r2532a 2026-05-02..03: resets to 0
   * at end-of-task (alongside the cleaning task-summary event) and then
   * counts up while the dock is drying the mop pad (observed reaching
   * 7+ during MopDrying). Co-aligned with `MiotState.MopDrying = 8`.
   *
   * **Naming history:** this property has been mislabelled twice. First
   * as `SCHEDULE_PROP.EDIT_COUNTER` (disproved by the end-of-task reset
   * capture 2026-05-02), then as `TASK_RESET_COUNTER` ("activity-scope"
   * heartbeat). Cross-referenced against Tasshack/dreame-vacuum
   * `types.py:1113` on the dev branch in 2026-05-17, which labels
   * `siid 4 piid 64` as `DRYING_PROGRESS`. The minute-tick during
   * MopDrying matches that interpretation exactly. Renamed to align.
   *
   * Consumers should read this as "minutes elapsed in the current dry
   * cycle"; a 0→non-zero transition correlates with "task just ended,
   * dock is now drying the pad."
   */
  DRYING_PROGRESS: { siid: 4, piid: 64 } as const,
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
 * Vacuum-service actions.
 *
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
