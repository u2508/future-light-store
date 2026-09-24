#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { isActiveShopifyProduct } from "../src/lib/catalog-taxonomy-release.js";
import { asArray, createShopifyAdminGraphQLClient, normalizeText } from "./shopify-admin-graphql-client.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const defaultOutputPath = resolve(rootDir, "output", "shopify-low-stock-product-delete-manifest.json");
const approvalPath = resolve(rootDir, "docs", "catalog-low-stock-removal-approval.json");
const activeProductQuery = "status:active";
const defaultThreshold = 200;
// Keep the nested product + variant response below Shopify CLI's intermittent
// internal-error threshold. The live scope is unchanged; this only controls
// pagination and improves resumability of the audit.
const pageSize = Math.max(1, Math.min(250, Number(process.env.FUTURE_LIGHT_LOW_STOCK_PAGE_SIZE || 100)));
const deleteConcurrency = Math.max(1, Math.min(4, Number(process.env.FUTURE_LIGHT_LOW_STOCK_DELETE_CONCURRENCY || 2)));
const verifyConcurrency = Math.max(1, Math.min(8, Number(process.env.FUTURE_LIGHT_LOW_STOCK_VERIFY_CONCURRENCY || 4)));
const variantInventoryFetchConcurrency = Math.max(1, Math.min(4, Number(process.env.FUTURE_LIGHT_LOW_STOCK_VARIANT_FETCH_CONCURRENCY || 2)));
const deletePollDelayMs = Math.max(250, Number(process.env.FUTURE_LIGHT_LOW_STOCK_DELETE_POLL_DELAY_MS || 1500));
const deletePollAttempts = Math.max(1, Number(process.env.FUTURE_LIGHT_LOW_STOCK_DELETE_POLL_ATTEMPTS || 240));
const client = createShopifyAdminGraphQLClient({ rootDir, agentName: "low-stock-product-delete" });

const PRODUCT_SELECTION = /* GraphQL */ `
  id
  legacyResourceId
  handle
  title
  status
  totalInventory
  variants(first: 250) {
    nodes {
      id
      legacyResourceId
      title
      inventoryQuantity
      inventoryItem { tracked }
    }
    pageInfo { hasNextPage endCursor }
  }
`;

const ACTIVE_PRODUCTS_QUERY = /* GraphQL */ `
  query LowStockActiveProducts($first: Int!, $after: String, $query: String!) {
    products(first: $first, after: $after, query: $query) {
      nodes { ${PRODUCT_SELECTION} }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const PRODUCT_BY_ID_QUERY = /* GraphQL */ `
  query LowStockProductById($id: ID!) {
    node(id: $id) {
      ... on Product { ${PRODUCT_SELECTION} }
    }
  }
`;

const PRODUCT_DELETE_MUTATION = /* GraphQL */ `
  mutation LowStockProductDelete($input: ProductDeleteInput!, $synchronous: Boolean!) {
    productDelete(input: $input, synchronous: $synchronous) {
      deletedProductId
      productDeleteOperation { id status deletedProductId }
      userErrors { field message }
    }
  }
`;

const PRODUCT_OPERATION_QUERY = /* GraphQL */ `
  query LowStockProductDeleteOperation($id: ID!) {
    productOperation(id: $id) {
      ... on ProductDeleteOperation {
        id
        status
        deletedProductId
        userErrors { field message }
      }
    }
  }
`;

const PRODUCT_VARIANTS_QUERY = /* GraphQL */ `
  query LowStockProductVariants($id: ID!, $first: Int!, $after: String) {
    node(id: $id) {
      ... on Product {
        variants(first: $first, after: $after) {
          nodes {
            id
            legacyResourceId
            title
            inventoryQuantity
            inventoryItem { tracked }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
`;

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function parseArgs(argv) {
  const args = {
    mode: "dry-run",
    output: defaultOutputPath,
    threshold: Number(process.env.FUTURE_LIGHT_LOW_STOCK_THRESHOLD || defaultThreshold),
    productHandlesFile: "",
  };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--apply") {
      args.mode = "apply";
      continue;
    }
    if (token === "--dry-run") {
      args.mode = "dry-run";
      continue;
    }
    if (token === "--verify") {
      args.mode = "verify";
      continue;
    }
    if (token === "--output") {
      args.output = resolve(rootDir, argv[index + 1] || args.output);
      index += 1;
      continue;
    }
    if (token === "--threshold") {
      args.threshold = Number(argv[index + 1] || args.threshold);
      index += 1;
      continue;
    }
    if (token === "--product-handles-file") {
      args.productHandlesFile = resolve(rootDir, argv[index + 1] || "");
      index += 1;
    }
  }
  if (!Number.isInteger(args.threshold) || args.threshold < 1 || args.threshold > 1_000_000) {
    throw new Error(`Low-stock threshold must be an integer from 1 to 1000000; received ${args.threshold}.`);
  }
  return args;
}

async function readProductHandles(filePath) {
  if (!filePath) return null;
  const parsed = JSON.parse(await readFile(filePath, "utf8"));
  const handles = Array.isArray(parsed) ? parsed : parsed?.handles;
  if (!Array.isArray(handles) || !handles.length) {
    throw new Error(`Product handles file contains no handles: ${filePath}`);
  }
  return new Set(handles.map((handle) => normalizeText(handle).toLowerCase()).filter(Boolean));
}

function formatUserErrors(errors) {
  return asArray(errors)
    .map((entry) => `${asArray(entry?.field).join(".")} ${normalizeText(entry?.message || "Shopify user error")}`.trim())
    .filter(Boolean)
    .join("; ");
}

function inventoryAssessment(product, threshold) {
  const totalInventory = Number(product?.totalInventory);
  const variants = asArray(product?.variants?.nodes);
  if (!Number.isFinite(totalInventory)) {
    return { eligible: false, reason: "inventory-unavailable", totalInventory: null, variantInventoryTotal: null };
  }
  if (product?.variants?.pageInfo?.hasNextPage) {
    return { eligible: false, reason: "variant-inventory-truncated", totalInventory, variantInventoryTotal: null };
  }
  if (!variants.length || variants.some((variant) => (
    variant?.inventoryItem?.tracked !== true ||
    !Number.isFinite(Number(variant?.inventoryQuantity))
  ))) {
    return { eligible: false, reason: "inventory-not-fully-tracked", totalInventory, variantInventoryTotal: null };
  }
  const variantInventoryTotal = variants.reduce((sum, variant) => sum + Number(variant.inventoryQuantity), 0);
  if (variantInventoryTotal !== totalInventory) {
    return { eligible: false, reason: "inventory-total-mismatch", totalInventory, variantInventoryTotal };
  }
  return {
    eligible: totalInventory < threshold,
    reason: totalInventory < threshold ? "below-threshold" : "at-or-above-threshold",
    totalInventory,
    variantInventoryTotal,
  };
}

async function fetchActiveProducts(retryInfo) {
  const products = [];
  let after = null;
  let page = 0;
  while (true) {
    page += 1;
    const data = await client.run(
      ACTIVE_PRODUCTS_QUERY,
      { first: pageSize, after, query: activeProductQuery },
      { operation: `low-stock active product page ${page}`, retryInfo },
    );
    const connection = data?.products;
    if (!connection) throw new Error("Shopify returned no active products connection.");
    for (const product of asArray(connection.nodes)) {
      if (!isActiveShopifyProduct(product)) {
        throw new Error(`Active product query returned a non-active product: ${product?.handle || product?.id || "unknown"}`);
      }
      products.push(product);
    }
    process.stdout.write(`Fetched low-stock audit page ${page}: ${asArray(connection.nodes).length} products (${products.length} total)\n`);
    if (!connection.pageInfo?.hasNextPage) break;
    if (!connection.pageInfo.endCursor) throw new Error(`Low-stock page ${page} hasNextPage without an end cursor.`);
    after = connection.pageInfo.endCursor;
  }
  return products;
}

async function fetchProductById(id, retryInfo, operation) {
  const data = await client.run(PRODUCT_BY_ID_QUERY, { id }, { operation, retryInfo });
  return data?.node || null;
}

async function completeVariantInventory(product, retryInfo, operation) {
  if (!product?.variants?.pageInfo?.hasNextPage) return product;
  const variants = [...asArray(product.variants.nodes)];
  // The first 250 variants are already present in `product`. Continue after
  // that cursor; restarting at null duplicates the first page and creates a
  // false inventory-total mismatch for products with more than 250 variants.
  let after = product.variants.pageInfo.endCursor;
  let page = 0;
  while (true) {
    page += 1;
    const data = await client.run(
      PRODUCT_VARIANTS_QUERY,
      { id: product.id, first: pageSize, after },
      { operation: `${operation} variant page ${page}`, retryInfo },
    );
    const connection = data?.node?.variants;
    if (!connection) throw new Error(`Shopify returned no variant inventory connection for ${product.handle}.`);
    variants.push(...asArray(connection.nodes));
    if (!connection.pageInfo?.hasNextPage) break;
    if (!connection.pageInfo.endCursor) throw new Error(`Variant inventory page ${page} hasNextPage without an end cursor.`);
    after = connection.pageInfo.endCursor;
  }
  return { ...product, variants: { nodes: variants, pageInfo: { hasNextPage: false } } };
}

async function waitForDeleteOperation(operationId, productId, retryInfo) {
  for (let attempt = 0; attempt < deletePollAttempts; attempt += 1) {
    const data = await client.run(
      PRODUCT_OPERATION_QUERY,
      { id: operationId },
      { operation: `low-stock deletion operation ${operationId}`, retryInfo },
    );
    const operation = data?.productOperation;
    if (!operation) throw new Error(`Product delete operation ${operationId} was not found.`);
    const errors = formatUserErrors(operation.userErrors);
    if (errors) throw new Error(`Product delete operation ${operationId} failed: ${errors}`);
    if (operation.status === "COMPLETE") {
      if (operation.deletedProductId && operation.deletedProductId !== productId) {
        throw new Error(`Delete operation ${operationId} completed for an unexpected product.`);
      }
      return operation;
    }
    if (!["CREATED", "ACTIVE"].includes(operation.status)) {
      throw new Error(`Product delete operation ${operationId} returned unexpected status ${operation.status || "unknown"}.`);
    }
    await sleep(deletePollDelayMs);
  }
  throw new Error(`Timed out waiting for product delete operation ${operationId}.`);
}

async function writeManifest(filePath, manifest) {
  await mkdir(resolve(filePath, ".."), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

function refreshSummary(manifest) {
  const tasks = asArray(manifest.tasks);
  manifest.summary.wouldDelete = tasks.filter((task) => task.status === "would-delete").length;
  manifest.summary.deletedVerified = tasks.filter((task) => task.status === "deleted-verified").length;
  manifest.summary.skipped = tasks.filter((task) => task.status.startsWith("skipped-")).length;
  manifest.summary.alreadyDeleted = tasks.filter((task) => task.status === "already-deleted").length;
  manifest.summary.failed = tasks.filter((task) => task.status === "failed").length;
}

function taskFromProduct(product, assessment) {
  return {
    productId: product.id,
    handle: normalizeText(product.handle),
    title: normalizeText(product.title),
    initialStatus: normalizeText(product.status),
    initialTotalInventory: assessment.totalInventory,
    initialVariantInventoryTotal: assessment.variantInventoryTotal,
    threshold: assessment.threshold,
    status: "pending",
    operationId: "",
    verifiedAt: "",
    failure: "",
  };
}

async function verifyApprovalForApply(threshold) {
  if (process.env.FUTURE_LIGHT_LOW_STOCK_DELETE_APPROVED !== "1") {
    throw new Error(
      "Low-stock deletion is approval-gated. Set FUTURE_LIGHT_LOW_STOCK_DELETE_APPROVED=1 only after reviewing the live dry-run and approval manifest.",
    );
  }
  let approval;
  try {
    approval = JSON.parse(await readFile(approvalPath, "utf8"));
  } catch {
    throw new Error(`Low-stock approval manifest is missing or unreadable: ${approvalPath}`);
  }
  if (approval?.status !== "approved") {
    throw new Error(`Low-stock approval manifest status is ${approval?.status || "missing"}; expected approved.`);
  }
  const scope = approval.scope || {};
  if (Number(scope.totalInventoryBelow) !== threshold || scope.activeProductsOnly !== true || scope.requireFullyTrackedInventory !== true) {
    throw new Error("Low-stock approval scope does not exactly match active-only, fully-tracked inventory below the configured threshold.");
  }
}

async function buildManifest(args, productHandles) {
  const retryInfo = [];
  const activeProducts = await fetchActiveProducts(retryInfo);
  const scopedProducts = productHandles
    ? activeProducts.filter((product) => productHandles.has(normalizeText(product.handle).toLowerCase()))
    : activeProducts;
  const completeProducts = new Array(scopedProducts.length);
  let nextProductIndex = 0;
  const completeWorker = async () => {
    while (true) {
      const index = nextProductIndex++;
      if (index >= scopedProducts.length) return;
      completeProducts[index] = await completeVariantInventory(
        scopedProducts[index],
        retryInfo,
        `low-stock inventory read ${scopedProducts[index].handle}`,
      );
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(variantInventoryFetchConcurrency, Math.max(1, scopedProducts.length)) },
    () => completeWorker(),
  ));
  const assessments = completeProducts.map((product) => ({ product, assessment: inventoryAssessment(product, args.threshold) }));
  const eligible = assessments.filter(({ assessment }) => assessment.eligible);
  const manifest = {
    schemaVersion: 1,
    runId: `${Date.now()}-${process.pid}`,
    startedAt: new Date().toISOString(),
    completedAt: "",
    mode: args.mode,
    output: args.output,
    source: {
      store: client.storeDomain,
      apiVersion: client.apiVersion,
      productQuery: activeProductQuery,
      productHandlesFile: args.productHandlesFile || null,
      freshLiveRead: true,
    },
    policy: {
      scope: productHandles
        ? "active products in the supplied cohort only; all other products are unchanged"
        : "active products only; draft and archived products are unchanged",
      threshold: `totalInventory < ${args.threshold}`,
      inventorySource: "live Shopify Product.totalInventory validated against every variant inventoryQuantity",
      requireFullyTrackedInventory: true,
      deletion: "permanent only after a fresh live inventory re-read confirms the product remains active and below threshold",
      readback: "each asynchronous delete operation and post-delete product read are required",
    },
    summary: {
      activeProducts: activeProducts.length,
      scopedProducts: scopedProducts.length,
      measurableProducts: assessments.filter(({ assessment }) => ["below-threshold", "at-or-above-threshold"].includes(assessment.reason)).length,
      belowThresholdCandidates: eligible.length,
      notLowStock: assessments.filter(({ assessment }) => assessment.reason === "at-or-above-threshold").length,
      inventoryUnavailable: assessments.filter(({ assessment }) => assessment.reason === "inventory-unavailable").length,
      inventoryNotFullyTracked: assessments.filter(({ assessment }) => assessment.reason === "inventory-not-fully-tracked").length,
      inventoryTotalMismatch: assessments.filter(({ assessment }) => assessment.reason === "inventory-total-mismatch").length,
      variantInventoryTruncated: assessments.filter(({ assessment }) => assessment.reason === "variant-inventory-truncated").length,
      wouldDelete: 0,
      deletedVerified: 0,
      skipped: 0,
      alreadyDeleted: 0,
      failed: 0,
    },
    retryInfo,
    tasks: eligible.map(({ product, assessment }) => taskFromProduct(product, { ...assessment, threshold: args.threshold })),
  };
  return manifest;
}

async function applyTask(task, args) {
  const taskRetryInfo = [];
  try {
    const current = await fetchProductById(task.productId, taskRetryInfo, `low-stock pre-delete read ${task.handle}`);
    if (!current) {
      task.status = "already-deleted";
    } else if (!isActiveShopifyProduct(current)) {
      task.status = "skipped-not-active";
    } else {
      const currentWithCompleteInventory = await completeVariantInventory(
        current,
        taskRetryInfo,
        `low-stock pre-delete inventory read ${task.handle}`,
      );
      const assessment = inventoryAssessment(currentWithCompleteInventory, args.threshold);
      if (!assessment.eligible) {
        task.status = `skipped-${assessment.reason}`;
        task.currentTotalInventory = assessment.totalInventory;
      } else {
        const data = await client.run(
          PRODUCT_DELETE_MUTATION,
          { input: { id: task.productId }, synchronous: false },
          { allowMutations: true, operation: `low-stock delete ${task.handle}`, retryInfo: taskRetryInfo },
        );
        const payload = data?.productDelete;
        const errors = formatUserErrors(payload?.userErrors);
        if (errors) throw new Error(errors);
        task.operationId = normalizeText(payload?.productDeleteOperation?.id);
        if (task.operationId) {
          await waitForDeleteOperation(task.operationId, task.productId, taskRetryInfo);
        } else if (payload?.deletedProductId !== task.productId) {
          throw new Error("Shopify did not return a deletion confirmation.");
        }
        const afterDelete = await fetchProductById(task.productId, taskRetryInfo, `low-stock post-delete read ${task.handle}`);
        if (afterDelete) throw new Error("Product still exists after Shopify confirmed deletion.");
        task.status = "deleted-verified";
      }
    }
    task.verifiedAt = new Date().toISOString();
  } catch (error) {
    task.status = "failed";
    task.failure = normalizeText(error?.message || error);
    task.verifiedAt = new Date().toISOString();
  }
  return taskRetryInfo;
}

async function verifyManifest(manifest, args) {
  if (manifest.mode !== "apply" || !manifest.completedAt) {
    throw new Error("Low-stock verification requires a completed apply manifest.");
  }
  if (Number(manifest.summary?.failed || 0) > 0) {
    throw new Error("Low-stock verification cannot pass because the apply manifest contains failed deletions.");
  }
  const pending = asArray(manifest.tasks).filter((task) => ["pending", "would-delete"].includes(task.status));
  if (pending.length) throw new Error(`Low-stock verification cannot pass with ${pending.length} unprocessed deletion task(s).`);
  const tasks = asArray(manifest.tasks).filter((task) => task.status === "deleted-verified");
  const failures = [];
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= tasks.length) return;
      const task = tasks[index];
      const current = await fetchProductById(task.productId, [], `low-stock final verification ${task.handle}`);
      if (current) failures.push({ handle: task.handle, reason: "product-still-exists" });
    }
  };
  await Promise.all(Array.from({ length: Math.min(verifyConcurrency, Math.max(1, tasks.length)) }, () => worker()));
  if (failures.length) throw new Error(`Low-stock deletion verification failed for ${failures.length} product(s).`);
  process.stdout.write(`Low-stock deletion verification passed: ${tasks.length} deleted products absent from live Shopify.\n`);
}

async function main() {
  const args = parseArgs(process.argv);
  const productHandles = await readProductHandles(args.productHandlesFile);
  if (args.mode === "verify") {
    const manifest = JSON.parse(await readFile(args.output, "utf8"));
    await verifyManifest(manifest, args);
    return;
  }
  if (args.mode === "apply") await verifyApprovalForApply(args.threshold);

  const manifest = await buildManifest(args, productHandles);
  if (args.mode === "dry-run") {
    for (const task of manifest.tasks) task.status = "would-delete";
    manifest.completedAt = new Date().toISOString();
    refreshSummary(manifest);
    await writeManifest(args.output, manifest);
    process.stdout.write(
      `Low-stock dry run complete: ${manifest.summary.wouldDelete} active products are below total inventory ${args.threshold}; ${manifest.summary.inventoryNotFullyTracked + manifest.summary.inventoryUnavailable + manifest.summary.inventoryTotalMismatch + manifest.summary.variantInventoryTruncated} products were held because inventory could not be proven safe.\n`,
    );
    return;
  }

  let manifestWrite = Promise.resolve();
  const checkpoint = () => {
    manifestWrite = manifestWrite.then(() => writeManifest(args.output, manifest));
    return manifestWrite;
  };
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= manifest.tasks.length) return;
      const taskRetryInfo = await applyTask(manifest.tasks[index], args);
      manifest.retryInfo.push(...taskRetryInfo);
      refreshSummary(manifest);
      await checkpoint();
      process.stdout.write(`Low-stock deletion progress: ${manifest.summary.deletedVerified + manifest.summary.failed + manifest.summary.skipped + manifest.summary.alreadyDeleted}/${manifest.tasks.length} processed\n`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(deleteConcurrency, Math.max(1, manifest.tasks.length)) }, () => worker()));
  await manifestWrite;
  manifest.completedAt = new Date().toISOString();
  refreshSummary(manifest);
  await writeManifest(args.output, manifest);
  if (manifest.summary.failed) {
    throw new Error(`Low-stock deletion failed for ${manifest.summary.failed} product(s); see ${args.output}.`);
  }
  process.stdout.write(`Low-stock deletion apply complete: ${manifest.summary.deletedVerified} products permanently deleted and verified absent.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message || error}\n`);
  process.exitCode = 1;
});
