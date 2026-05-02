# Dreame OTA Firmware Update — Observed Flow

Captured on a live `dreame.vacuum.r2532a` (X50 Ultra Complete) updating
`4.3.9_2033 → 4.3.9_2199`. The user triggered the update from the
Dreamehome app; node-dreame was a passive observer on MQTT throughout.

## Timeline (~10 min total)

| Phase | Event |
|---|---|
| Start | First OTA push: method=`props` `{ota_state: "downloading"}`. `MiotState` (siid 2 piid 1) flipped 13→14 ("Updating"). |
| Download (~8 min) | Stream of `props {ota_progress: 0..100}` envelopes, ~1% every 6-10 s. |
| Download done | `ota_progress: 100` then `ota_state: "dowloaded"` (sic — Dreame's typo, not ours; preserve verbatim). |
| Install starts | `ota_state: "installing"`. |
| Reboot | Device offline (cloud `online: false` in device-list polls). Property reads return code=80001. |
| Reboot done | `ota_state: "idle"` then shortly after `ota_state: "installed"`. |
| Settled | `siid 99 piid 31` versions JSON updates. device-list `ver` field flips to the new version. `MiotState` returns to 13 (ChargingComplete). |

## MQTT envelope shapes seen

### `properties_changed` (existing — array of MIoT props)
```json
{
  "id": <reqId>,
  "did": "<did>",
  "data": {
    "id": <reqId>,
    "method": "properties_changed",
    "params": [
      {"did":"<did>","siid":N,"piid":M,"value":<any>}
    ]
  }
}
```

### `props` (untyped k/v object)
```json
{
  "id": <reqId>,
  "did": "<did>",
  "data": {
    "id": <reqId>,
    "method": "props",
    "params": {"ota_progress": 47}
  }
}
```
Also seen with `{ota_state: "<string>"}`. Other domains likely use this
channel for non-MIoT signals — node-dreame surfaces it as the typed `props`
event on `DreameSubscription`, plus a convenience `ota` event built from it.

### `_otc.info` (periodic device self-info)
```json
{
  "id": 0,
  "did": "<did>",
  "data": {
    "partner_id": "",
    "method": "_otc.info",
    "params": {
      "hw_ver": "Linux",
      "fw_ver": "<firmware version>",
      "model": "dreame.vacuum.r2532a",
      "ap": {"siid": "<SSID>", "bssid": "<MAC>", "rssi": -70},
      "netif": {"localIp": "<ip>", "mask": "<mask>", "gw": "<gw>"}
    }
  }
}
```

## OTA state values seen (literal strings)

```
downloading
dowloaded     ← Dreame's typo, not ours; preserve verbatim
installing
idle
installed
```

`installed` and `idle` both appear post-success (`idle` typically first).
After the device emits `installed`, it stops emitting OTA pushes until
the next update.

## Lib support

- [`mqtt.ts`](../src/mqtt.ts): emits typed `props`, `info`, `ota` events
  on top of the existing `properties` and `message`.
- [`errors.ts`](../src/errors.ts): `DreameDeviceOfflineError` for code=80001
  — distinguishes "device unreachable right now" from real protocol errors.
- [`vacuum.ts`](../src/vacuum.ts): `state.online` driven by MQTT
  connect/close + refresh outcomes; `state.ota` carries the most-recent
  `OtaEvent` until OTA settles.

## What we still don't know

- The "pending update available" check mechanism. The Dreamehome app
  discovers a new firmware before the user triggers it — there must be a
  cloud OTA-info endpoint we haven't probed. Likely candidates:
  `/dreame-iot-com-10000/ota/check`, `/dreame-iot-com-10000/device/getOtaInfo`.
  Worth a probe pass.
- `siid 99 piid 98` — emits a base64-zlib blob that flips frequently.
  Telemetry / map-diff / debug log? Decode TBD.
- `siid 6 piid 8` — `{obj_name, md5}` pointer to a cloud blob. The path
  format `ali_dreame/<uid>/<did>/<n>` suggests Aliyun OSS bucket — fetching
  it would probably need a signed URL grant from a different endpoint.
