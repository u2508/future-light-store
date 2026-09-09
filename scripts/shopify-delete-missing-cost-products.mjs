#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { asArray, createShopifyAdminGraphQLClient, normalizeText } from "./shopify-admin-graphql-client.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const defaultOutputPath = resolve(rootDir, "output", "shopify-missing-cost-product-delete-manifest.json");
const approvalPath = resolve(rootDir, "docs", "catalog-missing-cost-product-removal-approval.json");
const pageSize = Math.max(1, Math.min(250, Number(process.env.FUTURE_LIGHT_MISSING_COST_PAGE_SIZE || 250)));
const deleteConcurrency = Math.max(1, Math.min(4, Number(process.env.FUTURE_LIGHT_MISSING_COST_DELETE_CONCURRENCY || 3)));
const verifyConcurrency = Math.max(1, Math.min(8, Number(process.env.FUTURE_LIGHT_MISSING_COST_VERIFY_CONCURRENCY || 6)));
const deletePollDelayMs = Math.max(250, Number(process.env.FUTURE_LIGHT_MISSING_COST_DELETE_POLL_DELAY_MS || 1500));
const deletePollAttempts = Math.max(1, Number(process.env.FUTURE_LIGHT_MISSING_COST_DELETE_POLL_ATTEMPTS || 240));
const client = createShopifyAdminGraphQLClient({ rootDir, agentName: "missing-cost-product-delete" });

const PRODUCT_SELECTION = /* GraphQL */ `
  id
  handle
  title
  status
  variants(first: 250) {
    nodes {
      id
      title
      sku
      inventoryItem { unitCost { amount currencyCode } }
    }
    pageInfo { hasNextPage endCursor }
  }
`;

const PRODUCTS_QUERY = /* GraphQL */ `
  query MissingCostProducts($first: Int!, $after: String) {
    products(first: $first, after: $after, sortKey: ID) {
      nodes { ${PRODUCT_SELECTION} }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const PRODUCT_BY_ID_QUERY = /* GraphQL */ `
  query MissingCostProductById($id: ID!) {
    node(id: $id) {
      ... on Product { ${PRODUCT_SELECTION} }
    }
  }
`;

const PRODUCT_VARIANTS_QUERY = /* GraphQL */ `
  query MissingCostProductVariants($id: ID!, $first: Int!, $after: String) {
    node(id: $id) {
      ... on Product {
        variants(first: $first, after: $after) {
          nodes {
            id
            title
            sku
            inventoryItem { unitCost { amount currencyCode } }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
`;

const PRODUCT_DELETE_MUTATION = /* GraphQL */ `
  mutation MissingCostProductDelete($input: ProductDeleteInput!, $synchronous: Boolean!) {
    productDelete(input: $input, synchronous: $synchronous) {
      deletedProductId
      productDeleteOperation { id status deletedProductId }
      userErrors { field message }
    }
  }
`;

const PRODUCT_OPERATION_QUERY = /* GraphQL */ `
  query MissingCostProductDeleteOperation($id: ID!) {
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

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function parseArgs(argv) {
  const args = { mode: "dry-run", output: defaultOutputPath };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--apply") {
      args.mode = "apply";
    } else if (token === "--dry-run") {
      args.mode = "dry-run";
    } else if (token === "--verify") {
      args.mode = "verify";
    } else if (token === "--output" && argv[index + 1]) {
      args.output = resolve(rootDir, argv[index + 1]);
      index += 1;
    }
  }
  return args;
}

function normalizeMoney(value) {
  if (value == null || value === "") return null;
  const amount = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(amount) ? amount.toFixed(2) : null;
}

function formatUserErrors(errors) {
  return asArray(errors)
    .map((entry) => `${asArray(entry?.field).join(".")} ${normalizeText(entry?.message || "Shopify user error")}`.trim())
    .filter(Boolean)
    .join("; ");
}

function missingCostVariants(product) {
  return asArray(product?.variants?.nodes).filter((variant) => {
    const cost = normalizeMoney(variant?.inventoryItem?.unitCost?.amount);
    return !cost || Number(cost) <= 0;
  });
}

function hasMissingCost(product) {
  return missingCostVariants(product).length > 0;
}

async function verifyApprovalForApply() {
  if (process.env.FUTURE_LIGHT_MISSING_COST_DELETE_APPROVED !== "1") {
    throw new Error(
      "Missing-cost product deletion is approval-gated. Set FUTURE_LIGHT_MISSING_COST_DELETE_APPROVED=1 only after reviewing the live dry-run and approval manifest.",
    );
  }
  let approval;
  try {
    approval = JSON.parse(await readFile(approvalPath, "utf8"));
  } catch {
    throw new Error(`Missing-cost deletion approval manifest is missing or unreadable: ${approvalPath}`);
  }
  const approvalId = normalizeText(approval?.approvalId);
  if (approval?.approved !== true || approval?.status !== "approved") {
    throw new Error(`Missing-cost deletion approval manifest is not approved: ${approval?.status || "missing"}.`);
  }
  if (!approvalId) throw new Error("Missing-cost deletion approval manifest has no approvalId.");
  const scope = approval.scope || {};
  if (scope.productStatuses !== "all" || scope.condition !== "any variant has missing or invalid inventoryItem.unitCost.amount" || scope.deletion !== "permanent") {
    throw new Error("Missing-cost deletion approval scope does not exactly match the all-status, missing-unitCost permanent-deletion policy.");
  }
  if (process.env.FUTURE_LIGHT_MISSING_COST_DELETE_APPROVAL_ID !== approvalId) {
    throw new Error("FUTURE_LIGHT_MISSING_COST_DELETE_APPROVAL_ID does not match the approved missing-cost deletion manifest.");
  }
}

async function completeProductVariants(product, retryInfo, operationPrefix) {
  const initial = product?.variants || {};
  const nodes = [...asArray(initial.nodes)];
  let hasNextPage = Boolean(initial?.pageInfo?.hasNextPage);
  let after = initial?.pageInfo?.endCursor || null;
  let page = 1;
  while (hasNextPage) {
    if (!after) throw new Error(`${product?.handle || product?.id || "product"} has variant pagination without an end cursor.`);
    page += 1;
    const data = await client.run(
      PRODUCT_VARIANTS_QUERY,
      { id: product.id, first: pageSize, after },
      { operation: `${operationPrefix} ${product?.handle || product?.id} variant page ${page}`, retryInfo },
    );
    const connection = data?.node?.variants;
    if (!connection) throw new Error(`Shopify returned no variant connection for ${product?.handle || product?.id}.`);
    nodes.push(...asArray(connection.nodes));
    hasNextPage = Boolean(connection.pageInfo?.hasNextPage);
    after = connection.pageInfo?.endCursor || null;
  }
  return { ...product, variants: { nodes, pageInfo: { hasNextPage: false, endCursor: after } } };
}

async function fetchProducts(retryInfo) {
  const products = [];
  let after = null;
  let page = 0;
  while (true) {
    page += 1;
    const data = await client.run(
      PRODUCTS_QUERY,
      { first: pageSize, after },
      { operation: `missing-cost catalog page ${page}`, retryInfo },
    );
    const connection = data?.products;
    if (!connection) throw new Error("Shopify returned no product connection during missing-cost audit.");
    const pageProducts = asArray(connection.nodes);
    const complete = new Array(pageProducts.length);
    let nextIndex = 0;
    const worker = async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= pageProducts.length) return;
        complete[index] = pageProducts[index].variants?.pageInfo?.hasNextPage
          ? await completeProductVariants(pageProducts[index], retryInfo, "missing-cost catalog")
          : pageProducts[index];
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, Math.max(1, pageProducts.length)) }, () => worker()));
    products.push(...complete);
    process.stdout.write(`Fetched missing-cost audit page ${page}: ${pageProducts.length} products (${products.length} total)\n`);
    if (!connection.pageInfo?.hasNextPage) break;
    if (!connection.pageInfo.endCursor) throw new Error(`Missing-cost catalog page ${page} has no end cursor.`);
    after = connection.pageInfo.endCursor;
  }
  return products;
}

async function fetchProductById(id, retryInfo, operation) {
  const data = await client.run(PRODUCT_BY_ID_QUERY, { id }, { operation, retryInfo });
  return data?.node || null;
}

async function waitForDeleteOperation(operationId, productId, retryInfo) {
  for (let attempt = 0; attempt < deletePollAttempts; attempt += 1) {
    const data = await client.run(
      PRODUCT_OPERATION_QUERY,
      { id: operationId },
      { operation: `missing-cost deletion operation ${operationId}`, retryInfo },
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
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

function refreshSummary(manifest) {
  const tasks = asArray(manifest.tasks);
  manifest.summary.wouldDelete = tasks.filter((task) => task.status === "would-delete").length;
  manifest.summary.deletedVerified = tasks.filter((task) => task.status === "deleted-verified").length;
  manifest.summary.alreadyDeleted = tasks.filter((task) => task.status === "already-deleted").length;
  manifest.summary.skipped = tasks.filter((task) => task.status === "skipped-no-longer-missing-cost").length;
  manifest.summary.failed = tasks.filter((task) => task.status === "failed").length;
}

function taskFromProduct(product) {
  const missingVariants = missingCostVariants(product);
  return {
    productId: String(product?.id || ""),
    handle: normalizeText(product?.handle),
    title: normalizeText(product?.title),
    initialStatus: normalizeText(product?.status),
    initialVariantCount: asArray(product?.variants?.nodes).length,
    initialMissingCostVariantCount: missingVariants.length,
    missingVariants: missingVariants.map((variant) => ({
      variantId: String(variant?.id || ""),
      title: normalizeText(variant?.title),
      sku: normalizeText(variant?.sku),
      cost: normalizeMoney(variant?.inventoryItem?.unitCost?.amount) || "",
    })),
    status: "pending",
    operationId: "",
    verifiedAt: "",
    failure: "",
  };
}

async function buildManifest(args) {
  const retryInfo = [];
  const products = await fetchProducts(retryInfo);
  const candidates = products.filter(hasMissingCost);
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
      productQuery: "all Shopify products, sorted by ID",
      freshLiveRead: true,
    },
    policy: {
      scope: "all Shopify product statuses; a product is a candidate when any variant has missing or invalid inventoryItem.unitCost.amount",
      condition: "any variant has missing or invalid inventoryItem.unitCost.amount",
      deletion: "permanent only after a fresh pre-delete variant-cost re-read confirms the condition",
      readback: "each asynchronous delete operation and post-delete product read are required",
      safety: "no product is deleted merely because its price is low, stock is low, or a local cache is incomplete",
    },
    summary: {
      productsScanned: products.length,
      variantsScanned: products.reduce((total, product) => total + asArray(product?.variants?.nodes).length, 0),
      candidateProducts: candidates.length,
      missingCostVariants: candidates.reduce((total, product) => total + missingCostVariants(product).length, 0),
      wouldDelete: 0,
      deletedVerified: 0,
      alreadyDeleted: 0,
      skipped: 0,
      failed: 0,
    },
    retryInfo,
    tasks: candidates.map(taskFromProduct),
  };
  return manifest;
}

async function applyTask(task) {
  const retryInfo = [];
  try {
    const current = await fetchProductById(task.productId, retryInfo, `missing-cost pre-delete read ${task.handle}`);
    if (!current) {
      task.status = "already-deleted";
    } else {
      const currentComplete = await completeProductVariants(current, retryInfo, "missing-cost pre-delete cost read");
      if (!hasMissingCost(currentComplete)) {
        task.status = "skipped-no-longer-missing-cost";
      } else {
        const data = await client.run(
          PRODUCT_DELETE_MUTATION,
          { input: { id: task.productId }, synchronous: false },
          { allowMutations: true, operation: `missing-cost delete ${task.handle}`, retryInfo },
        );
        const payload = data?.productDelete;
        const errors = formatUserErrors(payload?.userErrors);
        if (errors) throw new Error(errors);
        task.operationId = normalizeText(payload?.productDeleteOperation?.id);
        if (task.operationId) {
          await waitForDeleteOperation(task.operationId, task.productId, retryInfo);
        } else if (payload?.deletedProductId !== task.productId) {
          throw new Error("Shopify did not return a deletion confirmation.");
        }
        const afterDelete = await fetchProductById(task.productId, retryInfo, `missing-cost post-delete read ${task.handle}`);
        if (afterDelete) throw new Error("Product still exists after Shopify confirmed deletion.");
        task.status = "deleted-verified";
      }
    }
  } catch (error) {
    task.status = "failed";
    task.failure = normalizeText(error?.message || error);
  }
  task.verifiedAt = new Date().toISOString();
  return retryInfo;
}

async function verifyManifest(manifest) {
  if (manifest.mode !== "apply" || !manifest.completedAt) {
    throw new Error("Missing-cost product deletion verification requires a completed apply manifest.");
  }
  if (Number(manifest.summary?.failed || 0) > 0) {
    throw new Error("Missing-cost product deletion verification cannot pass because the apply manifest contains failed deletions.");
  }
  const pending = asArray(manifest.tasks).filter((task) => ["pending", "would-delete"].includes(task.status));
  if (pending.length) throw new Error(`Missing-cost product deletion verification cannot pass with ${pending.length} unprocessed task(s).`);
  const tasks = asArray(manifest.tasks).filter((task) => !["skipped-no-longer-missing-cost"].includes(task.status));
  const failures = [];
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= tasks.length) return;
      const task = tasks[index];
      const current = await fetchProductById(task.productId, [], `missing-cost final verification ${task.handle}`);
      if (current) failures.push({ handle: task.handle, reason: "product-still-exists" });
    }
  };
  await Promise.all(Array.from({ length: Math.min(verifyConcurrency, Math.max(1, tasks.length)) }, () => worker()));
  if (failures.length) throw new Error(`Missing-cost product deletion verification failed for ${failures.length} product(s).`);
  process.stdout.write(`Missing-cost product deletion verification passed: ${tasks.length} candidate product(s) are absent from live Shopify.\n`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.mode === "verify") {
    const manifest = JSON.parse(await readFile(args.output, "utf8"));
    await verifyManifest(manifest);
    return;
  }
  if (args.mode === "apply") await verifyApprovalForApply();

  const manifest = await buildManifest(args);
  if (args.mode === "dry-run") {
    for (const task of manifest.tasks) task.status = "would-delete";
    manifest.completedAt = new Date().toISOString();
    refreshSummary(manifest);
    await writeManifest(args.output, manifest);
    process.stdout.write(`Missing-cost dry run complete: ${manifest.summary.wouldDelete} product(s) contain ${manifest.summary.missingCostVariants} variant(s) without a valid Shopify inventoryItem.unitCost.\n`);
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
      const taskRetryInfo = await applyTask(manifest.tasks[index]);
      manifest.retryInfo.push(...taskRetryInfo);
      refreshSummary(manifest);
      await checkpoint();
      process.stdout.write(`Missing-cost deletion progress: ${manifest.summary.deletedVerified + manifest.summary.alreadyDeleted + manifest.summary.skipped + manifest.summary.failed}/${manifest.tasks.length} processed\n`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(deleteConcurrency, Math.max(1, manifest.tasks.length)) }, () => worker()));
  await manifestWrite;
  manifest.completedAt = new Date().toISOString();
  refreshSummary(manifest);
  await writeManifest(args.output, manifest);
  if (manifest.summary.failed) {
    throw new Error(`Missing-cost product deletion failed for ${manifest.summary.failed} product(s); see ${args.output}.`);
  }
  process.stdout.write(`Missing-cost deletion apply complete: ${manifest.summary.deletedVerified} product(s) permanently deleted and verified absent.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message || error}\n`);
  process.exitCode = 1;
});
