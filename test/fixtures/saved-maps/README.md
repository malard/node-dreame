# Saved-map fixtures

OSS-fetched saved-map list blobs (the body served from the
`POST /dreame-user-iot/iotfile/getDownloadUrl` URL whose object name
is published on `siid 6 piid 8`). Format: `{ mapstr: [{ id, name,
angle, map }, …], curr_id }`. Each `mapstr[*].map` is a base64
envelope that decodes via `MapDecoder`.

These are reused by `decoder` tests to pin the parsing of fields
that only appear in the saved-map blob (notably `vw`, `vws`,
`walls_info`, `sneak_areas`, `funiture_info`, etc.).

## Provenance

| File | Captured | Model | Firmware | Geometry |
|---|---|---|---|---|
| `r2532a-with-vws.json` | 2026-05-07 | `dreame.vacuum.r2532a` (X50) | 4.3.9_2199 | 2 virtual walls, 1 removed-carpet rect, 5 added-carpet rects, 3 passable thresholds, 2 impassable thresholds, 2 sneak areas. Single floor "Ground Floor" (id=0). |

## Sterilisation policy

Fixtures here must NOT carry account-identifying material:

- The wrapper JSON's keys (`mapstr`, `curr_id`, `id`, `name`, `angle`,
  `map`) are safe — they're per-floor metadata, not per-account.
- The base64 `map` payload's binary header (27 bytes) carries no
  account info — only `mapId`, `frameId`, dims, robot/charger pose.
- The decoded tail JSON does carry the device's `mtid` (a per-device
  hash) and other small ids. Those are device-scoped, not
  account-scoped; acceptable for a public fixture.

If you capture a new fixture, run it through `examples/probe-saved-
map-tails.ts <obj_name>` and visually scan the dumped tail JSON for
anything that looks like an email, UID, or DID before committing.

## How to capture

```pwsh
# DREAME_EMAIL/DREAME_PASSWORD must be set in env (see memory
# reference_dreame_env)
npx tsx examples/save-saved-map-fixture.ts test/fixtures/saved-maps/<name>.json
```

The script discovers the OSS object name dynamically from the
device's published pointer — never hard-codes account UID or DID.
