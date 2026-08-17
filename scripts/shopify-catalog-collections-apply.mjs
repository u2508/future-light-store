#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  CATALOG_COLLECTION_PLAN,
  CATALOG_COLLECTION_PLAN_VERSION,
  CATALOG_COLLECTION_RULE_TAGS,
  buildCollectionSource,
  collectionSourceMatches,
  normalizeCollectionPlanTag,
  normalizeCollectionPlanText,
} from "../src/lib/catalog-collection-plan.js";
import {
  buildManagedTagAdditions,
  isActiveShopifyProduct,
  isOnlineStorePublishedLiveProduct,
} from "../src/lib/catalog-taxonomy-release.js";
import { classifyProductKnowledge } from "../src/lib/product-knowledge-base.js";
import { readCatalogKnowledgeModel } from "./catalog-knowledge-model-files.mjs";
import { createShopifyAdminGraphQLClient } from "./shopify-admin-graphql-client.mjs";
import { readProductCatalogPayload } from "./product-catalog-files.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const inputDir = resolve(rootDir, "public", "data");
const defaultOutputPath = resolve(rootDir, "output", "catalog-collection-release-manifest.json");
const approvalPath = resolve(rootDir, "docs", "catalog-collection-approval.json");
const batchSize = Math.max(1, Math.min(25, Number(process.env.SALT_CATALOG_COLLECTION_BATCH_SIZE || 20)));
const tagConcurrency = Math.max(1, Number(process.env.SALT_COLLECTION_TAG_CONCURRENCY || 1) || 1);
const client = createShopifyAdminGraphQLClient({ rootDir, agentName: "catalog-collection-release" });

const ACTIVE_PRODUCTS_QUERY = /* GraphQL */ `
  query CollectionRuleProducts($first: Int!, $after: String, $query: String!) {
    products(first: $first, after: $after, query: $query) {
      nodes {
        id
        handle
        title
        descriptionHtml
        productType
        vendor
        status
        tags
        resourcePublications(first: 100) {
          nodes {
            isPublished
            channel {
              name
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const PRODUCTS_BY_ID_QUERY = /* GraphQL */ `
  query CollectionRuleProductsById($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        handle
        title
        descriptionHtml
        productType
        vendor
        status
        tags
        resourcePublications(first: 100) {
          nodes {
            isPublished
            channel {
              name
            }
          }
        }
      }
    }
  }
`;

const COLLECTIONS_QUERY = /* GraphQL */ `
  query CatalogCollections($first: Int!, $after: String) {
    collections(first: $first, after: $after) {
      nodes {
        id
        handle
        title
        descriptionHtml
        productsCount {
          count
        }
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
                ... on CollectionSourceInclusionConditionProductTag {
                  relation
                  values
                  matchType
                }
              }
            }
          }
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
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const PUBLICATIONS_QUERY = /* GraphQL */ `
  query CatalogPublications($first: Int!, $after: String) {
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

const TAGS_ADD_MUTATION = /* GraphQL */ `
  mutation CollectionRuleTagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      userErrors {
        field
        message
      }
    }
  }
`;

const COLLECTION_CREATE_MUTATION = /* GraphQL */ `
  mutation CatalogCollectionCreate($collection: CollectionCreateInput!) {
    collectionCreate(collection: $collection) {
      collection {
        id
        handle
        title
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const COLLECTION_UPDATE_MUTATION = /* GraphQL */ `
  mutation CatalogCollectionUpdate($collection: CollectionUpdateInput!) {
    collectionUpdate(collection: $collection) {
      collection {
        id
        handle
        title
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const COLLECTION_SOURCE_UPDATE_MUTATION = /* GraphQL */ `
  mutation CatalogCollectionSourceUpdate($input: CollectionUpdateConditionsSourceInput!) {
    collectionConditionsSourceUpdate(input: $input) {
      source {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PUBLISH_COLLECTION_MUTATION = /* GraphQL */ `
  mutation CatalogCollectionPublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      publishable {
        ... on Collection {
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

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseArgs(argv) {
  const args = {
    mode: "dry-run",
    output: defaultOutputPath,
    inputDir,
    catalogFile: "",
    productHandlesFile: "",
    reviewOverridesFile: "",
    additionalTagsFile: "",
    tagsOnly: false,
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
    if (token === "--input-dir") {
      args.inputDir = resolve(rootDir, argv[index + 1] || args.inputDir);
      index += 1;
      continue;
    }
    if (token === "--catalog-file") {
      args.catalogFile = resolve(rootDir, argv[index + 1] || "");
      index += 1;
      continue;
    }
    if (token === "--product-handles-file") {
      args.productHandlesFile = resolve(rootDir, argv[index + 1] || "");
      index += 1;
      continue;
    }
    if (token === "--review-overrides-file") {
      args.reviewOverridesFile = resolve(rootDir, argv[index + 1] || "");
      index += 1;
      continue;
    }
    if (token === "--additional-tags-file") {
      args.additionalTagsFile = resolve(rootDir, argv[index + 1] || "");
      index += 1;
      continue;
    }
    if (token === "--tags-only") {
      args.tagsOnly = true;
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
  return new Set(handles.map((handle) => normalizeHandle(handle)).filter(Boolean));
}

async function readCatalogPayload(args) {
  if (!args.catalogFile) return readProductCatalogPayload(args.inputDir);
  const payload = JSON.parse(await readFile(args.catalogFile, "utf8"));
  if (!Array.isArray(payload?.products) || !payload.products.length) {
    throw new Error(`Catalog file contains no products: ${args.catalogFile}`);
  }
  return payload;
}

async function readReviewOverrides(filePath) {
  if (!filePath) return new Map();
  const payload = JSON.parse(await readFile(filePath, "utf8"));
  const entries = Array.isArray(payload) ? payload : payload?.overrides;
  if (!Array.isArray(entries) || !entries.length) {
    throw new Error(`Review overrides file contains no overrides: ${filePath}`);
  }

  const overrides = new Map();
  for (const entry of entries) {
    const handle = normalizeHandle(entry?.handle);
    const tags = asArray(entry?.tags).map(normalizeCollectionPlanText).filter(Boolean);
    if (!handle || !tags.length) {
      throw new Error(`Review override must include a handle and at least one tag: ${JSON.stringify(entry)}`);
    }
    if (overrides.has(handle)) {
      throw new Error(`Duplicate review override handle: ${handle}`);
    }
    overrides.set(handle, {
      handle,
      tags,
      rationale: normalizeCollectionPlanText(entry?.rationale),
      reviewId: normalizeCollectionPlanText(entry?.reviewId),
    });
  }
  return overrides;
}

async function readAdditionalTags(filePath) {
  if (!filePath) return new Map();
  const payload = JSON.parse(await readFile(filePath, "utf8"));
  const entries = Array.isArray(payload) ? payload : payload?.assignments;
  if (!Array.isArray(entries) || !entries.length) {
    throw new Error(`Additional tags file contains no assignments: ${filePath}`);
  }

  const controlledTags = new Set(CATALOG_COLLECTION_RULE_TAGS.map(normalizeCollectionPlanTag));
  const assignments = new Map();
  for (const entry of entries) {
    const handle = normalizeHandle(entry?.handle);
    const tags = [...new Set(asArray(entry?.tags).map(normalizeCollectionPlanText).filter(Boolean))];
    if (!handle || !tags.length) {
      throw new Error(`Additional tag assignment must include a handle and at least one tag: ${JSON.stringify(entry)}`);
    }
    const invalidTags = tags.filter((tag) => !controlledTags.has(normalizeCollectionPlanTag(tag)));
    if (invalidTags.length) {
      throw new Error(`Additional tags are outside the checked-in collection plan: ${invalidTags.join(", ")}`);
    }
    if (assignments.has(handle)) {
      throw new Error(`Duplicate additional tag assignment handle: ${handle}`);
    }
    assignments.set(handle, tags);
  }
  return assignments;
}

function formatUserErrors(errors) {
  return asArray(errors)
    .map((entry) => {
      const field = asArray(entry?.field).join(".");
      const message = normalizeCollectionPlanText(entry?.message || "Shopify user error");
      return `${field} ${message}`.trim();
    })
    .filter(Boolean)
    .join("; ");
}

function normalizeHandle(value) {
  return normalizeCollectionPlanText(value).toLowerCase();
}

function isOnlineStoreCollection(collection) {
  return asArray(collection?.resourcePublications?.nodes).some(
    (publication) => publication?.isPublished === true && normalizeHandle(publication?.channel?.name) === "online store",
  );
}

async function writeManifest(output, manifest) {
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(output, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

async function verifyCollectionApproval() {
  let approval;
  try {
    approval = JSON.parse(await readFile(approvalPath, "utf8"));
  } catch (error) {
    throw new Error(`Collection approval manifest could not be read: ${error.message}`);
  }

  const approvalId = normalizeCollectionPlanText(approval?.approvalId);
  if (approval?.approved !== true) {
    throw new Error("Collection approval manifest is not marked approved.");
  }
  if (!approvalId) {
    throw new Error("Collection approval manifest has no approvalId.");
  }
  if (normalizeCollectionPlanText(approval?.taxonomyVersion) !== CATALOG_COLLECTION_PLAN_VERSION.replace(/-collections\.1$/, "")) {
    throw new Error("Collection approval targets a different taxonomy version than the active plan.");
  }
  if (approval?.scope?.managedCollections !== "create or rebuild only the canonical collections in the checked-in collection plan") {
    throw new Error("Collection approval does not restrict writes to the checked-in canonical collection plan.");
  }
  if (approval?.scope?.controlledRuleTags !== "canonical department and category tags only") {
    throw new Error("Collection approval does not restrict collection rules to controlled department/category tags.");
  }
  if (approval?.scope?.existingTags !== "preserve unmanaged tags exactly; exact-replace checked-in canonical managed tags") {
    throw new Error("Collection approval does not preserve existing tags.");
  }
  if (approval?.scope?.legacyMergesOrArchives !== "not approved") {
    throw new Error("Legacy collection merges or archives are not separately approved.");
  }
  if (process.env.SALT_CATALOG_COLLECTIONS_APPROVED !== "1") {
    throw new Error("Set SALT_CATALOG_COLLECTIONS_APPROVED=1 only for the approved live collection run.");
  }
  if (normalizeCollectionPlanText(process.env.SALT_CATALOG_COLLECTIONS_APPROVAL_ID) !== approvalId) {
    throw new Error("SALT_CATALOG_COLLECTIONS_APPROVAL_ID does not match the collection approval manifest.");
  }

  return approvalId;
}

async function fetchActiveProducts() {
  const products = [];
  let after = null;

  while (true) {
    const data = await client.run(
      ACTIVE_PRODUCTS_QUERY,
      { first: 250, after, query: "status:active" },
      { operation: `collection product page ${products.length / 250 + 1}` },
    );
    const connection = data?.products;
    if (!connection) {
      throw new Error("Shopify returned no active product connection.");
    }
    products.push(...asArray(connection.nodes));
    if (!connection.pageInfo?.hasNextPage) break;
    if (!connection.pageInfo?.endCursor) throw new Error("Active product page hasNextPage without an end cursor.");
    after = connection.pageInfo.endCursor;
  }

  return products.filter(isActiveShopifyProduct);
}

async function fetchProductsById(ids) {
  const uniqueIds = [...new Set(asArray(ids).filter(Boolean))];
  if (!uniqueIds.length) return new Map();

  const data = await client.run(PRODUCTS_BY_ID_QUERY, { ids: uniqueIds }, {
    operation: "collection tag pre-write read",
  });
  return new Map(asArray(data?.nodes).filter((product) => product?.id).map((product) => [product.id, product]));
}

async function fetchCollections() {
  const collections = [];
  let after = null;

  while (true) {
    const data = await client.run(COLLECTIONS_QUERY, { first: 250, after }, {
      operation: `collection page ${collections.length / 250 + 1}`,
    });
    const connection = data?.collections;
    if (!connection) throw new Error("Shopify returned no collection connection.");
    collections.push(...asArray(connection.nodes));
    if (!connection.pageInfo?.hasNextPage) break;
    if (!connection.pageInfo?.endCursor) throw new Error("Collection page hasNextPage without an end cursor.");
    after = connection.pageInfo.endCursor;
  }

  return collections;
}

async function fetchPublications() {
  const publications = [];
  let after = null;

  while (true) {
    const data = await client.run(PUBLICATIONS_QUERY, { first: 250, after }, {
      operation: `publication page ${publications.length / 250 + 1}`,
    });
    const connection = data?.publications;
    if (!connection) throw new Error("Shopify returned no publication connection.");
    publications.push(...asArray(connection.nodes));
    if (!connection.pageInfo?.hasNextPage) break;
    if (!connection.pageInfo?.endCursor) throw new Error("Publication page hasNextPage without an end cursor.");
    after = connection.pageInfo.endCursor;
  }

  return publications;
}

function mergeProductForClassification(localProduct, liveProduct) {
  return {
    ...localProduct,
    id: liveProduct.id,
    handle: liveProduct.handle || localProduct?.handle,
    title: liveProduct.title || localProduct?.title,
    body_html: liveProduct.descriptionHtml || localProduct?.body_html,
    product_type: liveProduct.productType || localProduct?.product_type,
    vendor: liveProduct.vendor || localProduct?.vendor,
    tags: asArray(liveProduct.tags),
  };
}

function buildCollectionTagPlan(
  catalog,
  liveProducts,
  reviewOverrides = new Map(),
  additionalTags = new Map(),
  knowledgeModel = null,
) {
  const localByHandle = new Map(
    asArray(catalog?.products)
      .map((product) => [normalizeHandle(product?.handle), product])
      .filter(([handle]) => Boolean(handle)),
  );
  const controlledTags = new Set(CATALOG_COLLECTION_RULE_TAGS.map(normalizeCollectionPlanTag));
  const tasks = [];
  const specialTagTasks = [];
  const heldForReview = [];
  const reviewedProducts = [];
  const excludedFromOnlineStore = [];
  const nonOnlineManagedTagProducts = [];

  for (const liveProduct of asArray(liveProducts)) {
    const localProduct = localByHandle.get(normalizeHandle(liveProduct.handle)) || {};
    const product = mergeProductForClassification(localProduct, liveProduct);
    const existingControlledTags = asArray(liveProduct.tags)
      .map(normalizeCollectionPlanTag)
      .filter((tag) => controlledTags.has(tag));
    const onlineStorePublished = isOnlineStorePublishedLiveProduct(liveProduct);

    if (!onlineStorePublished) {
      excludedFromOnlineStore.push({ id: liveProduct.id, handle: liveProduct.handle });
      if (existingControlledTags.length) {
        nonOnlineManagedTagProducts.push({
          id: liveProduct.id,
          handle: liveProduct.handle,
          tags: existingControlledTags,
        });
      }
      continue;
    }

    const baseKnowledge = classifyProductKnowledge(product, { knowledgeModel });
    const reviewOverride = reviewOverrides.get(normalizeHandle(liveProduct.handle));
    const knowledge = reviewOverride
      ? {
        ...baseKnowledge,
        classificationRule: `manual-review:${reviewOverride.reviewId || "approved-override"}`,
        confidence: "manual-reviewed",
        proposedTags: reviewOverride.tags,
        reviewRequired: false,
        reviewReasons: [],
        seoEligible: true,
      }
      : baseKnowledge;
    const additionalProductTags = additionalTags.get(normalizeHandle(liveProduct.handle)) || [];
    const proposedTags = [...new Set([...asArray(knowledge.proposedTags), ...additionalProductTags])]
      .map(normalizeCollectionPlanText)
      .filter((tag) => controlledTags.has(normalizeCollectionPlanTag(tag)));
    const additionalTagsToAdd = buildManagedTagAdditions(liveProduct.tags, additionalProductTags);

    if (knowledge.reviewRequired || knowledge.seoEligible === false) {
      heldForReview.push({
        id: liveProduct.id,
        handle: liveProduct.handle,
        reviewRequired: Boolean(knowledge.reviewRequired),
        reviewReasons: asArray(knowledge.reviewReasons),
      });
      if (additionalTagsToAdd.length) {
        specialTagTasks.push({
          productId: liveProduct.id,
          handle: liveProduct.handle,
          title: liveProduct.title,
          proposedTags: additionalProductTags,
          tagsToAdd: additionalTagsToAdd,
          status: "would-add-special-collection-tags",
          specialCollectionTags: additionalProductTags,
        });
      }
      continue;
    }

    if (reviewOverride) {
      reviewedProducts.push({
        id: liveProduct.id,
        handle: liveProduct.handle,
        rationale: reviewOverride.rationale,
        tags: proposedTags,
      });
    }

    const tagsToAdd = buildManagedTagAdditions(liveProduct.tags, proposedTags);
    tasks.push({
      productId: liveProduct.id,
      handle: liveProduct.handle,
      title: liveProduct.title,
      proposedTags,
      tagsToAdd,
      specialCollectionTags: additionalProductTags,
      status: tagsToAdd.length ? "would-add" : "exact-match",
      knowledge: {
        productKnowledgeId: knowledge.productKnowledgeId,
        classificationRule: knowledge.classificationRule,
        confidence: knowledge.confidence,
        departmentId: knowledge.departmentId,
        categoryId: knowledge.categoryId,
        subcategoryId: knowledge.subcategoryId,
      },
      classificationReview: reviewOverride
        ? { rationale: reviewOverride.rationale, reviewId: reviewOverride.reviewId }
        : null,
    });
  }

  return {
    tasks,
    specialTagTasks,
    heldForReview,
    reviewedProducts,
    excludedFromOnlineStore,
    nonOnlineManagedTagProducts,
    summary: {
      liveActiveProducts: asArray(liveProducts).length,
      onlineStoreProducts: tasks.length + heldForReview.length,
      excludedFromOnlineStore: excludedFromOnlineStore.length,
      heldForReview: heldForReview.length,
      eligibleOnlineStoreProducts: tasks.length,
      productsNeedingTags: [...tasks, ...specialTagTasks].filter((task) => task.tagsToAdd.length).length,
      tagsToAdd: [...tasks, ...specialTagTasks].reduce((total, task) => total + task.tagsToAdd.length, 0),
      nonOnlineManagedTagProducts: nonOnlineManagedTagProducts.length,
      reviewedProducts: reviewedProducts.length,
      specialCollectionProducts: new Set(
        [...tasks, ...specialTagTasks]
          .filter((task) => asArray(task.specialCollectionTags).length)
          .map((task) => task.handle),
      ).size,
    },
  };
}

function resolveCollectionTargets(collections) {
  const byHandle = new Map(asArray(collections).map((collection) => [normalizeHandle(collection.handle), collection]));
  const usedIds = new Set();

  return CATALOG_COLLECTION_PLAN.map((entry) => {
    const canonical = byHandle.get(normalizeHandle(entry.handle));
    const legacy = canonical
      ? null
      : entry.legacyHandles.map((handle) => byHandle.get(normalizeHandle(handle))).find(Boolean) || null;
    const existing = canonical || legacy;

    if (existing && usedIds.has(existing.id)) {
      throw new Error(`Collection plan maps more than one canonical collection to ${existing.id}.`);
    }
    if (existing) usedIds.add(existing.id);

    const source = existing?.sources?.length === 1 ? existing.sources[0] : null;
    const metadataNeedsUpdate = Boolean(
      existing && (
        normalizeHandle(existing.handle) !== normalizeHandle(entry.handle) ||
        normalizeCollectionPlanText(existing.title) !== entry.title ||
        normalizeCollectionPlanText(existing.descriptionHtml) !== entry.description
      ),
    );
    const sourceNeedsUpdate = Boolean(existing && !collectionSourceMatches(entry, source));

    return {
      entry,
      existing,
      migratedFrom: legacy?.handle || null,
      source,
      sourceNeedsUpdate,
      metadataNeedsUpdate,
      action: existing ? (metadataNeedsUpdate || sourceNeedsUpdate ? "rebuild" : "exact-match") : "create",
      status: existing ? "planned" : "would-create",
    };
  });
}

function buildManifest({
  mode,
  collections,
  tagPlan,
  publications,
  approvalId = null,
  tagsOnly = false,
  scope = "full active catalog",
  reviewOverridesFile = "",
  additionalTagsFile = "",
}) {
  const onlineStorePublication = asArray(publications).find(
    (publication) => normalizeHandle(publication.name) === "online store",
  );
  const collectionTargets = tagsOnly ? [] : resolveCollectionTargets(collections);
  const actionCounts = collectionTargets.reduce((counts, target) => {
    counts[target.action] = (counts[target.action] || 0) + 1;
    return counts;
  }, {});

  return {
    releaseVersion: CATALOG_COLLECTION_PLAN_VERSION,
    taxonomyVersion: CATALOG_COLLECTION_PLAN_VERSION.replace(/-collections\.1$/, ""),
    mode,
    generatedAt: new Date().toISOString(),
    approvalId,
    policy: {
      existingProductTags: "preserve-exactly",
      managedProductTags: "add-only salt namespace; only collection-rule department/category tags",
      collectionRules: "one exact controlled canonical simple tag per canonical collection",
      productPublication: "read Online Store publication and never mutate product publications",
      collectionPublication: "publish canonical collections to Online Store only",
      legacyMergesOrArchives: "not approved and not performed",
      pricesVariantsMetafieldsSeo: "no mutation",
      scope,
      tagsOnly,
      reviewOverridesFile: reviewOverridesFile || null,
      additionalTagsFile: additionalTagsFile || null,
    },
    onlineStorePublication,
    summary: {
      liveCollections: asArray(collections).length,
      canonicalCollections: tagsOnly ? 0 : CATALOG_COLLECTION_PLAN.length,
      collectionActions: actionCounts,
      ...tagPlan.summary,
    },
    tagPlan: {
      tasks: tagPlan.tasks,
      heldForReview: tagPlan.heldForReview,
      reviewedProducts: tagPlan.reviewedProducts,
      specialTagTasks: tagPlan.specialTagTasks,
      excludedFromOnlineStore: tagPlan.excludedFromOnlineStore,
      nonOnlineManagedTagProducts: tagPlan.nonOnlineManagedTagProducts,
    },
    collectionTargets,
    legacyMergesOrArchives: [],
    retryInfo: [],
  };
}

async function applyTagBatch(tasks) {
  let nextIndex = 0;
  const applyWorker = async () => {
    while (nextIndex < tasks.length) {
      const task = tasks[nextIndex];
      nextIndex += 1;
      const data = await client.run(TAGS_ADD_MUTATION, {
        id: task.productId,
        tags: task.tagsToAdd,
      }, {
        allowMutations: true,
        operation: `add collection tags ${task.handle}`,
      });
      const errors = asArray(data?.tagsAdd?.userErrors);
      if (errors.length) throw new Error(`${task.handle}: ${formatUserErrors(errors)}`);
      task.status = "tags-added";
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(tagConcurrency, tasks.length) }, () => applyWorker()),
  );
}

async function verifyTagReadback(tasks) {
  const actionable = tasks.filter((task) => task.tagsToAdd.length);
  const failed = [];
  for (let index = 0; index < actionable.length; index += batchSize) {
    const batch = actionable.slice(index, index + batchSize);
    const products = await fetchProductsById(batch.map((task) => task.productId));
    for (const task of batch) {
      const product = products.get(task.productId);
      const actualTags = asArray(product?.tags).map(normalizeCollectionPlanTag);
      const missing = task.tagsToAdd.filter((tag) => !actualTags.includes(normalizeCollectionPlanTag(tag)));
      if (missing.length) {
        task.status = "failed-readback";
        task.failure = `Missing controlled tags after write: ${missing.join(", ")}`;
        failed.push(task);
      } else {
        task.status = "tags-added-verified";
      }
    }
  }
  if (failed.length) throw new Error(`${failed.length} collection tag task(s) failed readback.`);
}

async function updateCollectionMetadata(target) {
  const { entry, existing } = target;
  const input = { id: existing.id };
  if (target.metadataNeedsUpdate) {
    input.title = entry.title;
    input.descriptionHtml = entry.description;
    if (normalizeHandle(existing.handle) !== normalizeHandle(entry.handle)) {
      input.handle = entry.handle;
      input.redirectNewHandle = true;
    }
  }

  if (existing.sources.length > 1) {
    input.sourcesToDelete = existing.sources.map((source) => source.id);
    input.sourcesToCreate = [{ source: buildCollectionSource(entry) }];
  }
  if (!existing.sources.length) {
    input.sourcesToCreate = [{ source: buildCollectionSource(entry) }];
  }

  if (Object.keys(input).length === 1) return;

  const data = await client.run(COLLECTION_UPDATE_MUTATION, { collection: input }, {
    allowMutations: true,
    operation: `update collection ${entry.handle}`,
  });
  const errors = asArray(data?.collectionUpdate?.userErrors);
  if (errors.length) throw new Error(`${entry.handle}: ${formatUserErrors(errors)}`);
}

async function createCollection(target) {
  const entry = target.entry;
  const data = await client.run(COLLECTION_CREATE_MUTATION, {
    collection: {
      title: entry.title,
      handle: entry.handle,
      descriptionHtml: entry.description,
      sources: [{ source: buildCollectionSource(entry) }],
    },
  }, {
    allowMutations: true,
    operation: `create collection ${entry.handle}`,
  });
  const errors = asArray(data?.collectionCreate?.userErrors);
  if (errors.length) throw new Error(`${entry.handle}: ${formatUserErrors(errors)}`);
  const collection = data?.collectionCreate?.collection;
  if (!collection?.id) throw new Error(`${entry.handle}: Shopify returned no created collection.`);
  target.createdId = collection.id;
  target.status = "created";
  return collection.id;
}

async function updateCollectionSource(target) {
  if (!target.existing || !target.sourceNeedsUpdate || !target.source) return;
  const desired = buildCollectionSource(target.entry);

  if (target.source.shareable === false) {
    const data = await client.run(COLLECTION_UPDATE_MUTATION, {
      collection: {
        id: target.existing.id,
        sourcesToDelete: [target.source.id],
        sourcesToCreate: [{ source: desired }],
      },
    }, {
      allowMutations: true,
      operation: `replace non-shareable collection rule ${target.entry.handle}`,
    });
    const errors = asArray(data?.collectionUpdate?.userErrors);
    if (errors.length) throw new Error(`${target.entry.handle}: ${formatUserErrors(errors)}`);
    return;
  }

  const input = {
    id: target.source.id,
    title: desired.title,
    description: desired.description,
    inclusion: {
      matchType: desired.inclusion.matchType,
      conditionsToDelete: asArray(target.source.inclusion?.conditions).map((condition) => condition.id),
      conditionsToCreate: desired.inclusion.conditions,
    },
  };
  const data = await client.run(COLLECTION_SOURCE_UPDATE_MUTATION, { input }, {
    allowMutations: true,
    operation: `rebuild collection rule ${target.entry.handle}`,
  });
  const errors = asArray(data?.collectionConditionsSourceUpdate?.userErrors);
  if (errors.length) throw new Error(`${target.entry.handle}: ${formatUserErrors(errors)}`);
}

async function publishCollectionToOnlineStore(collectionId, publicationId, target) {
  const data = await client.run(PUBLISH_COLLECTION_MUTATION, {
    id: collectionId,
    input: [{ publicationId }],
  }, {
    allowMutations: true,
    operation: `publish collection ${target.entry.handle} to Online Store`,
  });
  const errors = asArray(data?.publishablePublish?.userErrors);
  if (errors.length) throw new Error(`${target.entry.handle}: ${formatUserErrors(errors)}`);
  target.status = `${target.status}-published`;
}

async function verifyCollectionReadback(targets) {
  const collections = await fetchCollections();
  const byHandle = new Map(collections.map((collection) => [normalizeHandle(collection.handle), collection]));
  const failures = [];

  for (const target of targets) {
    const live = byHandle.get(normalizeHandle(target.entry.handle));
    const issues = [];
    if (!live) {
      issues.push("canonical handle not found");
    } else {
      const source = live.sources.length === 1 ? live.sources[0] : null;
      if (!collectionSourceMatches(target.entry, source)) issues.push("source rule mismatch");
      if (!isOnlineStoreCollection(live)) issues.push("not published to Online Store");
    }
    target.readback = {
      collectionId: live?.id || null,
      productsCount: live?.productsCount?.count ?? null,
      ok: issues.length === 0,
      issues,
    };
    if (issues.length) failures.push(`${target.entry.handle}: ${issues.join(", ")}`);
  }

  if (failures.length) throw new Error(`Collection readback failed: ${failures.join("; ")}`);
  return collections;
}

async function runRelease({
  mode,
  output,
  inputDir: releaseInputDir,
  catalogFile,
  productHandlesFile,
  reviewOverridesFile,
  additionalTagsFile,
  tagsOnly,
}) {
  const approvalId = mode === "apply" ? await verifyCollectionApproval() : null;
  const knowledgeModel = await readCatalogKnowledgeModel({
    required: process.env.SALT_REQUIRE_KNOWLEDGE_MODEL === "1",
  });
  const productHandles = await readProductHandles(productHandlesFile);
  const reviewOverrides = await readReviewOverrides(reviewOverridesFile);
  const additionalTags = await readAdditionalTags(additionalTagsFile);
  const [catalog, liveProducts, collections, publications] = await Promise.all([
    readCatalogPayload({ inputDir: releaseInputDir, catalogFile }),
    fetchActiveProducts(),
    tagsOnly ? Promise.resolve([]) : fetchCollections(),
    tagsOnly ? Promise.resolve([]) : fetchPublications(),
  ]);
  const scopedLiveProducts = productHandles
    ? liveProducts.filter((product) => productHandles.has(normalizeHandle(product.handle)))
    : liveProducts;
  const scope = productHandlesFile
    ? `active products in supplied cohort only; ${scopedLiveProducts.length} live products selected`
    : "full active catalog";
  const tagPlan = buildCollectionTagPlan(catalog, scopedLiveProducts, reviewOverrides, additionalTags, knowledgeModel);
  const manifest = buildManifest({
    mode,
    collections,
    tagPlan,
    publications,
    approvalId,
    tagsOnly,
    scope,
    reviewOverridesFile,
    additionalTagsFile,
  });

  if (!tagsOnly && !manifest.onlineStorePublication?.id) {
    throw new Error("Shopify publication named Online Store was not found.");
  }
  if (tagPlan.nonOnlineManagedTagProducts.length) {
    process.stdout.write(
      `Boundary audit: ${tagPlan.nonOnlineManagedTagProducts.length} non-Online Store product(s) already carry controlled collection tags; existing tags are preserved and storefront sync will filter them.\n`,
    );
  }

  if (mode === "dry-run") {
    for (const target of manifest.collectionTargets) {
      target.status = target.action === "exact-match" ? "exact-match" : `would-${target.action}`;
    }
    await writeManifest(output, manifest);
    if (tagsOnly) {
      process.stdout.write(
        `Collection tag dry run complete: ${manifest.summary.productsNeedingTags} products need ` +
        `${manifest.summary.tagsToAdd} controlled tag additions; no collection definitions will be changed.\n`,
      );
      return manifest;
    }
    process.stdout.write(
      `Collection dry run complete: ${manifest.summary.canonicalCollections} canonical collections, ` +
      `${manifest.summary.productsNeedingTags} products need ${manifest.summary.tagsToAdd} controlled tag additions, ` +
      `${manifest.summary.excludedFromOnlineStore} products excluded from Online Store.\n`,
    );
    return manifest;
  }

  const actionableTagTasks = [
    ...manifest.tagPlan.tasks,
    ...manifest.tagPlan.specialTagTasks,
  ].filter((task) => task.tagsToAdd.length);
  if (actionableTagTasks.length) {
    await applyTagBatch(actionableTagTasks);
    await verifyTagReadback(actionableTagTasks);
    await writeManifest(output, manifest);
  }

  if (tagsOnly) {
    manifest.completedAt = new Date().toISOString();
    manifest.summary.failed = 0;
    await writeManifest(output, manifest);
    process.stdout.write(
      `Collection tag apply complete: ${manifest.summary.productsNeedingTags} products received ` +
      `${manifest.summary.tagsToAdd} controlled tag additions and passed live readback.\n`,
    );
    return manifest;
  }

  for (const target of manifest.collectionTargets) {
    if (target.action === "create") {
      const collectionId = await createCollection(target);
      await publishCollectionToOnlineStore(collectionId, manifest.onlineStorePublication.id, target);
      continue;
    }

    await updateCollectionMetadata(target);
    await updateCollectionSource(target);
    const collectionId = target.existing.id;
    if (!isOnlineStoreCollection(target.existing)) {
      await publishCollectionToOnlineStore(collectionId, manifest.onlineStorePublication.id, target);
    } else {
      target.status = target.action === "exact-match" ? "verified-existing" : "rebuilt";
    }
    await writeManifest(output, manifest);
  }

  await verifyCollectionReadback(manifest.collectionTargets);
  manifest.completedAt = new Date().toISOString();
  manifest.summary.failed = 0;
  await writeManifest(output, manifest);
  process.stdout.write(
    `Collection apply complete: ${manifest.summary.canonicalCollections} canonical collections verified with Online Store publication.\n`,
  );
  return manifest;
}

const args = parseArgs(process.argv);
try {
  await runRelease(args);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
