import { describe, it, expect } from "vitest";
import { login, refresh } from "../src/auth.js";
import { DreameAuthError } from "../src/errors.js";
import { hashPassword } from "../src/crypto.js";
import { mockFetch } from "./_helpers.js";

describe("login()", () => {
  it("posts to the EU oauth/token endpoint with the documented form fields", async () => {
    const fetchImpl = mockFetch({
      "POST /dreame-auth/oauth/token": {
        status: 200,
        json: {
          access_token: "JWT-A",
          refresh_token: "JWT-R",
          expires_in: 7200,
          uid: 42,
        },
      },
    });

    await login({ email: "user@example.com", password: "pw", region: "eu", fetchImpl });

    expect(fetchImpl.calls).toHaveLength(1);
    const call = fetchImpl.calls[0]!;
    expect(call.url).toBe("https://eu.iot.dreame.tech:13267/dreame-auth/oauth/token");
    expect(call.method).toBe("POST");
    expect(call.bodyForm).toMatchObject({
      grant_type: "password",
      scope: "all",
      platform: "IOS",
      type: "account",
      username: "user@example.com",
      password: hashPassword("pw"),
      country: "GB",
      lang: "en",
    });
  });

  it("returns a session with stringified uid and expiresAt = now + expires_in*1000", async () => {
    const before = Date.now();
    const fetchImpl = mockFetch({
      "POST /dreame-auth/oauth/token": {
        status: 200,
        json: { access_token: "A", refresh_token: "R", expires_in: 1000, uid: 42 },
      },
    });
    const session = await login({ email: "u@e", password: "p", region: "eu", fetchImpl });
    const after = Date.now();

    expect(session.accessToken).toBe("A");
    expect(session.refreshToken).toBe("R");
    expect(session.uid).toBe("42");
    expect(session.region).toBe("eu");
    expect(session.expiresAt).toBeGreaterThanOrEqual(before + 1000 * 1000);
    expect(session.expiresAt).toBeLessThanOrEqual(after + 1000 * 1000 + 50);
  });

  it("defaults expires_in to 7200 when omitted", async () => {
    const fetchImpl = mockFetch({
      "POST /dreame-auth/oauth/token": {
        status: 200,
        json: { access_token: "A", uid: "1" },
      },
    });
    const session = await login({ email: "u@e", password: "p", region: "eu", fetchImpl });
    expect(session.expiresAt - Date.now()).toBeGreaterThan(7100 * 1000);
  });

  it("throws DreameAuthError when the response carries OAuth-style error fields", async () => {
    const fetchImpl = mockFetch({
      "POST /dreame-auth/oauth/token": {
        status: 200,
        json: { error: "invalid_grant", error_description: "wrong password" },
      },
    });
    await expect(
      login({ email: "u@e", password: "wrong", region: "eu", fetchImpl }),
    ).rejects.toMatchObject({ name: "DreameAuthError", message: /invalid_grant/ });
  });

  it("throws DreameAuthError on missing access_token", async () => {
    const fetchImpl = mockFetch({
      "POST /dreame-auth/oauth/token": { status: 200, json: { uid: "1" } },
    });
    await expect(
      login({ email: "u@e", password: "p", region: "eu", fetchImpl }),
    ).rejects.toBeInstanceOf(DreameAuthError);
  });

  it("throws DreameAuthError on missing uid", async () => {
    const fetchImpl = mockFetch({
      "POST /dreame-auth/oauth/token": { status: 200, json: { access_token: "x" } },
    });
    await expect(
      login({ email: "u@e", password: "p", region: "eu", fetchImpl }),
    ).rejects.toBeInstanceOf(DreameAuthError);
  });

  it("propagates the hashed (not plaintext) password on the wire", async () => {
    const fetchImpl = mockFetch({
      "POST /dreame-auth/oauth/token": {
        status: 200,
        json: { access_token: "A", uid: "1" },
      },
    });
    await login({ email: "u@e", password: "supersecret", region: "eu", fetchImpl });
    expect(fetchImpl.calls[0]!.bodyForm?.password).not.toBe("supersecret");
    expect(fetchImpl.calls[0]!.bodyForm?.password).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("refresh()", () => {
  it("uses grant_type=refresh_token, posts to the same endpoint", async () => {
    const fetchImpl = mockFetch({
      "POST /dreame-auth/oauth/token": {
        status: 200,
        json: { access_token: "NEW", uid: "1", expires_in: 7200 },
      },
    });
    const session = await refresh({ refreshToken: "OLD-R", region: "eu", fetchImpl });

    expect(session.accessToken).toBe("NEW");
    expect(fetchImpl.calls[0]!.bodyForm).toEqual({
      grant_type: "refresh_token",
      refresh_token: "OLD-R",
    });
  });
});
