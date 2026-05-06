# Live Map — Binary Format Reference

What follows is the binary wire format Dreame uses for live-map data —
the bytes you get when you decode `siid 6 piid 1` (`MAP_DATA`),
`siid 6 piid 3` (`PATH`), and `siid 6 piid 8` (`POINTER_JSON`)
payloads, and the OSS blobs they reference. The reference is
condensed but exhaustive enough to maintain `src/map/decoder.ts` and
`src/map/manager.ts` against a moving target.

Source-of-truth line numbers in the tables below are against
[`Tasshack/dreame-vacuum`](https://github.com/Tasshack/dreame-vacuum)
on the **`dev` branch** (`custom_components/dreame_vacuum/dreame/map.py`
and `dreame/types.py`). Always check `dev`, not `master` — `master`
is hundreds of commits behind and missing the Dreamehome native cloud
support.

## Architecture

```
         ┌─────────────────────────────────────────────────────┐
         │  DreameSubscription                                 │
         │  emits MQTT property pushes for siid 6 piid 1/3/8   │
         └───────────────────┬─────────────────────────────────┘
                             │
                             ▼
         ┌─────────────────────────────────────────────────────┐
         │  MapManager  (src/map/manager.ts)                   │
         │  - watches relevant property pushes                 │
         │  - resolves OSS object names → URLs                 │
         │  - downloads blobs                                  │
         │  - feeds blobs to MapDecoder                        │
         │  - holds the current MapData, applies P-frame diffs │
         │  - emits 'map' events to consumers                  │
         └───────────────────┬─────────────────────────────────┘
                             │
                             ▼
         ┌─────────────────────────────────────────────────────┐
         │  MapDecoder  (src/map/decoder.ts)                   │
         │  pure function: bytes → MapData                     │
         └─────────────────────────────────────────────────────┘
```

## Outer envelope

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

AES is gated by whether the device-info table assigned a key. The
inline `siid 6 piid 1` `MAP_DATA` channel observed on Dreamehome
cloud (LIDAR vacuums, e.g. `dreame.vacuum.r2532a`) is **not**
encrypted — blobs are plain `base64 → zlib`. OSS-fetched blobs
(POINTER_JSON, OLD_MAP_DATA flag=1) and obstacle photos may still
be encrypted — re-open if those surface non-zlib bytes after the
b64 decode.

When AES is in play, the per-blob key arrives appended to the OSS
object name with a comma: `<obj>,<key>`. Parse this before passing
to the decoder.

## 27-byte header

Little-endian int16 throughout, except `frame_type`.

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

P-frame `width`/`height` are NOT the global map dimensions — they
describe the bounding box of the changed region for that frame.
Frames with no spatial change carry `width=0, height=0` (header +
JSON tail only). The merge layer must take the union of the prev
I-frame's dimensions with each P-frame's bbox before merging.

## Pixel grid

`width * height` bytes, row-major, **one byte per pixel**.
World-coord of pixel `(x, y)` is
`(left + x * grid_size, top + y * grid_size)`.

The byte layout depends on context — three distinct decoders.

### A. Standard LIDAR map

```
bit 7    : wall flag       (1 = wall / outside-room)
bit 6    : carpet flag     (1 = carpet pixel)
bits 5-0 : segment_id      (1..63, 0 = no segment)
```

Decoder logic (`map.py:4120-4135`):
- `pixel == 0` → outside
- `pixel >> 7 == 1` and `segment_id == 0` → wall
- `pixel >> 7 == 1` and `segment_id > 0` → "wall-of-segment-N"
  marker (rendered as wall, but tagged with segment for room-bounds
  inference)
- `pixel >> 7 == 0` and `segment_id > 0` → floor inside segment N
- carpet flag `(pixel & 0x40) != 0` is independent of the above

### B. Frame map mode (`fsm == 1` in JSON tail)

`map.py:4066-4089`. Used by `dreame.vacuum.r2532a` and other modern
LIDAR vacuums.

```
bits 7-2 : segment_id  (pixel >> 2)   range 1..63
bits 1-0 : meta:
   00 = floor / unknown context
   01 = NEW_SEGMENT marker (when high bits zero)
   10 = WALL marker        (when high bits zero)
   11 = CARPET flag
```

Special segment IDs (top 6 bits): `63=WALL`, `62=FLOOR`,
`61=UNKNOWN`, `1..60` = real segments.

### C. VSLAM / unsaved map

`map.py:4090-4119`. Similar to B but uses lower nibble for
floor/wall markers and `& 0x3F` (or `& 0x7F`) for segment id. The
decoder throws on this path until a fixture is captured against a
non-LIDAR device.

## JSON tail

UTF-8 JSON object immediately after the pixel grid. Parsed by
`json.loads` on the Python side. Field list is exhaustive in the
`MapData` dataclass at `types.py:4151-4286` — every field carries an
inline `# Data json: <key>` comment naming its source key.

| JSON key | Field | Notes |
|---|---|---|
| `timestamp_ms` | timestamp | for staleness detection |
| `origin` | `[left, top]` | overrides header |
| `mra` | rotation | int degrees |
| `oc` | docked | bool |
| `nc` / `nr` | no charger / no robot | nullability |
| `tr` | path string | regex `(?P<op>[MWSLl])(?P<x>-?\d+),(?P<y>-?\d+)` — ops: M=mop, W=sweep+mop, S=sweep, L=line moveTo, lowercase `l` = P-frame line continuation (rewrite to `L`) |
| `sa` | active segments | `[[id], ...]` |
| `seg_inf` | segment metadata | per-id `{nei_id, type, name(b64), material, direction, ...}` |
| `ai_obstacle` | obstacles | `[[x, y, type, possibility, id, ...], ...]` |
| `vw.line` | virtual walls | `[[x0,y0,x1,y1], ...]` |
| `vw.rect` | no-go areas | rectangles |
| `cleanareaorder` | cleaning sequence | per-segment ordering |
| `whm` | embedded wifi map | recursive blob — not decoded |
| `rism` | embedded saved map | recursive blob — not decoded |
| `decmap` | embedded cleaning map | recursive blob — cleaned-area overlay, see `MapData.cleanedArea` |
| `sneak_areas` | no-go-zone equivalent | observed on r2532a, format same as `vw.rect` |
| `cs`, `mtid`, `curid`, `moptype` | misc | observed on r2532a; not load-bearing for v1 render |

Segment names in `seg_inf.<id>.name` are base64-encoded — decode to
UTF-8 before exposing.

`ai_obstacle` records have ~14 positional fields on r2532a. Field
positions 0-3 are `(x, y, type, confidence)`; 5-6 are
`(photo_path, photo_id)`. Positions 7-10 look like a normalised 0..1
bbox quartet. Positions 11-13 are unknown small ints. Cross-check
`map.py:4528-4595` when adding new fields.

## Frame types & P-frame merging

- **I-frame** (`frame_type == 73`): full snapshot. Replace state.
- **P-frame** (`frame_type == 80`): partial diff against the
  previous frame. Allocate a buffer big enough for
  `union(current.dimensions, new.dimensions)`, copy current bytes
  in, then **byte-add** new bytes at the new offset
  (`out[i] = (cur[i] + new[i]) & 0xFF`, intentional wrap), then
  re-classify each pixel via the standard decoder. Robot/charger
  position from the P-frame header overwrites. Path is concatenated
  (`current.path + new.path`); the regex normalises lowercase `l`
  continuation ops automatically. Frame ID must equal
  `current_frame_id + 1` — out-of-order P-frames are queued.
  See `map.py:5018-5070`.
- **W-frame** (`frame_type == 87`): wifi map. Not decoded.

The merge layer in `src/map/merge.ts` re-stamps the merged frame as
`frame_type = I` so the existing pixel decoder runs cleanly on the
result. JSON tail merge rules:
- P-frame tail wins for keys present in both (timestamp, robot,
  charger, mra, ai_obstacle, sa — all current state).
- `tr` is concatenated.
- `seg_inf` and `sa` fall back to prev's value when P doesn't
  carry one (typical — most P-frames don't re-send segment metadata).
- `origin` is overwritten with the union origin.

## Coordinate system

- **mm, world-frame.** `robot.x = +1500` is 1.5 m to the right of
  world origin.
- **Y is NOT inverted in the binary.** Tasshack's renderer flips Y
  for rendering at `map.py:5816`. node-dreame emits raw mm and lets
  the consumer flip if its rendering library wants origin top-left
  vs bottom-left.
- **Angles in degrees.** Tasshack rotates them for rendering;
  node-dreame emits them raw.
- **Pixel coords are grid-cell indices.** Multiply by `grid_size`
  and add `left`/`top` to get mm.

## I-frames live in OSS, not the inline channel

The inline `siid 6 piid 1` `MAP_DATA` channel carries P-frames
continuously. The current I-frame is parked in OSS — its object
name is advertised via `siid 6 piid 3` (`PATH`) push, typically as
the first push on a fresh subscription. Object name format:
`ali_dreame/<uid>/<did>/<n>`.

To fetch the I-frame:

1. Resolve the PATH object name to a signed URL via
   `POST /dreame-user-iot/iotfile/getDownloadUrl`
   (host: same regional API host as auth).
   Body: `{"did": <did>, "model": <model>, "filename": <obj_name>, "region": "<country>"}`.
   Response: `{"code": 0, "data": "<signed-url-string>"}` —
   `data` is the URL string, not a nested object.
2. GET the signed URL. The body is the same URL-safe base64
   envelope as the live channel — feeds into `unwrapEnvelope`
   directly (NOT raw zlib bytes).

For permanent / saved-map blobs (different from live I-frames) the
endpoint is
`POST /dreame-user-iot/iotfile/getOss1dDownloadUrl` with the
`filename` having its leading character stripped. Reserved for the
Gap-#4 saved-map-without-ack work; not yet wired up by node-dreame.

`OssFetcher` (`src/map/oss-fetch.ts`) wraps both endpoints. Caches
signed URLs for 30 minutes keyed by `did:filename`. Constructed
from primitives (host, accessToken, region, did, model) so it
stays unit-testable without a live login.

`MapManager` subscribes to:
- `siid 6 piid 1` (`MAP_DATA`) — inline base64 envelope. Inspects
  the header and dispatches I/P regardless of which frame type the
  device sends.
- `siid 6 piid 3` (`PATH`) — OSS object name string. Resolved via
  `OssFetcher.fetchBlob` and ingested as an I-frame.
- `siid 6 piid 8` (`POINTER_JSON`) — JSON `{object_name, md5}` (or
  `{obj_name, md5}` defensively). Same code path as PATH.
- `siid 6 piid 13` (`OLD_MAP_DATA`) — intentionally unhandled
  pending a fixture. The flag-prefixed `<flag>,<payload>` shape
  needs disambiguation that's not yet captured.

Separately, `DreameSubscription` emits a typed `mapInfo` event for
the device's `_sync.update_vacuum_mapinfo` method — a saved-map
catalogue keyed by `mapId`. Wire shape:

```
{ "map_info": "{\"0\":[5,10],\"1\":[0],\"3\":[0], ...}" }
```

`map_info` is doubly-JSON-encoded — the outer `params` object holds
a string that itself parses to `Record<mapId, number[]>`.
`MapInfoPush.maps` is the parsed result as `Map<number, readonly
number[]>`. Inner array values are not yet fully decoded; surfaced
raw. This push is the device's response to the Dreamehome app
opening it, observed live on r2532a 2026-05-06.

Frame sequencing rules in `MapManager`:
- I-frame replaces baseline + drains pending queue.
- In-order P-frame merges via `mergePFrame` and emits.
- Out-of-order P-frame queues by `frame_id`.
- Stale: P-frame with `frame_id <= current` dropped silently.
  I-frame with same `mapId` and strictly older `frame_id` dropped
  (guards against an OSS-stored I-frame being older than the
  running merged state).
- Recovery: queue size > `recoverGap` (default 4) →
  `requestPFrame` for the missing frame; queue size > `pendingMax`
  (default 8) → clear the queue and `requestIFrame`.
- `map_id` mismatch on a P-frame: `reset()` + `requestIFrame`.
- P-frame before any I-frame: `requestIFrame` (without a baseline
  the gap is unbounded).

## Output schema

What `MapDecoder.decode()` returns. The contract is the minimum a
consumer needs to render walls + segments + robot + dock + path +
obstacles. Source: `src/map/types.ts`.

```ts
interface MapData {
  // Identity
  mapId: number;
  frameId: number;
  frameType: 'I' | 'P' | 'W';
  timestamp: number;          // ms since epoch (from JSON tail)
  rotation: number;           // degrees, applied by renderer

  // World transform — every coordinate below is in mm, world-frame
  dimensions: {
    left: number;             // mm, world-x of pixel column 0
    top: number;              // mm, world-y of pixel row 0
    width: number;            // pixels
    height: number;           // pixels
    gridSize: number;         // mm per pixel
  };

  // Robot/dock state
  robot: { x: number; y: number; angle: number } | null;
  dock:  { x: number; y: number; angle: number } | null;
  docked: boolean;

  // Spatial layers — run-length encoded, pixel coords
  layers: ReadonlyArray<{
    type: 'wall' | 'floor' | 'segment' | 'carpet';
    segmentId?: number;       // only when type='segment'
    runs: ReadonlyArray<readonly [number, number, number]>;
  }>;

  // Segments (rooms)
  segments: ReadonlyArray<{
    id: number;
    name: string | null;      // from seg_inf.name (base64-decoded)
    bbox: { xMin: number; yMin: number; xMax: number; yMax: number };
    centroid: { x: number; y: number };
    neighbours: readonly number[];
    floorMaterial: number | null;
    floorDirection: number | null;
    active: boolean;
  }>;

  // Cleaning path — broken into runs by op type
  paths: ReadonlyArray<{
    type: 'mop' | 'sweep' | 'sweep-and-mop' | 'line';
    points: ReadonlyArray<{ x: number; y: number }>;
  }>;

  // AI-detected obstacles
  obstacles: ReadonlyArray<{
    id: number;
    x: number; y: number;
    type: number;             // ObstacleType enum, decoded by consumer
    confidence: number;       // 0-100
    photoFileName: string | null;
    photoKey: string | null;  // separate AES key for photo decryption
  }>;

  // Editing surfaces
  virtualWalls: ReadonlyArray<{ kind: 'line'; x0: number; y0: number; x1: number; y1: number }
                           | { kind: 'rect'; xMin: number; yMin: number; xMax: number; yMax: number }>;

  // Cleaned-area overlay (decmap)
  cleanedArea: MapCleanedAreaOverlay | null;
}
```

The schema is **not Valetudo-compatible.** Valetudo applies an
irreversible coordinate shift (`(x_mm + 32768) / 10`) and Y-flip in
the encoder. Reversing those in the consumer is annoying.
node-dreame emits raw mm world-frame so the consumer transforms
exactly once.

## Tasshack file:line landmarks

All references against `dev` branch (`bba1d35` at last verification).

| Topic | Location |
|---|---|
| Outer envelope (b64 → AES → zlib) | `map.py:3759-3792` |
| Header parse | `map.py:3950-3995` |
| Standard pixel decode | `map.py:4120-4135` |
| Frame-map pixel decode | `map.py:4066-4089` |
| VSLAM pixel decode | `map.py:4090-4119` |
| Path regex / parse | `map.py:3970-4005` |
| Segment construction | `map.py:5278-…` (`get_segments`) |
| P-frame merge | `map.py:5018-5070` |
| Obstacle parse | `map.py:4528-4595` |
| `decmap` cleaned-area decode | `map.py:5162-5233` |
| Virtual walls / no-go parse | `map.py:4597-4669` |
| OSS URL resolve (live blobs) | `protocol.py:1162` (`get_interim_file_url_pro` Mi-cloud equivalent of `getDownloadUrl`) |
| OSS URL resolve (permanent) | `protocol.py:1150` (`getfileurl_v3` Mi-cloud equivalent of `getOss1dDownloadUrl`) |
| Frame queueing logic | `map.py:475-550, 686-960` |
| AES IV source per model | `types.py:2879` (`device_info` table) |
| `MapData` field-by-field | `types.py:4151-4286` |
| `MapPixelType` enum | `types.py:4086-4100` |
| `MapFrameType` enum | `types.py:4079` |
| `ObstacleType` enum (32 values) | `types.py:2409` |
| `PathType` enum | `types.py:3175` |
