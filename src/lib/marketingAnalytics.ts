import {
  canProcessMarketingPurpose,
  deniedMarketingConsent,
  MARKETING_CONSENT_STORAGE_KEY,
  normalizeMarketingPreferences,
  parseStoredMarketingConsent,
  persistStandaloneMarketingConsent,
  type MarketingConsentPreferences,
  type MarketingConsentSnapshot,
} from "@/lib/marketingConsent.mjs";
import { initializeTikTokPixel } from "@/lib/tiktok";

export type MarketingItem = {
  item_id: string;
  item_name: string;
  price?: number | undefined;
  quantity?: number | undefined;
  item_variant?: string | undefined;
  item_brand?: string | undefined;
  item_category?: string | undefined;
};

type MarketingParams = Record<string, unknown>;

type MetaPixelQueue = ((...args: unknown[]) => void) & {
  queue?: unknown[][];
  loaded?: boolean;
  version?: string;
};

declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>;
    gtag?: (...args: unknown[]) => void;
    fbq?: MetaPixelQueue;
    _fbq?: MetaPixelQueue;
  }
}

let initialized = false;
let metaPixelInitialized = false;
let googleInitialized = false;
let standaloneConsentCache: MarketingConsentSnapshot | null | undefined;
let lastPageViewKey = "";
const recentEventKeys = new Map<string, number>();
const consentSubscribers = new Set<(consent: MarketingConsentSnapshot) => void>();
const configuredGoogleTagIds = new Set<string>();

const ATTRIBUTION_STORAGE_KEY = "vs-store-attribution";
const GOOGLE_CLIENT_ID_ATTRIBUTE = "marketing_ga_client_id";
const ATTRIBUTION_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "gclid",
  "fbclid",
] as const;

/**
 * Shopify's Meta catalogue uses the numeric variant/content ID, not a
 * product handle or a Storefront API GID. Keep the value stable for both
 * browser events and the catalogue's `content_id` matching.
 */
export function normalizeMetaCatalogId(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const lastSegment = raw.split("/").filter(Boolean).at(-1) ?? raw;
  return /^\d+$/.test(lastSegment) ? lastSegment : raw;
}

function getGoogleClientId() {
  if (typeof document === "undefined") return "";
  const cookie = document.cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("_ga="));
  const raw = cookie?.slice("_ga=".length) || "";
  const parts = raw.split(".");
  return parts.length >= 4 ? `${parts.at(-2)}.${parts.at(-1)}`.slice(0, 100) : "";
}

type ShopifyPrivacyApi = {
  analyticsProcessingAllowed?: () => boolean;
  marketingAllowed?: () => boolean;
  currentVisitorConsent?: () => Record<string, unknown>;
  setTrackingConsent?: (
    preferences: { analytics: boolean; marketing: boolean },
    callback: () => void,
  ) => unknown;
};

type ShopifyRuntime = {
  theme?: unknown;
  loadFeatures?: (
    features: Array<{ name: string; version: string }>,
    callback: (error?: unknown) => void,
  ) => void;
  customerPrivacy?: ShopifyPrivacyApi;
  privacyBanner?: { showPreferences?: () => Promise<unknown> };
};

function getShopifyRuntime() {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { Shopify?: ShopifyRuntime }).Shopify;
}

function hasShopifyCustomerPrivacySurface() {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  const hostname = window.location.hostname.toLowerCase();
  return Boolean(
    hostname.endsWith(".myshopify.com") ||
    getShopifyRuntime()?.theme ||
    getShopifyRuntime()?.customerPrivacy ||
    document.querySelector('script[src*="/web-pixels@"]'),
  );
}

function readShopifyConsent(): MarketingConsentSnapshot {
  const privacy = getShopifyRuntime()?.customerPrivacy;
  if (
    !privacy ||
    typeof privacy.analyticsProcessingAllowed !== "function" ||
    typeof privacy.marketingAllowed !== "function"
  ) {
    return deniedMarketingConsent("shopify", false);
  }

  try {
    const visitorConsent = privacy.currentVisitorConsent?.() ?? {};
    return {
      analytics: privacy.analyticsProcessingAllowed() === true,
      advertising: privacy.marketingAllowed() === true,
      explicit: [visitorConsent["analytics"], visitorConsent["marketing"]].some(
        (value) => value === "yes" || value === "no" || value === true || value === false,
      ),
      source: "shopify",
      ready: true,
    };
  } catch {
    return deniedMarketingConsent("shopify", false);
  }
}

function readStandaloneConsent(): MarketingConsentSnapshot {
  if (standaloneConsentCache !== undefined)
    return standaloneConsentCache ?? deniedMarketingConsent();
  try {
    standaloneConsentCache = parseStoredMarketingConsent(
      window.localStorage.getItem(MARKETING_CONSENT_STORAGE_KEY),
    );
  } catch {
    standaloneConsentCache = null;
  }
  return standaloneConsentCache ?? deniedMarketingConsent();
}

export function getMarketingConsentSnapshot(): MarketingConsentSnapshot {
  if (typeof window === "undefined") return deniedMarketingConsent();
  return hasShopifyCustomerPrivacySurface() ? readShopifyConsent() : readStandaloneConsent();
}

export function subscribeMarketingConsent(listener: (consent: MarketingConsentSnapshot) => void) {
  consentSubscribers.add(listener);
  return () => {
    consentSubscribers.delete(listener);
  };
}

function getGoogleTagIds(consent: MarketingConsentSnapshot) {
  const analyticsIds = canProcessMarketingPurpose(consent, "analytics")
    ? [import.meta.env?.VITE_GOOGLE_ANALYTICS_ID]
    : [];
  const advertisingIds = canProcessMarketingPurpose(consent, "advertising")
    ? [import.meta.env?.VITE_GOOGLE_ADS_ID, import.meta.env?.VITE_GOOGLE_ADS_CONVERSION_ID]
    : [];
  return [...analyticsIds, ...advertisingIds]
    .map((value) => String(value || "").trim())
    .filter((value, index, values) => value && values.indexOf(value) === index);
}

function getMetaPixelId() {
  // This is the verified VS Store dataset in Meta Events Manager. Keep the
  // environment variable as an override, but do not let a missing public
  // identifier silently disable browser-side funnel measurement.
  return String(import.meta.env?.VITE_META_PIXEL_ID || "921792280984136").trim();
}

function getGoogleAdsConversionDestination() {
  const id = String(import.meta.env?.VITE_GOOGLE_ADS_CONVERSION_ID || "").trim();
  const label = String(import.meta.env?.VITE_GOOGLE_ADS_CONVERSION_LABEL || "").trim();
  return id && label ? `${id}/${label}` : "";
}

function captureAttribution() {
  if (
    typeof window === "undefined" ||
    hasShopifyCustomerPrivacySurface() ||
    !canProcessMarketingPurpose(getMarketingConsentSnapshot(), "advertising")
  ) {
    return;
  }

  const current: Record<string, string> = {};
  try {
    const params = new URL(window.location.href).searchParams;
    for (const key of ATTRIBUTION_KEYS) {
      const value = params.get(key)?.trim();
      if (value) current[key] = value.slice(0, 200);
    }

    if (Object.keys(current).length > 0) {
      window.sessionStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(current));
    }
  } catch {
    // Private browsing and strict storage settings should never block the store.
  }
}

function getAttribution() {
  if (
    typeof window === "undefined" ||
    hasShopifyCustomerPrivacySurface() ||
    !canProcessMarketingPurpose(getMarketingConsentSnapshot(), "advertising")
  ) {
    return {};
  }
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY) || "{}");
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      ATTRIBUTION_KEYS.flatMap((key) => {
        const value = (parsed as Record<string, unknown>)[key];
        return typeof value === "string" && value ? [[key, value]] : [];
      }),
    );
  } catch {
    return {};
  }
}

function clearAttribution() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(ATTRIBUTION_STORAGE_KEY);
  } catch {
    // Clearing optional campaign state must never interrupt shopping.
  }
}

function suppressImmediateDuplicate(key: string, windowMs = 1_000) {
  const now = Date.now();
  const previous = recentEventKeys.get(key);
  recentEventKeys.set(key, now);
  for (const [entryKey, timestamp] of recentEventKeys) {
    if (now - timestamp > windowMs) recentEventKeys.delete(entryKey);
  }
  return previous !== undefined && now - previous < windowMs;
}

function hasGrantedMarketingPurpose() {
  const consent = getMarketingConsentSnapshot();
  return (
    canProcessMarketingPurpose(consent, "analytics") ||
    canProcessMarketingPurpose(consent, "advertising")
  );
}

/**
 * Preserve the first-party campaign context on the Shopify cart so that the
 * paid order can be reconciled to the same source after hosted checkout. The
 * values come only from bounded UTM/click-id query parameters and never include
 * customer PII.
 */
export function getMarketingAttributionAttributes() {
  try {
    const consent = getMarketingConsentSnapshot();
    if (hasShopifyCustomerPrivacySurface()) return [];
    const attributes = Object.entries(
      canProcessMarketingPurpose(consent, "advertising") ? getAttribution() : {},
    ).map(([key, value]) => ({
      key: `marketing_${key}`,
      value,
    }));
    const googleClientId = canProcessMarketingPurpose(consent, "analytics")
      ? getGoogleClientId()
      : "";
    if (googleClientId) attributes.push({ key: GOOGLE_CLIENT_ID_ATTRIBUTE, value: googleClientId });
    return attributes;
  } catch {
    // Attribution is optional; browser privacy settings must not block cart creation.
    return [];
  }
}

function initializeMetaPixel() {
  if (
    typeof document === "undefined" ||
    hasShopifyCustomerPrivacySurface() ||
    !canProcessMarketingPurpose(getMarketingConsentSnapshot(), "advertising")
  ) {
    return;
  }
  const pixelId = getMetaPixelId();
  if (!pixelId) return;

  if (!window.fbq) {
    const queue = ((...args: unknown[]) => {
      (queue.queue ??= []).push(args);
    }) as MetaPixelQueue;
    queue.queue = [];
    queue.loaded = true;
    queue.version = "2.0";
    window.fbq = queue;
    window._fbq = queue;
  }

  if (!metaPixelInitialized) {
    window.fbq("init", pixelId);
    metaPixelInitialized = true;
  }

  const scriptId = "vs-meta-pixel";
  if (!document.getElementById(scriptId)) {
    const script = document.createElement("script");
    script.id = scriptId;
    script.async = true;
    script.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(script);
  }
}

function itemIds(params: MarketingParams) {
  const items = Array.isArray(params["items"]) ? params["items"] : [];
  return items
    .map((item) =>
      item && typeof item === "object"
        ? normalizeMetaCatalogId((item as MarketingParams)["item_id"])
        : "",
    )
    .filter(Boolean);
}

function metaContents(params: MarketingParams) {
  const items = Array.isArray(params["items"]) ? params["items"] : [];
  return items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const source = item as MarketingParams;
    const id = normalizeMetaCatalogId(source["item_id"]);
    if (!id) return [];
    return [
      {
        id,
        quantity: Number(source["quantity"] || 1),
        ...(source["price"] !== undefined ? { item_price: Number(source["price"]) } : {}),
      },
    ];
  });
}

function pushMetaEvent(name: string, params: MarketingParams) {
  if (typeof window === "undefined" || typeof window.fbq !== "function") return;

  const ids = itemIds(params);
  const contents = metaContents(params);
  const commerce = {
    ...(ids.length ? { content_ids: ids } : {}),
    ...(contents.length ? { contents } : {}),
    ...(params["value"] !== undefined ? { value: Number(params["value"]) } : {}),
    ...(params["currency"] ? { currency: String(params["currency"]) } : {}),
    ...(ids.length || contents.length ? { content_type: "product" } : {}),
  };

  switch (name) {
    case "page_view":
      window.fbq("track", "PageView");
      break;
    case "view_item":
      window.fbq("track", "ViewContent", commerce);
      break;
    case "view_item_list":
      window.fbq("trackCustom", "ViewItemList", {
        item_list_id: String(params["item_list_id"] || ""),
        item_list_name: String(params["item_list_name"] || ""),
        item_count: Number(params["item_count"] || 0),
      });
      break;
    case "search":
      window.fbq("track", "Search", { search_string: String(params["search_term"] || "") });
      break;
    case "add_to_cart":
      window.fbq("track", "AddToCart", commerce);
      break;
    case "begin_checkout":
      window.fbq("track", "InitiateCheckout", commerce);
      break;
    case "sign_up":
      window.fbq("track", "CompleteRegistration", { method: String(params["method"] || "") });
      break;
    case "email_signup":
      window.fbq("track", "Lead", { method: String(params["method"] || "email") });
      break;
    case "purchase":
      window.fbq("track", "Purchase", commerce);
      break;
    default:
      break;
  }
}

function pushGoogleAnalyticsEvent(name: string, params: MarketingParams) {
  if (
    typeof window === "undefined" ||
    !canProcessMarketingPurpose(getMarketingConsentSnapshot(), "analytics")
  ) {
    return;
  }
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event: name, ...params });
  if (typeof window.gtag !== "function") return;

  window.gtag("event", name, params);
}

function pushGoogleAdsConversion(name: string, params: MarketingParams) {
  if (
    name !== "purchase" ||
    typeof window === "undefined" ||
    typeof window.gtag !== "function" ||
    !canProcessMarketingPurpose(getMarketingConsentSnapshot(), "advertising")
  ) {
    return;
  }
  const conversionDestination = getGoogleAdsConversionDestination();
  if (!conversionDestination) return;
  window.gtag("event", "conversion", {
    send_to: conversionDestination,
    value: Number(params["value"] || 0),
    currency: String(params["currency"] || "USD"),
    transaction_id: String(params["transaction_id"] || ""),
  });
}

function initializeGoogleTags(consent: MarketingConsentSnapshot) {
  if (typeof document === "undefined") return;
  const tagIds = getGoogleTagIds(consent);
  if (!tagIds.length && !googleInitialized) return;

  if (tagIds.length) {
    window.dataLayer = window.dataLayer || [];
    const gtag =
      window.gtag ??
      ((...args: unknown[]) => {
        window.dataLayer?.push({ event: "gtag", args });
      });
    window.gtag = gtag;
  }
  const gtag = window.gtag;
  if (typeof gtag !== "function") return;

  const scriptId = "vs-google-gtag";
  if (tagIds.length && !document.getElementById(scriptId)) {
    const firstTagId = tagIds[0];
    if (!firstTagId) return;
    const script = document.createElement("script");
    script.id = scriptId;
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(firstTagId)}`;
    document.head.appendChild(script);
  }

  const purposeConsent = {
    analytics_storage: canProcessMarketingPurpose(consent, "analytics") ? "granted" : "denied",
    ad_storage: canProcessMarketingPurpose(consent, "advertising") ? "granted" : "denied",
    ad_user_data: canProcessMarketingPurpose(consent, "advertising") ? "granted" : "denied",
    ad_personalization: canProcessMarketingPurpose(consent, "advertising") ? "granted" : "denied",
  };
  if (!googleInitialized) {
    gtag("js", new Date());
    gtag("consent", "default", purposeConsent);
    googleInitialized = true;
  } else {
    gtag("consent", "update", purposeConsent);
  }

  for (const tagId of tagIds) {
    if (configuredGoogleTagIds.has(tagId)) continue;
    gtag("config", tagId, { send_page_view: false });
    configuredGoogleTagIds.add(tagId);
  }
}

function initializePermittedDestinations(consent: MarketingConsentSnapshot) {
  if (!consent.ready) return;

  if (canProcessMarketingPurpose(consent, "advertising") && !hasShopifyCustomerPrivacySurface()) {
    captureAttribution();
  } else {
    clearAttribution();
  }

  initializeGoogleTags(consent);

  if (canProcessMarketingPurpose(consent, "advertising")) {
    initializeMetaPixel();
    if (!hasShopifyCustomerPrivacySurface()) initializeTikTokPixel();
  }
}

function refreshMarketingConsent() {
  const consent = getMarketingConsentSnapshot();
  initializePermittedDestinations(consent);
  for (const listener of consentSubscribers) listener(consent);
  return consent;
}

function handleShopifyFeatureLoad(error?: unknown) {
  if (!error) refreshMarketingConsent();
}

export function initializeMarketingAnalytics() {
  if (typeof document === "undefined") return;
  if (!initialized) {
    initialized = true;
    document.addEventListener("visitorConsentCollected", refreshMarketingConsent);
    window.addEventListener("storage", (event) => {
      if (event.key === MARKETING_CONSENT_STORAGE_KEY || event.key === null) {
        standaloneConsentCache = undefined;
        refreshMarketingConsent();
      }
    });

    const shopify = getShopifyRuntime();
    if (
      hasShopifyCustomerPrivacySurface() &&
      !shopify?.customerPrivacy &&
      typeof shopify?.loadFeatures === "function"
    ) {
      try {
        shopify.loadFeatures(
          [{ name: "consent-tracking-api", version: "0.1" }],
          handleShopifyFeatureLoad,
        );
      } catch {
        // Shopify-hosted surfaces remain denied until Shopify exposes its API.
      }
    }
  }
  refreshMarketingConsent();
}

export async function saveMarketingConsent(preferences: MarketingConsentPreferences) {
  const normalized = normalizeMarketingPreferences(preferences);
  if (typeof window === "undefined") return { saved: false, persisted: false };

  if (hasShopifyCustomerPrivacySurface()) {
    const privacy = getShopifyRuntime()?.customerPrivacy;
    const setTrackingConsent = privacy?.setTrackingConsent;
    if (typeof setTrackingConsent !== "function") {
      return { saved: false, persisted: false };
    }
    return new Promise<{ saved: boolean; persisted: boolean }>((resolve) => {
      let settled = false;
      const finish = (saved: boolean) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        refreshMarketingConsent();
        resolve({ saved, persisted: saved });
      };
      const timeout = window.setTimeout(() => finish(false), 5000);
      try {
        setTrackingConsent.call(
          privacy,
          { analytics: normalized.analytics, marketing: normalized.advertising },
          () => finish(true),
        );
      } catch {
        finish(false);
      }
    });
  }

  const saved: MarketingConsentSnapshot = {
    ...normalized,
    explicit: true,
    source: "standalone",
    ready: true,
  };
  standaloneConsentCache = saved;
  let persisted = false;
  try {
    persisted = persistStandaloneMarketingConsent(window.localStorage, saved);
  } catch {
    // Keep the explicit choice for this page session; a reload fails closed.
  }
  refreshMarketingConsent();
  return { saved: true, persisted };
}

export async function reopenMarketingPreferences() {
  if (typeof window === "undefined" || !hasShopifyCustomerPrivacySurface()) return false;
  const shopify = getShopifyRuntime();
  const privacyBanner =
    shopify?.privacyBanner ??
    (window as Window & { privacyBanner?: ShopifyRuntime["privacyBanner"] }).privacyBanner;
  if (typeof privacyBanner?.showPreferences !== "function") return false;
  try {
    await privacyBanner.showPreferences();
    return true;
  } catch {
    return false;
  }
}

export function trackMarketingEvent(name: string, params: MarketingParams = {}) {
  if (typeof window === "undefined") return;
  const consent = getMarketingConsentSnapshot();
  const analyticsAllowed = canProcessMarketingPurpose(consent, "analytics");
  const advertisingAllowed = canProcessMarketingPurpose(consent, "advertising");
  if (!analyticsAllowed && !advertisingAllowed) return;
  const attributedParams = {
    ...(advertisingAllowed ? getAttribution() : {}),
    ...params,
  };

  if (analyticsAllowed) {
    try {
      pushGoogleAnalyticsEvent(name, attributedParams);
    } catch {
      // Measurement is best-effort and must never interrupt a shopping action.
    }
  }

  if (advertisingAllowed) {
    try {
      pushGoogleAdsConversion(name, attributedParams);
    } catch {
      // Advertising measurement must never interrupt a shopping action.
    }
    try {
      pushMetaEvent(name, attributedParams);
    } catch {
      // Keep other event destinations working if one pixel is unavailable.
    }
  }

  if (analyticsAllowed) {
    try {
      if (typeof CustomEvent === "function") {
        window.dispatchEvent(
          new CustomEvent("vs-store:marketing-event", {
            detail: { name, ...attributedParams },
          }),
        );
      }
    } catch {
      // First-party event listeners are also non-blocking for commerce.
    }
  }
}

export function trackPageView(path: string) {
  const consent = getMarketingConsentSnapshot();
  if (
    !canProcessMarketingPurpose(consent, "analytics") &&
    !canProcessMarketingPurpose(consent, "advertising")
  ) {
    return;
  }
  const consentKey = `${path}:${consent.analytics ? 1 : 0}:${consent.advertising ? 1 : 0}`;
  if (consentKey === lastPageViewKey) return;
  lastPageViewKey = consentKey;
  trackMarketingEvent("page_view", {
    page_location:
      typeof window === "undefined" ? path : new URL(path, window.location.origin).href,
    page_path: path,
  });
}

export function trackViewItem(item: MarketingItem, listName?: string) {
  trackMarketingEvent("view_item", {
    currency: "USD",
    value: Number(item.price || 0),
    items: [{ ...item, quantity: item.quantity || 1 }],
    ...(listName ? { item_list_name: listName } : {}),
  });
}

export function trackCollectionView(collection: { id?: string; name: string; itemCount?: number }) {
  if (!hasGrantedMarketingPurpose()) return;
  const key = [
    "view_item_list",
    typeof window === "undefined" ? "server" : window.location.pathname,
    collection.id || collection.name,
    collection.itemCount ?? "",
  ].join(":");
  if (suppressImmediateDuplicate(key)) return;
  trackMarketingEvent("view_item_list", {
    item_list_id: collection.id || collection.name,
    item_list_name: collection.name,
    item_count: collection.itemCount ?? undefined,
  });
}

export function trackSearch(query: string, resultCount: number) {
  if (!hasGrantedMarketingPurpose()) return;
  const key = [
    "search",
    typeof window === "undefined" ? "server" : window.location.pathname,
    query,
    resultCount,
  ].join(":");
  if (suppressImmediateDuplicate(key)) return;
  trackMarketingEvent("search", {
    search_term: query,
    result_count: resultCount,
  });
}

export function trackAddToCart({
  item,
  quantity,
  currency,
}: {
  item: MarketingItem;
  quantity: number;
  currency: string;
}) {
  trackMarketingEvent("add_to_cart", {
    currency,
    value: Number(item.price || 0) * quantity,
    items: [{ ...item, quantity }],
  });
}

export function trackBeginCheckout({
  items,
  value,
  currency,
}: {
  items: MarketingItem[];
  value: number;
  currency: string;
}) {
  trackMarketingEvent("begin_checkout", { currency, value, items });
}

export function trackEmailSignup(source = "account") {
  trackMarketingEvent("email_signup", { method: "email", signup_source: source });
}

/**
 * Purchase is intentionally not called by the storefront checkout button:
 * Shopify owns the hosted checkout and the paid-order webhook is the source
 * of truth. This helper is available for a future same-origin receipt page
 * without changing the event contract.
 */
export function trackPurchase({
  transactionId,
  items,
  value,
  currency,
}: {
  transactionId: string;
  items: MarketingItem[];
  value: number;
  currency: string;
}) {
  trackMarketingEvent("purchase", {
    transaction_id: transactionId,
    currency,
    value,
    items,
  });
}
