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
      // This loader intentionally accepts only Future Light social variables.
      // It never imports release or SALT environment entries.
      if (!key.startsWith("FUTURE_LIGHT_") && key !== "OPENAI_API_KEY") continue;
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

export function readVsStoreSocialConfig(rootDir) {
  const storeDomain = normalizeStoreDomain(process.env.FUTURE_LIGHT_SHOPIFY_STORE_DOMAIN);
  const siteUrl = String(
    process.env.FUTURE_LIGHT_SOCIAL_SITE_URL || "https://vss-store.vercel.app",
  ).replace(/\/$/, "");
  const timezone =
    String(process.env.FUTURE_LIGHT_SOCIAL_TIMEZONE || "America/New_York").trim() ||
    "America/New_York";
  const offerWeekday = positiveInteger(process.env.FUTURE_LIGHT_SOCIAL_OFFER_WEEKDAY, 5, {
    min: 0,
    max: 6,
  });

  return {
    rootDir,
    storeDomain,
    siteUrl,
    metaPageId: String(process.env.FUTURE_LIGHT_META_PAGE_ID || "").trim(),
    metaPageAccessToken: String(process.env.FUTURE_LIGHT_META_PAGE_ACCESS_TOKEN || "").trim(),
    metaGraphVersion: String(process.env.FUTURE_LIGHT_META_GRAPH_VERSION || "v23.0").trim(),
    shopifyAdminAccessToken: String(
      process.env.FUTURE_LIGHT_SHOPIFY_ADMIN_ACCESS_TOKEN || "",
    ).trim(),
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
    browserFallbackEnabled: !/^(0|false|no)$/i.test(
      String(process.env.FUTURE_LIGHT_SOCIAL_BROWSER_FALLBACK || "1"),
    ),
    fontFile: String(process.env.FUTURE_LIGHT_SOCIAL_FONT_FILE || "").trim(),
  };
}

export function configMissing(config, { includeMeta = true, includeShopify = true } = {}) {
  const missing = [];
  if (includeMeta) {
    if (!config.metaPageId) missing.push("FUTURE_LIGHT_META_PAGE_ID");
    if (!config.metaPageAccessToken) missing.push("FUTURE_LIGHT_META_PAGE_ACCESS_TOKEN");
  }
  if (includeShopify) {
    if (!config.storeDomain) missing.push("FUTURE_LIGHT_SHOPIFY_STORE_DOMAIN");
    if (!config.shopifyAdminAccessToken) missing.push("FUTURE_LIGHT_SHOPIFY_ADMIN_ACCESS_TOKEN");
  }
  return missing;
}

export function redactedConfig(config) {
  return {
    storeDomain: config.storeDomain || null,
    siteUrl: config.siteUrl,
    metaPageId: config.metaPageId || null,
    metaGraphVersion: config.metaGraphVersion,
    shopifyApiVersion: config.shopifyApiVersion,
    timezone: config.timezone,
    fallbackHour: config.fallbackHour,
    offerWeekday: config.offerWeekday,
    defaultDiscountPercent: config.defaultDiscountPercent,
    maxDiscountPercent: config.maxDiscountPercent,
    offerWindowDays: config.offerWindowDays,
    overheadUsd: config.overheadUsd,
    minimumContributionUsd: config.minimumContributionUsd,
    requestConcurrency: config.requestConcurrency,
    browserFallbackEnabled: config.browserFallbackEnabled,
    credentials: {
      metaPageAccessToken: Boolean(config.metaPageAccessToken),
      shopifyAdminAccessToken: Boolean(config.shopifyAdminAccessToken),
      openAiKey: Boolean(process.env.OPENAI_API_KEY),
    },
  };
}
