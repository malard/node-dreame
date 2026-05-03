import { describe, it, expect } from "vitest";
import { httpPostJson, RequestContext } from "../src/http.js";
import {
  DreameAuthError,
  DreameDeviceOfflineError,
  DreameTransportError,
} from "../src/errors.js";
import { mockFetch } from "./_helpers.js";

function makeCtx(overrides: { fetchImpl?: typeof fetch } = {}): RequestContext {
  return new RequestContext({
    region: "eu",
    ...(overrides.fetchImpl !== undefined ? { fetchImpl: overrides.fetchImpl } : {}),
  });
}

describe("RequestContext", () => {
  it("resolves country/lang/host defaults from region", () => {
    const ctx = new RequestContext({ region: "eu" });
    expect(ctx.country).toBe("GB");
    expect(ctx.lang).toBe("en");
    expect(ctx.host).toBe("eu.iot.dreame.tech:13267");
  });

  it("respects overrides", () => {
    const ctx = new RequestContext({ region: "eu", country: "FR", lang: "fr", host: "test.example:1234" });
    expect(ctx.country).toBe("FR");
    expect(ctx.lang).toBe("fr");
    expect(ctx.host).toBe("test.example:1234");
  });

  it("url() builds https URL with leading-slash path", () => {
    const ctx = new RequestContext({ region: "eu" });
    expect(ctx.url("/foo/bar")).toBe("https://eu.iot.dreame.tech:13267/foo/bar");
  });

  it("headers() includes the dreame-rlc + content-type with bearer token when given", () => {
    const ctx = new RequestContext({ region: "eu" });
    const h = ctx.headers({ accessToken: "abc", contentType: "application/json" });
    expect(h["dreame-auth"]).toBe("bearer abc");
    expect(h["content-type"]).toBe("application/json");
    expect(h["dreame-rlc"]).toMatch(/^[0-9a-f]+$/);
  });
});

describe("httpPostJson — error classification", () => {
  it("throws DreameTransportError when fetch throws (network error)", async () => {
    const fetchImpl = (() => {
      throw new TypeError("network is down");
    }) as unknown as typeof fetch;
    const ctx = makeCtx({ fetchImpl });

    await expect(
      httpPostJson({
        ctx,
        url: ctx.url("/x"),
        headers: {},
        body: "",
        context: "test",
      }),
    ).rejects.toBeInstanceOf(DreameTransportError);
  });

  it("throws DreameApiError on HTTP 4xx", async () => {
    const fetchImpl = mockFetch({
      "POST /x": { status: 400, text: "bad request" },
    });
    const ctx = makeCtx({ fetchImpl });

    await expect(
      httpPostJson({ ctx, url: ctx.url("/x"), headers: {}, body: "", context: "test" }),
    ).rejects.toMatchObject({ name: "DreameApiError", status: 400 });
  });

  it("throws DreameApiError on non-JSON 200 response", async () => {
    const fetchImpl = mockFetch({
      "POST /x": { status: 200, text: "not json", contentType: "text/plain" },
    });
    const ctx = makeCtx({ fetchImpl });

    await expect(
      httpPostJson({ ctx, url: ctx.url("/x"), headers: {}, body: "", context: "test" }),
    ).rejects.toMatchObject({ name: "DreameApiError" });
  });

  it("throws DreameDeviceOfflineError on code 80001", async () => {
    const fetchImpl = mockFetch({
      "POST /x": { status: 200, json: { code: 80001, msg: "device offline" } },
    });
    const ctx = makeCtx({ fetchImpl });

    await expect(
      httpPostJson({ ctx, url: ctx.url("/x"), headers: {}, body: "", context: "test" }),
    ).rejects.toBeInstanceOf(DreameDeviceOfflineError);
  });

  it("throws DreameApiError on other non-zero codes", async () => {
    const fetchImpl = mockFetch({
      "POST /x": { status: 200, json: { code: 12345, msg: "broken" } },
    });
    const ctx = makeCtx({ fetchImpl });

    await expect(
      httpPostJson({ ctx, url: ctx.url("/x"), headers: {}, body: "", context: "test" }),
    ).rejects.toMatchObject({ name: "DreameApiError", body: { code: 12345, msg: "broken" } });
  });

  it("returns parsed body when code is 0", async () => {
    const fetchImpl = mockFetch({
      "POST /x": { status: 200, json: { code: 0, data: { result: "ok" } } },
    });
    const ctx = makeCtx({ fetchImpl });

    const out = await httpPostJson<{ data?: { result?: string } }>({
      ctx,
      url: ctx.url("/x"),
      headers: {},
      body: "",
      context: "test",
    });
    expect(out.data?.result).toBe("ok");
  });

  it("skipCodeCheck mode returns body even with non-zero code (auth path)", async () => {
    const fetchImpl = mockFetch({
      "POST /token": { status: 200, json: { access_token: "x", code: 999 } },
    });
    const ctx = makeCtx({ fetchImpl });

    const out = await httpPostJson<{ access_token?: string }>({
      ctx,
      url: ctx.url("/token"),
      headers: {},
      body: "",
      context: "auth",
      skipCodeCheck: true,
    });
    expect(out.access_token).toBe("x");
  });

  it("uses errorClass override (e.g. DreameAuthError) on HTTP failure", async () => {
    const fetchImpl = mockFetch({
      "POST /token": { status: 401, text: "unauthorized" },
    });
    const ctx = makeCtx({ fetchImpl });

    await expect(
      httpPostJson({
        ctx,
        url: ctx.url("/token"),
        headers: {},
        body: "",
        context: "auth",
        errorClass: DreameAuthError,
      }),
    ).rejects.toBeInstanceOf(DreameAuthError);
  });

  it("aborts the underlying fetch when timeoutMs elapses (DreameTransportError)", async () => {
    // fetch impl that honours signal: rejects with AbortError when the signal aborts.
    const slowFetch: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          throw new Error("test fetch impl needs a signal");
        }
        signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    const ctx = makeCtx({ fetchImpl: slowFetch });

    await expect(
      httpPostJson({
        ctx,
        url: ctx.url("/slow"),
        headers: {},
        body: "",
        context: "slow op",
        timeoutMs: 20,
      }),
    ).rejects.toBeInstanceOf(DreameTransportError);
  });

  it("respects a caller-supplied AbortSignal that's already aborted", async () => {
    const slowFetch: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        const abortNow = (): void => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        };
        if (init?.signal?.aborted) {
          abortNow();
          return;
        }
        init?.signal?.addEventListener("abort", abortNow);
      });
    const ctx = makeCtx({ fetchImpl: slowFetch });
    const ctrl = new AbortController();
    ctrl.abort();

    await expect(
      httpPostJson({
        ctx,
        url: ctx.url("/foo"),
        headers: {},
        body: "",
        context: "cancel",
        signal: ctrl.signal,
      }),
    ).rejects.toBeInstanceOf(DreameTransportError);
  });
});
