import { describe, it, expect } from "vitest";
import {
  DreameApiError,
  DreameAuthError,
  DreameDeviceOfflineError,
  DreameError,
  DreameTransportError,
} from "../src/errors.js";

describe("error class hierarchy", () => {
  it("DreameError extends Error", () => {
    const e = new DreameError("boom");
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(DreameError);
    expect(e.name).toBe("DreameError");
    expect(e.message).toBe("boom");
  });

  it("DreameAuthError extends DreameError", () => {
    const e = new DreameAuthError("bad creds", 401);
    expect(e).toBeInstanceOf(DreameError);
    expect(e).toBeInstanceOf(DreameAuthError);
    expect(e.name).toBe("DreameAuthError");
    expect(e.status).toBe(401);
  });

  it("DreameApiError extends DreameError and carries status + body", () => {
    const e = new DreameApiError("nope", 500, { code: 999 });
    expect(e).toBeInstanceOf(DreameError);
    expect(e).toBeInstanceOf(DreameApiError);
    expect(e.name).toBe("DreameApiError");
    expect(e.status).toBe(500);
    expect(e.body).toEqual({ code: 999 });
  });

  it("DreameDeviceOfflineError extends DreameApiError (catchable as either)", () => {
    const e = new DreameDeviceOfflineError("device offline", 200, { code: 80001 });
    expect(e).toBeInstanceOf(DreameApiError);
    expect(e).toBeInstanceOf(DreameDeviceOfflineError);
    expect(e.name).toBe("DreameDeviceOfflineError");
  });

  it("DreameTransportError extends DreameError and accepts a cause", () => {
    const cause = new Error("ETIMEDOUT");
    const e = new DreameTransportError("network", cause);
    expect(e).toBeInstanceOf(DreameError);
    expect(e).toBeInstanceOf(DreameTransportError);
    expect(e.name).toBe("DreameTransportError");
    expect(e.cause).toBe(cause);
  });

  it("a 80001 catch-block can distinguish offline from other API errors", () => {
    const offline = new DreameDeviceOfflineError("offline", 200);
    const other = new DreameApiError("other failure", 500);
    expect(offline instanceof DreameDeviceOfflineError).toBe(true);
    expect(other instanceof DreameDeviceOfflineError).toBe(false);
    // Both are DreameApiError, so a fallback handler can still see them:
    expect(offline instanceof DreameApiError).toBe(true);
    expect(other instanceof DreameApiError).toBe(true);
  });
});
