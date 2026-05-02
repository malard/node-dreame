import { describe, it, expect } from "vitest";
import {
  REGION_HOSTS,
  REGION_DEFAULT_COUNTRY,
  REGION_DEFAULT_LANG,
  OAUTH_BASIC_AUTH,
  APP_META,
  APP_USER_AGENT,
  TENANT_DREAME,
} from "../src/config.js";

const ALL_REGIONS = ["eu", "us", "cn", "ru", "sg", "in", "de", "tw"] as const;

describe("region tables", () => {
  it("REGION_HOSTS has an entry for every supported region", () => {
    for (const r of ALL_REGIONS) {
      expect(REGION_HOSTS[r]).toMatch(/^[a-z]+\.iot\.dreame\.tech:\d+$/);
    }
  });

  it("REGION_DEFAULT_COUNTRY uses ISO-3166-2 codes", () => {
    for (const r of ALL_REGIONS) {
      expect(REGION_DEFAULT_COUNTRY[r]).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("REGION_DEFAULT_LANG uses ISO-639-1 codes", () => {
    for (const r of ALL_REGIONS) {
      expect(REGION_DEFAULT_LANG[r]).toMatch(/^[a-z]{2}$/);
    }
  });

  it("eu region resolves to the EU production host", () => {
    expect(REGION_HOSTS["eu"]).toBe("eu.iot.dreame.tech:13267");
  });
});

describe("static app constants", () => {
  it("OAUTH_BASIC_AUTH base64-decodes to the documented client credential pair", () => {
    const raw = Buffer.from(
      OAUTH_BASIC_AUTH.replace(/^Basic\s+/, ""),
      "base64",
    ).toString("utf8");
    expect(raw).toBe("dreame_appv1:AP^dv@z@SQYVxN88");
  });

  it("APP_META has the expected cv= shape", () => {
    expect(APP_META).toMatch(/^cv=i_\d+$/);
  });

  it("APP_USER_AGENT is the Dart/Flutter fingerprint", () => {
    expect(APP_USER_AGENT).toBe("Dart/3.2 (dart:io)");
  });

  it("TENANT_DREAME is '000000'", () => {
    expect(TENANT_DREAME).toBe("000000");
  });
});
