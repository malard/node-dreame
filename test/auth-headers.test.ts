import { describe, it, expect } from "vitest";
import { buildHeaders } from "../src/auth.js";

describe("buildHeaders", () => {
  it("uses the literal 'bearer' value when no access token is given (pre-login)", () => {
    const h = buildHeaders({ region: "eu", country: "GB", lang: "en" });
    expect(h["dreame-auth"]).toBe("bearer");
  });

  it("uses 'bearer <token>' when an access token is supplied", () => {
    const h = buildHeaders({
      region: "eu",
      country: "GB",
      lang: "en",
      accessToken: "abc.def.ghi",
    });
    expect(h["dreame-auth"]).toBe("bearer abc.def.ghi");
  });

  it("treats null accessToken the same as absent", () => {
    const h = buildHeaders({
      region: "eu",
      country: "GB",
      lang: "en",
      accessToken: null,
    });
    expect(h["dreame-auth"]).toBe("bearer");
  });

  it("defaults content-type to form-urlencoded", () => {
    const h = buildHeaders({ region: "eu", country: "GB", lang: "en" });
    expect(h["content-type"]).toBe("application/x-www-form-urlencoded");
  });

  it("respects an overridden content-type", () => {
    const h = buildHeaders({
      region: "eu",
      country: "GB",
      lang: "en",
      contentType: "application/json",
    });
    expect(h["content-type"]).toBe("application/json");
  });

  it("includes all the static Dreame app headers", () => {
    const h = buildHeaders({ region: "eu", country: "GB", lang: "en" });
    expect(h["user-agent"]).toBe("Dart/3.2 (dart:io)");
    expect(h["authorization"]).toBe(
      "Basic ZHJlYW1lX2FwcHYxOkFQXmR2QHpAU1FZVnhOODg=",
    );
    expect(h["dreame-meta"]).toBe("cv=i_829");
    expect(h["tenant-id"]).toBe("000000");
  });

  it("computes a region-specific dreame-rlc header", () => {
    const eu = buildHeaders({ region: "eu", country: "GB", lang: "en" });
    const us = buildHeaders({ region: "us", country: "US", lang: "en" });
    expect(eu["dreame-rlc"]).toMatch(/^[0-9a-f]+$/);
    expect(eu["dreame-rlc"]).not.toBe(us["dreame-rlc"]);
  });
});
