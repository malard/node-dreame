import { createCipheriv, createHash, randomBytes } from "node:crypto";

/**
 * App-global secrets extracted from the Dreamehome Flutter binary.
 * These rotate with new app versions — if login starts failing with no obvious
 * cause, re-extract from the latest APK.
 *
 * Last verified against `dreame-meta: cv=i_829`.
 */
const PASSWORD_SALT = "RAylYC%fmSKp7%Tq";
const RLC_AES_KEY = "EETjszu*XI5znHsI";

/**
 * Salted MD5 of the plaintext password, lower-case hex.
 * Sent on the wire instead of the cleartext password.
 */
export function hashPassword(plaintext: string): string {
  return createHash("md5").update(plaintext + PASSWORD_SALT).digest("hex");
}

/**
 * Compute the value of the `dreame-rlc` request header.
 *
 * AES-128-ECB encryption (PKCS7 padding) of `<region>|<lang>|<country>`
 * with the static app key, output as lowercase hex.
 *
 * @example
 *   buildRlcHeader("eu", "en", "GB") // "..."
 */
export function buildRlcHeader(region: string, lang: string, country: string): string {
  const plaintext = `${region}|${lang}|${country}`;
  const key = Buffer.from(RLC_AES_KEY, "utf8");
  const cipher = createCipheriv("aes-128-ecb", key, null);
  const out = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return out.toString("hex");
}

/** Random MQTT client id matching the format used by the Dreamehome app. */
export function randomMqttClientId(): string {
  return "p_" + randomBytes(8).toString("hex");
}

/**
 * Random positive 31-bit integer for the `id` field of a sendCommand
 * envelope. Wide enough that concurrent fan-out won't collide even at
 * thousands of in-flight requests.
 *
 * (The Dreamehome app picks from a much narrower range, but Dreame's
 * cloud doesn't appear to constrain the value — wider is strictly safer
 * for correlation purposes.)
 */
export function randomRequestId(): number {
  return Math.floor(Math.random() * 0x7fffffff) + 1;
}
