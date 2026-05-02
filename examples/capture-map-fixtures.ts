/**
 * Capture live-map fixtures from a real device.
 *
 * Subscribes to the MQTT push channel, watches every property change on
 * siid 6 (the cloud/map service), and writes one fixture per push to
 * `test/fixtures/map/`:
 *
 *   <seq>-piid<piid>-<frameType>.{bin,json}   ← payload
 *   <seq>-piid<piid>-<frameType>.meta.json    ← provenance sidecar
 *
 * For inline blobs (siid 6 piid 1, or piid 13 with leading "0,") the
 * captured value is decoded as base64 and written as `.bin`. Trailing
 * `,<aes-key>` segments are split off and recorded in the meta sidecar.
 *
 * For OSS pointers (siid 6 piid 8, or piid 13 with leading "1,") the
 * pointer JSON is saved verbatim, and — if the script can resolve a
 * signed URL via `/v2/home/get_interim_file_url_pro` — the underlying
 * Aliyun blob is downloaded as `.bin`.
 *
 * Usage:
 *   DREAME_EMAIL=… DREAME_PASSWORD=… npx tsx examples/capture-map-fixtures.ts
 *
 * The script runs until interrupted with Ctrl-C. To force the device to
 * emit a fresh I-frame, trigger a clean / pause / resume in the
 * Dreamehome app while the script is running.
 *
 * NB: The captured fixtures may contain sensitive metadata (your `did`,
 * OSS object names that include your `uid`, per-blob AES keys). They are
 * written under `test/fixtures/map/` which is `.gitignore`d — do not
 * commit them until a sanitization pass exists.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { DreameClient } from "../src/index.js";
import { CLOUD_OBJ_PROP } from "../src/index.js";
import { requestIFrame } from "../src/map/index.js";
import { buildHeaders } from "../src/auth.js";
import { REGION_HOSTS } from "../src/config.js";

const FIXTURE_DIR = path.resolve("test/fixtures/map");

const dreame = new DreameClient({
  email: process.env.DREAME_EMAIL!,
  password: process.env.DREAME_PASSWORD!,
  region: "eu",
});

await dreame.login();
const device = (await dreame.getDevices())[0];
if (!device) {
  console.error("no devices on account");
  process.exit(1);
}
const session = dreame.session!;
const region = dreame.region;
const apiHost = REGION_HOSTS[region];

fs.mkdirSync(FIXTURE_DIR, { recursive: true });

console.log(`capturing map fixtures for ${device.name} (${device.model}, did=${device.did})`);
console.log(`output:  ${FIXTURE_DIR}`);
console.log(`watching siid 6 piid 1 (MAP_DATA) / 3 (PATH) / 8 (POINTER_JSON) / 13 (OLD_MAP_DATA)`);
console.log(`trigger a clean / pause / resume in the app to force a fresh I-frame.\n`);

let seq = 0;

const sub = await dreame.subscribe(device);
console.log(`subscribed: ${sub.topic}`);

// Pull a fresh I-frame on startup so capture sessions get a deterministic
// base frame (the device only emits one at session start or map_id change
// otherwise). Pass `--no-request-i-frame` to skip.
if (!process.argv.includes("--no-request-i-frame")) {
  try {
    await requestIFrame(dreame, device.did, { force: true });
    console.log(`requested I-frame (force=true) — should arrive momentarily\n`);
  } catch (err) {
    console.error(`I-frame request failed:`, (err as Error).message, "\n");
  }
} else {
  console.log("");
}

sub.on("properties", async (changes) => {
  for (const c of changes) {
    if (c.siid !== 6) {
      continue;
    }
    seq += 1;
    try {
      await capture(seq, c.piid, c.value);
    } catch (err) {
      console.error(`[capture #${seq} failed]`, (err as Error).message);
    }
  }
});

sub.on("error", (err) => console.error("[mqtt error]", err.message));
sub.on("close", () => console.log("[mqtt close — will auto-reconnect]"));

process.on("SIGINT", async () => {
  console.log(`\ncaptured ${seq} fixture(s). shutting down ...`);
  await sub.close();
  process.exit(0);
});

// ─── per-push capture ──────────────────────────────────────────────

async function capture(n: number, piid: number, value: unknown): Promise<void> {
  const ts = new Date().toISOString();
  const meta: Record<string, unknown> = {
    seq: n,
    timestamp: ts,
    did: device.did,
    model: device.model,
    siid: 6,
    piid,
    rawValue: value,
  };
  const stem = `${String(n).padStart(3, "0")}-piid${piid}`;

  // siid 6 piid 1 — inline MAP_DATA blob (expected: base64 string, optionally `,<key>`)
  if (piid === CLOUD_OBJ_PROP.MAP_DATA.piid) {
    const decoded = decodeInlineBlob(value);
    if (decoded) {
      const frameTag = headerFrameTag(decoded.bytes);
      const stemFt = `${stem}-${frameTag}`;
      writeBin(stemFt, decoded.bytes);
      Object.assign(meta, { kind: "inline-map-data", embeddedKey: decoded.key, frameTag, byteLen: decoded.bytes.length });
      writeMeta(stemFt, meta);
      console.log(`[${ts}] #${n} MAP_DATA inline ${frameTag} (${decoded.bytes.length} bytes${decoded.key ? ", +key" : ""})`);
      return;
    }
    Object.assign(meta, { kind: "inline-map-data", warn: "value not a base64 string" });
    writeMeta(stem, meta);
    console.log(`[${ts}] #${n} MAP_DATA non-string value — meta only`);
    return;
  }

  // siid 6 piid 3 — PATH (OSS object name, no payload)
  if (piid === CLOUD_OBJ_PROP.PATH.piid) {
    Object.assign(meta, { kind: "path-string" });
    writeMeta(stem, meta);
    console.log(`[${ts}] #${n} PATH ${JSON.stringify(value)}`);
    return;
  }

  // siid 6 piid 8 — POINTER_JSON {obj_name, md5}; resolve + download
  if (piid === CLOUD_OBJ_PROP.POINTER_JSON.piid) {
    const pointer = parsePointer(value);
    Object.assign(meta, { kind: "oss-pointer", pointer });
    if (pointer?.obj_name) {
      const downloaded = await tryDownloadOss(pointer.obj_name);
      if (downloaded) {
        const frameTag = headerFrameTag(downloaded.bytes);
        const stemFt = `${stem}-${frameTag}`;
        writeBin(stemFt, downloaded.bytes);
        Object.assign(meta, { downloadedFrom: downloaded.url, frameTag, byteLen: downloaded.bytes.length });
        writeMeta(stemFt, meta);
        console.log(`[${ts}] #${n} POINTER → fetched ${frameTag} (${downloaded.bytes.length} bytes) from ${pointer.obj_name}`);
        return;
      }
      Object.assign(meta, { downloadError: "resolve or fetch failed — see stderr" });
    }
    writeMeta(stem, meta);
    console.log(`[${ts}] #${n} POINTER ${JSON.stringify(pointer)} — meta only`);
    return;
  }

  // siid 6 piid 13 — OLD_MAP_DATA "<flag>,<payload>[,<key>]"
  if (piid === CLOUD_OBJ_PROP.OLD_MAP_DATA.piid) {
    const parsed = parseOldMapData(value);
    Object.assign(meta, { kind: "old-map-data", flag: parsed?.flag, embeddedKey: parsed?.key });
    if (parsed?.flag === "0" && parsed.payload) {
      const bytes = tryBase64(parsed.payload);
      if (bytes) {
        const frameTag = headerFrameTag(bytes);
        const stemFt = `${stem}-${frameTag}`;
        writeBin(stemFt, bytes);
        Object.assign(meta, { frameTag, byteLen: bytes.length });
        writeMeta(stemFt, meta);
        console.log(`[${ts}] #${n} OLD_MAP_DATA inline ${frameTag} (${bytes.length} bytes${parsed.key ? ", +key" : ""})`);
        return;
      }
    } else if (parsed?.flag === "1" && parsed.payload) {
      const downloaded = await tryDownloadOss(parsed.payload);
      if (downloaded) {
        const frameTag = headerFrameTag(downloaded.bytes);
        const stemFt = `${stem}-${frameTag}`;
        writeBin(stemFt, downloaded.bytes);
        Object.assign(meta, { ossObj: parsed.payload, downloadedFrom: downloaded.url, frameTag, byteLen: downloaded.bytes.length });
        writeMeta(stemFt, meta);
        console.log(`[${ts}] #${n} OLD_MAP_DATA OSS → fetched ${frameTag} (${downloaded.bytes.length} bytes) from ${parsed.payload}`);
        return;
      }
    }
    writeMeta(stem, meta);
    console.log(`[${ts}] #${n} OLD_MAP_DATA flag=${parsed?.flag ?? "?"} — meta only`);
    return;
  }

  // any other siid 6 piid — record for discovery
  Object.assign(meta, { kind: "unknown-siid6-piid" });
  writeMeta(stem, meta);
  console.log(`[${ts}] #${n} siid 6 piid ${piid} (unknown) — meta only`);
}

// ─── helpers ───────────────────────────────────────────────────────

function writeBin(stem: string, bytes: Buffer): void {
  fs.writeFileSync(path.join(FIXTURE_DIR, `${stem}.bin`), bytes);
}

function writeMeta(stem: string, meta: Record<string, unknown>): void {
  fs.writeFileSync(path.join(FIXTURE_DIR, `${stem}.meta.json`), JSON.stringify(meta, null, 2));
}

/**
 * Inline MAP_DATA values are expected to be a base64 string optionally
 * suffixed with `,<key>` per the outer envelope. Returns the decoded
 * bytes plus the embedded key (if any), or null if the value isn't a
 * recognisable base64 payload.
 */
function decodeInlineBlob(value: unknown): { bytes: Buffer; key: string | null } | null {
  if (typeof value !== "string") {
    return null;
  }
  const commaIdx = value.indexOf(",");
  const b64 = commaIdx >= 0 ? value.slice(0, commaIdx) : value;
  const key = commaIdx >= 0 ? value.slice(commaIdx + 1) : null;
  const bytes = tryBase64(b64);
  if (!bytes) {
    return null;
  }
  return { bytes, key };
}

function tryBase64(s: string): Buffer | null {
  // Accept URL-safe base64 by translating before decode.
  const standard = s.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const buf = Buffer.from(standard, "base64");
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

interface OssPointer {
  obj_name?: string;
  md5?: string;
}

function parsePointer(value: unknown): OssPointer | null {
  if (typeof value === "object" && value !== null) {
    return value as OssPointer;
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as OssPointer;
    } catch {
      return null;
    }
  }
  return null;
}

function parseOldMapData(value: unknown): { flag: string; payload: string; key: string | null } | null {
  if (typeof value !== "string") {
    return null;
  }
  const parts = value.split(",");
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    return null;
  }
  return {
    flag: parts[0],
    payload: parts[1],
    key: parts.length >= 3 ? (parts[2] ?? null) : null,
  };
}

/**
 * Best-effort frame-type tag from the 27-byte header — `frame_type` is
 * at byte offset 4 of the *inflated* payload (`I=73`, `P=80`, `W=87`).
 * The on-the-wire `bytes` are still zlib-compressed (and possibly AES-
 * encrypted), so byte 4 there is noise; we try to inflate first and
 * fall back to `unknown` if the bytes aren't a plain zlib stream.
 */
function headerFrameTag(bytes: Buffer): "iframe" | "pframe" | "wframe" | "unknown" {
  let inflated: Buffer;
  try {
    inflated = zlib.inflateSync(bytes);
  } catch {
    return "unknown";
  }
  if (inflated.length < 5) {
    return "unknown";
  }
  switch (inflated[4]) {
    case 73:
      return "iframe";
    case 80:
      return "pframe";
    case 87:
      return "wframe";
    default:
      return "unknown";
  }
}

/**
 * Resolve an OSS object name to a signed URL via Dreame's
 * `/v2/home/get_interim_file_url_pro`, then GET the bytes. Returns null
 * (and logs to stderr) on any failure — the meta sidecar still gets
 * written so the user can retry manually.
 */
async function tryDownloadOss(objName: string): Promise<{ bytes: Buffer; url: string } | null> {
  const url = `https://${apiHost}/v2/home/get_interim_file_url_pro`;
  const headers = buildHeaders({
    region,
    country: "GB",
    lang: "en",
    accessToken: session.accessToken,
    contentType: "application/json",
  });
  let resolved: string | null = null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ obj_name: objName }),
    });
    const text = await res.text();
    const body = JSON.parse(text) as {
      code?: number;
      msg?: string;
      result?: { url?: string };
      data?: { url?: string };
    };
    if (body.code !== 0 && body.code !== undefined) {
      console.error(`  oss-resolve: code=${body.code} msg=${body.msg ?? "?"}`);
      return null;
    }
    resolved = body.result?.url ?? body.data?.url ?? null;
  } catch (err) {
    console.error(`  oss-resolve failed:`, (err as Error).message);
    return null;
  }
  if (!resolved) {
    console.error(`  oss-resolve: no url in response`);
    return null;
  }
  try {
    const fileRes = await fetch(resolved);
    if (!fileRes.ok) {
      console.error(`  oss-download: HTTP ${fileRes.status}`);
      return null;
    }
    const buf = Buffer.from(await fileRes.arrayBuffer());
    return { bytes: buf, url: resolved };
  } catch (err) {
    console.error(`  oss-download failed:`, (err as Error).message);
    return null;
  }
}
