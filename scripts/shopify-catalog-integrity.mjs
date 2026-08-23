#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { promisify } from "node:util";

import {
  ALL_PRODUCTS_COLLECTION_POLICY,
  COLLECTION_GOVERNANCE_VERSION,
  PRICE_COLLECTION_POLICIES,
  RETIRED_COLLECTION_HANDLE_MAP,
  SEMANTIC_COLLECTION_POLICIES,
  assertCompleteCollectionGovernance,
  buildPriceCollectionSource,
  buildProductCollectionTags,
  canonicalCollectionHandle,
  buildSemanticCollectionSource,
  collectionTagForHandle,
  normalizeCollectionHandle,
  productMatchesPricePolicy,
  resolveCollectionPolicyByLiveHandle,
  isManagedCollectionTag,
  semanticCollectionRuleTags,
} from "../src/lib/catalog-collection-governance.js";
import {
  isLegacySaltTag,
  isSimpleClassificationTag,
  simpleCatalogTag,
} from "../src/lib/catalog-simple-tags.js";
import {
  classifyCatalogTaxonomy,
  classifyCatalogTaxonomyByRuleId,
  classifyCatalogTaxonomyWithoutOverrides,
  CATALOG_TAXONOMY_VERSION,
  getCatalogTaxonomyDefinitions,
  normalizeCatalogText,
  tokenizeCatalogText,
} from "../src/lib/catalog-taxonomy.js";
import {
  buildProductKnowledgeFromTaxonomy,
  classifyProductKnowledge,
} from "../src/lib/product-knowledge-base.js";
import { assessVisionTaxonomyAlignment } from "../src/lib/catalog-vision-alignment.js";
import {
  SPECIAL_COLLECTION_MINIMUMS,
  assertSpecialCollectionMinimums,
  buildSpecialCollectionAssignments,
} from "./build-new-product-special-collection-tags-local.mjs";
import {
  asArray,
  createShopifyAdminGraphQLClient,
  normalizeText,
} from "./shopify-admin-graphql-client.mjs";
import { readProductCatalogPayload } from "./product-catalog-files-local.mjs";
import { readCatalogKnowledgeModel } from "./catalog-knowledge-model-local.mjs";
import { scoreCatalogKnowledgeModelBatch } from "./catalog-knowledge-model-accelerator.mjs";
import { ensureFutureLightVisionRuntime } from "./future-light-vision-runtime.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const execFileAsync = promisify(execFile);
const defaultOutputPath = resolve(rootDir, "output", "shopify-catalog-integrity-manifest.json");
const visualReviewQueuePath = resolve(rootDir, "output", "catalog-visual-review-queue.json");
const liveInputCheckpointPath = process.env.SALT_CATALOG_INTEGRITY_LIVE_CHECKPOINT ||
  resolve(rootDir, "output", ".shopify-catalog-integrity-live-input.json");
const collectionApprovalPath = resolve(rootDir, "docs", "catalog-collection-approval.json");
const membershipPollAttempts = Math.max(1, Number(process.env.SALT_COLLECTION_MEMBERSHIP_POLL_ATTEMPTS || 12));
const membershipPollDelayMs = Math.max(1000, Number(process.env.SALT_COLLECTION_MEMBERSHIP_POLL_DELAY_MS || 10_000));
const defaultCatalogBatchSize = 50;
const visionModel = process.env.SALT_CATALOG_VISION_MODEL || "gemma3:4b";
const ollamaUrl = (process.env.SALT_OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
const visionImageAttempts = Math.max(1, Math.min(8, Number(process.env.SALT_CATALOG_VISION_IMAGE_ATTEMPTS || 4)));
const visionImageTimeoutMs = Math.max(5_000, Number(process.env.SALT_CATALOG_VISION_IMAGE_TIMEOUT_MS || 30_000));
const visionImageRetryDelayMs = Math.max(100, Number(process.env.SALT_CATALOG_VISION_IMAGE_RETRY_DELAY_MS || 750));
const visionOutputTokens = Math.max(160, Math.min(512, Number(process.env.SALT_CATALOG_VISION_OUTPUT_TOKENS || 256)));
const visionImageLimit = Math.max(1, Math.min(4, Number(process.env.SALT_CATALOG_VISION_IMAGE_LIMIT || 4)));
const visionRequestTimeoutMs = Math.max(30_000, Number(process.env.SALT_CATALOG_VISION_REQUEST_TIMEOUT_MS || 120_000));
const visionRequestAttempts = Math.max(1, Math.min(3, Number(process.env.SALT_CATALOG_VISION_REQUEST_ATTEMPTS || 2)));
const classificationConcurrency = Math.max(
  1,
  Math.min(12, Number(process.env.SALT_CATALOG_CLASSIFICATION_CONCURRENCY || 4)),
);
const client = createShopifyAdminGraphQLClient({ rootDir, agentName: "catalog-integrity" });

async function readCurrentKnowledgeEvidence(products) {
  const evidencePath = process.env.SALT_CATALOG_KNOWLEDGE_EVIDENCE_PATH;
  if (!evidencePath) return null;
  const payload = JSON.parse(await readFile(evidencePath, "utf8"));
  const evidence = payload?.evidence;
  if (!evidence || typeof evidence !== "object") throw new Error(`Knowledge evidence cache has no evidence map: ${evidencePath}`);
  const byKey = new Map();
  let matched = 0;
  for (const product of products) {
    const id = String(product?.id || "");
    const numericId = id.split("/").pop();
    const value = evidence[id] || evidence[numericId];
    if (value) {
      matched += 1;
      byKey.set(id, value);
      if (product?.handle) byKey.set(String(product.handle), value);
    }
  }
  if (matched < products.length) {
    throw new Error(`Knowledge evidence cache covers ${matched}/${products.length} live products.`);
  }
  return byKey;
}

const MANAGED_TAG_PREFIXES = Object.freeze(["salt:"]);

const PRODUCTS_QUERY = /* GraphQL */ `
  query CatalogIntegrityProducts($first: Int!, $after: String, $query: String!) {
    products(first: $first, after: $after, query: $query, sortKey: ID) {
      nodes {
        id
        handle
        title
        descriptionHtml
        productType
        vendor
        status
        tags
        createdAt
        updatedAt
        variants(first: 250) {
          nodes { id title sku price compareAtPrice }
          pageInfo { hasNextPage endCursor }
        }
        media(first: 5) {
          nodes {
            __typename
            ... on MediaImage { id alt image { url } }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const PRODUCT_VARIANTS_QUERY = /* GraphQL */ `
  query CatalogIntegrityProductVariants($id: ID!, $first: Int!, $after: String) {
    node(id: $id) {
      ... on Product {
        variants(first: $first, after: $after) {
          nodes { id title sku price compareAtPrice }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
`;

const COLLECTIONS_QUERY = /* GraphQL */ `
  query CatalogIntegrityCollections($first: Int!, $after: String) {
    collections(first: $first, after: $after) {
      nodes {
        id
        handle
        title
        descriptionHtml
        productsCount { count }
        ruleSet { appliedDisjunctively rules { column relation condition } }
        sources {
          __typename
          ... on CollectionConditionsSource {
            id
            title
            shareable
            targetType
            inclusion {
              matchType
              conditions {
                __typename
                id
                ... on CollectionSourceInclusionConditionProductTag { relation values matchType }
                ... on CollectionSourceInclusionConditionVariantPrice { relation value { amount currencyCode } }
              }
            }
          }
        }
        resourcePublications(first: 100) {
          nodes { isPublished channel { id name } }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const PUBLICATIONS_QUERY = /* GraphQL */ `
  query CatalogIntegrityPublications($first: Int!, $after: String) {
    publications(first: $first, after: $after) {
      nodes { id name }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const ACTIVE_PRODUCT_TAGS_QUERY = /* GraphQL */ `
  query CatalogIntegrityActiveProductTags($first: Int!, $after: String, $query: String!) {
    products(first: $first, after: $after, query: $query, sortKey: ID) {
      nodes { id handle tags }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const COLLECTION_CREATE_MUTATION = /* GraphQL */ `
  mutation CatalogIntegrityCollectionCreate($collection: CollectionCreateInput!) {
    collectionCreate(collection: $collection) {
      collection { id handle title }
      userErrors { field message }
    }
  }
`;

const STAGED_UPLOAD_CREATE_MUTATION = /* GraphQL */ `
  mutation CatalogIntegrityTagUpload($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url resourceUrl parameters { name value } }
      userErrors { field message }
    }
  }
`;

const BULK_OPERATION_RUN_MUTATION = /* GraphQL */ `
  mutation CatalogIntegrityRunTagBulk($mutation: String!, $stagedUploadPath: String!) {
    bulkOperationRunMutation(mutation: $mutation, stagedUploadPath: $stagedUploadPath) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }
`;

const BULK_OPERATION_RUN_QUERY = /* GraphQL */ `
  mutation CatalogIntegrityRunMembershipExport($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }
`;

const BULK_OPERATION_STATUS_QUERY = /* GraphQL */ `
  query CatalogIntegrityTagBulkStatus($id: ID!) {
    bulkOperation(id: $id) {
      id status errorCode objectCount fileSize url partialDataUrl createdAt completedAt
    }
  }
`;

const BULK_PRODUCT_TAG_MUTATION = /* GraphQL */ `
  mutation CatalogIntegrityExactProductTags($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id }
      userErrors { field message }
    }
  }
`;

const BULK_COLLECTION_UPDATE_MUTATION = /* GraphQL */ `
  mutation CatalogIntegrityExactCollection($collection: CollectionUpdateInput!) {
    collectionUpdate(collection: $collection) {
      collection { id handle title }
      userErrors { field message }
    }
  }
`;

const BULK_COLLECTION_MEMBERSHIP_QUERY = /* GraphQL */ `
  {
    collections {
      edges {
        node {
          id
          handle
          title
          productsCount { count }
          sources {
            __typename
            ... on CollectionConditionsSource {
              id
              title
              shareable
              targetType
              inclusion {
                matchType
                conditions {
                  __typename
                  id
                  ... on CollectionSourceInclusionConditionProductTag { relation values matchType }
                  ... on CollectionSourceInclusionConditionVariantPrice { relation value { amount currencyCode } }
                }
              }
            }
          }
          products {
            edges { node { id } }
          }
        }
      }
    }
  }
`;

const PUBLISH_MUTATION = /* GraphQL */ `
  mutation CatalogIntegrityCollectionPublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
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
    output: defaultOutputPath,
    skipVision: false,
    useLiveCheckpoint: false,
    reclassify: false,
    deterministicOnly: false,
    supervisedVision: false,
    reviewOnly: false,
    reusePriorManifest: false,
    batchSize: defaultCatalogBatchSize,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--apply") args.mode = "apply";
    else if (token === "--dry-run") args.mode = "dry-run";
    else if (token === "--verify") args.mode = "verify";
    else if (token === "--skip-vision") args.skipVision = true;
    else if (token === "--use-live-checkpoint") args.useLiveCheckpoint = true;
    else if (token === "--reclassify") args.reclassify = true;
    else if (token === "--deterministic-only") args.deterministicOnly = true;
    else if (token === "--supervised-vision") args.supervisedVision = true;
    else if (token === "--review-only") args.reviewOnly = true;
    else if (token === "--reuse-prior-manifest") args.reusePriorManifest = true;
    else if (token === "--batch-size") {
      const batchSize = Number(next);
      if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
        throw new Error("--batch-size must be an integer between 1 and 1000");
      }
      args.batchSize = batchSize;
      index += 1;
    }
    else if (token === "--output") {
      if (!next) throw new Error("Missing value for --output");
      args.output = resolve(rootDir, next);
      index += 1;
    } else throw new Error(`Unknown argument: ${token}`);
  }
  if (args.useLiveCheckpoint && !["dry-run", "verify"].includes(args.mode)) {
    throw new Error("--use-live-checkpoint is allowed only for non-mutating dry runs and verifies");
  }
  return args;
}

function formatUserErrors(errors) {
  return asArray(errors).map((error) => {
    const field = asArray(error?.field).join(".");
    return `${field} ${normalizeText(error?.message || "Shopify user error")}`.trim();
  }).join("; ");
}

function numericId(value) {
  return String(value || "").match(/(\d+)$/)?.[1] || "";
}

function normalizeTag(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function uniqueTags(values) {
  const byNormalized = new Map();
  for (const value of values) {
    const text = normalizeText(value);
    const normalized = normalizeTag(text);
    if (text && normalized && !byNormalized.has(normalized)) byNormalized.set(normalized, text);
  }
  return [...byNormalized.values()];
}

function isManagedTag(tag, managedTagUniverse = new Set()) {
  const normalized = normalizeTag(tag);
  return MANAGED_TAG_PREFIXES.some((prefix) => normalized.startsWith(prefix)) ||
    isLegacySaltTag(normalized) ||
    isSimpleClassificationTag(normalized) ||
    isManagedCollectionTag(normalized) ||
    managedTagUniverse.has(normalized);
}

function isOnlineStorePublished(collection) {
  return asArray(collection?.resourcePublications?.nodes).some((publication) =>
    publication?.isPublished === true && normalizeTag(publication?.channel?.name) === "online store",
  );
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function buildPriorIntegritySnapshot(manifest) {
  if (!manifest?.completedAt) return null;
  if (manifest?.version !== COLLECTION_GOVERNANCE_VERSION) return null;
  if (manifest?.taxonomyVersion && manifest.taxonomyVersion !== CATALOG_TAXONOMY_VERSION) return null;
  if (
    manifest?.collectionGovernanceVersion &&
    manifest.collectionGovernanceVersion !== COLLECTION_GOVERNANCE_VERSION
  ) return null;
  if (Number(manifest?.summary?.failures || 0) !== 0) return null;
  if (Number(manifest?.summary?.guessedAssignments || 0) !== 0) return null;

  const classifications = asArray(manifest?.classifications);
  const tagTasks = asArray(manifest?.tagTasks);
  if (!classifications.length || classifications.length !== tagTasks.length) return null;

  const tagTaskByHandle = new Map(tagTasks.map((task) => [
    normalizeCollectionHandle(task?.handle),
    task,
  ]));
  const byHandle = new Map();
  for (const classification of classifications) {
    const handle = normalizeCollectionHandle(classification?.handle);
    const tagTask = tagTaskByHandle.get(handle);
    if (
      !handle ||
      !classification?.ruleId ||
      !tagTask ||
      !Array.isArray(tagTask.desiredManagedTags) ||
      byHandle.has(handle)
    ) return null;
    byHandle.set(handle, { classification, tagTask });
  }

  return {
    completedAt: manifest.completedAt,
    byHandle,
    legacyVersionMetadata: !manifest.taxonomyVersion || !manifest.collectionGovernanceVersion,
  };
}

async function verifyCollectionApproval() {
  const approval = await readJson(collectionApprovalPath);
  const approvalId = normalizeText(approval?.approvalId);
  if (approval?.approved !== true || !approvalId) throw new Error("Full-catalog collection approval is missing or not approved.");
  if (approval.taxonomyVersion !== CATALOG_TAXONOMY_VERSION) throw new Error("Collection approval targets a different taxonomy version.");
  if (approval.governanceVersion !== COLLECTION_GOVERNANCE_VERSION) throw new Error("Collection approval targets a different governance version.");
  if (approval?.scope?.managedCollections !== "create or repair only canonical collections in the checked-in full-catalog governance registry") {
    throw new Error("Collection approval does not restrict writes to the checked-in governance registry.");
  }
  if (approval?.scope?.controlledRuleTags !== "exactly one canonical simple collection tag condition per semantic collection, except approved union rules for gifts and trending-finds") {
    throw new Error("Collection approval does not require exact semantic collection tag conditions.");
  }
  if (approval?.scope?.existingTags !== "preserve unmanaged tags exactly; exact-replace checked-in canonical managed tags") {
    throw new Error("Collection approval does not preserve unmanaged product tags.");
  }
  if (approval?.scope?.legacyMergesOrArchives !== "not approved") throw new Error("Collection merges or archives are not forbidden by approval.");
  if (approval?.scope?.collectionlessProducts !== "forbidden; every active product must be verified in at least one live collection") {
    throw new Error("Collection approval does not forbid collectionless active products.");
  }
  if (process.env.SALT_CATALOG_COLLECTIONS_APPROVED !== "1") {
    throw new Error("Set SALT_CATALOG_COLLECTIONS_APPROVED=1 only for the approved full-catalog collection run.");
  }
  if (normalizeText(process.env.SALT_CATALOG_COLLECTIONS_APPROVAL_ID) !== approvalId) {
    throw new Error("SALT_CATALOG_COLLECTIONS_APPROVAL_ID does not match the collection approval manifest.");
  }
  return approvalId;
}

async function writeManifest(path, manifest) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function completeVariants(product, retryInfo) {
  const nodes = [...asArray(product?.variants?.nodes)];
  let after = product?.variants?.pageInfo?.endCursor || null;
  while (product?.variants?.pageInfo?.hasNextPage) {
    const data = await client.run(PRODUCT_VARIANTS_QUERY, { id: product.id, first: 250, after }, {
      operation: `variant continuation ${product.handle}`,
      retryInfo,
    });
    const connection = data?.node?.variants;
    if (!connection) throw new Error(`No variant continuation returned for ${product.handle}.`);
    nodes.push(...asArray(connection.nodes));
    product = { ...product, variants: connection };
    if (!connection.pageInfo?.hasNextPage) break;
    after = connection.pageInfo?.endCursor;
    if (!after) throw new Error(`Variant continuation for ${product.handle} has no cursor.`);
  }
  return { ...product, variants: { nodes, pageInfo: { hasNextPage: false, endCursor: after } } };
}

async function fetchActiveProducts(retryInfo) {
  const products = [];
  let after = null;
  let page = 0;
  while (true) {
    page += 1;
    const data = await client.run(PRODUCTS_QUERY, { first: 250, after, query: "status:active" }, {
      operation: `catalog integrity product page ${page}`,
      retryInfo,
    });
    const connection = data?.products;
    if (!connection) throw new Error("Shopify returned no active product connection.");
    for (const product of asArray(connection.nodes)) {
      products.push(product?.variants?.pageInfo?.hasNextPage ? await completeVariants(product, retryInfo) : product);
    }
    process.stdout.write(`Catalog integrity fetched ${products.length} active products.\n`);
    if (!connection.pageInfo?.hasNextPage) break;
    after = connection.pageInfo?.endCursor;
    if (!after) throw new Error("Active product pagination has no cursor.");
  }
  return products;
}

async function fetchCollections(retryInfo) {
  const collections = [];
  let after = null;
  while (true) {
    const data = await client.run(COLLECTIONS_QUERY, { first: 250, after }, {
      operation: `catalog integrity collection page ${collections.length / 250 + 1}`,
      retryInfo,
    });
    const connection = data?.collections;
    if (!connection) throw new Error("Shopify returned no collection connection.");
    collections.push(...asArray(connection.nodes));
    if (!connection.pageInfo?.hasNextPage) break;
    after = connection.pageInfo?.endCursor;
    if (!after) throw new Error("Collection pagination has no cursor.");
  }
  return collections;
}

async function fetchPublications(retryInfo) {
  const publications = [];
  let after = null;
  while (true) {
    const data = await client.run(PUBLICATIONS_QUERY, { first: 250, after }, {
      operation: "catalog integrity publication page",
      retryInfo,
    });
    const connection = data?.publications;
    if (!connection) throw new Error("Shopify returned no publication connection.");
    publications.push(...asArray(connection.nodes));
    if (!connection.pageInfo?.hasNextPage) break;
    after = connection.pageInfo?.endCursor;
    if (!after) throw new Error("Publication pagination has no cursor.");
  }
  return publications;
}

function localProductByHandle(catalog) {
  return new Map(asArray(catalog?.products).map((product) => [normalizeCollectionHandle(product?.handle), product]));
}

function mergeProduct(localProduct, liveProduct) {
  const images = asArray(liveProduct?.media?.nodes)
    .filter((media) => media?.__typename === "MediaImage" && media?.image?.url)
    .map((media) => ({ id: numericId(media.id), src: media.image.url, alt: media.alt || "" }));
  return {
    ...localProduct,
    id: numericId(liveProduct.id),
    shopifyId: liveProduct.id,
    handle: liveProduct.handle,
    title: localProduct?.title || liveProduct.title,
    body_html: localProduct?.body_html || liveProduct.descriptionHtml || "",
    product_type: localProduct?.product_type || liveProduct.productType || "",
    vendor: localProduct?.vendor || liveProduct.vendor || "",
    status: liveProduct.status,
    // Managed canonical tags are outputs, not evidence. Excluding them avoids
    // a prior wrong collection tag forcing a model conflict on the next run;
    // unmanaged merchant tags remain available as supporting evidence.
    tags: uniqueTags([...asArray(localProduct?.tags), ...asArray(liveProduct.tags)])
      .filter((tag) => !isManagedTaxonomyEvidenceTag(tag)),
    liveTags: asArray(liveProduct.tags),
    created_at: localProduct?.created_at || liveProduct.createdAt,
    updated_at: liveProduct.updatedAt,
    images: images.length ? images : asArray(localProduct?.images),
    variants: asArray(liveProduct?.variants?.nodes),
  };
}

function taxonomyTokens(definition) {
  return new Set(tokenizeCatalogText([
    definition.canonicalType,
    ...asArray(definition.terms),
    ...asArray(definition.aliases),
  ].join(" ")));
}

const TAXONOMY_DEFINITIONS = getCatalogTaxonomyDefinitions();
const TAXONOMY_TOKEN_INDEX = TAXONOMY_DEFINITIONS.map((definition) => ({
  definition,
  tokens: taxonomyTokens(definition),
}));

// Canonical taxonomy tags are outputs, not evidence. Keep the full governed
// universe here so a stale type/category tag such as `toy` cannot force a
// product back into an obsolete classification on the next reconciliation.
const CANONICAL_TAXONOMY_TAGS = new Set();
function addCanonicalTaxonomyTag(namespace, value) {
  if (!value) return;
  try {
    CANONICAL_TAXONOMY_TAGS.add(normalizeTag(simpleCatalogTag(namespace, value)));
  } catch {
    // Ignore malformed optional taxonomy metadata; the checked-in taxonomy
    // remains the source of truth for valid managed tags.
  }
}
for (const definition of TAXONOMY_DEFINITIONS) {
  addCanonicalTaxonomyTag("department", definition.departmentId);
  addCanonicalTaxonomyTag("category", definition.categoryId);
  addCanonicalTaxonomyTag("type", definition.canonicalType);
  for (const related of asArray(definition.relatedCategories)) {
    addCanonicalTaxonomyTag("department", related?.departmentId);
    addCanonicalTaxonomyTag("category", related?.categoryId);
  }
  addCanonicalTaxonomyTag("classification-rule", definition.id);
}
for (const audience of ["women", "men", "kids", "baby", "pets"]) {
  addCanonicalTaxonomyTag("audience", audience);
}
for (const feature of ["wireless", "rechargeable", "portable", "waterproof", "foldable", "adjustable", "led", "smart", "bluetooth", "insulated"]) {
  addCanonicalTaxonomyTag("feature", feature);
}
for (const compatibility of ["iphone", "android", "airpods", "ipad", "laptop", "macbook", "samsung", "usb c", "type c"]) {
  addCanonicalTaxonomyTag("compatibility", compatibility);
}
for (const policy of [...PRICE_COLLECTION_POLICIES, ...SEMANTIC_COLLECTION_POLICIES]) {
  CANONICAL_TAXONOMY_TAGS.add(normalizeTag(policy.tag));
}
for (const handle of [
  "best-sellers", "staff-picks", "new-arrivals", "trending-finds", "gifts",
  "gifts-for-dad", "gifts-for-mom", "gifts-for-seniors", "housewarming-gifts",
  ...Object.keys(SPECIAL_COLLECTION_MINIMUMS),
]) {
  CANONICAL_TAXONOMY_TAGS.add(normalizeTag(handle));
}

function isManagedTaxonomyEvidenceTag(tag) {
  const normalized = normalizeTag(tag);
  return isManagedTag(normalized) || CANONICAL_TAXONOMY_TAGS.has(normalized);
}

function lexicalBestRule(product, visualText = "") {
  const direct = normalizeCatalogText([
    visualText,
    product?.title,
    product?.handle,
    product?.product_type,
  ].filter(Boolean).join(" "));
  const tokens = new Set(tokenizeCatalogText(direct));
  const ranked = TAXONOMY_TOKEN_INDEX.map(({ definition, tokens: ruleTokens }) => {
    let score = 0;
    for (const token of tokens) if (ruleTokens.has(token)) score += token.length >= 8 ? 4 : token.length >= 5 ? 2 : 1;
    if (asArray(definition.terms).some((term) => direct.includes(normalizeCatalogText(term)))) score += 20;
    if (direct.includes(normalizeCatalogText(definition.canonicalType))) score += 15;
    if (definition.generic) score -= 3;
    return { ruleId: definition.id, score };
  }).sort((left, right) => right.score - left.score || left.ruleId.localeCompare(right.ruleId));
  return ranked[0]?.score > 0 ? ranked[0] : { ruleId: "fashion-general", score: 0 };
}

function firstImageUrl(product) {
  return asArray(product?.images).map((image) => image?.src || image?.url || "").find(Boolean) || "";
}

function productImageUrls(product) {
  return [...new Set(asArray(product?.images)
    .map((image) => typeof image === "string" ? image : image?.src || image?.url || "")
    .map(normalizeText)
    .filter(Boolean))];
}

function resizeImageUrl(url) {
  try {
    const parsed = new URL(url);
    if (/cdn\.shopify\.com$/i.test(parsed.hostname) || /shopifycdn\.net$/i.test(parsed.hostname)) {
      parsed.searchParams.set("width", "384");
      return parsed.toString();
    }
  } catch {
    // imageAsBase64 reports malformed source URLs with the product context.
  }
  return url;
}

function visionImageCandidates(url) {
  const resized = resizeImageUrl(url);
  return [...new Set([resized, url].filter(Boolean))];
}

function parseVisionJson(rawContent) {
  const raw = String(rawContent || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

const inFlightImageFetches = new Map();

async function imageAsBase64(url) {
  const cacheKey = resizeImageUrl(url);
  if (inFlightImageFetches.has(cacheKey)) return inFlightImageFetches.get(cacheKey);
  const promise = (async () => {
  let lastError = null;
  for (let attempt = 1; attempt <= visionImageAttempts; attempt += 1) {
    for (const candidate of visionImageCandidates(url)) {
      try {
        const response = await fetch(candidate, {
          headers: {
            Accept: "image/avif,image/webp,image/jpeg,image/png,*/*",
            "User-Agent": "Future-Light-Store-supervised-vision/1.0",
          },
          signal: AbortSignal.timeout(visionImageTimeoutMs),
        });
        if (!response.ok) throw new Error(`image HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        if (!bytes.byteLength) throw new Error("image response was empty");
        return Buffer.from(bytes).toString("base64");
      } catch (error) {
        lastError = error;
      }
    }
    if (attempt < visionImageAttempts) await sleep(visionImageRetryDelayMs * attempt);
  }
  throw lastError || new Error("image fetch failed");
  })();
  inFlightImageFetches.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    inFlightImageFetches.delete(cacheKey);
  }
}

function classifyVisionEvidence(product, content, imageUrl = null, imageUrls = []) {
  const evidenceConfidence = Number(content?.evidenceConfidence);
  const imageAgreement = Number(content?.imageAgreement);
  const ambiguity = normalizeText(content?.ambiguity);
  const hasAmbiguity = ambiguity && !/^(none|no ambiguity|no apparent ambiguity|not applicable|n\/a|low(?:\s|[-:])|minimal(?:\s|[-:])|minor(?:\s|[-:])|negligible(?:\s|[-:]))/i.test(ambiguity);
  const visualText = [content?.productName, content?.productCategory, ...asArray(content?.visibleAttributes)]
    .map(normalizeText).filter(Boolean).join(" ");
  if (!visualText || !Number.isFinite(evidenceConfidence) || !Number.isFinite(imageAgreement)) {
    return { error: "Supervised vision returned incomplete confidence evidence.", imageUrl, imageUrls, visualEvidence: content };
  }
  if (evidenceConfidence < 78 || imageAgreement < 78 || hasAmbiguity) {
    return {
      error: `Supervised vision evidence held for review (confidence ${evidenceConfidence}, agreement ${imageAgreement}, ambiguity ${ambiguity || "none reported"}).`,
      imageUrl,
      imageUrls,
      visualEvidence: content,
    };
  }
  const visualProduct = {
    ...product,
    title: visualText,
    handle: "",
    body_html: "",
    product_type: content?.productCategory || "",
    tags: [],
  };
  const visualClassification = classifyCatalogTaxonomyWithoutOverrides(visualProduct);
  if (visualClassification.ruleId === "unclassified") {
    return {
      error: "Visual evidence did not satisfy a checked-in taxonomy rule (unclassified)",
      imageUrl,
      imageUrls,
      visualEvidence: content,
      suggestedRuleId: lexicalBestRule(product, visualText).ruleId,
    };
  }
  const bestRule = visualClassification.ruleId;
  const visionAlignment = assessVisionTaxonomyAlignment(product, bestRule);
  if (!visionAlignment.accepted) {
    process.stdout.write(`Vision enrichment rejected for ${product.handle}: ${visionAlignment.reason}\n`);
    return {
      error: visionAlignment.reason,
      imageUrl,
      imageUrls,
      visualEvidence: content,
      visionAlignment,
      rejectedRuleId: bestRule,
      suggestedRuleId: lexicalBestRule(product).ruleId,
    };
  }
  const taxonomy = classifyCatalogTaxonomyByRuleId(product, bestRule, {
    source: "local-vision",
    reason: `Local ${visionModel} image evidence: ${normalizeText(content?.rationale)}`,
  });
  process.stdout.write(`Supervised vision enrichment completed for ${product.handle}: ${bestRule}.\n`);
  return {
    knowledge: buildProductKnowledgeFromTaxonomy(product, taxonomy),
    source: "vision",
    imageUrl,
    imageUrls,
    visualEvidence: { ...content, evidenceConfidence, imageAgreement },
    visionAlignment,
  };
}

async function classifyWithVision(product) {
  const imageUrls = productImageUrls(product).slice(0, visionImageLimit);
  const imageUrl = imageUrls[0] || "";
  if (!imageUrls.length) return null;
  try {
    process.stdout.write(`Supervised vision enrichment started for ${product.handle} (${imageUrls.length} image(s)).\n`);
    const images = await Promise.all(imageUrls.map((url) => imageAsBase64(resizeImageUrl(url))));
    const requestBody = JSON.stringify({
        model: visionModel,
        stream: false,
        format: {
          type: "object",
          properties: {
            productName: { type: "string" },
            productCategory: { type: "string" },
            visibleAttributes: { type: "array", items: { type: "string" } },
            rationale: { type: "string" },
            evidenceConfidence: { type: "integer", minimum: 0, maximum: 100 },
            imageAgreement: { type: "integer", minimum: 0, maximum: 100 },
            ambiguity: { type: "string" },
          },
          required: ["productName", "productCategory", "visibleAttributes", "rationale", "evidenceConfidence", "imageAgreement", "ambiguity"],
        },
        messages: [{
          role: "user",
          content: `Identify the exact retail product shown across all supplied images. Use only visible evidence and do not infer hidden properties. Supplier title: ${product.title}. Return a concrete product noun, retail category, up to four visible attributes, a short rationale, an evidence confidence from 0 to 100, an image-agreement score from 0 to 100, and a short ambiguity description.`,
          images,
        }],
        options: { temperature: 0, num_predict: visionOutputTokens },
        keep_alive: "10m",
      });
    let response = null;
    let requestError = null;
    for (let attempt = 1; attempt <= visionRequestAttempts; attempt += 1) {
      try {
        response = await fetch(`${ollamaUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(visionRequestTimeoutMs),
          body: requestBody,
        });
        if (response.ok) break;
        requestError = new Error(`Ollama HTTP ${response.status}`);
      } catch (error) {
        requestError = error;
      }
      if (attempt < visionRequestAttempts) await sleep(visionImageRetryDelayMs * attempt);
    }
    if (!response?.ok) throw requestError || new Error("Ollama vision request failed");
    const payload = await response.json();
    const content = parseVisionJson(payload?.message?.content) || {};
    return classifyVisionEvidence(product, content, imageUrl, imageUrls);
  } catch (error) {
    process.stdout.write(`Vision enrichment failed for ${product.handle}: ${normalizeText(error?.message || error)}.\n`);
    return { error: normalizeText(error?.message || error), imageUrl, imageUrls };
  }
}

async function mapWithConcurrency(items, concurrency, mapper, progressLabel = "Processed") {
  const results = new Array(items.length);
  let nextIndex = 0;
  let completed = 0;

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
      completed += 1;
      if (completed % 25 === 0 || completed === items.length) {
        process.stdout.write(`${progressLabel} ${completed}/${items.length} products.\n`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function resolveDeterministicKnowledge(product, knowledgeModel = null, modelEvidence = undefined) {
  const regularKnowledge = classifyProductKnowledge(product, { knowledgeModel, modelEvidence });
  if (!regularKnowledge.reviewRequired) {
    return {
      knowledge: regularKnowledge,
      source: regularKnowledge.override ? "approved-override" : "taxonomy",
    };
  }

  // A local vision runtime is valuable, but a missing Ollama daemon must not
  // turn an obvious title-and-handle-backed product into a permanently blocked
  // queue. Accept only direct evidence with a complete taxonomy path and the
  // single-evidence-lane warning; ambiguity and reliable model conflicts stay
  // review-held. This is evidence-backed classification, not a release guess.
  const taxonomy = classifyCatalogTaxonomy(product);
  const taxonomyReasons = new Set(taxonomy?.reviewReasons || []);
  const regularReasons = new Set(regularKnowledge.reviewReasons || []);
  const hasReliableModelConflict = [...regularReasons].some((reason) => String(reason).startsWith("Trained knowledge model disagrees"));
  const directFields = new Set(taxonomy?.evidence?.directFields || []);
  const directEvidence = directFields.has("title") || directFields.has("handle");
  const onlySingleLane = [...taxonomyReasons].every((reason) => reason === "single-evidence-lane");
  const completePath = Boolean(
    taxonomy?.departmentId &&
    taxonomy?.categoryId &&
    taxonomy?.subcategoryId &&
    taxonomy?.canonicalTypeId &&
    taxonomy?.shopifyCategory,
  );
  const evidenceFallbackAllowed = Boolean(
    !hasReliableModelConflict &&
    directEvidence &&
    completePath &&
    Number(taxonomy?.confidence || 0) >= 72 &&
    onlySingleLane,
  );
  if (evidenceFallbackAllowed) {
    const evidenceBackedTaxonomy = {
      ...taxonomy,
      reviewRequired: false,
      seoEligible: true,
      reviewReasons: [],
      evidence: {
        ...taxonomy.evidence,
        lanes: [...new Set([...(taxonomy.evidence?.lanes || []), "deterministic-direct-text"])],
      },
    };
    return {
      knowledge: buildProductKnowledgeFromTaxonomy(product, evidenceBackedTaxonomy, { knowledgeModel, modelEvidence }),
      source: "evidence-fallback",
      evidenceFallback: true,
      reason: "Strong direct title/handle evidence resolved the only remaining single-evidence-lane hold.",
    };
  }
  return null;
}

function resolveExistingVisionKnowledge(product, knowledgeModel = null) {
  const tags = asArray(product?.tags).map((tag) => normalizeTag(tag));
  const source = tags.find((tag) => tag === "classification-source-vision" || tag === "salt:classification-source:vision");
  if (!source) return null;
  const ruleTag = tags.find((tag) => tag.startsWith("classification-rule-") || tag.startsWith("salt:classification-rule:"));
  const ruleId = ruleTag?.startsWith("classification-rule-")
    ? ruleTag.slice("classification-rule-".length)
    : ruleTag?.slice("salt:classification-rule:".length) || "";
  if (!ruleId || !TAXONOMY_DEFINITIONS.some((definition) => definition.id === ruleId)) return null;

  // A handful of legacy listings contain only an anime franchise name in the
  // title and handle. Preserve their already verified vision classification
  // instead of replacing it with a lexical guess when no text classifier can
  // identify the physical product.
  const taxonomy = classifyCatalogTaxonomyByRuleId(product, ruleId, {
    source: "existing-vision",
    reason: "Preserved an existing verified vision classification because the current title and handle contain no physical product noun.",
  });
  return {
    knowledge: buildProductKnowledgeFromTaxonomy(product, taxonomy, { knowledgeModel }),
    source: "existing-vision",
    existingVision: true,
  };
}

async function resolveKnowledge(product, { skipVision, deterministicOnly, supervisedVision, knowledgeModel = null, modelEvidence = undefined, priorVisualEvidence = null }) {
  const directTaxonomy = classifyCatalogTaxonomyWithoutOverrides(product);
  const deterministic = resolveDeterministicKnowledge(product, knowledgeModel, modelEvidence);
  if (deterministic) return deterministic;

  const existingVision = resolveExistingVisionKnowledge(product, knowledgeModel);
  if (existingVision) return existingVision;

  if (deterministicOnly && !supervisedVision) {
    return {
      knowledge: classifyProductKnowledge(product, { knowledgeModel, modelEvidence }),
      source: "review",
      reviewReasons: ["Deterministic taxonomy did not reach a safe classification."],
    };
  }

  let vision = null;
  if (supervisedVision && (priorVisualEvidence || !skipVision)) {
    vision = priorVisualEvidence
      ? classifyVisionEvidence(product, priorVisualEvidence.visualEvidence, priorVisualEvidence.imageUrl, priorVisualEvidence.imageUrls)
      : await classifyWithVision(product);
    if (vision?.knowledge) return vision;
  }

  if (supervisedVision) {
    return {
      knowledge: classifyProductKnowledge(product, { knowledgeModel, modelEvidence }),
      source: "review",
      reviewReasons: [vision?.error || "Supervised vision did not meet the confidence and alignment gates."],
      imageUrl: vision?.imageUrl || null,
      imageUrls: vision?.imageUrls || [],
      visualEvidence: vision?.visualEvidence || null,
      visionAlignment: vision?.visionAlignment || null,
    };
  }

  const bestRule = directTaxonomy.ruleId !== "unclassified"
    ? directTaxonomy.ruleId
    : vision?.suggestedRuleId || lexicalBestRule(product).ruleId;
  const taxonomy = classifyCatalogTaxonomyByRuleId(product, bestRule, {
    source: "release-guess",
    reason: "Highest-scoring taxonomy rule published only because unresolved classification would otherwise block the release.",
  });
  return {
    knowledge: buildProductKnowledgeFromTaxonomy(product, taxonomy, { knowledgeModel, modelEvidence }),
    source: "guess",
    guessedRuleId: bestRule,
    imageUrl: vision?.imageUrl || null,
    visualEvidence: vision?.visualEvidence || null,
    visionAlignment: vision?.visionAlignment || null,
    visionError: vision?.error || null,
  };
}

function textIncludesAny(product, phrases) {
  const text = normalizeCatalogText([product?.title, product?.handle, product?.product_type].filter(Boolean).join(" "));
  return phrases.some((phrase) => ` ${text} `.includes(` ${normalizeCatalogText(phrase)} `));
}

async function buildDynamicAssignments(products) {
  const assignments = new Map(products.map((product) => [normalizeCollectionHandle(product.handle), new Set()]));
  const merchandisingProducts = products.map((product) => ({
    ...product,
    // Special/dynamic collections may intentionally use current canonical
    // tags; taxonomy evidence must not. Keep that concern isolated here.
    tags: product.liveTags || product.tags,
  }));
  for (const assignment of buildSpecialCollectionAssignments(merchandisingProducts)) {
    const set = assignments.get(normalizeCollectionHandle(assignment.handle));
    for (const handle of assignment.matchedCollections) set?.add(handle);
  }

  const recentOrders = await readJson(resolve(rootDir, "public", "data", "recently-ordered-products.json"), { products: [] });
  const bestSellerHandles = new Set(asArray(recentOrders?.products).map((product) => normalizeCollectionHandle(product?.handle)));
  const homeCollections = await readJson(resolve(rootDir, "public", "data", "home-collection-products.json"), { sections: {} });
  const staffHandles = new Set(asArray(homeCollections?.sections?.everydayEssentials?.products).map((product) => normalizeCollectionHandle(product?.handle)));
  const newestHandles = new Set([...products]
    .sort((left, right) => new Date(right.created_at || 0) - new Date(left.created_at || 0))
    .slice(0, 250)
    .map((product) => normalizeCollectionHandle(product.handle)));
  const newCutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;

  for (const product of products) {
    const handle = normalizeCollectionHandle(product.handle);
    const set = assignments.get(handle);
    if (!set) continue;
    if (bestSellerHandles.has(handle)) set.add("best-sellers");
    if (staffHandles.has(handle)) set.add("staff-picks");
    if (new Date(product.created_at || 0).getTime() >= newCutoff) set.add("new-arrivals");
    if (bestSellerHandles.has(handle) || staffHandles.has(handle) || newestHandles.has(handle) || textIncludesAny(product, ["viral", "trending", "tiktok"])) set.add("trending-finds");
    const normalizedTags = new Set(asArray(product.liveTags || product.tags).map((tag) => normalizeCollectionHandle(tag)));
    if (normalizedTags.has("holiday-gifts")) set.add("gifts");
    if (normalizedTags.has("viral-tiktok-products")) set.add("trending-finds");
    if (textIncludesAny(product, ["gift for dad", "fathers day", "father gift"])) set.add("gifts-for-dad");
    if (textIncludesAny(product, ["gift for mom", "mothers day", "mother gift"])) set.add("gifts-for-mom");
    if (textIncludesAny(product, ["gift for senior", "elderly gift", "senior gift"])) set.add("gifts-for-seniors");
    if (textIncludesAny(product, ["housewarming gift", "new home gift"])) set.add("housewarming-gifts");
    if (textIncludesAny(product, ["holiday gift", "christmas gift", "festive gift"])) set.add("gifts");
  }
  return assignments;
}

function exactTagTask(liveProduct, desiredManagedTags, managedTagUniverse = new Set()) {
  const existing = uniqueTags(asArray(liveProduct.tags));
  const unmanaged = existing.filter((tag) => !isManagedTag(tag, managedTagUniverse));
  const desired = uniqueTags([...unmanaged, ...desiredManagedTags]);
  const existingSet = new Set(existing.map(normalizeTag));
  const desiredSet = new Set(desired.map(normalizeTag));
  const tagsToAdd = desired.filter((tag) => !existingSet.has(normalizeTag(tag)));
  const tagsToRemove = existing.filter((tag) => !desiredSet.has(normalizeTag(tag)));
  return {
    productId: liveProduct.id,
    handle: liveProduct.handle,
    desiredTags: desired,
    desiredManagedTags: uniqueTags(desiredManagedTags),
    tagsToAdd,
    tagsToRemove,
    status: tagsToAdd.length || tagsToRemove.length ? "would-update" : "exact-match",
  };
}

async function uploadBulkInput(inputPath, retryInfo, label) {
  const data = await client.run(STAGED_UPLOAD_CREATE_MUTATION, {
    input: [{
      resource: "BULK_MUTATION_VARIABLES",
      filename: basename(inputPath),
      mimeType: "text/jsonl",
      httpMethod: "POST",
    }],
  }, { allowMutations: true, operation: `${label} staged upload reservation`, retryInfo });
  const errors = asArray(data?.stagedUploadsCreate?.userErrors);
  if (errors.length) throw new Error(`${label} staged upload failed: ${formatUserErrors(errors)}`);
  const target = data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target?.url) throw new Error(`Shopify returned no ${label} staged upload target.`);
  const curlArgs = ["-sS", "-X", "POST", target.url];
  for (const parameter of asArray(target.parameters)) curlArgs.push("-F", `${parameter.name}=${parameter.value}`);
  curlArgs.push("-F", `file=@${inputPath};type=text/jsonl`);
  await execFileAsync("curl", curlArgs, { cwd: rootDir, maxBuffer: 20 * 1024 * 1024 });
  const stagedUploadPath = asArray(target.parameters).find((parameter) => parameter.name === "key")?.value;
  if (!stagedUploadPath) throw new Error(`Shopify ${label} staged upload target did not include a key.`);
  return stagedUploadPath;
}

async function waitForBulkOperation(operationId, retryInfo, label) {
  while (true) {
    const data = await client.run(BULK_OPERATION_STATUS_QUERY, { id: operationId }, {
      operation: `${label} bulk operation status`,
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

async function verifyTagBulkResult(resultPath, actionable) {
  const lines = (await readFile(resultPath, "utf8")).split(/\r?\n/).filter(Boolean);
  const completedLines = new Set();
  for (const [fallbackIndex, line] of lines.entries()) {
    const payload = JSON.parse(line);
    const lineNumber = Number.isInteger(Number(payload.__lineNumber)) ? Number(payload.__lineNumber) : fallbackIndex;
    const task = actionable[lineNumber];
    if (!task) throw new Error(`Catalog tag bulk result returned unknown input line ${lineNumber}.`);
    if (asArray(payload?.errors).length) {
      throw new Error(`${task.handle}: ${asArray(payload.errors).map((error) => normalizeText(error?.message)).join(" | ")}`);
    }
    const response = payload?.data?.productUpdate;
    const errors = asArray(response?.userErrors);
    if (errors.length) throw new Error(`${task.handle}: ${formatUserErrors(errors)}`);
    if (!response?.product?.id) throw new Error(`${task.handle}: catalog tag bulk result returned no product id.`);
    task.status = "updated";
    completedLines.add(lineNumber);
  }
  if (completedLines.size !== actionable.length) {
    throw new Error(`Catalog tag bulk result covered ${completedLines.size}/${actionable.length} product inputs.`);
  }
}

async function applyExactTags(tasks, retryInfo, output, manifest) {
  const actionable = tasks.filter((task) => task.status === "would-update");
  if (!actionable.length) return;
  const inputPath = output.replace(/\.json$/i, "-tag-bulk-input.jsonl");
  const resultPath = output.replace(/\.json$/i, "-tag-bulk-result.jsonl");
  const lines = actionable.map((task) => JSON.stringify({
    product: { id: task.productId, tags: task.desiredTags },
  }));
  await writeFile(inputPath, `${lines.join("\n")}\n`, "utf8");
  process.stdout.write(`Prepared ${actionable.length} exact product tag updates for Shopify bulk mutation.\n`);
  const stagedUploadPath = await uploadBulkInput(inputPath, retryInfo, "catalog tag");
  const data = await client.run(BULK_OPERATION_RUN_MUTATION, {
    mutation: BULK_PRODUCT_TAG_MUTATION,
    stagedUploadPath,
  }, { allowMutations: true, operation: "start catalog tag bulk operation", retryInfo });
  const errors = asArray(data?.bulkOperationRunMutation?.userErrors);
  if (errors.length) throw new Error(`Catalog tag bulk operation failed to start: ${formatUserErrors(errors)}`);
  const operationId = data?.bulkOperationRunMutation?.bulkOperation?.id;
  if (!operationId) throw new Error("Shopify returned no catalog tag bulk operation id.");
  const operation = await waitForBulkOperation(operationId, retryInfo, "catalog tag");
  if (!operation.url) throw new Error("Completed catalog tag bulk operation returned no result URL.");
  await execFileAsync("curl", ["-sS", "-L", operation.url, "-o", resultPath], {
    cwd: rootDir,
    maxBuffer: 20 * 1024 * 1024,
  });
  await verifyTagBulkResult(resultPath, actionable);
  manifest.tagBulkOperation = {
    id: operation.id,
    status: operation.status,
    objectCount: Number(operation.objectCount || 0),
    completedAt: operation.completedAt || new Date().toISOString(),
    inputPath,
    resultPath,
  };
  await writeManifest(output, manifest);
  process.stdout.write(`Exact tags applied through Shopify bulk mutation to ${actionable.length} products.\n`);
}

async function verifyExactTags(tasks, retryInfo) {
  const failures = [];
  const taskById = new Map(tasks.map((task) => [task.productId, task]));
  const managedTagUniverse = new Set(tasks.flatMap((task) => task.desiredManagedTags).map(normalizeTag));
  const seen = new Set();
  let after = null;
  while (true) {
    const data = await client.run(ACTIVE_PRODUCT_TAGS_QUERY, { first: 250, after, query: "status:active" }, {
      operation: `exact tag readback page ${Math.floor(seen.size / 250) + 1}`,
      retryInfo,
    });
    const connection = data?.products;
    if (!connection) throw new Error("Shopify returned no active product tags for exact readback.");
    for (const product of asArray(connection.nodes)) {
      const task = taskById.get(product?.id);
      if (!task) {
        failures.push({ handle: product?.handle, unexpectedActiveProduct: true });
        continue;
      }
      seen.add(product.id);
      const actual = new Set(asArray(product.tags).map(normalizeTag).filter((tag) => isManagedTag(tag, managedTagUniverse)));
      const desired = new Set(task.desiredManagedTags.map(normalizeTag));
      const missing = [...desired].filter((tag) => !actual.has(tag));
      const extra = [...actual].filter((tag) => !desired.has(tag));
      if (missing.length || extra.length) failures.push({ handle: task.handle, missing, extra });
      else task.status = task.status === "exact-match" ? "exact-match-verified" : "updated-verified";
    }
    process.stdout.write(`Exact managed tags read back for ${seen.size}/${tasks.length} active products.\n`);
    if (!connection.pageInfo?.hasNextPage) break;
    after = connection.pageInfo?.endCursor;
    if (!after) throw new Error("Exact tag readback pagination has no cursor.");
  }
  for (const task of tasks) if (!seen.has(task.productId)) failures.push({ handle: task.handle, missingActiveProduct: true });
  if (failures.length) throw new Error(`${failures.length} products failed exact managed-tag readback.`);
}

function sourceConditionSummary(source) {
  const conditions = asArray(source?.inclusion?.conditions).map((condition) => {
    if (condition?.__typename === "CollectionSourceInclusionConditionProductTag") {
      return { type: "tag", relation: condition.relation, matchType: condition.matchType, values: asArray(condition.values).map(normalizeTag).sort() };
    }
    if (condition?.__typename === "CollectionSourceInclusionConditionVariantPrice") {
      return { type: "price", relation: condition.relation, amount: Number(condition?.value?.amount), currencyCode: condition?.value?.currencyCode };
    }
    return { type: condition?.__typename || "unknown" };
  });
  return { matchType: source?.inclusion?.matchType, targetType: source?.targetType, conditions };
}

function collectionSourceMatches(policy, collection) {
  const source = asArray(collection?.sources).length === 1 ? collection.sources[0] : null;
  if (!source || source.__typename !== "CollectionConditionsSource" || source.targetType !== "PRODUCTS") return false;
  const summary = sourceConditionSummary(source);
  if (policy.kind === "semantic") {
    const expectedTags = new Set(semanticCollectionRuleTags(policy).map(normalizeTag));
    const actualTags = new Set(summary.conditions
      .filter((condition) => condition.type === "tag" && condition.relation === "TAGGED_WITH" && condition.matchType === "ANY")
      .flatMap((condition) => condition.values));
    return summary.matchType === (expectedTags.size > 1 ? "ANY" : "ALL") &&
      actualTags.size === expectedTags.size && [...expectedTags].every((tag) => actualTags.has(tag));
  }
  if (policy.kind === "price") {
    if (summary.matchType !== "ALL") return false;
    const desired = [];
    if (Number.isFinite(policy.maximumExclusive)) desired.push({ relation: "LESS_THAN", amount: policy.maximumExclusive });
    if (Number.isFinite(policy.minimumExclusive)) desired.push({ relation: "GREATER_THAN", amount: policy.minimumExclusive });
    return summary.conditions.length === desired.length && desired.every((condition) =>
      summary.conditions.some((actual) => actual.type === "price" && actual.relation === condition.relation && actual.amount === condition.amount && actual.currencyCode === policy.currencyCode),
    );
  }
  return false;
}

function resolveCollectionTargets(collections) {
  const byHandle = new Map(collections.map((collection) => [normalizeCollectionHandle(collection.handle), collection]));
  const forcePriceCollectionRefresh = process.env.SALT_CATALOG_FORCE_PRICE_COLLECTION_REFRESH === "1";
  const forceCollectionSourceRefreshHandles = new Set(
    String(process.env.SALT_CATALOG_FORCE_COLLECTION_SOURCE_REFRESH_HANDLES || "")
      .split(",")
      .map(normalizeCollectionHandle)
      .filter(Boolean),
  );
  return [...PRICE_COLLECTION_POLICIES, ...SEMANTIC_COLLECTION_POLICIES].map((policy) => {
    const canonical = byHandle.get(policy.handle);
    const legacy = canonical ? null : policy.legacyHandles.map((handle) => byHandle.get(handle)).find(Boolean) || null;
    const existing = canonical || legacy;
    const metadataNeedsUpdate = Boolean(existing && (normalizeCollectionHandle(existing.handle) !== policy.handle || normalizeText(existing.title) !== policy.title));
    const sourceNeedsUpdate = Boolean(existing && (
      !collectionSourceMatches(policy, existing) ||
      (forcePriceCollectionRefresh && policy.kind === "price") ||
      forceCollectionSourceRefreshHandles.has(policy.handle)
    ));
    return {
      policy,
      existing,
      migratedFrom: legacy?.handle || null,
      metadataNeedsUpdate,
      sourceNeedsUpdate,
      action: existing ? (metadataNeedsUpdate || sourceNeedsUpdate ? "update" : "exact-match") : "create",
      status: "planned",
    };
  });
}

async function applyCollectionTarget(target, onlineStorePublication, retryInfo) {
  const source = target.policy.kind === "price" ? buildPriceCollectionSource(target.policy) : buildSemanticCollectionSource(target.policy);
  if (!target.existing) {
    const data = await client.run(COLLECTION_CREATE_MUTATION, {
      collection: { title: target.policy.title, handle: target.policy.handle, sources: [{ source }] },
    }, { allowMutations: true, operation: `create collection ${target.policy.handle}`, retryInfo });
    const errors = asArray(data?.collectionCreate?.userErrors);
    if (errors.length) throw new Error(`${target.policy.handle}: ${formatUserErrors(errors)}`);
    const collection = data?.collectionCreate?.collection;
    if (!collection?.id) throw new Error(`${target.policy.handle}: no collection returned after create.`);
    target.collectionId = collection.id;
    target.status = "created";
    if (onlineStorePublication?.id) {
      const publishData = await client.run(PUBLISH_MUTATION, { id: collection.id, input: [{ publicationId: onlineStorePublication.id }] }, {
        allowMutations: true,
        operation: `publish new collection ${target.policy.handle}`,
        retryInfo,
      });
      const publishErrors = asArray(publishData?.publishablePublish?.userErrors);
      if (publishErrors.length) throw new Error(`${target.policy.handle}: ${formatUserErrors(publishErrors)}`);
      target.status = "created-published";
    }
    return;
  }

  if (target.action !== "exact-match") throw new Error(`${target.policy.handle}: expected a bulk collection update.`);
  target.collectionId = target.existing.id;
  target.status = "exact-match";
}

function buildCollectionUpdateInput(target) {
  const source = target.policy.kind === "price"
    ? buildPriceCollectionSource(target.policy)
    : buildSemanticCollectionSource(target.policy);
  const input = { id: target.existing.id };
  if (normalizeText(target.existing.title) !== target.policy.title) input.title = target.policy.title;
  if (normalizeCollectionHandle(target.existing.handle) !== target.policy.handle) {
    input.handle = target.policy.handle;
    input.redirectNewHandle = true;
  }
  if (target.sourceNeedsUpdate) {
    const existingSources = asArray(target.existing.sources);
    const existingSource = existingSources.length === 1 ? existingSources[0] : null;
    const existingConditions = asArray(existingSource?.inclusion?.conditions);
    if (existingSource?.__typename === "CollectionConditionsSource" && existingSource.id) {
      if (existingSource.shareable === false) {
        // Non-shareable sources can retain stale automated memberships when updated in place.
        input.sourcesToDelete = [existingSource.id];
        input.sourcesToCreate = [{ source }];
      } else {
        input.sourcesToUpdate = [{
          condition: {
            id: existingSource.id,
            title: source.title,
            description: source.description,
            inclusion: {
              matchType: source.inclusion.matchType,
              conditionsToDelete: existingConditions.map((condition) => condition.id).filter(Boolean),
              conditionsToCreate: asArray(source.inclusion.conditions),
            },
          },
        }];
      }
    } else {
      input.sourcesToDelete = existingSources.map((existingSource) => existingSource.id).filter(Boolean);
      input.sourcesToCreate = [{ source }];
    }
  }
  return input;
}

async function verifyCollectionBulkResult(resultPath, updateTargets) {
  const lines = (await readFile(resultPath, "utf8")).split(/\r?\n/).filter(Boolean);
  const completedLines = new Set();
  for (const [fallbackIndex, line] of lines.entries()) {
    const payload = JSON.parse(line);
    const lineNumber = Number.isInteger(Number(payload.__lineNumber)) ? Number(payload.__lineNumber) : fallbackIndex;
    const target = updateTargets[lineNumber];
    if (!target) throw new Error(`Collection bulk result returned unknown input line ${lineNumber}.`);
    if (asArray(payload?.errors).length) {
      throw new Error(`${target.policy.handle}: ${asArray(payload.errors).map((error) => normalizeText(error?.message)).join(" | ")}`);
    }
    const response = payload?.data?.collectionUpdate;
    const errors = asArray(response?.userErrors);
    if (errors.length) throw new Error(`${target.policy.handle}: ${formatUserErrors(errors)}`);
    if (!response?.collection?.id) throw new Error(`${target.policy.handle}: collection bulk result returned no collection id.`);
    target.collectionId = response.collection.id;
    target.status = "updated";
    completedLines.add(lineNumber);
  }
  if (completedLines.size !== updateTargets.length) {
    throw new Error(`Collection bulk result covered ${completedLines.size}/${updateTargets.length} updates.`);
  }
}

async function applyCollectionTargets(targets, onlineStorePublication, retryInfo, output, manifest) {
  const updateTargets = targets.filter((target) => target.action === "update");
  const exactTargets = targets.filter((target) => target.action === "exact-match");
  const createTargets = targets.filter((target) => target.action === "create");
  for (const target of exactTargets) await applyCollectionTarget(target, onlineStorePublication, retryInfo);

  if (updateTargets.length) {
    const inputPath = output.replace(/\.json$/i, "-collection-bulk-input.jsonl");
    const resultPath = output.replace(/\.json$/i, "-collection-bulk-result.jsonl");
    await writeFile(inputPath, `${updateTargets.map((target) => JSON.stringify({
      collection: buildCollectionUpdateInput(target),
    })).join("\n")}\n`, "utf8");
    const stagedUploadPath = await uploadBulkInput(inputPath, retryInfo, "catalog collection");
    const data = await client.run(BULK_OPERATION_RUN_MUTATION, {
      mutation: BULK_COLLECTION_UPDATE_MUTATION,
      stagedUploadPath,
    }, { allowMutations: true, operation: "start catalog collection bulk operation", retryInfo });
    const errors = asArray(data?.bulkOperationRunMutation?.userErrors);
    if (errors.length) throw new Error(`Catalog collection bulk operation failed to start: ${formatUserErrors(errors)}`);
    const operationId = data?.bulkOperationRunMutation?.bulkOperation?.id;
    if (!operationId) throw new Error("Shopify returned no catalog collection bulk operation id.");
    const operation = await waitForBulkOperation(operationId, retryInfo, "catalog collection");
    if (!operation.url) throw new Error("Completed catalog collection bulk operation returned no result URL.");
    await execFileAsync("curl", ["-sS", "-L", operation.url, "-o", resultPath], {
      cwd: rootDir,
      maxBuffer: 20 * 1024 * 1024,
    });
    await verifyCollectionBulkResult(resultPath, updateTargets);
    manifest.collectionBulkOperation = {
      id: operation.id,
      status: operation.status,
      objectCount: Number(operation.objectCount || 0),
      completedAt: operation.completedAt || new Date().toISOString(),
      inputPath,
      resultPath,
    };
    await writeManifest(output, manifest);
    process.stdout.write(`Canonical collection repairs applied through Shopify bulk mutation to ${updateTargets.length} collections.\n`);
  }

  for (const target of createTargets) {
    await applyCollectionTarget(target, onlineStorePublication, retryInfo);
    await writeManifest(output, manifest);
  }
}

function compareSets(expected, actual) {
  return {
    missing: [...expected].filter((id) => !actual.has(id)),
    extra: [...actual].filter((id) => !expected.has(id)),
  };
}

async function fetchCollectionMembershipBulk(retryInfo) {
  const started = await client.run(BULK_OPERATION_RUN_QUERY, { query: BULK_COLLECTION_MEMBERSHIP_QUERY }, {
    allowMutations: true,
    operation: "start exact collection membership export",
    retryInfo,
  });
  const errors = asArray(started?.bulkOperationRunQuery?.userErrors);
  if (errors.length) throw new Error(`Collection membership export failed to start: ${formatUserErrors(errors)}`);
  const operationId = started?.bulkOperationRunQuery?.bulkOperation?.id;
  if (!operationId) throw new Error("Shopify returned no collection membership export id.");
  const operation = await waitForBulkOperation(operationId, retryInfo, "collection membership export");
  if (!operation.url) throw new Error("Completed collection membership export returned no result URL.");
  const response = await fetch(operation.url);
  if (!response.ok) throw new Error(`Collection membership export download failed (${response.status}).`);
  const collections = [];
  const membersByCollectionId = new Map();
  for (const line of (await response.text()).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const node = JSON.parse(line);
    if (node.__parentId) {
      if (!membersByCollectionId.has(node.__parentId)) membersByCollectionId.set(node.__parentId, new Set());
      if (node.id) membersByCollectionId.get(node.__parentId).add(node.id);
      continue;
    }
    if (!node.id || !node.handle) continue;
    collections.push(node);
    if (!membersByCollectionId.has(node.id)) membersByCollectionId.set(node.id, new Set());
  }
  process.stdout.write(`Collection membership export read ${collections.length} collections and ${[...membersByCollectionId.values()].reduce((sum, members) => sum + members.size, 0)} memberships.\n`);
  return { collections, membersByCollectionId, operation };
}

async function verifyCollectionMembership({ targets, products, tagTasks, retryInfo }) {
  const membership = await fetchCollectionMembershipBulk(retryInfo);
  const liveCollections = membership.collections;
  const byHandle = new Map(liveCollections.map((collection) => [normalizeCollectionHandle(collection.handle), collection]));
  const expectedByTag = new Map(SEMANTIC_COLLECTION_POLICIES.map((policy) => [normalizeTag(policy.tag), new Set()]));
  const taskByProductId = new Map(tagTasks.map((task) => [task.productId, task]));
  const expectedCollectionsByProduct = new Map(products.map((product) => [product.id, new Set([ALL_PRODUCTS_COLLECTION_POLICY.handle])]));
  for (const product of products) {
    const task = taskByProductId.get(product.id);
    for (const tag of task?.desiredManagedTags || []) {
      expectedByTag.get(normalizeTag(tag))?.add(product.id);
      const handle = isManagedCollectionTag(tag) ? canonicalCollectionHandle(tag) : "";
      if (handle) expectedCollectionsByProduct.get(product.id)?.add(handle);
    }
    for (const target of targets) {
      if (target.policy.kind === "price" && productMatchesPricePolicy(product, target.policy)) {
        expectedCollectionsByProduct.get(product.id)?.add(target.policy.handle);
      }
    }
  }

  const failures = [];
  const actualMembershipByProduct = new Map(products.map((product) => [product.id, new Set()]));
  for (const target of targets) {
    const collection = byHandle.get(target.policy.handle);
    const issues = [];
    if (!collection) issues.push("canonical collection missing");
    else if (!collectionSourceMatches(target.policy, collection)) issues.push("source mismatch");
    let expected = new Set();
    let actual = new Set();
    if (collection) {
      actual = membership.membersByCollectionId.get(collection.id) || new Set();
      if (target.policy.kind === "semantic") expected = expectedByTag.get(normalizeTag(target.policy.tag)) || new Set();
      else expected = new Set(products.filter((product) => productMatchesPricePolicy(product, target.policy)).map((product) => product.id));
      const difference = compareSets(expected, actual);
      if (difference.missing.length) issues.push(`${difference.missing.length} missing products`);
      if (difference.extra.length) issues.push(`${difference.extra.length} extra products`);
      for (const id of actual) actualMembershipByProduct.get(id)?.add(target.policy.handle);
      target.readback = {
        expectedCount: expected.size,
        actualCount: actual.size,
        missingProductIds: difference.missing.slice(0, 100),
        extraProductIds: difference.extra.slice(0, 100),
        source: sourceConditionSummary(collection.sources?.[0]),
        ok: issues.length === 0,
        issues,
      };
    }
    if (issues.length) failures.push(`${target.policy.handle}: ${issues.join(", ")}`);
  }

  const expectedLiveHandles = new Set([
    ALL_PRODUCTS_COLLECTION_POLICY.handle,
    ...targets.map((target) => target.policy.handle),
  ]);
  const unexpectedLiveCollections = [...byHandle.keys()].filter(
    (handle) => !expectedLiveHandles.has(handle) && !Object.prototype.hasOwnProperty.call(RETIRED_COLLECTION_HANDLE_MAP, handle),
  );
  if (unexpectedLiveCollections.length) {
    failures.push(`live collections outside canonical governance: ${unexpectedLiveCollections.join(", ")}`);
  }

  const allProductsCollection = byHandle.get(ALL_PRODUCTS_COLLECTION_POLICY.handle);
  if (!allProductsCollection) failures.push("all-products: collection missing");
  else {
    const members = membership.membersByCollectionId.get(allProductsCollection.id) || new Set();
    const expectedMembers = new Set(products.map((product) => product.id));
    const actualCount = Number(allProductsCollection.productsCount?.count || 0);
    if (actualCount !== expectedMembers.size) {
      failures.push(`all-products: count ${actualCount}/${expectedMembers.size}`);
    }
    // Shopify's bulk collection export truncates large product connections,
    // so use the smart collection's authoritative productsCount for this
    // catalog-boundary collection instead of the partial member edge list.
    if (actualCount === expectedMembers.size) {
      for (const id of expectedMembers) actualMembershipByProduct.get(id)?.add(ALL_PRODUCTS_COLLECTION_POLICY.handle);
    } else {
      for (const id of members) actualMembershipByProduct.get(id)?.add(ALL_PRODUCTS_COLLECTION_POLICY.handle);
    }
  }

  for (const product of products) {
    const expected = expectedCollectionsByProduct.get(product.id) || new Set();
    const actual = actualMembershipByProduct.get(product.id) || new Set();
    const difference = compareSets(expected, actual);
    if (difference.missing.length || difference.extra.length) {
      failures.push(`${product.handle}: wrong collection set (missing ${difference.missing.length}, extra ${difference.extra.length})`);
    }
  }

  const collectionless = [...actualMembershipByProduct.entries()].filter(([, handles]) => handles.size === 0).map(([id]) => id);
  if (collectionless.length) failures.push(`${collectionless.length} active products are collectionless`);
  return { failures, collectionless, liveCollections, bulkOperation: membership.operation };
}

async function run(args) {
  const applyDuringVerify = args.mode === "verify" &&
    args.reclassify &&
    process.env.SALT_CATALOG_INTEGRITY_VERIFY_APPLY === "1";
  const shouldApply = args.mode === "apply" || applyDuringVerify;
  if (args.supervisedVision && process.env.SALT_CATALOG_VISION_SUPERVISED !== "1") {
    throw new Error("--supervised-vision requires SALT_CATALOG_VISION_SUPERVISED=1; image evidence must be explicitly enabled by the release command.");
  }
  if (args.supervisedVision) {
    const visionRuntime = await ensureFutureLightVisionRuntime(rootDir);
    if (visionRuntime.available && visionRuntime.installed) {
      process.stdout.write(`Future Light local vision runtime ready: ${visionModel}.\n`);
    } else if (visionRuntime.available) {
      process.stdout.write(`Future Light local vision runtime is online but ${visionModel} is not installed; guarded deterministic evidence fallback remains enabled.\n`);
    } else {
      process.stdout.write(`Future Light local vision runtime unavailable (${visionRuntime.reason || "unknown reason"}); guarded deterministic evidence fallback remains enabled.\n`);
    }
  }
  if (shouldApply) await verifyCollectionApproval();
  const retryInfo = [];
  const priorManifestPath = args.output === defaultOutputPath ? args.output : defaultOutputPath;
  const priorManifest = await readJson(priorManifestPath);
  process.stdout.write("Catalog integrity: prior manifest loaded.\n");
  const knowledgeModel = await readCatalogKnowledgeModel({
    required: process.env.SALT_REQUIRE_KNOWLEDGE_MODEL === "1",
  });
  process.stdout.write("Catalog integrity: knowledge model/evidence loaded.\n");
  const priorSnapshot = buildPriorIntegritySnapshot(priorManifest);
  const catalog = await readProductCatalogPayload(resolve(rootDir, "public", "data"));
  process.stdout.write("Catalog integrity: local catalog loaded.\n");
  let liveProducts;
  let collections;
  let publications;
  if (args.useLiveCheckpoint) {
    process.stdout.write(`Catalog integrity: loading live checkpoint from ${liveInputCheckpointPath}.\n`);
    const checkpoint = await readJson(liveInputCheckpointPath);
    if (!checkpoint?.complete || !Array.isArray(checkpoint.liveProducts) || !Array.isArray(checkpoint.collections)) {
      throw new Error(`No complete catalog-integrity live checkpoint exists at ${liveInputCheckpointPath}`);
    }
    ({ liveProducts, collections, publications } = checkpoint);
    process.stdout.write(`Using dry-run live checkpoint with ${liveProducts.length} active products.\n`);
  } else {
    [liveProducts, collections, publications] = await Promise.all([
      fetchActiveProducts(retryInfo),
      fetchCollections(retryInfo),
      fetchPublications(retryInfo),
    ]);
    await writeManifest(liveInputCheckpointPath, {
      generatedAt: new Date().toISOString(),
      complete: true,
      liveProducts,
      collections,
      publications,
    });
  }
  assertCompleteCollectionGovernance(collections);
  const localByHandle = localProductByHandle(catalog);
  const products = liveProducts.map((liveProduct) => mergeProduct(localByHandle.get(normalizeCollectionHandle(liveProduct.handle)) || {}, liveProduct));
  const reviewHandles = new Set(
    priorSnapshot
      ? [...priorSnapshot.byHandle.entries()]
        .filter(([, entry]) => entry.classification?.source === "review")
        .map(([handle]) => handle)
      : [],
  );
  if (args.reviewOnly && !reviewHandles.size) {
    throw new Error("--review-only requires a completed prior manifest with review-held products.");
  }
  if (args.reviewOnly) {
    process.stdout.write(`Review-only retry cohort: ${reviewHandles.size} prior fallback products.\n`);
  }
  const visualEvidenceManifest = process.env.SALT_CATALOG_REUSE_VISUAL_EVIDENCE_MANIFEST
    ? await readJson(resolve(rootDir, process.env.SALT_CATALOG_REUSE_VISUAL_EVIDENCE_MANIFEST), null)
    : null;
  const visualEvidenceByHandle = new Map(
    asArray(visualEvidenceManifest?.classifications)
      .filter((entry) => entry?.handle && entry?.visualEvidence)
      .map((entry) => [normalizeCollectionHandle(entry.handle), entry]),
  );
  if (visualEvidenceByHandle.size) {
    process.stdout.write(`Reusing supervised visual evidence for ${visualEvidenceByHandle.size} products.\n`);
  }
  const canReusePriorManifest = args.mode === "verify" && Boolean(priorSnapshot) &&
    (!args.reclassify || args.reusePriorManifest);
  if (args.reusePriorManifest && (!args.reclassify || args.mode !== "verify")) {
    throw new Error("--reuse-prior-manifest is only allowed for a reclassifying verification.");
  }
  let modelEvidenceByKey = null;
  if (!canReusePriorManifest) {
    const evidenceProducts = args.reviewOnly
      ? products.filter((product) => reviewHandles.has(normalizeCollectionHandle(product.handle)))
      : products;
    try {
      modelEvidenceByKey = await scoreCatalogKnowledgeModelBatch(knowledgeModel, evidenceProducts);
    } catch (error) {
      modelEvidenceByKey = await readCurrentKnowledgeEvidence(evidenceProducts);
      if (!modelEvidenceByKey) throw error;
      process.stdout.write(`Using current-catalog knowledge evidence cache after model artifact read failure: ${error.message}\n`);
    }
    if (args.reviewOnly) {
      process.stdout.write(`Review-only knowledge scoring completed for ${evidenceProducts.length}/${products.length} products.\n`);
    }
  }
  if (modelEvidenceByKey) {
    process.stdout.write(`MLX/Metal knowledge scoring completed for ${modelEvidenceByKey.size}/${products.length} products.\n`);
  }
  const dynamicAssignments = await buildDynamicAssignments(products);
  const tagTasks = [];
  const resolvedTagPlans = [];
  const classifications = [];
  const resolvedProducts = new Array(products.length);
  const unresolvedProducts = [];
  const taxonomyBatchCount = Math.ceil(products.length / args.batchSize);
  for (let batchStart = 0; batchStart < products.length; batchStart += args.batchSize) {
    const batchEnd = Math.min(batchStart + args.batchSize, products.length);
    for (let index = batchStart; index < batchEnd; index += 1) {
      const product = products[index];
      const modelEvidence = modelEvidenceByKey?.get(String(product?.id || product?.handle || ""));
      const handle = normalizeCollectionHandle(product.handle);
      const prior = args.reviewOnly && !reviewHandles.has(handle)
        ? priorSnapshot?.byHandle.get(handle)
        : args.reclassify && !args.reusePriorManifest
        ? null
        : priorSnapshot?.byHandle.get(normalizeCollectionHandle(product.handle));
      if (args.reviewOnly && !reviewHandles.has(handle)) {
        if (!prior?.tagTask || !prior.classification?.ruleId) {
          throw new Error(`Review-only retry cannot preserve ${product.handle}: prior classification is missing.`);
        }
        resolvedProducts[index] = {
          knowledge: null,
          source: prior.classification.source,
          priorClassification: prior.classification,
          // Review-only mode must not reconcile products outside the retry cohort.
          // Carry every current tag through so the exact-tag planner is a true no-op.
          priorManagedTags: uniqueTags(asArray(product.tags)),
          priorCollectionTags: uniqueTags(
            prior.classification.collectionHandles.map((collectionHandle) => collectionTagForHandle(collectionHandle)),
          ),
          reused: true,
        };
        continue;
      }
      const canReusePriorTagPlan = Boolean(
        canReusePriorManifest &&
        prior?.tagTask &&
        Array.isArray(prior.tagTask.desiredManagedTags) &&
        Array.isArray(prior.classification?.collectionHandles) &&
        !(
          prior.tagTask.desiredManagedTags.some((tag) => ["women", "men"].includes(normalizeCollectionHandle(tag))) &&
          (() => {
            const currentTaxonomy = classifyCatalogTaxonomy(product);
            return currentTaxonomy?.familyId === "electronics" && currentTaxonomy?.audience?.id === "unisex";
          })()
        ),
      );
      if (canReusePriorTagPlan) {
        resolvedProducts[index] = {
          knowledge: null,
          source: prior.classification.source,
          priorClassification: prior.classification,
          priorManagedTags: uniqueTags(prior.tagTask.desiredManagedTags),
          priorCollectionTags: uniqueTags(
            prior.classification.collectionHandles.map((handle) => collectionTagForHandle(handle)),
          ),
          reused: true,
        };
        continue;
      }
      let deterministic = null;
      const priorRuleId = prior?.classification?.ruleId || "";
      const canReusePriorClassification = Boolean(
        prior && TAXONOMY_DEFINITIONS.some((definition) => definition.id === priorRuleId),
      );
      if (canReusePriorClassification) {
        const taxonomy = classifyCatalogTaxonomyByRuleId(product, prior.classification.ruleId, {
          source: `prior-catalog-integrity-${prior.classification.source || "verified"}`,
          reason: "Reused the last completed collection-integrity classification for an unchanged handle.",
        });
        deterministic = {
          // A non-reclassifying verification must compare against the last
          // applied classification, not reopen model conflicts on readback.
          knowledge: buildProductKnowledgeFromTaxonomy(product, taxonomy),
          source: prior.classification.source,
          priorClassification: prior.classification,
          reused: true,
        };
      } else {
        deterministic = resolveDeterministicKnowledge(product, knowledgeModel, modelEvidence);
      }
      if (deterministic) resolvedProducts[index] = deterministic;
      else unresolvedProducts.push({ index, product });
    }
    const batchNumber = Math.floor(batchStart / args.batchSize) + 1;
    if (batchNumber % 10 === 0 || batchNumber === taxonomyBatchCount) {
      process.stdout.write(`Taxonomy batches checked ${batchNumber}/${taxonomyBatchCount} (${batchEnd}/${products.length} products).\n`);
    }
  }
  process.stdout.write(`${unresolvedProducts.length} products require review${args.deterministicOnly ? "; deterministic-only mode will use the fallback collection" : " or release-boundary fallback"}.\n`);
  const resolutionBatchCount = Math.ceil(unresolvedProducts.length / args.batchSize);
  for (let batchStart = 0; batchStart < unresolvedProducts.length; batchStart += args.batchSize) {
    const batch = unresolvedProducts.slice(batchStart, batchStart + args.batchSize);
      const resolutions = await mapWithConcurrency(
      batch,
      classificationConcurrency,
      (entry) => resolveKnowledge(entry.product, {
        ...args,
        knowledgeModel,
        modelEvidence: modelEvidenceByKey?.get(String(entry.product?.id || entry.product?.handle || "")),
        priorVisualEvidence: visualEvidenceByHandle.get(normalizeCollectionHandle(entry.product?.handle)),
      }),
      args.deterministicOnly ? "Review resolution processed" : "Visual resolution processed",
    );
    for (const [index, entry] of batch.entries()) {
      resolvedProducts[entry.index] = resolutions[index];
    }
    const batchNumber = Math.floor(batchStart / args.batchSize) + 1;
    if (batchNumber % 10 === 0 || batchNumber === resolutionBatchCount) {
      process.stdout.write(`Resolution batches checked ${batchNumber}/${resolutionBatchCount}.\n`);
    }
  }

  for (const [index, product] of products.entries()) {
    const resolved = resolvedProducts[index];
    const dynamicHandles = dynamicAssignments.get(normalizeCollectionHandle(product.handle)) || new Set();
    const approvedSpecialTags = [...dynamicHandles]
      .filter((handle) => Object.prototype.hasOwnProperty.call(SPECIAL_COLLECTION_MINIMUMS, handle))
      .map((handle) => collectionTagForHandle(handle));
    const collectionTags = resolved.priorCollectionTags || (resolved.source === "review"
      ? uniqueTags([collectionTagForHandle("classification-review"), ...approvedSpecialTags])
      : buildProductCollectionTags(product, resolved.knowledge, dynamicHandles));
    if (!collectionTags.length) {
      throw new Error(`${product.handle} has no semantic collection assignment after classification ${resolved.knowledge?.classificationRule || resolved.priorClassification?.ruleId || "unknown"}.`);
    }
    const classificationTags = resolved.priorManagedTags ? [] : ["vision", "guess", "existing-vision", "evidence-fallback"].includes(resolved.source)
      ? [
        simpleCatalogTag("classification-rule", resolved.knowledge.classificationRule),
        simpleCatalogTag("classification-source", resolved.source === "existing-vision" ? "vision" : resolved.source),
      ]
      : [];
    const desiredManagedTags = resolved.priorManagedTags || (resolved.source === "review"
      ? collectionTags
      : uniqueTags([
        ...asArray(resolved.knowledge.proposedTags),
        ...collectionTags,
        ...classificationTags,
      ]));
    resolvedTagPlans.push({ liveProduct: liveProducts[index], desiredManagedTags });
    classifications.push({
      productId: product.shopifyId,
      handle: product.handle,
      ruleId: resolved.knowledge?.classificationRule || resolved.priorClassification?.ruleId || "unclassified",
      source: resolved.source,
      confidence: resolved.knowledge?.confidence ?? resolved.priorClassification?.confidence ?? 0,
      collectionHandles: collectionTags.map((tag) => normalizeCollectionHandle(tag)),
      reused: Boolean(resolved.reused),
      imageUrl: resolved.imageUrl || resolved.priorClassification?.imageUrl || null,
      imageUrls: resolved.imageUrls || resolved.priorClassification?.imageUrls || [],
      visualEvidence: resolved.visualEvidence || resolved.priorClassification?.visualEvidence || null,
      visionAlignment: resolved.visionAlignment || resolved.priorClassification?.visionAlignment || null,
      guessedRuleId: resolved.guessedRuleId || resolved.priorClassification?.guessedRuleId || null,
      visionError: resolved.visionError || resolved.priorClassification?.visionError || null,
      evidenceFallback: Boolean(resolved.evidenceFallback || resolved.priorClassification?.evidenceFallback),
    });
  }

  const managedTagUniverse = new Set(resolvedTagPlans.flatMap((entry) => entry.desiredManagedTags).map(normalizeTag));
  for (const entry of resolvedTagPlans) {
    tagTasks.push(exactTagTask(entry.liveProduct, entry.desiredManagedTags, managedTagUniverse));
  }

  const specialCollectionCounts = Object.fromEntries(
    Object.keys(SPECIAL_COLLECTION_MINIMUMS).map((handle) => [
      handle,
      tagTasks.filter((task) => task.desiredManagedTags.includes(collectionTagForHandle(handle))).length,
    ]),
  );
  assertSpecialCollectionMinimums(specialCollectionCounts);

  const targets = resolveCollectionTargets(collections);
  const visualReviewQueue = classifications
    .filter((entry) => entry.source === "review")
    .map((entry) => ({
      productId: entry.productId,
      handle: entry.handle,
      title: products.find((product) => product.handle === entry.handle)?.title || entry.handle,
      imageUrls: entry.imageUrls || [],
      reason: entry.visionError || "Visual classification decision required",
      visualEvidence: entry.visualEvidence || null,
      status: "pending",
    }));
  await writeFile(
    visualReviewQueuePath,
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      policy: "Every release must clear this queue before completion; unresolved items remain held in classification-review.",
      pending: visualReviewQueue.length,
      products: visualReviewQueue,
    }, null, 2)}\n`,
    "utf8",
  );
  const onlineStorePublication = publications.find((publication) => normalizeTag(publication?.name) === "online store") || null;
  const actionableTagTasks = tagTasks.filter((task) => task.status === "would-update");
  const manifest = {
    version: COLLECTION_GOVERNANCE_VERSION,
    taxonomyVersion: CATALOG_TAXONOMY_VERSION,
    collectionGovernanceVersion: COLLECTION_GOVERNANCE_VERSION,
    generatedAt: new Date().toISOString(),
    mode: args.mode,
    storeDomain: client.storeDomain,
    apiVersion: client.apiVersion,
    policy: {
      scope: "all active Shopify products and every live collection",
      managedTags: "exact-set replacement for taxonomy, collection, and classification namespaces",
      unmanagedTags: "preserved exactly",
      uncertainProducts: args.supervisedVision
        ? "supervised multi-image evidence only; confidence, agreement, taxonomy, and alignment gates; explicit classification-review fallback; no guesses"
        : args.deterministicOnly
          ? "deterministic-only; explicit classification-review fallback collection; no image classification or guesses"
          : "legacy local image enrichment path; full release guesses remain disabled",
      semanticCollectionRule: "one canonical simple collection tag condition per collection",
      priceCollections: "exact variant-price source plus exact live membership verification",
      collectionlessProducts: "forbidden",
      liveApplyDuringVerify: applyDuringVerify,
      stableClassification: "reuse the last completed valid classification rule for unchanged handles and recompute managed tags from current governance",
      auditBatchSize: args.batchSize,
    },
    summary: {
      activeProducts: products.length,
      liveCollectionsBefore: collections.length,
      governedCollections: targets.length + 1,
      semanticCollections: SEMANTIC_COLLECTION_POLICIES.length,
      priceCollections: PRICE_COLLECTION_POLICIES.length,
      productsNeedingTagChanges: actionableTagTasks.length,
      tagsToAdd: tagTasks.reduce((sum, task) => sum + task.tagsToAdd.length, 0),
      tagsToRemove: tagTasks.reduce((sum, task) => sum + task.tagsToRemove.length, 0),
      taxonomyClassified: classifications.filter((entry) => entry.source === "taxonomy").length,
      approvedOverrides: classifications.filter((entry) => entry.source === "approved-override").length,
      visionClassified: classifications.filter((entry) => entry.source === "vision").length,
      evidenceFallbackClassified: classifications.filter((entry) => entry.source === "evidence-fallback").length,
      classificationReviewRemaining: visualReviewQueue.length,
      visualReviewQueuePath,
      supervisedVision: Boolean(args.supervisedVision),
      liveApplyDuringVerify: applyDuringVerify,
      guessedAssignments: classifications.filter((entry) => entry.source === "guess").length,
      reusedClassifications: classifications.filter((entry) => entry.reused).length,
      collectionlessProducts: null,
      failures: null,
      specialCollectionCounts,
      auditBatchSize: args.batchSize,
      auditBatchCount: taxonomyBatchCount,
    },
    classifications,
    tagTasks,
    collectionTargets: targets,
    retryInfo,
    priorSnapshot: priorSnapshot ? {
      completedAt: priorSnapshot.completedAt,
      reusableHandles: priorSnapshot.byHandle.size,
      legacyVersionMetadata: priorSnapshot.legacyVersionMetadata,
    } : null,
  };
  await writeManifest(args.output, manifest);

  if (args.mode === "dry-run") {
    manifest.collectionTargets.forEach((target) => { target.status = `would-${target.action}`; });
    manifest.completedAt = new Date().toISOString();
    await writeManifest(args.output, manifest);
    process.stdout.write(`Catalog integrity dry run complete: ${products.length} products, ${actionableTagTasks.length} exact tag updates, ${targets.filter((target) => target.action !== "exact-match").length} collection repairs.\n`);
    return manifest;
  }

  if (shouldApply) {
    if (applyDuringVerify) {
      process.stdout.write("Catalog integrity: release-only guarded verify-apply enabled; applying evidence-backed tag and collection repairs before live readback.\n");
    }
    await applyExactTags(tagTasks, retryInfo, args.output, manifest);
    await verifyExactTags(tagTasks, retryInfo);
    await applyCollectionTargets(targets, onlineStorePublication, retryInfo, args.output, manifest);
  }

  let verification;
  for (let attempt = 1; attempt <= membershipPollAttempts; attempt += 1) {
    verification = await verifyCollectionMembership({ targets, products: liveProducts, tagTasks, retryInfo });
    if (!verification.failures.length) break;
    if (attempt < membershipPollAttempts) {
      process.stdout.write(`Collection propagation incomplete (${verification.failures.length} issues); retrying ${attempt}/${membershipPollAttempts}.\n`);
      await sleep(membershipPollDelayMs);
    }
  }
  manifest.summary.collectionlessProducts = verification.collectionless.length;
  manifest.summary.failures = verification.failures.length;
  manifest.verification = {
    completedAt: new Date().toISOString(),
    failures: verification.failures,
    collectionlessProductIds: verification.collectionless,
    bulkOperation: verification.bulkOperation ? {
      id: verification.bulkOperation.id,
      status: verification.bulkOperation.status,
      objectCount: Number(verification.bulkOperation.objectCount || 0),
      completedAt: verification.bulkOperation.completedAt || null,
    } : null,
  };
  manifest.completedAt = new Date().toISOString();
  await writeManifest(args.output, manifest);
  if (verification.failures.length) throw new Error(`Catalog integrity verification failed: ${verification.failures.join("; ")}`);
  process.stdout.write(`Catalog integrity verified: ${products.length} active products, ${targets.length + 1} governed collections, zero collectionless products.\n`);
  return manifest;
}

const args = parseArgs(process.argv);
run(args).catch((error) => {
  process.stderr.write(`${error.stack || error.message || error}\n`);
  process.exitCode = 1;
});
