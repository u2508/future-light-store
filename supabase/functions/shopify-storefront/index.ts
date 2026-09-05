import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SHOP_DOMAIN = Deno.env.get("SHOPIFY_STOREFRONT_STORE_DOMAIN") ?? "";
const API_VERSION = Deno.env.get("SHOPIFY_STOREFRONT_API_VERSION") ?? "2025-07";
const ACCESS_TOKEN = Deno.env.get("SHOPIFY_STOREFRONT_ACCESS_TOKEN") ?? "";
const SHOPIFY_URL = SHOP_DOMAIN ? `https://${SHOP_DOMAIN}/api/${API_VERSION}/graphql.json` : "";

const ALLOWED_OPERATIONS = new Set([
  "GetProducts",
  "GetProduct",
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

const CATALOG_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST is required" }, 405);

  try {
    if (!SHOP_DOMAIN || !ACCESS_TOKEN) {
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
