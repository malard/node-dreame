/**
 * In-memory cache of the latest OSS-object pointer the device has
 * published via `siid 6 piid 3` (`PATH`) and `siid 6 piid 8`
 * (`POINTER_JSON`) MQTT pushes. The cache is the long-lived part of
 * the offline-tolerant map fetch path used by
 * `Vacuum.rememberOssPointer()` / `Vacuum.fetchMapFromOss()`; the
 * `OssFetcher` handles the short-lived (~30 min) signed-URL cache
 * separately.
 *
 * Persistence is the consumer's job: pass an `OssPointerStore` with
 * `read()` / `write()` callbacks, and the cache will seed itself from
 * `read()` on first use and flush on every change. The lib stays
 * IO-free.
 */

import { CLOUD_OBJ_PROP } from "../miot-spec.js";
import { parsePointerJson } from "../map/pointer-json.js";

/**
 * One captured OSS object pointer the device has pushed at some point
 * during the lifetime of `Vacuum.rememberOssPointer()`. The signed
 * download URL is NOT cached here — it's resolved on demand via
 * `OssFetcher`, which manages its own short-lived URL cache. The
 * pointer here is the long-lived part: the OSS object name plus the
 * MQTT push that surfaced it. OSS object lifetimes on the Dreame
 * regional bucket are weeks-stable in practice — long enough that a
 * pointer captured during one session reliably resolves in the next.
 */
export interface OssPointer {
  /** Bare OSS object name (e.g. `ali_dreame/<uid>/<did>/<n>`). */
  filename: string;
  /**
   * Which property surfaced this pointer:
   *   - `"path"` — siid 6 piid 3 (`PATH` push). Live I-frame; on
   *     r2532a the saved-map blob is embedded inside this frame's
   *     `tail.rism`, so `MapDecoder.decode` recurses to surface the
   *     full geometry.
   *   - `"pointerJson"` — siid 6 piid 8 (`POINTER_JSON` push). The
   *     saved-map list wrapper (the body that `decodeSavedMapList`
   *     parses).
   */
  source: "path" | "pointerJson";
  /** ISO-8601 timestamp of when the pointer was last captured / refreshed. */
  seenAt: string;
  /** md5 hint from the wire — only present on `source: "pointerJson"` pushes. */
  md5?: string;
}

/**
 * Optional persistence callback for `Vacuum.rememberOssPointer()`.
 * The lib stays IO-free; consumers wire up the actual filesystem /
 * keyvalue store and pass `read` / `write` functions.
 *
 * - `read()` is called once when `rememberOssPointer()` is called, to
 *   restore any pointer captured in a previous session.
 * - `write(pointers)` is called every time a fresh pointer is captured
 *   on the wire (and only when the pointer's `filename` or `md5`
 *   actually changed — same-content re-pushes are deduped).
 */
export interface OssPointerStore {
  read(): OssPointer[] | null;
  write(pointers: readonly OssPointer[]): void;
}

/** One MQTT property change as observed by the cache. */
export interface OssPointerCapture {
  siid: number;
  piid: number;
  value?: unknown;
}

/**
 * In-memory cache of OSS pointers, latest-only per source. Hooks
 * directly into MQTT property pushes via `ingest()` and lets callers
 * read the latest captures via `get()` / `list()`. Survives
 * unwatch/watch cycles in the parent `Vacuum` — the cache is the
 * persistent state, the listener attachment is a per-subscription
 * concern.
 */
export class OssPointerCache {
  #pointers: Map<"path" | "pointerJson", OssPointer> = new Map();
  #store: OssPointerStore | null = null;

  /**
   * Wire the persistence callback and seed the cache from
   * `store.read()`. Replaces any prior store. Idempotent on the
   * already-restored data — re-seeding the same pointers is a no-op.
   */
  attachStore(store: OssPointerStore): void {
    this.#store = store;
    const restored = store.read();
    if (restored) {
      for (const p of restored) {
        this.#pointers.set(p.source, p);
      }
    }
  }

  /**
   * Process one MQTT property change. Captures `siid 6 piid 3` (PATH)
   * and `siid 6 piid 8` (POINTER_JSON) pushes; ignores everything
   * else. Returns true if the cache actually changed (filename or
   * md5 differs from the prior entry for this source); false on
   * same-content re-pushes.
   */
  ingest(c: OssPointerCapture): boolean {
    if (c.siid !== CLOUD_OBJ_PROP.PATH.siid) {
      return false;
    }
    if (
      c.piid === CLOUD_OBJ_PROP.PATH.piid &&
      typeof c.value === "string" &&
      c.value.length > 0
    ) {
      return this.#applyCapture("path", c.value);
    }
    if (c.piid === CLOUD_OBJ_PROP.POINTER_JSON.piid) {
      const parsed = parsePointerJson(c.value);
      if (parsed) {
        return this.#applyCapture("pointerJson", parsed.filename, parsed.md5);
      }
    }
    return false;
  }

  /** Push the current cache contents through the persistence callback. */
  flushToStore(): void {
    if (this.#store) {
      this.#store.write(this.list());
    }
  }

  /** Latest pointer for one source, or `null` if never seen. */
  get(source: "path" | "pointerJson"): OssPointer | null {
    return this.#pointers.get(source) ?? null;
  }

  /** All captured pointers, latest-only per source. */
  list(): readonly OssPointer[] {
    return [...this.#pointers.values()];
  }

  #applyCapture(
    source: "path" | "pointerJson",
    filename: string,
    md5?: string,
  ): boolean {
    const prev = this.#pointers.get(source);
    if (prev && prev.filename === filename && prev.md5 === md5) {
      return false;
    }
    const next: OssPointer = {
      filename,
      source,
      seenAt: new Date().toISOString(),
    };
    if (md5 !== undefined) {
      next.md5 = md5;
    }
    this.#pointers.set(source, next);
    return true;
  }
}
