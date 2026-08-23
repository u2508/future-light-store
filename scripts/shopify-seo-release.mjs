#!/usr/bin/env node

import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import {
  buildEligibilityScopedReleasePlan,
  buildDesiredFingerprint,
  buildLiveFingerprint,
  buildShopifySeoReleasePlan,
  compareLiveProductToPlan,
  isHandleContentMismatch,
  mergeCatalogSnapshotWithLiveProducts,
  normalizeComparableHtml,
} from "../src/lib/shopify-seo-release.js";
import { isActiveShopifyProduct } from "../src/lib/catalog-taxonomy-release.js";
import { normalizeHandleValue, normalizePlainText } from "../src/lib/shopify-seo-batch.js";
import { managedMinimumQuantityTagFromTags } from "../src/lib/shopify-seo-managed-tags.js";
import {
  assessProductContentSpecificity,
  findCatalogContentCollisions,
} from "../src/lib/product-content-specificity.js";
import { PRICE_REWORK_RULES } from "../src/lib/shopify-price-rework-policy.js";
import { readProductCatalogPayload } from "./product-catalog-files.mjs";
import { readCatalogKnowledgeModel } from "./catalog-knowledge-model-files.mjs";
import { createRequestScheduler, envInteger } from "./lib/performance-runtime.mjs";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, "..");
const inputDir = resolve(rootDir, "public", "data");
const outputPath = resolve(rootDir, "output", "shopify-seo-release-manifest.json");
const liveCatalogPath = process.env.SALT_SHOPIFY_SEO_LIVE_CATALOG || resolve(rootDir, "output", ".shopify-seo-live-catalog.json");
const shopBase = process.env.SALT_SHOP_URL;
if (!shopBase) throw new Error("SALT_SHOP_URL is required for Future Light Store SEO operations.");
const storeDomain = new URL(shopBase).hostname;
const apiVersion = process.env.SHOPIFY_ADMIN_API_VERSION || "2026-07";

export function assertBaseSeoPriceFloor(products, threshold = PRICE_REWORK_RULES.threshold) {
  const violations = [];
  let variantsChecked = 0;
  for (const product of Array.isArray(products) ? products : []) {
    const variants = Array.isArray(product?.variants?.nodes)
      ? product.variants.nodes
      : Array.isArray(product?.variants)
        ? product.variants
        : [];
    for (const variant of variants) {
      variantsChecked += 1;
      const price = Number(variant?.price);
      if (!Number.isFinite(price) || price < threshold) {
        violations.push(`${product?.handle || product?.id || "unknown-product"}:${variant?.id || variant?.title || "unknown-variant"}=${Number.isFinite(price) ? price.toFixed(2) : "missing"}`);
      }
    }
  }
  if (violations.length) {
    throw new Error(
      `Base SEO price-floor gate failed: ${violations.length} variant(s) below $${Number(threshold).toFixed(2)} or missing a price. ` +
      `Run the approved catalog price rework before SEO. Examples: ${violations.slice(0, 10).join(", ")}`,
    );
  }
  return { threshold, productsChecked: Array.isArray(products) ? products.length : 0, variantsChecked, violations: 0 };
}
const adminAccessToken =
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.SALT_SHOPIFY_ADMIN_ACCESS_TOKEN || "";
const adminGraphqlUrl = `${new URL(shopBase).origin}/admin/api/${apiVersion}/graphql.json`;
const cliBinary = process.env.SHOPIFY_CLI_BINARY || "shopify";
const cliAgentInfo = process.env.SHOPIFY_CLI_AGENT_INFO || "n:future-light-store|v:1|p:openai";
const cliAgentIds =
  process.env.SHOPIFY_CLI_AGENT_IDS || `s:future-light-store|r:${process.pid}|i:future-light-store-seo`;
const requestDelayMs = Math.max(0, Number(process.env.SALT_SHOPIFY_REQUEST_DELAY_MS || 125));
const requestConcurrency = envInteger("SALT_SHOPIFY_REQUEST_CONCURRENCY", 4, { min: 1, max: 8 });
const maxAttempts = Math.max(1, Number(process.env.SALT_SHOPIFY_MAX_REQUEST_ATTEMPTS || 5));
const maxRetryDelayMs = Math.max(1000, Number(process.env.SALT_SHOPIFY_MAX_RETRY_DELAY_MS || 30_000));
const seoApplyBatchSize = Math.max(1, Math.min(5, Number(process.env.SALT_SHOPIFY_SEO_BATCH_SIZE || 5)));
const seoReadConcurrency = Math.max(1, Number(process.env.SALT_SHOPIFY_SEO_READ_CONCURRENCY || 4));
const ACTIVE_PRODUCT_QUERY = "status:active";

const PRODUCT_SELECTION = /* GraphQL */ `
  id
  handle
  title
  descriptionHtml
  productType
  status
  tags
  vendor
  createdAt
  updatedAt
  publishedAt
  category {
    id
  }
  resourcePublications(first: 250) {
    nodes {
      isPublished
      publishDate
      channel {
        id
        name
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
  seo {
    title
    description
  }
  variants(first: 250) {
    nodes {
      id
      title
      sku
      price
      compareAtPrice
      selectedOptions {
        name
        value
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
  media(first: 250) {
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
    pageInfo {
      hasNextPage
      endCursor
    }
  }
`;

const ALL_PRODUCTS_QUERY = /* GraphQL */ `
  query ShopifySeoReleaseProducts($first: Int!, $after: String, $query: String!) {
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

const PRODUCT_BY_HANDLE_QUERY = /* GraphQL */ `
  query ShopifySeoReleaseProductByHandle($identifier: ProductIdentifierInput!) {
    productByIdentifier(identifier: $identifier) {
      ${PRODUCT_SELECTION}
    }
  }
`;

const PRODUCT_VERIFY_SELECTION = /* GraphQL */ `
  id
  handle
  title
  descriptionHtml
  productType
  status
  publishedAt
  tags
  category {
    id
  }
  resourcePublications(first: 250) {
    nodes {
      isPublished
      publishDate
      channel {
        id
        name
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
  seo {
    title
    description
  }
  variants(first: 250) {
    nodes {
      id
      title
      sku
      price
      compareAtPrice
      selectedOptions {
        name
        value
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
  media(first: 250) {
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
    pageInfo {
      hasNextPage
      endCursor
    }
  }
`;

const PRODUCTS_BY_ID_QUERY = /* GraphQL */ `
  query ShopifySeoReleaseProductsById($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        ${PRODUCT_VERIFY_SELECTION}
      }
    }
  }
`;

const PRODUCT_VARIANTS_PAGE_QUERY = /* GraphQL */ `
  query ShopifySeoReleaseVariantPage($id: ID!, $after: String) {
    node(id: $id) {
      ... on Product {
        variants(first: 250, after: $after) {
          nodes {
            id
            title
            sku
            price
            compareAtPrice
            selectedOptions {
              name
              value
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;

const PRODUCT_MEDIA_PAGE_QUERY = /* GraphQL */ `
  query ShopifySeoReleaseMediaPage($id: ID!, $after: String) {
    node(id: $id) {
      ... on Product {
        media(first: 250, after: $after) {
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
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;

const PRODUCT_PUBLICATIONS_PAGE_QUERY = /* GraphQL */ `
  query ShopifySeoReleasePublicationPage($id: ID!, $after: String) {
    node(id: $id) {
      ... on Product {
        resourcePublications(first: 250, after: $after) {
          nodes {
            isPublished
            publishDate
            channel {
              id
              name
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;

const PRODUCT_UPDATE_MUTATION = /* GraphQL */ `
  mutation ShopifySeoReleaseProductUpdate($product: ProductUpdateInput!) {
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

const VARIANT_UPDATE_MUTATION = /* GraphQL */ `
  mutation ShopifySeoReleaseVariantUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
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

const MEDIA_UPDATE_MUTATION = /* GraphQL */ `
  mutation ShopifySeoReleaseMediaUpdate($productId: ID!, $media: [UpdateMediaInput!]!) {
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

const STAGED_UPLOAD_CREATE_MUTATION = /* GraphQL */ `
  mutation ShopifySeoReleaseStagedUpload($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url parameters { name value } }
      userErrors { field message }
    }
  }
`;

const BULK_OPERATION_RUN_MUTATION = /* GraphQL */ `
  mutation ShopifySeoReleaseRunBulk($mutation: String!, $stagedUploadPath: String!) {
    bulkOperationRunMutation(mutation: $mutation, stagedUploadPath: $stagedUploadPath) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }
`;

const BULK_OPERATION_STATUS_QUERY = /* GraphQL */ `
  query ShopifySeoReleaseBulkStatus($id: ID!) {
    bulkOperation(id: $id) {
      id status errorCode objectCount fileSize url partialDataUrl createdAt completedAt
    }
  }
`;

const BULK_PRODUCT_UPDATE_MUTATION = /* GraphQL */ `
  mutation ShopifySeoReleaseBulkProductUpdate($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id }
      userErrors { field message }
    }
  }
`;

const BULK_VARIANT_UPDATE_MUTATION = /* GraphQL */ `
  mutation ShopifySeoReleaseBulkVariantUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      userErrors { field message }
    }
  }
`;

const BULK_MEDIA_UPDATE_MUTATION = /* GraphQL */ `
  mutation ShopifySeoReleaseBulkMediaUpdate($productId: ID!, $media: [UpdateMediaInput!]!) {
    productUpdateMedia(productId: $productId, media: $media) {
      media { id }
      userErrors { field message }
    }
  }
`;

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function parseArgs(argv) {
  const args = {
    mode: "dry-run",
    output: outputPath,
    sample: 0,
    preservePrices: true,
    repairVariantPricing: false,
    preserveTags: false,
    tagsOnly: false,
    fullCatalog: false,
    frozenCatalog: "",
    productHandlesFile: "",
    newProductsOnly: false,
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
    if (token === "--preserve-prices") {
      args.preservePrices = true;
      continue;
    }
    if (token === "--repair-variant-pricing") {
      args.repairVariantPricing = true;
      continue;
    }
    if (token === "--preserve-tags") {
      args.preserveTags = true;
      continue;
    }
    if (token === "--tags-only") {
      args.tagsOnly = true;
      continue;
    }
    if (token === "--full-catalog") {
      args.fullCatalog = true;
      continue;
    }
    if (token === "--frozen-catalog") {
      args.frozenCatalog = resolve(rootDir, argv[index + 1] || "");
      index += 1;
      continue;
    }
    if (token === "--product-handles-file") {
      args.productHandlesFile = resolve(rootDir, argv[index + 1] || "");
      index += 1;
      continue;
    }
    if (token === "--new-products-only") {
      args.newProductsOnly = true;
    }
  }

  return args;
}

async function readProductHandles(filePath) {
  if (!filePath) return null;
  const raw = await readFile(filePath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = raw.split(/\r?\n/);
  }
  const handles = Array.isArray(parsed) ? parsed : parsed?.handles;
  if (!Array.isArray(handles) || !handles.length) {
    throw new Error(`Product handles file contains no handles: ${filePath}`);
  }
  return new Set(handles.map((handle) => normalizeHandleValue(handle)).filter(Boolean));
}

function getCliEnv() {
  return {
    ...process.env,
    SHOPIFY_CLI_AGENT_INFO: cliAgentInfo,
    SHOPIFY_CLI_AGENT_IDS: cliAgentIds,
  };
}

function parseGraphQlPayload(raw) {
  const text = String(raw || "").trim();
  const jsonStart = text.indexOf("{");
  if (jsonStart < 0) {
    throw new Error(text || "Shopify CLI returned no JSON payload");
  }

  const payload = JSON.parse(text.slice(jsonStart));
  if (Array.isArray(payload?.errors) && payload.errors.length) {
    throw new Error(payload.errors.map((entry) => entry.message || "GraphQL error").join(" | "));
  }

  if (Array.isArray(payload?.data?.errors) && payload.data.errors.length) {
    throw new Error(payload.data.errors.map((entry) => entry.message || "GraphQL error").join(" | "));
  }

  return payload?.data || payload;
}

const requestScheduler = createRequestScheduler({ concurrency: requestConcurrency, minIntervalMs: requestDelayMs });

async function runShopifyCliGraphQLInternal(query, variables, { allowMutations = false, operation, retryInfo } = {}) {

  if (adminAccessToken) {
    let attempt = 0;
    while (true) {
      try {
        const response = await fetch(adminGraphqlUrl, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": adminAccessToken,
          },
          body: JSON.stringify({ query, variables: variables || {} }),
        });
        const rawOutput = await response.text();
        if (!response.ok) {
          throw new Error(`Admin GraphQL HTTP ${response.status}: ${rawOutput.slice(0, 500)}`);
        }

        return parseGraphQlPayload(rawOutput);
      } catch (error) {
        const message = String(error?.message || error);
        const transient = /429|rate limit|throttl|timeout|timed out|5\d\d|network|socket|temporar|aborted|enotfound|eai_again|getaddrinfo|dns/i.test(
          message,
        );
        if (!transient || attempt >= maxAttempts - 1) {
          throw new Error(`${operation || "Shopify Admin GraphQL request"} failed: ${message.trim()}`);
        }

        const delayMs = Math.min(maxRetryDelayMs, Math.max(requestDelayMs, 1000 * 2 ** attempt));
        retryInfo?.push({
          operation: operation || "Shopify Admin GraphQL request",
          attempt: attempt + 1,
          delayMs,
          message: message.trim().slice(0, 500),
          at: new Date().toISOString(),
        });
        process.stdout.write(
          `Shopify Admin GraphQL request failed for ${operation || "operation"}; retrying in ${Math.ceil(delayMs / 1000)}s\n`,
        );
        await sleep(delayMs);
        attempt += 1;
      }
    }
  }

  const tempDir = await mkdtemp(join(tmpdir(), "salt-shopify-seo-release-"));
  const queryFile = join(tempDir, "operation.graphql");
  const variablesFile = join(tempDir, "variables.json");
  const outputFile = join(tempDir, "result.json");

  try {
    await writeFile(queryFile, query, "utf8");
    await writeFile(variablesFile, JSON.stringify(variables || {}, null, 2), "utf8");

    const cliArgs = [
      "store",
      "execute",
      "--store",
      storeDomain,
      "--version",
      apiVersion,
      "--query-file",
      queryFile,
      "--variable-file",
      variablesFile,
      "--output-file",
      outputFile,
      "--json",
    ];
    if (allowMutations) {
      cliArgs.push("--allow-mutations");
    }

    let attempt = 0;
    while (true) {
      try {
        const result = await execFileAsync(cliBinary, cliArgs, {
          cwd: rootDir,
          env: getCliEnv(),
          maxBuffer: 20 * 1024 * 1024,
        });
        let rawOutput = "";
        try {
          rawOutput = await readFile(outputFile, "utf8");
        } catch {
          rawOutput = result.stdout || "";
        }
        return parseGraphQlPayload(rawOutput);
      } catch (error) {
        const message = String(error?.stderr || error?.stdout || error?.message || error);
        const transient = /429|rate limit|throttl|timeout|timed out|5\d\d|network|socket|temporar|aborted|enotfound|eai_again|getaddrinfo|dns/i.test(message);
        if (!transient || attempt >= maxAttempts - 1) {
          throw new Error(`${operation || "Shopify CLI request"} failed: ${message.trim()}`);
        }

        const delayMs = Math.min(maxRetryDelayMs, Math.max(requestDelayMs, 1000 * 2 ** attempt));
        retryInfo?.push({
          operation: operation || "Shopify CLI request",
          attempt: attempt + 1,
          delayMs,
          message: message.trim().slice(0, 500),
          at: new Date().toISOString(),
        });
        process.stdout.write(
          `Shopify CLI request failed for ${operation || "operation"}; retrying in ${Math.ceil(delayMs / 1000)}s\n`,
        );
        await sleep(delayMs);
        attempt += 1;
      }
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function runShopifyCliGraphQL(query, variables, options = {}) {
  return requestScheduler.run(() => runShopifyCliGraphQLInternal(query, variables, options));
}

async function readJson(relativePath, { required = false } = {}) {
  const filePath = resolve(inputDir, relativePath);
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (!required && error?.code === "ENOENT") {
      return {};
    }
    throw new Error(`Could not read ${filePath}: ${error.message}`);
  }
}

async function loadCatalogSnapshot() {
  const [products, collections, collectionProducts] = await Promise.all([
    readProductCatalogPayload(inputDir),
    readJson("collections.json"),
    readJson("collection-products.json"),
  ]);

  return { products, collections, collectionProducts };
}

async function loadFrozenCatalogSnapshot(filePath, baseSnapshot) {
  if (!filePath) {
    return baseSnapshot;
  }

  const payload = JSON.parse(await readFile(filePath, "utf8"));
  const products = Array.isArray(payload) ? payload : payload?.products;
  if (!Array.isArray(products) || !products.length) {
    throw new Error(`Frozen catalog contains no products: ${filePath}`);
  }

  return { ...baseSnapshot, products };
}

export async function fetchAllProducts(retryInfo = []) {
  const products = [];
  let after = null;
  let page = 0;

  while (true) {
    page += 1;
    const data = await runShopifyCliGraphQL(
      ALL_PRODUCTS_QUERY,
      { first: 250, after, query: ACTIVE_PRODUCT_QUERY },
      { operation: `product catalog page ${page}`, retryInfo },
    );
    const connection = data?.products;
    if (!connection) {
      throw new Error("Shopify product catalog query returned no products connection");
    }

    products.push(...(Array.isArray(connection.nodes) ? connection.nodes : []));
    if (!connection.pageInfo?.hasNextPage) {
      break;
    }
    if (!connection.pageInfo.endCursor) {
      throw new Error(`Shopify product catalog page ${page} hasNextPage without an end cursor`);
    }
    after = connection.pageInfo.endCursor;
  }

  for (let index = 0; index < products.length; index += 1) {
    if (!hasNestedPaginationGap(products[index])) {
      continue;
    }

    process.stdout.write(`Hydrating nested Shopify connections for ${products[index].handle}\n`);
    products[index] = await hydrateNestedProductConnections(products[index], retryInfo);
  }

  const excluded = products.filter((product) => !isActiveShopifyProduct(product));
  if (excluded.length) {
    throw new Error(
      `Active product query returned ${excluded.length} product(s) that are not active: ${excluded
        .slice(0, 8)
        .map((product) => product.handle || product.id)
        .join(", ")}`,
    );
  }

  return products;
}

async function fetchProductByHandle(handle, retryInfo, operation = `read ${handle}`) {
  const data = await runShopifyCliGraphQL(
    PRODUCT_BY_HANDLE_QUERY,
    { identifier: { handle } },
    { operation, retryInfo },
  );
  const product = data?.productByIdentifier || null;
  if (!product) {
    return null;
  }
  if (!isActiveShopifyProduct(product)) {
    return null;
  }
  return product;
}

async function fetchProductsById(ids, retryInfo, operation = "read product batch") {
  const uniqueIds = [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean))];
  if (!uniqueIds.length) {
    return new Map();
  }

  // Shopify caps `nodes(ids: ...)` input arrays at 250 IDs.
  const batches = [];
  for (let index = 0; index < uniqueIds.length; index += 250) {
    batches.push(uniqueIds.slice(index, index + 250));
  }
  const results = new Array(batches.length);
  let nextBatchIndex = 0;
  const worker = async () => {
    while (true) {
      const batchIndex = nextBatchIndex;
      nextBatchIndex += 1;
      if (batchIndex >= batches.length) return;
      const data = await runShopifyCliGraphQL(
        PRODUCTS_BY_ID_QUERY,
        { ids: batches[batchIndex] },
        { operation: `${operation} ${batchIndex + 1}/${batches.length}`, retryInfo },
      );
      results[batchIndex] = Array.isArray(data?.nodes)
        ? data.nodes.filter((node) => node?.id && isActiveShopifyProduct(node))
        : [];
    }
  };
  await Promise.all(Array.from({ length: Math.min(seoReadConcurrency, batches.length) }, () => worker()));
  const products = results.flat();
  const hydratedProducts = [];
  for (const product of products) {
    hydratedProducts.push(hasNestedPaginationGap(product) ? await hydrateNestedProductConnections(product, retryInfo) : product);
  }
  return new Map(hydratedProducts.map((product) => [product.id, product]));
}

async function hydrateNestedProductConnections(product, retryInfo) {
  if (!product?.id) {
    return product;
  }

  const hydrated = {
    ...product,
    variants: {
      ...(product.variants || {}),
      nodes: [...(product.variants?.nodes || [])],
    },
    media: {
      ...(product.media || {}),
      nodes: [...(product.media?.nodes || [])],
    },
    resourcePublications: {
      ...(product.resourcePublications || {}),
      nodes: [...(product.resourcePublications?.nodes || [])],
    },
  };

  const pendingConnections = [
    {
      key: "variants",
      query: PRODUCT_VARIANTS_PAGE_QUERY,
      operation: "variant pagination",
    },
    {
      key: "media",
      query: PRODUCT_MEDIA_PAGE_QUERY,
      operation: "media pagination",
    },
    {
      key: "resourcePublications",
      query: PRODUCT_PUBLICATIONS_PAGE_QUERY,
      operation: "publication pagination",
    },
  ];

  for (const connection of pendingConnections) {
    let pageInfo = hydrated[connection.key]?.pageInfo || {};
    let after = pageInfo.endCursor || null;
    while (pageInfo.hasNextPage) {
      const data = await runShopifyCliGraphQL(
        connection.query,
        { id: product.id, after },
        { operation: `${connection.operation} ${product.handle}`, retryInfo },
      );
      const nextConnection = data?.node?.[connection.key];
      if (!nextConnection) {
        throw new Error(`Missing ${connection.key} pagination response for ${product.handle}`);
      }

      hydrated[connection.key].nodes.push(...(nextConnection.nodes || []));
      pageInfo = nextConnection.pageInfo || {};
      hydrated[connection.key].pageInfo = pageInfo;
      if (pageInfo.hasNextPage && !pageInfo.endCursor) {
        throw new Error(`Missing ${connection.key} pagination cursor for ${product.handle}`);
      }
      after = pageInfo.endCursor || null;
    }
  }

  return hydrated;
}

async function fetchLiveProductsForPlan(plan, retryInfo, sample, scopeToPlan = false) {
  if (scopeToPlan) {
    const ids = plan.products.map((entry) => entry.productId).filter(Boolean);
    const batches = [];
    for (let index = 0; index < ids.length; index += 100) {
      batches.push(ids.slice(index, index + 100));
    }
    const results = new Array(batches.length);
    let nextBatchIndex = 0;
    const worker = async () => {
      while (true) {
        const batchIndex = nextBatchIndex;
        nextBatchIndex += 1;
        if (batchIndex >= batches.length) return;
        results[batchIndex] = await fetchProductsById(
          batches[batchIndex],
          retryInfo,
          `scoped product batch ${batchIndex + 1}/${batches.length}`,
        );
      }
    };
    await Promise.all(Array.from({ length: Math.min(seoReadConcurrency, batches.length) }, () => worker()));
    return results.flatMap((result) => [...(result?.values() || [])]);
  }

  if (!sample) {
    return fetchAllProducts(retryInfo);
  }

  const products = [];
  for (const productPlan of plan.products) {
    let product = await fetchProductByHandle(productPlan.handle, retryInfo, `sample read ${productPlan.handle}`);
    if (hasNestedPaginationGap(product)) {
      product = await hydrateNestedProductConnections(product, retryInfo);
    }
    if (product) {
      products.push(product);
    }
  }
  return products;
}

function hasNestedPaginationGap(product) {
  return Boolean(
    product?.variants?.pageInfo?.hasNextPage ||
      product?.media?.pageInfo?.hasNextPage ||
      product?.resourcePublications?.pageInfo?.hasNextPage,
  );
}

function getPublishedSalesChannelCount(product) {
  const publications = product?.resourcePublications?.nodes;
  if (!Array.isArray(publications)) {
    return null;
  }

  return publications.filter((publication) => publication?.isPublished === true).length;
}

function getKnownPriorHandles(priorManifest) {
  if (!priorManifest?.policy?.initialFullCatalogPassComplete) {
    return new Set();
  }

  return new Set(
    (priorManifest.products || [])
      .filter((entry) => entry.status === "updated-verified" || entry.status === "skipped-exact-match")
      .map((entry) => normalizeHandleValue(entry.handle))
      .filter(Boolean),
  );
}

function buildScopedPlanForLiveCatalog(
  plan,
  liveProducts,
  priorManifest,
  { forceFullCatalog = false, newProductsOnly = false, explicitNewProductHandles = null } = {},
) {
  const initialFullCatalogPass = forceFullCatalog || !priorManifest?.policy?.initialFullCatalogPassComplete;
  const knownHandles = getKnownPriorHandles(priorManifest);
  const liveByHandle = new Map(
    liveProducts
      .map((product) => [normalizeHandleValue(product?.handle), product])
      .filter(([handle]) => Boolean(handle)),
  );

  return {
    ...plan,
    products: plan.products.map((productPlan) => {
      const liveProduct = liveByHandle.get(productPlan.handle);
      const isExplicitNewProduct = explicitNewProductHandles?.has(productPlan.handle) === true;
      const isNewProduct = isExplicitNewProduct || (!initialFullCatalogPass && !knownHandles.has(productPlan.handle));
      const scopedProduct = buildEligibilityScopedReleasePlan(productPlan, {
        status: liveProduct?.status || "",
        publishedSalesChannels: getPublishedSalesChannelCount(liveProduct),
        isNewProduct,
        handleMismatch: isHandleContentMismatch(productPlan),
        initialFullCatalogPass,
      });

      if (!newProductsOnly || isNewProduct) {
        return scopedProduct;
      }

      return {
        ...scopedProduct,
        desiredProductInput: {},
        desiredVariantUpdates: [],
        desiredVariantPriceUpdates: [],
        desiredMediaTargets: [],
        eligibility: {
          ...scopedProduct.eligibility,
          fullSeoEligible: false,
          metaDescriptionOnly: false,
          reason: "existing baseline product preserved by new-products-only policy",
        },
      };
    }),
  };
}

function formatUserErrors(errors) {
  return (Array.isArray(errors) ? errors : [])
    .map((error) => `${Array.isArray(error?.field) ? error.field.join(".") : ""} ${error?.message || "Shopify user error"}`.trim())
    .join("; ");
}

function productMutationFields(input) {
  return Object.keys(input || {}).filter((key) => key !== "id");
}

function buildBatchMutation(tasks, { allowVariantPricing = false } = {}) {
  const declarations = [];
  const fields = [];
  const variables = {};
  const aliases = [];

  tasks.forEach((task, index) => {
    const productAlias = `p${index}`;
    const variantAlias = `v${index}`;
    const mediaAlias = `m${index}`;
    const diff = task.diff;
    const operationAliases = { product: "", variants: "", media: "" };

    if (productMutationFields(diff.productInput).length) {
      declarations.push(`$${productAlias}: ProductUpdateInput!`);
      variables[productAlias] = diff.productInput;
      fields.push(`${productAlias}: productUpdate(product: $${productAlias}) { userErrors { field message } }`);
      operationAliases.product = productAlias;
    }

    if (diff.variantInputs.length) {
      const forbiddenFields = diff.variantInputs.flatMap((input) =>
        ["price", "compareAtPrice"].filter((field) => Object.prototype.hasOwnProperty.call(input || {}, field)),
      );
      if (forbiddenFields.length && !allowVariantPricing) {
        throw new Error(
          `SEO release invariant violated: variant pricing mutation requested (${[...new Set(forbiddenFields)].join(", ")})`,
        );
      }
      const productIdVariable = `${variantAlias}ProductId`;
      const variantsVariable = `${variantAlias}Variants`;
      declarations.push(`$${productIdVariable}: ID!`, `$${variantsVariable}: [ProductVariantsBulkInput!]!`);
      variables[productIdVariable] = task.liveProduct.id;
      variables[variantsVariable] = diff.variantInputs;
      fields.push(
        `${variantAlias}: productVariantsBulkUpdate(productId: $${productIdVariable}, variants: $${variantsVariable}) { userErrors { field message } }`,
      );
      operationAliases.variants = variantAlias;
    }

    if (diff.mediaInputs.length) {
      const productIdVariable = `${mediaAlias}ProductId`;
      const mediaVariable = `${mediaAlias}Media`;
      declarations.push(`$${productIdVariable}: ID!`, `$${mediaVariable}: [UpdateMediaInput!]!`);
      variables[productIdVariable] = task.liveProduct.id;
      variables[mediaVariable] = diff.mediaInputs;
      fields.push(
        `${mediaAlias}: productUpdateMedia(productId: $${productIdVariable}, media: $${mediaVariable}) { userErrors { field message } }`,
      );
      operationAliases.media = mediaAlias;
    }

    aliases.push(operationAliases);
  });

  return {
    query: `mutation ShopifySeoReleaseBatch(${declarations.join(", ")}) { ${fields.join(" ")} }`,
    variables,
    aliases,
  };
}

function isQueryCostExceeded(error) {
  const text = [error?.message, error?.stderr, error?.stdout, error?.code].filter(Boolean).join("\n").toLowerCase();
  return text.includes("max_cost_exceeded") || text.includes("exceeds the single query max cost limit") || text.includes("query cost is");
}

function getMutationUserErrors(response, alias) {
  if (!alias) {
    return [];
  }
  const payload = response?.[alias];
  if (!payload) {
    return [{ field: [], message: `Shopify omitted mutation response ${alias}` }];
  }
  return Array.isArray(payload.userErrors) ? payload.userErrors : [];
}

function findLiveVariantById(product, id) {
  const target = normalizePlainText(id).toLowerCase();
  const variants = Array.isArray(product?.variants?.nodes) ? product.variants.nodes : [];
  return variants.find((variant) => normalizePlainText(variant?.id).toLowerCase() === target) || null;
}

function findLiveMediaById(product, id) {
  const target = normalizePlainText(id).toLowerCase();
  const media = Array.isArray(product?.media?.nodes) ? product.media.nodes : [];
  return media.find((entry) => normalizePlainText(entry?.id).toLowerCase() === target) || null;
}

function assertMutationReadback(product, operation, input) {
  if (!product?.id) {
    throw new Error(`${operation} readback returned no product`);
  }

  if (operation === "product") {
    const mismatches = [];
    for (const field of productMutationFields(input)) {
      if (field === "seo") {
        for (const seoField of Object.keys(input.seo || {})) {
          const expected = normalizePlainText(input.seo[seoField]);
          const actual = normalizePlainText(product.seo?.[seoField]);
          const usesProductTitleDefault =
            seoField === "title" && !actual && expected === normalizePlainText(product.title);
          if (!usesProductTitleDefault && actual !== expected) {
            mismatches.push(`seo.${seoField}`);
          }
        }
        continue;
      }
      if (field === "tags") {
        const expected = [...(Array.isArray(input.tags) ? input.tags : [])].map(normalizePlainText).sort();
        const actual = [...(Array.isArray(product.tags) ? product.tags : [])].map(normalizePlainText).sort();
        if (JSON.stringify(expected) !== JSON.stringify(actual)) {
          mismatches.push(field);
        }
        continue;
      }
      const normalizer = field === "descriptionHtml" ? normalizeComparableHtml : normalizePlainText;
      const expected = normalizer(input[field]);
      const actual = normalizer(product[field]);
      if (expected !== actual) {
        mismatches.push(field);
      }
    }
    if (mismatches.length) {
      throw new Error(`Product readback mismatch: ${mismatches.join(", ")}`);
    }
    return;
  }

  if (operation === "variants") {
    const mismatches = [];
    for (const expected of input) {
      const actual = findLiveVariantById(product, expected.id);
      if (!actual) {
        mismatches.push(`${expected.id}:missing`);
        continue;
      }
      if (expected.price !== undefined && normalizePlainText(actual.price) !== normalizePlainText(expected.price)) {
        mismatches.push(`${expected.id}:price`);
      }
      if (
        expected.compareAtPrice !== undefined &&
        normalizePlainText(actual.compareAtPrice || "") !== normalizePlainText(expected.compareAtPrice || "")
      ) {
        mismatches.push(`${expected.id}:compareAtPrice`);
      }
    }
    if (mismatches.length) {
      throw new Error(`Variant readback mismatch: ${mismatches.join(", ")}`);
    }
    return;
  }

  if (operation === "media") {
    const mismatches = [];
    for (const expected of input) {
      const actual = findLiveMediaById(product, expected.id);
      if (!actual) {
        mismatches.push(`${expected.id}:missing`);
      } else if (normalizePlainText(actual.alt || "") !== normalizePlainText(expected.alt || "")) {
        mismatches.push(`${expected.id}:alt`);
      }
    }
    if (mismatches.length) {
      throw new Error(`Media readback mismatch: ${mismatches.join(", ")}`);
    }
  }
}

async function applyMutationAndVerify({ handle, operation, mutation, variables, retryInfo, mutationInput }) {
  const response = await runShopifyCliGraphQL(mutation, variables, {
    allowMutations: true,
    operation: `${operation} update ${handle}`,
    retryInfo,
  });
  const payload = response?.productUpdate || response?.productVariantsBulkUpdate || response?.productUpdateMedia;
  const errors = payload?.userErrors || [];
  if (errors.length) {
    throw new Error(`${operation} mutation failed for ${handle}: ${formatUserErrors(errors)}`);
  }

  const liveProduct = await fetchProductByHandle(handle, retryInfo, `${operation} readback ${handle}`);
  assertMutationReadback(liveProduct, operation, mutationInput);
  return liveProduct;
}

function createManifest({ mode, output, plan, priorManifest }) {
  const priorByHandle = new Map((priorManifest?.products || []).map((entry) => [entry.handle, entry]));
  const products = plan.products.map((productPlan) => ({
    handle: productPlan.handle,
    productId: productPlan.productId || "",
    confidence: productPlan.confidence,
    rewriteLevel: productPlan.rewriteLevel,
    desiredQuantityTag: productPlan.desiredQuantityTag || "",
    desiredFingerprint: buildDesiredFingerprint(productPlan),
    liveFingerprint: "",
    status: "pending-live-read",
    eligibility: null,
    changedFields: [],
    skippedFields: [],
    writeCount: 0,
    writeCounts: { product: 0, variants: 0, media: 0, total: 0 },
    priorStatus: priorByHandle.get(productPlan.handle)?.status || "",
    verifiedAt: "",
    failures: [],
    retryInfo: [],
  }));

  return {
    schemaVersion: 1,
    runId: `${Date.now()}-${process.pid}`,
    startedAt: new Date().toISOString(),
    completedAt: "",
    mode,
    source: {
      catalog: resolve(inputDir, "products.json"),
      collections: resolve(inputDir, "collections.json"),
      collectionProducts: resolve(inputDir, "collection-products.json"),
      liveCatalog: liveCatalogPath,
      store: storeDomain,
      apiVersion,
    },
    policy: {
      identity: "canonical handle",
      fillMissingOnly: false,
      liveReadRequired: true,
      failOnMissingHandle: true,
      failOnUnresolvedIdentity: true,
      failOnReadbackMismatch: true,
      tags: "preserve merchant tags; reconcile only minimum-qty-2 and minimum-qty-3 from effective price",
      category: "authoritative source only",
      saltJson: "untouched",
      initialFullCatalogPassComplete: Boolean(priorManifest?.policy?.initialFullCatalogPassComplete),
      metaDescriptionBackfillComplete: Boolean(priorManifest?.policy?.metaDescriptionBackfillComplete),
      merchandisingMetafields: "fill missing values for the full catalog, then preserve existing values",
      subsequentSeoScope: "draft, zero published channels, new handles, or handle/content mismatch",
      managedQuantityTagsScope: "all products on every SEO release dry-run/apply",
    },
    output,
    summary: {
      sourceRows: plan.summary.sourceRows || plan.rows.length,
      sourceProducts: plan.summary.sourceProducts || 0,
      localCatalogProducts: plan.summary.sourceProducts || 0,
      catalogAugmentedProducts: 0,
      liveProducts: 0,
      plannedProducts: plan.products.length,
      initialFullCatalogPass: !priorManifest?.policy?.initialFullCatalogPassComplete,
      exactMatches: 0,
      wouldUpdate: 0,
      updatedVerified: 0,
      failed: 0,
      missingHandles: 0,
      unresolved: 0,
      fullSeoEligible: 0,
      metaDescriptionOnly: 0,
      policyPreserved: 0,
      newProducts: 0,
      handleMismatches: 0,
      draftProducts: 0,
      zeroSalesChannelProducts: 0,
      liveOnlyProducts: 0,
      sourceOnlyProducts: 0,
      sourceOnlyExcluded: 0,
      productWrites: 0,
      variantWrites: 0,
      mediaWrites: 0,
      totalWrites: 0,
      managedQuantityTagWrites: 0,
    },
    failures: [],
    retryInfo: [],
    products,
  };
}

async function writeManifest(filePath, manifest) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

async function writeJsonFile(filePath, payload) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(payload)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

async function readPriorManifest(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    process.stdout.write(`Ignoring unreadable prior SEO release manifest: ${error.message}\n`);
    return null;
  }
}

function refreshSummary(manifest) {
  const products = manifest.products || [];
  manifest.summary.exactMatches = products.filter((entry) => entry.status === "skipped-exact-match").length;
  manifest.summary.wouldUpdate = products.filter((entry) => entry.status === "would-update").length;
  manifest.summary.updatedVerified = products.filter((entry) => entry.status === "updated-verified").length;
  manifest.summary.failed = products.filter((entry) => entry.status === "failed").length;
  manifest.summary.missingHandles = products.filter((entry) => entry.status === "failed-missing-handle").length;
  manifest.summary.unresolved = products.filter((entry) => entry.status === "failed-unresolved").length;
  manifest.summary.fullSeoEligible = products.filter((entry) => entry.eligibility?.fullSeoEligible).length;
  manifest.summary.metaDescriptionOnly = products.filter((entry) => entry.eligibility?.metaDescriptionOnly).length;
  manifest.summary.policyPreserved = products.filter(
    (entry) => entry.eligibility?.reason === "existing eligible content preserved",
  ).length;
  manifest.summary.newProducts = products.filter((entry) => entry.eligibility?.isNewProduct).length;
  manifest.summary.handleMismatches = products.filter((entry) => entry.eligibility?.handleMismatch).length;
  manifest.summary.draftProducts = products.filter((entry) => entry.eligibility?.isDraft).length;
  manifest.summary.zeroSalesChannelProducts = products.filter(
    (entry) => entry.eligibility?.hasZeroPublishedChannels,
  ).length;
  manifest.summary.productWrites = products.reduce((total, entry) => total + (entry.writeCounts?.product || 0), 0);
  manifest.summary.variantWrites = products.reduce((total, entry) => total + (entry.writeCounts?.variants || 0), 0);
  manifest.summary.mediaWrites = products.reduce((total, entry) => total + (entry.writeCounts?.media || 0), 0);
  manifest.summary.totalWrites = products.reduce((total, entry) => total + (entry.writeCounts?.total || 0), 0);
  manifest.summary.managedQuantityTagWrites = products.filter((entry) =>
    (entry.changedFields || []).includes("managed-minimum-quantity-tag"),
  ).length;
}

function markFailure(manifest, entry, status, error) {
  const failure = {
    handle: entry?.handle || "",
    status,
    message: String(error?.message || error),
    at: new Date().toISOString(),
  };
  if (entry) {
    entry.status = status;
    entry.failures = [...(entry.failures || []), failure];
  }
  manifest.failures.push(failure);
}

function assertNoUnverifiedFailures(manifest) {
  if (!manifest.failures.length) {
    return;
  }

  const preview = manifest.failures
    .slice(0, 8)
    .map((failure) => `${failure.handle || "catalog"}: ${failure.message}`)
    .join(" | ");
  throw new Error(`Shopify SEO release failed with ${manifest.failures.length} failure(s). ${preview}`);
}

function auditLiveSeoPlan(plan, manifest) {
  const allowedTags = new Set(["h2", "h3", "p", "ul", "li", "strong", "ol"]);
  const genericTitle = /beauty product|personal care item|portable false eyelashes|lines water light/i;
  const plannedContent = plan.products.map((product) => {
    const desired = product.desiredProductInput || {};
    const intelligence = product.intelligence || {};
    return {
      product,
      id: product.productId || null,
      handle: product.handle,
      title: desired.title || intelligence.canonicalTitle || intelligence.sourceTitle || "",
      evidence: {
        handle: product.handle,
        title: desired.title || intelligence.canonicalTitle || intelligence.sourceTitle || "",
        productType: desired.productType || product.productType || intelligence.productType || "",
        tags: intelligence.tags || [],
      },
      title: String(desired.title || intelligence.canonicalTitle || intelligence.sourceTitle || "").trim(),
      body: String(desired.descriptionHtml || ""),
      seoTitle: String(desired.seo?.title || "").trim(),
      seoDescription: String(desired.seo?.description || "").trim(),
    };
  });
  const collisions = findCatalogContentCollisions(plannedContent, [
    { id: "seo-title", getValue: (entry) => entry.seoTitle },
    { id: "seo-description", getValue: (entry) => entry.seoDescription },
  ]);
  const collisionsByHandle = new Map();
  for (const collision of collisions) {
    for (const member of collision.members) {
      if (!member.handle) continue;
      if (!collisionsByHandle.has(member.handle)) collisionsByHandle.set(member.handle, []);
      collisionsByHandle.get(member.handle).push(collision.field);
    }
  }
  let passed = 0;
  for (const content of plannedContent) {
    const { product, evidence, title, body, seoTitle, seoDescription } = content;
    const desired = product.desiredProductInput || {};
    const proposesSeoContent = Boolean(
      desired.title || desired.descriptionHtml || desired.seo?.title || desired.seo?.description,
    );
    if (!proposesSeoContent && !manifest.policy.forceFullCatalog) {
      passed += 1;
      continue;
    }
    const issues = [];
    if (!title || title.length > 75 || genericTitle.test(title)) issues.push("invalid-title");
    if (!seoTitle || seoTitle.length > 70 || genericTitle.test(seoTitle)) issues.push("invalid-seo-title");
    if (!seoDescription || seoDescription.length < 120 || seoDescription.length > 170) issues.push("invalid-seo-description");
    const seoTitleAssessment = assessProductContentSpecificity(seoTitle, evidence, {
      field: "seo-title",
      minimumEvidenceMatches: 2,
      rejectGenericPatterns: true,
    });
    const seoDescriptionAssessment = assessProductContentSpecificity(seoDescription, evidence, {
      field: "seo-description",
      minimumEvidenceMatches: 2,
      rejectGenericPatterns: true,
    });
    if (!seoTitleAssessment.specific) {
      issues.push(...seoTitleAssessment.issues.map((issue) => `seo-title:${issue}`));
    }
    if (!seoDescriptionAssessment.specific) {
      issues.push(...seoDescriptionAssessment.issues.map((issue) => `seo-description:${issue}`));
    }
    for (const field of collisionsByHandle.get(product.handle) || []) {
      issues.push(`duplicate-${field}`);
    }
    if (body) {
      if (!/<h2>About /i.test(body) || !/Key Details/i.test(body) || !/Use &amp; Care|Use & Care/i.test(body) || !/FAQs/i.test(body)) issues.push("invalid-description-structure");
      if ((body.match(/<h[23]>/gi) || []).length > 5) issues.push("cluttered-description-structure");
      const bodyAssessment = assessProductContentSpecificity(body, evidence, {
        field: "description-html",
        minimumEvidenceMatches: 2,
        rejectGenericPatterns: true,
      });
      if (!bodyAssessment.specific) {
        issues.push(...bodyAssessment.issues.map((issue) => `body:${issue}`));
      }
      for (const match of body.matchAll(/<\/?([a-z0-9]+)(?:\s[^>]*)?>/gi)) {
        if (!allowedTags.has(match[1].toLowerCase())) issues.push(`unsupported-html:${match[1].toLowerCase()}`);
      }
    }
    if (issues.length) {
      markFailure(manifest, manifest.products.find((entry) => entry.handle === product.handle), "failed-quality-audit", new Error(issues.join(", ")));
    } else {
      passed += 1;
    }
  }
  manifest.qualityAudit = {
    products: plan.products.length,
    passed,
    failed: plan.products.length - passed,
    duplicateSeoTitles: collisions.filter((entry) => entry.field === "seo-title").length,
    duplicateSeoDescriptions: collisions.filter((entry) => entry.field === "seo-description").length,
  };
  assertNoUnverifiedFailures(manifest);
}

async function preflight({ plan, manifest, liveProducts, output }) {
  auditLiveSeoPlan(plan, manifest);
  manifest.summary.liveProducts = liveProducts.length;
  const liveByHandle = new Map();
  const duplicateHandles = new Set();
  for (const product of liveProducts) {
    const handle = normalizeHandleValue(product?.handle);
    if (!handle) {
      continue;
    }
    if (liveByHandle.has(handle)) {
      duplicateHandles.add(handle);
    }
    liveByHandle.set(handle, product);
  }

  const plannedHandles = new Set(plan.products.map((entry) => entry.handle));
  const liveOnlyHandles = [...liveByHandle.keys()].filter((handle) => !plannedHandles.has(handle));
  manifest.summary.liveOnlyProducts = liveOnlyHandles.length;
  manifest.summary.sourceOnlyProducts = plan.products.filter((entry) => !liveByHandle.has(entry.handle)).length;
  if (liveOnlyHandles.length) {
    markFailure(
      manifest,
      null,
      "failed-source-catalog-incomplete",
      new Error(
        `Local catalog is missing ${liveOnlyHandles.length} live Shopify handle(s): ${liveOnlyHandles
          .slice(0, 12)
          .join(", ")}${liveOnlyHandles.length > 12 ? ", ..." : ""}`,
      ),
    );
  }

  const planByHandle = new Map(plan.products.map((entry) => [entry.handle, entry]));
  for (const entry of manifest.products) {
    const productPlan = planByHandle.get(entry.handle);
    const liveProduct = liveByHandle.get(entry.handle);
    if (productPlan) {
      entry.desiredFingerprint = buildDesiredFingerprint(productPlan);
      entry.eligibility = productPlan.eligibility || null;
    }
    if (!liveProduct) {
      markFailure(manifest, entry, "failed-missing-handle", new Error(`Product handle not found in Shopify: ${entry.handle}`));
      continue;
    }
    if (!isActiveShopifyProduct(liveProduct)) {
      markFailure(
        manifest,
        entry,
        "failed-not-active",
        new Error(`Product is not active: ${entry.handle}`),
      );
      continue;
    }
    if (duplicateHandles.has(entry.handle)) {
      markFailure(manifest, entry, "failed-unresolved", new Error(`Duplicate live Shopify handle: ${entry.handle}`));
      continue;
    }
    if (hasNestedPaginationGap(liveProduct)) {
      markFailure(
        manifest,
        entry,
        "failed-unresolved",
        new Error(`Nested variant or media connection is incomplete for ${entry.handle}`),
      );
      continue;
    }

    entry.liveFingerprint = buildLiveFingerprint(liveProduct);
    entry.liveStatus = liveProduct.status || "";
    entry.publishedSalesChannels = getPublishedSalesChannelCount(liveProduct);
    const diff = compareLiveProductToPlan(liveProduct, productPlan);
    entry.changedFields = diff.changedFields;
    entry.skippedFields = diff.skippedFields;
    entry.writeCount = diff.writeCount;
    entry.writeCounts = {
      product: productMutationFields(diff.productInput).length ? 1 : 0,
      variants: diff.variantInputs.length,
      media: diff.mediaInputs.length,
      total: diff.writeCount,
    };
    entry.liveProductId = liveProduct.id || "";
    if (diff.unresolved.length) {
      markFailure(
        manifest,
        entry,
        "failed-unresolved",
        new Error(`${entry.handle}: ${diff.unresolved.map((item) => `${item.kind}:${item.reason}`).join(", ")}`),
      );
      continue;
    }

    entry.status = diff.hasMutations ? (output.mode === "dry-run" ? "would-update" : "ready-to-update") : "skipped-exact-match";
  }

  refreshSummary(manifest);
  await writeManifest(output.path, manifest);
  assertNoUnverifiedFailures(manifest);
}

async function uploadSeoBulkInput(inputPath, retryInfo, label) {
  const data = await runShopifyCliGraphQL(STAGED_UPLOAD_CREATE_MUTATION, {
    input: [{
      resource: "BULK_MUTATION_VARIABLES",
      filename: basename(inputPath),
      mimeType: "text/jsonl",
      httpMethod: "POST",
    }],
  }, { allowMutations: true, operation: `${label} staged upload reservation`, retryInfo });
  const errors = data?.stagedUploadsCreate?.userErrors || [];
  if (errors.length) throw new Error(`${label} staged upload failed: ${formatUserErrors(errors)}`);
  const target = data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target?.url) throw new Error(`Shopify returned no ${label} staged upload target`);
  const curlArgs = ["-sS", "-X", "POST", target.url];
  for (const parameter of target.parameters || []) curlArgs.push("-F", `${parameter.name}=${parameter.value}`);
  curlArgs.push("-F", `file=@${inputPath};type=text/jsonl`);
  await execFileAsync("curl", curlArgs, { cwd: rootDir, maxBuffer: 20 * 1024 * 1024 });
  const stagedUploadPath = (target.parameters || []).find((parameter) => parameter.name === "key")?.value;
  if (!stagedUploadPath) throw new Error(`Shopify ${label} staged upload target did not include a key`);
  return stagedUploadPath;
}

async function waitForSeoBulkOperation(operationId, retryInfo, label) {
  while (true) {
    const data = await runShopifyCliGraphQL(BULK_OPERATION_STATUS_QUERY, { id: operationId }, {
      operation: `${label} bulk status`,
      retryInfo,
    });
    const operation = data?.bulkOperation;
    if (!operation) throw new Error(`${label} bulk operation not found: ${operationId}`);
    process.stdout.write(`${label} bulk operation: ${operation.status}, ${operation.objectCount || 0} object(s).\n`);
    if (operation.status === "COMPLETED") return operation;
    if (["FAILED", "CANCELED", "EXPIRED"].includes(operation.status)) {
      throw new Error(`${label} bulk operation ended ${operation.status}: ${operation.errorCode || "unknown error"}`);
    }
    await sleep(5000);
  }
}

async function verifySeoBulkResult(resultPath, tasks, responseKey, label) {
  const lines = (await readFile(resultPath, "utf8")).split(/\r?\n/).filter(Boolean);
  const completed = new Set();
  for (const [fallbackIndex, line] of lines.entries()) {
    const payload = JSON.parse(line);
    const lineNumber = Number.isInteger(Number(payload.__lineNumber)) ? Number(payload.__lineNumber) : fallbackIndex;
    const task = tasks[lineNumber];
    if (!task) throw new Error(`${label} returned an unknown input line ${lineNumber}`);
    const topLevelErrors = Array.isArray(payload.errors) ? payload.errors : [];
    if (topLevelErrors.length) {
      throw new Error(`${task.entry.handle}: ${topLevelErrors.map((error) => error?.message || "bulk error").join(" | ")}`);
    }
    const response = payload?.data?.[responseKey];
    const userErrors = response?.userErrors || [];
    if (userErrors.length) throw new Error(`${task.entry.handle}: ${formatUserErrors(userErrors)}`);
    if (!response) throw new Error(`${task.entry.handle}: ${label} returned no ${responseKey} payload`);
    completed.add(lineNumber);
  }
  if (completed.size !== tasks.length) {
    throw new Error(`${label} covered ${completed.size}/${tasks.length} input line(s)`);
  }
}

async function runSeoBulkMutation({ tasks, variablesForTask, mutation, responseKey, label, outputPath, retryInfo }) {
  if (!tasks.length) return null;
  const inputPath = outputPath.replace(/\.json$/i, `-${label.replace(/\s+/g, "-")}-bulk-input.jsonl`);
  const resultPath = outputPath.replace(/\.json$/i, `-${label.replace(/\s+/g, "-")}-bulk-result.jsonl`);
  await writeFile(inputPath, `${tasks.map((task) => JSON.stringify(variablesForTask(task))).join("\n")}\n`, "utf8");
  process.stdout.write(`Prepared ${tasks.length} ${label} input(s) for Shopify bulk mutation.\n`);
  const stagedUploadPath = await uploadSeoBulkInput(inputPath, retryInfo, label);
  const data = await runShopifyCliGraphQL(BULK_OPERATION_RUN_MUTATION, { mutation, stagedUploadPath }, {
    allowMutations: true,
    operation: `start ${label} bulk operation`,
    retryInfo,
  });
  const errors = data?.bulkOperationRunMutation?.userErrors || [];
  if (errors.length) throw new Error(`${label} bulk operation failed to start: ${formatUserErrors(errors)}`);
  const operationId = data?.bulkOperationRunMutation?.bulkOperation?.id;
  if (!operationId) throw new Error(`Shopify returned no ${label} bulk operation id`);
  const operation = await waitForSeoBulkOperation(operationId, retryInfo, label);
  if (!operation.url) throw new Error(`Completed ${label} bulk operation returned no result URL`);
  const response = await fetch(operation.url);
  if (!response.ok) throw new Error(`${label} bulk result download failed (${response.status})`);
  await writeFile(resultPath, Buffer.from(await response.arrayBuffer()));
  await verifySeoBulkResult(resultPath, tasks, responseKey, label);
  return {
    id: operation.id,
    status: operation.status,
    objectCount: Number(operation.objectCount || 0),
    completedAt: operation.completedAt || new Date().toISOString(),
    inputPath,
    resultPath,
  };
}

async function applyPlanBulk({ plan, manifest, output, liveProducts = [] }) {
  const retryInfo = [];
  const planByHandle = new Map(plan.products.map((entry) => [entry.handle, entry]));
  const initialLiveById = new Map(liveProducts.map((product) => [product.id, product]));
  const pendingEntries = manifest.products.filter(
    (entry) => entry.status !== "skipped-exact-match" && !entry.status.startsWith("failed"),
  );
  const tasks = [];

  for (const entry of pendingEntries) {
    const productPlan = planByHandle.get(entry.handle);
    const liveProduct = initialLiveById.get(entry.liveProductId);
    if (!productPlan || !liveProduct || !isActiveShopifyProduct(liveProduct)) {
      markFailure(manifest, entry, "failed-unresolved", new Error(`Bulk apply identity missing or inactive: ${entry.handle}`));
      continue;
    }
    const diff = compareLiveProductToPlan(liveProduct, productPlan);
    entry.changedFields = diff.changedFields;
    entry.skippedFields = diff.skippedFields;
    entry.writeCounts = {
      product: productMutationFields(diff.productInput).length ? 1 : 0,
      variants: diff.variantInputs.length,
      media: diff.mediaInputs.length,
      total: diff.writeCount,
    };
    entry.writeCount = diff.writeCount;
    if (diff.unresolved.length) {
      markFailure(manifest, entry, "failed-unresolved", new Error(diff.unresolved.map((item) => `${item.kind}:${item.reason}`).join(", ")));
      continue;
    }
    if (!diff.hasMutations) {
      entry.status = "skipped-exact-match";
      entry.verifiedAt = new Date().toISOString();
      continue;
    }
    tasks.push({ entry, productPlan, liveProduct, diff });
  }

  refreshSummary(manifest);
  await writeManifest(output.path, manifest);
  assertNoUnverifiedFailures(manifest);

  const productTasks = tasks.filter((task) => productMutationFields(task.diff.productInput).length);
  const mediaTasks = tasks.filter((task) => task.diff.mediaInputs.length);
  manifest.bulkOperations = manifest.bulkOperations || {};
    manifest.bulkOperations.product = await runSeoBulkMutation({
    tasks: productTasks,
    variablesForTask: (task) => ({ product: task.diff.productInput }),
    mutation: BULK_PRODUCT_UPDATE_MUTATION,
    responseKey: "productUpdate",
    label: "SEO product",
    outputPath: output.path,
    retryInfo,
  });
  await writeManifest(output.path, manifest);
  const variantTasks = tasks.filter((task) => task.diff.variantInputs.length);
  manifest.bulkOperations.variants = await runSeoBulkMutation({
    tasks: variantTasks,
    variablesForTask: (task) => ({ productId: task.liveProduct.id, variants: task.diff.variantInputs }),
    mutation: BULK_VARIANT_UPDATE_MUTATION,
    responseKey: "productVariantsBulkUpdate",
    label: "SEO variant pricing",
    outputPath: output.path,
    retryInfo,
  });
  await writeManifest(output.path, manifest);
  manifest.bulkOperations.media = await runSeoBulkMutation({
    tasks: mediaTasks,
    variablesForTask: (task) => ({ productId: task.liveProduct.id, media: task.diff.mediaInputs }),
    mutation: BULK_MEDIA_UPDATE_MUTATION,
    responseKey: "productUpdateMedia",
    label: "SEO media",
    outputPath: output.path,
    retryInfo,
  });
  await writeManifest(output.path, manifest);

  // The preflight already validated the complete active catalog. For final
  // mutation proof, read only the product IDs actually sent to the bulk job;
  // fetching every active product again through Shopify CLI pagination adds
  // minutes without improving field-level readback confidence.
  process.stdout.write(`Reading ${tasks.length} mutated products back after SEO bulk mutations.\n`);
  const finalById = await fetchProductsById(
    tasks.map((task) => task.liveProduct.id),
    retryInfo,
    "SEO final mutation readback",
  );
  const verificationFailures = [];
  for (const [index, task] of tasks.entries()) {
    const finalLive = finalById.get(task.liveProduct.id);
    try {
      if (!finalLive) throw new Error("Final verification product missing");
      const finalDiff = compareLiveProductToPlan(finalLive, task.productPlan);
      if (finalDiff.unresolved.length) {
        throw new Error(`Final verification identity failure: ${finalDiff.unresolved.map((item) => `${item.kind}:${item.reason}`).join(", ")}`);
      }
      if (finalDiff.hasMutations) {
        throw new Error(`Final verification still has differences: ${finalDiff.changedFields.join(", ")}`);
      }
      task.entry.liveFingerprint = buildLiveFingerprint(finalLive);
      task.entry.skippedFields = finalDiff.skippedFields;
      task.entry.status = "updated-verified";
      task.entry.verifiedAt = new Date().toISOString();
    } catch (error) {
      verificationFailures.push(`${task.entry.handle}: ${error.message}`);
      markFailure(manifest, task.entry, "failed", error);
    }
    if ((index + 1) % 250 === 0 || index + 1 === tasks.length) {
      process.stdout.write(`SEO bulk readback verified ${index + 1}/${tasks.length} updated product(s).\n`);
    }
  }
  manifest.retryInfo.push(...retryInfo);
  refreshSummary(manifest);
  await writeManifest(output.path, manifest);
  if (verificationFailures.length) {
    throw new Error(`SEO bulk verification failed for ${verificationFailures.length} product(s): ${verificationFailures.slice(0, 12).join(" | ")}`);
  }
  assertNoUnverifiedFailures(manifest);
}

async function applyPlanBatched({ plan, manifest, output, liveProducts = [] }) {
  const planByHandle = new Map(plan.products.map((entry) => [entry.handle, entry]));
  const initialLiveById = new Map(liveProducts.map((product) => [product.id, product]));

  const pendingEntries = manifest.products.filter(
    (entry) => entry.status !== "skipped-exact-match" && !entry.status.startsWith("failed"),
  );

  for (let start = 0; start < pendingEntries.length; start += seoApplyBatchSize) {
    const batchEntries = pendingEntries.slice(start, start + seoApplyBatchSize);
    const retryInfo = [];
    let batchPersisted = false;
    const persistBatch = async () => {
      if (batchPersisted) {
        return;
      }
      manifest.retryInfo.push(...retryInfo);
      refreshSummary(manifest);
      await writeManifest(output.path, manifest);
      batchPersisted = true;
    };

    try {
      const ids = batchEntries.map((entry) => entry.liveProductId).filter(Boolean);
      if (ids.length !== batchEntries.length) {
        throw new Error(`Live product identity missing for batch starting at ${start + 1}`);
      }

      const liveById = ids.every((id) => initialLiveById.has(id))
        ? new Map(ids.map((id) => [id, initialLiveById.get(id)]))
        : await fetchProductsById(ids, retryInfo, `live apply read batch ${start + 1}`);
      const tasks = [];
      const failuresBeforeBatch = manifest.failures.length;

      for (const entry of batchEntries) {
        const productPlan = planByHandle.get(entry.handle);
        const liveProduct = liveById.get(entry.liveProductId);
        if (!liveProduct) {
          markFailure(manifest, entry, "failed-missing-handle", new Error(`Product id not found in Shopify: ${entry.liveProductId}`));
          continue;
        }
        if (!isActiveShopifyProduct(liveProduct)) {
          markFailure(
            manifest,
            entry,
            "failed-not-active",
            new Error(`Product is no longer active: ${entry.handle}`),
          );
          continue;
        }
        if (!productPlan) {
          markFailure(manifest, entry, "failed-unresolved", new Error(`No release plan found for ${entry.handle}`));
          continue;
        }

        const diff = compareLiveProductToPlan(liveProduct, productPlan);
        entry.changedFields = diff.changedFields;
        entry.skippedFields = diff.skippedFields;
        entry.writeCounts = {
          product: productMutationFields(diff.productInput).length ? 1 : 0,
          variants: diff.variantInputs.length,
          media: diff.mediaInputs.length,
          total: diff.writeCount,
        };
        entry.writeCount = diff.writeCount;
        entry.liveFingerprint = buildLiveFingerprint(liveProduct);
        if (diff.unresolved.length) {
          markFailure(
            manifest,
            entry,
            "failed-unresolved",
            new Error(`Live identity became unresolved: ${diff.unresolved.map((item) => `${item.kind}:${item.reason}`).join(", ")}`),
          );
          continue;
        }
        if (!diff.hasMutations) {
          entry.status = "skipped-exact-match";
          entry.verifiedAt = new Date().toISOString();
          continue;
        }
        tasks.push({ entry, productPlan, liveProduct, diff });
      }

      if (manifest.failures.length > failuresBeforeBatch) {
        throw new Error(`Live identity validation failed for batch starting at ${start + 1}`);
      }
      if (!tasks.length) {
        await persistBatch();
        continue;
      }

      const batchMutation = buildBatchMutation(tasks, {
        allowVariantPricing: Boolean(manifest.policy.variantPriceRepair),
      });
      let response;
      try {
        response = await runShopifyCliGraphQL(batchMutation.query, batchMutation.variables, {
          allowMutations: true,
          operation: `SEO mutation batch ${start + 1}-${start + tasks.length}`,
          retryInfo,
        });
      } catch (error) {
        if (tasks.length > 1 && isQueryCostExceeded(error)) {
          const midpoint = Math.max(1, Math.floor(tasks.length / 2));
          pendingEntries.splice(start, tasks.length, ...[]);
          pendingEntries.splice(start, 0, ...tasks.slice(0, midpoint).map((task) => task.entry), ...tasks.slice(midpoint).map((task) => task.entry));
          start -= 1;
          await persistBatch();
          continue;
        }
        for (const task of tasks) {
          markFailure(manifest, task.entry, "failed", error);
        }
        throw error;
      }

      const mutationErrors = tasks.map((task, index) => {
        const aliases = batchMutation.aliases[index];
        return Object.entries(aliases)
          .flatMap(([operation, alias]) =>
            getMutationUserErrors(response, alias).map((error) => `${operation}: ${formatUserErrors([error])}`),
          )
          .filter(Boolean);
      });

      let finalById;
      try {
        finalById = await fetchProductsById(
          tasks.map((task) => task.liveProduct.id),
          retryInfo,
          `SEO verification batch ${start + 1}-${start + tasks.length}`,
        );
      } catch (error) {
        for (const task of tasks) {
          markFailure(manifest, task.entry, "failed", error);
        }
        throw error;
      }

      const verificationFailures = [];
      tasks.forEach((task, index) => {
        const { entry, productPlan, liveProduct, diff } = task;
        try {
          const finalLive = finalById.get(liveProduct.id);
          if (!finalLive) {
            throw new Error(`Final verification product missing: ${entry.handle}`);
          }
          if (mutationErrors[index].length) {
            throw new Error(`Shopify mutation errors: ${mutationErrors[index].join("; ")}`);
          }

          const aliases = batchMutation.aliases[index];
          if (aliases.product) {
            assertMutationReadback(finalLive, "product", diff.productInput);
          }
          if (aliases.variants) {
            assertMutationReadback(finalLive, "variants", diff.variantInputs);
          }
          if (aliases.media) {
            assertMutationReadback(finalLive, "media", diff.mediaInputs);
          }

          const finalDiff = compareLiveProductToPlan(finalLive, productPlan);
          if (finalDiff.unresolved.length) {
            throw new Error(
              `Final verification identity failure: ${finalDiff.unresolved
                .map((item) => `${item.kind}:${item.reason}`)
                .join(", ")}`,
            );
          }
          if (finalDiff.hasMutations) {
            throw new Error(`Final verification still has differences: ${finalDiff.changedFields.join(", ")}`);
          }

          entry.liveFingerprint = buildLiveFingerprint(finalLive);
          entry.skippedFields = finalDiff.skippedFields;
          entry.writeCounts.total = entry.writeCounts.product + entry.writeCounts.variants + entry.writeCounts.media;
          entry.writeCount = entry.writeCounts.total;
          entry.status = entry.writeCount ? "updated-verified" : "skipped-exact-match";
          entry.verifiedAt = new Date().toISOString();
          process.stdout.write(`${entry.status}: ${entry.handle}\n`);
        } catch (error) {
          verificationFailures.push(`${entry.handle}: ${error.message}`);
          markFailure(manifest, entry, "failed", error);
        }
      });

      if (verificationFailures.length) {
        throw new Error(`SEO verification failed for ${verificationFailures.length} product(s): ${verificationFailures.join(" | ")}`);
      }

      await persistBatch();
    } catch (error) {
      await persistBatch();
      throw error;
    }
  }
}

async function applyPlan(args) {
  const pendingCount = args.manifest.products.filter(
    (entry) => entry.status !== "skipped-exact-match" && !entry.status.startsWith("failed"),
  ).length;
  const bulkThreshold = Math.max(1, Number(process.env.SALT_SHOPIFY_SEO_BULK_THRESHOLD || 500));
  if (pendingCount >= bulkThreshold) {
    return applyPlanBulk(args);
  }
  return applyPlanBatched(args);
}

export async function runShopifySeoRelease({
  mode = "dry-run",
  output = outputPath,
  sample = 0,
  preservePrices = true,
  repairVariantPricing = false,
  preserveTags = false,
  tagsOnly = false,
  fullCatalog = false,
  frozenCatalog = "",
  productHandlesFile = "",
  newProductsOnly = false,
} = {}) {
  const priorManifest = await readPriorManifest(output);
  const localSnapshot = await loadCatalogSnapshot();
  const snapshot = await loadFrozenCatalogSnapshot(frozenCatalog, localSnapshot);
  const knowledgeModel = await readCatalogKnowledgeModel({
    required: process.env.SALT_REQUIRE_KNOWLEDGE_MODEL === "1",
  });
  const explicitNewProductHandles = newProductsOnly ? await readProductHandles(productHandlesFile) : null;
  const localPlan = await buildShopifySeoReleasePlan(snapshot, {
    forceExplicitSeo: true,
    repairVariantPricing,
    knowledgeModel,
  });
  const selectedProducts = explicitNewProductHandles
    ? localPlan.products.filter((product) => explicitNewProductHandles.has(product.handle))
    : localPlan.products;
  if (explicitNewProductHandles && selectedProducts.length !== explicitNewProductHandles.size) {
    const available = new Set(localPlan.products.map((product) => product.handle));
    const missing = [...explicitNewProductHandles].filter((handle) => !available.has(handle));
    throw new Error(`Product handles file contains ${missing.length} handle(s) missing from the frozen catalog: ${missing.slice(0, 10).join(", ")}`);
  }
  const localPlanSelection = {
    ...localPlan,
    products: sample > 0 ? selectedProducts.slice(0, sample) : selectedProducts,
  };
  let manifest = createManifest({ mode, output, plan: localPlanSelection, priorManifest });
  manifest.policy.sample = sample || null;
  manifest.policy.tagsOnly = tagsOnly;
  manifest.policy.forceFullCatalog = fullCatalog;
  manifest.policy.frozenCatalog = frozenCatalog || null;
  manifest.policy.productHandlesFile = productHandlesFile || null;
  manifest.policy.newProductsOnly = newProductsOnly;
  manifest.summary.sourceProducts = localPlan.summary.sourceProducts;
  manifest.summary.localCatalogProducts = localPlan.summary.sourceProducts;
  await writeManifest(output, manifest);

  const retryInfo = manifest.retryInfo;
  process.stdout.write(
    `Shopify SEO release ${mode}: ${localPlanSelection.products.length} local product(s), API ${apiVersion}\n`,
  );
  let liveProducts;
  try {
    liveProducts = await fetchLiveProductsForPlan(localPlanSelection, retryInfo, sample, Boolean(frozenCatalog));
  } catch (error) {
    markFailure(manifest, null, "failed-live-read", error);
    refreshSummary(manifest);
    await writeManifest(output, manifest);
    throw error;
  }
  const priceFloorGate = assertBaseSeoPriceFloor(liveProducts);
  manifest.policy.priceFloor = {
    threshold: priceFloorGate.threshold,
    variantsChecked: priceFloorGate.variantsChecked,
    requirement: "every live SEO-scope variant must have a price at or above the approved floor before base SEO runs",
  };
  await writeManifest(output, manifest);
  // A frozen catalog is the immutable pre-apply source of truth for safe resume.
  // Never merge current live prices into it or a resumed run could compound pricing.
  const mergedSnapshot = frozenCatalog
    ? { ...snapshot, liveOnlyProducts: [] }
    : mergeCatalogSnapshotWithLiveProducts(snapshot, liveProducts);
  await writeJsonFile(liveCatalogPath, {
    generatedAt: new Date().toISOString(),
    source: `Shopify CLI ${storeDomain}`,
    total: mergedSnapshot.products.length,
    products: mergedSnapshot.products,
  });
  const mergedPlan = await buildShopifySeoReleasePlan(mergedSnapshot, {
    forceExplicitSeo: true,
    repairVariantPricing,
    knowledgeModel,
  });
  const selectedHandles = new Set(localPlanSelection.products.map((entry) => entry.handle));
  const selectedPlan =
    sample > 0
      ? { ...mergedPlan, products: mergedPlan.products.filter((entry) => selectedHandles.has(entry.handle)) }
      : mergedPlan;
  const liveHandleSet = new Set(liveProducts.map((product) => normalizeHandleValue(product?.handle)).filter(Boolean));
  // Shopify remains the source of truth for the all-active release. Storefront
  // publication is deliberately deferred until every product task has verified.
  const restrictToActiveLiveCatalog = true;
  const sourceOnlyExcluded = restrictToActiveLiveCatalog
    ? selectedPlan.products.filter((entry) => !liveHandleSet.has(entry.handle)).length
    : 0;
  const plan = restrictToActiveLiveCatalog
    ? { ...selectedPlan, products: selectedPlan.products.filter((entry) => liveHandleSet.has(entry.handle)) }
    : selectedPlan;
  manifest = createManifest({ mode, output, plan, priorManifest });
  manifest.policy.sample = sample || null;
  manifest.policy.tagsOnly = tagsOnly;
  manifest.policy.forceFullCatalog = fullCatalog;
  manifest.policy.frozenCatalog = frozenCatalog || null;
  manifest.policy.productHandlesFile = productHandlesFile || null;
  manifest.policy.newProductsOnly = newProductsOnly;
  manifest.policy.catalogAugmentedFromLive = true;
  manifest.retryInfo = retryInfo;
  manifest.summary.sourceProducts = plan.summary.sourceProducts;
  manifest.summary.localCatalogProducts = localPlan.summary.sourceProducts;
  manifest.summary.catalogAugmentedProducts = mergedSnapshot.liveOnlyProducts?.length || 0;
  manifest.summary.sourceOnlyExcluded = sourceOnlyExcluded;
  await writeManifest(output, manifest);

  const eligibilityPlan = buildScopedPlanForLiveCatalog(plan, liveProducts, priorManifest, {
    forceFullCatalog: fullCatalog,
    newProductsOnly,
    explicitNewProductHandles,
  });
  const liveProductsByHandle = new Map(liveProducts.map((product) => [normalizeHandleValue(product?.handle), product]));
  const pricingScopedPlan = {
    ...eligibilityPlan,
    products: eligibilityPlan.products.map((product) => ({
      ...product,
      desiredVariantUpdates: [],
      desiredQuantityTag: product.currentQuantityTag || "",
    })),
  };
  const tagScopedPlan = preserveTags
    ? {
        ...pricingScopedPlan,
        products: pricingScopedPlan.products.map((product) => ({
          ...product,
          desiredQuantityTag: managedMinimumQuantityTagFromTags(liveProductsByHandle.get(product.handle)?.tags || []),
        })),
      }
    : pricingScopedPlan;
  const scopedPlan = tagsOnly
    ? {
        ...tagScopedPlan,
        products: tagScopedPlan.products.map((product) => ({
          ...product,
          desiredProductInput: {},
          desiredVariantUpdates: [],
          desiredVariantPriceUpdates: [],
          desiredMediaTargets: [],
        })),
      }
    : tagScopedPlan;
  manifest.policy.variantPriceRepair = repairVariantPricing;
  manifest.policy.pricing = repairVariantPricing
    ? "Explicit quantity-tier repair only; repeated prices are raised from the smallest-quantity unit price and verified per variant"
    : "Shopify-authoritative; SEO never mutates variant price or compare-at price";
  manifest.policy.tags = preserveTags ? "all live Shopify tags preserved exactly" : manifest.policy.tags;
  manifest.policy.mutationScope = tagsOnly ? "managed minimum-quantity tags only" : "eligible SEO plus managed tags";
  if (repairVariantPricing && (scopedPlan.summary?.variantPriceRepairHeld || []).length) {
    markFailure(
      manifest,
      null,
      "failed-pricing-review",
      new Error(`Variant pricing requires manual review for ${(scopedPlan.summary.variantPriceRepairHeld || []).length} ambiguous group(s).`),
    );
  }
  await preflight({ plan: scopedPlan, manifest, liveProducts, output: { mode, path: output } });

  if (mode === "dry-run") {
    manifest.completedAt = new Date().toISOString();
    refreshSummary(manifest);
    await writeManifest(output, manifest);
    process.stdout.write(
      `Dry run complete: ${manifest.summary.exactMatches} exact, ${manifest.summary.wouldUpdate} would update, ${manifest.summary.totalWrites} field operation(s).\n`,
    );
    return manifest;
  }

  await applyPlan({ plan: scopedPlan, manifest, output: { mode, path: output }, liveProducts });
  if (sample === 0) {
    manifest.policy.initialFullCatalogPassComplete = true;
    manifest.policy.metaDescriptionBackfillComplete = true;
  }
  manifest.completedAt = new Date().toISOString();
  refreshSummary(manifest);
  await writeManifest(output, manifest);
  assertNoUnverifiedFailures(manifest);
  process.stdout.write(
    `SEO release complete: ${manifest.summary.updatedVerified} updated and verified, ${manifest.summary.exactMatches} exact, ${manifest.summary.totalWrites} write operation(s).\n`,
  );
  return manifest;
}

async function main() {
  const args = parseArgs(process.argv);
  await access(rootDir);
  await runShopifySeoRelease(args);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
