import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;

// Shopify credentials are kept in the Supabase Edge Function. The browser only
// needs the Supabase project URL and its publishable client key.
export const isShopifyConfigured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

// A live catalog request must fail visibly instead of leaving a route in an
// infinite skeleton state. This is only a network bound: there is no cached or
// generated catalog fallback behind it.
const LIVE_CATALOG_REQUEST_TIMEOUT_MS = 12_000;
const LIVE_INVENTORY_REQUEST_TIMEOUT_MS = 4_000;

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
  image?: { url: string; altText: string | null } | null;
  selectedOptions: Array<{ name: string; value: string }>;
}

export interface ShopifyProductNode {
  id: string;
  title: string;
  description: string;
  descriptionHtml?: string | undefined;
  handle: string;
  vendor: string;
  productType: string;
  tags: string[];
  updatedAt?: string | undefined;
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

export type ShopifyProductInventory = {
  id: string;
  variants: {
    edges: Array<{
      node: Pick<ShopifyVariant, "id" | "availableForSale" | "quantityAvailable">;
    }>;
  };
};

/**
 * Storefront responses can contain a representative variant whose availability
 * differs from the product-level flag. A product is purchasable when Shopify
 * explicitly reports either level as available; only an all-false response is
 * treated as sold out.
 */
export function isProductAvailable(product: ShopifyProductNode) {
  const variants = product.variants?.edges?.map((edge) => edge.node).filter(Boolean) ?? [];
  if (product.availableForSale === true) return true;
  if (variants.some((variant) => variant.availableForSale === true)) return true;
  if (variants.length > 0 && variants.every((variant) => variant.availableForSale === false)) {
    return false;
  }
  return product.availableForSale !== false;
}

/**
 * Load only one compact browse page so the catalog can render its first cards
 * before the complete live catalog hydrates in the background.
 */
export async function fetchProductBrowsePage(pageIndex = 0): Promise<ShopifyProduct[]> {
  const pageSize = 250;
  let page = 0;
  let after: string | null = null;
  while (page <= pageIndex) {
    const data = await storefrontApiRequest(BROWSE_PRODUCTS_QUERY, {
      first: pageSize,
      after,
      query: null,
    });
    const connection = data?.data?.products;
    if (!connection) throw new Error("Shopify live catalog returned no product connection");
    if (page === pageIndex) return connection.edges ?? [];
    if (!connection.pageInfo?.hasNextPage || !connection.pageInfo?.endCursor) return [];
    after = connection.pageInfo.endCursor;
    page += 1;
  }
  return [];
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
  images(first: 250) { edges { node { url altText } } }
  variants(first: 25) {
    edges {
      node {
        id
        title
        price { amount currencyCode }
        compareAtPrice { amount currencyCode }
        availableForSale
        quantityAvailable
        image { url altText }
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

// Inventory is an optional Storefront API scope. Keep the base product query
// field-reduced, then request quantities separately so stores whose public
// token cannot read inventory can still render the live PDP. Both paths read
// the requested product from Shopify at request time; neither is a catalog
// fallback.
const PRODUCT_FRAGMENT_WITHOUT_INVENTORY = PRODUCT_FRAGMENT.replace(
  "        quantityAvailable\n",
  "",
);

const PRODUCT_BY_HANDLE_WITHOUT_INVENTORY_QUERY = `
  query GetProduct($handle: String!) {
    product(handle: $handle) { ${PRODUCT_FRAGMENT_WITHOUT_INVENTORY} }
  }
`;

const PRODUCT_INVENTORY_QUERY = `
  query GetProduct($handle: String!) {
    product(handle: $handle) {
      id
      variants(first: 25) {
        edges {
          node {
            id
            availableForSale
            quantityAvailable
          }
        }
      }
    }
  }
`;

export const COLLECTIONS_QUERY = `
  query GetCollections($first: Int!) {
    collections(first: $first) {
      edges { node { id title handle description updatedAt image { url altText } } }
    }
  }
`;

const COLLECTION_PRODUCT_FRAGMENT = `
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
`;

export const COLLECTION_BY_HANDLE_QUERY = `
  query GetCollection($handle: String!, $first: Int!, $after: String) {
    collection(handle: $handle) {
      id
      title
      handle
      description
      updatedAt
      image { url altText }
      products(first: $first, after: $after) {
        edges { node {${COLLECTION_PRODUCT_FRAGMENT} } }
        pageInfo { hasNextPage endCursor }
      }
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

export type ShopifyCollectionPage = ShopifyCollection & {
  products: ShopifyProduct[];
  hasNextPage: boolean;
  nextCursor: string | null;
};

export async function storefrontApiRequest(
  query: string,
  variables: Record<string, unknown> = {},
  options: { timeout?: number } = {},
) {
  if (!isShopifyConfigured) {
    throw new Error("Live Shopify catalog is not configured");
  }

  const { data, error } = await supabase.functions.invoke("shopify-storefront", {
    body: { query, variables },
    timeout: options.timeout ?? LIVE_CATALOG_REQUEST_TIMEOUT_MS,
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

/** Load search results directly from the live Shopify Storefront API. */
export async function fetchSearchProducts(query?: string): Promise<ShopifyProduct[]> {
  const normalizedQuery = query?.trim();
  return fetchProducts(99, normalizedQuery || undefined);
}

/**
 * Load the complete public catalog for the Shop all browser. Shopify caps a
 * single Storefront API connection at 250 products, so continue through the
 * cursor until the connection is exhausted.
 */
export async function fetchAllProducts(query?: string): Promise<ShopifyProduct[]> {
  return fetchLiveAllProducts(query);
}

/** Revalidate the full catalog directly against Shopify. */
export async function fetchLiveAllProducts(query?: string): Promise<ShopifyProduct[]> {
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
  // Product content is kept independent from optional inventory quantities so
  // an inventory scope or resolver cannot block the PDP. This still reads the
  // exact handle from Shopify at request time; it is not a local catalog
  // fallback.
  const data = await storefrontApiRequest(
    PRODUCT_BY_HANDLE_WITHOUT_INVENTORY_QUERY,
    { handle },
    { timeout: LIVE_CATALOG_REQUEST_TIMEOUT_MS },
  );
  return data?.data?.product ?? null;
}

export async function fetchProductInventory(
  handle: string,
): Promise<ShopifyProductInventory | null> {
  try {
    const data = await storefrontApiRequest(
      PRODUCT_INVENTORY_QUERY,
      { handle },
      { timeout: LIVE_INVENTORY_REQUEST_TIMEOUT_MS },
    );
    return (data?.data?.product as ShopifyProductInventory | null | undefined) ?? null;
  } catch {
    // Inventory is an optional enhancement. Never turn a live product page
    // into an error just because the optional quantity scope is unavailable or
    // the inventory resolver is slow.
    return null;
  }
}

export async function fetchCollections(first = 20): Promise<ShopifyCollection[]> {
  const data = await storefrontApiRequest(COLLECTIONS_QUERY, { first });
  return (data?.data?.collections?.edges ?? []).map((e: { node: ShopifyCollection }) => e.node);
}

export async function fetchCollection(
  handle: string,
  first = 24,
  after: string | null = null,
): Promise<ShopifyCollectionPage | null> {
  const data = await storefrontApiRequest(COLLECTION_BY_HANDLE_QUERY, { handle, first, after });
  const collection = data?.data?.collection;
  if (!collection) return null;
  const products = (collection.products?.edges ?? []).map(
    (edge: { node: ShopifyProductNode }) =>
      ({
        node: {
          ...edge.node,
          // Collection shelves only request listing fields. Product descriptions
          // and full media are loaded by the product detail route/quick view.
          description: edge.node.description ?? "",
        },
      }) satisfies ShopifyProduct,
  );
  return {
    ...collection,
    products,
    hasNextPage: Boolean(collection.products?.pageInfo?.hasNextPage),
    nextCursor: collection.products?.pageInfo?.endCursor ?? null,
  } satisfies ShopifyCollectionPage;
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
