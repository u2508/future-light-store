import { supabase } from "@/integrations/supabase/client";

interface ThemeAssetMap {
  [path: string]: string | undefined;
}

declare global {
  interface Window {
    SALT_THEME_ASSETS?: ThemeAssetMap;
  }
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;

// Shopify credentials are kept in the Supabase Edge Function. The browser only
// needs the Supabase project URL and its publishable client key.
export const isShopifyConfigured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

export interface ShopifyVariant {
  id: string;
  title: string;
  price: { amount: string; currencyCode: string };
  compareAtPrice: { amount: string; currencyCode: string } | null;
  availableForSale: boolean;
  // Storefront API only exposes inventory quantities when the token has
  // unauthenticated_read_product_inventory. Availability remains usable
  // without that optional scope.
  quantityAvailable?: number | null;
  selectedOptions: Array<{ name: string; value: string }>;
}

export interface ShopifyProductNode {
  id: string;
  title: string;
  description: string;
  descriptionHtml?: string;
  handle: string;
  vendor: string;
  productType: string;
  tags: string[];
  updatedAt?: string;
  availableForSale: boolean;
  priceRange: { minVariantPrice: { amount: string; currencyCode: string } };
  compareAtPriceRange?: { minVariantPrice: { amount: string; currencyCode: string } };
  variantsCount?: { count: number };
  images: { edges: Array<{ node: { url: string; altText: string | null } }> };
  variants: { edges: Array<{ node: ShopifyVariant }> };
  options: Array<{ name: string; values: string[] }>;
}

export interface ShopifyProduct {
  node: ShopifyProductNode;
}

interface SearchShardManifest {
  total?: number;
  shards?: Array<{ path?: string }>;
}

interface SearchProductRecord {
  id?: number | string;
  title?: string;
  handle?: string;
  body_html?: string;
  vendor?: string;
  product_type?: string;
  tags?: string[] | string;
  updated_at?: string;
  variant_count?: number;
  variants?: Array<{
    id?: number | string;
    title?: string;
    price?: string | number;
    compare_at_price?: string | number | null;
    available?: boolean;
  }>;
  images?: Array<{ src?: string; alt?: string | null }>;
  image?: { src?: string; alt?: string | null } | null;
}

interface CatalogProductRecord extends SearchProductRecord {
  legacyResourceId?: number | string;
  descriptionHtml?: string;
  productType?: string;
  product_type?: string;
  images?: Array<{ src?: string; alt?: string | null }>;
  variants?: Array<{
    id?: number | string;
    legacyResourceId?: number | string;
    title?: string;
    price?: string | number;
    compare_at_price?: string | number | null;
    available?: boolean;
    inventory_quantity?: number | null;
  }>;
  options?: Array<{ name?: string; values?: string[] }>;
}

let renderedThemeAssetMap: ThemeAssetMap | undefined;

function getThemeAssetMap() {
  if (typeof window === "undefined") return undefined;
  if (window.SALT_THEME_ASSETS) return window.SALT_THEME_ASSETS;
  if (renderedThemeAssetMap) return renderedThemeAssetMap;
  if (typeof document === "undefined") return undefined;

  const assetScript = Array.from(document.scripts).find((script) =>
    script.textContent?.includes("window.SALT_THEME_ASSETS"),
  );
  const match = assetScript?.textContent?.match(
    /window\.SALT_THEME_ASSETS\s*=\s*(\{[\s\S]*?\})\s*;/,
  );
  if (!match?.[1]) return undefined;

  try {
    renderedThemeAssetMap = JSON.parse(match[1]) as ThemeAssetMap;
  } catch {
    return undefined;
  }
  return renderedThemeAssetMap;
}

function themeAssetUrl(path: string) {
  if (typeof window === "undefined") return path;
  return getThemeAssetMap()?.[path] ?? path;
}

async function fetchThemeJson<T>(path: string): Promise<T> {
  let url = themeAssetUrl(path);
  if (url === path && typeof window !== "undefined" && typeof document !== "undefined") {
    for (let attempt = 0; attempt < 40 && url === path; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      url = themeAssetUrl(path);
    }
  }
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Theme catalog request failed (${response.status})`);
  return (await response.json()) as T;
}

function shopifyGid(type: "Product" | "ProductVariant", id: number | string | undefined) {
  const value = String(id ?? "").match(/\d+$/)?.[0];
  return value ? `gid://shopify/${type}/${value}` : "";
}

function moneyValue(value: string | number | undefined, currencyCode = "USD") {
  return { amount: String(value ?? "0"), currencyCode };
}

function searchRecordToProduct(record: SearchProductRecord): ShopifyProduct | null {
  const productId = shopifyGid("Product", record.id);
  const handle = String(record.handle ?? "").trim();
  const title = String(record.title ?? "").trim();
  if (!productId || !handle || !title) return null;

  const rawVariants = Array.isArray(record.variants) ? record.variants : [];
  const variants = rawVariants
    .map((variant) => {
      const id = shopifyGid("ProductVariant", variant.id);
      if (!id) return null;
      const price = moneyValue(variant.price);
      const compareAtPrice =
        variant.compare_at_price == null ? null : moneyValue(variant.compare_at_price);
      return {
        id,
        title: String(variant.title ?? "Default Title"),
        price,
        compareAtPrice,
        availableForSale: Boolean(variant.available),
        selectedOptions: [],
      } satisfies ShopifyVariant;
    })
    .filter((variant): variant is ShopifyVariant => Boolean(variant));
  const firstImage = record.image ?? record.images?.[0] ?? null;
  const images = firstImage?.src
    ? [{ node: { url: firstImage.src, altText: firstImage.alt ?? null } }]
    : [];
  const firstVariant = variants[0];
  const price = firstVariant?.price ?? moneyValue(0);
  const compareAtPrice = firstVariant?.compareAtPrice ?? null;
  const tags = Array.isArray(record.tags)
    ? record.tags
    : String(record.tags ?? "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);

  return {
    node: {
      id: productId,
      title,
      description: String(record.body_html ?? ""),
      handle,
      vendor: String(record.vendor ?? ""),
      productType: String(record.product_type ?? ""),
      tags,
      updatedAt: record.updated_at,
      availableForSale: variants.some((variant) => variant.availableForSale),
      priceRange: { minVariantPrice: price },
      ...(compareAtPrice ? { compareAtPriceRange: { minVariantPrice: compareAtPrice } } : {}),
      images: { edges: images },
      variants: { edges: variants.map((node) => ({ node })) },
      variantsCount: { count: Math.max(Number(record.variant_count) || 0, variants.length) },
      options: [],
    },
  };
}

function catalogRecordToProduct(record: CatalogProductRecord): ShopifyProduct | null {
  const productId = shopifyGid("Product", record.legacyResourceId ?? record.id);
  const handle = String(record.handle ?? "").trim();
  const title = String(record.title ?? "").trim();
  if (!productId || !handle || !title) return null;

  const variants = (record.variants ?? [])
    .map((variant) => {
      const id = shopifyGid("ProductVariant", variant.legacyResourceId ?? variant.id);
      if (!id) return null;
      const price = moneyValue(variant.price);
      const compareAtPrice =
        variant.compare_at_price == null ? null : moneyValue(variant.compare_at_price);
      return {
        id,
        title: String(variant.title ?? "Default Title"),
        price,
        compareAtPrice,
        availableForSale: Boolean(variant.available),
        quantityAvailable:
          variant.inventory_quantity == null ? null : Number(variant.inventory_quantity),
        selectedOptions: [],
      } satisfies ShopifyVariant;
    })
    .filter((variant): variant is ShopifyVariant => Boolean(variant));
  if (variants.length === 0) return null;

  const firstImage = record.image ?? record.images?.[0] ?? null;
  const images = (record.images ?? (firstImage ? [firstImage] : []))
    .filter((image) => image?.src)
    .slice(0, 6)
    .map((image) => ({ node: { url: image.src!, altText: image.alt ?? null } }));
  const prices = variants
    .map((variant) => Number(variant.price.amount))
    .filter((price) => Number.isFinite(price));
  const compareAtPrices = variants
    .map((variant) => Number(variant.compareAtPrice?.amount))
    .filter((price) => Number.isFinite(price) && price > 0);
  const productType = String(record.productType ?? record.product_type ?? "");
  const options = (record.options ?? [])
    .map((option) => ({ name: String(option.name ?? ""), values: option.values ?? [] }))
    .filter((option) => option.name && option.values.length > 0);

  return {
    node: {
      id: productId,
      title,
      description: String(record.descriptionHtml ?? record.body_html ?? ""),
      descriptionHtml: record.descriptionHtml,
      handle,
      vendor: String(record.vendor ?? ""),
      productType,
      tags: Array.isArray(record.tags)
        ? record.tags
        : String(record.tags ?? "")
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
      updatedAt: record.updated_at,
      availableForSale: variants.some((variant) => variant.availableForSale),
      variantsCount: { count: variants.length },
      priceRange: {
        minVariantPrice: moneyValue(prices.length ? Math.min(...prices) : 0),
      },
      ...(compareAtPrices.length > 0
        ? { compareAtPriceRange: { minVariantPrice: moneyValue(Math.min(...compareAtPrices)) } }
        : {}),
      images: { edges: images },
      variants: { edges: variants.map((node) => ({ node })) },
      options,
    },
  };
}

async function fetchStaticSearchProducts(): Promise<ShopifyProduct[]> {
  const manifest = await fetchThemeJson<SearchShardManifest>("/data/product-search.json");
  const shardPaths = (manifest.shards ?? []).map((shard) => shard.path).filter(Boolean) as string[];
  if (shardPaths.length === 0) throw new Error("Theme search catalog has no shards");
  const shardPayloads = await Promise.all(
    shardPaths.map((path) => fetchThemeJson<{ products?: SearchProductRecord[] }>(path)),
  );
  const products = shardPayloads
    .flatMap((payload) => payload.products ?? [])
    .map(searchRecordToProduct)
    .filter((product): product is ShopifyProduct => Boolean(product));
  if (Number.isFinite(manifest.total) && products.length < Number(manifest.total)) {
    throw new Error("Theme search catalog is incomplete");
  }
  return products;
}

async function fetchStaticCatalogProducts(): Promise<ShopifyProduct[]> {
  const manifest = await fetchThemeJson<SearchShardManifest>("/data/product-browse.json");
  const shardPaths = (manifest.shards ?? []).map((shard) => shard.path).filter(Boolean) as string[];
  if (shardPaths.length === 0) throw new Error("Theme product catalog has no shards");
  const shardPayloads = await Promise.all(
    shardPaths.map((path) => fetchThemeJson<{ products?: CatalogProductRecord[] }>(path)),
  );
  const products = shardPayloads
    .flatMap((payload) => payload.products ?? [])
    .map(catalogRecordToProduct)
    .filter((product): product is ShopifyProduct => Boolean(product));
  if (Number.isFinite(manifest.total) && products.length < Number(manifest.total)) {
    throw new Error("Theme product catalog is incomplete");
  }
  return products;
}

export const PRODUCT_FRAGMENT = `
  id
  title
  description
  descriptionHtml
  handle
  vendor
  productType
  tags
  updatedAt
  availableForSale
  priceRange { minVariantPrice { amount currencyCode } }
  compareAtPriceRange { minVariantPrice { amount currencyCode } }
  images(first: 6) { edges { node { url altText } } }
  variants(first: 25) {
    edges {
      node {
        id
        title
        price { amount currencyCode }
        compareAtPrice { amount currencyCode }
        availableForSale
        selectedOptions { name value }
      }
    }
  }
  options { name values }
`;

export const STOREFRONT_QUERY = `
  query GetProducts($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      edges { node { ${PRODUCT_FRAGMENT} } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

// Collection and offer grids do not need the long product descriptions or six
// image URLs that product detail pages use. Keeping this connection payload
// focused makes the full-catalog cursor walk substantially faster while the
// detail route continues to use PRODUCT_FRAGMENT through STOREFRONT_QUERY.
export const BROWSE_PRODUCTS_QUERY = `
  query GetProducts($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      edges {
        node {
          id
          title
          handle
          vendor
          productType
          tags
          availableForSale
          variantsCount { count }
          priceRange { minVariantPrice { amount currencyCode } }
          compareAtPriceRange { minVariantPrice { amount currencyCode } }
          images(first: 1) { edges { node { url altText } } }
          variants(first: 1) {
            edges {
              node {
                id
                title
                price { amount currencyCode }
                compareAtPrice { amount currencyCode }
                availableForSale
                selectedOptions { name value }
              }
            }
          }
          options { name values }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const PRODUCT_BY_HANDLE_QUERY = `
  query GetProduct($handle: String!) {
    product(handle: $handle) { ${PRODUCT_FRAGMENT} }
  }
`;

export const COLLECTIONS_QUERY = `
  query GetCollections($first: Int!) {
    collections(first: $first) {
      edges { node { id title handle description updatedAt image { url altText } } }
    }
  }
`;

export const COLLECTION_BY_HANDLE_QUERY = `
  query GetCollection($handle: String!, $first: Int!) {
    collection(handle: $handle) {
      id
      title
      handle
      description
      updatedAt
      image { url altText }
      products(first: $first) { edges { node { ${PRODUCT_FRAGMENT} } } }
    }
  }
`;

export interface ShopifyCollection {
  id: string;
  title: string;
  handle: string;
  description: string;
  updatedAt?: string;
  image: { url: string; altText: string | null } | null;
}

export async function storefrontApiRequest(query: string, variables: Record<string, unknown> = {}) {
  if (!isShopifyConfigured) return null;

  const { data, error } = await supabase.functions.invoke("shopify-storefront", {
    body: { query, variables },
  });

  if (error) throw new Error(error.message || "Catalog service is unavailable");
  const hasUsableData =
    data.data &&
    Object.values(data.data).some((value: unknown) => value !== null && value !== undefined);
  if (data.errors && !hasUsableData) {
    throw new Error(
      `Error calling Shopify: ${data.errors.map((e: { message: string }) => e.message).join(", ")}`,
    );
  }
  return data;
}

export async function fetchProducts(first = 50, query?: string): Promise<ShopifyProduct[]> {
  // Listing surfaces only need one image, one representative variant and
  // option metadata. Keep the full product fragment for PDP/Quick View so the
  // first paint does not pay for descriptions, six images and 25 variants.
  const data = await storefrontApiRequest(BROWSE_PRODUCTS_QUERY, {
    first,
    after: null,
    query: query ?? null,
  });
  return data?.data?.products?.edges ?? [];
}

/**
 * Load the complete compact search index so search is not limited to the
 * first API page. Fall back to Shopify when a theme artifact is unavailable.
 */
export async function fetchSearchProducts(): Promise<ShopifyProduct[]> {
  try {
    const products = await fetchStaticSearchProducts();
    if (products.length > 0) return products;
  } catch (error) {
    console.warn("Static search catalog unavailable; using Shopify search fallback", error);
  }
  return fetchProducts(99);
}

/**
 * Load the complete public catalog for the Shop all browser. Shopify caps a
 * single Storefront API connection at 250 products, so continue through the
 * cursor until the connection is exhausted.
 */
export async function fetchAllProducts(query?: string): Promise<ShopifyProduct[]> {
  if (!query) {
    try {
      const products = await fetchStaticCatalogProducts();
      if (products.length > 0) return products;
    } catch (error) {
      console.warn("Static product catalog unavailable; using Shopify catalog fallback", error);
    }
  }

  const products: ShopifyProduct[] = [];
  const pageSize = 250;
  let after: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const data = await storefrontApiRequest(BROWSE_PRODUCTS_QUERY, {
      first: pageSize,
      after,
      query: query ?? null,
    });
    const connection = data?.data?.products;
    products.push(...(connection?.edges ?? []));
    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage && connection?.pageInfo?.endCursor);
    after = connection?.pageInfo?.endCursor ?? null;
  }

  return products;
}

export async function fetchProduct(handle: string): Promise<ShopifyProductNode | null> {
  const data = await storefrontApiRequest(PRODUCT_BY_HANDLE_QUERY, { handle });
  return data?.data?.product ?? null;
}

export async function fetchCollections(first = 20): Promise<ShopifyCollection[]> {
  const data = await storefrontApiRequest(COLLECTIONS_QUERY, { first });
  return (data?.data?.collections?.edges ?? []).map((e: { node: ShopifyCollection }) => e.node);
}

export async function fetchCollection(handle: string) {
  const data = await storefrontApiRequest(COLLECTION_BY_HANDLE_QUERY, { handle, first: 100 });
  const collection = data?.data?.collection;
  if (!collection) return null;
  return {
    ...collection,
    products: (collection.products?.edges ?? []) as ShopifyProduct[],
  } as ShopifyCollection & { products: ShopifyProduct[] };
}

export function formatMoney(amount: string | number, currencyCode = "USD") {
  const value = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode || "USD",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

export function discountPercent(price: string, compareAt?: string | null) {
  if (!compareAt) return 0;
  const p = parseFloat(price);
  const c = parseFloat(compareAt);
  if (!c || c <= p) return 0;
  return Math.round(((c - p) / c) * 100);
}
