import { toast } from "sonner";

export const SHOPIFY_API_VERSION = import.meta.env.VITE_SHOPIFY_API_VERSION ?? "2025-07";
export const SHOPIFY_STORE_PERMANENT_DOMAIN =
  import.meta.env.VITE_SHOPIFY_STORE_DOMAIN ?? "vs-future-store-0jl2t-jxu6tnr3.myshopify.com";
export const SHOPIFY_STOREFRONT_URL = `https://${SHOPIFY_STORE_PERMANENT_DOMAIN}/api/${SHOPIFY_API_VERSION}/graphql.json`;
export const SHOPIFY_STOREFRONT_TOKEN = import.meta.env.VITE_SHOPIFY_STOREFRONT_TOKEN ?? "";

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
  handle: string;
  vendor: string;
  productType: string;
  tags: string[];
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
  handle
  vendor
  productType
  tags
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
      edges { node { id title handle description image { url altText } } }
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
  image: { url: string; altText: string | null } | null;
}

export async function storefrontApiRequest(query: string, variables: Record<string, unknown> = {}) {
  const response = await fetch(SHOPIFY_STOREFRONT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": SHOPIFY_STOREFRONT_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (response.status === 402) {
    toast.error("Shopify: Payment required", {
      description:
        "Shopify API access requires an active billing plan. Visit https://admin.shopify.com to upgrade.",
    });
    return null;
  }

  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

  const data = await response.json();
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
