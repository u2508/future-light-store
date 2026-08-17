#!/usr/bin/env node

import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { promisify } from "node:util";

import {
  GOOGLE_VARIANT_METAFIELD_DEFINITIONS,
  buildGoogleVariantMetafieldPlan,
  normalizeSingleLineText,
} from "../src/lib/shopify-variant-google-metafields.js";

const execFileAsync = promisify(execFile);
const rootDir = resolve(import.meta.dirname, "..");
const storeDomain = new URL(process.env.SALT_SHOP_URL || "").hostname;
const apiVersion = process.env.SHOPIFY_ADMIN_API_VERSION || "2026-07";
const cliBinary = process.env.SHOPIFY_CLI_BINARY || "shopify";
const requestDelayMs = Math.max(0, Number(process.env.SALT_SHOPIFY_REQUEST_DELAY_MS || 300));
const maxAttempts = Math.max(1, Number(process.env.SALT_SHOPIFY_MAX_REQUEST_ATTEMPTS || 6));
const defaultManifestPath = resolve(rootDir, "output", "shopify-variant-google-metafield-manifest.json");
const defaultStatePath = resolve(rootDir, "output", "shopify-variant-google-metafield-state.json");
const defaultHandlesPath = resolve(rootDir, "output", "shopify-seo-scope-handles.json");
const defaultCatalogCheckpointPath = resolve(rootDir, "output", ".shopify-variant-google-catalog-pages.jsonl");
const maxVariantsPerMutation = Math.max(1, Math.min(250, Number(process.env.SALT_SHOPIFY_VARIANT_BULK_SIZE || 250)));
const maxProductOperationsPerMutation = Math.max(1, Math.min(25, Number(process.env.SALT_SHOPIFY_VARIANT_PRODUCT_OPERATIONS || 25)));
const bulkOperationThreshold = Math.max(1, Number(process.env.SALT_SHOPIFY_VARIANT_BULK_OPERATION_THRESHOLD || 5000));
const maxBulkInputBytes = Math.max(10 * 1024 * 1024, Math.min(90 * 1024 * 1024, Number(process.env.SALT_SHOPIFY_BULK_INPUT_MAX_BYTES || 80 * 1024 * 1024)));

const VARIANT_FIELDS = /* GraphQL */ `
  id
  legacyResourceId
  title
  sku
  barcode
  selectedOptions { name value }
  product {
    id
    handle
    title
    productType
    tags
    category { id fullName }
  }
  ageGroup: metafield(namespace: "mm-google-shopping", key: "age_group") { type value }
  condition: metafield(namespace: "mm-google-shopping", key: "condition") { type value }
  gender: metafield(namespace: "mm-google-shopping", key: "gender") { type value }
  mpn: metafield(namespace: "mm-google-shopping", key: "mpn") { type value }
  sizeSystem: metafield(namespace: "mm-google-shopping", key: "size_system") { type value }
`;

const METAFIELD_READBACK_FIELDS = /* GraphQL */ `
  id
  ageGroup: metafield(namespace: "mm-google-shopping", key: "age_group") { value }
  condition: metafield(namespace: "mm-google-shopping", key: "condition") { value }
  gender: metafield(namespace: "mm-google-shopping", key: "gender") { value }
  mpn: metafield(namespace: "mm-google-shopping", key: "mpn") { value }
  sizeSystem: metafield(namespace: "mm-google-shopping", key: "size_system") { value }
`;

const ALL_VARIANTS_QUERY = /* GraphQL */ `
  query GoogleVariantMetafieldCatalog($first: Int!, $after: String) {
    productVariants(first: $first, after: $after, sortKey: ID) {
      nodes { ${VARIANT_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const DEFINITIONS_QUERY = /* GraphQL */ `
  query GoogleVariantMetafieldDefinitions {
    metafieldDefinitions(first: 100, ownerType: PRODUCTVARIANT) {
      nodes { id name namespace key ownerType type { name } }
    }
  }
`;

const STAGED_UPLOAD_CREATE_MUTATION = /* GraphQL */ `
  mutation VariantMetafieldStagedUpload($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url resourceUrl parameters { name value } }
      userErrors { field message }
    }
  }
`;

const BULK_OPERATION_RUN_MUTATION = /* GraphQL */ `
  mutation RunVariantMetafieldBulkOperation($mutation: String!, $stagedUploadPath: String!) {
    bulkOperationRunMutation(mutation: $mutation, stagedUploadPath: $stagedUploadPath) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }
`;

const BULK_OPERATION_STATUS_QUERY = /* GraphQL */ `
  query VariantMetafieldBulkOperationStatus($id: ID!) {
    bulkOperation(id: $id) {
      id status errorCode objectCount fileSize url partialDataUrl createdAt completedAt
    }
  }
`;

function parseArgs(argv) {
  const args = {
    mode: "dry-run",
    scope: "new-products",
    manifestPath: defaultManifestPath,
    statePath: defaultStatePath,
    handlesPath: defaultHandlesPath,
    productHandlesFile: "",
    catalogCheckpointPath: defaultCatalogCheckpointPath,
    sample: 0,
    forceBulk: false,
    bulkResultPath: "",
    planManifestPath: "",
  };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--apply") args.mode = "apply";
    else if (token === "--dry-run") args.mode = "dry-run";
    else if (token === "--force-bulk") args.forceBulk = true;
    else if (token === "--bulk-result") {
      args.bulkResultPath = resolve(rootDir, next || "");
      index += 1;
    } else if (token === "--plan-manifest") {
      args.planManifestPath = resolve(rootDir, next || "");
      index += 1;
    }
    else if (token === "--scope") {
      args.scope = next;
      index += 1;
    } else if (token === "--all-products") args.scope = "all-products";
    else if (token === "--new-products-only") args.scope = "new-products";
    else if (token === "--output" || token === "--manifest") {
      args.manifestPath = resolve(rootDir, next || "");
      index += 1;
    } else if (token === "--state") {
      args.statePath = resolve(rootDir, next || "");
      index += 1;
    } else if (token === "--handles-output") {
      args.handlesPath = resolve(rootDir, next || "");
      index += 1;
    } else if (token === "--product-handles-file") {
      args.productHandlesFile = resolve(rootDir, next || "");
      index += 1;
    } else if (token === "--catalog-checkpoint") {
      args.catalogCheckpointPath = resolve(rootDir, next || "");
      index += 1;
    } else if (token === "--sample") {
      args.sample = Math.max(0, Number(next) || 0);
      index += 1;
    }
  }
  if (!["all-products", "new-products"].includes(args.scope)) {
    throw new Error(`Invalid --scope ${args.scope}; expected all-products or new-products`);
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function parsePayload(raw) {
  const text = String(raw || "").trim();
  const start = text.indexOf("{");
  if (start < 0) throw new Error(text || "Shopify CLI returned no JSON payload");
  const payload = JSON.parse(text.slice(start));
  if (payload.errors?.length) throw new Error(payload.errors.map((error) => error.message).join(" | "));
  return payload.data || payload;
}

let lastRequestAt = 0;
async function executeGraphQl(query, variables = {}, { mutation = false, operation = "Shopify request" } = {}) {
  const waitMs = requestDelayMs - (Date.now() - lastRequestAt);
  if (waitMs > 0) await sleep(waitMs);
  const cliArgs = [
    "store", "execute", "--store", storeDomain, "--version", apiVersion,
    "--query", query, "--variables", JSON.stringify(variables), "--json",
  ];
  if (mutation) cliArgs.push("--allow-mutations");

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const result = await execFileAsync(cliBinary, cliArgs, {
        cwd: rootDir,
        env: {
          ...process.env,
          SHOPIFY_CLI_AGENT_INFO: process.env.SHOPIFY_CLI_AGENT_INFO || "n:future-light-store|v:1|p:openai",
          SHOPIFY_CLI_AGENT_IDS: process.env.SHOPIFY_CLI_AGENT_IDS || `s:${process.env.CONVERSATION_ID || "local"}|r:${process.pid}|i:variant-google-metafields`,
        },
        maxBuffer: 40 * 1024 * 1024,
      });
      lastRequestAt = Date.now();
      return parsePayload(result.stdout);
    } catch (error) {
      lastRequestAt = Date.now();
      const message = String(error?.stderr || error?.stdout || error?.message || error);
      const transient = /429|throttl|rate limit|timeout|5\d\d|network|socket|temporar|aborted/i.test(message);
      if (!transient || attempt === maxAttempts - 1) throw new Error(`${operation} failed: ${message.trim()}`);
      const retryMs = Math.min(30_000, 1000 * 2 ** attempt);
      process.stdout.write(`${operation} throttled; retrying in ${retryMs / 1000}s\n`);
      await sleep(retryMs);
    }
  }
  throw new Error(`${operation} failed`);
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

async function readState(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function readProductHandles(filePath) {
  if (!filePath) return null;
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  const handles = Array.isArray(parsed) ? parsed : parsed?.handles;
  if (!Array.isArray(handles) || !handles.length) {
    throw new Error(`Product handles file contains no handles: ${filePath}`);
  }
  return new Set(handles.map((handle) => String(handle || "").trim().toLowerCase()).filter(Boolean));
}

async function validateDefinitions() {
  const data = await executeGraphQl(DEFINITIONS_QUERY, {}, { operation: "variant metafield definition discovery" });
  const live = data.metafieldDefinitions?.nodes || [];
  const liveById = new Map(live.map((definition) => [`${definition.namespace}.${definition.key}`, definition]));
  const invalid = [];
  for (const expected of GOOGLE_VARIANT_METAFIELD_DEFINITIONS) {
    const definition = liveById.get(`${expected.namespace}.${expected.key}`);
    if (!definition) invalid.push(`${expected.name}: missing`);
    else if (definition.ownerType !== "PRODUCTVARIANT" || definition.type?.name !== expected.type) {
      invalid.push(`${expected.name}: expected PRODUCTVARIANT/${expected.type}, found ${definition.ownerType}/${definition.type?.name}`);
    }
  }
  if (invalid.length) throw new Error(`Variant metafield definition validation failed: ${invalid.join(" | ")}`);
  return GOOGLE_VARIANT_METAFIELD_DEFINITIONS.map((expected) => liveById.get(`${expected.namespace}.${expected.key}`));
}

async function readCatalogCheckpoint(filePath) {
  try {
    const fileStat = await stat(filePath);
    if (Date.now() - fileStat.mtimeMs > 24 * 60 * 60 * 1000) {
      await rm(filePath, { force: true });
      return { variants: [], after: null, page: 0, complete: false };
    }
    const lines = (await readFile(filePath, "utf8")).split(/\r?\n/).filter(Boolean);
    const pages = lines.map((line) => JSON.parse(line));
    const last = pages.at(-1);
    return {
      variants: pages.flatMap((entry) => entry.nodes || []),
      after: last?.hasNextPage ? last.endCursor : null,
      page: pages.length,
      complete: Boolean(last && !last.hasNextPage),
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { variants: [], after: null, page: 0, complete: false };
    throw error;
  }
}

async function fetchAllVariants(checkpointPath, limit = 0) {
  const checkpoint = await readCatalogCheckpoint(checkpointPath);
  const variants = [...checkpoint.variants];
  let after = checkpoint.after;
  let page = checkpoint.page;
  if (checkpoint.complete) {
    process.stdout.write(`Using completed live catalog checkpoint with ${variants.length} variant(s)\n`);
    return variants.map(normalizeVariantMetafields);
  }
  if (variants.length) process.stdout.write(`Resuming live catalog checkpoint at ${variants.length} variant(s)\n`);
  do {
    const data = await executeGraphQl(ALL_VARIANTS_QUERY, { first: 250, after }, { operation: `variant catalog page ${page + 1}` });
    const connection = data.productVariants;
    if (!connection) throw new Error("Shopify did not return productVariants");
    const pageNodes = connection.nodes || [];
    variants.push(...pageNodes);
    after = connection.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null;
    await mkdir(dirname(checkpointPath), { recursive: true });
    await appendFile(checkpointPath, `${JSON.stringify({
      page: page + 1,
      endCursor: connection.pageInfo?.endCursor || null,
      hasNextPage: Boolean(connection.pageInfo?.hasNextPage),
      nodes: pageNodes,
    })}\n`, "utf8");
    page += 1;
    if (page % 4 === 0 || !after) process.stdout.write(`Fetched ${variants.length} variant(s)\n`);
  } while (after && (!limit || variants.length < limit));
  return variants.map(normalizeVariantMetafields);
}

function normalizeVariantMetafields(variant) {
  return {
    ...variant,
    metafields: Object.fromEntries(GOOGLE_VARIANT_METAFIELD_DEFINITIONS.map(({ id }) => [id, variant[id] || null])),
  };
}

function summarize(plans) {
  const writes = plans.flatMap((plan) => plan.writes);
  return {
    selectedProducts: new Set(plans.map((plan) => plan.productHandle)).size,
    selectedVariants: plans.length,
    variantsWithWrites: plans.filter((plan) => plan.writes.length).length,
    totalWrites: writes.length,
    writesByField: Object.fromEntries(GOOGLE_VARIANT_METAFIELD_DEFINITIONS.map(({ id }) => [id, writes.filter((write) => write.fieldId === id).length])),
    skippedByReason: plans.flatMap((plan) => plan.skipped).reduce((counts, entry) => {
      counts[entry.reason] = (counts[entry.reason] || 0) + 1;
      return counts;
    }, {}),
    batches: Math.ceil(writes.length / maxVariantsPerMutation),
  };
}

function verifyReturnedWrites(batch, returnedVariants) {
  const liveById = new Map(returnedVariants.filter(Boolean).map((variant) => [variant.id, variant]));
  for (const write of batch) {
    const actual = normalizeSingleLineText(liveById.get(write.ownerId)?.[write.fieldId]?.value);
    if (actual !== write.value) {
      throw new Error(`Readback mismatch for ${write.ownerId} ${write.namespace}.${write.key}: expected ${write.value}, found ${actual || "<blank>"}`);
    }
  }
}

function buildProductTasks(plans) {
  const byProduct = new Map();
  for (const plan of plans.filter((entry) => entry.writes.length)) {
    if (!byProduct.has(plan.productId)) byProduct.set(plan.productId, []);
    byProduct.get(plan.productId).push(plan);
  }
  const tasks = [];
  for (const [productId, productPlans] of byProduct) {
    for (const group of chunks(productPlans, 250)) tasks.push({ productId, plans: group });
  }
  return tasks;
}

function buildBulkTasks(plans) {
  const tasks = buildProductTasks(plans);
  const requests = [];
  let request = [];
  let variantCount = 0;
  for (const task of tasks) {
    if (request.length && (request.length >= maxProductOperationsPerMutation || variantCount + task.plans.length > maxVariantsPerMutation)) {
      requests.push(request);
      request = [];
      variantCount = 0;
    }
    request.push(task);
    variantCount += task.plans.length;
  }
  if (request.length) requests.push(request);
  return requests;
}

function toBulkVariantInput(plan) {
  return {
    id: plan.variantId,
    metafields: plan.writes.map(({ namespace, key, type, value }) => ({ namespace, key, type, value })),
  };
}

function buildBulkMutation(request) {
  const declarations = [];
  const operations = [];
  const variables = {};
  request.forEach((task, index) => {
    declarations.push(`$product${index}: ID!`, `$variants${index}: [ProductVariantsBulkInput!]!`);
    variables[`product${index}`] = task.productId;
    variables[`variants${index}`] = task.plans.map(toBulkVariantInput);
    operations.push(`p${index}: productVariantsBulkUpdate(productId: $product${index}, variants: $variants${index}) { productVariants { ${METAFIELD_READBACK_FIELDS} } userErrors { field message code } }`);
  });
  return { query: `mutation BulkGoogleVariantMetafields(${declarations.join(", ")}) { ${operations.join("\n")} }`, variables };
}

const BULK_VARIANT_MUTATION = `mutation BulkGoogleVariantMetafields($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants { ${METAFIELD_READBACK_FIELDS} }
    userErrors { field message code }
  }
}`;

async function createBulkInputParts(plans, manifestPath) {
  const tasks = buildProductTasks(plans);
  const parts = [];
  let lines = [];
  let bytes = 0;
  let taskIndex = 0;

  async function flush() {
    if (!lines.length) return;
    const partPath = manifestPath.replace(/\.json$/i, `-bulk-input-${parts.length + 1}.jsonl`);
    await writeFile(partPath, `${lines.join("\n")}\n`, "utf8");
    parts.push({ path: partPath, firstTaskIndex: taskIndex - lines.length, taskCount: lines.length, bytes });
    lines = [];
    bytes = 0;
  }

  for (const task of tasks) {
    const line = JSON.stringify({ productId: task.productId, variants: task.plans.map(toBulkVariantInput) });
    const lineBytes = Buffer.byteLength(line) + 1;
    if (lines.length && bytes + lineBytes > maxBulkInputBytes) await flush();
    lines.push(line);
    bytes += lineBytes;
    taskIndex += 1;
  }
  await flush();
  return { tasks, parts };
}

async function uploadBulkInput(part) {
  const data = await executeGraphQl(STAGED_UPLOAD_CREATE_MUTATION, {
    input: [{ resource: "BULK_MUTATION_VARIABLES", filename: basename(part.path), mimeType: "text/jsonl", httpMethod: "POST" }],
  }, { mutation: true, operation: "variant bulk staged upload reservation" });
  const errors = data.stagedUploadsCreate?.userErrors || [];
  if (errors.length) throw new Error(`stagedUploadsCreate failed: ${errors.map((error) => error.message).join(" | ")}`);
  const target = data.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target?.url) throw new Error("Shopify did not return a staged upload target");
  const curlArgs = ["-sS", "-X", "POST", target.url];
  for (const parameter of target.parameters || []) curlArgs.push("-F", `${parameter.name}=${parameter.value}`);
  curlArgs.push("-F", `file=@${part.path};type=text/jsonl`);
  await execFileAsync("curl", curlArgs, { cwd: rootDir, maxBuffer: 10 * 1024 * 1024 });
  const stagedUploadPath = (target.parameters || []).find((parameter) => parameter.name === "key")?.value;
  if (!stagedUploadPath) throw new Error("Shopify staged upload target did not include a key");
  return stagedUploadPath;
}

async function waitForBulkOperation(operationId) {
  while (true) {
    const data = await executeGraphQl(BULK_OPERATION_STATUS_QUERY, { id: operationId }, { operation: "variant bulk operation status" });
    const operation = data.bulkOperation;
    if (!operation) throw new Error(`Bulk operation not found: ${operationId}`);
    process.stdout.write(`Bulk operation ${operationId.match(/(\d+)$/)?.[1] || operationId}: ${operation.status}, ${operation.objectCount || 0} object(s)\n`);
    if (operation.status === "COMPLETED") return operation;
    if (["FAILED", "CANCELED", "EXPIRED"].includes(operation.status)) {
      throw new Error(`Bulk operation ${operationId} ended ${operation.status}: ${operation.errorCode || "unknown error"}`);
    }
    await sleep(5000);
  }
}

async function runBulkInputPart(part, partIndex, partTotal) {
  const stagedUploadPath = await uploadBulkInput(part);
  const data = await executeGraphQl(BULK_OPERATION_RUN_MUTATION, {
    mutation: BULK_VARIANT_MUTATION,
    stagedUploadPath,
  }, { mutation: true, operation: `start variant bulk operation ${partIndex + 1}` });
  const errors = data.bulkOperationRunMutation?.userErrors || [];
  if (errors.length) throw new Error(`bulkOperationRunMutation failed: ${errors.map((error) => error.message).join(" | ")}`);
  const operationId = data.bulkOperationRunMutation?.bulkOperation?.id;
  if (!operationId) throw new Error("Shopify did not return a bulk operation id");
  process.stdout.write(`Started bulk operation ${partIndex + 1}/${partTotal}: ${operationId}\n`);
  const operation = await waitForBulkOperation(operationId);
  if (!operation.url) throw new Error(`Completed bulk operation ${operationId} did not return a result URL`);
  const resultPath = part.path.replace("-bulk-input-", "-bulk-result-");
  await execFileAsync("curl", ["-sS", "-L", operation.url, "-o", resultPath], { cwd: rootDir, maxBuffer: 10 * 1024 * 1024 });
  return { operation, resultPath };
}

async function verifyBulkResult(resultPath, part, tasks) {
  const lines = (await readFile(resultPath, "utf8")).split(/\r?\n/).filter(Boolean);
  const verified = [];
  const skippedVariantIds = [];
  const retryPlans = [];
  for (const line of lines) {
    const payload = JSON.parse(line);
    const lineNumber = Number(payload.__lineNumber);
    const task = tasks[part.firstTaskIndex + lineNumber];
    if (!task) throw new Error(`Bulk result ${resultPath} returned unknown line ${lineNumber}`);
    if (payload.errors?.length) throw new Error(`Bulk line ${lineNumber} failed: ${payload.errors.map((error) => error.message).join(" | ")}`);
    const response = payload.data?.productVariantsBulkUpdate;
    const errors = response?.userErrors || [];
    if (errors.length) {
      const codes = new Set(errors.map((error) => error.code));
      if ([...codes].every((code) => code === "PRODUCT_DOES_NOT_EXIST")) {
        skippedVariantIds.push(...task.plans.map((plan) => plan.variantId));
        continue;
      }
      if ([...codes].every((code) => code === "PRODUCT_VARIANT_DOES_NOT_EXIST")) {
        const missingIndexes = new Set(errors.map((error) => Number(error.field?.[1])).filter(Number.isFinite));
        task.plans.forEach((plan, index) => {
          if (missingIndexes.has(index)) skippedVariantIds.push(plan.variantId);
          else retryPlans.push(plan);
        });
        continue;
      }
      throw new Error(`Bulk line ${lineNumber} user error: ${errors.map((error) => `${error.field?.join(".") || "variants"}: ${error.message}`).join(" | ")}`);
    }
    const writes = task.plans.flatMap((plan) => plan.writes);
    verifyReturnedWrites(writes, response?.productVariants || []);
    verified.push(...writes);
  }
  if (lines.length !== part.taskCount) throw new Error(`Bulk result ${resultPath} contains ${lines.length} lines; expected ${part.taskCount}`);
  return { verifiedWrites: verified.length, skippedVariantIds, retryPlans };
}

async function applyPlansWithBulkOperation(plans, manifest, manifestPath) {
  const { tasks, parts } = await createBulkInputParts(plans, manifestPath);
  manifest.summary.batches = parts.length;
  manifest.policy.applyTransport = "Shopify bulkOperationRunMutation with productVariantsBulkUpdate";
  manifest.bulkOperations = [];
  const skippedVariantIds = [];
  const retryPlans = [];
  await writeJsonAtomic(manifestPath, manifest);
  for (const [index, part] of parts.entries()) {
    const result = await runBulkInputPart(part, index, parts.length);
    const verification = await verifyBulkResult(result.resultPath, part, tasks);
    manifest.verifiedWrites += verification.verifiedWrites;
    skippedVariantIds.push(...verification.skippedVariantIds);
    retryPlans.push(...verification.retryPlans);
    manifest.appliedBatches = index + 1;
    manifest.bulkOperations.push({
      id: result.operation.id,
      status: result.operation.status,
      objectCount: result.operation.objectCount,
      fileSize: result.operation.fileSize,
      completedAt: result.operation.completedAt,
      inputPath: part.path,
      resultPath: result.resultPath,
      verifiedWrites: verification.verifiedWrites,
      skippedDeletedVariants: verification.skippedVariantIds.length,
      retryVariants: verification.retryPlans.length,
    });
    await writeJsonAtomic(manifestPath, manifest);
    process.stdout.write(`Verified bulk operation ${index + 1}/${parts.length}: ${verification.verifiedWrites} metafields\n`);
  }
  if (retryPlans.length) {
    const originalBatchCount = manifest.summary.batches;
    const originalAppliedBatches = manifest.appliedBatches;
    process.stdout.write(`Retrying ${retryPlans.length} surviving variant(s) from stale atomic bulk lines\n`);
    await applyPlans(retryPlans, manifest, manifestPath);
    manifest.summary.batches = originalBatchCount;
    manifest.appliedBatches = originalAppliedBatches;
  }
  manifest.skippedDeletedVariantIds = [...new Set(skippedVariantIds)].sort();
  manifest.summary.skippedDeletedVariants = manifest.skippedDeletedVariantIds.length;
  await writeJsonAtomic(manifestPath, manifest);
  return manifest.skippedDeletedVariantIds;
}

async function applyExistingBulkResult(plans, manifest, manifestPath, resultPath) {
  const tasks = buildProductTasks(plans);
  const verification = await verifyBulkResult(resultPath, { firstTaskIndex: 0, taskCount: tasks.length }, tasks);
  manifest.policy.applyTransport = "verified existing Shopify bulk operation result";
  manifest.summary.batches = 1;
  manifest.appliedBatches = 1;
  manifest.verifiedWrites = verification.verifiedWrites;
  if (verification.retryPlans.length) {
    process.stdout.write(`Retrying ${verification.retryPlans.length} surviving variant(s) from stale atomic bulk lines\n`);
    await applyPlans(verification.retryPlans, manifest, manifestPath);
    manifest.summary.batches = 1;
    manifest.appliedBatches = 1;
  }
  manifest.skippedDeletedVariantIds = [...new Set(verification.skippedVariantIds)].sort();
  manifest.summary.skippedDeletedVariants = manifest.skippedDeletedVariantIds.length;
  manifest.bulkOperations = [{
    status: "COMPLETED",
    resultPath,
    verifiedWrites: verification.verifiedWrites,
    skippedDeletedVariants: manifest.skippedDeletedVariantIds.length,
    retryVariants: verification.retryPlans.length,
  }];
  await writeJsonAtomic(manifestPath, manifest);
  return manifest.skippedDeletedVariantIds;
}

async function applyPlans(plans, manifest, manifestPath) {
  const requests = buildBulkTasks(plans);
  const progressPath = manifestPath.replace(/\.json$/i, "-progress.jsonl");
  await rm(progressPath, { force: true });
  manifest.summary.batches = requests.length;
  await writeJsonAtomic(manifestPath, manifest);
  for (const [index, request] of requests.entries()) {
    const operation = buildBulkMutation(request);
    const data = await executeGraphQl(operation.query, operation.variables, { mutation: true, operation: `variant bulk update ${index + 1}` });
    for (let aliasIndex = 0; aliasIndex < request.length; aliasIndex += 1) {
      const errors = data[`p${aliasIndex}`]?.userErrors || [];
      if (errors.length) throw new Error(`productVariantsBulkUpdate ${index + 1}.${aliasIndex + 1} failed: ${errors.map((error) => `${error.field?.join(".") || "variants"}: ${error.message}`).join(" | ")}`);
    }
    const batch = request.flatMap((task) => task.plans.flatMap((plan) => plan.writes));
    const returnedVariants = request.flatMap((_, aliasIndex) => data[`p${aliasIndex}`]?.productVariants || []);
    verifyReturnedWrites(batch, returnedVariants);
    manifest.appliedBatches = index + 1;
    manifest.verifiedWrites = (manifest.verifiedWrites || 0) + batch.length;
    manifest.updatedAt = new Date().toISOString();
    await appendFile(progressPath, `${JSON.stringify({
      batch: index + 1,
      totalBatches: requests.length,
      variants: request.reduce((count, task) => count + task.plans.length, 0),
      metafields: batch.length,
      verifiedWrites: manifest.verifiedWrites,
      verifiedAt: manifest.updatedAt,
    })}\n`, "utf8");
    process.stdout.write(`Applied and verified batch ${index + 1}/${requests.length} (${request.reduce((count, task) => count + task.plans.length, 0)} variants, ${batch.length} metafields)\n`);
  }
}

export async function runVariantGoogleMetafieldBackfill(options = {}) {
  const args = { ...parseArgs(["node", "script"]), ...options };
  if (args.planManifestPath && args.bulkResultPath) {
    const manifest = JSON.parse(await readFile(args.planManifestPath, "utf8"));
    const plans = Array.isArray(manifest.variants) ? manifest.variants : [];
    if (!plans.length) throw new Error(`Plan manifest contains no variants: ${args.planManifestPath}`);
    manifest.mode = "apply";
    manifest.resumedAt = new Date().toISOString();
    const skippedDeletedVariantIds = await applyExistingBulkResult(plans, manifest, args.manifestPath, args.bulkResultPath);
    const skippedDeleted = new Set(skippedDeletedVariantIds);
    await writeJsonAtomic(args.statePath, {
      version: 1,
      storeDomain,
      establishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      processedVariantIds: plans.map((plan) => plan.variantId).filter((variantId) => !skippedDeleted.has(variantId)).sort(),
    });
    manifest.completedAt = new Date().toISOString();
    manifest.status = "applied-and-verified";
    await writeJsonAtomic(args.manifestPath, manifest);
    return manifest;
  }
  const startedAt = new Date().toISOString();
  const definitions = await validateDefinitions();
  const allVariants = await fetchAllVariants(args.catalogCheckpointPath, args.sample);
  const state = await readState(args.statePath);
  const productHandles = await readProductHandles(args.productHandlesFile);
  if (args.scope === "new-products" && !state?.processedVariantIds) {
    throw new Error(`New-products scope requires an approved all-products baseline at ${args.statePath}`);
  }
  const processed = new Set(state?.processedVariantIds || []);
  let selected = args.scope === "all-products"
    ? allVariants
    : allVariants.filter(
        (variant) =>
          !processed.has(variant.id) &&
          (!productHandles || productHandles.has(String(variant.product?.handle || "").trim().toLowerCase())),
      );
  if (args.sample > 0) selected = selected.slice(0, args.sample);

  const plans = selected.map((variant) => {
    const plan = buildGoogleVariantMetafieldPlan(variant);
    return {
      variantId: variant.id,
      legacyVariantId: String(variant.legacyResourceId || ""),
      productId: variant.product?.id,
      productHandle: variant.product?.handle,
      productTitle: variant.product?.title,
      variantTitle: variant.title,
      desired: plan.desired,
      writes: plan.writes.map((write) => ({ ...write, productId: variant.product?.id })),
      skipped: plan.skipped,
    };
  });
  const selectedHandles = [...new Set(plans.map((plan) => plan.productHandle).filter(Boolean))];
  const summary = summarize(plans);
  summary.batches = buildBulkTasks(plans).length;
  const manifest = {
    version: 1,
    mode: args.mode,
    scope: args.scope,
    storeDomain,
    apiVersion,
    startedAt,
    policy: {
      idempotentFieldDiffs: true,
      singleLineTextOnly: true,
      existingMpnWins: true,
      condition: "new",
      sizeSystem: "US only for size-bearing apparel or footwear",
      newProductBaseline: args.statePath,
      productHandlesFile: args.productHandlesFile || null,
    },
    definitions: definitions.map(({ id, name, namespace, key, ownerType, type }) => ({ id, name, namespace, key, ownerType, type: type?.name })),
    catalog: { products: new Set(allVariants.map((variant) => variant.product?.id)).size, variants: allVariants.length },
    summary,
    products: selectedHandles,
    variants: plans,
    appliedBatches: 0,
    verifiedWrites: 0,
  };
  await writeJsonAtomic(args.handlesPath, selectedHandles);
  await writeJsonAtomic(args.manifestPath, manifest);
  process.stdout.write(`${args.mode} ${args.scope}: ${manifest.summary.selectedVariants} variants, ${manifest.summary.totalWrites} metafield writes\n`);
  if (args.mode === "dry-run") return manifest;

  let skippedDeletedVariantIds = [];
  if (args.bulkResultPath) {
    skippedDeletedVariantIds = await applyExistingBulkResult(plans, manifest, args.manifestPath, args.bulkResultPath);
  } else if (args.forceBulk || (manifest.summary.totalWrites >= bulkOperationThreshold && args.sample === 0)) {
    skippedDeletedVariantIds = await applyPlansWithBulkOperation(plans, manifest, args.manifestPath);
  } else {
    manifest.policy.applyTransport = "synchronous productVariantsBulkUpdate";
    await applyPlans(plans, manifest, args.manifestPath);
  }
  const skippedDeleted = new Set(skippedDeletedVariantIds);
  const nextProcessed = args.scope === "all-products"
    ? allVariants.map((variant) => variant.id).filter((variantId) => !skippedDeleted.has(variantId))
    : [...new Set([...(state.processedVariantIds || []), ...selected.map((variant) => variant.id).filter((variantId) => !skippedDeleted.has(variantId))])];
  const nextState = {
    version: 1,
    storeDomain,
    establishedAt: state?.establishedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    processedVariantIds: nextProcessed.sort(),
  };
  await writeJsonAtomic(args.statePath, nextState);
  manifest.completedAt = new Date().toISOString();
  manifest.status = "applied-and-verified";
  await writeJsonAtomic(args.manifestPath, manifest);
  return manifest;
}

async function main() {
  await runVariantGoogleMetafieldBackfill(parseArgs(process.argv));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
