#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { createRequestScheduler, envInteger, recommendedConcurrency } from "./lib/performance-runtime.mjs";

import {
  buildCatalogTaxonomyReleasePlan,
  buildManagedTagAdditions,
  isActiveShopifyProduct,
  taxonomyMetafieldMatches,
  verifyTaxonomyTaskReadback,
} from "../src/lib/catalog-taxonomy-release.js";
import {
  CATALOG_TAXONOMY_VERSION,
  classifyCatalogTaxonomyByRuleId,
} from "../src/lib/catalog-taxonomy.js";
import { buildProductKnowledgeFromTaxonomy } from "../src/lib/product-knowledge-base.js";
import { readCatalogKnowledgeModel } from "./catalog-knowledge-model-files.mjs";
import { readProductCatalogPayload } from "./product-catalog-files.mjs";

const execFileAsync = promisify(execFile);
const rootDir = resolve(import.meta.dirname, "..");
const inputDir = resolve(rootDir, "public", "data");
const defaultOutputPath = resolve(rootDir, "output", "catalog-taxonomy-apply-manifest.json");
const catalogIntegrityManifestPath = resolve(rootDir, "output", "shopify-catalog-integrity-manifest.json");
const shopBase = process.env.SALT_SHOP_URL;
if (!shopBase) throw new Error("SALT_SHOP_URL is required for Future Light Store taxonomy writes.");
const storeDomain = new URL(shopBase).hostname;
const apiVersion = process.env.SHOPIFY_ADMIN_API_VERSION || "2026-07";
const adminAccessToken = (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.SALT_SHOPIFY_ADMIN_ACCESS_TOKEN || "").trim();
const adminGraphqlUrl = `${new URL(shopBase).origin}/admin/api/${apiVersion}/graphql.json`;
const cliBinary = process.env.SHOPIFY_CLI_BINARY || "shopify";
const cliAgentInfo = process.env.SHOPIFY_CLI_AGENT_INFO || "n:future-light-store|v:1|p:catalog-taxonomy-release";
const cliAgentIds =
  process.env.SHOPIFY_CLI_AGENT_IDS ||
  `s:${process.env.CONVERSATION_ID || "local"}|r:${process.pid}|i:catalog-taxonomy-release`;
const requestDelayMs = Math.max(0, Number(process.env.SALT_SHOPIFY_REQUEST_DELAY_MS || 125));
const requestConcurrency = envInteger(
  "SALT_SHOPIFY_REQUEST_CONCURRENCY",
  recommendedConcurrency({ kind: "io", reserve: 2, max: 8 }),
  { min: 1, max: 8 },
);
const maxAttempts = Math.max(1, Number(process.env.SALT_SHOPIFY_MAX_REQUEST_ATTEMPTS || 5));
const maxRetryDelayMs = Math.max(1000, Number(process.env.SALT_SHOPIFY_MAX_RETRY_DELAY_MS || 30_000));
const batchSize = Math.max(1, Math.min(25, Number(process.env.SALT_CATALOG_TAXONOMY_BATCH_SIZE || 20)));
const concurrency = Math.max(
  1,
  Math.min(8, Number(process.env.SALT_CATALOG_TAXONOMY_CONCURRENCY || recommendedConcurrency({ kind: "cpu", reserve: 1, max: 8 }))),
);
const activeProductQuery = "status:active";

const PRODUCT_SELECTION = /* GraphQL */ `
  id
  handle
  title
  descriptionHtml
  productType
  vendor
  status
  tags
  taxonomyMetafield: metafield(namespace: "salt_taxonomy", key: "classification") {
    namespace
    key
    type
    value
  }
`;

const ACTIVE_PRODUCTS_QUERY = /* GraphQL */ `
  query CatalogTaxonomyProducts($first: Int!, $after: String, $query: String!) {
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

const PRODUCTS_BY_ID_QUERY = /* GraphQL */ `
  query CatalogTaxonomyProductsById($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        ${PRODUCT_SELECTION}
      }
    }
  }
`;

const METAFIELDS_SET_MUTATION = /* GraphQL */ `
  mutation CatalogTaxonomyMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        namespace
        key
        type
        value
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

const STAGED_UPLOAD_CREATE_MUTATION = /* GraphQL */ `
  mutation CatalogTaxonomyStagedUpload($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url parameters { name value } }
      userErrors { field message }
    }
  }
`;

const BULK_OPERATION_RUN_MUTATION = /* GraphQL */ `
  mutation CatalogTaxonomyRunBulk($mutation: String!, $stagedUploadPath: String!) {
    bulkOperationRunMutation(mutation: $mutation, stagedUploadPath: $stagedUploadPath) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }
`;

const BULK_OPERATION_STATUS_QUERY = /* GraphQL */ `
  query CatalogTaxonomyBulkStatus($id: ID!) {
    bulkOperation(id: $id) {
      id status errorCode objectCount fileSize url partialDataUrl createdAt completedAt
    }
  }
`;

const BULK_METAFIELDS_SET_MUTATION = /* GraphQL */ `
  mutation CatalogTaxonomyBulkMetafields($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id namespace key }
      userErrors { field message code }
    }
  }
`;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function parseArgs(argv) {
  const args = {
    mode: "dry-run",
    output: defaultOutputPath,
    sample: 0,
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
    }
  }

  return args;
}

function getCliEnv() {
  return {
    ...process.env,
    SHOPIFY_CLI_AGENT_INFO: cliAgentInfo,
    SHOPIFY_CLI_AGENT_IDS: cliAgentIds,
  };
}

function formatGraphqlErrors(errors) {
  return asArray(errors)
    .map((entry) => normalizeText(entry?.message || "Unknown Shopify GraphQL error"))
    .filter(Boolean)
    .join(" | ");
}

function parseGraphQlPayload(raw) {
  const text = String(raw || "").trim();
  const jsonStart = text.indexOf("{");
  if (jsonStart < 0) {
    throw new Error(text || "Shopify returned no JSON payload");
  }

  const payload = JSON.parse(text.slice(jsonStart));
  if (asArray(payload?.errors).length) {
    throw new Error(formatGraphqlErrors(payload.errors));
  }
  if (asArray(payload?.data?.errors).length) {
    throw new Error(formatGraphqlErrors(payload.data.errors));
  }
  return payload?.data || payload || {};
}

function isRetryable(error) {
  return /429|rate limit|throttl|timeout|timed out|5\d\d|network|socket|und_err_socket|econnreset|econnrefused|fetch failed|invalid response body|temporar|aborted|enotfound|eai_again|getaddrinfo|dns/i.test(
    String(error?.message || error),
  );
}

const requestScheduler = createRequestScheduler({ concurrency: requestConcurrency, minIntervalMs: requestDelayMs });

async function runShopifyGraphQLInternal(query, variables, { allowMutations = false, operation = "Shopify request", retryInfo = [] } = {}) {

  let attempt = 0;
  while (true) {
    try {
      if (adminAccessToken) {
        const response = await fetch(adminGraphqlUrl, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": adminAccessToken,
          },
          body: JSON.stringify({ query, variables: variables || {} }),
        });
        const raw = await response.text();
        if (!response.ok) {
          throw new Error(`Admin GraphQL HTTP ${response.status}: ${raw.slice(0, 500)}`);
        }
        return parseGraphQlPayload(raw);
      }

      const tempDir = await mkdtemp(join(tmpdir(), "salt-catalog-taxonomy-"));
      const queryPath = join(tempDir, "operation.graphql");
      const variablesPath = join(tempDir, "variables.json");
      const outputFile = join(tempDir, "result.json");
      try {
        await Promise.all([
          writeFile(queryPath, query, "utf8"),
          writeFile(variablesPath, JSON.stringify(variables || {}, null, 2), "utf8"),
        ]);
        const args = [
          "store",
          "execute",
          "--store",
          storeDomain,
          "--version",
          apiVersion,
          "--query-file",
          queryPath,
          "--variable-file",
          variablesPath,
          "--output-file",
          outputFile,
          "--json",
        ];
        if (allowMutations) {
          args.push("--allow-mutations");
        }
        const result = await execFileAsync(cliBinary, args, {
          cwd: rootDir,
          env: getCliEnv(),
          maxBuffer: 20 * 1024 * 1024,
        });
        let raw = result.stdout || "";
        try {
          raw = await readFile(outputFile, "utf8");
        } catch {
          // Some Shopify CLI versions only emit the JSON response on stdout.
        }
        return parseGraphQlPayload(raw);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    } catch (error) {
      if (!isRetryable(error) || attempt >= maxAttempts - 1) {
        throw new Error(`${operation} failed: ${normalizeText(error?.message || error)}`);
      }

      const delayMs = Math.min(maxRetryDelayMs, Math.max(requestDelayMs, 1000 * 2 ** attempt));
      retryInfo.push({
        operation,
        attempt: attempt + 1,
        delayMs,
        message: normalizeText(error?.message || error).slice(0, 500),
        at: new Date().toISOString(),
      });
      process.stdout.write(`${operation} failed; retrying in ${Math.ceil(delayMs / 1000)}s\n`);
      await sleep(delayMs);
      attempt += 1;
    }
  }
}

async function runShopifyGraphQL(query, variables, options = {}) {
  return requestScheduler.run(() => runShopifyGraphQLInternal(query, variables, options));
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
    throw new Error(`Approved taxonomy release verification failed: ${details}`);
  }
}

function assertActiveProduct(product, operation) {
  if (!isActiveShopifyProduct(product)) {
    throw new Error(`${operation}: ${product?.handle || product?.id || "unknown product"} is not active.`);
  }
}

async function fetchActiveProducts(retryInfo) {
  const products = [];
  let after = null;
  let page = 0;

  while (true) {
    page += 1;
    const data = await runShopifyGraphQL(
      ACTIVE_PRODUCTS_QUERY,
      { first: 250, after, query: activeProductQuery },
      { operation: `active product page ${page}`, retryInfo },
    );
    const connection = data?.products;
    if (!connection) {
      throw new Error("Shopify returned no products connection. Grant read_products access before this release.");
    }

    for (const product of asArray(connection.nodes)) {
      assertActiveProduct(product, "active product query");
      products.push(product);
    }

    if (!connection.pageInfo?.hasNextPage) {
      break;
    }
    if (!connection.pageInfo.endCursor) {
      throw new Error(`Active product page ${page} hasNextPage without an end cursor.`);
    }
    after = connection.pageInfo.endCursor;
  }

  return products;
}

async function fetchProductsById(ids, retryInfo, operation) {
  const uniqueIds = [...new Set(asArray(ids).filter(Boolean))];
  if (!uniqueIds.length) {
    return new Map();
  }

  const data = await runShopifyGraphQL(
    PRODUCTS_BY_ID_QUERY,
    { ids: uniqueIds },
    { operation, retryInfo },
  );
  const products = asArray(data?.nodes).filter((product) => product?.id);
  for (const product of products) {
    assertActiveProduct(product, operation);
  }
  return new Map(products.map((product) => [product.id, product]));
}

async function writeManifest(filePath, manifest) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

function manifestTask(task, status = "pending") {
  return {
    productId: task.productId,
    localProductId: task.localProductId,
    handle: task.handle,
    title: task.title,
    initialTags: task.initialTags,
    proposedTags: task.proposedTags,
    tagsToAdd: task.tagsToAdd,
    taxonomyMetafield: task.taxonomyMetafield,
    metafieldNeedsUpdate: task.metafieldNeedsUpdate,
    knowledge: task.knowledge,
    status,
    verifiedAt: "",
    failure: "",
  };
}

function refreshManifestSummary(manifest) {
  const tasks = asArray(manifest.tasks);
  manifest.summary.wouldUpdate = tasks.filter((task) => task.status === "would-update").length;
  manifest.summary.updatedVerified = tasks.filter((task) => task.status === "updated-verified").length;
  manifest.summary.exact = tasks.filter((task) => task.status === "skipped-exact-match").length;
  manifest.summary.failed = tasks.filter((task) => task.status === "failed").length;
  manifest.summary.tagsToAdd = tasks.reduce((total, task) => total + asArray(task.tagsToAdd).length, 0);
  manifest.summary.metafieldsToSet = tasks.filter((task) => task.metafieldNeedsUpdate).length;
}

function createManifest({ mode, plan, output }) {
  return {
    schemaVersion: 1,
    runId: `${Date.now()}-${process.pid}`,
    startedAt: new Date().toISOString(),
    completedAt: "",
    mode,
    output,
    source: {
      catalog: resolve(inputDir, "products.json"),
      store: storeDomain,
      apiVersion,
      productQuery: activeProductQuery,
    },
    policy: {
      scope: "all active Shopify products before final sales-channel publication",
      salesChannelQuery: "none; publication is intentionally deferred to the final release phase",
      publicationMutation: "none",
      existingTags: "preserve exactly",
      managedTags: "unchanged; exact collection integrity is authoritative",
      prices: "preserve",
      variants: "no mutation",
      collections: "no mutation",
      categoryMutation: "no mutation in taxonomy tag/metafield phase",
      metafield: "salt_taxonomy.classification JSON only",
      classificationSource: "completed full-catalog collection-integrity manifest",
      readback: "unchanged tag superset and exact classification metafield required",
      batchSize,
      concurrency,
    },
    summary: {
      ...plan.summary,
      wouldUpdate: 0,
      updatedVerified: 0,
      exact: 0,
      failed: 0,
    },
    skipped: plan.skipped,
    retryInfo: [],
    tasks: plan.tasks.map((task) => manifestTask(task)),
  };
}

function markFailed(manifestTaskEntry, error) {
  manifestTaskEntry.status = "failed";
  manifestTaskEntry.failure = normalizeText(error?.message || error);
  manifestTaskEntry.verifiedAt = new Date().toISOString();
}

function refreshTaskAgainstLive(task, liveProduct) {
  assertActiveProduct(liveProduct, "Pre-write readback");
  const taxonomyMetafield = task.taxonomyMetafield;
  return {
    ...task,
    initialTags: asArray(liveProduct.tags).map(normalizeText).filter(Boolean),
    tagsToAdd: task.mutateTags
      ? buildManagedTagAdditions(liveProduct.tags, task.proposedTags)
      : [],
    metafieldNeedsUpdate: !taxonomyMetafieldMatches(liveProduct, taxonomyMetafield),
  };
}

async function readCatalogIntegrityClassifications(liveProducts) {
  const manifest = JSON.parse(await readFile(catalogIntegrityManifestPath, "utf8"));
  const classifications = asArray(manifest?.classifications);
  const activeCount = Number(manifest?.summary?.activeProducts || 0);
  const failures = Number(manifest?.summary?.failures || 0);
  const guesses = Number(manifest?.summary?.guessedAssignments || 0);

  if (!manifest?.completedAt) {
    throw new Error(`Catalog integrity manifest is incomplete: ${catalogIntegrityManifestPath}`);
  }
  if (failures !== 0 || guesses !== 0) {
    throw new Error(`Catalog integrity manifest is not release-safe: ${failures} failure(s), ${guesses} guess assignment(s).`);
  }
  if (activeCount !== liveProducts.length || classifications.length !== liveProducts.length) {
    throw new Error(
      `Catalog integrity scope drifted: manifest has ${activeCount} active products and ${classifications.length} classifications; Shopify has ${liveProducts.length}.`,
    );
  }

  const byHandle = new Map();
  for (const classification of classifications) {
    const handle = normalizeText(classification?.handle).toLowerCase();
    if (!handle || !classification?.ruleId) {
      throw new Error("Catalog integrity manifest contains a classification without a handle or rule id.");
    }
    if (byHandle.has(handle)) {
      throw new Error(`Catalog integrity manifest contains duplicate handle: ${handle}`);
    }
    byHandle.set(handle, classification);
  }

  for (const product of liveProducts) {
    const handle = normalizeText(product?.handle).toLowerCase();
    if (!byHandle.has(handle)) {
      throw new Error(`Catalog integrity manifest has no classification for active product: ${handle}`);
    }
  }

  return { manifest, byHandle };
}

function buildTagsAddMutation(tasks) {
  const mutations = [];
  const variables = {};
  const aliases = [];

  tasks.forEach((task, index) => {
    if (!task.tagsToAdd.length) {
      return;
    }
    const operationIndex = aliases.length;
    const idVariable = `id${operationIndex}`;
    const tagsVariable = `tags${operationIndex}`;
    const alias = `tag${operationIndex}`;
    variables[idVariable] = task.productId;
    variables[tagsVariable] = task.tagsToAdd;
    aliases.push({ alias, task });
    mutations.push(
      `${alias}: tagsAdd(id: $${idVariable}, tags: $${tagsVariable}) { userErrors { field message } }`,
    );
  });

  if (!mutations.length) {
    return null;
  }

  const declarations = aliases.flatMap((_, index) => [`$id${index}: ID!`, `$tags${index}: [String!]!`]);
  return {
    query: `mutation CatalogTaxonomyTagsAdd(${declarations.join(", ")}) { ${mutations.join(" ")} }`,
    variables,
    aliases,
  };
}

async function applyTagBatch(tasks, retryInfo, batchLabel) {
  const mutation = buildTagsAddMutation(tasks);
  if (!mutation) {
    return;
  }

  const payload = await runShopifyGraphQL(mutation.query, mutation.variables, {
    allowMutations: true,
    operation: `taxonomy tag batch ${batchLabel}`,
    retryInfo,
  });
  const failures = mutation.aliases
    .map(({ alias, task }) => ({ task, errors: asArray(payload?.[alias]?.userErrors) }))
    .filter((entry) => entry.errors.length);
  if (failures.length) {
    throw new Error(
      failures
        .map(({ task, errors }) => `${task.handle}: ${formatGraphqlErrors(errors)}`)
        .join(" | "),
    );
  }
}

async function applyMetafieldBatch(tasks, retryInfo, batchLabel) {
  const pending = tasks.filter((task) => task.metafieldNeedsUpdate);
  if (!pending.length) {
    return;
  }

  const payload = await runShopifyGraphQL(
    METAFIELDS_SET_MUTATION,
    {
      metafields: pending.map((task) => task.taxonomyMetafield),
    },
    {
      allowMutations: true,
      operation: `taxonomy metafield batch ${batchLabel}`,
      retryInfo,
    },
  );
  const errors = asArray(payload?.metafieldsSet?.userErrors);
  if (errors.length) {
    throw new Error(formatGraphqlErrors(errors));
  }
}

function chunkTasks(tasks, size) {
  const chunks = [];
  for (let index = 0; index < tasks.length; index += size) chunks.push(tasks.slice(index, index + size));
  return chunks;
}

async function uploadTaxonomyBulkInput(inputPath, retryInfo) {
  const payload = await runShopifyGraphQL(STAGED_UPLOAD_CREATE_MUTATION, {
    input: [{
      resource: "BULK_MUTATION_VARIABLES",
      filename: basename(inputPath),
      mimeType: "text/jsonl",
      httpMethod: "POST",
    }],
  }, { allowMutations: true, operation: "taxonomy staged upload reservation", retryInfo });
  const userErrors = asArray(payload?.stagedUploadsCreate?.userErrors);
  if (userErrors.length) throw new Error(`Taxonomy staged upload failed: ${formatGraphqlErrors(userErrors)}`);
  const target = payload?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target?.url) throw new Error("Shopify returned no taxonomy staged upload target");
  const curlArgs = ["-sS", "-X", "POST", target.url];
  for (const parameter of asArray(target.parameters)) curlArgs.push("-F", `${parameter.name}=${parameter.value}`);
  curlArgs.push("-F", `file=@${inputPath};type=text/jsonl`);
  await execFileAsync("curl", curlArgs, { cwd: rootDir, maxBuffer: 20 * 1024 * 1024 });
  const stagedUploadPath = asArray(target.parameters).find((parameter) => parameter.name === "key")?.value;
  if (!stagedUploadPath) throw new Error("Shopify taxonomy staged upload target did not include a key");
  return stagedUploadPath;
}

async function waitForTaxonomyBulkOperation(operationId, retryInfo) {
  while (true) {
    const payload = await runShopifyGraphQL(BULK_OPERATION_STATUS_QUERY, { id: operationId }, {
      operation: "taxonomy bulk operation status",
      retryInfo,
    });
    const operation = payload?.bulkOperation;
    if (!operation) throw new Error(`Taxonomy bulk operation not found: ${operationId}`);
    process.stdout.write(`Taxonomy bulk operation: ${operation.status}, ${operation.objectCount || 0} object(s)\n`);
    if (operation.status === "COMPLETED") return operation;
    if (["FAILED", "CANCELED", "EXPIRED"].includes(operation.status)) {
      throw new Error(`Taxonomy bulk operation ended ${operation.status}: ${operation.errorCode || "unknown error"}`);
    }
    await sleep(5000);
  }
}

async function applyTaxonomyMetafieldsBulk({ tasks, retryInfo, output, manifest, manifestById }) {
  const groups = chunkTasks(tasks, 25);
  const inputPath = output.replace(/\.json$/i, "-bulk-input.jsonl");
  const resultPath = output.replace(/\.json$/i, "-bulk-result.jsonl");
  const lines = groups.map((group) => JSON.stringify({
    metafields: group.map((task) => task.taxonomyMetafield),
  }));
  await writeFile(inputPath, `${lines.join("\n")}\n`, "utf8");
  process.stdout.write(`Prepared ${groups.length} taxonomy metafield bulk batch(es) for ${tasks.length} products.\n`);
  const stagedUploadPath = await uploadTaxonomyBulkInput(inputPath, retryInfo);
  const payload = await runShopifyGraphQL(BULK_OPERATION_RUN_MUTATION, {
    mutation: BULK_METAFIELDS_SET_MUTATION,
    stagedUploadPath,
  }, { allowMutations: true, operation: "start taxonomy bulk operation", retryInfo });
  const startErrors = asArray(payload?.bulkOperationRunMutation?.userErrors);
  if (startErrors.length) throw new Error(`Taxonomy bulk operation failed to start: ${formatGraphqlErrors(startErrors)}`);
  const operationId = payload?.bulkOperationRunMutation?.bulkOperation?.id;
  if (!operationId) throw new Error("Shopify returned no taxonomy bulk operation id");
  const operation = await waitForTaxonomyBulkOperation(operationId, retryInfo);
  if (!operation.url) throw new Error("Completed taxonomy bulk operation returned no result URL");
  const response = await fetch(operation.url);
  if (!response.ok) throw new Error(`Taxonomy bulk result download failed (${response.status})`);
  await writeFile(resultPath, Buffer.from(await response.arrayBuffer()));

  const resultLines = (await readFile(resultPath, "utf8")).split(/\r?\n/).filter(Boolean);
  const completed = new Set();
  for (const [fallbackIndex, line] of resultLines.entries()) {
    const result = JSON.parse(line);
    const lineNumber = Number.isInteger(Number(result.__lineNumber)) ? Number(result.__lineNumber) : fallbackIndex;
    const group = groups[lineNumber];
    if (!group) throw new Error(`Taxonomy bulk result returned unknown input line ${lineNumber}`);
    const topLevelErrors = asArray(result.errors);
    if (topLevelErrors.length) {
      throw new Error(`${group[0].handle}: ${formatGraphqlErrors(topLevelErrors)}`);
    }
    const mutationResult = result?.data?.metafieldsSet;
    if (!mutationResult) throw new Error(`${group[0].handle}: taxonomy bulk result returned no metafieldsSet payload`);
    const userErrors = asArray(mutationResult.userErrors);
    if (userErrors.length) throw new Error(`${group[0].handle}: ${formatGraphqlErrors(userErrors)}`);
    completed.add(lineNumber);
  }
  if (completed.size !== groups.length) {
    throw new Error(`Taxonomy bulk result covered ${completed.size}/${groups.length} input line(s)`);
  }

  process.stdout.write("Reading all active taxonomy metafields back after the bulk mutation.\n");
  const finalProducts = await fetchActiveProducts(retryInfo);
  const finalById = new Map(finalProducts.map((product) => [product.id, product]));
  for (const [index, task] of tasks.entries()) {
    const finalProduct = finalById.get(task.productId);
    if (!finalProduct) throw new Error(`${task.handle}: product missing from taxonomy bulk readback`);
    assertTaskReadback(task, finalProduct);
    Object.assign(manifestById.get(task.productId), manifestTask(task, "updated-verified"), {
      verifiedAt: new Date().toISOString(),
    });
    if ((index + 1) % 250 === 0 || index + 1 === tasks.length) {
      process.stdout.write(`Taxonomy bulk readback verified ${index + 1}/${tasks.length} updated product(s).\n`);
    }
  }
  manifest.bulkOperation = {
    id: operation.id,
    status: operation.status,
    objectCount: Number(operation.objectCount || 0),
    completedAt: operation.completedAt || new Date().toISOString(),
    inputPath,
    resultPath,
  };
  refreshManifestSummary(manifest);
  await writeManifest(output, manifest);
}

function assertTaskReadback(task, product) {
  const verification = verifyTaxonomyTaskReadback(task, product);
  if (verification.ok) {
    return;
  }
  const issues = [];
  if (verification.missingExistingTags.length) {
    issues.push(`existing tags missing: ${verification.missingExistingTags.join(", ")}`);
  }
  if (verification.missingManagedTags.length) {
    issues.push(`managed tags missing: ${verification.missingManagedTags.join(", ")}`);
  }
  if (!verification.metafieldMatches) {
    issues.push("classification metafield mismatch");
  }
  throw new Error(issues.join("; "));
}

async function runCatalogTaxonomyRelease({ mode, output, sample }) {
  if (mode === "apply") {
    await verifyApprovalForApply();
  }

  const retryInfo = [];
  const knowledgeModel = await readCatalogKnowledgeModel({
    required: process.env.SALT_REQUIRE_KNOWLEDGE_MODEL === "1",
  });
  const [catalog, liveProducts] = await Promise.all([
    readProductCatalogPayload(inputDir),
    fetchActiveProducts(retryInfo),
  ]);
  const { manifest: integrityManifest, byHandle: classificationByHandle } =
    await readCatalogIntegrityClassifications(liveProducts);
  const localByHandle = new Map(
    asArray(catalog.products)
      .map((product) => [normalizeText(product?.handle).toLowerCase(), product])
      .filter(([handle]) => Boolean(handle)),
  );
  const sourceProducts = liveProducts.map((liveProduct) => {
    const handle = normalizeText(liveProduct?.handle).toLowerCase();
    const localProduct = localByHandle.get(handle) || {};
    return {
      ...localProduct,
      id: localProduct.id || liveProduct.id,
      handle: liveProduct.handle || localProduct.handle,
      title: localProduct.title || liveProduct.title,
      body_html: localProduct.body_html || liveProduct.descriptionHtml,
      product_type: localProduct.product_type || liveProduct.productType,
      vendor: liveProduct.vendor || localProduct.vendor,
      tags: asArray(liveProduct.tags),
    };
  });
  const localProducts = sample > 0 ? sourceProducts.slice(0, sample) : sourceProducts;
  const knowledgeByHandle = new Map(localProducts.map((product) => {
    const handle = normalizeText(product?.handle).toLowerCase();
    const frozen = classificationByHandle.get(handle);
    const taxonomy = classifyCatalogTaxonomyByRuleId(product, frozen.ruleId, {
      source: `catalog-integrity-${frozen.source || "verified"}`,
      reason: "Frozen full-catalog collection-integrity classification",
    });
    return [handle, buildProductKnowledgeFromTaxonomy(product, taxonomy, { knowledgeModel })];
  }));
  const plan = buildCatalogTaxonomyReleasePlan(localProducts, liveProducts, {
    mutateTags: false,
    knowledgeByHandle,
    knowledgeModel,
  });
  const manifest = createManifest({ mode, plan, output });
  manifest.taxonomyVersion = CATALOG_TAXONOMY_VERSION;
  manifest.catalogIntegrityManifest = {
    path: catalogIntegrityManifestPath,
    completedAt: integrityManifest.completedAt,
    activeProducts: integrityManifest.summary.activeProducts,
    classifications: integrityManifest.classifications.length,
    failures: integrityManifest.summary.failures,
    guessedAssignments: integrityManifest.summary.guessedAssignments,
  };
  manifest.retryInfo = retryInfo;

  if (mode === "dry-run") {
    for (const entry of manifest.tasks) {
      entry.status = entry.tagsToAdd.length || entry.metafieldNeedsUpdate ? "would-update" : "skipped-exact-match";
    }
    manifest.completedAt = new Date().toISOString();
    refreshManifestSummary(manifest);
    await writeManifest(output, manifest);
    process.stdout.write(
      `Catalog taxonomy dry run complete: ${manifest.summary.wouldUpdate} would update, ${manifest.summary.exact} exact, ${manifest.summary.skipped} skipped.\n`,
    );
    return manifest;
  }

  const manifestById = new Map(manifest.tasks.map((task) => [task.productId, task]));
  // Re-read every product that still needs a mutation. Exact products are
  // excluded on resume so an interrupted release only retries live mismatches.
  const actionableTasks = plan.tasks.filter(
    (task) => task.tagsToAdd.length > 0 || task.metafieldNeedsUpdate,
  );

  const useMetafieldBulk =
    actionableTasks.length >= Math.max(1, Number(process.env.SALT_CATALOG_TAXONOMY_BULK_THRESHOLD || 500)) &&
    actionableTasks.every((task) => task.tagsToAdd.length === 0 && task.metafieldNeedsUpdate);
  if (useMetafieldBulk) {
    await applyTaxonomyMetafieldsBulk({
      tasks: actionableTasks,
      retryInfo: manifest.retryInfo,
      output,
      manifest,
      manifestById,
    });
    for (const task of plan.tasks) {
      const entry = manifestById.get(task.productId);
      if (entry?.status === "pending") {
        entry.status = "skipped-exact-match";
        entry.verifiedAt = new Date().toISOString();
      }
    }
    manifest.completedAt = new Date().toISOString();
    refreshManifestSummary(manifest);
    await writeManifest(output, manifest);
    process.stdout.write(
      `Catalog taxonomy release complete: ${manifest.summary.updatedVerified} updated and verified, ${manifest.summary.exact} exact, ${manifest.summary.skipped} skipped.\n`,
    );
    return manifest;
  }

  // Batches are disjoint, so they can be verified concurrently. Checkpoint
  // writes remain serialized to keep the manifest valid if a worker fails.
  const batchTotal = Math.ceil(actionableTasks.length / batchSize);
  let nextBatchIndex = 0;
  let firstFailure = null;
  let manifestWriteChain = Promise.resolve();
  const queueManifestWrite = () => {
    manifestWriteChain = manifestWriteChain.then(async () => {
      refreshManifestSummary(manifest);
      await writeManifest(output, manifest);
    });
    return manifestWriteChain;
  };

  const processBatch = async (batch, batchLabel) => {
    const batchRetryInfo = [];

    try {
      const currentById = await fetchProductsById(
        batch.map((task) => task.productId),
        batchRetryInfo,
        `taxonomy pre-write read batch ${batchLabel}`,
      );
      const currentTasks = [];
      for (const task of batch) {
        const current = currentById.get(task.productId);
        const manifestTaskEntry = manifestById.get(task.productId);
        if (!current) {
          throw new Error(`${task.handle}: product is no longer active.`);
        }
        const refreshed = refreshTaskAgainstLive(task, current);
        currentTasks.push(refreshed);
        Object.assign(manifestTaskEntry, manifestTask(refreshed));
      }

      await Promise.all([
        applyTagBatch(currentTasks, batchRetryInfo, batchLabel),
        applyMetafieldBatch(currentTasks, batchRetryInfo, batchLabel),
      ]);

      const finalById = await fetchProductsById(
        currentTasks.map((task) => task.productId),
        batchRetryInfo,
        `taxonomy final readback batch ${batchLabel}`,
      );
      for (const task of currentTasks) {
        const manifestTaskEntry = manifestById.get(task.productId);
        const finalProduct = finalById.get(task.productId);
        if (!finalProduct) {
          throw new Error(`${task.handle}: product disappeared or became inactive before readback.`);
        }
        assertTaskReadback(task, finalProduct);
        const changed = task.tagsToAdd.length > 0 || task.metafieldNeedsUpdate;
        Object.assign(manifestTaskEntry, manifestTask(task, changed ? "updated-verified" : "skipped-exact-match"), {
          verifiedAt: new Date().toISOString(),
        });
      }
      process.stdout.write(`Catalog taxonomy batch ${batchLabel} verified (${currentTasks.length} products)\n`);
    } catch (error) {
      for (const task of batch) {
        const entry = manifestById.get(task.productId);
        if (entry?.status !== "updated-verified") {
          markFailed(entry, error);
        }
      }
      manifest.retryInfo.push(...batchRetryInfo);
      await queueManifestWrite();
      throw error;
    }

    manifest.retryInfo.push(...batchRetryInfo);
    await queueManifestWrite();
  };

  const worker = async () => {
    while (!firstFailure) {
      const batchIndex = nextBatchIndex;
      nextBatchIndex += 1;
      if (batchIndex >= batchTotal) {
        return;
      }

      const start = batchIndex * batchSize;
      const batch = actionableTasks.slice(start, start + batchSize);
      try {
        await processBatch(batch, `${batchIndex + 1}/${batchTotal}`);
      } catch (error) {
        firstFailure ||= error;
        return;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, batchTotal) }, () => worker()),
  );
  await manifestWriteChain;
  if (firstFailure) {
    throw firstFailure;
  }

  for (const task of plan.tasks) {
    const entry = manifestById.get(task.productId);
    if (entry?.status === "pending") {
      entry.status = "skipped-exact-match";
      entry.verifiedAt = new Date().toISOString();
    }
  }

  manifest.completedAt = new Date().toISOString();
  refreshManifestSummary(manifest);
  await writeManifest(output, manifest);
  process.stdout.write(
    `Catalog taxonomy release complete: ${manifest.summary.updatedVerified} updated and verified, ${manifest.summary.exact} exact, ${manifest.summary.skipped} skipped.\n`,
  );
  return manifest;
}

async function main() {
  const args = parseArgs(process.argv);
  await runCatalogTaxonomyRelease(args);
}

main().catch((error) => {
  process.stderr.write(`${error.message || error}\n`);
  process.exitCode = 1;
});
