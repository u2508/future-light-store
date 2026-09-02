// Runs before `vite dev` and `vite build` (predev/prebuild hooks); writes public/sitemap.xml.

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

function loadEnvFile(path: string) {
  try {
    const text = readFileSync(path, "utf-8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // .env may not exist in all environments (e.g. CI with injected env vars)
  }
}

loadEnvFile(resolve(".env.local"));
loadEnvFile(resolve(".env"));
loadEnvFile(resolve(".env.example"));

const BASE_URL = (process.env.VITE_SITE_URL ?? "https://vss-store.vercel.app").replace(/\/$/, "");

const SUPABASE_URL = (
  process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "https://miiybtxnnxlimmiyfauy.supabase.co"
).replace(/\/$/, "");
const SUPABASE_PUBLISHABLE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
const STOREFRONT_PROXY_URL = `${SUPABASE_URL}/functions/v1/shopify-storefront`;

interface SitemapEntry {
  path: string;
  lastmod?: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
}

const STATIC_ROUTES: SitemapEntry[] = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/shop", changefreq: "weekly", priority: "0.9" },
  { path: "/collections", changefreq: "weekly", priority: "0.8" },
  { path: "/offers", changefreq: "weekly", priority: "0.8" },
  { path: "/about", changefreq: "monthly", priority: "0.5" },
  { path: "/policies", changefreq: "monthly", priority: "0.4" },
  { path: "/track-order", changefreq: "monthly", priority: "0.6" },
  { path: "/help", changefreq: "monthly", priority: "0.6" },
];

const POLICY_SLUGS = ["shipping", "returns", "privacy", "terms"];

async function storefrontRequest<T = unknown>(query: string, variables: Record<string, unknown> = {}): Promise<T | null> {
  const response = await fetch(STOREFRONT_PROXY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(SUPABASE_PUBLISHABLE_KEY ? { apikey: SUPABASE_PUBLISHABLE_KEY } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = (await response.json()) as { error?: string; errors?: Array<{ message: string }>; data?: T };
  if (!response.ok) throw new Error(json.error ?? `Catalog proxy error: ${response.status}`);
  if (json.errors?.length) {
    throw new Error(`Catalog GraphQL error: ${json.errors.map((e) => e.message).join(", ")}`);
  }
  return json.data ?? null;
}

async function fetchAllCollections(): Promise<Array<{ handle: string; updatedAt?: string }>> {
  const query = `
    query GetCollections($first: Int!, $after: String) {
      collections(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        edges { node { handle updatedAt } }
      }
    }
  `;

  const handles: Array<{ handle: string; updatedAt?: string }> = [];
  let after: string | null = null;
  const pageSize = 250;

  do {
    const data = await storefrontRequest<{
      collections: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        edges: Array<{ node: { handle: string; updatedAt?: string } }>;
      };
    }>(query, { first: pageSize, after });

    if (!data) break;

    for (const edge of data.collections.edges) {
      handles.push({ handle: edge.node.handle, updatedAt: edge.node.updatedAt });
    }

    after = data.collections.pageInfo.hasNextPage ? data.collections.pageInfo.endCursor : null;
  } while (after);

  return handles;
}

async function fetchAllProducts(): Promise<Array<{ handle: string; updatedAt?: string }>> {
  const query = `
    query GetProducts($first: Int!, $after: String) {
      products(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        edges { node { handle updatedAt } }
      }
    }
  `;

  const handles: Array<{ handle: string; updatedAt?: string }> = [];
  let after: string | null = null;
  const pageSize = 250;

  do {
    const data = await storefrontRequest<{
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        edges: Array<{ node: { handle: string; updatedAt?: string } }>;
      };
    }>(query, { first: pageSize, after });

    if (!data) break;

    for (const edge of data.products.edges) {
      handles.push({ handle: edge.node.handle, updatedAt: edge.node.updatedAt });
    }

    after = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (after);

  return handles;
}

function loadLocalCatalogEntries(): {
  collections: Array<{ handle: string; updatedAt?: string }>;
  products: Array<{ handle: string; updatedAt?: string }>;
} {
  try {
    const dataDir = resolve("public", "data");
    const productsManifest = JSON.parse(readFileSync(resolve(dataDir, "products.json"), "utf-8")) as {
      shards?: Array<{ file?: string }>;
    };
    const products = (productsManifest.shards ?? []).flatMap((shard) => {
      const file = String(shard.file ?? "").replace(/^.*\//, "");
      if (!/^products-\d{4}\.json$/.test(file)) return [];
      const payload = JSON.parse(readFileSync(resolve(dataDir, file), "utf-8")) as {
        products?: Array<{ handle?: string; updated_at?: string; updatedAt?: string; status?: string }>;
      };
      return (payload.products ?? [])
        .filter((product) => product.handle && String(product.status ?? "").toLowerCase() !== "draft")
        .map((product) => ({ handle: String(product.handle), updatedAt: product.updatedAt ?? product.updated_at }));
    });
    const collectionsPayload = JSON.parse(readFileSync(resolve(dataDir, "collections.json"), "utf-8")) as {
      collections?: Array<{ handle?: string; updatedAt?: string; updated_at?: string }>;
    };
    const collections = (collectionsPayload.collections ?? [])
      .filter((collection) => collection.handle)
      .map((collection) => ({ handle: String(collection.handle), updatedAt: collection.updatedAt ?? collection.updated_at }));
    return { collections, products };
  } catch (error) {
    console.warn("Could not load local catalog sitemap fallback:", error instanceof Error ? error.message : error);
    return { collections: [], products: [] };
  }
}

function generateSitemap(entries: SitemapEntry[]) {
  const urls = entries.map((e) =>
    [
      `  <url>`,
      `    <loc>${BASE_URL}${e.path}</loc>`,
      e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>` : null,
      e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
      e.priority ? `    <priority>${e.priority}</priority>` : null,
      `  </url>`,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...urls,
    `</urlset>`,
  ].join("\n");
}

async function main() {
  const entries: SitemapEntry[] = [...STATIC_ROUTES];

  for (const slug of POLICY_SLUGS) {
    entries.push({ path: `/policies/${slug}`, changefreq: "monthly", priority: "0.4" });
  }

  try {
    const [collections, products] = await Promise.all([fetchAllCollections(), fetchAllProducts()]);
    if (!collections.length || !products.length) {
      throw new Error(`Shopify returned an incomplete sitemap catalog (${collections.length} collections, ${products.length} products)`);
    }

    for (const collection of collections) {
      entries.push({
        path: `/collections/${collection.handle}`,
        changefreq: "weekly",
        priority: "0.7",
        lastmod: collection.updatedAt ? collection.updatedAt.split("T")[0] : undefined,
      });
    }

    for (const product of products) {
      entries.push({
        path: `/products/${product.handle}`,
        changefreq: "weekly",
        priority: "0.8",
        lastmod: product.updatedAt ? product.updatedAt.split("T")[0] : undefined,
      });
    }

    console.log(`Fetched ${collections.length} collections and ${products.length} products from Shopify.`);
  } catch (error) {
    const fallback = loadLocalCatalogEntries();
    for (const collection of fallback.collections) {
      entries.push({
        path: `/collections/${collection.handle}`,
        changefreq: "weekly",
        priority: "0.7",
        lastmod: collection.updatedAt ? collection.updatedAt.split("T")[0] : undefined,
      });
    }
    for (const product of fallback.products) {
      entries.push({
        path: `/products/${product.handle}`,
        changefreq: "weekly",
        priority: "0.8",
        lastmod: product.updatedAt ? product.updatedAt.split("T")[0] : undefined,
      });
    }
    console.warn(
      `Could not fetch dynamic Shopify entries for sitemap; used local fallback (${fallback.collections.length} collections, ${fallback.products.length} products):`,
      error instanceof Error ? error.message : error,
    );
  }

  writeFileSync(resolve("public/sitemap.xml"), generateSitemap(entries));
  console.log(`sitemap.xml written (${entries.length} entries)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
