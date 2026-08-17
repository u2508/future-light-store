#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import {
  PRODUCT_CONTENT_SPECIFICITY_VERSION,
  assessProductContentSpecificity,
  findCatalogContentCollisions,
} from "../src/lib/product-content-specificity.js";

const execFileAsync = promisify(execFile);
const ROOT_DIR = resolve(import.meta.dirname, "..");
const DEFAULT_OUTPUT = resolve(ROOT_DIR, "output", "shopify-product-specificity-manifest.json");
const SHOP_BASE = process.env.SALT_SHOP_URL;
if (!SHOP_BASE) throw new Error("SALT_SHOP_URL is required to verify Future Light Store product specificity.");
const SHOP_DOMAIN = new URL(SHOP_BASE).hostname;
const API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || "2026-07";
const SHOPIFY_CLI_AGENT_INFO = process.env.SHOPIFY_CLI_AGENT_INFO || "n:future-light-store|v:1|p:openai";
const SHOPIFY_CLI_AGENT_IDS =
  process.env.SHOPIFY_CLI_AGENT_IDS || `s:future-light-store|r:${process.pid}|i:future-light-store-specificity`;
const POLL_INTERVAL_MS = Math.max(1000, Number(process.env.SALT_BULK_POLL_INTERVAL_MS || 2000));
const BULK_TIMEOUT_MS = Math.max(60_000, Number(process.env.SALT_BULK_TIMEOUT_MS || 15 * 60_000));

const BULK_PRODUCT_QUERY = /* GraphQL */ `
  {
    products(query: "status:active") {
      edges {
        node {
          id
          legacyResourceId
          handle
          title
          descriptionHtml
          productType
          vendor
          tags
          status
          category {
            id
            name
            fullName
          }
          seo {
            title
            description
          }
          subtitle: metafield(namespace: "descriptors", key: "subtitle") {
            jsonValue
            value
          }
          highlights: metafield(namespace: "salt-marketing", key: "highlights") {
            jsonValue
            value
          }
          collectionSignal: metafield(namespace: "salt-marketing", key: "collection_signal") {
            jsonValue
            value
          }
          searchProductBoosts: metafield(namespace: "shopify--discovery--product_search_boost", key: "queries") {
            jsonValue
            value
          }
          searchProductBoostFallback: metafield(namespace: "salt-search", key: "query_terms") {
            jsonValue
            value
          }
        }
      }
    }
  }
`;

const START_BULK_OPERATION = /* GraphQL */ `
  mutation StartProductSpecificityExport($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const BULK_OPERATION_STATUS = /* GraphQL */ `
  query ProductSpecificityExportStatus($id: ID!) {
    node(id: $id) {
      ... on BulkOperation {
        id
        status
        errorCode
        objectCount
        fileSize
        url
        partialDataUrl
      }
    }
  }
`;

function parseArgs(argv) {
  const args = { output: DEFAULT_OUTPUT, input: "", sample: 0 };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--output") {
      if (!next) throw new Error("Missing value for --output");
      args.output = resolve(process.cwd(), next);
      index += 1;
    } else if (token === "--input") {
      if (!next) throw new Error("Missing value for --input");
      args.input = resolve(process.cwd(), next);
      index += 1;
    } else if (token === "--sample") {
      if (!next) throw new Error("Missing value for --sample");
      args.sample = Math.max(0, Number(next) || 0);
      index += 1;
    }
  }
  return args;
}

function sleep(milliseconds) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

function getShopifyCliEnv() {
  return {
    ...process.env,
    SHOPIFY_CLI_AGENT_INFO,
    SHOPIFY_CLI_AGENT_IDS,
  };
}

async function runShopifyStoreGraphQL(query, variables = {}, { allowMutations = false } = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), "salt-shopify-specificity-"));
  const queryFile = join(tempDir, "operation.graphql");
  const outputFile = join(tempDir, "result.json");
  const variableFile = join(tempDir, "variables.json");

  try {
    await writeFile(queryFile, query, "utf8");
    const hasVariables = variables && Object.keys(variables).length > 0;
    if (hasVariables) await writeFile(variableFile, JSON.stringify(variables), "utf8");
    const cliArgs = [
      "store",
      "execute",
      "--store",
      SHOP_DOMAIN,
      "--version",
      API_VERSION,
      "--query-file",
      queryFile,
      "--output-file",
      outputFile,
      "--json",
    ];
    if (hasVariables) cliArgs.push("--variable-file", variableFile);
    if (allowMutations) cliArgs.push("--allow-mutations");

    await execFileAsync("shopify", cliArgs, {
      env: getShopifyCliEnv(),
      maxBuffer: 20 * 1024 * 1024,
    });
    const payload = JSON.parse(await readFile(outputFile, "utf8"));
    if (Array.isArray(payload.errors) && payload.errors.length) {
      throw new Error(payload.errors.map((entry) => entry.message || "Shopify GraphQL error").join(" | "));
    }
    return payload.data || payload || {};
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function metafieldValue(field) {
  if (!field) return null;
  if (typeof field !== "object" || Array.isArray(field)) return field;
  if (field.jsonValue !== undefined && field.jsonValue !== null) return field.jsonValue;
  const raw = field.value;
  if (raw == null || raw === "") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function normalizeList(value) {
  if (Array.isArray(value)) return [...new Set(value.map((entry) => String(entry || "").trim()).filter(Boolean))];
  if (value == null) return [];
  return [...new Set(String(value).split(/[\n,;|]+/g).map((entry) => entry.trim()).filter(Boolean))];
}

function normalizeProduct(node) {
  const standardBoosts = normalizeList(node.searchBoosts || metafieldValue(node.searchProductBoosts));
  const fallbackBoosts = normalizeList(metafieldValue(node.searchProductBoostFallback));
  return {
    id: node.legacyResourceId || node.id || null,
    gid: node.id || "",
    handle: String(node.handle || ""),
    title: String(node.title || ""),
    descriptionHtml: String(node.descriptionHtml || ""),
    productType: String(node.productType || ""),
    vendor: String(node.vendor || ""),
    tags: Array.isArray(node.tags) ? node.tags : [],
    status: String(node.status || ""),
    category: node.category || null,
    seoTitle: String(node.seoTitle || node.seo?.title || ""),
    seoDescription: String(node.seoDescription || node.seo?.description || ""),
    subtitle: String(metafieldValue(node.subtitle) || ""),
    highlights: normalizeList(metafieldValue(node.highlights)),
    collectionSignal: String(metafieldValue(node.collectionSignal) || ""),
    // Shopify's discovery-owned field is not writable for this store's
    // product owner subtype. The source-owned fallback is the verified
    // product-specific search signal whenever it exists.
    searchBoosts: fallbackBoosts.length ? fallbackBoosts : standardBoosts,
    searchBoostSource:
      node.searchBoostSource ||
      (fallbackBoosts.length ? "salt-fallback" : standardBoosts.length ? "shopify-discovery" : "missing"),
  };
}

async function fetchActiveProductsFromBulkOperation() {
  const started = await runShopifyStoreGraphQL(
    START_BULK_OPERATION,
    { query: BULK_PRODUCT_QUERY },
    { allowMutations: true },
  );
  const result = started?.bulkOperationRunQuery;
  const userErrors = Array.isArray(result?.userErrors) ? result.userErrors : [];
  if (userErrors.length) {
    throw new Error(userErrors.map((error) => error.message || "Bulk export failed").join(" | "));
  }
  const operationId = result?.bulkOperation?.id;
  if (!operationId) throw new Error("Shopify did not return a product specificity bulk operation id");

  process.stdout.write(`Waiting for product specificity export ${operationId}\n`);
  const deadline = Date.now() + BULK_TIMEOUT_MS;
  let operation = result.bulkOperation;
  while (["CREATED", "RUNNING", "CANCELING"].includes(operation?.status)) {
    if (Date.now() >= deadline) throw new Error(`Product specificity export timed out after ${BULK_TIMEOUT_MS}ms`);
    await sleep(POLL_INTERVAL_MS);
    const statusPayload = await runShopifyStoreGraphQL(BULK_OPERATION_STATUS, { id: operationId });
    operation = statusPayload?.node;
    process.stdout.write(`Product specificity export ${operation?.status || "UNKNOWN"}: ${operation?.objectCount || 0} object(s)\n`);
  }
  if (operation?.status !== "COMPLETED" || !operation.url) {
    throw new Error(`Product specificity export ${operation?.status || "UNKNOWN"}: ${operation?.errorCode || "no result URL"}`);
  }

  const response = await fetch(operation.url);
  if (!response.ok) throw new Error(`Product specificity export download failed (${response.status})`);
  const products = [];
  for (const line of (await response.text()).split("\n")) {
    if (!line.trim()) continue;
    const node = JSON.parse(line);
    if (!node?.handle || String(node.status || "").toUpperCase() !== "ACTIVE") continue;
    products.push(normalizeProduct(node));
  }
  return products;
}

const AUDIT_FIELDS = [
  { id: "seo-title", value: (product) => product.seoTitle, minimumEvidenceMatches: 2, minLength: 5, maxLength: 70 },
  { id: "seo-description", value: (product) => product.seoDescription, minimumEvidenceMatches: 3, minLength: 120, maxLength: 170 },
  { id: "description-html", value: (product) => product.descriptionHtml, minimumEvidenceMatches: 3, minLength: 80 },
  { id: "subtitle", value: (product) => product.subtitle, minimumEvidenceMatches: 2, minLength: 4, maxLength: 70 },
  { id: "highlights", value: (product) => product.highlights, minimumEvidenceMatches: 3 },
  { id: "collection-signal", value: (product) => product.collectionSignal, minimumEvidenceMatches: 2 },
  { id: "search-boosts", value: (product) => product.searchBoosts, minimumEvidenceMatches: 3 },
];

export function auditProductSpecificityCatalog(products) {
  const normalizedProducts = (products || []).map((product) => normalizeProduct(product));
  const productIssues = normalizedProducts.map((product) => {
    const issues = [];
    const fields = {};
    if (!product.category?.id && !product.category?.name && !product.category?.fullName) {
      issues.push("category:missing");
    }
    for (const field of AUDIT_FIELDS) {
      const value = field.value(product);
      const assessment = assessProductContentSpecificity(value, product, {
        field: field.id,
        minimumEvidenceMatches: field.minimumEvidenceMatches,
        rejectGenericPatterns: true,
      });
      const rawLength = Array.isArray(value) ? value.join(" | ").length : String(value || "").length;
      if (field.minLength && rawLength < field.minLength) assessment.issues.push(`minimum-length:${field.minLength}`);
      if (field.maxLength && rawLength > field.maxLength) assessment.issues.push(`maximum-length:${field.maxLength}`);
      assessment.specific = assessment.issues.length === 0;
      fields[field.id] = assessment;
      issues.push(...assessment.issues.map((issue) => `${field.id}:${issue}`));
    }
    if (product.highlights.length < 2) issues.push("highlights:minimum-items:2");
    if (product.searchBoosts.length < 3) issues.push("search-boosts:minimum-items:3");
    return {
      id: product.id,
      handle: product.handle,
      title: product.title,
      searchBoostSource: product.searchBoostSource,
      issues: [...new Set(issues)],
      fields,
    };
  });

  const duplicateGroups = findCatalogContentCollisions(
    normalizedProducts,
    AUDIT_FIELDS.map((field) => ({ id: field.id, getValue: field.value })),
  );
  const issuesByHandle = new Map(productIssues.map((entry) => [entry.handle, entry]));
  for (const group of duplicateGroups) {
    for (const member of group.members) {
      const entry = issuesByHandle.get(member.handle);
      if (entry) entry.issues.push(`duplicate:${group.field}`);
    }
  }
  for (const entry of productIssues) entry.issues = [...new Set(entry.issues)];

  const failedProducts = productIssues.filter((entry) => entry.issues.length > 0);
  const fieldFailures = {};
  for (const entry of failedProducts) {
    for (const issue of entry.issues) {
      const field = issue.split(":")[0];
      fieldFailures[field] = (fieldFailures[field] || 0) + 1;
    }
  }

  return {
    version: PRODUCT_CONTENT_SPECIFICITY_VERSION,
    generatedAt: new Date().toISOString(),
    summary: {
      activeProducts: normalizedProducts.length,
      passedProducts: normalizedProducts.length - failedProducts.length,
      failedProducts: failedProducts.length,
      duplicateGroups: duplicateGroups.length,
      fieldFailures,
    },
    duplicateGroups,
    products: productIssues,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const sourceProducts = args.input
    ? JSON.parse(await readFile(args.input, "utf8")).products || []
    : await fetchActiveProductsFromBulkOperation();
  const selectedProducts = args.sample > 0 ? sourceProducts.slice(0, args.sample) : sourceProducts;
  if (!selectedProducts.length) throw new Error("No active products were available for specificity verification");

  const manifest = auditProductSpecificityCatalog(selectedProducts);
  manifest.source = args.input || `Shopify Admin API ${API_VERSION} via ${SHOP_DOMAIN}`;
  manifest.sample = args.sample || null;
  await mkdir(dirname(args.output), { recursive: true });
  await writeFile(args.output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  process.stdout.write(
    `Product specificity: ${manifest.summary.passedProducts}/${manifest.summary.activeProducts} passed; ` +
      `${manifest.summary.failedProducts} failed; ${manifest.summary.duplicateGroups} duplicate group(s).\n`,
  );
  if (manifest.summary.failedProducts > 0) {
    const preview = manifest.products
      .filter((entry) => entry.issues.length)
      .slice(0, 12)
      .map((entry) => `${entry.handle}: ${entry.issues.join(", ")}`)
      .join(" | ");
    throw new Error(`Live product specificity verification failed. ${preview}`);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
