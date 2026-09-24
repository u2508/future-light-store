const DEFAULT_SITE_URL = "https://future-light-store.vercel.app";

function resolveSiteUrl() {
  if (typeof window !== "undefined") {
    const runtimeWindow = window as Window & { Shopify?: { theme?: unknown } };
    const hostname = window.location.hostname.toLowerCase();
    const isShopifyTheme = hostname.endsWith(".myshopify.com") || Boolean(runtimeWindow.Shopify?.theme);
    if (isShopifyTheme) return window.location.origin;
  }

  return import.meta.env?.VITE_SITE_URL || DEFAULT_SITE_URL;
}

export const SITE_URL = resolveSiteUrl()
  .trim()
  .replace(/\/+$/, "");
export const GOOGLE_SITE_VERIFICATION =
  import.meta.env?.VITE_GOOGLE_SITE_VERIFICATION || "T5OO6im9_fwXtSjarVqkZvx-JHYudcUe_B6jhJH-BeY";

export function canonicalUrl(path = "/") {
  const candidate = String(path || "/").trim() || "/";
  const parsed = new URL(candidate, `${SITE_URL}/`);
  const pathname = parsed.pathname.replace(/\/{2,}/g, "/");
  const normalizedPath = pathname === "/" ? "/" : pathname.replace(/\/+$/, "");

  return `${SITE_URL}${normalizedPath}`;
}
