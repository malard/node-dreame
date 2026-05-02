# Spec Discovery Methodology

> **This document covers what's been mapped so far, not a complete spec.**
> Coverage of the r2532a's surface is partial — see the [README's Coverage
> section](../README.md#coverage-status) for the honest summary. This
> methodology doc is meant to make it cheap for the next person (or AI
> agent) to add observations and extend the catalogue.

How the property/action catalogue in `src/miot-spec.ts` was assembled
against a live `dreame.vacuum.r2532a` (X50 Ultra Complete, EU region,
firmware `4.3.9_2199`). Documenting it so the same approach can extend
the catalogue to other models, or fill in the entries currently marked
`ASSUMED`.

## Approach

1. Subscribe to the device's MQTT status topic (the per-device `bindDomain`
   broker — see [`auth-flow.md`](./auth-flow.md)).
2. Seed a baseline by reading `siid 1..30` × `piid 1..50` and recording
   every value that returns `code: 0`.
3. Toggle a single setting in the Dreamehome app.
4. Diff the next MQTT push against the previous state — the changed siid/piid
   is the answer.
5. For multi-value enums, repeat for each option to map the full value space.

`examples/log-events.ts` automates the capture side — it runs as a
long-lived JSONL logger that records every property change, every MQTT
envelope, and every `ver` field flip in the device-list polling loop.

Single-property changes are unambiguous; multi-property changes need
multiple toggles to disambiguate by elimination.

## Confirmed mappings

### Robot service additions (siid 4)

| siid:piid | Constant | Type | Notes |
|---|---|---|---|
| 4.34 | `SELF_CLEAN` | bool | UI label "Auto Mop-Washing". |
| 4.37 | `MOP_WASH_DETERGENT_ENABLED` | bool | "Mop-Washing with Detergent" toggle. |
| 4.40 | `DRYING_TIME` | enum 2/3/4 | Hours; bounded enum. |
| 4.46 | `MOP_WASH_WATER_LEVEL` | enum 0/1/2 | WaterSaving/Standard/Deep. |
| 4.50 | `FEATURE_CONFIG_JSON` | json-string | Full settings panel mirror — see below. |
| 4.56 | `DETERGENT_DOSAGE_INT` | int | Co-fires with detergent toggle. |
| 4.57 | `DETERGENT_DOSAGE_STR` | string | String-typed twin of 4.56. |
| 4.61 | `WASHBOARD.COUNTDOWN_SECS` | int | 1Hz live countdown during dock cleaning. |
| 4.7  | `WASHBOARD.STEP` | int | Cycle step indicator (0 → 27 on start). |
| 4.64 | `SCHEDULE.EDIT_COUNTER` | int | +1 on every saved schedule edit. |

### DOCK_PROP block (siid 27 + siid 28)

| siid:piid | Constant | Type | Notes |
|---|---|---|---|
| 27.6  | `MAST_RAISED` | bool | The X50's elevating LiDAR mast. |
| 27.15 | `HEATER_ENABLED` | bool | Derived flag — tracks `MOP_WASH_TEMP > 0`. |
| 28.4  | `MOTION_FLAG` | bool | 1 while undocked / in motion. |
| 28.8  | `MOP_WASH_TEMP` | enum 0/1/2/3 | Normal/Mild/Warm/High. Heater follows. |
| 28.22 | `SMART_MOP_WASH` | bool | Master toggle that overrides manual settings. |
| 28.27 | `MOP_DRY_MODE` | bool | 0=Standard, 1=Mute. |
| 28.28 | `HAIR_COMPRESSION` | bool | Dock compacts collected hair. |

### AUTO_EMPTY_PROP block (siid 15)

| siid:piid | Constant | Type | Notes |
|---|---|---|---|
| 15.1 | `FREQUENCY` | enum 0/1/2/3 | Off / Standard / **High** / **Low** — non-monotonic. |
| 15.3 | `ON_DOCK_FLAG` | bool | 1 when robot is on the dock. |

### CAMERA additions (siid 10001)

| siid:piid | Constant | Type | Notes |
|---|---|---|---|
| 10001.9 | `FILL_LIGHT_BRIGHTNESS` | string-int 0–100 | "101" sentinel = auto/off. Slider is sqrt-shaped. |
| 10001.112 | `AI_DETECTION_FEED` | json-string @ ~10–30 fps | Real-time on-device object detection bbox feed. |

### Enum corrections vs Tasshack

- **`ChargingStatus`** — Tasshack's Mi-cloud values are wrong on r2532a:
  - `1 = Charging` (on dock with power)
  - `2 = Discharging` (off-dock; was wrongly labelled `ChargedComplete`)
  - `5 = Returning` (in transit to dock; was wrongly labelled `ChargingError`)

- **`SuctionLevel`** — same numeric values as Tasshack, but updated UI labels:
  Quiet / Standard / **Intense** / **Max** (Tasshack used Quiet/Standard/Strong/Turbo
  for older models).

- **`MiotState`** — values 5 (ReturningToCharge), 6 (Charging), 23 (RemoteCleaning),
  30 (CleanWashboardBase), 14 (Updating) were previously sourced only from the
  device's `keyDefine` translation file. Now upgraded to verified-by-observation.

### FEATURE_CONFIG_JSON keys catalogued

`siid 4 piid 50` is a single property holding a JSON-string array of `~36 {k, v}`
entries — a full mirror of the Dreamehome settings panel.

Confirmed (toggled and observed):
- `AutoDry` — Auto Mop-Drying (bool)
- `UVLight` — UV Sterilization (bool)
- `SmartAutoWash` — Auto Mop-Rewashing (-1 off / 1 deep-only / 2 always)

The other ~33 keys are documented with their string identifier and a guess
at meaning, marked `?`. See `FEATURE_CONFIG_KEYS` in `src/miot-spec.ts`.

**Dreame's "off" sentinel:** `-1` (NOT `0`) for multi-mode keys
(`SmartAutoWash`, `SmartAutoMop`, `MeticulousTwist`). Plain on/off booleans
use `0`/`1`.

## Behavioural findings

- **OTA channel:** firmware updates push `props` MQTT envelopes (NOT
  `properties_changed`) with `{ota_state, ota_progress}`. See
  [`ota-flow.md`](./ota-flow.md).
- **`_otc.info` pushes:** the device emits a periodic device-info envelope
  (hw_ver, fw_ver, model, ap{siid/ssid, bssid, rssi}, netif{localIp, mask, gw}).
  Surfaced as the typed `info` event on `DreameSubscription`.
- **Joystick / remote-control input does NOT echo via MQTT.** When a user
  drives the robot from the app's joystick, no `siid 4 piid 15` (REMOTE_CONTROL)
  property push lands. Strong evidence that joystick input uses a side-channel
  through the Aliyun video session, presumably for latency.
- **Camera stream** uses Aliyun LinkVisual (the device's `feature` is
  `"video_ali,fastCommand"`). Session metadata at `siid 10001 piid 1` includes
  `channelId`, `session`, `encryptionKey` — everything an Aliyun video SDK
  client would need. PIN is server-validated and never appears on this channel.
- **Device-side AI** runs ~10–30 fps object detection while the camera is
  active. Class id `160` appears repeatedly during dock-hunting, suggesting
  an "obstacle/unknown" class. Model catalog in `siid 99 piid 94`
  (`human v2.0.2`, `obstacle_instance v4.5.7`, platform `MR527`).
- **Some app settings don't push to the device at all** — auto-update toggle,
  "Mopping with Detergent" (note: distinct from "Mop-Washing with Detergent"
  which DOES push). Strongly suggests these are server-side account
  preferences, not device state.

## Schedule decoding (siid 8 piid 2)

The cleaning schedule format is a single dash-delimited string with a
*bimodal* config encoding depending on whether the schedule is using a
CleanGenius preset or a Custom config.

### String format (9 fields)

```
<id>-<enabled>-<HH:MM>-<weekdays>-<recurring>-<roomScope>-<wetness>-<config>-<rooms>
```

| Field | Meaning |
|---|---|
| 1 | schedule slot id |
| 2 | 0 = paused, 1 = active |
| 3 | trigger time `HH:MM` |
| 4 | 7-char Mon-Sun bitmap (`1111111` = daily) |
| 5 | 0 = one-shot, 1 = recurring |
| 6 | 0 = whole map, 1 = specific rooms |
| 7 | mop wetness (0 in non-Mop modes; 1-32 slider, 16 = Standard) |
| 8 | mode-dependent — see below |
| 9 | mode-dependent — see below |

### Field 8 / 9 encoding by schedule type

**CleanGenius preset** (`config` ≈ 128-255, small int):

```
config low byte = <bit 7 always-on> | <quality> | <mode>
  bit 4  (16) = Normal CleanGenius
  bit 5  (32) = Deep Cleaning
  bit 1  (2)  = Vac & Mop mode
  bit 2  (4)  = Mop after Vac mode
rooms = comma-list of segment IDs (e.g. "7,4,2,3") or "0" for whole map
```

**Custom mode (global)** (`config` is a large packed int):

| bits | meaning |
|---|---|
| 0–3 | Route — 1=Standard, 2=Intensive, 3=Deep, 4=Quick (small int) |
| 4–6 | Cleaning Mode — 1=Vac, 2=Vac+Mop, 3=Mop, 4=MopAfterVac |
| 7 | unobserved |
| 8–23 | undecoded — `0xC249` constant in all observations (suspected: defaults / per-room overrides not exercised) |
| 24–25 | Suction — 0=Quiet, 1=Standard, 2=Intense, 3=Max |
| 26–27 | unobserved |
| 28–31 | Cycle count — plain int 1-N |

`rooms = "0"` (always — per-room data is in the per-room variant below).

**Custom mode (per-room)** (config = `0`, rooms = comma-list of packed
per-room ints):

```
schedule string: ...-0-0-<perRoomConfig1>,<perRoomConfig2>,...
```

Each per-room int embeds *both* the segment ID and the per-room settings.
**Layout NOT YET DECODED** — see [issue #1](https://github.com/malard/node-dreame/issues/1).

### Behavioural findings during schedule edits

- `siid 4 piid 64` is an **edit counter** — bumps by 1 every Save tap.
  Useful to detect "schedule changed" without diffing the full string.
- `siid 4 piid 7` ("STEP") and `siid 4 piid 61` (countdown seconds) emit
  live during the dock's washboard-cleaning cycle. The countdown ticks at
  1Hz from the device — the app's timer is true device feedback, not a
  UI estimate.
- Verified `MiotState.CleanWashboardBase = 30` by observation (the dock
  cycle puts the device in this state).
- Schedules only push to MQTT on **Save** — partial edits do not commit,
  so any test must include the Save action.
- Routes available depend on the active cleaning mode (e.g. Deep route
  only valid in Mop-only mode — switching to Vac+Mop force-resets route
  to Standard).

## What's still unverified

- **`TASK_STATUS` (siid 4 piid 1)** — values 3, 6, 13, 14, 17, 23 observed
  in different states but no clean enum mapping yet. Different value space
  from the verified MiotState (siid 2 piid 1).
- **`CLEANING_MODE` (siid 4 piid 23)** — returns 5120 baseline; clearly a
  packed bitfield but layout undecoded.
- **`siid 99 piid 98`** — base64-zlib blob that updates frequently.
  Telemetry / map-diff. Decoding deferred.
- **`siid 6 piid 1`** — large compressed binary updated during navigation.
  Almost certainly live SLAM/map data; the path to a live map view, but a
  much bigger project (Tasshack's map decoder is ~5k lines).
- **The Washboard Base Auto-Clean action** (likely siid 4 aiid 4 =
  `START_WASHING`) — observed firing from the app (produced `MiotState=30`
  and the live countdown) but not yet verified callable from this lib.
- **Per-room schedule packing** — see [issue #1](https://github.com/malard/node-dreame/issues/1).
- **Bits 8-23 of the global Custom packed int** — constant `0xC249` across
  every observation. Likely encodes things we didn't toggle (per-room
  defaults, mop-pad overrides, AI settings, etc.).
