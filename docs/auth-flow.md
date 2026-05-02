# Dreame Native Cloud — Auth Flow

This document captures the wire format of the Dreame-native cloud (the
backend behind the **Dreamehome** mobile app), as implemented by node-dreame.
The flow was reverse-engineered from two community projects, then verified
against a live EU account:

- [TA2k/ioBroker.dreame](https://github.com/TA2k/ioBroker.dreame) — primary reference
- [spayrosam/ioBroker.dreamehome](https://github.com/spayrosam/ioBroker.dreamehome) — corroborating reference

## EU endpoint

```
https://eu.iot.dreame.tech:13267
```

CN counterpart: `cn.iot.dreame.tech:13267`. Same path layout. Other regions
(`us`, `ru`, `sg`, `in`) follow the same `<region>.iot.dreame.tech:13267`
pattern but have not been tested by us.

## Login — `POST /dreame-auth/oauth/token`

OAuth2 password grant with the app's static client credentials and three
custom request headers.

**Headers**

| Header | Value |
|---|---|
| `user-agent` | `Dart/3.2 (dart:io)` |
| `authorization` | `Basic ZHJlYW1lX2FwcHYxOkFQXmR2QHpAU1FZVnhOODg=` (= `dreame_appv1:AP^dv@z@SQYVxN88`) |
| `content-type` | `application/x-www-form-urlencoded` |
| `dreame-auth` | `bearer` (literal, pre-login) |
| `dreame-meta` | `cv=i_829` |
| `dreame-rlc` | hex(AES-128-ECB(key=`EETjszu*XI5znHsI`, plaintext=`<region>\|<lang>\|<country>`)) |
| `tenant-id` | `000000` (Dreame); `000002` (Mova) |

**Body** (form-urlencoded)

```
grant_type=password
scope=all
platform=IOS
type=account
username=<email>
password=md5(<plain> + "RAylYC%fmSKp7%Tq")
country=GB
lang=en
```

The salt `RAylYC%fmSKp7%Tq` is global to the app, not user-specific. It and
the RLC AES key (`EETjszu*XI5znHsI`) are extracted from the Flutter binary —
both will rotate if Dreame ships a new app version with a new `cv=` value.

## Login response

```json
{
  "access_token": "<jwt>",
  "refresh_token": "<jwt>",
  "expires_in": 7200,
  "token_type": "bearer",
  "uid": "<account id>",
  "tenant_id": "000000",
  "country": "GB",
  "region": "eu",
  "lang": "en"
}
```

Refresh: same URL, body `grant_type=refresh_token&refresh_token=<token>`.
Refresh ~100s before expiry. The MQTT subscription must be torn down and
reconnected on refresh because the JWT is the MQTT password.

## Device list — `POST /dreame-user-iot/iotuserbind/device/listV2`

**Headers**: same as login + `dreame-auth: bearer <access_token>` + `content-type: application/json`.

**Body**:
```json
{ "sharedStatus": 1, "current": 1, "size": 100, "lang": "en", "timestamp": <ms> }
```

**Per-device** (abridged):
```json
{
  "did": "<device id>",
  "model": "dreame.vacuum.r2532a",
  "ver": "<firmware version>",
  "customName": "",
  "mac": "<mac>",
  "master": true,
  "bindDomain": "10000.mt.eu.iot.dreame.tech:19973"
}
```

`bindDomain` is per-device — it's the MQTT broker URL for that device.
Don't hardcode it; read it from this response. The integer prefix matches
the brand's `iotComPrefix` (`10000` for Dreame, `20000` for Mova).

## State subscription — MQTT over TLS

- **Broker:** `mqtts://<bindDomain>` (per-device, from device list).
- **Auth:** `username = uid`, `password = access_token` (the JWT itself is the MQTT password — no derivation). `rejectUnauthorized: false`. `clientId = "p_" + 8 random hex`.
- **Topic:** `/status/<did>/<uid>/<model>/<region>/` (note trailing slash — required).

### Methods on this channel

`properties_changed` — array-shaped MIoT property pushes:

```json
{"id":92,"did":"<did>","data":{"id":92,"method":"properties_changed",
  "params":[{"did":"<did>","siid":2,"piid":6,"value":1}, ...]}}
```

`props` — untyped key-value pushes (used for OTA progress and other
non-MIoT signals — see [`ota-flow.md`](./ota-flow.md)):

```json
{"id":15,"did":"<did>","data":{"id":15,"method":"props",
  "params":{"ota_progress":47}}}
```

`_otc.info` — periodic device self-info push (wifi RSSI, IP, firmware
version):

```json
{"id":0,"did":"<did>","data":{"partner_id":"","method":"_otc.info",
  "params":{"hw_ver":"Linux","fw_ver":"...","model":"...",
            "ap":{"siid":"<SSID>","bssid":"...","rssi":-70},
            "netif":{"localIp":"...","mask":"...","gw":"..."}}}}
```

(Yes, `params.ap.siid` is the SSID. Field-name collision with MIoT `siid` is
unfortunate. Some firmware builds emit `params.ap.ssid` instead — the lib
parses both.)

### Limitations

- The broker truncates messages > 4096 bytes server-side.
- The JWT is the MQTT password, so token refresh requires a tear-down + reconnect.

## Commands — `POST /dreame-iot-com-10000/device/sendCommand`

Property read / write — `params` is an **array** of property descriptors:

```json
{
  "did": "<did>",
  "id": <random 1000-9999>,
  "data": {
    "did": "<did>",
    "id": <same>,
    "method": "set_properties",
    "params": [{"did":"<did>","siid":2,"piid":6,"value":1}],
    "from": "XXXXXX"
  }
}
```

Action call — `params` is a **single object**, NOT an array:

```json
{
  "did": "<did>",
  "id": <random 1000-9999>,
  "data": {
    "did": "<did>",
    "id": <same>,
    "method": "action",
    "params": {"did":"<did>","siid":7,"aiid":1,"in":[]},
    "from": "XXXXXX"
  }
}
```

Mixing the two shapes (e.g. wrapping the action params in an array) results
in a misleading `code:80001` response with `msg: "device offline / timeout"`
even though the device is fine. We learned this the hard way; the
`DreameDeviceOfflineError` raised by the lib at code 80001 is genuinely
"device unreachable" only after you've confirmed the param shape.

Other response codes:
- `code: 0` → success
- `code: 80001` → cloud accepted, device didn't ACK in time (offline / rebooting / unsupported siid+aiid combo)

The `10000` prefix is brand-specific (`20000` for Mova).

## Underlying protocol = MIoT siid/piid

Property reads/writes follow the standard Xiaomi MIoT specification (service
id / property id / action id). The Dreame native cloud is just a different
transport layer over the same property model — so the per-model property
maps in [Tasshack's `dreame/types.py`](https://github.com/Tasshack/dreame-vacuum/blob/main/custom_components/dreame_vacuum/dreame/types.py)
are a useful starting catalogue. Many entries we inherited from there have
been verified or corrected on r2532a — see `src/miot-spec.ts` for the live
catalogue with VERIFIED / ASSUMED annotations on every entry.

## Gaps

- **No 2FA / SMS path** is implemented. If your account has 2FA enabled,
  login will fail with no good error.
- **App-version rotation risk:** the password salt + RLC AES key are
  extracted from the Flutter binary. Will need re-extraction if `cv=i_829`
  becomes stale.
- **Region-default `country` and `lang`** are baked into the lib (defaults
  per region are at `src/config.ts`). Override via `DreameClientOptions`
  if your account uses different values.
