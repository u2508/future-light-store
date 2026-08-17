#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import XLSX from "xlsx";
import {
  buildMediaUpdateTargets,
  buildSeoBatchExportRows,
  buildSeoBatchManifest,
  buildSeoBatchPlan,
  createSeoCatalogContext,
} from "../src/lib/shopify-seo-batch-intelligence.js";
import {
  formatMoneyValue,
  normalizeHtmlValue,
  normalizeHandleValue,
  normalizePlainText,
  normalizeUrlForMatch,
  parseMoneyValue,
  toShopifyGid,
} from "../src/lib/shopify-seo-batch.js";
import {
  managedMinimumQuantityTagFromTags,
  normalizeShopifyTags,
  reconcileManagedMinimumQuantityTags,
} from "../src/lib/shopify-seo-managed-tags.js";
import { readProductCatalogPayload } from "./product-catalog-files.mjs";

const DEFAULT_SHOP_BASE = "";
const SHOP_BASE = process.env.SALT_SHOP_URL || DEFAULT_SHOP_BASE;
const STORE_DOMAIN = new URL(SHOP_BASE).hostname;
const ADMIN_ACCESS_TOKEN =
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.SALT_SHOPIFY_ADMIN_ACCESS_TOKEN || "";
const ADMIN_API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || "2026-04";
const GRAPHQL_ENDPOINT = `${new URL(SHOP_BASE).origin}/admin/api/${ADMIN_API_VERSION}/graphql.json`;
const SHOPIFY_CLI_AGENT_INFO = process.env.SHOPIFY_CLI_AGENT_INFO || "n:Codex|v:5|p:openai";
const SHOPIFY_CLI_AGENT_IDS = process.env.SHOPIFY_CLI_AGENT_IDS || "s:local|r:1|i:local";

const PRODUCT_BY_HANDLE_QUERY = /* GraphQL */ `
  query ProductByHandle($identifier: ProductIdentifierInput!) {
    productByIdentifier(identifier: $identifier) {
      id
      handle
      title
      descriptionHtml
      productType
      tags
      seo {
        title
        description
      }
      variants(first: 100) {
        nodes {
          id
          title
          price
          compareAtPrice
          sku
          barcode
          selectedOptions {
            name
            value
          }
        }
      }
      media(first: 100) {
        nodes {
          __typename
          ... on MediaImage {
            id
            alt
            image {
              url
            }
          }
        }
      }
    }
  }
`;

const PRODUCT_UPDATE_MUTATION = /* GraphQL */ `
  mutation ShopifySeoProductUpdate($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product {
        id
        handle
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_VARIANTS_BULK_UPDATE_MUTATION = /* GraphQL */ `
  mutation ShopifySeoVariantUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        price
        compareAtPrice
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_UPDATE_MEDIA_MUTATION = /* GraphQL */ `
  mutation ShopifySeoMediaUpdate($productId: ID!, $media: [UpdateMediaInput!]!) {
    productUpdateMedia(productId: $productId, media: $media) {
      media {
        id
        alt
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const TAXONOMY_SEARCH_QUERY = /* GraphQL */ `
  query ShopifySeoTaxonomySearch($search: String!, $first: Int = 10) {
    taxonomy {
      categories(first: $first, search: $search) {
        nodes {
          id
          name
          fullName
        }
      }
    }
  }
`;

const GOOGLE_TAXONOMY_URL = "https://www.google.com/basepages/producttype/taxonomy-with-ids.en-US.txt";
let googleTaxonomyLookupPromise = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const args = {
    input: "",
    apply: false,
    export: false,
    dryRun: true,
    output: "",
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === "--input" || token === "-i") {
      args.input = next || "";
      index += 1;
      continue;
    }

    if (token === "--apply") {
      args.apply = true;
      args.dryRun = false;
      args.export = false;
      continue;
    }

    if (token === "--export") {
      args.export = true;
      args.apply = false;
      args.dryRun = true;
      continue;
    }

    if (token === "--dry-run") {
      args.dryRun = true;
      args.apply = false;
      args.export = false;
      continue;
    }

    if (token === "--output" || token === "-o") {
      args.output = next || "";
      index += 1;
      continue;
    }
  }

  if (args.apply) {
    args.dryRun = false;
  }

  return args;
}

function getModeLabel(args) {
  if (args.apply) {
    return "apply";
  }

  if (args.export) {
    return "export";
  }

  return "dry-run";
}

function stripKnownExtension(filePath) {
  const extension = extname(filePath);
  if (!extension) {
    return filePath;
  }

  return filePath.slice(0, -extension.length);
}

function deriveOutputTargets(inputPath, outputPath) {
  const defaultBaseName = stripKnownExtension(basename(inputPath));
  const defaultDir = resolve(process.cwd(), "output");
  const csvPath = outputPath
    ? resolve(process.cwd(), outputPath)
    : resolve(defaultDir, `${defaultBaseName}.seo-batch.csv`);
  const manifestPath = outputPath
    ? `${stripKnownExtension(csvPath)}.manifest.json`
    : resolve(defaultDir, `${defaultBaseName}.seo-batch-manifest.json`);

  return {
    csvPath,
    manifestPath,
  };
}

function requireInputPath(inputPath) {
  if (!inputPath) {
    throw new Error("Missing --input path. Example: node scripts/shopify-seo-batch-update.mjs -- --input ./products.csv");
  }

  return resolve(process.cwd(), inputPath);
}

async function readRowsFromSpreadsheet(filePath) {
  const workbook = XLSX.readFile(filePath, {
    cellDates: true,
    raw: false,
    ...(extname(filePath).toLowerCase() === ".csv" ? { codepage: 65001 } : {}),
  });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error(`No worksheets found in ${filePath}`);
  }

  const sheet = workbook.Sheets[firstSheetName];
  const headerRows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });
  const rows = XLSX.utils.sheet_to_json(sheet, {
    raw: false,
    defval: "",
  });

  if (!rows.length) {
    throw new Error(`No readable rows found in ${filePath}`);
  }

  return {
    rows,
    header: Array.isArray(headerRows[0]) ? headerRows[0].map((column) => String(column ?? "")) : [],
  };
}

async function readJsonFileIfExists(filePath, fallbackValue) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return fallbackValue;
    }

    throw error;
  }
}

async function loadLocalCatalogSnapshot() {
  const collectionsPath = resolve(process.cwd(), "public/data/collections.json");
  const collectionProductsPath = resolve(process.cwd(), "public/data/collection-products.json");

  const [products, collections, collectionProducts] = await Promise.all([
    readProductCatalogPayload(resolve(process.cwd(), "public/data")),
    readJsonFileIfExists(collectionsPath, {}),
    readJsonFileIfExists(collectionProductsPath, {}),
  ]);

  return {
    products,
    collections,
    collectionProducts,
  };
}

async function writeTextFile(filePath, contents) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
}

async function writeJsonFile(filePath, payload) {
  await writeTextFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function escapeCsvValue(value) {
  const text = value == null ? "" : String(value);
  if (!/[",\r\n]/.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

function buildCsvFromRows(rows, headerOrder) {
  const headers = Array.isArray(headerOrder) ? headerOrder.map((header) => String(header ?? "")) : [];
  const lines = [headers.map(escapeCsvValue).join(",")];

  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsvValue(row?.[header])).join(","));
  }

  return `${lines.join("\r\n")}\r\n`;
}

function getShopifyCliEnv() {
  return {
    ...process.env,
    SHOPIFY_CLI_AGENT_INFO,
    SHOPIFY_CLI_AGENT_IDS,
  };
}

function runShopifyCli(args, { input } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("shopify", args, {
      env: getShopifyCliEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      rejectPromise(error);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        rejectPromise(new Error(stderr.trim() || stdout.trim() || `shopify exited with code ${code}`));
        return;
      }

      resolvePromise({ stdout, stderr });
    });

    if (input) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });
}

async function fetchShopifyGraphQL(query, variables) {
  if (!ADMIN_ACCESS_TOKEN) {
    throw new Error("Shopify Admin API token not configured");
  }

  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": ADMIN_ACCESS_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload?.errors?.map((error) => error.message).filter(Boolean).join("; ") ||
      `Shopify request failed (${response.status})`;

    if (response.status === 429) {
      throw new Error(`${message} (rate limited)`);
    }

    if (response.status >= 500 && response.status < 600) {
      throw new Error(`${message} (server error)`);
    }

    throw new Error(message);
  }

  if (payload?.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).filter(Boolean).join("; "));
  }

  return payload?.data || {};
}

async function fetchShopifyGraphQLWithRetry(query, variables, { maxAttempts = 5 } = {}) {
  let attempt = 0;

  while (true) {
    try {
      return await fetchShopifyGraphQL(query, variables);
    } catch (error) {
      const message = String(error?.message || error);
      const isRateLimit = /rate limited/i.test(message);
      const isTransient = isRateLimit || /server error/i.test(message);

      if (!isTransient || attempt >= maxAttempts - 1) {
        throw error;
      }

      const retryDelay = Math.min(30_000, 1000 * 2 ** attempt + Math.floor(Math.random() * 250));
      process.stdout.write(
        `Shopify Admin request failed (${message}); retrying in ${Math.round(retryDelay / 1000)}s\n`,
      );
      await sleep(retryDelay);
      attempt += 1;
    }
  }
}

async function loadGoogleTaxonomyLookup() {
  if (!googleTaxonomyLookupPromise) {
    googleTaxonomyLookupPromise = fetch(GOOGLE_TAXONOMY_URL)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Google taxonomy lookup failed (${response.status})`);
        }

        const text = await response.text();
        const lookup = new Map();

        for (const line of text.split(/\r?\n/)) {
          const entry = line.trim();
          if (!entry || entry.startsWith("#")) {
            continue;
          }

          const match = entry.match(/^(\d+)\s*-\s*(.+)$/);
          if (!match) {
            continue;
          }

          lookup.set(match[1], match[2].trim());
        }

        return lookup;
      })
      .catch((error) => {
        googleTaxonomyLookupPromise = null;
        throw error;
      });
  }

  return googleTaxonomyLookupPromise;
}

async function lookupGoogleTaxonomyCategory(categoryQuery) {
  const raw = normalizePlainText(categoryQuery);
  if (!/^\d+$/.test(raw)) {
    return raw;
  }

  const lookup = await loadGoogleTaxonomyLookup();
  return lookup.get(raw) || "";
}

async function searchShopifyTaxonomyCategory(searchText, apiClient) {
  const search = normalizePlainText(searchText).replace(/\s*>\s*/g, " > ");
  if (!search) {
    return null;
  }

  const data = await apiClient(TAXONOMY_SEARCH_QUERY, {
    search,
    first: 10,
  });

  const categories = Array.isArray(data?.taxonomy?.categories?.nodes) ? data.taxonomy.categories.nodes : [];
  const normalized = search.toLowerCase();

  const exact = categories.find((entry) => {
    const fullName = normalizePlainText(entry?.fullName).toLowerCase();
    const name = normalizePlainText(entry?.name).toLowerCase();
    return fullName === normalized || name === normalized;
  });

  const partial = categories.find((entry) => {
    const fullName = normalizePlainText(entry?.fullName).toLowerCase();
    const name = normalizePlainText(entry?.name).toLowerCase();
    return fullName.includes(normalized) || normalized.includes(fullName) || name.includes(normalized);
  });

  return exact?.id || partial?.id || null;
}

async function executeStoreGraphQL(query, variables, { allowMutations = false } = {}) {
  if (ADMIN_ACCESS_TOKEN) {
    return fetchShopifyGraphQLWithRetry(query, variables);
  }

  const args = [
    "store",
    "execute",
    "--store",
    STORE_DOMAIN,
    "--query",
    query,
    "--variables",
    JSON.stringify(variables || {}),
    "--version",
    ADMIN_API_VERSION,
    "--json",
  ];

  if (allowMutations) {
    args.push("--allow-mutations");
  }

  const { stdout } = await runShopifyCli(args);
  const trimmed = stdout.trim();
  const jsonStart = trimmed.indexOf("{");
  if (jsonStart < 0) {
    throw new Error(trimmed || "Shopify CLI returned no JSON payload");
  }

  return JSON.parse(trimmed.slice(jsonStart));
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      return value;
    }
  }

  return "";
}

function normalizeVariantMatch(value) {
  return normalizePlainText(value).toLowerCase();
}

function normalizeVariantMatchLoose(value) {
  return normalizeVariantMatch(value).replace(/[^a-z0-9]+/g, "");
}

function variantTextMatches(candidate, expected) {
  const normalizedCandidate = normalizeVariantMatch(candidate);
  const normalizedExpected = normalizeVariantMatch(expected);
  if (normalizedCandidate && normalizedExpected && normalizedCandidate === normalizedExpected) {
    return true;
  }

  const looseCandidate = normalizeVariantMatchLoose(candidate);
  const looseExpected = normalizeVariantMatchLoose(expected);
  return Boolean(looseCandidate && looseExpected && looseCandidate === looseExpected);
}

function getVariantSelectedOptionText(variant) {
  const values = Array.isArray(variant?.selectedOptions)
    ? variant.selectedOptions
        .map((option) => normalizePlainText(option?.value))
        .filter(Boolean)
    : [];

  return values.join(" / ");
}

function buildProductUpdateInput(product, productPlan, categoryId) {
  const input = {
    id: productPlan.productId || product.id,
  };

  const title = normalizePlainText(productPlan.productInput.title);
  const descriptionHtml = normalizeHtmlValue(productPlan.productInput.descriptionHtml);
  const productType = normalizePlainText(productPlan.productInput.productType);
  const seoTitle = normalizePlainText(productPlan.productInput.seo?.title);
  const seoDescription = normalizePlainText(productPlan.productInput.seo?.description);

  if (title) {
    input.title = title;
  }

  if (descriptionHtml) {
    input.descriptionHtml = descriptionHtml;
  }

  if (productType) {
    input.productType = productType;
  }

  if (seoTitle || seoDescription) {
    input.seo = {
      title: seoTitle,
      description: seoDescription,
    };
  }

  if (categoryId) {
    input.category = categoryId;
  }

  const nextTags = reconcileManagedMinimumQuantityTags(product.tags, productPlan.desiredQuantityTag);
  const currentManagedTags = normalizeShopifyTags(product.tags).filter((tag) => /^minimum-qty-[23]$/i.test(tag));
  const currentManagedTag = managedMinimumQuantityTagFromTags(currentManagedTags);
  const desiredManagedTag = String(productPlan.desiredQuantityTag || "").toLowerCase();
  if (currentManagedTag !== desiredManagedTag || currentManagedTags.length !== (desiredManagedTag ? 1 : 0)) {
    input.tags = nextTags;
  }

  return input;
}

function printPlanSummary(plan, { mode = "dry-run", maxProducts = 25 } = {}) {
  const modeLabel = String(mode || "dry-run").toUpperCase();
  process.stdout.write(`\n[${modeLabel}] ${plan.products.length} handle group(s) from spreadsheet\n`);

  const productDetails = Number.isFinite(maxProducts)
    ? plan.products.slice(0, Math.max(0, Math.floor(maxProducts)))
    : plan.products;

  for (const productPlan of productDetails) {
    const updateBits = [];

    if (normalizePlainText(productPlan.productInput.title)) {
      updateBits.push("title");
    }
    if (normalizePlainText(productPlan.productInput.descriptionHtml)) {
      updateBits.push("body");
    }
    if (normalizePlainText(productPlan.productInput.productType)) {
      updateBits.push("type");
    }
    if (productPlan.productInput.seo?.title || productPlan.productInput.seo?.description) {
      updateBits.push("seo");
    }
    if (productPlan.categoryQuery) {
      updateBits.push("category");
    }

    const variantParts = productPlan.variantUpdates.map((variant) => {
      const label = variant.label || variant.sku || variant.variantId || "variant";
      const price = variant.price || "n/a";
      const compareAt = variant.compareAtPrice ? ` compare-at ${variant.compareAtPrice}` : "";
      return `${label} -> ${price}${compareAt}`;
    });

    const mediaParts = productPlan.mediaTargets.map(
      (entry) => `${entry.imageSrc} -> ${entry.alt.slice(0, 48)}${entry.alt.length > 48 ? "…" : ""}`,
    );

    const confidenceLabel = `${productPlan.rewriteLevel || "low"} confidence ${Number(productPlan.confidence || 0)} / 100`;

    process.stdout.write(`- ${productPlan.handle}\n`);
    process.stdout.write(`  ${confidenceLabel}\n`);
    if (updateBits.length) {
      process.stdout.write(`  fields: ${updateBits.join(", ")}\n`);
    }
    if (variantParts.length) {
      process.stdout.write(`  variants:\n`);
      for (const part of variantParts) {
        process.stdout.write(`    ${part}\n`);
      }
    }
    if (mediaParts.length) {
      process.stdout.write(`  images:\n`);
      for (const part of mediaParts) {
        process.stdout.write(`    ${part}\n`);
      }
    }
    if (productPlan.categoryQuery) {
      process.stdout.write(
        `  category: ${productPlan.categoryQuery}${productPlan.categoryId ? ` -> ${productPlan.categoryId}` : ""}\n`,
      );
    }
    if (Array.isArray(productPlan.reasons) && productPlan.reasons.length) {
      process.stdout.write(`  reasons: ${productPlan.reasons.slice(0, 5).join(" | ")}\n`);
    }
    process.stdout.write(`  write-count: ${productPlan.writeCount || 0}\n`);
  }

  if (productDetails.length < plan.products.length) {
    process.stdout.write(
      `  ... ${plan.products.length - productDetails.length} additional handle group(s) are recorded in the manifest.\n`,
    );
  }

  if (plan.warnings.length) {
    process.stdout.write("\nWarnings:\n");
    for (const warning of plan.warnings) {
      process.stdout.write(`- ${warning}\n`);
    }
  }
}

async function resolveCategoryIdLive(categoryQuery, cache) {
  const raw = normalizePlainText(categoryQuery);
  const normalized = raw.toLowerCase();
  if (!normalized) {
    return null;
  }

  if (/^gid:\/\/shopify\/[a-z0-9_]+\/\d+$/i.test(normalized)) {
    return raw;
  }

  if (cache.has(normalized)) {
    return cache.get(normalized);
  }

  const apiClient = ADMIN_ACCESS_TOKEN
    ? fetchShopifyGraphQLWithRetry.bind(null)
    : executeStoreGraphQL.bind(null);

  const searchCandidates = [];
  if (/^\d+$/.test(raw)) {
    try {
      const googleCategory = await lookupGoogleTaxonomyCategory(raw);
      if (googleCategory) {
        searchCandidates.push(googleCategory);
      }
    } catch (error) {
      process.stdout.write(
        `Google taxonomy lookup failed for ${raw}: ${String(error?.message || error)}; continuing with Shopify search only.\n`,
      );
    }
  }
  searchCandidates.push(raw);

  const seen = new Set();
  const resolvedCandidates = await Promise.all(
    searchCandidates
      .map((candidate) => normalizePlainText(candidate))
      .filter(Boolean)
      .filter((candidate) => {
        const key = candidate.toLowerCase();
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      })
      .map(async (candidate) => searchShopifyTaxonomyCategory(candidate, apiClient)),
  );
  const categoryId = resolvedCandidates.find(Boolean) || null;

  cache.set(normalized, categoryId);
  return categoryId;
}

async function fetchProductByHandle(handle) {
  const data =
    ADMIN_ACCESS_TOKEN
      ? await fetchShopifyGraphQLWithRetry(PRODUCT_BY_HANDLE_QUERY, {
          identifier: { handle },
        })
      : await executeStoreGraphQL(PRODUCT_BY_HANDLE_QUERY, {
          identifier: { handle },
        });

  return data?.productByIdentifier || null;
}

function resolveProductVariant(liveVariants, variantPlan) {
  const variants = Array.isArray(liveVariants) ? liveVariants : [];

  const normalizedVariantId = normalizePlainText(variantPlan.variantId);
  if (normalizedVariantId) {
    const match = variants.find((variant) => normalizePlainText(variant?.id) === normalizedVariantId);
    if (match?.id) {
      return match;
    }
  }

  const normalizedSku = normalizeVariantMatch(variantPlan.sku);
  if (normalizedSku) {
    const match = variants.find((variant) => {
      const candidateSku = normalizeVariantMatch(variant?.sku);
      const looseCandidateSku = normalizeVariantMatchLoose(variant?.sku);
      const looseExpectedSku = normalizeVariantMatchLoose(variantPlan.sku);
      return candidateSku === normalizedSku || (looseCandidateSku && looseCandidateSku === looseExpectedSku);
    });
    if (match?.id) {
      return match;
    }
  }

  const normalizedLabel = normalizeVariantMatch(variantPlan.label);
  if (normalizedLabel) {
    const match = variants.find((variant) => {
      const titleMatch = variantTextMatches(variant?.title, variantPlan.label);
      const optionMatch = variantTextMatches(getVariantSelectedOptionText(variant), variantPlan.label);
      return titleMatch || optionMatch;
    });
    if (match?.id) {
      return match;
    }
  }

  const normalizedOptions = normalizeVariantMatch((variantPlan.optionValues || []).join(" / "));
  if (normalizedOptions) {
    const match = variants.find((variant) => {
      const titleMatch = variantTextMatches(variant?.title, variantPlan.optionValues.join(" / "));
      const selectedOptionsMatch = variantTextMatches(getVariantSelectedOptionText(variant), variantPlan.optionValues.join(" / "));
      return titleMatch || selectedOptionsMatch;
    });
    if (match?.id) {
      return match;
    }
  }

  return null;
}

function buildVariantInputs(product, productPlan) {
  const liveVariants = Array.isArray(product?.variants?.nodes) ? product.variants.nodes : [];

  const unresolved = [];
  const inputs = [];

  for (const entry of productPlan.variantUpdates) {
    const match = resolveProductVariant(liveVariants, entry);
    if (!match?.id) {
      unresolved.push(entry);
      continue;
    }

    const input = {
      id: match.id,
    };

    if (entry.price) {
      input.price = entry.price;
    }

    if (entry.compareAtPrice) {
      input.compareAtPrice = entry.compareAtPrice;
    }

    inputs.push(input);
  }

  return {
    inputs,
    unresolved,
  };
}

function buildGraphQLResultErrorPrefix(productPlan, operation) {
  return `${operation} failed for ${productPlan.handle}`;
}

async function applyProductPlan(productPlan, categoryCache) {
  const product = await fetchProductByHandle(productPlan.handle);
  if (!product?.id) {
    throw new Error(`Product handle not found in Shopify: ${productPlan.handle}`);
  }

  const categoryId =
    productPlan.categoryId ||
    (productPlan.categoryQuery ? await resolveCategoryIdLive(productPlan.categoryQuery, categoryCache) : null);

  const productInput = buildProductUpdateInput(product, productPlan, categoryId);
  const mutableProductInput = Object.fromEntries(
    Object.entries(productInput).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );

  if (Object.keys(mutableProductInput).length > 1) {
    const response =
      ADMIN_ACCESS_TOKEN
        ? await fetchShopifyGraphQLWithRetry(PRODUCT_UPDATE_MUTATION, {
            product: mutableProductInput,
          })
        : await executeStoreGraphQL(PRODUCT_UPDATE_MUTATION, {
            product: mutableProductInput,
          }, { allowMutations: true });

    const userErrors = response?.productUpdate?.userErrors || [];
    if (userErrors.length) {
      throw new Error(
        `${buildGraphQLResultErrorPrefix(productPlan, "Product update")}: ${userErrors
          .map((error) => `${error.field?.join?.(".") || ""} ${error.message}`.trim())
          .join("; ")}`,
      );
    }
  }

  const { inputs: variantInputs, unresolved } = buildVariantInputs(product, productPlan);
  if (unresolved.length) {
    throw new Error(
      `Variant update failed for ${productPlan.handle}: could not match ${unresolved
        .map((entry) => entry.label || entry.sku || entry.variantId || "variant")
        .join(", ")}`,
    );
  }

  if (variantInputs.length) {
    const variantResponse =
      ADMIN_ACCESS_TOKEN
        ? await fetchShopifyGraphQLWithRetry(PRODUCT_VARIANTS_BULK_UPDATE_MUTATION, {
            productId: product.id,
            variants: variantInputs,
          })
        : await executeStoreGraphQL(PRODUCT_VARIANTS_BULK_UPDATE_MUTATION, {
            productId: product.id,
            variants: variantInputs,
          }, { allowMutations: true });

    const userErrors = variantResponse?.productVariantsBulkUpdate?.userErrors || [];
    if (userErrors.length) {
      throw new Error(
        `${buildGraphQLResultErrorPrefix(productPlan, "Variant update")}: ${userErrors
          .map((error) => `${error.field?.join?.(".") || ""} ${error.message}`.trim())
          .join("; ")}`,
      );
    }
  }

  const mediaUpdates = buildMediaUpdateTargets(product.media?.nodes || [], productPlan.mediaTargets || []);
  if (mediaUpdates.length) {
    const mediaResponse =
      ADMIN_ACCESS_TOKEN
        ? await fetchShopifyGraphQLWithRetry(PRODUCT_UPDATE_MEDIA_MUTATION, {
            productId: product.id,
            media: mediaUpdates,
          })
        : await executeStoreGraphQL(PRODUCT_UPDATE_MEDIA_MUTATION, {
            productId: product.id,
            media: mediaUpdates,
          }, { allowMutations: true });

    const userErrors = mediaResponse?.productUpdateMedia?.userErrors || [];
    if (userErrors.length) {
      throw new Error(
        `${buildGraphQLResultErrorPrefix(productPlan, "Image alt update")}: ${userErrors
          .map((error) => `${error.field?.join?.(".") || ""} ${error.message}`.trim())
          .join("; ")}`,
      );
    }
  }

  process.stdout.write(`Applied ${productPlan.handle}\n`);
}

async function main() {
  const args = parseArgs(process.argv);
  const inputPath = requireInputPath(args.input);
  const { rows, header } = await readRowsFromSpreadsheet(inputPath);
  const outputTargets = deriveOutputTargets(inputPath, args.output);
  const catalogSnapshot = await loadLocalCatalogSnapshot();
  const catalogContext = createSeoCatalogContext(catalogSnapshot);
  const categoryCache = new Map();
  const mode = getModeLabel(args);
  const resolveCategories = !args.export;

  const plan = await buildSeoBatchPlan(rows, {
    resolveCategoryId: resolveCategories
      ? async (categoryQuery) => resolveCategoryIdLive(categoryQuery, categoryCache)
      : undefined,
    suppressCategoryWarnings: !resolveCategories,
    catalogContext,
  });

  const manifest = buildSeoBatchManifest(plan, {
    inputPath,
    mode,
  });

  await writeJsonFile(outputTargets.manifestPath, manifest);
  printPlanSummary(plan, { mode, maxProducts: 25 });
  process.stdout.write(`\nManifest written to ${outputTargets.manifestPath}\n`);

  if (args.export) {
    const exportRows = buildSeoBatchExportRows(rows, plan);
    const csv = buildCsvFromRows(exportRows, header);
    await writeTextFile(outputTargets.csvPath, csv);
    process.stdout.write(`Export written to ${outputTargets.csvPath}\n`);
    process.stdout.write("Export complete. No Shopify writes were made.\n");
    return;
  }

  if (args.dryRun) {
    process.stdout.write("\nDry run complete. No Shopify writes were made.\n");
    return;
  }

  const appliedHandles = [];
  const skippedHandles = [];

  for (const productPlan of plan.products) {
    try {
      await applyProductPlan(productPlan, categoryCache);
      appliedHandles.push(productPlan.handle);
    } catch (error) {
      const message = String(error?.message || error);
      if (/Product handle not found in Shopify/i.test(message)) {
        skippedHandles.push(`${productPlan.handle} (${message})`);
        process.stdout.write(`Skipped ${productPlan.handle}: ${message}\n`);
        continue;
      }

      throw error;
    }
  }

  process.stdout.write(`\nUpdated ${appliedHandles.length} product group(s) on Shopify.\n`);
  if (skippedHandles.length) {
    process.stdout.write(`Skipped ${skippedHandles.length} missing product(s).\n`);
    for (const entry of skippedHandles) {
      process.stdout.write(`- ${entry}\n`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
