/**
 * Tests for src/map/oss-fetch.ts.
 *
 * Asserts: request shape (URL/method/headers/body), strict response
 * parsing (data must be a string), URL caching with `current=<ts>`
 * suffix on hit, TTL expiry, did:filename scoping, fetchBlob GET path
 * and non-2xx error path.
 */

import { describe, it, expect } from "vitest";
import { OssFetcher } from "../src/map/oss-fetch.js";
import { mockFetch } from "./_helpers.js";

const COMMON_INPUT = {
  host: "eu.iot.dreame.tech:13267",
  accessToken: "TOKEN",
  region: "eu" as const,
  did: "DID-1",
  model: "dreame.vacuum.r2532a",
  filename: "ali_dreame/UID/DID-1/1234",
};

describe("OssFetcher.resolveUrl", () => {
  it("POSTs the expected URL/headers/body shape and returns data string", async () => {
    const fetchImpl = mockFetch({
      "POST /dreame-user-iot/iotfile/getDownloadUrl": {
        json: { code: 0, data: "https://oss.example/foo?sig=abc" },
      },
    });
    const fetcher = new OssFetcher({ fetchImpl });
    const url = await fetcher.resolveUrl(COMMON_INPUT);

    expect(url).toBe("https://oss.example/foo?sig=abc");
    expect(fetchImpl.calls).toHaveLength(1);
    const call = fetchImpl.calls[0]!;
    expect(call.method).toBe("POST");
    expect(call.url).toBe(
      "https://eu.iot.dreame.tech:13267/dreame-user-iot/iotfile/getDownloadUrl",
    );
    expect(call.headers["dreame-auth"]).toBe("bearer TOKEN");
    expect(call.headers["content-type"]).toBe("application/json");
    expect(call.bodyJson).toEqual({
      did: "DID-1",
      model: "dreame.vacuum.r2532a",
      filename: "ali_dreame/UID/DID-1/1234",
      region: "eu",
    });
  });

  it("throws when data is missing from a code=0 response", async () => {
    const fetchImpl = mockFetch({
      "POST /dreame-user-iot/iotfile/getDownloadUrl": { json: { code: 0 } },
    });
    const fetcher = new OssFetcher({ fetchImpl });
    await expect(fetcher.resolveUrl(COMMON_INPUT)).rejects.toMatchObject({
      name: "DreameApiError",
    });
  });

  it("rejects nested-object data shape (strict — probe-only fallback removed)", async () => {
    const fetchImpl = mockFetch({
      "POST /dreame-user-iot/iotfile/getDownloadUrl": {
        json: { code: 0, data: { url: "https://oss.example/x" } },
      },
    });
    const fetcher = new OssFetcher({ fetchImpl });
    await expect(fetcher.resolveUrl(COMMON_INPUT)).rejects.toMatchObject({
      name: "DreameApiError",
    });
  });

  it("surfaces non-zero code as DreameApiError via httpPostJson", async () => {
    const fetchImpl = mockFetch({
      "POST /dreame-user-iot/iotfile/getDownloadUrl": {
        json: { code: 500, msg: "boom" },
      },
    });
    const fetcher = new OssFetcher({ fetchImpl });
    await expect(fetcher.resolveUrl(COMMON_INPUT)).rejects.toMatchObject({
      name: "DreameApiError",
    });
  });

  it("caches and appends current=<ts> on hit (no second POST)", async () => {
    let now = 1700000000000;
    const fetchImpl = mockFetch({
      "POST /dreame-user-iot/iotfile/getDownloadUrl": {
        json: { code: 0, data: "https://oss.example/foo?sig=abc" },
      },
    });
    const fetcher = new OssFetcher({ fetchImpl, now: () => now });

    const url1 = await fetcher.resolveUrl(COMMON_INPUT);
    expect(url1).toBe("https://oss.example/foo?sig=abc");
    expect(fetchImpl.calls).toHaveLength(1);

    now += 60_000;
    const url2 = await fetcher.resolveUrl(COMMON_INPUT);
    expect(url2).toBe(
      `https://oss.example/foo?sig=abc&current=${Math.floor(now / 1000)}`,
    );
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it("uses ? separator when cached URL has no query string", async () => {
    let now = 1700000000000;
    const fetchImpl = mockFetch({
      "POST /dreame-user-iot/iotfile/getDownloadUrl": {
        json: { code: 0, data: "https://oss.example/bare" },
      },
    });
    const fetcher = new OssFetcher({ fetchImpl, now: () => now });
    await fetcher.resolveUrl(COMMON_INPUT);
    now += 1000;
    const url2 = await fetcher.resolveUrl(COMMON_INPUT);
    expect(url2).toBe(
      `https://oss.example/bare?current=${Math.floor(now / 1000)}`,
    );
  });

  it("re-resolves after TTL expires", async () => {
    let now = 1700000000000;
    let counter = 0;
    const fetchImpl = mockFetch({
      "POST /dreame-user-iot/iotfile/getDownloadUrl": () => {
        counter++;
        return { json: { code: 0, data: `https://oss.example/foo?n=${counter}` } };
      },
    });
    const fetcher = new OssFetcher({ fetchImpl, ttlMs: 1000, now: () => now });

    expect(await fetcher.resolveUrl(COMMON_INPUT)).toBe(
      "https://oss.example/foo?n=1",
    );
    now += 2000;
    expect(await fetcher.resolveUrl(COMMON_INPUT)).toBe(
      "https://oss.example/foo?n=2",
    );
    expect(fetchImpl.calls).toHaveLength(2);
  });

  it("scopes cache by did and filename", async () => {
    const fetchImpl = mockFetch({
      "POST /dreame-user-iot/iotfile/getDownloadUrl": (req) => {
        const body = req.bodyJson as { filename: string };
        return { json: { code: 0, data: `https://oss.example/${body.filename}?sig=x` } };
      },
    });
    const fetcher = new OssFetcher({ fetchImpl });
    await fetcher.resolveUrl(COMMON_INPUT);
    await fetcher.resolveUrl({ ...COMMON_INPUT, filename: "ali_dreame/UID/DID-1/9999" });
    await fetcher.resolveUrl({ ...COMMON_INPUT, did: "DID-2" });
    expect(fetchImpl.calls).toHaveLength(3);
  });

  it("clearCache forces re-resolve", async () => {
    let counter = 0;
    const fetchImpl = mockFetch({
      "POST /dreame-user-iot/iotfile/getDownloadUrl": () => {
        counter++;
        return { json: { code: 0, data: `https://oss.example/foo?n=${counter}` } };
      },
    });
    const fetcher = new OssFetcher({ fetchImpl });
    await fetcher.resolveUrl(COMMON_INPUT);
    fetcher.clearCache();
    await fetcher.resolveUrl(COMMON_INPUT);
    expect(fetchImpl.calls).toHaveLength(2);
  });
});

describe("OssFetcher.fetchBlob", () => {
  it("resolves URL then GETs it and returns the body bytes", async () => {
    const payload = "Hello, world";
    const fetchImpl = mockFetch({
      "POST /dreame-user-iot/iotfile/getDownloadUrl": {
        json: { code: 0, data: "https://oss.example/blob?sig=abc" },
      },
      "GET https://oss.example/blob": { text: payload },
    });
    const fetcher = new OssFetcher({ fetchImpl });

    const out = await fetcher.fetchBlob(COMMON_INPUT);
    expect(out.toString("utf8")).toBe(payload);
    expect(fetchImpl.calls).toHaveLength(2);
    expect(fetchImpl.calls[0]!.method).toBe("POST");
    expect(fetchImpl.calls[1]!.method).toBe("GET");
  });

  it("throws DreameApiError on non-2xx GET", async () => {
    const fetchImpl = mockFetch({
      "POST /dreame-user-iot/iotfile/getDownloadUrl": {
        json: { code: 0, data: "https://oss.example/blob?sig=abc" },
      },
      "GET https://oss.example/blob": { status: 403, text: "forbidden" },
    });
    const fetcher = new OssFetcher({ fetchImpl });
    await expect(fetcher.fetchBlob(COMMON_INPUT)).rejects.toMatchObject({
      name: "DreameApiError",
      status: 403,
    });
  });

  it("coalesces concurrent fetchBlob calls for the same (did, filename)", async () => {
    let getCount = 0;
    let releaseGet: (() => void) | null = null;
    const gate = new Promise<void>((r) => {
      releaseGet = r;
    });
    const fetchImpl = mockFetch({
      "POST /dreame-user-iot/iotfile/getDownloadUrl": {
        json: { code: 0, data: "https://oss.example/blob?sig=abc" },
      },
      "GET https://oss.example/blob": async () => {
        getCount++;
        await gate;
        return { text: "payload" };
      },
    });
    const fetcher = new OssFetcher({ fetchImpl });

    const a = fetcher.fetchBlob(COMMON_INPUT);
    const b = fetcher.fetchBlob(COMMON_INPUT);
    releaseGet!();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.toString("utf8")).toBe("payload");
    expect(rb.toString("utf8")).toBe("payload");
    // Single underlying GET despite two concurrent callers.
    expect(getCount).toBe(1);
    // Resolve URL still happens once thanks to the URL cache.
    expect(fetchImpl.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });
});
