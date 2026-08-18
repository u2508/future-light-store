import { supabase } from "@/integrations/supabase/client";

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
  images: { edges: Array<{ node: { url: string; altText: string | null } }> };
  variants: { edges: Array<{ node: ShopifyVariant }> };
  options: Array<{ name: string; values: string[] }>;
}

export interface ShopifyProduct {
  node: ShopifyProductNode;
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
  query GetProducts($first: Int!, $query: String) {
    products(first: $first, query: $query) {
      edges { node { ${PRODUCT_FRAGMENT} } }
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
  const data = await storefrontApiRequest(STOREFRONT_QUERY, { first, query: query ?? null });
  return data?.data?.products?.edges ?? [];
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
