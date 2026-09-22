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
let lastPageViewPath = "";
const recentEventKeys = new Map<string, number>();

const ATTRIBUTION_STORAGE_KEY = "vs-store-attribution";
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

function getGoogleTagIds() {
  return [import.meta.env?.VITE_GOOGLE_ANALYTICS_ID, import.meta.env?.VITE_GOOGLE_ADS_ID]
    .map((value) => String(value || "").trim())
    .filter((value, index, values) => value && values.indexOf(value) === index);
}

function getMetaPixelId() {
  // This is the verified VS Store dataset in Meta Events Manager. Keep the
  // environment variable as an override, but do not let a missing public
  // identifier silently disable browser-side funnel measurement.
  return String(import.meta.env?.VITE_META_PIXEL_ID || "921792280984136").trim();
}

function isShopifyHostedTheme() {
  if (typeof window === "undefined" || typeof document === "undefined") return false;

  // Shopify's theme runtime exposes this object before the React entry mounts.
  // The Shopify Meta app then owns the Pixel bootstrap and its consent flow.
  // Reusing that managed queue avoids a second fbevents.js load and duplicate
  // pixel initialization while keeping the standalone Vercel storefront's
  // first-party pixel path unchanged.
  const shopify = (window as Window & { Shopify?: { theme?: unknown } }).Shopify;
  return Boolean(
    shopify?.theme ||
    document.querySelector('script[src*="/web-pixels@"]') ||
    document.querySelector('script[src*="connect.facebook.net/"]'),
  );
}

function getGoogleAdsConversionDestination() {
  const id = String(import.meta.env?.VITE_GOOGLE_ADS_CONVERSION_ID || "").trim();
  const label = String(import.meta.env?.VITE_GOOGLE_ADS_CONVERSION_LABEL || "").trim();
  return id && label ? `${id}/${label}` : "";
}

function captureAttribution() {
  if (typeof window === "undefined") return;

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
  if (typeof window === "undefined") return {};
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

function suppressImmediateDuplicate(key: string, windowMs = 1_000) {
  const now = Date.now();
  const previous = recentEventKeys.get(key);
  recentEventKeys.set(key, now);
  for (const [entryKey, timestamp] of recentEventKeys) {
    if (now - timestamp > windowMs) recentEventKeys.delete(entryKey);
  }
  return previous !== undefined && now - previous < windowMs;
}

/**
 * Preserve the first-party campaign context on the Shopify cart so that the
 * paid order can be reconciled to the same source after hosted checkout. The
 * values come only from bounded UTM/click-id query parameters and never include
 * customer PII.
 */
export function getMarketingAttributionAttributes() {
  const attributes = Object.entries(getAttribution()).map(([key, value]) => ({
    key: `marketing_${key}`,
    value,
  }));
  const googleClientId = getGoogleClientId();
  if (googleClientId) attributes.push({ key: "marketing_ga_client_id", value: googleClientId });
  return attributes;
}

function initializeMetaPixel() {
  if (typeof document === "undefined") return;
  const pixelId = getMetaPixelId();
  if (!pixelId) return;

  if (isShopifyHostedTheme()) {
    metaPixelInitialized = true;
    return;
  }

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

function pushGoogleEvent(name: string, params: MarketingParams) {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event: name, ...params });
  if (typeof window.gtag !== "function") return;

  window.gtag("event", name, params);
  const conversionDestination = name === "purchase" ? getGoogleAdsConversionDestination() : "";
  if (conversionDestination) {
    window.gtag("event", "conversion", {
      send_to: conversionDestination,
      value: Number(params["value"] || 0),
      currency: String(params["currency"] || "USD"),
      transaction_id: String(params["transaction_id"] || ""),
    });
  }
}

export function initializeMarketingAnalytics() {
  if (typeof document === "undefined" || initialized) return;
  initialized = true;
  captureAttribution();
  initializeMetaPixel();

  const tagIds = getGoogleTagIds();
  if (!tagIds.length) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag =
    window.gtag ||
    function gtag(...args: unknown[]) {
      window.dataLayer?.push({
        event: "gtag",
        args,
      });
    };
  const scriptId = "vs-google-gtag";
  if (!document.getElementById(scriptId)) {
    const firstTagId = tagIds[0];
    if (!firstTagId) return;
    const script = document.createElement("script");
    script.id = scriptId;
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(firstTagId)}`;
    document.head.appendChild(script);
  }
  window.gtag("js", new Date());
  for (const tagId of tagIds) window.gtag("config", tagId, { send_page_view: false });
}

export function trackMarketingEvent(name: string, params: MarketingParams = {}) {
  if (typeof window === "undefined") return;
  const attributedParams = { ...getAttribution(), ...params };
  pushGoogleEvent(name, attributedParams);
  pushMetaEvent(name, attributedParams);
  window.dispatchEvent(
    new CustomEvent("vs-store:marketing-event", {
      detail: { name, ...attributedParams },
    }),
  );
}

export function trackPageView(path: string) {
  if (path === lastPageViewPath) return;
  lastPageViewPath = path;
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
