const EXPECTED_FUTURE_LIGHT_SHOP_DOMAIN = "vs-future-store-0jl2t-jxu6tnr3.myshopify.com";

function parseShopDomain(value, label) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new Error(`${label} must be a valid Future Light Shopify domain or URL`);
  }

  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${label} must contain only a Shopify domain, without credentials or a path`);
  }

  return url.hostname.toLowerCase();
}

export function resolveFutureLightShopifyTarget(env = process.env) {
  const configuredDomain = parseShopDomain(env.FUTURE_LIGHT_SHOP_DOMAIN, "FUTURE_LIGHT_SHOP_DOMAIN");
  const configuredUrl = parseShopDomain(env.FUTURE_LIGHT_SHOP_URL, "FUTURE_LIGHT_SHOP_URL");

  if (!configuredDomain && !configuredUrl) {
    throw new Error("Set FUTURE_LIGHT_SHOP_DOMAIN or FUTURE_LIGHT_SHOP_URL before Shopify access");
  }
  if (configuredDomain && configuredUrl && configuredDomain !== configuredUrl) {
    throw new Error("Future Light Shopify domain and URL settings do not match");
  }

  const shopDomain = configuredDomain || configuredUrl;
  if (shopDomain !== EXPECTED_FUTURE_LIGHT_SHOP_DOMAIN) {
    throw new Error("Shopify access is restricted to the exact Future Light store");
  }

  return { shopDomain };
}
