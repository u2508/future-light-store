#!/usr/bin/env node

import { hostname } from "node:os";
import { open, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { createShopifyAdminGraphQLClient } from "./shopify-admin-graphql-client.mjs";
import { loadFutureLightEnv } from "./lib/future-light-env.mjs";
import {
  parseShopifyBulkJsonl,
  reconcileShopifyBulkCatalog,
} from "./lib/shopify-catalog-bulk-transform.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const outputDir = join(rootDir, "output");
const checkpointPath = join(outputDir, "future-light-shopify-catalog-snapshot-v2.active.json");
const lockPath = join(outputDir, "future-light-shopify-catalog-snapshot.lock");
const checkpointVersion = 2;
const expectedStore = "vs-future-store-0jl2t-jxu6tnr3.myshopify.com";
const operationNames = ["catalog", "variantMedia", "publications", "metafieldReferences"];
const activeStatuses = new Set(["CREATED", "RUNNING", "CANCELING"]);
const terminalFailures = new Set(["CANCELED", "FAILED", "EXPIRED"]);

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

const CATALOG_QUERY = /* GraphQL */ `
  {
    products {
      edges {
        node {
          __typename
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
          category {
            id
            name
            fullName
          }
          seo {
            title
            description
          }
          variants {
            edges {
              node {
                __typename
                id
                legacyResourceId
                title
                sku
                selectedOptions {
                  name
                  value
                }
                price
                compareAtPrice
                inventoryQuantity
              }
            }
          }
          media {
            edges {
              node {
                __typename
                id
                alt
                mediaContentType
                status
                preview {
                  image {
                    url
                    altText
                    width
                    height
                  }
                }
                ... on MediaImage {
                  image {
                    url
                    altText
                    width
                    height
                  }
                }
              }
            }
          }
          metafields {
            edges {
              node {
                __typename
                id
                namespace
                key
                type
                value
                reference {
                  __typename
                  ... on Metaobject {
                    id
                    type
                    handle
                    displayName
                  }
                  ... on TaxonomyValue {
                    id
                    name
                  }
                }
              }
            }
          }
          collections {
            edges {
              node {
                __typename
                id
                handle
                title
              }
            }
          }
        }
      }
    }
  }
`;

// Keep list-reference expansion in its own bulk query so each operation stays
// below Shopify's five-connection query limit. This export must reconcile to the
// exact product/metafield IDs and values in CATALOG_QUERY before the snapshot is
// accepted.
const METAFIELD_REFERENCES_QUERY = /* GraphQL */ `
  {
    products {
      edges {
        node {
          __typename
          id
          metafields {
            edges {
              node {
                __typename
                id
                namespace
                key
                type
                value
                reference {
                  __typename
                  ... on Metaobject {
                    id
                    type
                    handle
                    displayName
                  }
                  ... on TaxonomyValue {
                    id
                    name
                  }
                }
                references(first: 100) {
                  edges {
                    node {
                      __typename
                      ... on Metaobject {
                        id
                        type
                        handle
                        displayName
                      }
                      ... on TaxonomyValue {
                        id
                        name
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
  }
`;

const VARIANT_MEDIA_QUERY = /* GraphQL */ `
  {
    productVariants {
      edges {
        node {
          __typename
          id
          product {
            id
          }
          media {
            edges {
              node {
                __typename
                id
                alt
                mediaContentType
              }
            }
          }
        }
      }
    }
  }
`;

const PUBLICATION_QUERY = /* GraphQL */ `
  {
    products {
      edges {
        node {
          __typename
          id
          resourcePublications(onlyPublished: false) {
            edges {
              node {
                __typename
                isPublished
                publication {
                  id
                  name
                }
              }
            }
          }
        }
      }
    }
  }
`;

const BULK_START_MUTATION = /* GraphQL */ `
  mutation StartFutureLightReadOnlyCatalogExport($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation {
        id
        status
        type
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const BULK_STATUS_QUERY = /* GraphQL */ `
  query FutureLightReadOnlyBulkStatus($id: ID!) {
    node(id: $id) {
      ... on BulkOperation {
        id
        status
        errorCode
        objectCount
        rootObjectCount
        url
        partialDataUrl
      }
    }
  }
`;

const ACTIVE_BULK_OPERATIONS_QUERY = /* GraphQL */ `
  query FutureLightExistingBulkQueries {
    bulkOperations(first: 20, reverse: true) {
      nodes {
        id
        status
        type
        createdAt
      }
    }
  }
`;

const OPERATION_QUERIES = Object.freeze({
  catalog: CATALOG_QUERY,
  variantMedia: VARIANT_MEDIA_QUERY,
  publications: PUBLICATION_QUERY,
  metafieldReferences: METAFIELD_REFERENCES_QUERY,
});

let interrupted = false;
let stopPolling = false;
let lockHandle;

function log(message) {
  process.stdout.write(`[${new Date().toISOString()}] ${message}\n`);
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function isTransientNetworkError(error) {
  return /429|rate.?limit|throttl|timeout|timed out|5\d\d|service unavailable|bad gateway|gateway timeout|upstream|network|socket|temporar|aborted|enotfound|eai_again|getaddrinfo|dns/i.test(
    String(error?.message || error),
  );
}

function assertNotInterrupted() {
  if (interrupted) {
    const error = new Error(
      "Interrupted by user; resumable Shopify bulk-operation checkpoint retained.",
    );
    error.code = "USER_INTERRUPTED";
    throw error;
  }
  if (stopPolling) {
    const error = new Error(
      "A sibling Shopify export failed; other polling stopped and the checkpoint was retained.",
    );
    error.code = "SIBLING_OPERATION_FAILED";
    throw error;
  }
}

async function atomicWriteJson(path, value) {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  await rename(temporaryPath, path);
}

async function readCheckpoint() {
  try {
    const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
    if (
      checkpoint.version !== checkpointVersion ||
      checkpoint.storeDomain !== expectedStore ||
      operationNames.some(
        (name) => checkpoint.operations?.[name]?.queryHash !== queryHash(OPERATION_QUERIES[name]),
      )
    ) {
      throw new Error(
        "Existing Shopify snapshot checkpoint is incompatible; refusing to alter or replace it.",
      );
    }
    return checkpoint;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function queryHash(query) {
  // A deterministic, non-cryptographic fingerprint is sufficient to detect local query drift.
  let hash = 2166136261;
  for (const char of query.replace(/\s+/g, " ").trim())
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function acquireLock() {
  await mkdir(outputDir, { recursive: true });
  try {
    lockHandle = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    let lock;
    try {
      lock = JSON.parse(await readFile(lockPath, "utf8"));
    } catch {
      throw new Error(
        "A snapshot lock already exists and cannot be safely inspected; no export started.",
      );
    }
    if (lock.host !== hostname() || !Number.isSafeInteger(lock.pid)) {
      throw new Error(
        `A catalog snapshot lock exists for host ${lock.host || "unknown"}; no export started.`,
      );
    }
    try {
      process.kill(lock.pid, 0);
      throw new Error(
        `A catalog snapshot is already running as PID ${lock.pid}; no second export started.`,
      );
    } catch (probeError) {
      if (probeError?.code !== "ESRCH") throw probeError;
    }
    await import("node:fs/promises").then(({ unlink }) => unlink(lockPath));
    lockHandle = await open(lockPath, "wx", 0o600);
  }
  await lockHandle.writeFile(
    `${JSON.stringify({ pid: process.pid, host: hostname(), startedAt: new Date().toISOString() })}\n`,
  );
}

async function releaseLock() {
  if (lockHandle) {
    await lockHandle.close();
    lockHandle = null;
    try {
      const currentLock = JSON.parse(await readFile(lockPath, "utf8"));
      if (currentLock.pid === process.pid && currentLock.host === hostname()) {
        const { unlink } = await import("node:fs/promises");
        await unlink(lockPath);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

async function inspectActiveBulkOperations(client) {
  const data = await client.run(
    ACTIVE_BULK_OPERATIONS_QUERY,
    {},
    { operation: "inspect active Shopify bulk queries" },
  );
  return data?.bulkOperations?.nodes || [];
}

function operationUserErrors(payload) {
  return Array.isArray(payload?.userErrors) ? payload.userErrors : [];
}

async function startMissingOperations(client, checkpoint) {
  const active = await inspectActiveBulkOperations(client);
  const checkpointIds = new Set(
    operationNames.map((name) => checkpoint.operations[name].id).filter(Boolean),
  );
  const untracked = active.filter(
    (operation) =>
      operation.type === "QUERY" &&
      activeStatuses.has(operation.status) &&
      !checkpointIds.has(operation.id),
  );
  if (untracked.length) {
    const summary = untracked.map(({ id, status }) => `${id} (${status})`).join(", ");
    throw new Error(
      `Untracked Shopify bulk query is already active: ${summary}. It was left untouched; reconcile it before resuming.`,
    );
  }

  for (const name of operationNames) {
    assertNotInterrupted();
    if (checkpoint.operations[name].id) continue;
    const data = await client.run(
      BULK_START_MUTATION,
      { query: OPERATION_QUERIES[name] },
      { allowMutations: true, operation: `start read-only ${name} catalog export` },
    );
    const payload = data?.bulkOperationRunQuery;
    const userErrors = operationUserErrors(payload);
    if (userErrors.length) {
      throw new Error(
        `Shopify refused the ${name} read-only bulk export: ${userErrors.map((entry) => entry.message).join(" | ")}`,
      );
    }
    const operation = payload?.bulkOperation;
    if (!operation?.id || !activeStatuses.has(operation.status)) {
      throw new Error(
        `Shopify did not confirm a running ${name} bulk export; checkpoint preserved.`,
      );
    }
    checkpoint.operations[name] = {
      ...checkpoint.operations[name],
      id: operation.id,
      status: operation.status,
      startedAt: new Date().toISOString(),
    };
    await atomicWriteJson(checkpointPath, checkpoint);
    log(`Started read-only ${name} export (${operation.id}).`);
  }
}

async function readOperationStatus(client, id) {
  const data = await client.run(
    BULK_STATUS_QUERY,
    { id },
    { operation: "read Shopify bulk operation status" },
  );
  const operation = data?.node;
  if (!operation?.id)
    throw new Error(`Shopify bulk operation ${id} is no longer available; checkpoint retained.`);
  return operation;
}

async function pollOperation(client, checkpoint, name) {
  let delayMs = 1500;
  let lastLoggedStatus = "";
  while (true) {
    assertNotInterrupted();
    const tracked = checkpoint.operations[name];
    if (tracked.localJsonl && tracked.status === "COMPLETED") {
      return tracked;
    }
    let operation;
    try {
      operation = await readOperationStatus(client, tracked.id);
    } catch (error) {
      if (!isTransientNetworkError(error)) throw error;
      delayMs = Math.min(60_000, Math.max(2_000, delayMs * 2));
      log(
        `Network/API temporarily unavailable while checking ${name}; retrying in ${Math.ceil(delayMs / 1000)}s.`,
      );
      await sleep(delayMs);
      continue;
    }
    tracked.status = operation.status;
    tracked.objectCount = operation.objectCount;
    tracked.rootObjectCount = operation.rootObjectCount;
    tracked.errorCode = operation.errorCode;
    await atomicWriteJson(checkpointPath, checkpoint);
    if (terminalFailures.has(operation.status)) {
      throw new Error(
        `${name} Shopify bulk export ended ${operation.status}${operation.errorCode ? ` (${operation.errorCode})` : ""}; checkpoint retained for diagnosis.`,
      );
    }
    if (operation.status === "COMPLETED") {
      if (!operation.url)
        throw new Error(`Completed ${name} export returned no result URL; checkpoint retained.`);
      if (lastLoggedStatus !== operation.status)
        log(
          `${name} export completed: ${operation.objectCount} records (${operation.rootObjectCount} roots).`,
        );
      const jsonl = await downloadResult(operation.url, name);
      const operationDir = join(outputDir, `future-light-shopify-catalog-${checkpoint.runId}`);
      await mkdir(operationDir, { recursive: true });
      const filename = `${name}.jsonl`;
      const finalPath = join(operationDir, filename);
      const partPath = join(operationDir, `${filename}.${process.pid}.${randomUUID()}.part`);
      await writeFile(partPath, jsonl, { encoding: "utf8", flag: "wx" });
      await rename(partPath, finalPath);
      const lineCount = parseShopifyBulkJsonl(jsonl, `${name} Shopify export`).length;
      if (Number(operation.objectCount) !== lineCount) {
        throw new Error(
          `${name} JSONL object count mismatch: Shopify reported ${operation.objectCount}, downloaded ${lineCount}.`,
        );
      }
      tracked.status = "COMPLETED";
      tracked.localJsonl = basename(finalPath);
      tracked.lineCount = lineCount;
      await atomicWriteJson(checkpointPath, checkpoint);
      return tracked;
    }
    if (!activeStatuses.has(operation.status)) {
      throw new Error(
        `Unexpected ${name} Shopify bulk status ${operation.status}; checkpoint retained.`,
      );
    }
    if (operation.status !== lastLoggedStatus) {
      log(`${name} export ${operation.status}: ${operation.objectCount || "0"} records so far.`);
      lastLoggedStatus = operation.status;
    }
    delayMs = 5000;
    await sleep(delayMs);
  }
}

async function downloadResult(url, name) {
  let delayMs = 2000;
  while (true) {
    assertNotInterrupted();
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (response.ok) return await response.text();
      if (response.status < 500 && response.status !== 429) {
        throw new Error(
          `${name} Shopify export download returned HTTP ${response.status}; checkpoint retained.`,
        );
      }
      throw new Error(`Temporary HTTP ${response.status} downloading ${name} Shopify export.`);
    } catch (error) {
      if (!isTransientNetworkError(error) || error?.message?.includes("checkpoint retained"))
        throw error;
      log(
        `Network/API temporarily unavailable while downloading ${name}; retrying in ${Math.ceil(delayMs / 1000)}s.`,
      );
      await sleep(delayMs);
      delayMs = Math.min(60_000, delayMs * 2);
    }
  }
}

async function loadOrCreateCheckpoint(client) {
  const existing = await readCheckpoint();
  if (existing) {
    log(`Resuming catalog snapshot ${existing.runId}.`);
    return existing;
  }
  const active = await inspectActiveBulkOperations(client);
  const activeQueries = active.filter(
    (operation) => operation.type === "QUERY" && activeStatuses.has(operation.status),
  );
  if (activeQueries.length) {
    throw new Error(
      `An unrelated Shopify bulk query is active (${activeQueries.map(({ id, status }) => `${id} ${status}`).join(", ")}); left untouched.`,
    );
  }
  const checkpoint = {
    version: checkpointVersion,
    runId: new Date().toISOString().replace(/[:.]/g, "-") + `-${randomUUID().slice(0, 8)}`,
    storeDomain: expectedStore,
    apiVersion: client.apiVersion,
    createdAt: new Date().toISOString(),
    queries: Object.fromEntries(
      operationNames.map((name) => [name, queryHash(OPERATION_QUERIES[name])]),
    ),
    operations: Object.fromEntries(
      operationNames.map((name) => [
        name,
        { queryHash: queryHash(OPERATION_QUERIES[name]), id: null, status: "NOT_STARTED" },
      ]),
    ),
  };
  await atomicWriteJson(checkpointPath, checkpoint);
  log(`Created resumable read-only snapshot checkpoint ${checkpoint.runId}.`);
  return checkpoint;
}

async function readJsonlFor(checkpoint, operationName) {
  const filename = checkpoint.operations[operationName]?.localJsonl;
  if (
    !filename ||
    basename(filename) !== filename ||
    !filename.startsWith(`${operationName}.jsonl`)
  ) {
    throw new Error(`Checkpoint is missing a safe local JSONL file for ${operationName}.`);
  }
  const path = join(outputDir, `future-light-shopify-catalog-${checkpoint.runId}`, filename);
  const file = await readFile(path, "utf8");
  const parsed = parseShopifyBulkJsonl(file, `${operationName} Shopify export`);
  if (parsed.length !== checkpoint.operations[operationName].lineCount) {
    throw new Error(`Saved ${operationName} JSONL no longer matches its recorded line count.`);
  }
  return parsed;
}

async function writeSnapshot(client, checkpoint) {
  const [catalogRecords, variantMediaRecords, publicationRecords, metafieldReferenceRecords] = await Promise.all(
    operationNames.map((name) => readJsonlFor(checkpoint, name)),
  );
  const products = reconcileShopifyBulkCatalog({
    catalogRecords,
    variantMediaRecords,
    publicationRecords,
    metafieldReferenceRecords,
    expectedOperationCounts: {
      catalogRootObjectCount: checkpoint.operations.catalog.rootObjectCount,
      variantMediaRootObjectCount: checkpoint.operations.variantMedia.rootObjectCount,
      publicationRootObjectCount: checkpoint.operations.publications.rootObjectCount,
      metafieldReferenceRootObjectCount: checkpoint.operations.metafieldReferences.rootObjectCount,
    },
  });
  const filename = `future-light-shopify-catalog-snapshot-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.json`;
  const path = join(outputDir, filename);
  const snapshot = {
    schemaVersion: 2,
    createdAt: new Date().toISOString(),
    shopDomain: expectedStore,
    apiVersion: client.apiVersion,
    source: "shopify-admin-graphql-completed-bulk-query",
    scope: "all Shopify product statuses",
    coverage: {
      products: "complete",
      productVariants: "complete",
      productMedia: "complete",
      variantMediaAssociations: "complete",
      productMetafields: "complete",
      productMetafieldReferences: "complete",
      productMetafieldReferences: "complete",
      collectionMemberships: "complete",
      resourcePublications: "complete",
    },
    operationIds: Object.fromEntries(
      operationNames.map((name) => [name, checkpoint.operations[name].id]),
    ),
    counts: products.counts,
    products: products.products,
  };
  await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  const details = await stat(path);
  if (
    details.size < 2 ||
    snapshot.products.length !== Number(checkpoint.operations.catalog.rootObjectCount)
  ) {
    throw new Error(
      "Final Shopify snapshot failed post-write count validation; checkpoint retained.",
    );
  }
  log(
    `Saved complete Shopify snapshot: ${filename}; ${snapshot.counts.products} products, ${snapshot.counts.variants} variants, ${snapshot.counts.productMedia} media, ${snapshot.counts.productMetafields} product metafields.`,
  );
  await import("node:fs/promises").then(({ unlink }) => unlink(checkpointPath));
}

async function main() {
  await loadFutureLightEnv({ rootDir, allowedKeys: READ_ONLY_ENV_KEYS });
  await acquireLock();
  try {
    const client = createShopifyAdminGraphQLClient({ rootDir, agentName: "bulk-catalog-snapshot" });
    if (client.storeDomain !== expectedStore) {
      throw new Error(`Refused Shopify target ${client.storeDomain}; expected ${expectedStore}.`);
    }
    const checkpoint = await loadOrCreateCheckpoint(client);
    await startMissingOperations(client, checkpoint);
    await Promise.all(
      operationNames.map(async (name) => {
        try {
          return await pollOperation(client, checkpoint, name);
        } catch (error) {
          stopPolling = true;
          throw error;
        }
      }),
    );
    assertNotInterrupted();
    await writeSnapshot(client, checkpoint);
  } finally {
    await releaseLock();
  }
}

process.once("SIGINT", () => {
  interrupted = true;
  log("Stop requested; finishing the current API call and keeping the resume checkpoint.");
});

main().catch((error) => {
  if (error?.code === "USER_INTERRUPTED") process.exitCode = 130;
  else {
    log(`Snapshot stopped safely: ${error?.message || error}`);
    process.exitCode = 1;
  }
});
