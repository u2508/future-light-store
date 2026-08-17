#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { readProductCatalogPayload } from "./product-catalog-files.mjs";
import { createShopifyAdminGraphQLClient } from "./shopify-admin-graphql-client.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const defaultManifestPath = resolve(rootDir, "output", "shopify-variant-image-mapping-full-forced-dry-run-v3.json");
const defaultOutputPath = resolve(rootDir, "output", "shopify-variant-image-mapping-live-readback-v3.json");
const pollDelayMs = Math.max(1000, Number(process.env.SALT_VARIANT_IMAGE_READBACK_POLL_MS || 5000));
const priceFloor = Math.max(0, Number(process.env.SALT_CATALOG_PRICE_FLOOR || 35));
const client = createShopifyAdminGraphQLClient({ rootDir, agentName: "variant-image-readback" });

const BULK_READBACK_QUERY = /* GraphQL */ `
  {
    products(query: "status:active") {
      edges {
        node {
          id
          handle
          variants {
            edges {
              node {
                id
                price
                compareAtPrice
                media(first: 1) {
                  edges {
                    node {
                      __typename
                      id
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

const START_BULK_READBACK = /* GraphQL */ `
  mutation StartVariantImageReadback($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }
`;

const BULK_STATUS = /* GraphQL */ `
  query VariantImageReadbackStatus($id: ID!) {
    bulkOperation(id: $id) {
      id
      status
      errorCode
      objectCount
      fileSize
      url
      partialDataUrl
      completedAt
    }
  }
`;

function parseArgs(argv) {
  const args = { manifestPath: defaultManifestPath, outputPath: defaultOutputPath };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--manifest" && next) {
      args.manifestPath = resolve(rootDir, next);
      index += 1;
    } else if (token === "--output" && next) {
      args.outputPath = resolve(rootDir, next);
      index += 1;
    }
  }
  return args;
}

function variantGid(value) {
  const raw = String(value || "");
  return raw.startsWith("gid://") ? raw : `gid://shopify/ProductVariant/${raw}`;
}

function mediaIdFromVariant(node, mediaByVariant) {
  const direct = [
    ...(node?.media?.nodes || []),
    ...(node?.media?.edges || []).map((edge) => edge?.node),
  ].find((media) => media?.id && media?.__typename === "MediaImage")?.id;
  return String(direct || mediaByVariant.get(String(node?.id || "")) || "");
}

async function waitForBulkOperation(operationId) {
  while (true) {
    const data = await client.run(BULK_STATUS, { id: operationId }, { operation: "variant image live readback status" });
    const operation = data?.bulkOperation;
    if (!operation) throw new Error(`Variant image readback operation not found: ${operationId}`);
    process.stdout.write(`Variant image readback ${operation.status}: ${operation.objectCount || 0} record(s)\n`);
    if (operation.status === "COMPLETED") return operation;
    if (["FAILED", "CANCELED", "EXPIRED"].includes(operation.status)) {
      throw new Error(`Variant image readback ended ${operation.status}: ${operation.errorCode || "unknown error"}`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, pollDelayMs));
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const manifest = JSON.parse(await readFile(args.manifestPath, "utf8"));
  const catalog = await readProductCatalogPayload(resolve(rootDir, "public", "data"));
  const expectedMedia = new Map();
  for (const product of manifest.products || []) {
    for (const update of product.updates || []) {
      expectedMedia.set(String(update.id), {
        handle: product.handle,
        mediaId: String(update.mediaId || ""),
        expectedPrice: String(update.expectedPrice || ""),
      });
    }
  }
  const expectedPrices = new Map();
  for (const product of catalog.products || []) {
    for (const variant of product.variants || []) {
      expectedPrices.set(variantGid(variant?.id), {
        handle: product.handle,
        price: variant?.price == null ? "" : String(variant.price),
        compareAtPrice: variant?.compare_at_price == null ? "" : String(variant.compare_at_price),
      });
    }
  }

  const started = await client.run(START_BULK_READBACK, { query: BULK_READBACK_QUERY }, {
    allowMutations: true,
    operation: "start variant image live readback",
  });
  const result = started?.bulkOperationRunQuery;
  const startErrors = Array.isArray(result?.userErrors) ? result.userErrors : [];
  if (startErrors.length) throw new Error(startErrors.map((error) => error.message).join(" | "));
  const operationId = result?.bulkOperation?.id;
  if (!operationId) throw new Error("Shopify returned no variant image readback operation id");
  const operation = await waitForBulkOperation(operationId);
  if (!operation.url) throw new Error("Variant image readback completed without a result URL");
  const response = await fetch(operation.url);
  if (!response.ok) throw new Error(`Variant image readback download failed (${response.status})`);
  const lines = (await response.text()).split(/\r?\n/).filter(Boolean);
  const mediaByVariant = new Map();
  const variants = new Map();
  const productIds = new Set();
  for (const line of lines) {
    const node = JSON.parse(line);
    const id = String(node?.id || "");
    if (id.startsWith("gid://shopify/Product/")) productIds.add(id);
    if (id.startsWith("gid://shopify/ProductVariant/")) {
      variants.set(id, node);
      const mediaId = [
        ...(node?.media?.nodes || []),
        ...(node?.media?.edges || []).map((edge) => edge?.node),
      ].find((media) => media?.id)?.id;
      if (mediaId) mediaByVariant.set(id, String(mediaId));
    }
    if (node?.__parentId && id.startsWith("gid://shopify/MediaImage/")) {
      mediaByVariant.set(String(node.__parentId), id);
    }
  }

  const failures = [];
  let changedMediaExact = 0;
  for (const [variantId, expected] of expectedMedia) {
    const actual = variants.get(variantId);
    const actualMediaId = actual ? mediaIdFromVariant(actual, mediaByVariant) : "";
    if (!actual || actualMediaId !== expected.mediaId) {
      failures.push({ handle: expected.handle, variantId, reason: "media-readback-mismatch", expected: expected.mediaId, actual: actualMediaId });
    } else {
      changedMediaExact += 1;
    }
  }

  let priceExact = 0;
  let compareAtExact = 0;
  let priceMismatches = 0;
  let compareAtMismatches = 0;
  let missingPrices = 0;
  let priceFloorViolations = 0;
  for (const [variantId, expected] of expectedPrices) {
    const actual = variants.get(variantId);
    if (!actual) {
      missingPrices += 1;
      continue;
    }
    const actualPrice = Number(actual.price);
    if (Number.isFinite(actualPrice) && actualPrice < priceFloor) {
      priceFloorViolations += 1;
      failures.push({ handle: expected.handle, variantId, reason: "price-floor-violation", priceFloor, actualPrice: String(actual.price || "") });
    }
    if (String(actual.price || "") === expected.price) priceExact += 1;
    else {
      priceMismatches += 1;
      failures.push({ handle: expected.handle, variantId, reason: "price-readback-mismatch", expectedPrice: expected.price, actualPrice: String(actual.price || "") });
    }
    const actualCompareAt = String(actual.compareAtPrice || "");
    if (actualCompareAt === expected.compareAtPrice) compareAtExact += 1;
    else compareAtMismatches += 1;
  }

  const output = {
    generatedAt: new Date().toISOString(),
    sourceManifest: args.manifestPath,
    bulkOperation: { id: operation.id, status: operation.status, objectCount: Number(operation.objectCount || 0), completedAt: operation.completedAt || "" },
    summary: {
      activeProductsRead: productIds.size,
      activeVariantsRead: variants.size,
      expectedChangedMedia: expectedMedia.size,
      changedMediaExact,
      expectedCatalogPrices: expectedPrices.size,
      priceExact,
      priceMismatches,
      missingPrices,
      compareAtExact,
      compareAtMismatches,
      priceFloor,
      priceFloorViolations,
      failures: failures.length,
    },
    failures,
  };
  await writeFile(args.outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  process.stdout.write(`Variant image live readback complete: ${changedMediaExact}/${expectedMedia.size} media exact, ${priceExact}/${expectedPrices.size} prices exact, ${failures.length} failure(s).\n`);
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
