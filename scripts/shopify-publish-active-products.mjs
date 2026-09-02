#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import {
  planProductPublication,
  verifyProductPublicationReadback,
} from "../src/lib/shopify-publication-release.js";
import { asArray, createShopifyAdminGraphQLClient, normalizeText } from "./shopify-admin-graphql-client.mjs";
import { envInteger, recommendedConcurrency } from "./lib/performance-runtime.mjs";

const execFileAsync = promisify(execFile);
const rootDir = resolve(import.meta.dirname, "..");
const defaultOutputPath = resolve(rootDir, "output", "shopify-active-product-publication-manifest.json");
const activeProductQuery = "status:active";
const client = createShopifyAdminGraphQLClient({ rootDir, agentName: "active-product-publication" });

const PUBLICATIONS_QUERY = /* GraphQL */ `
  query ActiveSalesPublications($first: Int!, $after: String) {
    publications(first: $first, after: $after) {
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
`;

const PRODUCT_SELECTION = /* GraphQL */ `
  id
  handle
  title
  status
  requiresSellingPlan
  unpublishedPublications(first: 250) {
    nodes {
      id
      name
    }
  }
`;

const ACTIVE_PRODUCTS_QUERY = /* GraphQL */ `
  query ActiveProductsForPublication($first: Int!, $after: String, $query: String!) {
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
  query ActiveProductPublicationReadback($id: ID!) {
    node(id: $id) {
      ... on Product {
        ${PRODUCT_SELECTION}
      }
    }
  }
`;

const PUBLISH_PRODUCT_MUTATION = /* GraphQL */ `
  mutation PublishActiveProduct($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      publishable {
        ... on Product {
          id
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

function isActiveProduct(product) {
  return normalizeText(product?.status).toUpperCase() === "ACTIVE";
}

function parseArgs(argv) {
  const args = {
    mode: "dry-run",
    output: defaultOutputPath,
    sample: 0,
    productHandlesFile: "",
    concurrency: envInteger(
      "SALT_SHOPIFY_PUBLICATION_CONCURRENCY",
      recommendedConcurrency({ kind: "io", reserve: 2, max: 4 }),
      { min: 1, max: 4 },
    ),
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
    if (token === "--concurrency") {
      args.concurrency = Math.max(1, Number(argv[index + 1] || 1) || 1);
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

function publicationSignature(publications) {
  return asArray(publications)
    .map((publication) => `${publication.id}:${normalizeText(publication.name)}`)
    .sort()
    .join("|");
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
    throw new Error(`Approved all-channel publication verification failed: ${details}`);
  }
}

async function fetchPublications(retryInfo) {
  const publications = [];
  let after = null;
  let page = 0;
  while (true) {
    page += 1;
    const data = await client.run(
      PUBLICATIONS_QUERY,
      { first: 250, after },
      { operation: `sales channel publication page ${page}`, retryInfo },
    );
    const connection = data?.publications;
    if (!connection) {
      throw new Error("Shopify returned no publications connection. Grant read_publications access before this release.");
    }
    publications.push(...asArray(connection.nodes).filter((publication) => publication?.id));
    if (!connection.pageInfo?.hasNextPage) break;
    if (!connection.pageInfo.endCursor) throw new Error(`Publication page ${page} hasNextPage without an end cursor.`);
    after = connection.pageInfo.endCursor;
  }

  const unique = new Map();
  for (const publication of publications) unique.set(publication.id, publication);
  const result = [...unique.values()].sort((left, right) => normalizeText(left.name).localeCompare(normalizeText(right.name)));
  if (!result.length) {
    throw new Error("No sales-channel publications were returned. Refusing to mark any product as fully published.");
  }
  return result;
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
      { operation: `active product publication page ${page}`, retryInfo },
    );
    const connection = data?.products;
    if (!connection) {
      throw new Error("Shopify returned no products connection. Grant read_products access before this release.");
    }
    for (const product of asArray(connection.nodes)) {
      if (!isActiveProduct(product)) {
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

async function writeManifest(filePath, manifest) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

function statusForPlan(plan, mode) {
  if (plan.publicationIds.length) return mode === "apply" ? "pending" : "would-publish";
  if (plan.subscriptionExcludedIds.length) return mode === "apply" ? "pending" : "subscription-restricted";
  return "already-published";
}

function taskFromPlan(plan, mode) {
  return {
    productId: plan.productId,
    handle: plan.handle,
    title: plan.title,
    requiresSellingPlan: plan.requiresSellingPlan,
    publicationIds: plan.publicationIds,
    publicationNames: plan.publicationNames,
    subscriptionExcludedIds: plan.subscriptionExcludedIds,
    subscriptionExcludedNames: plan.subscriptionExcludedNames,
    status: statusForPlan(plan, mode),
    verifiedAt: "",
    failure: "",
  };
}

function refreshSummary(manifest) {
  const tasks = asArray(manifest.tasks);
  manifest.summary.wouldPublish = tasks.filter((task) => task.status === "would-publish").length;
  manifest.summary.publishedVerified = tasks.filter((task) => task.status === "published-verified").length;
  manifest.summary.alreadyPublished = tasks.filter((task) => task.status === "already-published").length;
  manifest.summary.subscriptionRestricted = tasks.filter((task) => task.status === "subscription-restricted" || task.status === "subscription-restricted-verified").length;
  manifest.summary.skippedNotActive = tasks.filter((task) => task.status === "skipped-not-active").length;
  manifest.summary.skippedMissing = tasks.filter((task) => task.status === "skipped-missing").length;
  manifest.summary.failed = tasks.filter((task) => task.status === "failed").length;
}

const resumableStatuses = new Set([
  "published-verified",
  "subscription-restricted-verified",
  "already-published",
  "skipped-not-active",
  "skipped-missing",
]);

async function mergeResumableTasks(manifest, outputPath, args) {
  if (args.mode !== "apply") return;
  let previous;
  try {
    previous = JSON.parse(await readFile(outputPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  const sameScope = previous?.mode === "apply"
    && previous?.source?.productHandlesFile === (args.productHandlesFile || null)
    && previous?.summary?.selectedProducts === manifest.summary.selectedProducts
    && Array.isArray(previous.tasks);
  if (!sameScope) return;

  const previousById = new Map(previous.tasks.map((task) => [task.productId, task]));
  for (const task of manifest.tasks) {
    const prior = previousById.get(task.productId);
    if (!prior || !resumableStatuses.has(prior.status)) continue;
    task.status = prior.status;
    task.verifiedAt = prior.verifiedAt || "";
    task.failure = prior.failure || "";
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.mode === "apply") await verifyApprovalForApply();

  const retryInfo = [];
  const productHandles = await readProductHandles(args.productHandlesFile);
  const publications = await fetchPublications(retryInfo);
  const activeProducts = await fetchActiveProducts(retryInfo);
  const scopedProducts = productHandles
    ? activeProducts.filter((product) => productHandles.has(normalizeText(product.handle).toLowerCase()))
    : activeProducts;
  const selectedProducts = args.sample > 0 ? scopedProducts.slice(0, args.sample) : scopedProducts;
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
      publications: publications.map((publication) => ({ id: publication.id, name: normalizeText(publication.name) })),
      freshLiveRead: true,
    },
    policy: {
      scope: args.productHandlesFile
        ? "active products in the supplied cohort only; all other products are unchanged"
        : "active products only; draft and archived products are unchanged",
      target: "all available Shopify sales-channel publications",
      subscriptionOnly: "publish Online Store only and verify all other known publications remain unpublished",
      readback: "the fresh live catalog scan proves no-op products; every product requiring a write or subscription exclusion is freshly read and verified afterward",
      productCategoryMutation: "none; this workflow only changes publication state",
    },
    summary: {
      availablePublications: publications.length,
      activeProducts: activeProducts.length,
      selectedProducts: selectedProducts.length,
      wouldPublish: 0,
      publishedVerified: 0,
      alreadyPublished: 0,
      subscriptionRestricted: 0,
      skippedNotActive: 0,
      skippedMissing: 0,
      failed: 0,
    },
    retryInfo,
    tasks: selectedProducts.map((product) => taskFromPlan(planProductPublication(product, publications), args.mode)),
  };

  await mergeResumableTasks(manifest, args.output, args);
  refreshSummary(manifest);
  await writeManifest(args.output, manifest);

  if (args.mode === "dry-run") {
    manifest.completedAt = new Date().toISOString();
    refreshSummary(manifest);
    await writeManifest(args.output, manifest);
    process.stdout.write(`All-channel publication dry run complete: ${manifest.summary.wouldPublish} active products need channel publication.\n`);
    return;
  }

  async function applyTask(task) {
    const taskRetryInfo = [];
    try {
      const current = await fetchProductById(task.productId, taskRetryInfo, `publication pre-write read ${task.handle}`);
      if (!current) {
        task.status = "skipped-missing";
      } else if (!isActiveProduct(current)) {
        task.status = "skipped-not-active";
      } else {
        const currentPlan = planProductPublication(current, publications);
        task.publicationIds = currentPlan.publicationIds;
        task.publicationNames = currentPlan.publicationNames;
        task.subscriptionExcludedIds = currentPlan.subscriptionExcludedIds;
        task.subscriptionExcludedNames = currentPlan.subscriptionExcludedNames;

        if (currentPlan.publicationIds.length) {
          const data = await client.run(
            PUBLISH_PRODUCT_MUTATION,
            {
              id: current.id,
              input: currentPlan.publicationIds.map((publicationId) => ({ publicationId })),
            },
            { allowMutations: true, operation: `publish active product ${task.handle}`, retryInfo: taskRetryInfo },
          );
          const errors = formatUserErrors(data?.publishablePublish?.userErrors);
          if (errors) throw new Error(errors);
        }

        const readback = await fetchProductById(task.productId, taskRetryInfo, `publication readback ${task.handle}`);
        if (!readback || !isActiveProduct(readback)) {
          throw new Error("Product was not active during publication readback.");
        }
        const verification = verifyProductPublicationReadback(
          readback,
          currentPlan.publicationIds,
          currentPlan.subscriptionExcludedIds,
        );
        if (!verification.ok) {
          throw new Error(
            `Publication readback mismatch: missing=${verification.missing.join(",") || "none"}; ` +
            `unexpectedSubscriptionPublication=${verification.unexpectedPublished.join(",") || "none"}.`,
          );
        }

        task.status = currentPlan.publicationIds.length
          ? "published-verified"
          : currentPlan.subscriptionExcludedIds.length
            ? "subscription-restricted-verified"
            : "already-published";
      }
      task.verifiedAt = new Date().toISOString();
    } catch (error) {
      task.status = "failed";
      task.failure = normalizeText(error?.message || error);
      task.verifiedAt = new Date().toISOString();
    }
    manifest.retryInfo.push(...taskRetryInfo);
  }

  let manifestWrite = Promise.resolve();
  const persistManifest = async () => {
    manifestWrite = manifestWrite.then(() => writeManifest(args.output, manifest));
    await manifestWrite;
  };
  const pendingTasks = manifest.tasks.filter((task) => task.status === "pending");
  let nextTaskIndex = 0;
  const applyWorker = async () => {
    while (nextTaskIndex < pendingTasks.length) {
      const task = pendingTasks[nextTaskIndex];
      nextTaskIndex += 1;
      await applyTask(task);
      refreshSummary(manifest);
      await persistManifest();
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(args.concurrency, pendingTasks.length) }, () => applyWorker()),
  );

  const finalPublications = await fetchPublications(retryInfo);
  if (publicationSignature(finalPublications) !== publicationSignature(publications)) {
    throw new Error("Shopify sales-channel publication list changed during this release. Rerun the publication phase so every channel is verified.");
  }

  manifest.completedAt = new Date().toISOString();
  refreshSummary(manifest);
  await writeManifest(args.output, manifest);
  if (manifest.summary.failed) {
    throw new Error(`All-channel publication failed for ${manifest.summary.failed} product(s); see ${args.output}.`);
  }
  process.stdout.write(`All-channel publication complete: ${manifest.summary.publishedVerified} active products published and verified.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message || error}\n`);
  process.exitCode = 1;
});
