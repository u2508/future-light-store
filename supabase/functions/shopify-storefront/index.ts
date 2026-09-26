import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SHOP_DOMAIN = Deno.env.get("SHOPIFY_STOREFRONT_STORE_DOMAIN") ?? "";
const API_VERSION = Deno.env.get("SHOPIFY_STOREFRONT_API_VERSION") ?? "2025-07";
const ACCESS_TOKEN = Deno.env.get("SHOPIFY_STOREFRONT_ACCESS_TOKEN") ?? "";
const SHOPIFY_URL = SHOP_DOMAIN ? `https://${SHOP_DOMAIN}/api/${API_VERSION}/graphql.json` : "";

const ALLOWED_OPERATIONS = new Set([
  "GetProducts",
  "GetProduct",
  "GetProductVariantPage",
  "GetProductVariantMedia",
  "GetProductInventory",
  "GetCollections",
  "GetCollection",
  "cart",
  "cartCreate",
  "cartLinesAdd",
  "cartLinesUpdate",
  "cartLinesRemove",
]);

const CART_OPERATIONS = new Set([
  "cart",
  "cartCreate",
  "cartLinesAdd",
  "cartLinesUpdate",
  "cartLinesRemove",
]);

// Catalog reads must never replay a stale product or inventory response. The
// browser keeps the first live page responsive while React Query revalidates
// the active view, but the edge proxy itself must always contact Shopify.
const CATALOG_CACHE_CONTROL = "no-store";
const PUBLIC_MEDIA_CACHE_CONTROL = "public, max-age=300";

const json = (body: unknown, status = 200, cacheControl = CATALOG_CACHE_CONTROL) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Cache-Control": cacheControl,
      "Content-Type": "application/json",
    },
  });

function operationName(query: string) {
  return query.match(/\b(?:query|mutation)\s+([A-Za-z0-9_]+)/)?.[1] ?? null;
}

function numericId(value: unknown) {
  const id =
    String(value ?? "")
      .split("/")
      .pop() ?? "";
  return /^\d+$/.test(id) ? id : "";
}

function normalizedImageUrl(value: unknown) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value);
    if (
      url.protocol !== "https:" ||
      (url.hostname !== "cdn.shopify.com" && url.hostname !== SHOP_DOMAIN)
    ) {
      return "";
    }
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

async function fetchPublicProductMedia(handle: unknown) {
  if (
    typeof handle !== "string" ||
    handle.length > 255 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(handle)
  ) {
    return json({ error: "A valid product handle is required" }, 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6_000);
  try {
    const response = await fetch(
      `https://${SHOP_DOMAIN}/products/${encodeURIComponent(handle)}.js`,
      {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      },
    );
    if (!response.ok)
      return json(
        { error: "Published product media is unavailable" },
        response.status === 404 ? 404 : 502,
      );
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > 12_000_000)
      return json({ error: "Published product media response is too large" }, 502);
    const body = await response.text();
    if (body.length > 12_000_000)
      return json({ error: "Published product media response is too large" }, 502);
    const product = JSON.parse(body);
    if (product?.handle !== handle || !numericId(product?.id)) {
      return json({ error: "Published product identity did not match the request" }, 502);
    }

    const imagesByUrl = new Map<
      string,
      { id: string | null; url: string; altText: string | null; variantIds: string[] }
    >();
    for (const source of Array.isArray(product.images) ? product.images.slice(0, 250) : []) {
      const url = normalizedImageUrl(source);
      if (url && !imagesByUrl.has(url)) {
        imagesByUrl.set(url, { id: null, url, altText: null, variantIds: [] });
      }
    }
    for (const variant of Array.isArray(product.variants)
      ? product.variants.slice(0, 10_000)
      : []) {
      const featured = variant?.featured_image;
      const url = normalizedImageUrl(featured?.src);
      if (!url) continue;
      const image = imagesByUrl.get(url) ?? {
        id: numericId(featured?.id) || null,
        url,
        altText: typeof featured?.alt === "string" ? featured.alt.slice(0, 500) : null,
        variantIds: [],
      };
      const ids = Array.isArray(featured?.variant_ids) ? featured.variant_ids : [];
      image.variantIds = [
        ...new Set([...image.variantIds, ...ids.map(numericId).filter(Boolean)]),
      ].slice(0, 10_000);
      if (!image.id) image.id = numericId(featured?.id) || null;
      if (!image.altText && typeof featured?.alt === "string")
        image.altText = featured.alt.slice(0, 500);
      imagesByUrl.set(url, image);
    }

    return json(
      {
        data: {
          productVariantMedia: {
            productId: numericId(product.id),
            handle,
            images: [...imagesByUrl.values()].slice(0, 250),
          },
        },
      },
      200,
      PUBLIC_MEDIA_CACHE_CONTROL,
    );
  } catch (error) {
    console.error("Shopify public product media request failed", error);
    return json({ error: "Published product media is temporarily unavailable" }, 502);
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST is required" }, 405);

  try {
    if (!SHOP_DOMAIN) {
      console.error("Shopify Storefront proxy is missing Supabase secrets");
      return json({ error: "Catalog service is not configured" }, 503);
    }

    const body = await req.json().catch(() => ({}));
    const query = typeof body.query === "string" ? body.query : "";
    const variables = body.variables && typeof body.variables === "object" ? body.variables : {};
    const name = operationName(query);

    if (!query || query.length > 20_000 || !name || !ALLOWED_OPERATIONS.has(name)) {
      return json({ error: "Unsupported catalog operation" }, 400);
    }

    if (name === "GetProductVariantMedia") {
      return await fetchPublicProductMedia(variables.handle);
    }
    if (!ACCESS_TOKEN) {
      console.error("Shopify Storefront proxy is missing its Storefront access token");
      return json({ error: "Catalog service is not configured" }, 503);
    }

    const response = await fetch(SHOPIFY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": ACCESS_TOKEN,
      },
      body: JSON.stringify({ query, variables }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error(`Shopify Storefront API ${response.status}`);
      return json({ error: "Catalog service is temporarily unavailable" }, 502);
    }

    // Cart IDs and line quantities are session-specific. Never let an edge/CDN
    // cache replay an old cart response into a newly opened bag drawer.
    return json(payload, 200, CART_OPERATIONS.has(name) ? "no-store" : undefined);
  } catch (error) {
    console.error("shopify-storefront error", error);
    return json({ error: "Catalog service is temporarily unavailable" }, 500);
  }
});
