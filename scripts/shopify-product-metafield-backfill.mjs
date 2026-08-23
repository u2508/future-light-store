#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import { normalizeHandleValue, normalizePlainText, toShopifyGid } from "../src/lib/shopify-seo-batch.js";
import {
  inferDeterministicShopifyTaxonomyCategory,
} from "../src/lib/shopify-product-category.js";
import { mergeProductCustomData, normalizeProductCustomData, normalizeShopCustomData } from "../src/lib/product-custom-data.js";
import {
  buildMarketingBackfillPlan,
  buildMarketingMetafieldSetBatches,
} from "../src/lib/shopify-marketing-metafield-backfill.js";
import {
  BACKFILL_FIELD_IDS,
  buildBackfillPlan,
  buildMetafieldSetBatches,
} from "../src/lib/shopify-product-metafield-backfill.js";
import {
  buildCategoryMetafieldPlan,
} from "../src/lib/shopify-category-metafield-backfill.js";
import { readProductCatalogPayload } from "./product-catalog-files.mjs";
import { createRequestScheduler, envInteger } from "./lib/performance-runtime.mjs";

const DEFAULT_SHOP_BASE = "";
const DEFAULT_OUTPUT_FILE = resolve(process.cwd(), "output", "product-metafield-backfill-manifest.json");
const DEFAULT_INPUT_DIR = resolve(process.cwd(), "public", "data");
const PRODUCT_CATALOG_CHECKPOINT = resolve(process.cwd(), "output", ".shopify-metafield-live-catalog.json");
const PRODUCT_CUSTOM_DATA_CHECKPOINT = resolve(process.cwd(), "output", ".shopify-metafield-custom-data.json");
const PRODUCT_CUSTOM_DATA_BULK_RESULT = resolve(process.cwd(), "output", ".shopify-metafield-custom-data-bulk.jsonl");
const SHOP_BASE = process.env.SALT_SHOP_URL || DEFAULT_SHOP_BASE;
const SHOP_DOMAIN = new URL(SHOP_BASE).hostname;
const SHOPIFY_ADMIN_API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || "2026-07";
const SHOPIFY_ADMIN_ACCESS_TOKEN = String(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "").trim();
const SHOPIFY_ADMIN_GRAPHQL_URL = `${new URL(SHOP_BASE).origin}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`;
const SHOPIFY_CLI_AGENT_INFO = process.env.SHOPIFY_CLI_AGENT_INFO || "n:future-light-store|v:1|p:openai";
const SHOPIFY_CLI_AGENT_IDS =
  process.env.SHOPIFY_CLI_AGENT_IDS || `s:future-light-store|r:${process.pid}|i:future-light-store`;
const JUDGEME_PROXY_BASE_URL = process.env.SALT_JUDGEME_PROXY_BASE_URL || "";
const JUDGEME_PUBLIC_TOKEN =
  process.env.VITE_JUDGEME_PUBLIC_TOKEN ||
  process.env.JUDGEME_PUBLIC_TOKEN ||
  process.env.SALT_JUDGEME_PUBLIC_TOKEN ||
  "";
const BACKFILL_APPLY_CONCURRENCY = Math.max(1, Number(process.env.SALT_BACKFILL_APPLY_CONCURRENCY || 4));
const BACKFILL_READ_CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.SALT_BACKFILL_READ_CONCURRENCY || 4)));
const BACKFILL_BULK_THRESHOLD = Math.max(1, Number(process.env.SALT_BACKFILL_BULK_THRESHOLD || 500));
const JUDGEME_SHOP_DOMAINS = Array.from(
  new Set(
    [
      process.env.SALT_JUDGEME_SHOP_DOMAIN,
      process.env.VITE_JUDGEME_SHOP_DOMAIN,
      process.env.SALT_SHOP_URL,
      process.env.VITE_SALT_SHOP_URL,
      process.env.VITE_SHOPIFY_STOREFRONT_URL,
      DEFAULT_SHOP_BASE,
    ]
      .map((value) => normalizeDomain(value))
      .filter(Boolean),
  ),
);
const JUDGEME_FETCH_ENABLED = process.env.SALT_BACKFILL_LIVE_JUDGEME !== "0";
const JUDGEME_CONCURRENCY = Number(process.env.SALT_BACKFILL_JUDGEME_CONCURRENCY || 8);
const SHOPIFY_REQUEST_CONCURRENCY = envInteger("SALT_SHOPIFY_REQUEST_CONCURRENCY", 4, { min: 1, max: 8 });
const SHOPIFY_REQUEST_DELAY_MS = Math.max(0, Number(process.env.SALT_SHOPIFY_REQUEST_DELAY_MS || 125));
const shopifyRequestScheduler = createRequestScheduler({
  concurrency: SHOPIFY_REQUEST_CONCURRENCY,
  minIntervalMs: SHOPIFY_REQUEST_DELAY_MS,
});
const DIAPER_METAOBJECT_DEFINITION_ID = "gid://shopify/MetaobjectDefinition/9632874595";
// Shopify's existing standard color entries use Solid when a product has a
// color but no evidence-backed pattern. This keeps required Color metaobjects
// valid without inventing a product-specific pattern.
const DEFAULT_SOLID_PATTERN_TAXONOMY_VALUE_ID = "gid://shopify/TaxonomyValue/2874";
const execFileAsync = promisify(execFile);

const STAGED_UPLOAD_CREATE_MUTATION = /* GraphQL */ `
  mutation BackfillStagedUpload($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url parameters { name value } }
      userErrors { field message }
    }
  }
`;

const BULK_OPERATION_RUN_MUTATION = /* GraphQL */ `
  mutation BackfillRunBulk($mutation: String!, $stagedUploadPath: String!) {
    bulkOperationRunMutation(mutation: $mutation, stagedUploadPath: $stagedUploadPath) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }
`;

const BULK_OPERATION_RUN_QUERY = /* GraphQL */ `
  mutation BackfillRunBulkQuery($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }
`;

const BULK_OPERATION_STATUS_QUERY = /* GraphQL */ `
  query BackfillBulkStatus($id: ID!) {
    bulkOperation(id: $id) {
      id status errorCode objectCount fileSize url partialDataUrl createdAt completedAt
    }
  }
`;

const SHOPIFY_TAXONOMY_SEARCH_QUERY = /* GraphQL */ `
  query BackfillShopifyTaxonomySearch($search: String!, $first: Int!) {
    taxonomy {
      categories(first: $first, search: $search) {
        nodes { id name fullName }
      }
    }
  }
`;

const CATEGORY_METAFIELD_DEFINITIONS_QUERY = /* GraphQL */ `
  query CategoryMetafieldDefinitions($first: Int!, $ownerType: MetafieldOwnerType!) {
    metafieldDefinitions(first: $first, ownerType: $ownerType) {
      nodes {
        id
        namespace
        key
      name
      type { name }
      validations { name value }
      standardTemplate { id }
      constraints { key }
      }
    }
  }
`;

const CATEGORY_ATTRIBUTES_QUERY = /* GraphQL */ `
  query CategoryAttributes($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on TaxonomyCategory {
        id
        name
        fullName
        attributes(first: 250) {
      nodes {
        __typename
        ... on TaxonomyAttribute {
          id
        }
            ... on TaxonomyChoiceListAttribute {
              id
              name
              values(first: 250) { nodes { id name } }
            }
            ... on TaxonomyMeasurementAttribute {
              id
              name
              options { key value }
            }
          }
        }
      }
    }
  }
`;

const CATEGORY_METAOBJECTS_QUERY = /* GraphQL */ `
  query CategoryMetaobjects($type: String!, $first: Int!) {
    metaobjects(type: $type, first: $first) {
      nodes { id type fields { key value } }
    }
  }
`;

const CATEGORY_METAOBJECT_DEFINITION_QUERY = /* GraphQL */ `
  query CategoryMetaobjectDefinition($id: ID!) {
    metaobjectDefinition(id: $id) {
      id
      type
      name
      fieldDefinitions { key name required type { name } }
    }
  }
`;

const CATEGORY_METAOBJECT_NODES_QUERY = /* GraphQL */ `
  query CategoryMetaobjectNodes($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Metaobject { id type fields { key value } }
    }
  }
`;

const CATEGORY_METAOBJECT_CREATE_MUTATION = /* GraphQL */ `
  mutation CategoryMetaobjectCreate($metaobject: MetaobjectCreateInput!) {
    metaobjectCreate(metaobject: $metaobject) {
      metaobject { id type fields { key value } }
      userErrors { field message code }
    }
  }
`;

const BULK_METAFIELDS_SET_MUTATION = /* GraphQL */ `
  mutation BackfillBulkMetafields($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id namespace key }
      userErrors { field message code }
    }
  }
`;

// MetafieldReference is a union in the Admin API. Scalar selections such as
// `id` must be nested under concrete-type fragments; Shopify rejects direct
// selections on the union during bulk-query validation.
const METAFIELD_REFERENCE_NODE_FIELDS = /* GraphQL */ `
  __typename
  ... on Product {
    id
    legacyResourceId
    handle
    title
    productType
    vendor
  }
  ... on ProductVariant {
    id
    legacyResourceId
    title
  }
  ... on Metaobject {
    id
    handle
    displayName
    type
  }
  ... on Collection {
    id
    handle
    title
  }
`;

const BULK_PRODUCT_CUSTOM_DATA_QUERY = /* GraphQL */ `
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
          createdAt
          updatedAt
          publishedAt
          variants {
            edges {
              node {
                id
                legacyResourceId
                title
                price
                compareAtPrice
                availableForSale
                sku
                barcode
              }
            }
          }
          category { id name fullName }
          metafields(first: 250) {
            edges {
              node {
                id
                namespace
                key
                type
                value
                jsonValue
                references(first: 50) { edges { node { ${METAFIELD_REFERENCE_NODE_FIELDS} } } }
              }
            }
          }
          subtitle: metafield(namespace: "descriptors", key: "subtitle") { jsonValue value }
          badgeText: metafield(namespace: "salt-marketing", key: "badge_text") { jsonValue value }
          highlights: metafield(namespace: "salt-marketing", key: "highlights") { jsonValue value }
          collectionSignal: metafield(namespace: "salt-marketing", key: "collection_signal") { jsonValue value }
          rating: metafield(namespace: "reviews", key: "rating") { jsonValue value }
          ratingCount: metafield(namespace: "reviews", key: "rating_count") { jsonValue value }
          relatedProductsDisplay: metafield(namespace: "shopify--discovery--product_recommendation", key: "related_products_display") { jsonValue value }
          relatedProducts: metafield(namespace: "shopify--discovery--product_recommendation", key: "related_products") { jsonValue value }
          complementaryProducts: metafield(namespace: "shopify--discovery--product_recommendation", key: "complementary_products") { jsonValue value }
          complementaryProductsFallback: metafield(namespace: "salt-recommendations", key: "complementary_products") { jsonValue value }
          searchProductBoosts: metafield(namespace: "shopify--discovery--product_search_boost", key: "queries") { jsonValue value }
          searchProductBoostFallback: metafield(namespace: "salt-search", key: "query_terms") { jsonValue value }
          googleCustomProduct: metafield(namespace: "mm-google-shopping", key: "custom_product") { jsonValue value }
          shopChannelMinimumQuantity: metafield(namespace: "salt-marketing", key: "shop_channel_minimum_quantity") { jsonValue value }
          diaperType: metafield(namespace: "shopify", key: "diaper-type") { jsonValue value }
          disclosures: metafield(namespace: "shopify", key: "disclosure") { jsonValue value }
        }
      }
    }
  }
`;

function parseArgs(argv) {
  const args = {
    dryRun: true,
    apply: false,
    inputDir: DEFAULT_INPUT_DIR,
    outputFile: DEFAULT_OUTPUT_FILE,
    limitProducts: 0,
    productIds: [],
    productHandles: [],
    productHandlesFile: "",
    onlyFields: [],
    productOnly: false,
    categoryOnly: false,
    categoryMetafieldsOnly: false,
    allActive: false,
    skipLiveReviews: false,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === "--apply") {
      args.apply = true;
      args.dryRun = false;
      continue;
    }

    if (token === "--dry-run") {
      args.dryRun = true;
      args.apply = false;
      continue;
    }

    if (token === "--input-dir") {
      if (!next) {
        throw new Error("Missing value for --input-dir");
      }
      args.inputDir = resolve(process.cwd(), next);
      index += 1;
      continue;
    }

    if (token === "--output-file") {
      if (!next) {
        throw new Error("Missing value for --output-file");
      }
      args.outputFile = resolve(process.cwd(), next);
      index += 1;
      continue;
    }

    if (token === "--limit-products" || token === "--sample") {
      if (!next) {
        throw new Error("Missing value for --limit-products");
      }
      args.limitProducts = Math.max(0, Number(next) || 0);
      index += 1;
      continue;
    }

    if (token === "--product-id") {
      if (!next) {
        throw new Error("Missing value for --product-id");
      }
      args.productIds.push(...String(next).split(",").map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0));
      index += 1;
      continue;
    }

    if (token === "--product-handle") {
      if (!next) {
        throw new Error("Missing value for --product-handle");
      }
      args.productHandles.push(
        ...String(next)
          .split(",")
          .map((value) => normalizeHandleValue(value))
          .filter(Boolean),
      );
      index += 1;
      continue;
    }

    if (token === "--product-handles-file") {
      if (!next) {
        throw new Error("Missing value for --product-handles-file");
      }
      args.productHandlesFile = resolve(process.cwd(), next);
      index += 1;
      continue;
    }

    if (token === "--only-field") {
      if (!next) {
        throw new Error("Missing value for --only-field");
      }
      args.onlyFields.push(...String(next).split(",").map((value) => value.trim()).filter(Boolean));
      index += 1;
      continue;
    }

    if (token === "--product-only") {
      args.productOnly = true;
      continue;
    }

    if (token === "--category-only") {
      args.categoryOnly = true;
      continue;
    }

    if (token === "--category-metafields-only") {
      args.categoryMetafieldsOnly = true;
      continue;
    }

    if (token === "--all-active") {
      args.allActive = true;
      continue;
    }

    if (token === "--skip-live-reviews") {
      args.skipLiveReviews = true;
      continue;
    }
  }

  if (args.apply) {
    args.dryRun = false;
  }

  return args;
}

function normalizeDomain(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  try {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return new URL(withProtocol).hostname.toLowerCase();
  } catch {
    return raw.replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
  }
}

function getShopifyCliEnv() {
  return {
    ...process.env,
    SHOPIFY_CLI_AGENT_INFO,
    SHOPIFY_CLI_AGENT_IDS,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkArray(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function isRetryableShopifyCliError(error) {
  const text = [error?.message, error?.stderr, error?.stdout, error?.code].filter(Boolean).join("\n").toLowerCase();

  return [
    "429",
    "too many requests",
    "retry-after",
    "temporarily unavailable",
    "service unavailable",
    "gateway timeout",
    "timeout",
    "aborted before it completed",
    "enotfound",
    "eai_again",
    "etimedout",
    "econnreset",
    "socket hang up",
    "fetch failed",
  ].some((needle) => text.includes(needle));
}

function formatMetafieldUserErrors(userErrors = []) {
  return userErrors
    .map((error) => `${error.field ? `${error.field.join(".")}: ` : ""}${error.message}`)
    .join(" | ");
}

function partitionMetafieldUserErrors(userErrors = [], entryCount = 0) {
  const failedIndexes = new Set();
  const nonEntryErrors = [];

  for (const error of Array.isArray(userErrors) ? userErrors : []) {
    const field = Array.isArray(error?.field) ? error.field : [];
    const maybeIndex = field[0] === "metafields" ? Number(field[1]) : Number.NaN;
    if (Number.isInteger(maybeIndex) && maybeIndex >= 0 && maybeIndex < entryCount) {
      failedIndexes.add(maybeIndex);
      continue;
    }

    nonEntryErrors.push(error);
  }

  return { failedIndexes, nonEntryErrors };
}

function computeCliRetryDelayMs(attempt) {
  const jitterMs = Math.floor(Math.random() * 500);
  return Math.min(60_000, 1500 * 2 ** attempt + jitterMs);
}

async function runShopifyStoreGraphQLInternal(query, variables = {}, { allowMutations = false } = {}) {
  if (SHOPIFY_ADMIN_ACCESS_TOKEN) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await fetch(SHOPIFY_ADMIN_GRAPHQL_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": SHOPIFY_ADMIN_ACCESS_TOKEN,
        },
        body: JSON.stringify({ query, variables }),
      });
      const payload = await response.json().catch(() => ({}));
      const graphQlErrors = Array.isArray(payload?.errors) ? payload.errors : [];
      const errorText = graphQlErrors.map((entry) => entry?.message || "Unknown GraphQL error").join(" | ");
      const throttled = response.status === 429 || /throttl|rate limit|too many requests/i.test(errorText);
      if (throttled && attempt < 4) {
        const delayMs = computeCliRetryDelayMs(attempt);
        process.stdout.write(`Shopify Admin GraphQL throttled; retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt + 1}/4)\n`);
        await sleep(delayMs);
        continue;
      }
      if (!response.ok) {
        throw new Error(`Shopify Admin GraphQL HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 500)}`);
      }
      if (graphQlErrors.length) {
        throw new Error(errorText);
      }
      return payload?.data || payload || {};
    }
    throw new Error("Shopify Admin GraphQL request exhausted its retry budget.");
  }

  const serializedVariables = variables && Object.keys(variables).length ? variables : null;
  const tempDir = await mkdtemp(join(tmpdir(), "salt-shopify-cli-"));
  const queryFile = join(tempDir, "operation.graphql");
  const outputFile = join(tempDir, "result.json");
  const variableFile = join(tempDir, "variables.json");

  try {
    await writeFile(queryFile, query, "utf8");
    if (serializedVariables) {
      await writeFile(variableFile, JSON.stringify(serializedVariables, null, 2), "utf8");
    }

    const args = [
      "store",
      "execute",
      "--store",
      SHOP_DOMAIN,
      "--version",
      SHOPIFY_ADMIN_API_VERSION,
      "--query-file",
      queryFile,
      "--output-file",
      outputFile,
      "--json",
    ];

    if (serializedVariables) {
      args.push("--variable-file", variableFile);
    }

    if (allowMutations) {
      args.push("--allow-mutations");
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await execFileAsync("shopify", args, {
          env: getShopifyCliEnv(),
          maxBuffer: 10 * 1024 * 1024,
        });
        break;
      } catch (error) {
        if (attempt < 4 && isRetryableShopifyCliError(error)) {
          const delayMs = computeCliRetryDelayMs(attempt);
          process.stdout.write(
            `Shopify CLI request failed; retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt + 1}/4)\n`,
          );
          await sleep(delayMs);
          continue;
        }

        throw error;
      }
    }

    const rawOutput = await readFile(outputFile, "utf8");
    const parsedOutput = JSON.parse(rawOutput);
    if (Array.isArray(parsedOutput.errors) && parsedOutput.errors.length) {
      const message = parsedOutput.errors.map((entry) => entry.message || "Unknown GraphQL error").join(" | ");
      throw new Error(`Shopify CLI GraphQL errors for ${SHOP_DOMAIN}: ${message}`);
    }

    return parsedOutput.data || parsedOutput || {};
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function runShopifyStoreGraphQL(query, variables = {}, options = {}) {
  return shopifyRequestScheduler.run(() => runShopifyStoreGraphQLInternal(query, variables, options));
}

function parseBadgeNumber(html, pattern) {
  const match = String(html || "").match(pattern);
  if (!match?.[1]) {
    return 0;
  }

  const normalized = match[1].replace(/,/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeJudgeMeHtml(raw) {
  if (!raw) {
    return "";
  }

  return raw
    .replace(/<style[^>]*jdgm-temp-hiding-style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(
      /(<div[^>]*class=['"][^'"]*jdgm-(?:rev-widg|prev-badge)[^'"]*['"][^>]*?)\sstyle=['"]display:\s*none;?['"]/gi,
      "$1",
    );
}

const PRODUCT_CUSTOM_DATA_QUERY = /* GraphQL */ `
  query ProductCustomData($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        legacyResourceId
        handle
        title
        descriptionHtml
        productType
        vendor
        tags
        status
        createdAt
        updatedAt
        publishedAt
        variants(first: 100) {
          nodes {
            id
            legacyResourceId
            title
            price
            compareAtPrice
            availableForSale
            sku
            barcode
          }
        }
        category {
          id
          name
          fullName
        }
        metafields(first: 250) {
          nodes {
            namespace
            key
            type
            value
            jsonValue
            references(first: 50) { nodes { ${METAFIELD_REFERENCE_NODE_FIELDS} } }
          }
        }
        subtitle: metafield(namespace: "descriptors", key: "subtitle") {
          jsonValue
          value
        }
        badgeText: metafield(namespace: "salt-marketing", key: "badge_text") {
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
        rating: metafield(namespace: "reviews", key: "rating") {
          jsonValue
          value
        }
        ratingCount: metafield(namespace: "reviews", key: "rating_count") {
          jsonValue
          value
        }
        relatedProductsDisplay: metafield(
          namespace: "shopify--discovery--product_recommendation"
          key: "related_products_display"
        ) {
          jsonValue
          value
        }
        relatedProducts: metafield(
          namespace: "shopify--discovery--product_recommendation"
          key: "related_products"
        ) {
          references(first: 50) {
            nodes {
              ... on Product {
                id
                legacyResourceId
                handle
                title
                productType
                vendor
              }
            }
          }
        }
        complementaryProducts: metafield(
          namespace: "shopify--discovery--product_recommendation"
          key: "complementary_products"
        ) {
          references(first: 50) {
            nodes {
              ... on Product {
                id
                legacyResourceId
                handle
                title
                productType
                vendor
              }
            }
          }
        }
        complementaryProductsFallback: metafield(
          namespace: "salt-recommendations"
          key: "complementary_products"
        ) {
          references(first: 50) {
            nodes {
              ... on Product {
                id
                legacyResourceId
                handle
                title
                productType
                vendor
              }
            }
          }
        }
        searchProductBoosts: metafield(
          namespace: "shopify--discovery--product_search_boost"
          key: "queries"
        ) {
          jsonValue
          value
        }
        searchProductBoostFallback: metafield(
          namespace: "salt-search"
          key: "query_terms"
        ) {
          jsonValue
          value
        }
        googleCustomProduct: metafield(namespace: "mm-google-shopping", key: "custom_product") {
          jsonValue
          value
        }
        shopChannelMinimumQuantity: metafield(
          namespace: "salt-marketing"
          key: "shop_channel_minimum_quantity"
        ) {
          jsonValue
          value
        }
        diaperType: metafield(namespace: "shopify", key: "diaper-type") {
          jsonValue
          value
          references(first: 50) {
            nodes {
              ... on Metaobject {
                id
                handle
                displayName
                type
              }
            }
          }
        }
        disclosures: metafield(namespace: "shopify", key: "disclosure") {
          references(first: 50) {
            nodes {
              ... on Metaobject {
                id
                handle
                displayName
                type
              }
            }
          }
        }
      }
    }
  }
`;

const PRODUCT_CATALOG_QUERY = /* GraphQL */ `
  query ProductMetafieldCatalog($first: Int!, $after: String) {
    products(first: $first, after: $after, sortKey: ID) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        legacyResourceId
        handle
        title
        descriptionHtml
        productType
        vendor
        tags
        status
        createdAt
        updatedAt
        publishedAt
        variants(first: 1) {
          nodes {
            id
            legacyResourceId
            title
            price
            compareAtPrice
            availableForSale
            sku
            barcode
          }
        }
      }
    }
  }
`;

const SHOP_CUSTOM_DATA_QUERY = /* GraphQL */ `
  query ShopCustomData {
    shop {
      id
      name
      bannerText: metafield(namespace: "salt-marketing", key: "banner_text") {
        jsonValue
        value
      }
      trustStrip: metafield(namespace: "salt-marketing", key: "trust_strip") {
        jsonValue
        value
      }
    }
  }
`;

function normalizeMetafieldReferenceNode(node) {
  if (!node || typeof node !== "object") {
    return null;
  }

  return {
    id: String(node.id || "").trim(),
    legacyResourceId: Number(node.legacyResourceId || 0) || null,
    handle: String(node.handle || "").trim(),
    title: String(node.title || node.displayName || node.name || "").trim(),
    productType: String(node.productType || "").trim(),
    vendor: String(node.vendor || "").trim(),
  };
}

function normalizeMetafieldReferenceList(nodes) {
  const references = Array.isArray(nodes) ? nodes : [];
  const seen = new Set();
  const result = [];

  for (const node of references) {
    const normalized = normalizeMetafieldReferenceNode(node);
    if (!normalized) {
      continue;
    }

    const key = normalized.legacyResourceId ? String(normalized.legacyResourceId) : normalized.id || normalized.handle;
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .flatMap((entry) => String(entry || "").split(/[\n,;|]+/g))
          .map((entry) => entry.trim())
          .filter(Boolean),
      ),
    );
  }

  const raw = String(value || "").trim();
  if (!raw) {
    return [];
  }

  return Array.from(
    new Set(
      raw
        .split(/[\n,;|]+/g)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

function parseBooleanValue(value) {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value || "").trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  return null;
}

function parseRatingValue(value) {
  if (value && typeof value === "object") {
    if (value.value != null) {
      return Number(value.value);
    }

    if (value.rating != null) {
      return Number(value.rating);
    }
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeLiveProductCustomDataNode(node) {
  if (!node) {
    return null;
  }

  return normalizeProductCustomData({
    metafields: node.metafields?.nodes || node.metafields?.edges?.map((edge) => edge?.node).filter(Boolean) || [],
    subtitle: node.subtitle?.jsonValue ?? node.subtitle?.value ?? null,
    badgeText: node.badgeText?.jsonValue ?? node.badgeText?.value ?? null,
    highlights: normalizeStringList(node.highlights?.jsonValue ?? node.highlights?.value ?? []),
    collectionSignal: node.collectionSignal?.jsonValue ?? node.collectionSignal?.value ?? null,
    rating: parseRatingValue(node.rating?.jsonValue ?? node.rating?.value ?? null),
    ratingCount: node.ratingCount?.jsonValue ?? node.ratingCount?.value ?? null,
    relatedProductsDisplay: node.relatedProductsDisplay?.jsonValue ?? node.relatedProductsDisplay?.value ?? null,
    relatedProducts: normalizeMetafieldReferenceList(node.relatedProducts?.references?.nodes || []),
    complementaryProducts: normalizeMetafieldReferenceList(node.complementaryProducts?.references?.nodes || []),
    complementaryProductsFallback: normalizeMetafieldReferenceList(
      node.complementaryProductsFallback?.references?.nodes || [],
    ),
    searchProductBoosts: normalizeStringList(node.searchProductBoosts?.jsonValue ?? node.searchProductBoosts?.value ?? []),
    searchProductBoostFallback: normalizeStringList(
      node.searchProductBoostFallback?.jsonValue ?? node.searchProductBoostFallback?.value ?? [],
    ),
    googleCustomProduct: parseBooleanValue(node.googleCustomProduct?.jsonValue ?? node.googleCustomProduct?.value ?? null),
    shopChannelMinimumQuantity:
      node.shopChannelMinimumQuantity?.jsonValue ?? node.shopChannelMinimumQuantity?.value ?? null,
    diaperType:
      node.diaperType?.jsonValue ??
      node.diaperType?.value ??
      (Array.isArray(node.diaperType?.references?.nodes) && node.diaperType.references.nodes.length
        ? node.diaperType.references.nodes
        : null) ??
      null,
  });
}

async function fetchLiveProductCustomDataMapBatched(products, productIds, fingerprint) {
  const records = new Map();
  const batches = chunkArray(productIds, 50);
  let nextBatchIndex = 0;
  let completedBatches = 0;
  const worker = async () => {
    while (true) {
      const batchIndex = nextBatchIndex++;
      if (batchIndex >= batches.length) return;
      const batch = batches[batchIndex];
      const payload = await runShopifyStoreGraphQL(PRODUCT_CUSTOM_DATA_QUERY, { ids: batch });
      for (const node of Array.isArray(payload?.nodes) ? payload.nodes : []) {
        if (!node?.legacyResourceId) continue;
        const customData = normalizeLiveProductCustomDataNode(node) || normalizeProductCustomData({});
        records.set(Number(node.legacyResourceId), buildLiveCustomDataRecord(node, customData));
      }
      completedBatches += 1;
      if (completedBatches % 5 === 0 || completedBatches === batches.length) {
        process.stdout.write(`Read live metafields batches ${completedBatches}/${batches.length} (${records.size} products)\n`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(BACKFILL_READ_CONCURRENCY, batches.length) }, () => worker()));

  await writeProductCustomDataCheckpoint(fingerprint, records);
  return records;
}

function buildLiveCustomDataRecord(node, customData) {
  return {
    liveProduct: {
      id: Number(node.legacyResourceId),
      handle: String(node.handle || ""),
      title: String(node.title || ""),
      body_html: String(node.descriptionHtml || ""),
      product_type: String(node.productType || ""),
      vendor: String(node.vendor || ""),
      tags: Array.isArray(node.tags) ? node.tags : [],
      status: String(node.status || "").toLowerCase(),
      created_at: node.createdAt || null,
      updated_at: node.updatedAt || null,
      published_at: node.publishedAt || null,
      variants: (node.variants?.nodes || []).map((variant) => ({
        id: Number(variant.legacyResourceId),
        title: String(variant.title || ""),
        price: String(variant.price || ""),
        compare_at_price: variant.compareAtPrice == null ? null : String(variant.compareAtPrice),
        available: Boolean(variant.availableForSale),
        sku: String(variant.sku || ""),
        barcode: String(variant.barcode || ""),
      })),
    },
    customData,
    category: node.category
      ? {
          id: String(node.category.id || ""),
          name: String(node.category.name || ""),
          fullName: String(node.category.fullName || ""),
        }
      : null,
    disclosures: normalizeMetafieldReferenceList(node.disclosures?.references?.nodes || []),
  };
}

function parseMetafieldReferenceNodes(field) {
  const raw = field?.jsonValue ?? field?.value ?? [];
  let values = raw;
  if (typeof values === "string") {
    try {
      values = JSON.parse(values);
    } catch {
      values = [];
    }
  }
  if (!Array.isArray(values)) values = values ? [values] : [];
  return values.map((value) => {
    const id = typeof value === "string" ? value : String(value?.id || "");
    return {
      id,
      legacyResourceId: Number(id.match(/(\d+)$/)?.[1] || 0) || null,
      __typename: id.includes("/Metaobject/") ? "Metaobject" : "Product",
    };
  }).filter((value) => value.id);
}

function attachBulkReferenceNodes(node) {
  const result = { ...node };
  for (const key of ["relatedProducts", "complementaryProducts", "complementaryProductsFallback", "diaperType", "disclosures"]) {
    if (!node?.[key]) continue;
    result[key] = {
      ...node[key],
      references: { nodes: parseMetafieldReferenceNodes(node[key]) },
    };
  }
  return result;
}

async function writeProductCustomDataCheckpoint(fingerprint, records) {
  await mkdir(dirname(PRODUCT_CUSTOM_DATA_CHECKPOINT), { recursive: true });
  await writeFile(
    PRODUCT_CUSTOM_DATA_CHECKPOINT,
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      complete: true,
      fingerprint,
      records: Array.from(records.entries()),
    })}\n`,
    "utf8",
  );
}

async function fetchLiveProductCustomDataMapBulk(productIds, fingerprint) {
  const selectedIds = new Set(productIds);
  const payload = await runShopifyStoreGraphQL(BULK_OPERATION_RUN_QUERY, {
    query: BULK_PRODUCT_CUSTOM_DATA_QUERY,
  }, { allowMutations: true });
  const startErrors = payload?.bulkOperationRunQuery?.userErrors || [];
  if (startErrors.length) {
    throw new Error(`Metafield export failed to start: ${formatMetafieldUserErrors(startErrors)}`);
  }
  const operationId = payload?.bulkOperationRunQuery?.bulkOperation?.id;
  if (!operationId) throw new Error("Shopify returned no metafield export operation id");
  const operation = await waitForBackfillBulkOperation(operationId, "Metafield export");
  if (!operation.url) throw new Error("Completed metafield export returned no result URL");
  const response = await fetch(operation.url);
  if (!response.ok) throw new Error(`Metafield export download failed (${response.status})`);
  await writeFile(PRODUCT_CUSTOM_DATA_BULK_RESULT, Buffer.from(await response.arrayBuffer()));

  const productsById = new Map();
  const variantsByProductId = new Map();
  for (const line of (await readFile(PRODUCT_CUSTOM_DATA_BULK_RESULT, "utf8")).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const node = JSON.parse(line);
    if (node.__parentId) {
      if (!variantsByProductId.has(node.__parentId)) variantsByProductId.set(node.__parentId, []);
      variantsByProductId.get(node.__parentId).push(node);
      continue;
    }
    if (node?.id && selectedIds.has(node.id)) productsById.set(node.id, node);
  }

  const records = new Map();
  for (const [id, rawNode] of productsById) {
    const node = attachBulkReferenceNodes({
      ...rawNode,
      variants: { nodes: variantsByProductId.get(id) || [] },
    });
    const customData = normalizeLiveProductCustomDataNode(node) || normalizeProductCustomData({});
    records.set(Number(node.legacyResourceId), buildLiveCustomDataRecord(node, customData));
  }
  if (records.size !== productIds.length) {
    process.stdout.write(`Metafield export matched ${records.size}/${productIds.length} selected Shopify products\n`);
  } else {
    process.stdout.write(`Metafield export read ${records.size} selected Shopify products\n`);
  }
  await writeProductCustomDataCheckpoint(fingerprint, records);
  return { records, operation };
}

async function fetchLiveProductCustomDataMap(products) {
  const productIds = Array.isArray(products)
    ? products
        .map((product) => toShopifyGid("Product", product.id))
        .filter(Boolean)
    : [];

  const fingerprint = `v5:${productIds.length}:${productIds[0] || ""}:${productIds.at(-1) || ""}`;
  try {
    const checkpoint = await loadJson(PRODUCT_CUSTOM_DATA_CHECKPOINT, "metafield custom-data checkpoint");
    const age = Date.now() - new Date(checkpoint?.generatedAt || 0).getTime();
    if (
      checkpoint?.complete &&
      checkpoint?.fingerprint === fingerprint &&
      Number.isFinite(age) &&
      age >= 0 &&
      age < 6 * 60 * 60 * 1000 &&
      Array.isArray(checkpoint.records)
    ) {
      process.stdout.write(`Using fresh metafield readback checkpoint for ${checkpoint.records.length} products\n`);
      return new Map(checkpoint.records);
    }
  } catch {
    // Missing or stale checkpoints fall through to live Shopify reads.
  }

  if (productIds.length >= 500) {
    try {
      return (await fetchLiveProductCustomDataMapBulk(productIds, fingerprint)).records;
    } catch (error) {
      process.stdout.write(`Bulk metafield export failed; falling back to bounded batches: ${error.message || error}\n`);
    }
  }
  return fetchLiveProductCustomDataMapBatched(products, productIds, fingerprint);
}

function normalizeLiveCatalogProduct(node) {
  const id = Number(node?.legacyResourceId || 0);
  if (!id || !node?.handle) {
    return null;
  }

  const variants = (node.variants?.nodes || []).map((variant) => ({
    id: Number(variant.legacyResourceId || 0),
    title: String(variant.title || ""),
    price: String(variant.price || ""),
    compare_at_price: variant.compareAtPrice == null ? null : String(variant.compareAtPrice),
    available: Boolean(variant.availableForSale),
    sku: String(variant.sku || ""),
    barcode: String(variant.barcode || ""),
  }));

  return {
    id,
    admin_graphql_api_id: String(node.id || toShopifyGid("Product", id)),
    handle: normalizeHandleValue(node.handle),
    title: String(node.title || ""),
    body_html: String(node.descriptionHtml || ""),
    product_type: String(node.productType || ""),
    vendor: String(node.vendor || ""),
    tags: Array.isArray(node.tags) ? node.tags : [],
    status: String(node.status || "").toLowerCase(),
    created_at: node.createdAt || null,
    updated_at: node.updatedAt || null,
    published_at: node.publishedAt || null,
    variants,
    images: [],
    image: null,
  };
}

async function fetchLiveProductCatalog() {
  const useCatalogCheckpoint = process.env.SALT_BACKFILL_USE_CATALOG_CHECKPOINT === "1";
  let checkpoint = null;
  try {
    checkpoint = await loadJson(PRODUCT_CATALOG_CHECKPOINT, "metafield live catalog checkpoint");
  } catch {
    checkpoint = null;
  }

  if (!useCatalogCheckpoint) {
    checkpoint = null;
  }

  const checkpointAge = Date.now() - new Date(checkpoint?.generatedAt || 0).getTime();
  const checkpointIsFresh = useCatalogCheckpoint && Number.isFinite(checkpointAge) && checkpointAge >= 0 && checkpointAge < 6 * 60 * 60 * 1000;
  if (
    useCatalogCheckpoint &&
    checkpointIsFresh &&
    checkpoint?.complete &&
    Array.isArray(checkpoint.products) &&
    checkpoint.products.length
  ) {
    process.stdout.write(`Using fresh Admin product catalog checkpoint with ${checkpoint.products.length} products\n`);
    return checkpoint.products;
  }

  const products = checkpointIsFresh && !checkpoint?.complete && Array.isArray(checkpoint?.products)
    ? checkpoint.products
    : [];
  let after = products.length ? checkpoint?.endCursor || null : null;
  let page = Number(checkpointIsFresh ? checkpoint?.page || 0 : 0);

  if (products.length) {
    process.stdout.write(`Resuming Admin product catalog after ${products.length} products\n`);
  }

  do {
    const payload = await runShopifyStoreGraphQL(PRODUCT_CATALOG_QUERY, { first: 250, after });
    const connection = payload?.products || {};
    const pageProducts = (connection.nodes || []).map(normalizeLiveCatalogProduct).filter(Boolean);
    products.push(...pageProducts);
    page += 1;
    process.stdout.write(`Fetched Admin product catalog page ${page}: ${pageProducts.length} (${products.length} total)\n`);
    after = connection.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null;

    await mkdir(dirname(PRODUCT_CATALOG_CHECKPOINT), { recursive: true });
    await writeFile(
      PRODUCT_CATALOG_CHECKPOINT,
      `${JSON.stringify({
        generatedAt: checkpointIsFresh && checkpoint?.generatedAt ? checkpoint.generatedAt : new Date().toISOString(),
        complete: !after,
        page,
        endCursor: after,
        products,
      })}\n`,
      "utf8",
    );
  } while (after);

  return products;
}

function parseJudgeMeBadge(html) {
  const rating =
    parseBadgeNumber(html, /data-average-rating=["']([0-5](?:\.\d+)?)["']/i) ||
    parseBadgeNumber(html, /data-score=["']([0-5](?:\.\d+)?)["']/i) ||
    parseBadgeNumber(html, /\b([0-5](?:\.\d+)?)\s*(?:out of 5|stars?)/i);
  const reviewCount =
    parseBadgeNumber(html, /data-number-of-reviews=["']([0-9,]+)["']/i) ||
    parseBadgeNumber(html, /data-number-of-ratings=["']([0-9,]+)["']/i) ||
    parseBadgeNumber(html, /\b([0-9][0-9,]*)\s+(?:reviews?|ratings?)\b/i);

  if (!rating && !reviewCount) {
    return null;
  }

  return {
    rating: Math.min(5, Math.max(0, rating || 0)),
    reviewCount: Math.max(0, reviewCount || 0),
  };
}

function parseJudgeMeWidgetSummary(html) {
  if (!html || typeof DOMParser === "undefined") {
    return null;
  }

  const doc = new DOMParser().parseFromString(html, "text/html");
  const widgetRoot = doc.querySelector(".jdgm-rev-widg");
  const rootCount = Number(widgetRoot?.getAttribute("data-number-of-reviews") || 0);
  const rootAverage = Number(widgetRoot?.getAttribute("data-average-rating") || 0);

  const reviewNodes = Array.from(doc.querySelectorAll(".jdgm-rev"));
  const reviewCountFromNodes = reviewNodes.length;
  const averageFromNodes =
    reviewCountFromNodes > 0
      ? reviewNodes.reduce((sum, node) => {
          const score = Number(node.querySelector(".jdgm-rev__rating")?.getAttribute("data-score") || 0);
          return sum + (Number.isFinite(score) ? score : 0);
        }, 0) / reviewCountFromNodes
      : 0;

  const reviewCount = Math.max(rootCount, reviewCountFromNodes);
  const rating =
    reviewCountFromNodes >= rootCount && averageFromNodes > 0
      ? averageFromNodes
      : rootAverage > 0
        ? rootAverage
        : averageFromNodes;

  if (!reviewCount && !rating) {
    return null;
  }

  return {
    rating: Math.min(5, Math.max(0, rating || 0)),
    reviewCount: Math.max(0, reviewCount || 0),
  };
}

function buildJudgeMeProxyUrl(pathname, searchParams) {
  const cleanPath = String(pathname || "").replace(/^\/+/, "");
  const baseUrl = JUDGEME_PROXY_BASE_URL.replace(/\/+$/, "");
  const url = new URL(`${baseUrl}/api/judgeme/${cleanPath}`);

  if (searchParams) {
    searchParams.forEach((value, key) => {
      if (key === "t") {
        return;
      }

      url.searchParams.append(key, value);
    });
  }

  return url.toString();
}

async function requestJudgeMeSummary(productId, shopDomain) {
  if (!JUDGEME_PUBLIC_TOKEN) {
    return null;
  }

  const baseParams = new URLSearchParams({
    public_token: JUDGEME_PUBLIC_TOKEN,
    api_token: JUDGEME_PUBLIC_TOKEN,
    shop_domain: shopDomain,
    external_id: String(productId),
    t: String(Date.now()),
  });

  const previewEndpoint = buildJudgeMeProxyUrl("widgets/preview_badge", baseParams);
  const widgetEndpoint = buildJudgeMeProxyUrl(
    "widgets/product_review",
    new URLSearchParams({
      ...Object.fromEntries(baseParams.entries()),
      page: "1",
      per_page: "100",
    }),
  );

  const [previewResponse, widgetResponse] = await Promise.all([
    fetch(previewEndpoint, { credentials: "omit" }),
    fetch(widgetEndpoint, { credentials: "omit" }),
  ]);

  if (!previewResponse.ok && !widgetResponse.ok) {
    return null;
  }

  const previewPayload = previewResponse.ok ? await previewResponse.json() : {};
  const widgetPayload = widgetResponse.ok ? await widgetResponse.json() : {};
  const badgeSummary = parseJudgeMeBadge(normalizeJudgeMeHtml(String(previewPayload.badge || "")));
  const widgetSummary = parseJudgeMeWidgetSummary(normalizeJudgeMeHtml(String(widgetPayload.widget || "")));

  if (!badgeSummary && !widgetSummary) {
    return null;
  }

  const badgeCount = badgeSummary?.reviewCount || 0;
  const widgetCount = widgetSummary?.reviewCount || 0;
  const finalReviewCount = Math.max(badgeCount, widgetCount);
  const finalRating =
    widgetCount >= badgeCount && (widgetSummary?.rating || 0) > 0
      ? Number(widgetSummary?.rating || 0)
      : (badgeSummary?.rating || 0) > 0
        ? Number(badgeSummary?.rating || 0)
        : Number(widgetSummary?.rating || 0);

  return {
    productId,
    rating: Math.min(5, Math.max(0, finalRating || 0)),
    reviewCount: Math.max(0, finalReviewCount || 0),
    source: "judgeme",
  };
}

async function collectJudgeMeSummaries(products) {
  const summaries = new Map();
  if (!JUDGEME_FETCH_ENABLED || !JUDGEME_PUBLIC_TOKEN) {
    return summaries;
  }

  const candidates = [];
  for (const product of products) {
    const existing = normalizeProductCustomData({
      ...(product.customData || {}),
      rating: product.customData?.rating ?? product.average_rating ?? null,
      ratingCount: product.customData?.ratingCount ?? product.total_reviews ?? null,
    });

    const missingRating = existing.rating == null;
    const missingCount = existing.ratingCount == null;
    if (missingRating || missingCount) {
      candidates.push({ product, missingRating, missingCount });
    }
  }

  if (!candidates.length) {
    return summaries;
  }

  for (const shopDomain of JUDGEME_SHOP_DOMAINS) {
    const unresolved = candidates.filter((entry) => !summaries.has(entry.product.id));

    if (!unresolved.length) {
      break;
    }

    const parallelism = Math.max(1, Math.min(JUDGEME_CONCURRENCY, unresolved.length));
    let index = 0;

    const runWorker = async () => {
      while (index < unresolved.length) {
        const current = unresolved[index];
        index += 1;

        try {
          const summary = await requestJudgeMeSummary(current.product.id, shopDomain);
          if (summary) {
            summaries.set(current.product.id, summary);
          }
        } catch {
          // Ignore transient Judge.me failures and keep the existing snapshot data.
        }
      }
    };

    await Promise.all(Array.from({ length: parallelism }, () => runWorker()));
  }

  return summaries;
}

async function fetchLiveShopRecord() {
  const payload = await runShopifyStoreGraphQL(SHOP_CUSTOM_DATA_QUERY);
  const shop = payload?.shop || {};

  return {
    id: String(shop.id || "shop"),
    name: String(shop.name || "SALT"),
    customData: normalizeShopCustomData({
      bannerText: shop.bannerText?.jsonValue ?? shop.bannerText?.value ?? null,
      trustStrip: normalizeStringList(shop.trustStrip?.jsonValue ?? shop.trustStrip?.value ?? []),
    }),
  };
}

async function loadJson(filePath, label) {
  const raw = await readFile(filePath, "utf8");
  const payload = JSON.parse(raw);
  if (!payload) {
    throw new Error(`Unable to parse ${label} at ${filePath}`);
  }

  return payload;
}

async function loadOptionalJson(filePath) {
  try {
    return await loadJson(filePath, "Shopify SEO live catalog");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    process.stdout.write(`Optional live catalog unavailable at ${filePath}: ${error.message}\n`);
    return null;
  }
}

function mergeReleaseCatalogProducts(localProducts, liveCatalogProducts) {
  const local = Array.isArray(localProducts) ? [...localProducts] : [];
  const handles = new Set(local.map((product) => normalizeHandleValue(product?.handle || "")).filter(Boolean));
  const liveOnly = (Array.isArray(liveCatalogProducts) ? liveCatalogProducts : []).filter((product) => {
    const handle = normalizeHandleValue(product?.handle || "");
    return handle && !handles.has(handle);
  });

  return [...local, ...liveOnly];
}

function filterProducts(products, { productIds, productHandles, limitProducts }) {
  let filtered = Array.isArray(products) ? [...products] : [];

  if (Array.isArray(productIds) && productIds.length) {
    const idSet = new Set(productIds.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0));
    filtered = filtered.filter((product) => idSet.has(Number(product?.id || 0)));
  }

  if (Array.isArray(productHandles) && productHandles.length) {
    const handleSet = new Set(productHandles.map((value) => normalizeHandleValue(value)).filter(Boolean));
    filtered = filtered.filter((product) => handleSet.has(normalizeHandleValue(product?.handle || "")));
  }

  filtered.sort((left, right) => Number(left?.id || 0) - Number(right?.id || 0));

  if (Number.isFinite(limitProducts) && limitProducts > 0) {
    filtered = filtered.slice(0, limitProducts);
  }

  return filtered;
}

async function discoverDiaperTypeOptions() {
  const definitionQuery = /* GraphQL */ `
    query DiaperTypeDefinition($id: ID!) {
      metaobjectDefinition(id: $id) {
        id
        name
        type
      }
    }
  `;

  try {
    const definitionPayload = await runShopifyStoreGraphQL(definitionQuery, {
      id: DIAPER_METAOBJECT_DEFINITION_ID,
    });
    const definition = definitionPayload.metaobjectDefinition;
    const metaobjectType = String(definition?.type || "").trim();
    if (!metaobjectType) {
      return {
        discovered: false,
        definition: null,
        options: [],
      };
    }

    const metaobjectsQuery = /* GraphQL */ `
      query DiaperTypeMetaobjects($type: String!, $first: Int!) {
        metaobjects(type: $type, first: $first) {
          nodes {
            id
            handle
            displayName
            type
          }
        }
      }
    `;

    const metaobjectPayload = await runShopifyStoreGraphQL(metaobjectsQuery, {
      type: metaobjectType,
      first: 100,
    });
    const nodes = Array.isArray(metaobjectPayload?.metaobjects?.nodes) ? metaobjectPayload.metaobjects.nodes : [];

    return {
      discovered: nodes.length > 0,
      definition,
      options: nodes.map((node) => ({
        id: String(node?.id || "").trim(),
        handle: String(node?.handle || "").trim(),
        displayName: String(node?.displayName || "").trim(),
        type: String(node?.type || "").trim(),
      })),
    };
  } catch (error) {
    process.stdout.write(`Diaper type discovery skipped: ${error.message}\n`);
    return {
      discovered: false,
      definition: null,
      options: [],
    };
  }
}

const DISCLOSURE_METAOBJECT_TYPES = [
  "shopify--disclosure-us-cpsc-choking_small_parts",
  "shopify--disclosure-us-cpsc-choking_balloons",
  "shopify--disclosure-us-cpsc-choking_marbles",
  "shopify--disclosure-us-cpsc-choking_small_balls",
  "shopify--disclosure-us-ca-prop65-cancer",
  "shopify--disclosure-us-ca-prop65-reproductive",
  "shopify--disclosure-us-ca-prop65-cancer_reproductive",
  "shopify--disclosure-us-ca-prop65-alcohol",
  "shopify--disclosure-custom",
];

async function discoverDisclosureOptions() {
  const query = /* GraphQL */ `
    query DisclosureMetaobjects($type: String!, $first: Int!) {
      metaobjects(type: $type, first: $first) {
        nodes {
          id
          handle
          displayName
          type
        }
      }
    }
  `;
  const options = [];

  for (const type of DISCLOSURE_METAOBJECT_TYPES) {
    try {
      const payload = await runShopifyStoreGraphQL(query, { type, first: 100 });
      for (const node of payload?.metaobjects?.nodes || []) {
        if (node?.id) {
          options.push({
            id: String(node.id),
            handle: String(node.handle || ""),
            displayName: String(node.displayName || ""),
            type: String(node.type || type),
          });
        }
      }
    } catch (error) {
      process.stdout.write(`Disclosure discovery skipped for ${type}: ${error.message}\n`);
    }
  }

  return { discovered: options.length > 0, options };
}

function normalizeTaxonomySegment(value) {
  return normalizePlainText(value)
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(ies)\b/g, "y")
    .replace(/\b(s)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function taxonomyTokens(value) {
  return new Set(normalizeTaxonomySegment(value).split(" ").filter(Boolean));
}

function taxonomyPathSegments(value) {
  return normalizePlainText(value)
    .split(/\s*>\s*/)
    .map((segment) => normalizePlainText(segment))
    .filter(Boolean);
}

const TAXONOMY_ROOT_ALIASES = new Map([
  ["luggage and bags", new Set(["luggage and bags", "apparel and accessories"])],
  ["toys and games", new Set(["toys and games", "arts and entertainment"])],
  ["baby and toddler", new Set(["baby and toddler"])],
]);

const ROOT_TAXONOMY_CATEGORIES = new Map([
  ["animals and pet supplies", ["ap", "Animals & Pet Supplies"]],
  ["apparel and accessories", ["aa", "Apparel & Accessories"]],
  ["arts and entertainment", ["ae", "Arts & Entertainment"]],
  ["baby and toddler", ["bt", "Baby & Toddler"]],
  ["business and industrial", ["bi", "Business & Industrial"]],
  ["cameras and optics", ["co", "Cameras & Optics"]],
  ["electronics", ["el", "Electronics"]],
  ["food beverages and tobacco", ["fb", "Food, Beverages & Tobacco"]],
  ["furniture", ["fr", "Furniture"]],
  ["hardware", ["ha", "Hardware"]],
  ["health and beauty", ["hb", "Health & Beauty"]],
  ["home and garden", ["hg", "Home & Garden"]],
  ["luggage and bags", ["lb", "Luggage & Bags"]],
  ["media", ["me", "Media"]],
  ["office supplies", ["os", "Office Supplies"]],
  ["services", ["se", "Services"]],
  ["software", ["sw", "Software"]],
  ["sporting goods", ["sg", "Sporting Goods"]],
  ["toys and games", ["tg", "Toys & Games"]],
  ["vehicles and parts", ["vp", "Vehicles & Parts"]],
]);

function pathRootMatches(requestedRoot, candidateRoot) {
  const requested = normalizeTaxonomySegment(requestedRoot);
  const candidate = normalizeTaxonomySegment(candidateRoot);
  if (requested === candidate) return true;
  return TAXONOMY_ROOT_ALIASES.get(requested)?.has(candidate) || false;
}

function tokenOverlap(left, right) {
  const a = taxonomyTokens(left);
  const b = taxonomyTokens(right);
  if (!a.size || !b.size) return 0;
  let matches = 0;
  for (const token of a) {
    if (b.has(token)) matches += 1;
  }
  return matches / Math.max(a.size, b.size);
}

function categoryPathScore(requestedPath, candidate) {
  const requestedSegments = taxonomyPathSegments(requestedPath);
  const candidateSegments = taxonomyPathSegments(candidate?.fullName || "");
  if (!requestedSegments.length || !candidateSegments.length) return Number.NEGATIVE_INFINITY;

  const requestedLeaf = requestedSegments.at(-1);
  const candidateLeaf = candidateSegments.at(-1);
  const requestedLeafNormalized = normalizeTaxonomySegment(requestedLeaf);
  const candidateLeafNormalized = normalizeTaxonomySegment(candidateLeaf);
  const leafOverlap = tokenOverlap(requestedLeaf, candidateLeaf);
  const leafExact = requestedLeafNormalized === candidateLeafNormalized;
  const leafContained = requestedLeafNormalized && candidateLeafNormalized && (
    candidateLeafNormalized.includes(requestedLeafNormalized) ||
    requestedLeafNormalized.includes(candidateLeafNormalized)
  );

  if (!leafExact && !leafContained && leafOverlap < 0.5) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = leafExact ? 100 : leafContained ? 82 : 65 + leafOverlap * 15;
  if (pathRootMatches(requestedSegments[0], candidateSegments[0])) {
    score += 45;
  }

  const requestedAncestors = requestedSegments.slice(0, -1);
  const candidateAncestors = candidateSegments.slice(0, -1);
  const requestedAncestorTokens = new Set(requestedAncestors.flatMap((segment) => [...taxonomyTokens(segment)]));
  const candidateAncestorTokens = new Set(candidateAncestors.flatMap((segment) => [...taxonomyTokens(segment)]));
  let ancestorMatches = 0;
  for (const token of requestedAncestorTokens) {
    if (candidateAncestorTokens.has(token)) ancestorMatches += 1;
  }
  score += Math.min(30, ancestorMatches * 6);

  if (candidateSegments.length >= requestedSegments.length) {
    score += 3;
  }
  return score;
}

async function fetchShopifyTaxonomyCategories(paths) {
  const categoriesById = new Map();
  let nextPath = 0;
  const worker = async () => {
    while (nextPath < paths.length) {
      const path = paths[nextPath++];
      const segments = taxonomyPathSegments(path);
      const searchTerms = [...new Set([path, segments.at(-1), segments.at(-2)].filter(Boolean))];
      for (const search of searchTerms) {
        const payload = await runShopifyStoreGraphQL(SHOPIFY_TAXONOMY_SEARCH_QUERY, {
          search,
          first: 250,
        });
        for (const category of payload?.taxonomy?.categories?.nodes || []) {
          if (category?.id && category?.fullName) categoriesById.set(category.id, category);
        }
      }
      process.stdout.write(`Loaded Shopify taxonomy evidence ${nextPath}/${paths.length} (${categoriesById.size} categories)\n`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, Math.max(1, paths.length)) }, () => worker()));
  return [...categoriesById.values()];
}

function resolveTaxonomyPath(path, categories) {
  const normalizedPath = normalizeTaxonomySegment(path);
  const exact = categories.filter((category) => normalizeTaxonomySegment(category.fullName) === normalizedPath);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;

  const scored = categories
    .map((category) => ({ category, score: categoryPathScore(path, category) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => right.score - left.score);
  const best = scored[0];
  const second = scored[1];
  if (best && best.score >= 90 && (!second || best.score - second.score >= 10)) return best.category;

  const root = normalizeTaxonomySegment(taxonomyPathSegments(path)[0]);
  const [rootId, rootName] = ROOT_TAXONOMY_CATEGORIES.get(root) || [];
  if (rootId) {
    return {
      id: `gid://shopify/TaxonomyCategory/${rootId}`,
      name: rootName,
      fullName: rootName,
      resolutionMethod: "deterministic-root-fallback",
    };
  }
  return null;
}

async function buildCategoryPlans(products) {
  const candidates = (Array.isArray(products) ? products : [])
    .map((product) => ({
      product,
      category: inferDeterministicShopifyTaxonomyCategory(product),
      currentCategory: product?.shopifyCategory || null,
    }))
    .filter((entry) => {
      if (!entry.category) return false;
      if (!entry.currentCategory?.id) return true;
      const inferredId = String(entry.category.id || "");
      const currentId = String(entry.currentCategory.id || "");
      const inferredPath = normalizeTaxonomySegment(entry.category.fullName || entry.category.name);
      const currentPath = normalizeTaxonomySegment(entry.currentCategory.fullName || entry.currentCategory.name);
      return (inferredId && currentId && inferredId !== currentId) ||
        (inferredPath && currentPath && inferredPath !== currentPath);
    });

  const paths = [...new Set(
    candidates
      .map(({ category }) => String(category.fullName || "").trim())
      .filter(Boolean),
  )];
  const resolvedByPath = new Map();
  const taxonomyCategories = await fetchShopifyTaxonomyCategories(paths);
  for (const path of paths) {
    const resolved = resolveTaxonomyPath(path, taxonomyCategories);
    if (resolved?.id) {
      resolvedByPath.set(path, {
        id: String(resolved.id),
        name: String(resolved.name || "").trim(),
        fullName: String(resolved.fullName || path).trim(),
      });
    }
    process.stdout.write(`Resolved Shopify taxonomy path ${resolvedByPath.size}/${paths.length}\n`);
  }

  const plans = candidates
    .map(({ product, category }) => {
      const resolved = category.id
        ? { id: category.id, name: category.name, fullName: category.fullName || category.name }
        : resolvedByPath.get(category.fullName);
      if (!resolved?.id) return null;
      return {
      productId: Number(product.id),
      productGid: toShopifyGid("Product", product.id),
      handle: normalizeHandleValue(product.handle || ""),
      title: String(product.title || ""),
      categoryId: resolved.id,
      categoryName: resolved.name || category.name,
      categoryFullName: resolved.fullName || category.fullName || "",
      confidence: category.confidence,
      reason: category.reason,
      action: product.shopifyCategory?.id ? "repair-mismatch" : "assign-missing",
      };
    })
    .filter(Boolean);

  return {
    plans,
    summary: {
      candidates: candidates.length,
      mismatched: candidates.filter(({ product }) => Boolean(product?.shopifyCategory?.id)).length,
      paths: paths.length,
      resolved: plans.length,
      unresolved: candidates.length - plans.length,
    },
  };
}

async function fetchCategoryMetafieldDefinitions() {
  const payload = await runShopifyStoreGraphQL(CATEGORY_METAFIELD_DEFINITIONS_QUERY, {
    first: 250,
    ownerType: "PRODUCT",
  });
  return (payload?.metafieldDefinitions?.nodes || [])
    .filter((definition) => definition?.namespace === "shopify" && definition?.key)
    .map((definition) => ({
      ...definition,
      type: definition.type?.name || definition.type || "",
      metaobjectDefinitionId: (definition.validations || []).find((validation) => validation?.name === "metaobject_definition_id")?.value || null,
    }));
}

async function fetchCategoryAttributesMap(categoryIds) {
  const ids = [...new Set(categoryIds.filter(Boolean).map(String))];
  const result = new Map();
  const chunks = chunkArray(ids, 50);
  let nextChunk = 0;
  const concurrency = Math.max(1, Math.min(4, Number(process.env.SALT_CATEGORY_READ_CONCURRENCY || 3)));
  const worker = async () => {
    while (true) {
      const index = nextChunk++;
      if (index >= chunks.length) return;
      const payload = await runShopifyStoreGraphQL(CATEGORY_ATTRIBUTES_QUERY, { ids: chunks[index] });
      for (const node of payload?.nodes || []) {
        if (node?.id) result.set(String(node.id), node);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, chunks.length)) }, () => worker()));
  return result;
}

async function buildCategoryMetafieldPlans(products, categoryPlanResult) {
  const intendedCategories = new Map(
    (products || [])
      .filter((product) => product?.shopifyCategory?.id)
      .map((product) => [Number(product.id), product.shopifyCategory]),
  );
  for (const plan of categoryPlanResult?.plans || []) {
    intendedCategories.set(Number(plan.productId), {
      id: plan.categoryId,
      name: plan.categoryName,
      fullName: plan.categoryFullName,
    });
  }
  const categoryIds = [...new Set([...intendedCategories.values()].map((category) => category?.id).filter(Boolean))];
  if (!categoryIds.length) {
    return { plans: [], writes: [], summary: { products: 0, attributes: 0, candidates: 0, plannedWrites: 0, skipped: 0, requiresMetaobjectScopes: false } };
  }
  const [definitions, attributesByCategory] = await Promise.all([
    fetchCategoryMetafieldDefinitions(),
    fetchCategoryAttributesMap(categoryIds),
  ]);
  const plans = [];
  for (const product of products || []) {
    const category = intendedCategories.get(Number(product.id));
    if (!category?.id) continue;
    const attributes = attributesByCategory.get(String(category.id))?.attributes?.nodes || [];
    const plan = buildCategoryMetafieldPlan({ product, category, definitions, attributes });
    plans.push({ ...plan, categoryName: category.name, categoryFullName: category.fullName });
  }
  const writes = plans.flatMap((plan) => plan.writes || []);
  return {
    plans,
    writes,
    definitions,
    summary: {
      products: plans.length,
      attributes: plans.reduce((sum, plan) => sum + (plan.writes?.length || 0) + (plan.skipped?.length || 0), 0),
      candidates: writes.length,
      plannedWrites: writes.length,
      skipped: plans.reduce((sum, plan) => sum + (plan.skipped?.length || 0), 0),
      requiresMetaobjectScopes: writes.length > 0,
      scopeNote: writes.length ? "Applying category values requires read_metaobjects and write_metaobjects." : null,
    },
  };
}

function categoryMetafieldBatches(entries, maxEntries = 25) {
  const batches = [];
  for (let index = 0; index < entries.length; index += maxEntries) {
    batches.push({
      entries: entries.slice(index, index + maxEntries),
      productIds: [...new Set(entries.slice(index, index + maxEntries).map((entry) => entry.productId))],
      size: Math.min(maxEntries, entries.length - index),
    });
  }
  return batches;
}

function categoryMetaobjectFieldValue(write, fieldDefinition = null) {
  const fieldType = String(fieldDefinition?.type?.name || fieldDefinition?.type || "").toLowerCase();
  if (fieldType.startsWith("list.") || write.taxonomyFieldKey === "color_taxonomy_reference") {
    return JSON.stringify([write.taxonomyValueId]);
  }
  return write.taxonomyValueId;
}

function categoryMetaobjectFieldContainsValue(field, taxonomyValueId) {
  const raw = String(field?.value || "").trim();
  if (!raw) return false;
  if (raw === taxonomyValueId) return true;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.map(String).includes(String(taxonomyValueId));
  } catch {
    return false;
  }
}

async function ensureCategoryMetaobjectDefinition(write, cache) {
  const definitionId = String(write.metaobjectDefinitionId || "").trim();
  const cacheKey = `${write.metaobjectType}:${definitionId}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  if (!definitionId) {
    throw new Error(
      `${write.metaobjectType}: category metafield is missing its metaobject_definition_id validation; refusing to invent or create a Shopify-owned definition.`,
    );
  }
  const payload = await runShopifyStoreGraphQL(CATEGORY_METAOBJECT_DEFINITION_QUERY, { id: definitionId });
  const definition = payload?.metaobjectDefinition || null;
  if (!definition?.id) {
    throw new Error(
      `${write.metaobjectType}: Shopify did not return metaobject definition ${definitionId}. Re-authorize the CLI with read_metaobjects/read_metaobject_definitions, then resume.`,
    );
  }
  cache.set(cacheKey, definition);
  return definition;
}

function categoryMetaobjectTaxonomyFieldDefinition(write, definition) {
  const fieldDefinitions = Array.isArray(definition?.fieldDefinitions) ? definition.fieldDefinitions : [];
  const attributeToken = String(write.attributeName || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const taxonomyFields = fieldDefinitions.filter((field) => /taxonomy.*reference|reference.*taxonomy/i.test(String(field?.type?.name || field?.type || "")));
  return taxonomyFields.find((field) => {
    const fieldToken = `${field?.key || ""} ${field?.name || ""}`.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return attributeToken && fieldToken.includes(attributeToken);
  }) || taxonomyFields[0] || null;
}

function categoryMetaobjectExpectedFields(writes, definition) {
  const fieldDefinitions = Array.isArray(definition?.fieldDefinitions) ? definition.fieldDefinitions : [];
  const taxonomyFields = fieldDefinitions.filter((field) => /taxonomy.*reference|reference.*taxonomy/i.test(String(field?.type?.name || field?.type || "")));
  const expected = [];
  for (const fieldDefinition of taxonomyFields) {
    const fieldToken = `${fieldDefinition?.key || ""} ${fieldDefinition?.name || ""}`.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const matchingWrite = writes.length === 1 && taxonomyFields.length === 1
      ? writes[0]
      : writes.find((write) => {
      const attributeToken = String(write.attributeName || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
      return attributeToken && fieldToken.includes(attributeToken);
      });
    if (matchingWrite) {
      expected.push({
        fieldDefinition,
        value: categoryMetaobjectFieldValue({ ...matchingWrite, taxonomyFieldKey: fieldDefinition.key }, fieldDefinition),
        taxonomyValueId: matchingWrite.taxonomyValueId,
      });
      continue;
    }
    // The Shopify Color definition requires both Base color and Base pattern.
    // A color-only product is valid with the standard Solid pattern, but a
    // pattern-only product must never receive an invented color reference.
    if (/pattern/i.test(fieldToken) && writes.some((write) => /color/i.test(String(write.attributeName || "")))) {
      expected.push({
        fieldDefinition,
        value: DEFAULT_SOLID_PATTERN_TAXONOMY_VALUE_ID,
        taxonomyValueId: DEFAULT_SOLID_PATTERN_TAXONOMY_VALUE_ID,
      });
    } else if (fieldDefinition.required) {
      throw new Error(`${definition?.type || "category metaobject"}: required field ${fieldDefinition.key} has no evidence-backed value.`);
    }
  }
  return expected;
}

async function resolveCategoryMetaobjectReference(write, cache, definitionCache, definition = null, relatedWrites = [write], metaobjectsCache = new Map()) {
  const cacheKey = `${write.metaobjectType}:${relatedWrites.map((entry) => `${entry.attributeName}:${entry.taxonomyValueId}`).sort().join("|")}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const resolvedDefinition = definition || await ensureCategoryMetaobjectDefinition(write, definitionCache);
  const expectedFields = categoryMetaobjectExpectedFields(relatedWrites, resolvedDefinition);
  const expectedByKey = new Map(expectedFields.map((entry) => [String(entry.fieldDefinition.key), entry]));
  let metaobjectNodes = metaobjectsCache.get(write.metaobjectType);
  if (!metaobjectNodes) {
    const payload = await runShopifyStoreGraphQL(CATEGORY_METAOBJECTS_QUERY, {
      type: write.metaobjectType,
      first: 250,
    });
    metaobjectNodes = payload?.metaobjects?.nodes || [];
    metaobjectsCache.set(write.metaobjectType, metaobjectNodes);
  }
  const existing = metaobjectNodes.find((node) =>
    expectedFields.every((expected) => {
      const field = (node?.fields || []).find((entry) => entry?.key === expected.fieldDefinition.key);
      return categoryMetaobjectFieldContainsValue(field, expected.taxonomyValueId);
    }),
  );
  if (existing?.id) {
    cache.set(cacheKey, existing.id);
    return existing.id;
  }
  const fieldKeys = new Set((resolvedDefinition.fieldDefinitions || []).map((field) => String(field?.key || "")).filter(Boolean));
  const fields = expectedFields.map((entry) => ({ key: entry.fieldDefinition.key, value: entry.value }));
  if (fieldKeys.has("label")) {
    const labels = relatedWrites.map((entry) => String(entry.taxonomyValueName || "").trim()).filter(Boolean);
    fields.push({ key: "label", value: labels.join(" / ") || write.attributeName });
  }
  const created = await runShopifyStoreGraphQL(CATEGORY_METAOBJECT_CREATE_MUTATION, {
    metaobject: {
      type: write.metaobjectType,
      fields,
    },
  }, { allowMutations: true });
  const errors = created?.metaobjectCreate?.userErrors || [];
  if (errors.length) throw new Error(`${write.attributeName}: category metaobject creation failed: ${formatMetafieldUserErrors(errors)}`);
  const id = created?.metaobjectCreate?.metaobject?.id;
  if (!id) throw new Error(`${write.attributeName}: Shopify returned no standard category metaobject.`);
  metaobjectNodes.push(created.metaobjectCreate.metaobject);
  cache.set(cacheKey, id);
  return id;
}

async function resolveCategoryMetafieldWrites(categoryWrites) {
  if (!categoryWrites.length) return [];
  const currentIds = [...new Set(categoryWrites.flatMap((write) => write.currentReferenceIds || []))];
  const existingById = new Map();
  if (currentIds.length) {
    const payload = await runShopifyStoreGraphQL(CATEGORY_METAOBJECT_NODES_QUERY, { ids: currentIds });
    for (const node of payload?.nodes || []) if (node?.id) existingById.set(String(node.id), node);
  }
  const cache = new Map();
  const definitionCache = new Map();
  const metaobjectsCache = new Map();
  const resolved = [];
  const groupedWrites = new Map();
  for (const write of categoryWrites) {
    const groupKey = `${write.productId}:${write.namespace}.${write.key}`;
    const group = groupedWrites.get(groupKey) || [];
    group.push(write);
    groupedWrites.set(groupKey, group);
  }
  for (const writes of groupedWrites.values()) {
    const write = writes[0];
    try {
      const definition = await ensureCategoryMetaobjectDefinition(write, definitionCache);
      const expectedFields = categoryMetaobjectExpectedFields(writes, definition);
      const currentReferenceIds = [...new Set(writes.flatMap((entry) => entry.currentReferenceIds || []))];
      const currentMatches = currentReferenceIds.some((id) => {
        const node = existingById.get(String(id));
        return expectedFields.every((expected) => {
          const field = (node?.fields || []).find((entry) => entry?.key === expected.fieldDefinition.key);
          return categoryMetaobjectFieldContainsValue(field, expected.taxonomyValueId);
        });
      });
      if (currentMatches) continue;
      const referenceId = await resolveCategoryMetaobjectReference(write, cache, definitionCache, definition, writes, metaobjectsCache);
      resolved.push({
        ownerId: write.productGid,
        ownerType: "PRODUCT",
        ownerHandle: write.handle,
        ownerTitle: write.handle,
        namespace: write.namespace,
        key: write.key,
        type: "list.metaobject_reference",
        value: JSON.stringify([referenceId]),
        fieldId: `${write.namespace}.${write.key}`,
        label: write.attributeName,
        reason: write.reason,
        productId: write.productId,
        productHandle: write.handle,
        productTitle: write.handle,
      });
    } catch (error) {
      const message = error?.message || String(error);
      if (/required field .* has no evidence-backed value|can't be blank|Owner subtype does not match/i.test(message)) {
        process.stdout.write(`Skipped evidence-incomplete category metafield ${write.namespace}.${write.key} for ${write.handle}: ${message}\n`);
        continue;
      }
      throw error;
    }
  }
  return resolved;
}

async function applyCategoryPlans(plans) {
  const batches = chunkArray(plans, 15);
  const results = Array.from({ length: batches.length }, () => []);
  let nextBatchIndex = 0;

  const applyBatch = async (batch, batchIndex) => {
    const declarations = batch.map((_, index) => `$p${index}: ProductUpdateInput!`).join(", ");
    const fields = batch
      .map(
        (_, index) => `p${index}: productUpdate(product: $p${index}) {
          product { id category { id name fullName } }
          userErrors { field message }
        }`,
      )
      .join("\n");
    const variables = Object.fromEntries(
      batch.map((plan, index) => [`p${index}`, { id: plan.productGid, category: plan.categoryId }]),
    );
    const payload = await runShopifyStoreGraphQL(
      `mutation ProductCategoryBackfill(${declarations}) { ${fields} }`,
      variables,
      { allowMutations: true },
    );

    for (let index = 0; index < batch.length; index += 1) {
      const plan = batch[index];
      const response = payload?.[`p${index}`] || {};
      const errors = Array.isArray(response.userErrors) ? response.userErrors : [];
      if (errors.length) {
        throw new Error(`${plan.handle}: category update failed: ${formatMetafieldUserErrors(errors)}`);
      }
      if (response.product?.category?.id !== plan.categoryId) {
        throw new Error(`${plan.handle}: category readback mismatch`);
      }
      results[batchIndex].push({
        ...plan,
        verifiedCategoryId: response.product.category.id,
        verifiedAt: new Date().toISOString(),
      });
    }

    process.stdout.write(`Category batch ${batchIndex + 1}/${batches.length} verified (${batch.length} products)\n`);
  };

  const worker = async () => {
    while (nextBatchIndex < batches.length) {
      const batchIndex = nextBatchIndex;
      nextBatchIndex += 1;
      await applyBatch(batches[batchIndex], batchIndex);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(BACKFILL_APPLY_CONCURRENCY, batches.length) }, () => worker()),
  );

  return results.flat();
}

async function writeManifest(filePath, manifest) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function bulkMetafieldVariables(batch) {
  return {
    metafields: batch.entries.map((entry) => ({
      ownerId: entry.ownerId,
      namespace: entry.namespace,
      key: entry.key,
      type: entry.type,
      value: entry.value,
    })),
  };
}

async function uploadBackfillBulkInput(inputPath) {
  const payload = await runShopifyStoreGraphQL(STAGED_UPLOAD_CREATE_MUTATION, {
    input: [{
      resource: "BULK_MUTATION_VARIABLES",
      filename: basename(inputPath),
      mimeType: "text/jsonl",
      httpMethod: "POST",
    }],
  }, { allowMutations: true });
  const userErrors = payload?.stagedUploadsCreate?.userErrors || [];
  if (userErrors.length) throw new Error(`Metafield staged upload failed: ${formatMetafieldUserErrors(userErrors)}`);
  const target = payload?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target?.url) throw new Error("Shopify returned no metafield staged upload target");
  const curlArgs = ["-sS", "-X", "POST", target.url];
  for (const parameter of target.parameters || []) curlArgs.push("-F", `${parameter.name}=${parameter.value}`);
  curlArgs.push("-F", `file=@${inputPath};type=text/jsonl`);
  await execFileAsync("curl", curlArgs, { maxBuffer: 20 * 1024 * 1024 });
  const stagedUploadPath = (target.parameters || []).find((parameter) => parameter.name === "key")?.value;
  if (!stagedUploadPath) throw new Error("Shopify metafield staged upload target did not include a key");
  return stagedUploadPath;
}

async function waitForBackfillBulkOperation(operationId, label = "Metafield bulk operation") {
  while (true) {
    const payload = await runShopifyStoreGraphQL(BULK_OPERATION_STATUS_QUERY, { id: operationId });
    const operation = payload?.bulkOperation;
    if (!operation) throw new Error(`Metafield bulk operation not found: ${operationId}`);
    process.stdout.write(`${label}: ${operation.status}, ${operation.objectCount || 0} object(s)\n`);
    if (operation.status === "COMPLETED") return operation;
    if (["FAILED", "CANCELED", "EXPIRED"].includes(operation.status)) {
      throw new Error(`Metafield bulk operation ended ${operation.status}: ${operation.errorCode || "unknown error"}`);
    }
    await sleep(5000);
  }
}

async function applyBatchesBulk(batches, outputFile) {
  const inputPath = outputFile.replace(/\.json$/i, "-bulk-input.jsonl");
  const resultPath = outputFile.replace(/\.json$/i, "-bulk-result.jsonl");
  await writeFile(inputPath, `${batches.map((batch) => JSON.stringify(bulkMetafieldVariables(batch))).join("\n")}\n`, "utf8");
  process.stdout.write(`Prepared ${batches.length} Shopify metafield bulk batch(es).\n`);
  const stagedUploadPath = await uploadBackfillBulkInput(inputPath);
  const payload = await runShopifyStoreGraphQL(BULK_OPERATION_RUN_MUTATION, {
    mutation: BULK_METAFIELDS_SET_MUTATION,
    stagedUploadPath,
  }, { allowMutations: true });
  const startErrors = payload?.bulkOperationRunMutation?.userErrors || [];
  if (startErrors.length) throw new Error(`Metafield bulk operation failed to start: ${formatMetafieldUserErrors(startErrors)}`);
  const operationId = payload?.bulkOperationRunMutation?.bulkOperation?.id;
  if (!operationId) throw new Error("Shopify returned no metafield bulk operation id");
  const operation = await waitForBackfillBulkOperation(operationId);
  if (!operation.url) throw new Error("Completed metafield bulk operation returned no result URL");
  const response = await fetch(operation.url);
  if (!response.ok) throw new Error(`Metafield bulk result download failed (${response.status})`);
  await writeFile(resultPath, Buffer.from(await response.arrayBuffer()));

  const lines = (await readFile(resultPath, "utf8")).split(/\r?\n/).filter(Boolean);
  const completed = new Set();
  const retryBatches = [];
  const results = [];
  for (const [fallbackIndex, line] of lines.entries()) {
    const result = JSON.parse(line);
    const lineNumber = Number.isInteger(Number(result.__lineNumber)) ? Number(result.__lineNumber) : fallbackIndex;
    const batch = batches[lineNumber];
    if (!batch) throw new Error(`Metafield bulk result returned unknown input line ${lineNumber}`);
    const topLevelErrors = Array.isArray(result.errors) ? result.errors : [];
    if (topLevelErrors.length) {
      throw new Error(`Metafield bulk batch ${lineNumber + 1}: ${topLevelErrors.map((error) => error?.message || "bulk error").join(" | ")}`);
    }
    const mutationResult = result?.data?.metafieldsSet;
    if (!mutationResult) throw new Error(`Metafield bulk batch ${lineNumber + 1} returned no metafieldsSet payload`);
    const userErrors = Array.isArray(mutationResult.userErrors) ? mutationResult.userErrors : [];
    if (userErrors.length) {
      retryBatches.push({ batch, lineNumber });
    } else {
      results.push({
        batch: lineNumber + 1,
        owners: batch.ownerDescriptors || batch.productIds || [],
        writeCount: batch.entries.length,
        metafields: batch.entries.length,
        skippedWriteCount: 0,
        skippedWrites: [],
      });
    }
    completed.add(lineNumber);
  }
  if (completed.size !== batches.length) {
    throw new Error(`Metafield bulk result covered ${completed.size}/${batches.length} input line(s)`);
  }

  const retryResults = new Array(retryBatches.length);
  let nextRetryIndex = 0;
  const retryWorker = async () => {
    while (true) {
      const retryIndex = nextRetryIndex;
      nextRetryIndex += 1;
      if (retryIndex >= retryBatches.length) return;
      const { batch, lineNumber } = retryBatches[retryIndex];
      process.stdout.write(
        `Retrying schema-incompatible metafield bulk batch ${lineNumber + 1} (${retryIndex + 1}/${retryBatches.length})\n`,
      );
      retryResults[retryIndex] = await applySingleBatch(batch, lineNumber, batches.length);
    }
  };
  const retryWorkerCount = Math.min(BACKFILL_APPLY_CONCURRENCY, retryBatches.length);
  await Promise.all(Array.from({ length: retryWorkerCount }, () => retryWorker()));
  results.push(...retryResults.filter(Boolean));
  results.bulkOperation = {
    id: operation.id,
    status: operation.status,
    objectCount: Number(operation.objectCount || 0),
    completedAt: operation.completedAt || new Date().toISOString(),
    inputPath,
    resultPath,
    retriedBatches: retryBatches.length,
  };
  return results;
}

async function applySingleBatch(batch, batchIndex, batchTotal) {
  const mutation = /* GraphQL */ `
    mutation BackfillProductMetafields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
          namespace
          key
          value
          updatedAt
        }
        userErrors {
          field
          message
          code
        }
      }
    }
  `;

  let pendingEntries = [...batch.entries];
  let appliedEntries = 0;
  const failedWrites = [];
  const batchLabel =
    Array.isArray(batch.ownerDescriptors) && batch.ownerDescriptors.length
      ? `${batch.ownerDescriptors.length} owner group(s)`
      : `${batch.productIds?.length || 0} product(s)`;

  process.stdout.write(
    `Applying batch ${batchIndex + 1}/${batchTotal} with ${batch.entries.length} metafield(s) across ${batchLabel}\n`,
  );

  while (pendingEntries.length) {
    const payload = await runShopifyStoreGraphQL(
      mutation,
      {
        metafields: pendingEntries.map((entry) => ({
          ownerId: entry.ownerId,
          namespace: entry.namespace,
          key: entry.key,
          type: entry.type,
          value: entry.value,
        })),
      },
      { allowMutations: true },
    );

    const response = payload.metafieldsSet || {};
    const userErrors = Array.isArray(response.userErrors) ? response.userErrors : [];
    if (!userErrors.length) {
      appliedEntries += pendingEntries.length;
      pendingEntries = [];
      break;
    }

    const { failedIndexes, nonEntryErrors } = partitionMetafieldUserErrors(userErrors, pendingEntries.length);
    if (nonEntryErrors.length || !failedIndexes.size) {
      throw new Error(`Shopify metafieldsSet failed for batch ${batchIndex + 1}: ${formatMetafieldUserErrors(userErrors)}`);
    }

    const nextPendingEntries = [];
    pendingEntries.forEach((entry, entryIndex) => {
      if (failedIndexes.has(entryIndex)) {
        failedWrites.push({
          ownerType: entry.ownerType || "PRODUCT",
          ownerId: entry.ownerId,
          ownerHandle: entry.ownerHandle || entry.productHandle || null,
          ownerTitle: entry.ownerTitle || entry.productTitle || null,
          fieldId: entry.fieldId,
          reason: entry.reason,
          error: formatMetafieldUserErrors(
            userErrors.filter((error) => {
              const field = Array.isArray(error?.field) ? error.field : [];
              return field[0] === "metafields" && Number(field[1]) === entryIndex;
            }),
          ),
        });
        return;
      }

      nextPendingEntries.push(entry);
    });

    pendingEntries = nextPendingEntries;

    if (pendingEntries.length) {
      process.stdout.write(
        `Batch ${batchIndex + 1}: skipped ${failedIndexes.size} incompatible metafield(s), retrying ${pendingEntries.length} remaining\n`,
      );
    }
  }

  if (failedWrites.length) {
    process.stdout.write(
      `Batch ${batchIndex + 1}: skipped fields ${failedWrites
        .map((entry) => `${entry.fieldId} (${entry.error})`)
        .join(" | ")}\n`,
    );
  }

  return {
    batch: batchIndex + 1,
    owners: batch.ownerDescriptors || batch.productIds || [],
    writeCount: appliedEntries,
    metafields: appliedEntries,
    skippedWriteCount: failedWrites.length,
    skippedWrites: failedWrites,
  }
}

async function applyBatches(batches, outputFile) {
  const totalEntries = batches.reduce((sum, batch) => sum + batch.entries.length, 0);
  if (totalEntries >= BACKFILL_BULK_THRESHOLD) {
    return applyBatchesBulk(batches, outputFile);
  }
  const results = new Array(batches.length);
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= batches.length) {
        return;
      }

      results[index] = await applySingleBatch(batches[index], index, batches.length);
    }
  };

  const workerCount = Math.min(BACKFILL_APPLY_CONCURRENCY, batches.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results.filter(Boolean);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.productHandlesFile) {
    const rawHandles = await readFile(args.productHandlesFile, "utf8");
    let parsedHandles;
    try {
      parsedHandles = JSON.parse(rawHandles);
    } catch {
      parsedHandles = rawHandles.split(/\r?\n/);
    }
    if (!Array.isArray(parsedHandles)) {
      throw new Error(`Product handles file must contain a JSON array or one handle per line: ${args.productHandlesFile}`);
    }
    args.productHandles.push(...parsedHandles.map((value) => normalizeHandleValue(value)).filter(Boolean));
    args.productHandles = [...new Set(args.productHandles)];
  }
  const productsPath = resolve(args.inputDir, "products.json");
  const releaseCatalogPath =
    process.env.SALT_SHOPIFY_SEO_LIVE_CATALOG || resolve(process.cwd(), "output", ".shopify-seo-live-catalog.json");
  const collectionsPath = resolve(args.inputDir, "collections.json");
  const collectionProductsPath = resolve(args.inputDir, "collection-products.json");
  const shopPath = resolve(args.inputDir, "shop.json");

  const productsPayload = await readProductCatalogPayload(args.inputDir);
  const releaseCatalogPayload = await loadOptionalJson(releaseCatalogPath);
  const collectionsPayload = await loadJson(collectionsPath, "collections payload");
  const collectionProductsPayload = await loadJson(collectionProductsPath, "collection-products payload");
  const shopPayload = await loadJson(shopPath, "shop payload");

  const localProducts = Array.isArray(productsPayload.products) ? productsPayload.products : [];
  const hasExplicitSelection = Boolean(args.productIds.length || args.productHandles.length || args.productHandlesFile);
  if (args.allActive && (hasExplicitSelection || args.limitProducts > 0)) {
    throw new Error("--all-active cannot be combined with a limited product selection");
  }
  const liveCatalogProducts = hasExplicitSelection
    ? releaseCatalogPayload?.products
    : await fetchLiveProductCatalog();
  const allProducts = mergeReleaseCatalogProducts(localProducts, liveCatalogProducts);
  const requestedProducts = filterProducts(allProducts, args);
  if (!requestedProducts.length) {
    throw new Error("No products matched the backfill selection");
  }
  if (args.allActive) {
    process.stdout.write(`Using explicit all-active scope: ${requestedProducts.length} product(s)\n`);
  }

  const liveCustomDataMap = await fetchLiveProductCustomDataMap(requestedProducts);
  const selectedProducts = requestedProducts.filter((product) => liveCustomDataMap.has(Number(product.id)));
  if (!selectedProducts.length) {
    throw new Error("No selected products still exist in Shopify");
  }
  const hydratedProducts = selectedProducts.map((product) => {
    const liveRecord = liveCustomDataMap.get(Number(product.id));
    if (!liveRecord) {
      return product;
    }

    return {
      ...product,
      ...liveRecord.liveProduct,
      customData: mergeProductCustomData(product.customData, liveRecord.customData),
      shopifyCategory: liveRecord.category,
      disclosures: liveRecord.disclosures,
    };
  });

  const reviewSummaries = args.skipLiveReviews ? new Map() : await collectJudgeMeSummaries(hydratedProducts);
  const diaperDiscovery = await discoverDiaperTypeOptions();
  const disclosureDiscovery = await discoverDisclosureOptions();

  const backfillPlan = buildBackfillPlan({
    products: hydratedProducts,
    collections: Array.isArray(collectionsPayload.collections) ? collectionsPayload.collections : [],
    collectionProducts: collectionProductsPayload,
    reviewSummaries,
    diaperTypeOptions: diaperDiscovery.options,
    disclosureOptions: disclosureDiscovery.options,
    enforceProductSpecificity: true,
    // Shopify constrains its discovery-owned definition to an internal owner
    // subtype; keep the source-owned fallback authoritative instead.
    allowShopifySearchBoostWrite: false,
    allowShopifyComplementaryWrite: false,
  });
  const marketingBackfillPlan = args.productOnly || args.categoryOnly || args.categoryMetafieldsOnly
    ? {
        ownerPlans: [],
        summary: {
          scannedCollections: 0,
          scannedProducts: 0,
          totalWrites: 0,
          writesByField: {},
          skippedByReason: {},
        },
      }
    : buildMarketingBackfillPlan({
        products: hydratedProducts,
        collections: Array.isArray(collectionsPayload.collections) ? collectionsPayload.collections : [],
        collectionProducts: collectionProductsPayload,
        shop:
          /^gid:\/\/shopify\/Shop\/\d+$/i.test(String(shopPayload?.shop?.id || ""))
            ? shopPayload.shop
            : await fetchLiveShopRecord(),
      });

  const onlyFields = new Set(args.onlyFields);
  const scopeWrites = (plans) =>
    !onlyFields.size
      ? plans
      : plans
          .map((plan) => ({
            ...plan,
            writes: (plan.writes || []).filter((write) => onlyFields.has(write.fieldId)),
          }))
          .filter((plan) => plan.writes.length);
  const productPlans = args.categoryOnly || args.categoryMetafieldsOnly ? [] : scopeWrites(backfillPlan.productPlans);
  const marketingPlans = scopeWrites(marketingBackfillPlan.ownerPlans);
  const productBatches = buildMetafieldSetBatches(productPlans, 25);
  const marketingBatches = buildMarketingMetafieldSetBatches(marketingPlans, 25);
  const batches = [...productBatches, ...marketingBatches];
  const categoryPlanResult = args.productOnly || onlyFields.size
    ? { plans: [], summary: { candidates: 0, paths: 0, resolved: 0, unresolved: 0 } }
    : await buildCategoryPlans(hydratedProducts);
  const categoryPlans = categoryPlanResult.plans;
  const categoryMetafieldPlanResult = args.productOnly || onlyFields.size
    ? {
        plans: [],
        writes: [],
        summary: { products: 0, attributes: 0, candidates: 0, plannedWrites: 0, skipped: 0, requiresMetaobjectScopes: false },
      }
    : await buildCategoryMetafieldPlans(hydratedProducts, categoryPlanResult).catch((error) => ({
        plans: [],
        writes: [],
        summary: {
          products: 0,
          attributes: 0,
          candidates: 0,
          plannedWrites: 0,
          skipped: 0,
          requiresMetaobjectScopes: false,
          error: error.message || String(error),
        },
      }));
  const categoryMetafieldWrites = categoryMetafieldPlanResult.writes;
  const scopedWritesByField = {};
  for (const plan of productPlans) {
    for (const write of plan.writes || []) {
      scopedWritesByField[write.fieldId] = (scopedWritesByField[write.fieldId] || 0) + 1;
    }
  }
  const scopedProductSummary = onlyFields.size
    ? {
        ...backfillPlan.summary,
        productsWithWrites: productPlans.length,
        totalWrites: productPlans.reduce((sum, plan) => sum + plan.writes.length, 0),
        writesByField: scopedWritesByField,
      }
    : backfillPlan.summary;
  const manifest = {
    generatedAt: new Date().toISOString(),
    mode: args.apply ? "apply" : "dry-run",
    dryRun: args.dryRun,
    input: {
      productsPath,
      releaseCatalogPath,
      collectionsPath,
      collectionProductsPath,
      shopPath,
      selection: {
        productIds: args.productIds,
        productHandles: args.productHandles,
        productHandlesFile: args.productHandlesFile || null,
        limitProducts: args.limitProducts,
        onlyFields: args.onlyFields,
        requestedProductCount: requestedProducts.length,
        liveProductCount: selectedProducts.length,
        missingLiveHandles: requestedProducts
          .filter((product) => !liveCustomDataMap.has(Number(product.id)))
          .map((product) => normalizeHandleValue(product.handle || ""))
          .filter(Boolean),
      },
      catalogAugmentedProducts: Math.max(0, allProducts.length - localProducts.length),
    },
    discovery: {
      diaperType: diaperDiscovery.discovered
        ? {
            discovered: true,
            definitionId: diaperDiscovery.definition?.id || null,
            definitionName: diaperDiscovery.definition?.name || null,
            type: diaperDiscovery.definition?.type || null,
            optionCount: diaperDiscovery.options.length,
          }
        : {
            discovered: false,
            definitionId: null,
            definitionName: null,
            type: null,
            optionCount: 0,
          },
      disclosures: {
        discovered: disclosureDiscovery.discovered,
        optionCount: disclosureDiscovery.options.length,
        policy: "approved references plus explicit warning evidence only",
      },
      skippedDefinitions: disclosureDiscovery.discovered ? [] : ["Disclosures: no approved reference objects"],
    },
    summary: {
      ...scopedProductSummary,
      marketing: marketingBackfillPlan.summary,
      batchesPlanned: batches.length,
      productBatchesPlanned: productBatches.length,
      marketingBatchesPlanned: marketingBatches.length,
      categoryUpdatesPlanned: categoryPlans.length,
      categoryResolution: categoryPlanResult.summary,
      categoryMetafieldWritesPlanned: categoryMetafieldWrites.length,
      categoryMetafieldResolution: categoryMetafieldPlanResult.summary,
    },
    products: productPlans,
    marketing: marketingPlans,
    categories: categoryPlans,
    categoryResolution: categoryPlanResult.summary,
    categoryMetafields: categoryMetafieldPlanResult.plans,
    categoryMetafieldResolution: categoryMetafieldPlanResult.summary,
    batches: batches.map((batch, index) => ({
      batch: index + 1,
      owners: batch.ownerDescriptors || batch.productIds || [],
      writeCount: batch.entries.length,
      writes: batch.entries.map((entry) => ({
        ownerType: entry.ownerType || "PRODUCT",
        ownerId: entry.ownerId,
        ownerHandle: entry.ownerHandle || entry.productHandle || null,
        ownerTitle: entry.ownerTitle || entry.productTitle || null,
        fieldId: entry.fieldId,
        namespace: entry.namespace,
        key: entry.key,
        type: entry.type,
        reason: entry.reason,
      })),
    })),
  };

  await writeManifest(args.outputFile, manifest);
  process.stdout.write(`Manifest written to ${args.outputFile}\n`);
  process.stdout.write(
    `Dry-run plan: ${scopedProductSummary.totalWrites + marketingPlans.reduce((sum, plan) => sum + plan.writes.length, 0)} product/marketing metafield write(s), ${categoryMetafieldWrites.length} category metafield candidate(s), and ${categoryPlans.length} category update(s) across ${scopedProductSummary.productsWithWrites} product(s) and ${marketingBackfillPlan.summary.scannedCollections} collection(s)\n`,
  );

  if (!args.apply) {
    process.stdout.write("Dry-run complete. No Shopify writes were made.\n");
    return;
  }

  if (categoryMetafieldPlanResult.summary?.error) {
    throw new Error(`Category metafield discovery gate blocked live apply: ${categoryMetafieldPlanResult.summary.error}`);
  }

  if (!batches.length && !categoryPlans.length && !categoryMetafieldWrites.length) {
    process.stdout.write("No metafield or category writes were needed.\n");
    return;
  }

  if (categoryMetafieldWrites.length && process.env.FUTURE_LIGHT_CATEGORY_METAOBJECTS_APPROVED !== "1") {
    throw new Error(
      "Category metafield candidates are ready, but live standard metaobject resolution is held. Authorize read_metaobjects/write_metaobjects and set FUTURE_LIGHT_CATEGORY_METAOBJECTS_APPROVED=1 for the guarded apply.",
    );
  }

  const categoryResults = categoryPlans.length && !args.categoryMetafieldsOnly ? await applyCategoryPlans(categoryPlans) : [];
  // Conditional standard metafields validate against the live product category.
  // Categories must be committed and read back before those metafields are set.
  const resolvedCategoryEntries = categoryMetafieldWrites.length
    ? await resolveCategoryMetafieldWrites(categoryMetafieldWrites)
    : [];
  const categoryMetafieldBatchResult = categoryMetafieldBatches(resolvedCategoryEntries, 25);
  const applyResults = batches.length || categoryMetafieldBatchResult.length
    ? await applyBatches([...batches, ...categoryMetafieldBatchResult], args.outputFile)
    : [];
  manifest.applied = {
    completedAt: new Date().toISOString(),
    batchCount: applyResults.length,
    writeCount: applyResults.reduce((sum, entry) => sum + entry.writeCount, 0),
    skippedWriteCount: applyResults.reduce((sum, entry) => sum + (entry.skippedWriteCount || 0), 0),
    batches: applyResults,
    categoryCount: categoryResults.length,
    categories: categoryResults,
    bulkOperation: applyResults.bulkOperation || null,
  };
  await writeManifest(args.outputFile, manifest);
  await rm(PRODUCT_CUSTOM_DATA_CHECKPOINT, { force: true });
  process.stdout.write(`Apply complete. Updated manifest written to ${args.outputFile}\n`);
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
