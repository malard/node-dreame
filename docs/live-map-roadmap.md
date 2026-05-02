# Live Map — Roadmap

> **Status:** Phases 0-2 done; Phase 3 (Cloud OSS fetch helper / wiring
> into a manager) is the next deliverable.
> Source of binary-format truth is
> [`Tasshack/dreame-vacuum`](https://github.com/Tasshack/dreame-vacuum)
> on the **`dev` branch** (commit `bba1d35`, v2.0.0b23) — specifically
> `custom_components/dreame_vacuum/dreame/map.py` (~13k LOC) and the dataclass
> definitions in `dreame/types.py`.
>
> This document is the briefing for a fresh Claude instance to execute the
> port. Read it end-to-end before touching code.

## Phase 0 findings (verified on r2532a, 2026-05-02)

Captured 27 sequential live-map blobs from r2532a's `siid 6 piid 1`
(`MAP_DATA`) MQTT channel via `examples/capture-map-fixtures.ts`. Hard
answers to several open questions in this doc:

- **AES is NOT applied on this channel.** The blobs are plain
  `base64 → zlib`. First inflated bytes are the 27-byte header — no
  decrypt step needed. The "AES IV unknown for r2532a" open question is
  moot for `MAP_DATA`. (Other channels — OSS-fetched POINTER_JSON blobs,
  obstacle photos — may still be encrypted; not yet observed.)
- **r2532a runs in `fsm: 1` (frame-map mode).** Pixel-grid decoder must
  use **path B** (bits 7-2 = segment_id, bits 1-0 = meta), NOT path A
  (the standard-LIDAR layout). The roadmap's Phase 1 step 4 assumption
  ("assume `fsm != 1` ... until we have a fixture proving otherwise")
  is overturned — start with path B from day one.
- **All 27 captured fixtures are P-frames** (`frame_type == 80`), single
  `map_id == 3`, sequential `frame_id 584..610`. Excellent P-frame chain
  for Phase 2 merge testing. **No I-frame in the window** — to capture
  one, restart the device's MQTT session or trigger a map-state reset
  (e.g. "Save map" in the Dreamehome app, or switch floors).
- **Header parses correctly** with the layout in this doc. Sample
  decoded values: `width=157`, `height=115`, `grid_size=50` (5cm/px),
  `left=-7200`, `top=2450`, `robot=[-1118, 4544, 254°]`,
  `dock=[-137, 1936, 178°]`. Dimensions and coords are sane.
- **JSON tail has additional keys not in the cheat-sheet table:**
  `sneak_areas` (looks like the no-go-zone equivalent), `cs`, `mtid`,
  `curid`, `moptype`. None block v1; document as you encounter them in
  Phase 1.
- **`ai_obstacle` records have ~14 positional fields** on r2532a, e.g.
  `["-1313.026123","3011.018555","160","0.749496","1777753386.646569",
  "/data/record/ai_image/1777753386646569_6.jpg","19729854450",
  "0.681641","0.299603","0.315048","0.280838","2","0","4"]`. Field
  positions 0-3 (x, y, type, confidence) and 5-6 (photo path + photo id)
  align with the roadmap. The bbox-looking quartet at positions 7-10
  (normalized 0..1) is plausible but unverified. Fields 11-13 are
  unknown small ints. Cross-check Tasshack `map.py:4528-4595` during
  Phase 1.

Fixtures live in `test/fixtures/map/` (gitignored) — `001` to `027`
named `<seq>-piid<piid>-unknown.{bin,meta.json}`. The `unknown` frame
tag is wrong on these — the capture script (now fixed) was reading
byte-4 of the *compressed* payload. Future captures will be tagged
correctly; the existing 27 fixtures are all P-frames.

## Phase 1 status (2026-05-02)

`src/map/decoder.ts` ships the pure decoder per the original Phase 1 plan.
Public API is `MapDecoder.decode(input, opts?)` returning `MapData`. All
sub-functions are exported individually for testing.

**Validated end-to-end against a real I-frame** captured later in the
same session (348×470 grid covering ~17m × 23m, 10 segments, 32
obstacles, sensible bboxes/centroids). Plus the original P-frame
fixture for header/tail/obstacle round-trip.

`src/map/request.ts` ships the active-pull helpers `requestIFrame()`
and `requestPFrame()` so consumers don't have to wait for the device's
own emission cycle. No availability gating — assume modern firmware.

## Phase 2 status (2026-05-02)

`src/map/merge.ts` ships `mergePFrame(prevInflated, pFrameInflated)`
and `mergePFrameEnvelope(prev, pframe, prevOpts?, pframeOpts?)`. A
sugar wrapper `MapDecoder.applyPFrame(prev, pframe, opts?)` returns
`{ buffer, data }` so callers can chain merges and get a decoded
`MapData` in one call.

The merge re-stamps the resulting frame as `frame_type = I` (73) before
returning. This is a hard contract: the decoder deliberately skips the
pixel-grid pass on P-frames (the raw bytes are byte-add deltas, not
absolute classifications), so the merged buffer must look like an
I-frame for the public `decode()` to round-trip cleanly.

JSON tail merge rules:
- P-frame tail wins for keys present in both (timestamp_ms, robot,
  charger, mra, ai_obstacle, sa, etc. — all current state)
- `tr` (cleaning path) is concatenated `prev.tr + p.tr` — the path is
  incremental. The `parsePathTr` regex already normalises the lowercase
  `l` line-continuation op P-frames use, so plain string concatenation
  is correct.
- `seg_inf` and `sa` fall back to prev's value when P doesn't carry one
  (typical — most P-frames don't re-send segment metadata).
- `origin` is overwritten with the union origin.

`OutOfOrderFrameError` is thrown when `pframe.frameId !== prev.frameId + 1`.
The Phase 4 manager will use this to queue or trigger a re-request via
`requestPFrame(client, did, { mapId, frameId })`.

Validated end-to-end against a real fixture chain: I-frame at
`frame_id=1264` followed by 23 contiguous P-frames (`1265..1287`), 14
of which were zero-bbox (no spatial change, only robot/obstacle state
update). Across the chain: dimensions stable at 348×470, segment count
stable at 10, robot pose tracks each P-frame, cleaning path grows
monotonically (2665 → 2678 points), no `OutOfOrderFrameError`, and the
new carpet overlay layer surfaces ~810 runs.

### Carpet pixels are now their own overlay layer

`MapLayerType` is extended to `"wall" | "floor" | "segment" | "carpet"`.
The carpet flag (path B low-bits=11 in fsm:1 mode) is independent of
the primary classification — a pixel can be `floor + carpet` or
`segment 5 + carpet`. The decoder emits a `carpet` layer alongside the
primary layers, run-length encoded the same way. Renderers that don't
understand `carpet` ignore it (additive change); ones that do can paint
a carpet texture on top of whatever colour the primary layer chose.

## I-frames live in OSS, not the inline channel (verified 2026-05-02)

This was the biggest mid-Phase-1 finding and overturns part of the
original architecture. The roadmap above implies the I-frame arrives on
`siid 6 piid 1` (MAP_DATA) like P-frames. **It does not.**

What actually happens on r2532a:
- The device pushes P-frames continuously on `siid 6 piid 1` (live
  delta stream).
- The current I-frame is parked in OSS. Its object name is advertised
  via `siid 6 piid 3` (PATH push) — typically as the first push on a
  fresh subscription, format `ali_dreame/<uid>/<did>/<n>`.
- Calling the `REQUEST_MAP` action with `force_type: 1` causes the
  device to refresh the OSS-stored I-frame and reset the P-frame chain
  (frame_id resets toward the new I-frame's frame_id).

To fetch the I-frame: resolve the PATH object to a signed URL via
`POST /dreame-user-iot/iotfile/getDownloadUrl` (Tasshack
`protocol.py:651-664`), then GET the URL. The OSS body is the same
URL-safe base64 envelope as the live channel (NOT raw zlib bytes) and
unwraps with `MapDecoder`'s existing `unwrapEnvelope`.

Endpoint shape:
- Path: `/dreame-user-iot/iotfile/getDownloadUrl` (host: same regional
  api host as auth)
- Method: POST, JSON body
- Body: `{"did": <did>, "model": <model>, "filename": <obj_name>, "region": "<country>"}`
- Response: `{"code": 0, "data": "<signed-url-string>"}` — `data` is
  the URL string itself, not a nested object.

For permanent / saved-map blobs (different from live I-frames) the
endpoint is `/dreame-user-iot/iotfile/getOss1dDownloadUrl` with the
`filename` having its leading character stripped. v1 doesn't use this.

## Variable P-frame dimensions (verified 2026-05-02)

P-frame width/height in the 27-byte header are NOT the global map
dimensions — they're the bounding box of the changed region for that
frame. Frames with no spatial change have `width=0, height=0` (header
+ JSON tail only). Phase 2's merge logic must take the union of the
prev I-frame's dimensions with each P-frame's bbox before merging.

## Goal

Decode Dreame's encrypted/compressed live-map binary into structured JSON so
that a web UI can render walls, segments, the robot pose, the
dock, the cleaning path, and obstacles in the browser.

**Out of scope for v1:** server-side image rendering. The browser does the
drawing. We never produce PNGs.

## Top-level decisions (already taken — do not re-litigate)

| Decision | Choice | Why |
|---|---|---|
| Render path | Binary → structured JSON, render in browser | Interactive (click-to-clean, zoom, themes), and avoids porting ~5k lines of PIL. |
| Cloud target | Dreamehome native cloud only | node-dreame's whole reason to exist; Mi-cloud support stays Tasshack's job. |
| v1 entities | walls + segments + robot pose + dock + cleaning path + obstacles | Enough to render a useful live view. No-go zones / virtual walls / multi-floor / VSLAM optimization deferred to v2+. |
| Package layout | Same package, sub-export `node-dreame/map` | Users who don't import map code don't pay the dependency cost. |
| Output schema | Custom node-dreame shape (NOT Valetudo-format) | Valetudo coords are pre-Y-flipped and pre-cm-shifted for their renderer; we want raw mm world-frame so the web client can transform once. |

## Architecture

```
         ┌─────────────────────────────────────────────────────┐
         │  DreameDevice / DreameSubscription  (existing)      │
         │  ─────────────────────────────────────────────────  │
         │  emits MQTT property pushes for siid 6 piid 1/3/8   │
         └───────────────────┬─────────────────────────────────┘
                             │
                             ▼
         ┌─────────────────────────────────────────────────────┐
         │  MapManager  (new — src/map/manager.ts)             │
         │  ─────────────────────────────────────────────────  │
         │  - watches relevant property pushes                  │
         │  - resolves OSS object names → URLs (Dreamehome cloud)│
         │  - downloads blobs                                   │
         │  - feeds blobs to MapDecoder                         │
         │  - holds the current MapData, applies P-frame diffs  │
         │  - emits 'map' events to consumers                   │
         └───────────────────┬─────────────────────────────────┘
                             │
                             ▼
         ┌─────────────────────────────────────────────────────┐
         │  MapDecoder  (new — src/map/decoder.ts)             │
         │  ─────────────────────────────────────────────────  │
         │  pure function: bytes → MapData                      │
         │  no state, no IO, fully testable from fixtures       │
         └─────────────────────────────────────────────────────┘
```

## Binary format reference (cheat sheet)

This is condensed. See [`docs/live-map-format.md`](#) (TODO: file when porting)
for the exhaustive reference. Source line numbers below refer to Tasshack
**`dev`** branch `dreame/map.py`.

### Outer envelope

```
input string
   │
   │ replace '_' → '/', '-' → '+'                  # URL-safe → standard b64
   │                                                # map.py:3762
   │
   │ if ',' in input AND no key supplied:
   │     key = part_after_comma
   │                                                # map.py:3767-3770
   │
   ▼
base64 decode                                       # map.py:3772
   │
   ▼
optional AES-256-CBC decrypt                        # map.py:3774-3789
   │   key = sha256(<key>).hexdigest()[0:32].encode("utf-8")
   │         (32 ASCII hex chars used as key bytes — NOT raw sha256.digest())
   │   iv  = <16-byte ASCII string from capability.key>
   │   no PKCS padding stripped (relies on zlib tolerating tail)
   │
   ▼
zlib inflate                                        # map.py:3792
   │
   ▼
27-byte header  +  width*height pixel grid  +  UTF-8 JSON tail
```

**AES is gated by whether the device-info table assigned a key.** Dreamehome
cloud blobs are typically encrypted; Mi-cloud LIDAR blobs are typically not.
The per-blob key arrives appended to the OSS object name with a comma:
`<obj>,<key>`. Parse this before passing to the decoder.

### 27-byte header (little-endian int16 throughout, except `frame_type`)

| Offset | Size | Field | Meaning |
|---|---|---|---|
| 0 | 2 | `map_id` | int16 LE |
| 2 | 2 | `frame_id` | int16 LE |
| 4 | 1 | `frame_type` | int8: `I=73` full snapshot, `P=80` diff, `W=87` wifi |
| 5 | 2 | `robot.x` | int16 LE, mm world-frame |
| 7 | 2 | `robot.y` | int16 LE, mm |
| 9 | 2 | `robot.a` | int16 LE, degrees. **`32767` (0x7FFF) = absent** |
| 11 | 2 | `charger.x` | int16 LE |
| 13 | 2 | `charger.y` | int16 LE |
| 15 | 2 | `charger.a` | int16 LE. Same `32767` sentinel |
| 17 | 2 | `grid_size` | int16 LE, **mm per pixel** |
| 19 | 2 | `width` | int16 LE, pixels |
| 21 | 2 | `height` | int16 LE, pixels |
| 23 | 2 | `left` | int16 LE, mm — world-x of pixel column 0 |
| 25 | 2 | `top` | int16 LE, mm — world-y of pixel row 0 |

JSON tail's `origin: [x, y]` may override `left`/`top`.

### Pixel grid (the hardest bit)

`width * height` bytes, row-major, **one byte per pixel**. World-coord of
pixel `(x, y)` is `(left + x*grid_size, top + y*grid_size)`.

The byte layout depends on context — there are **three distinct decoders**:

#### A. Standard LIDAR map (the common path)

```
bit 7    : wall flag       (1 = wall / outside-room)
bit 6    : carpet flag     (1 = carpet pixel)
bits 5-0 : segment_id      (1..63, 0 = no segment)
```

Decoder logic (map.py:4120-4135):
- `pixel == 0` → outside
- `pixel >> 7 == 1` and `segment_id == 0` → wall
- `pixel >> 7 == 1` and `segment_id > 0` → "wall-of-segment-N" marker (rendered as wall, but tagged with segment for room-bounds inference)
- `pixel >> 7 == 0` and `segment_id > 0` → floor inside segment N
- carpet flag `(pixel & 0x40) != 0` is independent of the above

#### B. Frame map mode (`fsm == 1` in JSON tail) — map.py:4066-4089

```
bits 7-2 : segment_id  (pixel >> 2)   range 1..63
bits 1-0 : meta:
   00 = floor / unknown context
   01 = NEW_SEGMENT marker (when high bits zero)
   10 = WALL marker        (when high bits zero)
   11 = CARPET flag
```

Special segment IDs (top 6 bits): `63=WALL`, `62=FLOOR`, `61=UNKNOWN`,
`1..60` = real segments.

#### C. VSLAM / unsaved map

Similar to B but uses lower nibble for floor/wall markers and `& 0x3F` (or
`& 0x7F`) for segment id. Needed only if we ever support non-LIDAR vacuums —
**SKIP for v1**.

### JSON tail

UTF-8 JSON object immediately after pixel data. Parsed by `json.loads`. Field
list is exhaustive in the `MapData` dataclass at `types.py:4151-4286` — every
field carries an inline `# Data json: <key>` comment naming its source key.

Critical keys for v1:

| JSON key | Field | Notes |
|---|---|---|
| `timestamp_ms` | timestamp | for staleness detection |
| `origin` | `[left, top]` | overrides header |
| `mra` | rotation | int degrees |
| `oc` | docked | bool |
| `nc` / `nr` | no charger / no robot | nullability |
| `tr` | path string | regex `(?P<op>[MWSLl])(?P<x>-?\d+),(?P<y>-?\d+)` — ops: M=mop, W=sweep+mop, S=sweep, L=line moveTo, `l` (lower) = P-frame line continuation (rewrite to `L`) |
| `sa` | active segments | `[[id], ...]` |
| `seg_inf` | segment metadata | per-id `{nei_id, type, name(b64), material, direction, ...}` |
| `ai_obstacle` | obstacles | `[[x, y, type, possibility, id, ...], ...]` |
| `vw.line` | virtual walls | `[[x0,y0,x1,y1], ...]` — v2 |
| `vw.rect` | no-go areas | v2 |
| `cleanareaorder` | cleaning sequence | v2 |
| `whm` | embedded wifi map | recursive blob — skip v1 |
| `rism` | embedded saved map | recursive blob — skip v1 |
| `decmap` | embedded cleaning map | recursive blob — v2 (cleaned-area overlay) |

### Frame types & P-frame merging

- **I-frame** (`frame_type == 73`): full snapshot. Replace state.
- **P-frame** (`frame_type == 80`): partial diff. Allocate buffer big enough
  for `union(current.dimensions, new.dimensions)`, copy current bytes in,
  then **byte-add** new bytes at new offset (`out[i] = (cur[i] + new[i]) & 0xFF`,
  intentional wrap), then re-classify each touched pixel via the decoder.
  Robot/charger position from header overwrites. Path is **appended**
  (`current.path.extend(new.path)`). Frame ID must equal
  `current_frame_id + 1` — out-of-order P-frames are queued.
  See map.py:5018-5070.
- **W-frame** (`frame_type == 87`): wifi map. Skip v1.

### Coordinate system

- **mm, world-frame.** `robot.x = +1500` is 1.5 m to the right of world
  origin.
- **Y is NOT inverted in the binary.** Tasshack's renderer flips Y for
  rendering (`MAX - y/10` at map.py:5816). We will **emit raw mm** and let
  the browser flip if its rendering library wants origin top-left vs
  bottom-left.
- **Angles in degrees.** Tasshack rotates them for rendering; we leave them raw.
- **Grid units vs mm.** Pixel coords are grid-cell indices; multiply by
  `grid_size` and add `left`/`top` to get mm.

## v1 output schema (the contract)

This is what `MapDecoder.decode()` returns. Designed to be the minimum a
browser needs to render walls + segments + robot + dock + path + obstacles.

```ts
interface MapData {
  // Identity
  mapId: number;
  frameId: number;
  frameType: 'I' | 'P' | 'W';
  timestamp: number;          // ms since epoch (from JSON tail)
  rotation: number;           // degrees, applied by client if rendering rotated

  // World transform — every coordinate below is in mm, world-frame
  dimensions: {
    left: number;             // mm, world-x of pixel column 0
    top: number;              // mm, world-y of pixel row 0
    width: number;            // pixels
    height: number;           // pixels
    gridSize: number;         // mm per pixel
  };

  // Robot/dock state
  robot: { x: number; y: number; angle: number } | null;   // null if absent
  dock:  { x: number; y: number; angle: number } | null;
  docked: boolean;

  // Spatial layers — one entry per non-trivial pixel-class run
  // Format: { type, runs: Array<[xPixel, yPixel, length]> }
  // Three layers: 'wall', 'floor', and one per segment id
  layers: Array<{
    type: 'wall' | 'floor' | 'segment';
    segmentId?: number;       // only when type='segment'
    runs: Array<[number, number, number]>;   // run-length encoded, pixel coords
  }>;

  // Segments (rooms)
  segments: Array<{
    id: number;
    name: string | null;      // from seg_inf.name (base64-decoded)
    bbox: { xMin: number; yMin: number; xMax: number; yMax: number };  // mm
    centroid: { x: number; y: number };   // mm — for label placement
    neighbours: number[];     // adjacent segment ids
    floorMaterial: number | null;
    floorDirection: number | null;
    active: boolean;          // from sa
  }>;

  // Cleaning path — broken into runs by op type
  // Coords in mm. M = absolute moveTo for that op type.
  paths: Array<{
    type: 'mop' | 'sweep' | 'sweep-and-mop' | 'line';
    points: Array<{ x: number; y: number }>;
  }>;

  // AI-detected obstacles
  obstacles: Array<{
    id: number;
    x: number; y: number;     // mm
    type: number;             // ObstacleType enum value (carry through, decode in client)
    confidence: number;       // 0-100
    photoFileName: string | null;
    photoKey: string | null;  // AES key for photo decryption (separate from map key)
  }>;

  // v2: no-go zones, virtual walls, no-mop, multi-floor, cleaned-area overlay
}
```

**Why not Valetudo-format:** Valetudo applies an irreversible coordinate
shift (`(x_mm + 32768) / 10`) and Y-flip in the encoder. Reversing those in
the browser is annoying. Emitting raw mm world-frame keeps the schema
self-describing and lets the renderer transform exactly once.

## Phased plan

### Phase 0 — Setup & test fixtures (~1 hour)

- Create `src/map/` directory with stub `decoder.ts`, `manager.ts`,
  `types.ts`.
- Add `vitest` test file `test/map.decoder.test.ts`.
- **Capture real fixtures from r2532a** by extending
  `examples/log-events.ts` to dump the raw `siid 6 piid 1/3/8` payloads to
  `test/fixtures/map/<n>.bin` (one file per envelope) plus a
  `test/fixtures/map/<n>.meta.json` with the AES key and IV used.
  - Need at least: 1 I-frame on Dreamehome cloud (encrypted), 1 P-frame, 1
    `MAP_LIST` OSS-pointer envelope.
  - These fixtures are the ground truth — every later phase tests against
    them.
- Fixtures may contain sensitive metadata (object names, MD5s). Add
  `test/fixtures/map/` to `.gitignore` until we have a sanitization pass.

### Phase 1 — Pure decoder, no IO (~4-6 hours)

Build `MapDecoder.decode(bytes, opts: { iv?, key? }): MapData`. Pure function,
no network, no MQTT, no state. Phases of work inside this:

1. **Envelope unwrap** (~30 min)
   - URL-safe → standard base64
   - Comma-split for embedded key
   - base64 decode
   - AES-256-CBC decrypt (Node's `crypto` module — `createDecipheriv('aes-256-cbc', key, iv)`, `setAutoPadding(false)`)
   - zlib inflate (`zlib.inflateRawSync` or `inflateSync` — try both, Tasshack uses Python's `zlib.decompress` which auto-detects)
   - Test: hand-verify against one captured I-frame.

2. **Header parse** (~30 min)
   - Read 27 bytes via `Buffer.readInt16LE` etc. Mind the sentinel
     `0x7FFF` for missing positions.
   - Test: verify against fixture.

3. **JSON tail parse** (~30 min)
   - Slice from `27 + width*height` onwards as UTF-8.
   - Validate origin override.
   - Decode segment names from `seg_inf.<id>.name` base64.

4. **Pixel grid → layers** (~2 hours)
   - Standard-LIDAR decoder first (path A above) — assume `fsm != 1` and
     non-VSLAM until we have a fixture proving otherwise on r2532a.
   - For each pixel, classify into `wall` / `floor` / `segment(id)`.
   - Emit run-length encoded layers (sorted by `(y, x)`, runs of same
     classification on same row become `[xStart, y, length]`).
   - Test: pixel-by-pixel diff against a Tasshack-decoded reference (run
     Tasshack against the same fixture in Python, dump `pixel_type`
     ndarray, compare).

5. **Segments from pixel grid** (~1 hour)
   - Scan `pixel_type` array, for each id 1..63 collect bbox + centroid.
   - Merge `seg_inf` metadata.
   - Test: room count + bbox match Tasshack's output.

6. **Path parsing** (~1 hour)
   - Regex on `tr` field: `/([MWSLl])(-?\d+),(-?\d+)/g`.
   - Group consecutive `L` ops into one path entity per `M`/`W`/`S`/`L`
     op-class.
   - Lowercase `l` is a P-frame line continuation — treat as upper-case
     `L` (Tasshack rewrites at map.py:3987).
   - Test: visual inspection by plotting in node REPL.

7. **Obstacles** (~30 min)
   - Parse `ai_obstacle` array. Each entry is a positional list, see
     map.py:4528-4595 for field-by-field shape.
   - Carry through enum values; client decodes labels.

**Phase 1 exit criteria:** decoder produces a complete `MapData` JSON for
the captured I-frame fixture, byte-equivalent (modulo float rounding) to a
hand-verified reference.

### Phase 2 — P-frame merging — DONE (2026-05-02)

Shipped in `src/map/merge.ts`. See "Phase 2 status" block at the top
for the full contract. Brief recap of what diverged from this section
of the original plan:

- API surface: the merge takes/returns **inflated buffers**, not
  `MapData`. `MapDecoder.applyPFrame(prev, pframe)` is the sugar that
  decodes the result, returning `{ buffer, data }`. This keeps the
  pixel-grid bytes available for the next merge without a re-encode.
- The merged frame is **re-stamped as `frame_type = I`** so the
  existing pixel decoder runs on it. The roadmap originally said
  "re-classify the touched region", but in practice the entire grid
  has to be re-classified after a byte-add (segment ids on adjacent
  pixels can shift) and the existing decoder already does that — no
  reason to duplicate the loop.
- `tr` path is **concatenated**, not parsed/merged. The `parsePathTr`
  regex already normalises lowercase `l` continuation ops so the
  concatenation Just Works.
- The carpet pixel overlay (low-bits=11 in fsm:1) was a v1 contract
  gap. Resolved as: extend `MapLayerType` with `"carpet"` and emit a
  parallel run-length layer. Additive — old renderers ignore it.

### Phase 3 — Cloud OSS fetch (Dreamehome) (~2-3 hours)

`src/map/oss-fetch.ts`:

1. **Resolve object name → URL.** Endpoint:
   `POST /v2/home/get_interim_file_url_pro` (Tasshack `protocol.py:1162`).
   Body: `{"obj_name": "<obj_name>"}`. Headers: existing
   `dreame-auth: bearer <token>` from the auth flow.
   Response: `{"result": {"url": "<signed-aliyun-url>"}}`. Falls back to
   non-`_pro` endpoint on `code == -8`.
2. **HTTP GET the signed URL.** No special headers; Aliyun-signed.
3. **30-minute URL cache** — cache by `obj_name`, return the same URL with
   `?current=<unix_ts>` appended on cache hit.
4. **For permanent files** (recovery maps): `POST /home/getfileurl_v3`,
   body `{"obj_name": "<name>"}`. Same response shape.

Test: mock the cloud endpoint, verify request shape; integration test
against a real captured `obj_name` if cloud is reachable.

### Phase 4 — MapManager (~3-4 hours)

`src/map/manager.ts` — bolted on to `DreameDevice`. Subscribes to:

- `siid 6 piid 1` (`MAP_DATA`) — inline blob, decode immediately.
- `siid 6 piid 3` (`PATH`) — already in node-dreame as `CLOUD_OBJ_PROP.PATH`. Re-purpose / clarify.
- `siid 6 piid 8` (`POINTER_JSON`) — `{obj_name, md5}`. Fetch via OSS, decode.
- `siid 6 piid 13` (`OLD_MAP_DATA`) — `"<flag>,<inline-or-objname>[,key]"`. Disambiguate by leading flag (`0` = inline, `1` = OSS).

Manager state:

```ts
class MapManager extends EventEmitter {
  current: MapData | null = null;
  currentMapId: number | null = null;
  currentFrameId: number | null = null;
  pendingPFrames: MapDataPartial[] = [];     // queue out-of-order

  on('map', (md: MapData) => void);          // emitted on every successful decode
  on('error', (err: MapError) => void);
}
```

Frame sequencing:
- I-frame: replace state, drain queue.
- P-frame with expected `frameId`: apply, advance, drain queue.
- P-frame too-far-ahead: queue. If queue size > 4, request the missing
  P-frame (`MAP_RECOVERY` action, see map.py:550). If > 8, request a full
  I-frame.
- Stale frames (timestamp < current): drop silently.

Test with replay of captured fixtures in time-order.

### Phase 5 — Public API & sub-export (~1 hour)

```ts
// src/index.ts (no change for users who don't want maps)
export { DreameClient } from './client.js';

// src/map/index.ts (sub-export node-dreame/map)
export { MapDecoder } from './decoder.js';
export { MapManager } from './manager.js';
export type { MapData, ... } from './types.js';
```

Wire `MapManager` to `DreameDevice` via an optional `device.map` getter that
constructs the manager lazily — users who don't access `.map` don't pay.

`package.json` `exports` field:

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./map": "./dist/map/index.js"
  }
}
```

### Phase 6 — Browser rendering (out of scope for this lib)

A consumer rendering `MapData` in the browser would typically:

1. Subscribe to `MapManager` events through whatever transport the
   consuming app uses.
2. Render in-browser via Canvas or SVG.
3. Coordinate transform: `screen_x = (mm_x - left) / gridSize * pixelScale`,
   `screen_y = (mm_y - top) / gridSize * pixelScale` (or flipped Y depending
   on choice).
4. Layers as paths (walls), filled regions (segments by id → colour map),
   robot sprite, dock sprite, path polyline.

Not part of this roadmap beyond ensuring the JSON shape is browser-friendly.

## Open questions / things the executor must decide

1. ~~**AES IV source on Dreamehome cloud.**~~ **RESOLVED for `MAP_DATA`
   channel** (Phase 0 finding above): no AES applied, blobs are plain
   `base64 → zlib`. May still apply to OSS-fetched blobs (POINTER_JSON,
   OLD_MAP_DATA flag=1) and obstacle photos — re-open if those surface
   encrypted bytes.

2. **Multi-floor support priority.** The X50 supports multiple maps
   (`MULTI_FLOOR_MAP` capability). v1 schema can hold one map; multi-floor
   would mean MapManager keys state by `mapId`. Defer to v2 unless a
   consumer needs it day one.

3. **VSLAM path C decoder.** r2532a is LIDAR, so we'll never hit it.
   Document as "not implemented" and throw if `fsm == 1` AND we detect
   VSLAM markers, rather than silently mis-decoding.

4. **Saved-map list / recovery-map list.** v1 only handles live maps. The
   `MAP_LIST` (siid 6 piid 8) is the OSS pointer to the saved-map LIST —
   different from a live frame. v1 ignores it; v2 fetches it for "switch
   floor" UX.

## Reference: Tasshack file:line landmarks

Every line number is on `dev` branch `bba1d35`.

| Topic | Location |
|---|---|
| Outer envelope (b64 → AES → zlib) | `map.py:3759-3792` |
| Header parse | `map.py:3950-3995` |
| Standard pixel decode | `map.py:4120-4135` |
| Frame-map pixel decode | `map.py:4066-4089` |
| VSLAM pixel decode | `map.py:4090-4119` |
| Path regex / parse | `map.py:3970-4005` |
| Segment construction | `map.py:5278-...` (`get_segments`) |
| P-frame merge | `map.py:5018-5070` |
| Obstacle parse | `map.py:4528-4595` |
| OSS URL resolve (Dreamehome) | `protocol.py:1162` (`get_interim_file_url_pro`) |
| OSS URL resolve (permanent) | `protocol.py:1150` (`getfileurl_v3`) |
| Frame queueing logic | `map.py:475-550, 686-960` |
| AES IV source per model | `types.py:2879` (`device_info` table) |
| `MapData` field-by-field | `types.py:4151-4286` |
| `MapPixelType` enum | `types.py:4086-4100` |
| `MapFrameType` enum | `types.py:4079` |
| `ObstacleType` enum (32 values) | `types.py:2409` |
| `PathType` enum | `types.py:3175` |

## Checklist for the executor

Before starting:

- [ ] Have you got the `dev` branch of Tasshack/dreame-vacuum cloned
  locally? (`git clone --branch=dev https://github.com/Tasshack/dreame-vacuum.git`).
  Verify with `git -C <path> branch -vv` — should show `* dev`.
- [ ] Have you read this whole document?
- [ ] Have you read `docs/auth-flow.md` and `docs/ota-flow.md` for context
  on the existing transport layer?
- [ ] Do you have a r2532a available for fixture capture, OR do you have
  fixtures already in `test/fixtures/map/`?
- [ ] Is the AES IV for r2532a known? If not, plan for Phase 0 expansion.

During each phase:

- Test against fixtures before moving to the next phase.
- Cross-check decoded output against Tasshack's Python output for the
  same fixture (run `python -c "from custom_components.dreame_vacuum.dreame.map import DreameVacuumMapDecoder; ..."`
  on the fixture, dump `MapData.__dict__`).
- Update this roadmap if decisions change. Don't silently diverge.

After v1:

- [ ] Sanitization pass on fixtures so they can be committed.
- [ ] Decide v2 priorities with user.
