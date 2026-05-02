import { describe, it, expect } from "vitest";
import { createCipheriv, createHash } from "node:crypto";
import {
  buildRlcHeader,
  hashPassword,
  randomMqttClientId,
  randomRequestId,
} from "../src/crypto.js";

describe("hashPassword", () => {
  it("salts the plaintext with the global app salt before hashing", () => {
    // We assert the salt + algorithm by recomputing the expected MD5 with the
    // documented salt — if the salt changes (Dreame ships a new app version),
    // this test fails loudly and points at the change site.
    const SALT = "RAylYC%fmSKp7%Tq";
    const plain = "hunter2";
    const expected = createHash("md5").update(plain + SALT).digest("hex");
    expect(hashPassword(plain)).toBe(expected);
  });

  it("returns lowercase hex of length 32", () => {
    const out = hashPassword("anything");
    expect(out).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is deterministic for the same input", () => {
    expect(hashPassword("repeat-me")).toBe(hashPassword("repeat-me"));
  });

  it("handles empty input without throwing", () => {
    expect(hashPassword("")).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("buildRlcHeader", () => {
  it("produces hex string with even length (whole bytes)", () => {
    const out = buildRlcHeader("eu", "en", "GB");
    expect(out).toMatch(/^[0-9a-f]+$/);
    expect(out.length % 2).toBe(0);
  });

  it("matches a manual AES-128-ECB encryption of the plaintext", () => {
    const KEY = "EETjszu*XI5znHsI";
    const plaintext = "eu|en|GB";
    const cipher = createCipheriv("aes-128-ecb", Buffer.from(KEY, "utf8"), null);
    const expected = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]).toString("hex");
    expect(buildRlcHeader("eu", "en", "GB")).toBe(expected);
  });

  it("varies with region/lang/country (different plaintext → different ciphertext)", () => {
    const a = buildRlcHeader("eu", "en", "GB");
    const b = buildRlcHeader("us", "en", "US");
    const c = buildRlcHeader("eu", "de", "DE");
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });

  it("is deterministic for the same inputs", () => {
    expect(buildRlcHeader("eu", "en", "GB")).toBe(buildRlcHeader("eu", "en", "GB"));
  });
});

describe("randomMqttClientId", () => {
  it("uses the 'p_' prefix + 16 hex chars (8 random bytes)", () => {
    expect(randomMqttClientId()).toMatch(/^p_[0-9a-f]{16}$/);
  });

  it("is statistically unique across calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(randomMqttClientId());
    }
    expect(ids.size).toBe(100);
  });
});

describe("randomRequestId", () => {
  it("returns an integer in [1000, 9999]", () => {
    for (let i = 0; i < 1000; i++) {
      const id = randomRequestId();
      expect(Number.isInteger(id)).toBe(true);
      expect(id).toBeGreaterThanOrEqual(1000);
      expect(id).toBeLessThanOrEqual(9999);
    }
  });
});
