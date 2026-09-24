#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createShopifyAdminGraphQLClient } from "./shopify-admin-graphql-client.mjs";
import { loadFutureLightEnv } from "./lib/future-light-env.mjs";
import { readCompleteShopifyConnection } from "./lib/shopify-snapshot-pagination.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const PRODUCT_PAGE_SIZE = 4;
const NESTED_PAGE_SIZE = 20;
const VARIANT_MEDIA_PAGE_SIZE = 5;
const SHOPIFY_ENV_KEYS = new Set([
  "FUTURE_LIGHT_SHOP_DOMAIN",
  "FUTURE_LIGHT_SHOP_URL",
  "FUTURE_LIGHT_SHOPIFY_ADMIN_ACCESS_TOKEN",
  "FUTURE_LIGHT_SHOPIFY_API_VERSION",
  "FUTURE_LIGHT_SHOPIFY_MAX_REQUEST_ATTEMPTS",
  "FUTURE_LIGHT_SHOPIFY_MAX_RETRY_DELAY_MS",
  "FUTURE_LIGHT_SHOPIFY_REQUEST_CONCURRENCY",
  "FUTURE_LIGHT_SHOPIFY_REQUEST_DELAY_MS",
  "FUTURE_LIGHT_SHOPIFY_REQUEST_TIMEOUT_MS",
  "SHOPIFY_ADMIN_API_VERSION",
  "SHOPIFY_CLI_BINARY",
]);

const VARIANT_SELECTION = /* GraphQL */ `
  id
  legacyResourceId
  title
  sku
  selectedOptions { name value }
  price
  compareAtPrice
  inventoryQuantity
  media(first: ${VARIANT_MEDIA_PAGE_SIZE}) {
    nodes {
      __typename
      id
      alt
      mediaContentType
    }
    pageInfo { hasNextPage endCursor }
  }
`;

const METAFIELD_SELECTION = /* GraphQL */ `
  id
  namespace
  key
  type
  value
  reference {
    __typename
    ... on Metaobject { id type }
  }
`;

const MEDIA_SELECTION = /* GraphQL */ `
  __typename
  id
  alt
  mediaContentType
  status
  preview { image { url altText width height } }
  ... on MediaImage {
    image { url altText width height }
  }
`;

const PRODUCTS_QUERY = /* GraphQL */ `
  query FutureLightCatalogSnapshotProducts($first: Int!, $after: String, $nestedFirst: Int!) {
    products(first: $first, after: $after) {
      nodes {
        id
        legacyResourceId
        handle
        title
        descriptionHtml
        vendor
        productType
        status
        tags
        createdAt
        updatedAt
        publishedAt
        totalInventory
        category { id name fullName }
        seo { title description }
        resourcePublications(first: $nestedFirst) {
          nodes { isPublished channel { name } }
          pageInfo { hasNextPage endCursor }
        }
        collections(first: $nestedFirst) {
          nodes { id handle title }
          pageInfo { hasNextPage endCursor }
        }
        variants(first: $nestedFirst) {
          nodes { ${VARIANT_SELECTION} }
          pageInfo { hasNextPage endCursor }
        }
        media(first: $nestedFirst) {
          nodes { ${MEDIA_SELECTION} }
          pageInfo { hasNextPage endCursor }
        }
        metafields(first: $nestedFirst) {
          nodes { ${METAFIELD_SELECTION} }
          pageInfo { hasNextPage endCursor }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const VARIANTS_CONTINUATION_QUERY = /* GraphQL */ `
  query FutureLightCatalogSnapshotVariants($id: ID!, $first: Int!, $after: String) {
    node(id: $id) {
      ... on Product {
        variants(first: $first, after: $after) {
          nodes { ${VARIANT_SELECTION} }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
`;

const MEDIA_CONTINUATION_QUERY = /* GraphQL */ `
  query FutureLightCatalogSnapshotMedia($id: ID!, $first: Int!, $after: String) {
    node(id: $id) {
      ... on Product {
        media(first: $first, after: $after) {
          nodes { ${MEDIA_SELECTION} }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
`;

const METAFIELDS_CONTINUATION_QUERY = /* GraphQL */ `
  query FutureLightCatalogSnapshotMetafields($id: ID!, $first: Int!, $after: String) {
    node(id: $id) {
      ... on Product {
        metafields(first: $first, after: $after) {
          nodes { ${METAFIELD_SELECTION} }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
`;

const RESOURCE_PUBLICATIONS_CONTINUATION_QUERY = /* GraphQL */ `
  query FutureLightCatalogSnapshotPublications($id: ID!, $first: Int!, $after: String) {
    node(id: $id) {
      ... on Product {
        resourcePublications(first: $first, after: $after) {
          nodes {
            isPublished
            channel {
              name
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;

const COLLECTIONS_CONTINUATION_QUERY = /* GraphQL */ `
  query FutureLightCatalogSnapshotCollections($id: ID!, $first: Int!, $after: String) {
    node(id: $id) {
      ... on Product {
        collections(first: $first, after: $after) {
          nodes {
            id
            handle
            title
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;

const VARIANT_MEDIA_CONTINUATION_QUERY = /* GraphQL */ `
  query FutureLightCatalogSnapshotVariantMedia($id: ID!, $first: Int!, $after: String) {
    node(id: $id) {
      ... on ProductVariant {
        media(first: $first, after: $after) {
          nodes {
            __typename
            id
            alt
            mediaContentType
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isOnlineStorePublished(product) {
  return asArray(product?.resourcePublications?.nodes).some(
    (publication) =>
      publication?.isPublished === true &&
      String(publication?.channel?.name || "")
        .trim()
        .toLowerCase() === "online store",
  );
}

async function hydrateConnection({ client, product, field, query }) {
  return readCompleteShopifyConnection({
    initialConnection: product[field],
    connectionName: field,
    productId: product.id,
    readPage: async (cursor) => {
      const payload = await client.run(
        query,
        { id: product.id, first: NESTED_PAGE_SIZE, after: cursor },
        { operation: `read full ${field} connection for ${product.handle}` },
      );
      return payload?.node?.[field];
    },
  });
}

async function hydrateVariantMedia({ client, product, variant }) {
  const media = await readCompleteShopifyConnection({
    initialConnection: variant.media,
    connectionName: `variant media ${variant.id}`,
    productId: product.id,
    readPage: async (cursor) => {
      const payload = await client.run(
        VARIANT_MEDIA_CONTINUATION_QUERY,
        { id: variant.id, first: NESTED_PAGE_SIZE, after: cursor },
        { operation: `read full variant image mapping for ${product.handle}` },
      );
      return payload?.node?.media;
    },
  });
  return { ...variant, media };
}

async function hydrateProduct(client, product) {
  const [variants, media, metafields, resourcePublications, collections] = await Promise.all([
    hydrateConnection({ client, product, field: "variants", query: VARIANTS_CONTINUATION_QUERY }),
    hydrateConnection({ client, product, field: "media", query: MEDIA_CONTINUATION_QUERY }),
    hydrateConnection({
      client,
      product,
      field: "metafields",
      query: METAFIELDS_CONTINUATION_QUERY,
    }),
    hydrateConnection({
      client,
      product,
      field: "resourcePublications",
      query: RESOURCE_PUBLICATIONS_CONTINUATION_QUERY,
    }),
    hydrateConnection({
      client,
      product,
      field: "collections",
      query: COLLECTIONS_CONTINUATION_QUERY,
    }),
  ]);
  const variantsWithCompleteMedia = await Promise.all(
    variants.nodes.map((variant) => hydrateVariantMedia({ client, product, variant })),
  );
  return {
    ...product,
    variants: { ...variants, nodes: variantsWithCompleteMedia },
    media,
    metafields,
    resourcePublications,
    collections,
  };
}

function assertUniqueProductIds(products) {
  const seen = new Set();
  for (const product of products) {
    if (!product?.id || seen.has(product.id)) {
      throw new Error(
        `Shopify catalog snapshot contains a missing or duplicate product ID: ${product?.id || "<missing>"}`,
      );
    }
    seen.add(product.id);
  }
}

async function main() {
  await loadFutureLightEnv({ rootDir, allowedKeys: SHOPIFY_ENV_KEYS });
  const client = createShopifyAdminGraphQLClient({
    rootDir,
    agentName: "future-light-complete-catalog-snapshot",
  });
  const products = [];
  const retryInfo = [];
  let after = null;
  let page = 0;

  while (true) {
    const payload = await client.run(
      PRODUCTS_QUERY,
      { first: PRODUCT_PAGE_SIZE, after, nestedFirst: NESTED_PAGE_SIZE },
      { operation: `read Shopify catalog product page ${page + 1}`, retryInfo },
    );
    const connection = payload?.products;
    if (!connection) throw new Error("Shopify returned no product connection.");
    const pageProducts = await Promise.all(
      asArray(connection.nodes).map((product) => hydrateProduct(client, product)),
    );
    products.push(...pageProducts);
    page += 1;
    process.stdout.write(
      `Read Shopify catalog page ${page}: ${pageProducts.length} products (${products.length} total)\n`,
    );
    if (!connection.pageInfo?.hasNextPage) break;
    if (!connection.pageInfo?.endCursor) {
      throw new Error("Shopify product page hasNextPage without an end cursor.");
    }
    after = connection.pageInfo.endCursor;
    if (page > 1000) throw new Error("Shopify product pagination exceeded 1000 pages.");
  }

  if (products.length === 0) throw new Error("Shopify returned an empty product catalog.");
  assertUniqueProductIds(products);
  const statusCounts = products.reduce((counts, product) => {
    const status = String(product.status || "UNKNOWN").toUpperCase();
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
  const onlineStoreProducts = products.filter(isOnlineStorePublished);
  const generatedAt = new Date();
  const timestamp = generatedAt
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  const outputPath = resolve(
    rootDir,
    "output",
    `future-light-shopify-catalog-snapshot-${timestamp}.json`,
  );
  const snapshot = {
    schemaVersion: "2026-09-24.future-light-shopify-catalog-snapshot.1",
    generatedAt: generatedAt.toISOString(),
    targetStoreDomain: client.storeDomain,
    apiVersion: client.apiVersion,
    source:
      "Shopify Admin GraphQL products, categories, SEO, metafields, media, variants, and variant-media connections",
    scope:
      "all product statuses; full connection pagination; read-only snapshot; no Google Merchant Center access",
    readOnly: true,
    liveMutation: false,
    retryInfo,
    summary: {
      totalProducts: products.length,
      onlineStorePublishedProducts: onlineStoreProducts.length,
      productPages: page,
      statusCounts,
      totalVariants: products.reduce((total, product) => total + product.variants.nodes.length, 0),
      totalMedia: products.reduce((total, product) => total + product.media.nodes.length, 0),
      totalVariantMediaAssociations: products.reduce(
        (total, product) =>
          total +
          product.variants.nodes.reduce((count, variant) => count + variant.media.nodes.length, 0),
        0,
      ),
      totalProductMetafields: products.reduce(
        (total, product) => total + product.metafields.nodes.length,
        0,
      ),
      productsWithCompleteConnections: products.filter(
        (product) =>
          !product.variants.pageInfo.hasNextPage &&
          !product.media.pageInfo.hasNextPage &&
          !product.metafields.pageInfo.hasNextPage &&
          !product.resourcePublications.pageInfo.hasNextPage &&
          !product.collections.pageInfo.hasNextPage &&
          product.variants.nodes.every((variant) => !variant.media.pageInfo.hasNextPage),
      ).length,
      totalCollectionMemberships: products.reduce(
        (total, product) => total + product.collections.nodes.length,
        0,
      ),
    },
    products,
  };

  await mkdir(resolve(rootDir, "output"), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  process.stdout.write(
    `${JSON.stringify({ outputPath, ...snapshot.summary, targetStoreDomain: snapshot.targetStoreDomain, readOnly: snapshot.readOnly }, null, 2)}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
