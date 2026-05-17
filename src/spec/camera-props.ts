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
