const ASSET_PATH_PREFIX = "/assets/";

/**
 * Vite emits root-relative URLs for imported files. Those URLs work on the
 * Vite/Vercel origin, but Shopify theme files are served from Shopify's CDN
 * asset directory. Resolve only those local Vite assets against the Liquid
 * asset_url base exposed by the theme, or the URL of this loaded Shopify theme
 * module when Liquid initialization is unavailable; leave local development
 * and other remote URLs unchanged.
 */
export function resolveShopifyThemeAssetUrl(path, assetBase, moduleUrl) {
  if (typeof path !== "string" || !path.startsWith(ASSET_PATH_PREFIX)) {
    return path;
  }

  let resolvedBase = typeof assetBase === "string" ? assetBase.trim() : "";
  if (!resolvedBase && typeof moduleUrl === "string") {
    try {
      const parsedModuleUrl = new URL(moduleUrl);
      const isShopifyThemeAsset =
        (parsedModuleUrl.hostname.endsWith(".myshopify.com") &&
          /\/cdn\/shop\/t\/[^/]+\/assets\/[^/]+$/.test(parsedModuleUrl.pathname)) ||
        (parsedModuleUrl.hostname === "cdn.shopify.com" &&
          /\/t\/[^/]+\/assets\/[^/]+$/.test(parsedModuleUrl.pathname));

      if (isShopifyThemeAsset) {
        resolvedBase = new URL(".", parsedModuleUrl).href;
      }
    } catch {
      // Keep local or malformed module URLs untouched.
    }
  }

  if (!resolvedBase) {
    return path;
  }

  const protocol = globalThis.location?.protocol || "https:";
  const absoluteBase = resolvedBase.startsWith("//") ? `${protocol}${resolvedBase}` : resolvedBase;
  const directoryBase = absoluteBase.endsWith("/") ? absoluteBase : `${absoluteBase}/`;

  try {
    return new URL(path.slice(ASSET_PATH_PREFIX.length), directoryBase).href;
  } catch {
    return path;
  }
}
