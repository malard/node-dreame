/**
 * Tests for the lazy `Vacuum.map` getter.
 *
 * Phase-5 wiring exercise: confirm the getter throws before `watch()`,
 * memoises after, ingests inline I-frames from the underlying
 * subscription, and rebinds to a fresh subscription across an
 * unwatch+watch cycle.
 *
 * The DreameClient and DreameSubscription are stubbed — Vacuum's own
 * action helpers are also covered indirectly via `clientFrameRequester`,
 * but the tests here don't exercise the OSS path (covered by
 * map.manager.test.ts).
 */

import { EventEmitter } from "node:events";
import * as zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { Vacuum } from "../src/vacuum.js";
import type { DreameClient } from "../src/client.js";
import type { DreameDevice, DreameSession } from "../src/types.js";
import type { DreameSubscription } from "../src/mqtt.js";
import { DreameTransportError } from "../src/errors.js";
import { FRAME_TYPE, HEADER_SIZE, type MapData } from "../src/map/index.js";

const DEVICE: DreameDevice = {
  did: "DID-1",
  model: "dreame.vacuum.r2532a",
  name: "vac",
  online: true,
  raw: {},
};

function buildIFrame(frameId: number): Buffer {
  const w = 4;
  const h = 4;
  const header = Buffer.alloc(HEADER_SIZE);
  header.writeInt16LE(1, 0);
  header.writeInt16LE(frameId, 2);
  header[4] = FRAME_TYPE.I;
  header.writeInt16LE(50, 17);
  header.writeInt16LE(w, 19);
  header.writeInt16LE(h, 21);
  const pixels = Buffer.alloc(w * h);
  const tail = Buffer.from(JSON.stringify({ timestamp_ms: frameId }), "utf8");
  return Buffer.concat([header, pixels, tail]);
}

function wrapEnvelope(buf: Buffer): string {
  return zlib.deflateSync(buf).toString("base64");
}

class FakeSubscription extends EventEmitter {
  closed = false;
  async close(): Promise<void> {
    this.closed = true;
  }
}

function fakeClient(subQueue: FakeSubscription[]): DreameClient {
  const session: DreameSession = {
    accessToken: "TOK",
    uid: "UID",
    expiresAt: Date.now() + 1_000_000,
    region: "eu",
  };
  let i = 0;
  return {
    session,
    apiHost: "eu.iot.dreame.tech:13267",
    country: "GB",
    lang: "en",
    region: "eu",
    subscribe: async () => {
      const sub = subQueue[i++] ?? subQueue[subQueue.length - 1]!;
      return sub as unknown as DreameSubscription;
    },
    callAction: async () => ({ code: 0 }),
  } as unknown as DreameClient;
}

describe("Vacuum.map", () => {
  it("throws DreameTransportError when accessed before watch()", () => {
    const vacuum = new Vacuum(fakeClient([new FakeSubscription()]), DEVICE);
    expect(() => vacuum.map).toThrow(DreameTransportError);
  });

  it("returns the same MapManager on repeated access", async () => {
    const sub = new FakeSubscription();
    const vacuum = new Vacuum(fakeClient([sub]), DEVICE);
    await vacuum.watch();
    const a = vacuum.map;
    const b = vacuum.map;
    expect(a).toBe(b);
    await vacuum.unwatch();
  });

  it("auto-starts: forwards an inline I-frame from the subscription", async () => {
    const sub = new FakeSubscription();
    const vacuum = new Vacuum(fakeClient([sub]), DEVICE);
    await vacuum.watch();

    const events: MapData[] = [];
    vacuum.map.on("map", (d) => events.push(d));

    sub.emit("properties", [
      { did: "DID-1", siid: 6, piid: 1, value: wrapEnvelope(buildIFrame(42)) },
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]!.frameId).toBe(42);
    expect(vacuum.map.currentFrameId).toBe(42);

    await vacuum.unwatch();
  });

  it("ignores property pushes for other devices", async () => {
    const sub = new FakeSubscription();
    const vacuum = new Vacuum(fakeClient([sub]), DEVICE);
    await vacuum.watch();
    const events: MapData[] = [];
    vacuum.map.on("map", (d) => events.push(d));

    sub.emit("properties", [
      { did: "OTHER", siid: 6, piid: 1, value: wrapEnvelope(buildIFrame(7)) },
    ]);

    expect(events).toHaveLength(0);
    await vacuum.unwatch();
  });

  it("unwatch() stops + discards the manager; the next watch() yields a fresh one", async () => {
    const sub1 = new FakeSubscription();
    const sub2 = new FakeSubscription();
    const vacuum = new Vacuum(fakeClient([sub1, sub2]), DEVICE);

    await vacuum.watch();
    const m1 = vacuum.map;
    sub1.emit("properties", [
      { did: "DID-1", siid: 6, piid: 1, value: wrapEnvelope(buildIFrame(10)) },
    ]);
    expect(m1.currentFrameId).toBe(10);

    await vacuum.unwatch();
    expect(() => vacuum.map).toThrow(DreameTransportError);

    await vacuum.watch();
    const m2 = vacuum.map;
    expect(m2).not.toBe(m1);
    expect(m2.current).toBeNull();

    sub2.emit("properties", [
      { did: "DID-1", siid: 6, piid: 1, value: wrapEnvelope(buildIFrame(99)) },
    ]);
    expect(m2.currentFrameId).toBe(99);

    await vacuum.unwatch();
  });
});
