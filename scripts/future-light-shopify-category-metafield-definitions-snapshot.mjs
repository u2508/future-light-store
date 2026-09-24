#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { createShopifyAdminGraphQLClient } from "./shopify-admin-graphql-client.mjs";
import { loadFutureLightEnv } from "./lib/future-light-env.mjs";
import { reconcileShopifyCategoryMetafieldDefinitions } from "./lib/shopify-category-metafield-definitions.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const outputDir = join(rootDir, "output");
const expectedStore = "vs-future-store-0jl2t-jxu6tnr3.myshopify.com";
const expectedShopId = "gid://shopify/Shop/106570088529";
const workerCount = 4;

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

const SHOP_IDENTITY_QUERY = /* GraphQL */ `
  query FutureLightCategoryMetafieldDefinitionShopIdentity {
    shop {
      id
      name
      myshopifyDomain
      primaryDomain { host }
    }
  }
`;

const CATEGORY_METAFIELD_DEFINITIONS_QUERY = /* GraphQL */ `
  query FutureLightCategoryMetafieldDefinitions($categoryValue: String!, $after: String) {
    metafieldDefinitions(
      first: 250
      after: $after
      ownerType: PRODUCT
      constraintSubtype: { key: "category", value: $categoryValue }
      constraintStatus: CONSTRAINED_ONLY
    ) {
      edges {
        node {
          id
          name
          namespace
          key
          ownerType
          type { name }
          validations { name value }
          constraints { key }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

function log(message) {
  process.stdout.write(`[${new Date().toISOString()}] ${message}\n`);
}

function selectedSnapshotNameFromArgs() {
  const args = process.argv.slice(2);
  if (!args.length) return null;
  if (args.length !== 2 || args[0] !== "--taxonomy-snapshot") {
    throw new Error("Usage: npm run shopify:category-metafields:snapshot [-- --taxonomy-snapshot output-file.json]");
  }
  const filename = basename(args[1]);
  if (
    filename !== args[1] ||
    !filename.startsWith("future-light-shopify-taxonomy-attributes-") ||
    filename.endsWith(".checkpoint.json") ||
    !filename.endsWith(".json")
  ) {
    throw new Error("--taxonomy-snapshot must be a final taxonomy-attribute snapshot filename inside output/.");
  }
  return filename;
}

async function findLatestTaxonomySnapshot() {
  const names = (await readdir(outputDir)).filter(
    (name) =>
      name.startsWith("future-light-shopify-taxonomy-attributes-") &&
      name.endsWith(".json") &&
      !name.endsWith(".checkpoint.json"),
  );
  const candidates = await Promise.all(names.map(async (name) => {
    try {
      const snapshot = JSON.parse(await readFile(join(outputDir, name), "utf8"));
      if (snapshot.schemaVersion !== 1 || snapshot.readOnly !== true || snapshot.shopDomain !== expectedStore) return null;
      return { name, createdAt: snapshot.generatedAt };
    } catch {
      return null;
    }
  }));
  const valid = candidates.filter(Boolean).sort((left, right) =>
    String(right.createdAt).localeCompare(String(left.createdAt)),
  );
  if (!valid.length) throw new Error("No complete Future Light taxonomy-attribute snapshot exists in output/.");
  return valid[0].name;
}

async function readTaxonomySnapshot(filename) {
  const selectedName = filename || await findLatestTaxonomySnapshot();
  const raw = await readFile(join(outputDir, selectedName), "utf8");
  const snapshot = JSON.parse(raw);
  const requiredCoverage = [
    "assignedTaxonomyCategories",
    "categoryAttributes",
    "categoryChoiceValues",
    "categoryMeasurementOptions",
  ];
  if (
    snapshot.schemaVersion !== 1 ||
    snapshot.readOnly !== true ||
    snapshot.shopDomain !== expectedStore ||
    typeof snapshot.apiVersion !== "string" ||
    !Array.isArray(snapshot.categories) ||
    requiredCoverage.some((key) => snapshot.coverage?.[key] !== "complete") ||
    typeof snapshot.sourceCatalogSnapshot?.filename !== "string" ||
    !/^[a-f0-9]{64}$/.test(snapshot.sourceCatalogSnapshot?.sha256 || "")
  ) {
    throw new Error("Input is not a complete, read-only Future Light taxonomy-attribute snapshot.");
  }
  const sourceName = basename(snapshot.sourceCatalogSnapshot.filename);
  if (
    sourceName !== snapshot.sourceCatalogSnapshot.filename ||
    !sourceName.startsWith("future-light-shopify-catalog-snapshot-") ||
    !sourceName.endsWith(".json")
  ) {
    throw new Error("Taxonomy snapshot references an unsafe catalog input path.");
  }
  const sourceRaw = await readFile(join(outputDir, sourceName), "utf8");
  const sourceSha256 = createHash("sha256").update(sourceRaw).digest("hex");
  if (sourceSha256 !== snapshot.sourceCatalogSnapshot.sha256) {
    throw new Error("The frozen catalog snapshot no longer matches the taxonomy snapshot source digest.");
  }
  const sourceCatalog = JSON.parse(sourceRaw);
  if (
    sourceCatalog.shopDomain !== expectedStore ||
    sourceCatalog.apiVersion !== snapshot.apiVersion ||
    sourceCatalog.products?.length !== snapshot.sourceCatalogSnapshot.productCount
  ) {
    throw new Error("The frozen catalog snapshot identity differs from the taxonomy snapshot.");
  }
  const taxonomySha256 = createHash("sha256").update(raw).digest("hex");
  return { filename: selectedName, taxonomySha256, snapshot, sourceSha256, sourceCatalog };
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

function checkpointIdentity({ taxonomyFilename, taxonomySha256, apiVersion, categoryIds }) {
  return {
    schemaVersion: 1,
    shopDomain: expectedStore,
    apiVersion,
    sourceTaxonomySnapshot: { filename: taxonomyFilename, sha256: taxonomySha256 },
    categoryIds,
  };
}

function validateCheckpoint(checkpoint, identity, expectedCategories) {
  if (
    checkpoint?.schemaVersion !== identity.schemaVersion ||
    checkpoint.shopDomain !== identity.shopDomain ||
    checkpoint.apiVersion !== identity.apiVersion ||
    checkpoint.sourceTaxonomySnapshot?.filename !== identity.sourceTaxonomySnapshot.filename ||
    checkpoint.sourceTaxonomySnapshot?.sha256 !== identity.sourceTaxonomySnapshot.sha256 ||
    JSON.stringify(checkpoint.categoryIds) !== JSON.stringify(identity.categoryIds) ||
    !checkpoint.categoryDefinitions ||
    typeof checkpoint.categoryDefinitions !== "object" ||
    Array.isArray(checkpoint.categoryDefinitions)
  ) {
    throw new Error("Category definition checkpoint does not match the target, API, taxonomy snapshot, and category cohort.");
  }
  const categoriesById = new Map(expectedCategories.map((category) => [category.id, category]));
  for (const [categoryId, entry] of Object.entries(checkpoint.categoryDefinitions)) {
    const category = categoriesById.get(categoryId);
    if (!category || entry?.categoryId !== categoryId) {
      throw new Error(`Category definition checkpoint contains an unexpected category ${categoryId}.`);
    }
    reconcileShopifyCategoryMetafieldDefinitions({
      productRecords: [{ category }],
      definitionsByCategory: [entry],
    });
  }
  return checkpoint.categoryDefinitions;
}

async function readCheckpoint(path, identity, expectedCategories) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
  return validateCheckpoint(JSON.parse(raw), identity, expectedCategories);
}

async function readDefinitionsForCategory(client, categoryId) {
  const definitions = [];
  const seenIds = new Set();
  let after = null;
  let hasNextPage = true;
  let pageCount = 0;
  while (hasNextPage) {
    const data = await client.run(
      CATEGORY_METAFIELD_DEFINITIONS_QUERY,
      { categoryValue: categoryId, after },
      { operation: `read category-constrained product metafield definitions for ${categoryId} page ${pageCount + 1}` },
    );
    const connection = data.metafieldDefinitions;
    if (!Array.isArray(connection?.edges) || typeof connection?.pageInfo?.hasNextPage !== "boolean") {
      throw new Error(`Shopify returned incomplete category-metafield pagination for ${categoryId}.`);
    }
    for (const edge of connection.edges) {
      const definition = edge?.node;
      if (!definition?.id || seenIds.has(definition.id)) {
        throw new Error(`Shopify returned a missing or duplicate category metafield definition for ${categoryId}.`);
      }
      seenIds.add(definition.id);
      definitions.push(definition);
    }
    pageCount += 1;
    hasNextPage = connection.pageInfo.hasNextPage;
    if (hasNextPage) {
      const nextCursor = connection.pageInfo.endCursor;
      if (typeof nextCursor !== "string" || !nextCursor || nextCursor === after) {
        throw new Error(`Shopify returned an invalid category-metafield cursor for ${categoryId}.`);
      }
      after = nextCursor;
    }
  }
  return { categoryId, definitions, hasNextPage: false, pageCount };
}

async function main() {
  await loadFutureLightEnv({ rootDir, allowedKeys: READ_ONLY_ENV_KEYS });
  const client = createShopifyAdminGraphQLClient({ rootDir, agentName: "category-metafield-definitions-snapshot" });
  if (client.storeDomain !== expectedStore) {
    throw new Error(`Refused Shopify target ${client.storeDomain}; expected ${expectedStore}.`);
  }
  const identity = await client.run(SHOP_IDENTITY_QUERY, {}, { operation: "verify Future Light category-definition target" });
  const liveShop = identity.shop;
  if (liveShop?.id !== expectedShopId || liveShop?.myshopifyDomain !== expectedStore) {
    throw new Error("Live Shopify target identity mismatch; refusing category-metafield reads.");
  }

  const input = await readTaxonomySnapshot(selectedSnapshotNameFromArgs());
  if (input.snapshot.apiVersion !== client.apiVersion) {
    throw new Error(`Taxonomy snapshot uses API ${input.snapshot.apiVersion}; current client uses ${client.apiVersion}.`);
  }
  const expectedCategories = input.snapshot.categories;
  const expectedCategoryIds = expectedCategories.map((category) => category.id);
  if (new Set(expectedCategoryIds).size !== expectedCategoryIds.length) {
    throw new Error("Taxonomy snapshot contains duplicate category IDs.");
  }
  const productRecords = input.sourceCatalog.products;
  const reconciledTaxonomy = new Set(expectedCategoryIds);
  const productCategoryIds = new Set(productRecords.map((product) => product?.category?.id).filter(Boolean));
  if (
    productCategoryIds.size !== reconciledTaxonomy.size ||
    [...productCategoryIds].some((id) => !reconciledTaxonomy.has(id))
  ) {
    throw new Error("Taxonomy dictionary category IDs do not exactly cover the source product snapshot.");
  }

  const identityRecord = checkpointIdentity({
    taxonomyFilename: input.filename,
    taxonomySha256: input.taxonomySha256,
    apiVersion: client.apiVersion,
    categoryIds: expectedCategoryIds,
  });
  const checkpointPath = join(
    outputDir,
    `future-light-shopify-category-metafield-definitions-${input.taxonomySha256.slice(0, 12)}.checkpoint.json`,
  );
  const categoryDefinitions = await readCheckpoint(checkpointPath, identityRecord, expectedCategories);
  const completedIds = new Set(Object.keys(categoryDefinitions));
  const pending = expectedCategories.filter((category) => !completedIds.has(category.id));
  log(
    `Read-only constrained metafield-definition snapshot: ${expectedCategories.length} categories; ${completedIds.size} checkpointed; ${pending.length} remaining.`,
  );

  let nextIndex = 0;
  let failed = null;
  let persistChain = Promise.resolve();
  const persist = () => {
    const snapshot = {
      ...identityRecord,
      categoryDefinitions: structuredClone(categoryDefinitions),
      updatedAt: new Date().toISOString(),
    };
    persistChain = persistChain.then(() => atomicReplaceJson(checkpointPath, snapshot));
    return persistChain;
  };
  const worker = async () => {
    while (!failed) {
      const index = nextIndex++;
      if (index >= pending.length) return;
      const category = pending[index];
      try {
        const entry = await readDefinitionsForCategory(client, category.id);
        reconcileShopifyCategoryMetafieldDefinitions({
          productRecords: [{ category }],
          definitionsByCategory: [entry],
        });
        categoryDefinitions[category.id] = entry;
        await persist();
        const resolved = Object.keys(categoryDefinitions).length;
        if (resolved % 10 === 0 || resolved === expectedCategories.length) {
          log(`Resolved Shopify product metafield definitions for ${resolved}/${expectedCategories.length} categories.`);
        }
      } catch (error) {
        failed ||= error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(workerCount, Math.max(1, pending.length)) }, worker));
  await persistChain;
  if (failed) throw failed;

  const definitionsByCategory = expectedCategories.map((category) => categoryDefinitions[category.id]);
  const reconciled = reconcileShopifyCategoryMetafieldDefinitions({ productRecords, definitionsByCategory });
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
    queryScope: {
      ownerType: "PRODUCT",
      constraintSubtype: { key: "category" },
      constraintStatus: "CONSTRAINED_ONLY",
    },
    sourceTaxonomySnapshot: {
      filename: input.filename,
      sha256: input.taxonomySha256,
    },
    sourceCatalogSnapshot: {
      filename: input.snapshot.sourceCatalogSnapshot.filename,
      sha256: input.sourceSha256,
      productCount: productRecords.length,
    },
    coverage: {
      assignedCategories: "complete",
      constrainedProductMetafieldDefinitions: "complete",
      definitionValidations: "complete",
      definitionPagination: "complete",
    },
    counts: reconciled.counts,
    categories: reconciled.categories,
  };
  const createdAt = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const resultPath = join(
    outputDir,
    `future-light-shopify-category-metafield-definitions-${createdAt}-${randomUUID().slice(0, 8)}.json`,
  );
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  log(
    `Complete read-only category-metafield snapshot: ${reconciled.counts.categoryDefinitionAssignments} category assignments, ${reconciled.counts.uniqueDefinitions} unique definitions, ${reconciled.counts.validationRules} validations. Saved ${resultPath}.`,
  );
}

main().catch((error) => {
  log(`Category-metafield definition snapshot stopped safely: ${error?.message || error}`);
  process.exitCode = 1;
});
