#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { isActiveShopifyProduct } from "../src/lib/catalog-taxonomy-release.js";
import { asArray, createShopifyAdminGraphQLClient, normalizeText } from "./shopify-admin-graphql-client.mjs";

const execFileAsync = promisify(execFile);
const rootDir = resolve(import.meta.dirname, "..");
const defaultOutputPath = resolve(rootDir, "output", "shopify-zero-image-product-delete-manifest.json");
const activeProductQuery = "status:active";
const deletePollDelayMs = Math.max(250, Number(process.env.SALT_ZERO_IMAGE_DELETE_POLL_DELAY_MS || 1500));
const deletePollAttempts = Math.max(1, Number(process.env.SALT_ZERO_IMAGE_DELETE_POLL_ATTEMPTS || 240));
const client = createShopifyAdminGraphQLClient({ rootDir, agentName: "zero-image-product-delete" });

const PRODUCT_SELECTION = /* GraphQL */ `
  id
  handle
  title
  status
  images(first: 1) {
    nodes {
      id
      url
    }
  }
`;

const ACTIVE_PRODUCTS_QUERY = /* GraphQL */ `
  query ZeroImageActiveProducts($first: Int!, $after: String, $query: String!) {
    products(first: $first, after: $after, query: $query) {
      nodes {
        ${PRODUCT_SELECTION}
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const PRODUCT_BY_ID_QUERY = /* GraphQL */ `
  query ZeroImageProductById($id: ID!) {
    node(id: $id) {
      ... on Product {
        ${PRODUCT_SELECTION}
      }
    }
  }
`;

const PRODUCT_DELETE_MUTATION = /* GraphQL */ `
  mutation ZeroImageProductDelete($input: ProductDeleteInput!, $synchronous: Boolean!) {
    productDelete(input: $input, synchronous: $synchronous) {
      deletedProductId
      productDeleteOperation {
        id
        status
        deletedProductId
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_OPERATION_QUERY = /* GraphQL */ `
  query ZeroImageProductDeleteOperation($id: ID!) {
    productOperation(id: $id) {
      ... on ProductDeleteOperation {
        id
        status
        deletedProductId
        userErrors {
          field
          message
        }
      }
    }
  }
`;

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function parseArgs(argv) {
  const args = { mode: "dry-run", output: defaultOutputPath, sample: 0, productHandlesFile: "" };
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
    if (token === "--output") {
      args.output = resolve(rootDir, argv[index + 1] || args.output);
      index += 1;
      continue;
    }
    if (token === "--sample") {
      args.sample = Math.max(0, Number(argv[index + 1] || 0) || 0);
      index += 1;
      continue;
    }
    if (token === "--product-handles-file") {
      args.productHandlesFile = resolve(rootDir, argv[index + 1] || "");
      index += 1;
    }
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

function imageNodes(product) {
  return asArray(product?.images?.nodes).filter((image) => image?.id || image?.url);
}

async function verifyApprovalForApply() {
  try {
    await execFileAsync(process.execPath, ["scripts/catalog-taxonomy-approval.mjs"], {
      cwd: rootDir,
      env: process.env,
      maxBuffer: 2 * 1024 * 1024,
    });
  } catch (error) {
    const details = normalizeText(error?.stderr || error?.stdout || error?.message || error);
    throw new Error(`Approved zero-image deletion verification failed: ${details}`);
  }
}

async function fetchActiveProducts(retryInfo) {
  const products = [];
  let after = null;
  let page = 0;
  while (true) {
    page += 1;
    const data = await client.run(
      ACTIVE_PRODUCTS_QUERY,
      { first: 250, after, query: activeProductQuery },
      { operation: `zero-image active product page ${page}`, retryInfo },
    );
    const connection = data?.products;
    if (!connection) {
      throw new Error("Shopify returned no products connection. Grant read_products access before this release.");
    }
    for (const product of asArray(connection.nodes)) {
      if (!isActiveShopifyProduct(product)) {
        throw new Error(`Active product query returned a non-active product: ${product?.handle || product?.id || "unknown"}`);
      }
      products.push(product);
    }
    if (!connection.pageInfo?.hasNextPage) break;
    if (!connection.pageInfo.endCursor) throw new Error(`Active product page ${page} hasNextPage without an end cursor.`);
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
      { operation: `zero-image deletion operation ${operationId}`, retryInfo },
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
      throw new Error(`Delete operation ${operationId} returned unexpected status ${operation.status || "unknown"}.`);
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
  manifest.summary.imageAdded = tasks.filter((task) => task.status === "skipped-image-added").length;
  manifest.summary.statusChanged = tasks.filter((task) => task.status === "skipped-not-active").length;
  manifest.summary.alreadyDeleted = tasks.filter((task) => task.status === "already-deleted").length;
  manifest.summary.failed = tasks.filter((task) => task.status === "failed").length;
}

function taskFromProduct(product, status = "pending") {
  return {
    productId: product.id,
    handle: normalizeText(product.handle),
    title: normalizeText(product.title),
    initialImageCount: imageNodes(product).length,
    status,
    operationId: "",
    verifiedAt: "",
    failure: "",
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.mode === "apply") await verifyApprovalForApply();

  const retryInfo = [];
  const productHandles = await readProductHandles(args.productHandlesFile);
  const activeProducts = await fetchActiveProducts(retryInfo);
  const scopedProducts = productHandles
    ? activeProducts.filter((product) => productHandles.has(normalizeText(product.handle).toLowerCase()))
    : activeProducts;
  const candidates = scopedProducts.filter((product) => imageNodes(product).length === 0);
  const selectedCandidates = args.sample > 0 ? candidates.slice(0, args.sample) : candidates;
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
      scope: args.productHandlesFile
        ? "active products in the supplied cohort only; all other products are unchanged"
        : "active products only; draft and archived products are unchanged",
      deletion: "permanent only after a fresh live image read confirms zero product images",
      readback: "each asynchronous delete operation and post-delete product read are required",
    },
    summary: {
      activeProducts: activeProducts.length,
      zeroImageCandidates: candidates.length,
      selectedCandidates: selectedCandidates.length,
      wouldDelete: 0,
      deletedVerified: 0,
      imageAdded: 0,
      statusChanged: 0,
      alreadyDeleted: 0,
      failed: 0,
    },
    retryInfo,
    tasks: selectedCandidates.map((product) => taskFromProduct(product)),
  };

  if (args.mode === "dry-run") {
    for (const task of manifest.tasks) task.status = "would-delete";
    manifest.completedAt = new Date().toISOString();
    refreshSummary(manifest);
    await writeManifest(args.output, manifest);
    process.stdout.write(`Zero-image dry run complete: ${manifest.summary.wouldDelete} active products would be permanently deleted after fresh re-read.\n`);
    return;
  }

  for (const task of manifest.tasks) {
    const taskRetryInfo = [];
    try {
      const current = await fetchProductById(task.productId, taskRetryInfo, `zero-image pre-delete read ${task.handle}`);
      if (!current) {
        task.status = "already-deleted";
      } else if (!isActiveShopifyProduct(current)) {
        task.status = "skipped-not-active";
      } else if (imageNodes(current).length > 0) {
        task.status = "skipped-image-added";
      } else {
        const data = await client.run(
          PRODUCT_DELETE_MUTATION,
          { input: { id: task.productId }, synchronous: false },
          { allowMutations: true, operation: `zero-image delete ${task.handle}`, retryInfo: taskRetryInfo },
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

        const afterDelete = await fetchProductById(task.productId, taskRetryInfo, `zero-image post-delete read ${task.handle}`);
        if (afterDelete) throw new Error("Product still exists after Shopify confirmed deletion.");
        task.status = "deleted-verified";
      }
      task.verifiedAt = new Date().toISOString();
    } catch (error) {
      task.status = "failed";
      task.failure = normalizeText(error?.message || error);
      task.verifiedAt = new Date().toISOString();
    }
    manifest.retryInfo.push(...taskRetryInfo);
    refreshSummary(manifest);
    await writeManifest(args.output, manifest);
  }

  manifest.completedAt = new Date().toISOString();
  refreshSummary(manifest);
  await writeManifest(args.output, manifest);
  if (manifest.summary.failed) {
    throw new Error(`Zero-image deletion failed for ${manifest.summary.failed} product(s); see ${args.output}.`);
  }
  process.stdout.write(`Zero-image deletion complete: ${manifest.summary.deletedVerified} products permanently deleted after live verification.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message || error}\n`);
  process.exitCode = 1;
});
