#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { asArray, createShopifyAdminGraphQLClient } from "./shopify-admin-graphql-client.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const outputPath = resolve(
  rootDir,
  process.env.FUTURE_LIGHT_LIVE_MEDIA_CATALOG_OUTPUT || "output/shopify-live-product-media-catalog-20260919.json",
);
const pageSize = Math.max(1, Math.min(50, Number(process.env.FUTURE_LIGHT_LIVE_MEDIA_PAGE_SIZE || 20)));
const nestedPageSize = Math.max(1, Math.min(250, Number(process.env.FUTURE_LIGHT_LIVE_NESTED_PAGE_SIZE || 100)));
const client = createShopifyAdminGraphQLClient({ rootDir, agentName: "live-product-media-catalog" });

const PRODUCT_SELECTION = /* GraphQL */ `
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
  seo { title description }
  resourcePublications(first: 100) {
    nodes { isPublished channel { name } }
  }
  variants(first: $nestedFirst) {
    nodes {
      id
      legacyResourceId
      title
      sku
      selectedOptions { name value }
      price
      compareAtPrice
      inventoryQuantity
      media(first: 1) {
        nodes { __typename id }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
  media(first: $nestedFirst) {
    nodes {
      __typename
      ... on MediaImage {
        id
        alt
        image { url altText width height }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
`;

const PRODUCTS_QUERY = /* GraphQL */ `
  query LiveProductMediaCatalogProducts($first: Int!, $after: String, $nestedFirst: Int!) {
    products(first: $first, after: $after, query: "status:active") {
      nodes { ${PRODUCT_SELECTION} }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const NESTED_PRODUCT_QUERY = /* GraphQL */ `
  query LiveProductMediaCatalogNestedProduct($id: ID!, $first: Int!, $after: String) {
    node(id: $id) {
      ... on Product {
        variants(first: $first, after: $after) {
          nodes {
            id
            legacyResourceId
            title
            sku
            selectedOptions { name value }
            price
            compareAtPrice
            inventoryQuantity
            media(first: 1) { nodes { __typename id } }
          }
          pageInfo { hasNextPage endCursor }
        }
        media(first: $first, after: $after) {
          nodes {
            __typename
            ... on MediaImage {
              id
              alt
              image { url altText width height }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
`;

function isOnlineStorePublished(product) {
  return asArray(product?.resourcePublications?.nodes).some((publication) => (
    publication?.isPublished === true &&
    String(publication?.channel?.name || "").trim().toLowerCase() === "online store"
  ));
}

async function readContinuation(product, field) {
  const nodes = asArray(product?.[field]?.nodes);
  let pageInfo = product?.[field]?.pageInfo || { hasNextPage: false, endCursor: null };
  while (pageInfo.hasNextPage && pageInfo.endCursor) {
    const payload = await client.run(
      NESTED_PRODUCT_QUERY,
      { id: product.id, first: nestedPageSize, after: pageInfo.endCursor },
      { operation: `${field} continuation ${product.handle}` },
    );
    const next = payload?.node?.[field];
    if (!next) throw new Error(`Shopify returned no ${field} continuation for ${product.handle}`);
    nodes.push(...asArray(next.nodes));
    pageInfo = next.pageInfo || { hasNextPage: false, endCursor: null };
  }
  return { nodes, pageInfo };
}

async function hydrateProduct(product) {
  const [variants, media] = await Promise.all([
    readContinuation(product, "variants"),
    readContinuation(product, "media"),
  ]);
  return { ...product, variants, media };
}

async function main() {
  const products = [];
  let after = null;
  let page = 0;
  while (true) {
    const payload = await client.run(
      PRODUCTS_QUERY,
      { first: pageSize, after, nestedFirst: nestedPageSize },
      { operation: `live product media page ${page + 1}` },
    );
    const connection = payload?.products;
    if (!connection) throw new Error("Shopify returned no product connection.");
    const pageProducts = await Promise.all(asArray(connection.nodes).map(hydrateProduct));
    products.push(...pageProducts);
    page += 1;
    process.stdout.write(`Fetched live media page ${page}: ${pageProducts.length} products (total ${products.length})\n`);
    if (!connection.pageInfo?.hasNextPage) break;
    if (!connection.pageInfo?.endCursor) throw new Error("Product page hasNextPage without an end cursor.");
    after = connection.pageInfo.endCursor;
  }

  const onlineStoreProducts = products.filter(isOnlineStorePublished);
  const payload = {
    generatedAt: new Date().toISOString(),
    source: "Shopify Admin GraphQL active products with complete media and variant-media readback",
    scope: "active products; Online Store published products are the customer-facing SEO and mapping scope",
    totalProducts: products.length,
    onlineStorePublishedProducts: onlineStoreProducts.length,
    products,
  };
  await mkdir(resolve(rootDir, "output"), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ outputPath, totalProducts: payload.totalProducts, onlineStorePublishedProducts: payload.onlineStorePublishedProducts, productsWithCompleteNestedPages: products.filter((product) => !product.variants.pageInfo.hasNextPage && !product.media.pageInfo.hasNextPage).length }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
