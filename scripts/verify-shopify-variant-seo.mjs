#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { buildVariantSeoProfiles } from "../src/lib/shopify-variant-seo.js";
import { createShopifyAdminGraphQLClient } from "./shopify-admin-graphql-client.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const outputPath = resolve(rootDir, "output", "shopify-variant-seo-verification.json");
const pageSize = Math.max(1, Math.min(250, Number(process.env.SALT_VARIANT_SEO_PAGE_SIZE || 100)));
const client = createShopifyAdminGraphQLClient({ rootDir, agentName: "variant-seo-verification" });

const QUERY = /* GraphQL */ `
  query VariantSeoProducts($first: Int!, $after: String) {
    products(first: $first, after: $after, query: "status:active") {
      nodes {
        id
        handle
        title
        variants(first: 250) { nodes { id title price } pageInfo { hasNextPage endCursor } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const VARIANT_CONTINUATION_QUERY = /* GraphQL */ `
  query VariantSeoVariantContinuation($id: ID!, $first: Int!, $after: String) {
    product(id: $id) {
      variants(first: $first, after: $after) {
        nodes { id title price }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

async function completeProductVariants(product) {
  const variants = [...(product?.variants?.nodes || [])];
  let after = product?.variants?.pageInfo?.endCursor || null;
  let hasNextPage = Boolean(product?.variants?.pageInfo?.hasNextPage);
  while (hasNextPage) {
    const payload = await client.run(VARIANT_CONTINUATION_QUERY, { id: product.id, first: 250, after }, { operation: `read variant SEO continuation for ${product.handle}` });
    const connection = payload?.product?.variants;
    if (!connection) throw new Error(`Shopify returned no variant SEO continuation for ${product.handle}`);
    variants.push(...(connection.nodes || []));
    hasNextPage = Boolean(connection.pageInfo?.hasNextPage);
    after = connection.pageInfo?.endCursor || null;
    if (hasNextPage && !after) throw new Error(`Variant SEO continuation for ${product.handle} has no cursor`);
  }
  return { ...product, variants };
}

async function main() {
  const products = [];
  let after = null;
  while (true) {
    const payload = await client.run(QUERY, { first: pageSize, after }, { operation: "verify variant-aware SEO profiles" });
    for (const product of payload?.products?.nodes || []) {
      products.push(await completeProductVariants(product));
    }
    if (!payload?.products?.pageInfo?.hasNextPage) break;
    after = payload.products.pageInfo.endCursor || null;
    if (!after) throw new Error("Shopify returned a next page without a cursor during variant SEO verification");
  }

  const failures = [];
  let variants = 0;
  let distinctProducts = 0;
  for (const product of products) {
    const profiles = buildVariantSeoProfiles(product);
    variants += profiles.length;
    if (profiles.length > 1 && new Set(profiles.map((profile) => profile.title.toLowerCase())).size !== profiles.length) {
      failures.push({ handle: product.handle, reason: "duplicate-variant-seo-title" });
    }
    if (profiles.some((profile) => profile.label !== "Standard Option")) distinctProducts += 1;
    if (profiles.some((profile) => !profile.title || !profile.description || profile.description.length > 160)) {
      failures.push({ handle: product.handle, reason: "invalid-variant-seo-profile" });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    products: products.length,
    variants,
    productsWithDistinctVariantProfiles: distinctProducts,
    failures,
    policy: "Product SEO remains canonical; selected Shopify variant drives request-time title, description, image, and offer metadata.",
  };
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (failures.length) throw new Error(`Variant SEO verification failed for ${failures.length} product(s)`);
  process.stdout.write(`Variant-aware SEO verified: ${products.length} active products, ${variants} variants, zero profile failures.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
