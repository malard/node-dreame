/**
 * Cloud-storage / map-data service (siid 6) + the request-map action.
 *
 * This is the channel the live-map decoder reads from. Inline and
 * out-of-band (OSS-pointer) variants both flow through here; see
 * `docs/live-map-format.md` for the full envelope format.
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
