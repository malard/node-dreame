/**
 * Tests for src/map/manager.ts.
 *
 * Inputs are synthesised via the same `buildFrame` pattern used by
 * map.merge.test.ts plus a tiny `wrapEnvelope` helper (zlib deflate +
 * base64 encode — the inverse of `unwrapEnvelope`). A bare
 * `EventEmitter` stands in for the MQTT subscription; a real
 * `OssFetcher` is constructed with `mockFetch` so the OSS path exercises
 * the resolve+download integration end-to-end. `FrameRequester` is a
 * fake that records calls.
 *
 * Coverage:
 *   - inline I-frame establishes baseline and emits 'map'
 *   - sequential P-frames advance and emit
 *   - stale + out-of-order P-frame handling, drain on missing arrival
 *   - queue overflow → requestPFrame at recoverGap, requestIFrame at pendingMax
 *   - P-frame before any I-frame triggers requestIFrame
 *   - map_id mismatch resets state and requests I-frame
 *   - stale I-frame (same mapId, older frameId) is dropped
 *   - PATH push fetches OSS blob and ingests as I-frame
 *   - POINTER_JSON push parses `object_name` and ingests
 *   - duplicate PATH dedupes (no second fetch)
 *   - irrelevant pushes (wrong did, wrong siid) ignored
 *   - start()/stop() attach/detach the listener
 */

import { EventEmitter } from "node:events";
import * as zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  FRAME_TYPE,
  HEADER_SIZE,
  MapManager,
  OssFetcher,
  type FrameRequester,
  type MapData,
} from "../src/map/index.js";
import type { PropertyChange } from "../src/mqtt.js";
import { mockFetch } from "./_helpers.js";

const DID = "DID-1";

const OSS_INPUT = {
  host: "eu.iot.dreame.tech:13267",
  accessToken: "TOKEN",
  region: "eu" as const,
  did: DID,
  model: "dreame.vacuum.r2532a",
};

// ─── synthetic frame helpers ────────────────────────────────────────

interface SynthFrame {
  mapId?: number;
  frameId: number;
  frameType: "I" | "P";
  width?: number;
  height?: number;
  left?: number;
  top?: number;
  gridSize?: number;
  robot?: [number, number, number];
  charger?: [number, number, number];
  pixels?: Buffer;
  tail?: Record<string, unknown>;
}

function buildFrame(f: SynthFrame): Buffer {
  const width = f.width ?? 4;
  const height = f.height ?? 4;
  const header = Buffer.alloc(HEADER_SIZE);
  header.writeInt16LE(f.mapId ?? 1, 0);
  header.writeInt16LE(f.frameId, 2);
  header[4] = f.frameType === "I" ? FRAME_TYPE.I : FRAME_TYPE.P;
  const robot = f.robot ?? [0, 0, 0];
  header.writeInt16LE(robot[0], 5);
  header.writeInt16LE(robot[1], 7);
  header.writeInt16LE(robot[2], 9);
  const charger = f.charger ?? [0, 0, 0];
  header.writeInt16LE(charger[0], 11);
  header.writeInt16LE(charger[1], 13);
  header.writeInt16LE(charger[2], 15);
  header.writeInt16LE(f.gridSize ?? 50, 17);
  header.writeInt16LE(width, 19);
  header.writeInt16LE(height, 21);
  header.writeInt16LE(f.left ?? 0, 23);
  header.writeInt16LE(f.top ?? 0, 25);

  const pixelLen = width * height;
  const pixels = f.pixels ?? Buffer.alloc(pixelLen);
  if (pixels.length !== pixelLen) {
    throw new Error(`buildFrame: pixel buffer length ${pixels.length} !== ${pixelLen}`);
  }
  const tail = Buffer.from(JSON.stringify(f.tail ?? { timestamp_ms: f.frameId }), "utf8");
  return Buffer.concat([header, pixels, tail]);
}

function wrapEnvelope(buf: Buffer): string {
  return zlib.deflateSync(buf).toString("base64");
}

function makeRequester() {
  const calls: Array<{ kind: "I" | "P"; opts?: unknown }> = [];
  const requester: FrameRequester = {
    requestIFrame: async (opts) => {
      calls.push({ kind: "I", opts });
      return { code: 0 };
    },
    requestPFrame: async (opts) => {
      calls.push({ kind: "P", opts });
      return { code: 0 };
    },
  };
  return { requester, calls };
}

function makeManager(opts: {
  ossFetcher: OssFetcher;
  source?: EventEmitter;
  recoverGap?: number;
  pendingMax?: number;
}) {
  const source = opts.source ?? new EventEmitter();
  const { requester, calls } = makeRequester();
  const mgr = new MapManager({
    source,
    did: DID,
    ossFetcher: opts.ossFetcher,
    ossInput: OSS_INPUT,
    frameRequester: requester,
    ...(opts.recoverGap !== undefined ? { recoverGap: opts.recoverGap } : {}),
    ...(opts.pendingMax !== undefined ? { pendingMax: opts.pendingMax } : {}),
  });
  return { mgr, source, requester, calls };
}

function pushProp(
  source: EventEmitter,
  piid: number,
  value: unknown,
  did: string = DID,
): void {
  const change: PropertyChange = { did, siid: 6, piid, value };
  source.emit("properties", [change]);
}

function neverFetcher(): OssFetcher {
  // No OSS expected — give it a fetch that always rejects so any accidental
  // call surfaces immediately.
  const fetchImpl = (() => {
    throw new Error("unexpected OSS fetch");
  }) as unknown as typeof fetch;
  return new OssFetcher({ fetchImpl });
}

// ─── inline-channel tests ───────────────────────────────────────────

describe("MapManager: inline channel", () => {
  it("ingests an inline I-frame and emits 'map'", () => {
    const { mgr, source } = makeManager({ ossFetcher: neverFetcher() });
    const events: MapData[] = [];
    mgr.on("map", (d) => events.push(d));
    mgr.start();

    const iframe = buildFrame({ frameId: 100, frameType: "I" });
    pushProp(source, 1, wrapEnvelope(iframe));

    expect(events).toHaveLength(1);
    expect(events[0]!.frameId).toBe(100);
    expect(events[0]!.frameType).toBe("I");
    expect(mgr.currentFrameId).toBe(100);
    expect(mgr.currentMapId).toBe(1);
  });

  it("applies sequential P-frames and emits one 'map' per frame", () => {
    const { mgr, source } = makeManager({ ossFetcher: neverFetcher() });
    const events: MapData[] = [];
    mgr.on("map", (d) => events.push(d));
    mgr.start();

    pushProp(source, 1, wrapEnvelope(buildFrame({ frameId: 10, frameType: "I" })));
    pushProp(source, 1, wrapEnvelope(buildFrame({ frameId: 11, frameType: "P", width: 0, height: 0 })));
    pushProp(source, 1, wrapEnvelope(buildFrame({ frameId: 12, frameType: "P", width: 0, height: 0 })));

    expect(events.map((e) => e.frameId)).toEqual([10, 11, 12]);
    expect(mgr.currentFrameId).toBe(12);
  });

  it("queues out-of-order P-frames and drains when the missing one arrives", () => {
    const { mgr, source } = makeManager({ ossFetcher: neverFetcher() });
    const events: MapData[] = [];
    mgr.on("map", (d) => events.push(d));
    mgr.start();

    pushProp(source, 1, wrapEnvelope(buildFrame({ frameId: 10, frameType: "I" })));
    pushProp(source, 1, wrapEnvelope(buildFrame({ frameId: 12, frameType: "P", width: 0, height: 0 })));
    pushProp(source, 1, wrapEnvelope(buildFrame({ frameId: 13, frameType: "P", width: 0, height: 0 })));
    expect(events.map((e) => e.frameId)).toEqual([10]);
    expect(mgr.pendingCount).toBe(2);

    pushProp(source, 1, wrapEnvelope(buildFrame({ frameId: 11, frameType: "P", width: 0, height: 0 })));

    expect(events.map((e) => e.frameId)).toEqual([10, 11, 12, 13]);
    expect(mgr.pendingCount).toBe(0);
  });

  it("drops stale P-frames (frame_id <= current) silently", () => {
    const { mgr, source } = makeManager({ ossFetcher: neverFetcher() });
    const events: MapData[] = [];
    mgr.on("map", (d) => events.push(d));
    mgr.start();

    pushProp(source, 1, wrapEnvelope(buildFrame({ frameId: 10, frameType: "I" })));
    pushProp(source, 1, wrapEnvelope(buildFrame({ frameId: 9, frameType: "P", width: 0, height: 0 })));
    pushProp(source, 1, wrapEnvelope(buildFrame({ frameId: 10, frameType: "P", width: 0, height: 0 })));

    expect(events.map((e) => e.frameId)).toEqual([10]);
    expect(mgr.pendingCount).toBe(0);
  });

  it("requests a fresh I-frame when a P-frame arrives before any baseline", () => {
    const { mgr, source, calls } = makeManager({ ossFetcher: neverFetcher() });
    mgr.start();
    pushProp(source, 1, wrapEnvelope(buildFrame({ frameId: 5, frameType: "P", width: 0, height: 0 })));
    expect(calls).toEqual([{ kind: "I", opts: undefined }]);
  });

  it("resets and requests I-frame on map_id mismatch", () => {
    const { mgr, source, calls } = makeManager({ ossFetcher: neverFetcher() });
    mgr.start();
    pushProp(source, 1, wrapEnvelope(buildFrame({ mapId: 1, frameId: 10, frameType: "I" })));
    pushProp(source, 1, wrapEnvelope(buildFrame({ mapId: 2, frameId: 11, frameType: "P", width: 0, height: 0 })));
    expect(mgr.current).toBeNull();
    expect(calls).toEqual([{ kind: "I", opts: undefined }]);
  });

  it("drops a stale I-frame (same mapId, older frame_id)", () => {
    const { mgr, source } = makeManager({ ossFetcher: neverFetcher() });
    const events: MapData[] = [];
    mgr.on("map", (d) => events.push(d));
    mgr.start();
    pushProp(source, 1, wrapEnvelope(buildFrame({ frameId: 100, frameType: "I" })));
    pushProp(source, 1, wrapEnvelope(buildFrame({ frameId: 50, frameType: "I" })));
    expect(events.map((e) => e.frameId)).toEqual([100]);
  });
});

// ─── recovery tests ────────────────────────────────────────────────

describe("MapManager: recovery", () => {
  it("requests the missing P-frame once the queue exceeds recoverGap", () => {
    const { mgr, source, calls } = makeManager({
      ossFetcher: neverFetcher(),
      recoverGap: 2,
      pendingMax: 10,
    });
    mgr.start();
    pushProp(source, 1, wrapEnvelope(buildFrame({ frameId: 10, frameType: "I" })));
    // Skip frame_id 11; queue 12, 13, 14 → size becomes 3 > recoverGap=2
    pushProp(source, 1, wrapEnvelope(buildFrame({ frameId: 12, frameType: "P", width: 0, height: 0 })));
    pushProp(source, 1, wrapEnvelope(buildFrame({ frameId: 13, frameType: "P", width: 0, height: 0 })));
    pushProp(source, 1, wrapEnvelope(buildFrame({ frameId: 14, frameType: "P", width: 0, height: 0 })));
    expect(calls).toEqual([{ kind: "P", opts: { mapId: 1, frameId: 11 } }]);
  });

  it("clears the queue and requests an I-frame when the queue exceeds pendingMax", () => {
    const { mgr, source, calls } = makeManager({
      ossFetcher: neverFetcher(),
      recoverGap: 1,
      pendingMax: 2,
    });
    mgr.start();
    pushProp(source, 1, wrapEnvelope(buildFrame({ frameId: 10, frameType: "I" })));
    pushProp(source, 1, wrapEnvelope(buildFrame({ frameId: 12, frameType: "P", width: 0, height: 0 })));
    pushProp(source, 1, wrapEnvelope(buildFrame({ frameId: 13, frameType: "P", width: 0, height: 0 })));
    pushProp(source, 1, wrapEnvelope(buildFrame({ frameId: 14, frameType: "P", width: 0, height: 0 })));
    expect(mgr.pendingCount).toBe(0);
    // First crosses recoverGap with size=2 → P request; second crosses pendingMax with size=3 → I request + clear.
    expect(calls.some((c) => c.kind === "I")).toBe(true);
  });
});

// ─── OSS-pointer tests ──────────────────────────────────────────────

describe("MapManager: OSS pointer", () => {
  it("fetches and ingests an I-frame on PATH push", async () => {
    const iframe = buildFrame({ frameId: 200, frameType: "I" });
    const envelope = wrapEnvelope(iframe);
    const fetchImpl = mockFetch({
      "POST /dreame-user-iot/iotfile/getDownloadUrl": {
        json: { code: 0, data: "https://oss.example/blob?sig=abc" },
      },
      "GET https://oss.example/blob": { text: envelope },
    });
    const { mgr, source } = makeManager({ ossFetcher: new OssFetcher({ fetchImpl }) });
    const events: MapData[] = [];
    mgr.on("map", (d) => events.push(d));
    mgr.on("error", (e) => {
      throw e;
    });
    mgr.start();

    pushProp(source, 3, "ali_dreame/UID/DID-1/0");
    await new Promise((r) => setImmediate(r));

    expect(events.map((e) => e.frameId)).toEqual([200]);
    expect(fetchImpl.calls).toHaveLength(2);
    expect(fetchImpl.calls[0]!.method).toBe("POST");
    expect(fetchImpl.calls[1]!.method).toBe("GET");
  });

  it("dedupes back-to-back PATH pushes with the same obj_name", async () => {
    const iframe = buildFrame({ frameId: 200, frameType: "I" });
    const envelope = wrapEnvelope(iframe);
    const fetchImpl = mockFetch({
      "POST /dreame-user-iot/iotfile/getDownloadUrl": {
        json: { code: 0, data: "https://oss.example/blob?sig=abc" },
      },
      "GET https://oss.example/blob": { text: envelope },
    });
    const { mgr, source } = makeManager({ ossFetcher: new OssFetcher({ fetchImpl }) });
    mgr.start();

    pushProp(source, 3, "ali_dreame/UID/DID-1/0");
    await new Promise((r) => setImmediate(r));
    pushProp(source, 3, "ali_dreame/UID/DID-1/0");
    await new Promise((r) => setImmediate(r));

    expect(fetchImpl.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("ingests an I-frame on POINTER_JSON push (string-form)", async () => {
    const iframe = buildFrame({ frameId: 300, frameType: "I" });
    const envelope = wrapEnvelope(iframe);
    const fetchImpl = mockFetch({
      "POST /dreame-user-iot/iotfile/getDownloadUrl": {
        json: { code: 0, data: "https://oss.example/snapshot?sig=abc" },
      },
      "GET https://oss.example/snapshot": { text: envelope },
    });
    const { mgr, source } = makeManager({ ossFetcher: new OssFetcher({ fetchImpl }) });
    const events: MapData[] = [];
    mgr.on("map", (d) => events.push(d));
    mgr.on("error", (e) => {
      throw e;
    });
    mgr.start();

    pushProp(source, 8, JSON.stringify({ object_name: "ali_dreame/UID/DID-1/9", md5: "abc" }));
    await new Promise((r) => setImmediate(r));

    expect(events.map((e) => e.frameId)).toEqual([300]);
  });

  it("emits 'error' and allows retry when OSS fetch fails", async () => {
    let attempt = 0;
    const iframe = buildFrame({ frameId: 400, frameType: "I" });
    const envelope = wrapEnvelope(iframe);
    const fetchImpl = mockFetch({
      "POST /dreame-user-iot/iotfile/getDownloadUrl": () => {
        attempt++;
        if (attempt === 1) {
          return { status: 500, text: "down" };
        }
        return { json: { code: 0, data: "https://oss.example/blob?sig=abc" } };
      },
      "GET https://oss.example/blob": { text: envelope },
    });
    const { mgr, source } = makeManager({ ossFetcher: new OssFetcher({ fetchImpl }) });
    const errors: Error[] = [];
    const events: MapData[] = [];
    mgr.on("error", (e) => errors.push(e));
    mgr.on("map", (d) => events.push(d));
    mgr.start();

    pushProp(source, 3, "ali_dreame/UID/DID-1/0");
    await new Promise((r) => setImmediate(r));
    expect(errors).toHaveLength(1);
    expect(events).toHaveLength(0);

    pushProp(source, 3, "ali_dreame/UID/DID-1/0");
    await new Promise((r) => setImmediate(r));
    expect(events.map((e) => e.frameId)).toEqual([400]);
  });
});

// ─── plumbing tests ────────────────────────────────────────────────

describe("MapManager: plumbing", () => {
  it("ignores pushes for a different did", () => {
    const { mgr, source } = makeManager({ ossFetcher: neverFetcher() });
    const events: MapData[] = [];
    mgr.on("map", (d) => events.push(d));
    mgr.start();
    pushProp(source, 1, wrapEnvelope(buildFrame({ frameId: 10, frameType: "I" })), "OTHER-DID");
    expect(events).toHaveLength(0);
  });

  it("ignores pushes for non-map siid", () => {
    const { mgr, source } = makeManager({ ossFetcher: neverFetcher() });
    const events: MapData[] = [];
    mgr.on("map", (d) => events.push(d));
    mgr.start();
    source.emit("properties", [{ did: DID, siid: 4, piid: 1, value: "anything" }]);
    expect(events).toHaveLength(0);
  });

  it("start()/stop() attach/detach the listener (idempotent)", () => {
    const { mgr, source } = makeManager({ ossFetcher: neverFetcher() });
    const events: MapData[] = [];
    mgr.on("map", (d) => events.push(d));
    mgr.start();
    mgr.start();
    expect(source.listenerCount("properties")).toBe(1);
    mgr.stop();
    mgr.stop();
    expect(source.listenerCount("properties")).toBe(0);
    pushProp(source, 1, wrapEnvelope(buildFrame({ frameId: 10, frameType: "I" })));
    expect(events).toHaveLength(0);
  });

  it("reset() clears running state and pending queue", () => {
    const { mgr, source } = makeManager({ ossFetcher: neverFetcher() });
    mgr.start();
    pushProp(source, 1, wrapEnvelope(buildFrame({ frameId: 10, frameType: "I" })));
    pushProp(source, 1, wrapEnvelope(buildFrame({ frameId: 12, frameType: "P", width: 0, height: 0 })));
    expect(mgr.currentFrameId).toBe(10);
    expect(mgr.pendingCount).toBe(1);
    mgr.reset();
    expect(mgr.current).toBeNull();
    expect(mgr.pendingCount).toBe(0);
  });
});

// ─── convenience methods ───────────────────────────────────────────

describe("MapManager: convenience methods", () => {
  it("requestIFrame() proxies to the frame requester", async () => {
    const { mgr, calls } = makeManager({ ossFetcher: neverFetcher() });
    await mgr.requestIFrame();
    expect(calls).toEqual([{ kind: "I", opts: undefined }]);
  });

  it("requestIFrame() forwards options through", async () => {
    const { mgr, calls } = makeManager({ ossFetcher: neverFetcher() });
    await mgr.requestIFrame({ force: false, startTime: 1234 });
    expect(calls).toEqual([{ kind: "I", opts: { force: false, startTime: 1234 } }]);
  });

  it("whenReady() resolves immediately with the current map when one is already decoded", async () => {
    const { mgr, source } = makeManager({ ossFetcher: neverFetcher() });
    mgr.start();
    pushProp(source, 1, wrapEnvelope(buildFrame({ frameId: 50, frameType: "I" })));
    const data = await mgr.whenReady();
    expect(data.frameId).toBe(50);
  });

  it("whenReady() kicks requestIFrame and resolves on the resulting map push", async () => {
    const { mgr, source, calls } = makeManager({ ossFetcher: neverFetcher() });
    const ready = mgr.whenReady(2000);
    // The kick fires synchronously inside whenReady — verify before any push.
    await new Promise((r) => setImmediate(r));
    expect(calls).toEqual([{ kind: "I", opts: undefined }]);
    // Simulate the device responding with the requested I-frame.
    pushProp(source, 1, wrapEnvelope(buildFrame({ frameId: 77, frameType: "I" })));
    const data = await ready;
    expect(data.frameId).toBe(77);
  });

  it("whenReady() auto-calls start() so a never-started manager still receives the kicked frame", async () => {
    const { mgr, source } = makeManager({ ossFetcher: neverFetcher() });
    // Note: no mgr.start() called.
    const ready = mgr.whenReady(2000);
    await new Promise((r) => setImmediate(r));
    pushProp(source, 1, wrapEnvelope(buildFrame({ frameId: 88, frameType: "I" })));
    const data = await ready;
    expect(data.frameId).toBe(88);
  });

  it("whenReady() rejects with a hint after the timeout when no map arrives", async () => {
    const { mgr } = makeManager({ ossFetcher: neverFetcher() });
    await expect(mgr.whenReady(20)).rejects.toThrow(/no map within 20ms/);
  });

  it("whenReady() does not reject just because requestIFrame fails — surfaces via 'error' instead", async () => {
    const source = new EventEmitter();
    const requester: FrameRequester = {
      requestIFrame: async () => {
        throw new Error("device offline");
      },
      requestPFrame: async () => ({ code: 0 }),
    };
    const mgr = new MapManager({
      source,
      did: DID,
      ossFetcher: neverFetcher(),
      ossInput: OSS_INPUT,
      frameRequester: requester,
    });
    const errors: Error[] = [];
    mgr.on("error", (e) => errors.push(e));
    const ready = mgr.whenReady(50);
    // The kick rejects — error surfaces on 'error' but `ready` is still pending.
    await new Promise((r) => setTimeout(r, 10));
    expect(errors.map((e) => e.message)).toEqual(["device offline"]);
    // …and the timeout still drives final rejection.
    await expect(ready).rejects.toThrow(/no map within 50ms/);
  });
});
