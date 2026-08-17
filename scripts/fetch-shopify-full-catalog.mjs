#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createShopifyAdminGraphQLClient } from "./shopify-admin-graphql-client.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const outputPath = resolve(rootDir, "output", "shopify-full-catalog-snapshot.json");
const pageSize = Math.max(1, Math.min(250, Number(process.env.SALT_FULL_CATALOG_PAGE_SIZE || 250)));
const client = createShopifyAdminGraphQLClient({ rootDir, agentName: "full-catalog-snapshot" });

const PRODUCTS_QUERY = /* GraphQL */ `
  query FullCatalogProducts($first: Int!, $after: String) {
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
        resourcePublications(first: 100) {
          nodes {
            isPublished
            channel { name }
          }
        }
        variants(first: 250) {
          nodes {
            id
            legacyResourceId
            title
            sku
            price
            compareAtPrice
            inventoryQuantity
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isOnlineStorePublished(product) {
  return asArray(product?.resourcePublications?.nodes).some((publication) => (
    publication?.isPublished === true &&
    String(publication?.channel?.name || "").trim().toLowerCase() === "online store"
  ));
}

async function main() {
  const products = [];
  let after = null;
  let page = 0;

  while (true) {
    const payload = await client.run(PRODUCTS_QUERY, { first: pageSize, after }, {
      operation: `full catalog product page ${page + 1}`,
    });
    const connection = payload?.products;
    if (!connection) throw new Error("Shopify returned no full catalog product connection.");
    const nodes = asArray(connection.nodes);
    products.push(...nodes);
    page += 1;
    process.stdout.write(`Fetched full catalog page ${page}: ${nodes.length} products\n`);
    if (!connection.pageInfo?.hasNextPage) break;
    if (!connection.pageInfo?.endCursor) throw new Error("Full catalog page hasNextPage without an end cursor.");
    after = connection.pageInfo.endCursor;
  }

  const statusCounts = products.reduce((counts, product) => {
    const status = String(product?.status || "UNKNOWN").toUpperCase();
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
  const snapshot = {
    generatedAt: new Date().toISOString(),
    source: "Shopify Admin GraphQL products connection without status or publication filters",
    scope: "all products and statuses; read-only snapshot",
    totalProducts: products.length,
    pages: page,
    onlineStorePublishedProducts: products.filter(isOnlineStorePublished).length,
    statusCounts,
    products,
  };

  await mkdir(resolve(rootDir, "output"), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    outputPath,
    totalProducts: snapshot.totalProducts,
    onlineStorePublishedProducts: snapshot.onlineStorePublishedProducts,
    statusCounts: snapshot.statusCounts,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
