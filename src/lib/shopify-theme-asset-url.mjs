const ASSET_PATH_PREFIX = "/assets/";

/**
 * Vite emits root-relative URLs for imported files. Those URLs work on the
 * Vite/Vercel origin, but Shopify theme files are served from Shopify's CDN
 * asset directory. Resolve only those local Vite assets against the Liquid
 * asset_url base exposed by the theme; leave Shopify CDN and other remote URLs
 * unchanged.
 */
export function resolveShopifyThemeAssetUrl(path, assetBase) {
  if (typeof path !== "string" || !path.startsWith(ASSET_PATH_PREFIX)) {
    return path;
  }

  if (typeof assetBase !== "string" || !assetBase.trim()) {
    return path;
  }

  const protocol = globalThis.location?.protocol || "https:";
  const absoluteBase = assetBase.startsWith("//") ? `${protocol}${assetBase}` : assetBase;
  const directoryBase = absoluteBase.endsWith("/") ? absoluteBase : `${absoluteBase}/`;

  try {
    return new URL(path.slice(ASSET_PATH_PREFIX.length), directoryBase).href;
  } catch {
    return path;
  }
}
