import type { DreameRegion } from "./types.js";

/** Hostname (with non-standard port) of the Dreame auth + API server, per region. */
export const REGION_HOSTS: Record<DreameRegion, string> = {
  eu: "eu.iot.dreame.tech:13267",
  us: "us.iot.dreame.tech:13267",
  cn: "cn.iot.dreame.tech:13267",
  ru: "ru.iot.dreame.tech:13267",
  sg: "sg.iot.dreame.tech:13267",
  in: "in.iot.dreame.tech:13267",
  de: "eu.iot.dreame.tech:13267",
  tw: "cn.iot.dreame.tech:13267",
};

/** Default `country` form-field per region (ISO-3166 alpha-2). */
export const REGION_DEFAULT_COUNTRY: Record<DreameRegion, string> = {
  eu: "GB",
  us: "US",
  cn: "CN",
  ru: "RU",
  sg: "SG",
  in: "IN",
  de: "DE",
  tw: "TW",
};

/** Default UI language per region (ISO-639-1). */
export const REGION_DEFAULT_LANG: Record<DreameRegion, string> = {
  eu: "en",
  us: "en",
  cn: "zh",
  ru: "ru",
  sg: "en",
  in: "en",
  de: "de",
  tw: "zh",
};

/** Static OAuth2 client credentials baked into the Dreamehome app. */
export const OAUTH_BASIC_AUTH = "Basic ZHJlYW1lX2FwcHYxOkFQXmR2QHpAU1FZVnhOODg=";

/** App-version fingerprint. Update if a new app version starts requiring it. */
export const APP_META = "cv=i_829";

/** User-Agent the Flutter Dreamehome app sends. */
export const APP_USER_AGENT = "Dart/3.2 (dart:io)";

/** Tenant id — `000000` for Dreame, `000002` for Mova. */
export const TENANT_DREAME = "000000";
