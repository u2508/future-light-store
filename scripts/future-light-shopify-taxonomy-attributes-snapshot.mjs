#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { createShopifyAdminGraphQLClient } from "./shopify-admin-graphql-client.mjs";
import { loadFutureLightEnv } from "./lib/future-light-env.mjs";
import {
  chunkTaxonomyCategoryIds,
  collectAssignedTaxonomyCategories,
  reconcileTaxonomyCategoryAttributes,
} from "./lib/future-light-taxonomy-category-attributes.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const outputDir = join(rootDir, "output");
const expectedStore = "vs-future-store-0jl2t-jxu6tnr3.myshopify.com";
const expectedShopId = "gid://shopify/Shop/106570088529";
// One category per request keeps nested attributes/choice values comfortably bounded.
const batchSize = 1;

const SHOP_IDENTITY_QUERY = /* GraphQL */ `
  query FutureLightTaxonomySnapshotShopIdentity {
    shop {
      id
      name
      myshopifyDomain
      primaryDomain {
        host
      }
    }
  }
`;

const READ_ONLY_ENV_KEYS = new Set([
  "CONVERSATION_ID",
  "FUTURE_LIGHT_SHOP_DOMAIN",
  "FUTURE_LIGHT_SHOP_URL",
  "FUTURE_LIGHT_SHOPIFY_ADMIN_ACCESS_TOKEN",
  "FUTURE_LIGHT_SHOPIFY_API_VERSION",
  "FUTURE_LIGHT_SHOPIFY_CLI_AGENT_IDS",
  "FUTURE_LIGHT_SHOPIFY_CLI_AGENT_INFO",
  "FUTURE_LIGHT_SHOPIFY_MAX_REQUEST_ATTEMPTS",
  "FUTURE_LIGHT_SHOPIFY_MAX_RETRY_DELAY_MS",
  "FUTURE_LIGHT_SHOPIFY_REQUEST_CONCURRENCY",
  "FUTURE_LIGHT_SHOPIFY_REQUEST_DELAY_MS",
  "FUTURE_LIGHT_SHOPIFY_REQUEST_TIMEOUT_MS",
  "SHOPIFY_ADMIN_API_VERSION",
  "SHOPIFY_CLI_BINARY",
]);

const TAXONOMY_CATEGORIES_QUERY = /* GraphQL */ `
  query FutureLightAssignedTaxonomyCategories($ids: [ID!]!) {
    nodes(ids: $ids) {
      __typename
      ... on TaxonomyCategory {
        id
        name
        fullName
        isLeaf
        attributes(first: 250) {
          nodes {
            __typename
            ... on TaxonomyAttribute {
              id
            }
            ... on TaxonomyChoiceListAttribute {
              id
              name
              values(first: 250) {
                nodes {
                  id
                  name
                }
                pageInfo {
                  hasNextPage
                  endCursor
                }
              }
            }
            ... on TaxonomyMeasurementAttribute {
              id
              name
              options {
                key
                value
              }
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

function log(message) {
  process.stdout.write(`[${new Date().toISOString()}] ${message}\n`);
}

function snapshotFileFromArgs() {
  const args = process.argv.slice(2);
  if (!args.length) return null;
  if (args.length !== 2 || args[0] !== "--snapshot") {
    throw new Error("Usage: node scripts/future-light-shopify-taxonomy-attributes-snapshot.mjs [--snapshot output-file.json]");
  }
  const filename = basename(args[1]);
  if (filename !== args[1] || !filename.startsWith("future-light-shopify-catalog-snapshot-") || !filename.endsWith(".json")) {
    throw new Error("--snapshot must name a catalog snapshot file inside this project's output directory.");
  }
  return filename;
}

async function findLatestCatalogSnapshot() {
  const names = (await readdir(outputDir)).filter(
    (name) => name.startsWith("future-light-shopify-catalog-snapshot-") && name.endsWith(".json"),
  );
  const candidates = await Promise.all(
    names.map(async (name) => {
      const path = join(outputDir, name);
      try {
        const snapshot = JSON.parse(await readFile(path, "utf8"));
        if (snapshot.schemaVersion !== 2 || snapshot.shopDomain !== expectedStore) return null;
        return { name, path, createdAt: snapshot.createdAt };
      } catch {
        return null;
      }
    }),
  );
  const valid = candidates.filter(Boolean).sort((left, right) =>
    String(right.createdAt).localeCompare(String(left.createdAt)),
  );
  if (!valid.length) {
    throw new Error("No verified schema-2 Future Light Shopify catalog snapshot exists in output/.");
  }
  return valid[0];
}

async function readCatalogSnapshot(filename) {
  const selected = filename ? { name: filename, path: join(outputDir, filename) } : await findLatestCatalogSnapshot();
  const raw = await readFile(selected.path, "utf8");
  const snapshot = JSON.parse(raw);
  if (
    snapshot.schemaVersion !== 2 ||
    snapshot.shopDomain !== expectedStore ||
    snapshot.apiVersion === undefined ||
    snapshot.coverage?.products !== "complete" ||
    snapshot.coverage?.productMetafieldReferences !== "complete" ||
    !Array.isArray(snapshot.products)
  ) {
    throw new Error("Input is not a complete, reference-resolved Future Light Shopify catalog snapshot.");
  }
  return {
    filename: selected.name,
    sha256: createHash("sha256").update(raw).digest("hex"),
    snapshot,
  };
}

async function atomicWriteJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

async function atomicReplaceJson(path, value) {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

function assertCompleteCategoryNode(node, expected) {
  if (!node || node.__typename !== "TaxonomyCategory" || node.id !== expected.id) {
    throw new Error(`Shopify returned an unexpected node for taxonomy category ${expected.id}.`);
  }
  if (node.name !== expected.name || node.fullName !== expected.fullName) {
    throw new Error(`Live taxonomy category identity disagrees for ${expected.id}.`);
  }
  if (typeof node.isLeaf !== "boolean" || !Array.isArray(node.attributes?.nodes)) {
    throw new Error(`Live taxonomy category ${expected.fullName} is missing required fields.`);
  }
  if (typeof node.attributes.pageInfo?.hasNextPage !== "boolean") {
    throw new Error(`Attributes for ${expected.fullName} returned incomplete pagination metadata.`);
  }
  if (node.attributes.pageInfo.hasNextPage) {
    throw new Error(`Attributes for ${expected.fullName} exceed the current page; refusing a partial snapshot.`);
  }
  for (const attribute of node.attributes.nodes) {
    if (attribute?.__typename === "TaxonomyChoiceListAttribute") {
      if (!Array.isArray(attribute.values?.nodes) || typeof attribute.values?.pageInfo?.hasNextPage !== "boolean") {
        throw new Error(`Choice values for ${expected.fullName}/${attribute.name} returned incomplete pagination metadata.`);
      }
      if (attribute.values.pageInfo.hasNextPage) {
        throw new Error(
          `Choice values for ${expected.fullName}/${attribute.name} exceed the current page; refusing a partial snapshot.`,
        );
      }
    }
  }
}

function validateCheckpoint(checkpoint, { sourceFilename, sourceSha256, apiVersion, expectedCategories }) {
  if (
    checkpoint?.schemaVersion !== 1 ||
    checkpoint.shopDomain !== expectedStore ||
    checkpoint.apiVersion !== apiVersion ||
    checkpoint.sourceCatalogSnapshot?.filename !== sourceFilename ||
    checkpoint.sourceCatalogSnapshot?.sha256 !== sourceSha256 ||
    !Array.isArray(checkpoint.expectedCategoryIds) ||
    !Array.isArray(checkpoint.categoryNodes)
  ) {
    throw new Error("Taxonomy checkpoint identity does not match this target, API version, and frozen catalog snapshot.");
  }
  const expectedIds = expectedCategories.map((category) => category.id);
  if (JSON.stringify(checkpoint.expectedCategoryIds) !== JSON.stringify(expectedIds)) {
    throw new Error("Taxonomy checkpoint category cohort differs from the frozen catalog snapshot.");
  }
  const expectedById = new Map(expectedCategories.map((category) => [category.id, category]));
  const seen = new Set();
  for (const node of checkpoint.categoryNodes) {
    const category = expectedById.get(node?.id);
    if (!category || seen.has(node.id)) {
      throw new Error("Taxonomy checkpoint contains an unknown or duplicate category.");
    }
    assertCompleteCategoryNode(node, category);
    reconcileTaxonomyCategoryAttributes({ productRecords: [{ category }], categoryNodes: [node] });
    seen.add(node.id);
  }
  return checkpoint.categoryNodes;
}

async function readCheckpoint(path, identity) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return validateCheckpoint(JSON.parse(raw), identity);
}

function checkpointPayload({ apiVersion, sourceFilename, sourceSha256, expectedCategories, categoryNodes }) {
  return {
    schemaVersion: 1,
    shopDomain: expectedStore,
    apiVersion,
    sourceCatalogSnapshot: { filename: sourceFilename, sha256: sourceSha256 },
    expectedCategoryIds: expectedCategories.map((category) => category.id),
    categoryNodes,
    updatedAt: new Date().toISOString(),
  };
}

async function main() {
  await loadFutureLightEnv({ rootDir, allowedKeys: READ_ONLY_ENV_KEYS });
  const client = createShopifyAdminGraphQLClient({ rootDir, agentName: "taxonomy-category-attributes-snapshot" });
  if (client.storeDomain !== expectedStore) {
    throw new Error(`Refused Shopify target ${client.storeDomain}; expected ${expectedStore}.`);
  }

  const identityPayload = await client.run(SHOP_IDENTITY_QUERY, {}, { operation: "verify Future Light Shopify target identity" });
  const liveShop = identityPayload.shop;
  if (liveShop?.id !== expectedShopId || liveShop?.myshopifyDomain !== expectedStore) {
    throw new Error(
      `Live Shopify target identity mismatch: received ${liveShop?.id || "<no shop ID>"} / ${liveShop?.myshopifyDomain || "<no myshopify domain>"}; expected ${expectedShopId} / ${expectedStore}.`,
    );
  }

  const { filename, sha256, snapshot: catalogSnapshot } = await readCatalogSnapshot(snapshotFileFromArgs());
  if (catalogSnapshot.apiVersion !== client.apiVersion) {
    throw new Error(
      `Frozen catalog uses Shopify API ${catalogSnapshot.apiVersion}; current read-only client uses ${client.apiVersion}.`,
    );
  }
  const assignedCategories = collectAssignedTaxonomyCategories(catalogSnapshot.products);
  if (assignedCategories.length === 0) {
    throw new Error("The frozen catalog has no assigned Shopify taxonomy categories to inspect.");
  }
  const batches = chunkTaxonomyCategoryIds(assignedCategories, batchSize);
  const checkpointPath = join(
    outputDir,
    `future-light-shopify-taxonomy-attributes-${sha256.slice(0, 12)}.checkpoint.json`,
  );
  const checkpointIdentity = {
    sourceFilename: filename,
    sourceSha256: sha256,
    apiVersion: client.apiVersion,
    expectedCategories: assignedCategories,
  };
  const categoryNodes = await readCheckpoint(checkpointPath, checkpointIdentity);
  const fetchedIds = new Set(categoryNodes.map((category) => category.id));
  log(
    `Read-only taxonomy snapshot: ${assignedCategories.length} assigned categories; ${categoryNodes.length} already checkpointed; ${catalogSnapshot.products.length} products in ${filename}.`,
  );

  for (const [index, batchIds] of batches.entries()) {
    const missingIds = batchIds.filter((id) => !fetchedIds.has(id));
    if (!missingIds.length) continue;
    const data = await client.run(
      TAXONOMY_CATEGORIES_QUERY,
      { ids: missingIds },
      { operation: `read assigned taxonomy categories ${index + 1}/${batches.length}` },
    );
    if (!Array.isArray(data.nodes) || data.nodes.length !== missingIds.length) {
      throw new Error(
        `Taxonomy batch ${index + 1}/${batches.length} returned ${data.nodes?.length ?? 0} nodes for ${missingIds.length} requested IDs.`,
      );
    }
    const expectedById = new Map(assignedCategories.map((category) => [category.id, category]));
    for (const node of data.nodes) {
      const expected = expectedById.get(node?.id);
      if (!expected || fetchedIds.has(node.id)) {
        throw new Error(`Taxonomy batch ${index + 1}/${batches.length} returned an unexpected or duplicate category.`);
      }
      assertCompleteCategoryNode(node, expected);
      reconcileTaxonomyCategoryAttributes({ productRecords: [{ category: expected }], categoryNodes: [node] });
      categoryNodes.push(node);
      fetchedIds.add(node.id);
    }
    await atomicReplaceJson(
      checkpointPath,
      checkpointPayload({
        apiVersion: client.apiVersion,
        sourceFilename: filename,
        sourceSha256: sha256,
        expectedCategories: assignedCategories,
        categoryNodes,
      }),
    );
    const completed = categoryNodes.length;
    if (completed % 10 === 0 || completed === assignedCategories.length) {
      log(`Resolved ${completed}/${assignedCategories.length} assigned taxonomy categories.`);
    }
  }

  const reconciled = reconcileTaxonomyCategoryAttributes({
    productRecords: catalogSnapshot.products,
    categoryNodes,
  });
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    readOnly: true,
    shopDomain: expectedStore,
    apiVersion: client.apiVersion,
    shop: {
      id: liveShop.id,
      name: liveShop.name,
      myshopifyDomain: liveShop.myshopifyDomain,
      primaryDomainHost: liveShop.primaryDomain?.host ?? null,
    },
    sourceCatalogSnapshot: {
      filename,
      sha256,
      createdAt: catalogSnapshot.createdAt,
      productCount: catalogSnapshot.products.length,
    },
    coverage: {
      assignedTaxonomyCategories: "complete",
      categoryAttributes: "complete",
      categoryChoiceValues: "complete",
      categoryMeasurementOptions: "complete",
    },
    counts: {
      productsWithAssignedCategory: assignedCategories.reduce((sum, category) => sum + category.productCount, 0),
      productsWithoutAssignedCategory: catalogSnapshot.products.length - assignedCategories.reduce((sum, category) => sum + category.productCount, 0),
      ...reconciled.counts,
    },
    categories: reconciled.categories,
  };
  const generatedAt = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const resultPath = join(
    outputDir,
    `future-light-shopify-taxonomy-attributes-${generatedAt}-${randomUUID().slice(0, 8)}.json`,
  );
  await atomicWriteJson(resultPath, result);
  log(
    `Complete read-only taxonomy snapshot: ${reconciled.counts.categories} categories, ${reconciled.counts.attributes} attributes, ${reconciled.counts.choiceValues} choice values. Saved ${resultPath}.`,
  );
}

main().catch((error) => {
  log(`Taxonomy attribute snapshot stopped safely: ${error?.message || error}`);
  process.exitCode = 1;
});
