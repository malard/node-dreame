/**
 * Outer-envelope handling for Dreame map blobs.
 *
 * Wire format: URL-safe base64 → optional AES-256-CBC decrypt → zlib
 * inflate → 27-byte binary header + width*height pixel grid + UTF-8
 * JSON tail. This module covers the first three steps; header / tail
 * parsing live in `header.ts` / `tail.ts`.
 */

import { createDecipheriv, createHash } from "node:crypto";
import * as zlib from "node:zlib";
import type { MapDecodeOptions } from "./types.js";

/** Bytes 0-26 are the fixed-layout binary header. */
export const HEADER_SIZE = 27;

/** Sentinel value in `robot.a` / `charger.a` meaning "absent". */
export const ANGLE_ABSENT = 0x7fff;

/** Frame-type byte values from the header. */
export const FRAME_TYPE = {
  I: 73,
  P: 80,
  W: 87,
} as const;

export class MapDecodeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MapDecodeError";
  }
}

/**
 * Unwrap a raw MAP_DATA envelope value: URL-safe base64 → optional
 * AES-256-CBC decrypt → zlib inflate. The returned buffer starts with
 * the 27-byte header.
 *
 * If the value contains a comma, everything after the first comma is
 * treated as the per-blob AES key and AES is forced on (matching the
 * outer-envelope convention from Tasshack `map.py:3759-3792`). If `opts.key`
 * and `opts.iv` are also supplied, the embedded key wins.
 */
export function unwrapEnvelope(value: string, opts: MapDecodeOptions = {}): Buffer {
  const commaIdx = value.indexOf(",");
  const b64 = commaIdx >= 0 ? value.slice(0, commaIdx) : value;
  const embeddedKey = commaIdx >= 0 ? value.slice(commaIdx + 1) : null;

  const standard = b64.replace(/-/g, "+").replace(/_/g, "/");
  let bytes: Buffer;
  try {
    bytes = Buffer.from(standard, "base64");
  } catch (err) {
    throw new MapDecodeError("envelope: base64 decode failed", { cause: err });
  }
  if (bytes.length === 0) {
    throw new MapDecodeError("envelope: empty payload after base64 decode");
  }

  const key = embeddedKey ?? opts.key ?? null;
  if (key) {
    if (!opts.iv) {
      throw new MapDecodeError("envelope: AES key supplied but no IV — pass `opts.iv` (16-byte ASCII)");
    }
    bytes = aesCbcDecrypt(bytes, key, opts.iv);
  }

  try {
    return zlib.inflateSync(bytes);
  } catch (err) {
    throw new MapDecodeError("envelope: zlib inflate failed", { cause: err });
  }
}

function aesCbcDecrypt(cipher: Buffer, rawKey: string, iv: string): Buffer {
  const keyBytes = Buffer.from(createHash("sha256").update(rawKey).digest("hex").slice(0, 32), "utf8");
  const ivBytes = Buffer.from(iv, "utf8");
  if (ivBytes.length !== 16) {
    throw new MapDecodeError(`envelope: AES IV must be 16 ASCII bytes, got ${ivBytes.length}`);
  }
  try {
    const decipher = createDecipheriv("aes-256-cbc", keyBytes, ivBytes);
    decipher.setAutoPadding(false);
    return Buffer.concat([decipher.update(cipher), decipher.final()]);
  } catch (err) {
    throw new MapDecodeError("envelope: AES decrypt failed", { cause: err });
  }
}
