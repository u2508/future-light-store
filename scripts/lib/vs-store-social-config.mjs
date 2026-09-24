import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const SOCIAL_ENV_FILES = [".env.vs-store-social.local", ".env.vs-store-social"];

function parseEnvValue(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return "";
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value.replace(/\s+#.*$/, "").trim();
}

export async function loadVsStoreSocialEnv(rootDir) {
  for (const relativePath of SOCIAL_ENV_FILES) {
    const filePath = resolve(rootDir, relativePath);
    if (!existsSync(filePath)) continue;
    const content = await readFile(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      const key = match[1];
      // This loader intentionally accepts only the standalone social variables.
      // It never imports release or SALT environment entries.
      if (
        !key.startsWith("FUTURE_LIGHT_") &&
        !key.startsWith("VS_STORE_") &&
        key !== "OPENAI_API_KEY"
      )
        continue;
      process.env[key] = parseEnvValue(match[2]);
    }
  }
}

function positiveNumber(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function positiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  return Math.floor(positiveNumber(value, fallback, { min, max }));
}

function normalizeStoreDomain(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function boolEnv(value, fallback = false) {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  return /^(1|true|yes|on)$/i.test(raw);
}

function firstEnv(...keys) {
  for (const key of keys) {
    const value = String(process.env[key] || "").trim();
    if (value) return value;
  }
  return "";
}

function normalizeSessionName(value) {
  return (
    String(value || "vs-store-social")
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "vs-store-social"
  );
}

export function readVsStoreSocialConfig(rootDir) {
  const storeDomain = normalizeStoreDomain(process.env.FUTURE_LIGHT_SHOPIFY_STORE_DOMAIN);
  const shopifyUseCli = /^(1|true|yes|on)$/i.test(
    String(process.env.FUTURE_LIGHT_SHOPIFY_USE_CLI || ""),
  );
  const siteUrl = String(
    process.env.FUTURE_LIGHT_SOCIAL_SITE_URL || "https://vs-store-us.myshopify.com",
  ).replace(/\/$/, "");
  const timezone =
    String(process.env.FUTURE_LIGHT_SOCIAL_TIMEZONE || "America/New_York").trim() ||
    "America/New_York";
  const offerWeekday = positiveInteger(process.env.FUTURE_LIGHT_SOCIAL_OFFER_WEEKDAY, 5, {
    min: 0,
    max: 6,
  });
  const socialOutputDir = resolve(
    firstEnv("VS_STORE_SOCIAL_OUTPUT_DIR") || resolve(rootDir, "output", "social"),
  );
  const browserProfileDir = resolve(
    firstEnv("VS_STORE_BROWSER_PROFILE_DIR") || resolve(rootDir, "..", ".vs-store-social-browser"),
  );
  const facebookPageId = firstEnv("VS_STORE_FACEBOOK_PAGE_ID", "FUTURE_LIGHT_META_PAGE_ID");
  const instagramHandle =
    firstEnv("VS_STORE_INSTAGRAM_HANDLE", "FUTURE_LIGHT_META_INSTAGRAM_USERNAME") || "vs.store2608";
  const metaImageSource = firstEnv("FUTURE_LIGHT_META_IMAGE_SOURCE") || "facebook-post";

  return {
    rootDir,
    storeDomain,
    siteUrl,
    socialPublisher: firstEnv("VS_STORE_SOCIAL_PUBLISHER") || "business-suite-browser",
    socialTimezone: timezone,
    socialPublishMode: firstEnv("VS_STORE_SOCIAL_PUBLISH_MODE") || "now",
    socialPostTimeEt: firstEnv("VS_STORE_SOCIAL_POST_TIME_ET"),
    socialLiveEnabled: boolEnv(process.env.VS_STORE_SOCIAL_LIVE_ENABLED, false),
    socialOutputDir,
    browserSession: normalizeSessionName(firstEnv("VS_STORE_BROWSER_SESSION") || "vs-store-social"),
    browserProfileDir,
    businessSuiteUrl: firstEnv("VS_STORE_BUSINESS_SUITE_URL") || "https://business.facebook.com/",
    facebookPageName: firstEnv("VS_STORE_FACEBOOK_PAGE_NAME") || "VS Store",
    facebookPageId,
    facebookPageUrl: firstEnv("VS_STORE_FACEBOOK_PAGE_URL"),
    instagramHandle,
    metaPageId: facebookPageId,
    metaPageAccessToken: String(process.env.FUTURE_LIGHT_META_PAGE_ACCESS_TOKEN || "").trim(),
    metaInstagramAccessToken: String(
      process.env.FUTURE_LIGHT_META_INSTAGRAM_ACCESS_TOKEN || "",
    ).trim(),
    // The linked Instagram identity is shared by API preflight and the browser
    // fallback; Page Login can use the Page token for both destinations.
    metaInstagramAccountId: String(process.env.FUTURE_LIGHT_META_INSTAGRAM_ACCOUNT_ID || "").trim(),
    metaInstagramUsername: instagramHandle,
    // API mode can opt into a verified public URL; the default Facebook
    // readback path avoids requiring one. Browser mode never needs this value.
    metaInstagramPublicImageUrl: String(
      process.env.FUTURE_LIGHT_META_INSTAGRAM_PUBLIC_IMAGE_URL || "",
    ).trim(),
    metaImageSource,
    metaGraphVersion: String(process.env.FUTURE_LIGHT_META_GRAPH_VERSION || "v23.0").trim(),
    shopifyAdminAccessToken: String(
      process.env.FUTURE_LIGHT_SHOPIFY_ADMIN_ACCESS_TOKEN || "",
    ).trim(),
    shopifyUseCli,
    shopifyCliBinary:
      String(process.env.FUTURE_LIGHT_SHOPIFY_CLI_BINARY || "shopify").trim() || "shopify",
    shopifyApiVersion: String(process.env.FUTURE_LIGHT_SHOPIFY_API_VERSION || "2026-07").trim(),
    timezone,
    fallbackHour: positiveInteger(process.env.FUTURE_LIGHT_SOCIAL_FALLBACK_HOUR, 12, {
      min: 0,
      max: 23,
    }),
    offerWeekday,
    defaultDiscountPercent: positiveNumber(
      process.env.FUTURE_LIGHT_SOCIAL_DEFAULT_DISCOUNT_PERCENT,
      10,
      { min: 1, max: 15 },
    ),
    maxDiscountPercent: positiveNumber(process.env.FUTURE_LIGHT_SOCIAL_MAX_DISCOUNT_PERCENT, 15, {
      min: 1,
      max: 15,
    }),
    primaryDiscountCode:
      String(process.env.FUTURE_LIGHT_SOCIAL_PRIMARY_DISCOUNT_CODE || "VSSTORE15").trim() ||
      "VSSTORE15",
    fallbackDiscountCode:
      String(process.env.FUTURE_LIGHT_SOCIAL_FALLBACK_DISCOUNT_CODE || "VSSTORE10").trim() ||
      "VSSTORE10",
    primaryDiscountPercent: 15,
    fallbackDiscountPercent: 10,
    offerWindowDays: positiveInteger(process.env.FUTURE_LIGHT_SOCIAL_OFFER_WINDOW_DAYS, 7, {
      min: 1,
      max: 30,
    }),
    overheadUsd: positiveNumber(process.env.FUTURE_LIGHT_SOCIAL_OVERHEAD_USD, 16, {
      min: 0,
      max: 100_000,
    }),
    minimumContributionUsd: positiveNumber(
      process.env.FUTURE_LIGHT_SOCIAL_MIN_NET_CONTRIBUTION_USD,
      10,
      { min: 0, max: 100_000 },
    ),
    requestConcurrency: positiveInteger(process.env.FUTURE_LIGHT_SOCIAL_REQUEST_CONCURRENCY, 5, {
      min: 1,
      max: 12,
    }),
    requestTimeoutMs: positiveInteger(process.env.FUTURE_LIGHT_SOCIAL_REQUEST_TIMEOUT_MS, 30_000, {
      min: 5_000,
      max: 180_000,
    }),
    maxAttempts: positiveInteger(process.env.FUTURE_LIGHT_SOCIAL_MAX_ATTEMPTS, 5, {
      min: 1,
      max: 10,
    }),
    networkPollMs: positiveInteger(process.env.FUTURE_LIGHT_SOCIAL_NETWORK_POLL_MS, 30_000, {
      min: 5_000,
      max: 300_000,
    }),
    networkMaxWaitMs: positiveInteger(
      process.env.FUTURE_LIGHT_SOCIAL_NETWORK_MAX_WAIT_MS,
      1_800_000,
      { min: 30_000, max: 21_600_000 },
    ),
    fontFile: String(process.env.FUTURE_LIGHT_SOCIAL_FONT_FILE || "").trim(),
  };
}

export function configMissing(config, { includeMeta = true, includeShopify = true } = {}) {
  const missing = [];
  if (includeMeta) {
    const apiPrimary = ["meta-api-primary", "meta-api", "auto"].includes(config.socialPublisher);
    if (!apiPrimary && config.socialPublisher !== "business-suite-browser") {
      missing.push("VS_STORE_SOCIAL_PUBLISHER=meta-api-primary or business-suite-browser");
    } else if (apiPrimary) {
      if (!config.facebookPageName) missing.push("VS_STORE_FACEBOOK_PAGE_NAME");
      if (!config.facebookPageId) missing.push("VS_STORE_FACEBOOK_PAGE_ID");
      if (!config.facebookPageUrl) missing.push("VS_STORE_FACEBOOK_PAGE_URL");
      if (!config.instagramHandle) missing.push("VS_STORE_INSTAGRAM_HANDLE");
      if (!config.businessSuiteUrl) missing.push("VS_STORE_BUSINESS_SUITE_URL");
      if (!config.browserSession) missing.push("VS_STORE_BROWSER_SESSION");
      if (!config.browserProfileDir) missing.push("VS_STORE_BROWSER_PROFILE_DIR");
    } else {
      if (!config.facebookPageName) missing.push("VS_STORE_FACEBOOK_PAGE_NAME");
      if (!config.facebookPageId) missing.push("VS_STORE_FACEBOOK_PAGE_ID");
      if (!config.facebookPageUrl) missing.push("VS_STORE_FACEBOOK_PAGE_URL");
      if (!config.instagramHandle) missing.push("VS_STORE_INSTAGRAM_HANDLE");
      if (!config.businessSuiteUrl) missing.push("VS_STORE_BUSINESS_SUITE_URL");
      if (!config.browserSession) missing.push("VS_STORE_BROWSER_SESSION");
      if (!config.browserProfileDir) missing.push("VS_STORE_BROWSER_PROFILE_DIR");
    }
  }
  if (includeShopify) {
    if (!config.storeDomain) missing.push("FUTURE_LIGHT_SHOPIFY_STORE_DOMAIN");
    if (!config.shopifyAdminAccessToken && !config.shopifyUseCli)
      missing.push("FUTURE_LIGHT_SHOPIFY_ADMIN_ACCESS_TOKEN or FUTURE_LIGHT_SHOPIFY_USE_CLI=1");
  }
  return missing;
}

export function redactedConfig(config) {
  const apiPrimary = ["meta-api-primary", "meta-api", "auto"].includes(config.socialPublisher);
  return {
    storeDomain: config.storeDomain || null,
    siteUrl: config.siteUrl,
    publisher: config.socialPublisher,
    liveEnabled: Boolean(config.socialLiveEnabled),
    publishMode: config.socialPublishMode,
    postTimeEt: config.socialPostTimeEt || null,
    outputDir: config.socialOutputDir,
    browserSession: config.browserSession,
    browserProfileConfigured: Boolean(config.browserProfileDir),
    businessSuiteUrl: config.businessSuiteUrl,
    facebookPageName: config.facebookPageName || null,
    facebookPageId: config.facebookPageId || null,
    facebookPageUrl: config.facebookPageUrl || null,
    instagramHandle: config.instagramHandle || null,
    metaPageId: config.metaPageId || null,
    metaInstagramAccountId: config.metaInstagramAccountId || null,
    metaInstagramUsername: config.metaInstagramUsername || null,
    metaImageSource: config.metaImageSource || null,
    metaInstagramPublicImageConfigured: Boolean(config.metaInstagramPublicImageUrl),
    metaApiPublishingDisabled: !apiPrimary,
    metaApiFallbackEnabled: false,
    metaApiCredentialsReady: Boolean(config.metaPageAccessToken && config.metaInstagramAccountId),
    metaInstagramPublicImageIgnored: config.metaImageSource !== "public-url",
    metaGraphVersion: config.metaGraphVersion,
    shopifyApiVersion: config.shopifyApiVersion,
    shopifyAuthMode: config.shopifyUseCli
      ? "shopify-cli"
      : config.shopifyAdminAccessToken
        ? "admin-token"
        : "none",
    shopifyCliBinary: config.shopifyCliBinary,
    timezone: config.timezone,
    fallbackHour: config.fallbackHour,
    offerWeekday: config.offerWeekday,
    defaultDiscountPercent: config.defaultDiscountPercent,
    maxDiscountPercent: config.maxDiscountPercent,
    primaryDiscountCode: config.primaryDiscountCode,
    fallbackDiscountCode: config.fallbackDiscountCode,
    primaryDiscountPercent: config.primaryDiscountPercent,
    fallbackDiscountPercent: config.fallbackDiscountPercent,
    offerWindowDays: config.offerWindowDays,
    overheadUsd: config.overheadUsd,
    minimumContributionUsd: config.minimumContributionUsd,
    requestConcurrency: config.requestConcurrency,
    credentials: {
      metaPageAccessToken: Boolean(config.metaPageAccessToken),
      metaInstagramAccessToken: Boolean(config.metaInstagramAccessToken),
      metaInstagramAccountId: Boolean(config.metaInstagramAccountId),
      shopifyAdminAccessToken: Boolean(config.shopifyAdminAccessToken),
      shopifyCli: Boolean(config.shopifyUseCli),
      openAiKey: Boolean(process.env.OPENAI_API_KEY),
    },
  };
}
