#!/usr/bin/env node

import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import { createShopifyAdminGraphQLClient, asArray, normalizeText } from "./shopify-admin-graphql-client.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const outputDir = resolve(rootDir, "output");
const snapshotPath = resolve(outputDir, "shopify-tag-collection-cleanup-snapshot.json");
const beforeSnapshotPath = resolve(outputDir, "shopify-tag-collection-cleanup-before.json");
const planPath = resolve(outputDir, "shopify-tag-collection-cleanup-plan.json");
const localSnapshotPath = resolve(tmpdir(), "salt-shopify-tag-collection-cleanup-latest.json");
const localPlanPath = resolve(tmpdir(), "salt-shopify-tag-collection-cleanup-plan-latest.json");
const client = createShopifyAdminGraphQLClient({ rootDir, agentName: "tag-collection-cleanup" });
const execFileAsync = promisify(execFile);
const pageSize = 250;
const productQuery = process.env.SALT_CLEANUP_PRODUCT_QUERY || "";

const PRODUCTS_QUERY = /* GraphQL */ `
  query CleanupProducts($first: Int!, $after: String, $query: String!) {
    products(first: $first, after: $after, query: $query, sortKey: ID) {
      nodes {
        id
        legacyResourceId
        handle
        title
        status
        tags
        collections(first: 250) {
          nodes { id handle title }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const COLLECTIONS_QUERY = /* GraphQL */ `
  query CleanupCollections($first: Int!, $after: String) {
    collections(first: $first, after: $after, sortKey: TITLE) {
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
            description
            shareable
            targetType
            inclusion {
              matchType
              conditions {
                __typename
                id
                ... on CollectionSourceInclusionConditionProductTag { relation values matchType }
                ... on CollectionSourceInclusionConditionProductTitle { relation values matchType }
                ... on CollectionSourceInclusionConditionVariantPrice { relation value { amount currencyCode } }
                ... on CollectionSourceInclusionConditionProductCategory {
                  matchType
                  values { category { id } includeDescendants }
                }
              }
            }
          }
        }
        metafields(first: 100) {
          nodes { namespace key type value }
        }
        resourcePublications(first: 250) {
          nodes {
            isPublished
            publishDate
            channel { id name }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const PUBLICATIONS_QUERY = /* GraphQL */ `
  query CleanupPublications($first: Int!, $after: String) {
    publications(first: $first, after: $after) {
      nodes { id name }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const PRODUCT_TAGS_ADD_MUTATION = /* GraphQL */ `
  mutation CleanupTagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) { userErrors { field message } }
  }
`;

const PRODUCT_TAGS_UPDATE_MUTATION = /* GraphQL */ `
  mutation CleanupTagsUpdate($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id handle tags }
      userErrors { field message }
    }
  }
`;

const COLLECTION_UPDATE_MUTATION = /* GraphQL */ `
  mutation CleanupCollectionUpdate($collection: CollectionUpdateInput!) {
    collectionUpdate(collection: $collection) {
      collection { id handle title }
      userErrors { field message }
    }
  }
`;

const COLLECTION_UNPUBLISH_MUTATION = /* GraphQL */ `
  mutation CleanupCollectionUnpublish($id: ID!, $input: [PublicationInput!]!) {
    publishableUnpublish(id: $id, input: $input) {
      userErrors { field message }
    }
  }
`;

const URL_REDIRECT_CREATE_MUTATION = /* GraphQL */ `
  mutation CleanupUrlRedirectCreate($urlRedirect: UrlRedirectInput!) {
    urlRedirectCreate(urlRedirect: $urlRedirect) {
      urlRedirect { id path target }
      userErrors { field message }
    }
  }
`;

const COLLECTION_DELETE_MUTATION = /* GraphQL */ `
  mutation CleanupCollectionDelete($input: CollectionDeleteInput!) {
    collectionDelete(input: $input) {
      deletedCollectionId
      userErrors { field message }
    }
  }
`;

const STAGED_UPLOAD_CREATE_MUTATION = /* GraphQL */ `
  mutation CleanupStagedUpload($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url parameters { name value } }
      userErrors { field message }
    }
  }
`;

const BULK_OPERATION_RUN_MUTATION = /* GraphQL */ `
  mutation CleanupBulkRun($mutation: String!, $stagedUploadPath: String!) {
    bulkOperationRunMutation(mutation: $mutation, stagedUploadPath: $stagedUploadPath) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }
`;

const BULK_OPERATION_STATUS_QUERY = /* GraphQL */ `
  query CleanupBulkStatus($id: ID!) {
    bulkOperation(id: $id) { id status errorCode objectCount url }
  }
`;

const BULK_PRODUCT_UPDATE_MUTATION = /* GraphQL */ `
  mutation CleanupBulkProductUpdate($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id }
      userErrors { field message }
    }
  }
`;

const APPROVED_SOURCE_UNIONS = Object.freeze([
  ["caregiver-essentials", "health-wellness"],
  ["mobility-support", "health-wellness"],
  ["posture-support", "health-wellness"],
  ["camping-gear", "travel-outdoor"],
  ["holiday-gifts", "gifts"],
  ["viral-tiktok-products", "unique-products"],
]);

// Keep duplicate detection independent of the large OneDrive-backed taxonomy
// module. This is the checked-in canonical handle set used by cleanup safety.
const CANONICAL_COLLECTION_HANDLES = Object.freeze([
  "women", "womens-fashion", "womens-beauty-essentials", "womens-accessories",
  "women-bags-and-wallets", "men-collection", "mens-fashion", "mens-bags-wallets",
  "mens-accessories", "hats", "mens-beauty-skincare", "kids", "kids-wear",
  "kids-toys-games", "home-decor", "cookware", "smart-lighting",
  "bedsheets-handlooms-towels", "car-accessories", "portable-gadgets", "covers-cases",
  "mouse-keyboard", "audio", "office-school-supplies", "travel-outdoor", "watches",
  "fitness-equipment", "health-wellness", "creator-essentials", "anime-collectables",
]);

function normalizeHandle(value) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function normalizeTag(value) {
  return normalizeText(value).toLowerCase();
}

function simpleTag(value) {
  return normalizeHandle(value);
}

function tagNamespace(tag) {
  const match = normalizeTag(tag).match(/^salt:([^:]+):(.+)$/);
  return match ? match[1] : "";
}

function tagValue(tag) {
  const match = normalizeTag(tag).match(/^salt:[^:]+:(.+)$/);
  return match ? match[1] : "";
}

function legacyToSimpleTag(tag) {
  const namespace = tagNamespace(tag);
  const value = simpleTag(tagValue(tag));
  if (!namespace || !value) return null;
  if (["collection", "department", "category", "type", "audience", "feature", "compatibility"].includes(namespace)) {
    return value;
  }
  if (namespace === "classification-rule") return `classification-rule-${value}`;
  if (namespace === "classification-source") return `classification-source-${value}`;
  return null;
}

function productId(product) {
  return product.id || `gid://shopify/Product/${product.legacyResourceId}`;
}

function productKey(product) {
  return normalizeHandle(product.handle) || productId(product);
}

function connectionNodes(connection) {
  return asArray(connection?.nodes ?? connection);
}

function dedupeTags(tags) {
  const seen = new Map();
  for (const tag of asArray(tags).map(normalizeText).filter(Boolean)) {
    const key = normalizeTag(tag).replace(/[-_]+/g, " ").replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();
    if (!seen.has(key)) seen.set(key, tag);
  }
  return [...seen.values()];
}

async function fetchAll(query, variables, key, operation) {
  const rows = [];
  let after = null;
  let page = 0;
  while (true) {
    page += 1;
    const data = await client.run(query, { ...variables, first: pageSize, after }, { operation: `${operation} page ${page}` });
    const connection = data?.[key];
    if (!connection) throw new Error(`${operation} returned no ${key} connection.`);
    rows.push(...asArray(connection.nodes));
    if (!connection.pageInfo?.hasNextPage) break;
    after = connection.pageInfo.endCursor;
    if (!after) throw new Error(`${operation} returned hasNextPage without a cursor.`);
  }
  return rows;
}

function repositoryNavigationReferences() {
  return {
    sourceFiles: [
      "src/lib/site-navigation.ts",
      "src/lib/catalog-collection-plan.js",
      "src/lib/collection-hierarchy.ts",
    ],
    note: "Repository references are checked in source; Shopify menus require a read_menus scope and were not readable by the connected credential.",
  };
}

function collectionSourceTag(collection) {
  const source = asArray(collection?.sources).find((entry) => entry?.__typename === "CollectionConditionsSource");
  const condition = asArray(source?.inclusion?.conditions).find((entry) => entry?.__typename === "CollectionSourceInclusionConditionProductTag");
  const value = asArray(condition?.values)[0];
  return value ? normalizeText(value) : "";
}

function buildTagMappings(products, collections) {
  const productSaltTags = products.flatMap((product) => asArray(product.tags));
  const collectionSaltTags = collections.flatMap((collection) => asArray(collection.sources)
    .flatMap((source) => asArray(source?.inclusion?.conditions))
    .flatMap((condition) => asArray(condition?.values))
    .filter((value) => typeof value === "string"));
  const saltTags = [...new Set([...productSaltTags, ...collectionSaltTags]
    .filter((tag) => /^salt:/i.test(tag))
    .map(normalizeText))].sort();
  const targetSources = new Map();
  const mappings = saltTags.map((source) => {
    const target = legacyToSimpleTag(source);
    const namespace = tagNamespace(source);
    const entry = { source, namespace, target, status: target ? "mapped" : "review", reason: target ? "explicit namespace mapping" : "unsupported salt namespace" };
    if (target) {
      if (!targetSources.has(target)) targetSources.set(target, []);
      targetSources.get(target).push({ source, namespace });
    }
    return entry;
  });
  const collisions = [];
  for (const [target, sources] of targetSources.entries()) {
    const namespaces = new Set(sources.map((entry) => entry.namespace));
    const allowedSameConcept = sources.every((entry) => !["classification-rule", "classification-source"].includes(entry.namespace));
    if (!allowedSameConcept) {
      collisions.push({ target, sources });
      for (const mapping of mappings) if (mapping.target === target) {
        mapping.status = "review";
        mapping.reason = "different SALT namespaces collapse to the same simple tag";
      }
    } else if (sources.length > 1) {
      for (const mapping of mappings) if (mapping.target === target && mapping.status === "mapped") {
        mapping.reason = "exact normalized concept shared by legacy SALT namespaces";
      }
    }
  }
  return { mappings, collisions };
}

function buildProductTagPlan(products, tagMappings) {
  const mappingBySource = new Map(tagMappings.mappings.map((entry) => [normalizeTag(entry.source), entry]));
  const tasks = [];
  const held = [];
  for (const product of products) {
    const legacyTags = asArray(product.tags).map(normalizeText).filter(Boolean);
    const saltTags = legacyTags.filter((tag) => /^salt:/i.test(tag));
    const mapped = saltTags.map((tag) => mappingBySource.get(normalizeTag(tag))).filter(Boolean);
    const reviewMappings = mapped.filter((entry) => entry.status !== "mapped");
    const manualTags = legacyTags.filter((tag) => !/^salt:/i.test(tag));
    const simpleTags = mapped.filter((entry) => entry.status === "mapped").map((entry) => entry.target);
    const finalTags = dedupeTags([...simpleTags, ...manualTags]);
    const task = {
      productId: productId(product),
      handle: product.handle,
      title: product.title,
      initialTags: legacyTags,
      legacyTags,
      manualTags,
      simpleTags: [...new Set(simpleTags)],
      finalTags,
      tagsToAdd: [...new Set(simpleTags.filter((tag) => !legacyTags.some((existing) => normalizeTag(existing) === normalizeTag(tag))))],
      status: reviewMappings.length ? "held-for-review" : finalTags.join("|") === dedupeTags(legacyTags).join("|") ? "exact-match" : "planned",
      review: reviewMappings.map((entry) => `${entry.source}: ${entry.reason}`),
    };
    tasks.push(task);
    if (task.status === "held-for-review") held.push(task);
  }
  return { tasks, held };
}

function buildCollectionPlan(collections, tagMappings) {
  const mappingBySource = new Map(tagMappings.mappings.map((entry) => [normalizeTag(entry.source), entry]));
  const targets = [];
  for (const collection of collections) {
    const source = asArray(collection?.sources).find((entry) => entry?.__typename === "CollectionConditionsSource");
    const conditions = asArray(source?.inclusion?.conditions);
    const sourceTags = conditions
      .filter((condition) => condition?.__typename === "CollectionSourceInclusionConditionProductTag")
      .flatMap((condition) => asArray(condition.values))
      .filter((value) => /^salt:/i.test(normalizeText(value)));
    if (!sourceTags.length) continue;
    const mappedSource = buildMappedSourceInput(source, mappingBySource);
    const desiredTags = mappedSource.source.inclusion.conditions
      .filter((condition) => condition.productTag)
      .flatMap((condition) => asArray(condition.productTag.values))
      .filter((value) => !/^salt:/i.test(normalizeText(value)));
    targets.push({
      collectionId: collection.id,
      handle: collection.handle,
      title: collection.title,
      sourceTags,
      desiredTags,
      source,
      desiredSource: mappedSource.source,
      status: mappedSource.unmapped.length ? "held-for-review" : "planned",
      reason: mappedSource.unmapped.length
        ? `collection rule uses ambiguous or unsupported SALT tag(s): ${mappedSource.unmapped.join(", ")}`
        : "replace SALT product-tag values while preserving all collection conditions and match modes",
    });
  }
  return targets;
}

function detectDuplicateCollections(collections) {
  const groups = new Map();
  for (const collection of collections) {
    const key = normalizeHandle(collection.title || collection.handle);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ id: collection.id, handle: collection.handle, title: collection.title, count: collection.productsCount?.count ?? null });
  }
  const approved = new Map(APPROVED_SOURCE_UNIONS);
  const canonicalHandles = new Set(CANONICAL_COLLECTION_HANDLES);
  const candidates = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const canonical = members.find((entry) => canonicalHandles.has(entry.handle));
    candidates.push({ members, canonical: canonical || null, status: canonical ? "explicit-canonical-candidate" : "held-for-review", approvedSource: approved.get(members[0].handle) || null });
  }
  return candidates;
}

function conditionKey(condition) {
  return JSON.stringify({
    type: condition?.__typename || "",
    relation: condition?.relation || "",
    matchType: condition?.matchType || "",
    values: condition?.__typename === "CollectionSourceInclusionConditionVariantPrice"
      ? condition?.value || null
      : asArray(condition?.values).map((value) => typeof value === "string" ? legacyToSimpleTag(value) || normalizeText(value) : value),
  });
}

function conditionInput(condition) {
  if (condition?.__typename === "CollectionSourceInclusionConditionProductTag") {
    return { productTag: { relation: condition.relation, values: asArray(condition.values).map((value) => legacyToSimpleTag(value) || normalizeText(value)), matchType: condition.matchType } };
  }
  if (condition?.__typename === "CollectionSourceInclusionConditionProductTitle") {
    return { productTitle: { relation: condition.relation, values: asArray(condition.values), matchType: condition.matchType } };
  }
  if (condition?.__typename === "CollectionSourceInclusionConditionVariantPrice") {
    return { variantPrice: { relation: condition.relation, value: condition.value } };
  }
  if (condition?.__typename === "CollectionSourceInclusionConditionProductCategory") {
    return { productCategory: { values: asArray(condition.values), matchType: condition.matchType } };
  }
  throw new Error(`Unsupported duplicate collection condition: ${condition?.__typename || "unknown"}`);
}

function buildUnionSource(canonical, duplicate) {
  const canonicalSource = asArray(canonical?.sources).find((source) => source?.__typename === "CollectionConditionsSource");
  const duplicateSource = asArray(duplicate?.sources).find((source) => source?.__typename === "CollectionConditionsSource");
  const conditions = [];
  const seen = new Set();
  for (const condition of [...asArray(canonicalSource?.inclusion?.conditions), ...asArray(duplicateSource?.inclusion?.conditions)]) {
    const key = conditionKey(condition);
    if (seen.has(key)) continue;
    seen.add(key);
    conditions.push(conditionInput(condition));
  }
  if (!conditions.length) throw new Error(`Cannot merge ${duplicate.handle} into ${canonical.handle} without conditions.`);
  return {
    title: canonicalSource?.title || `SALT canonical collection rule`,
    description: `${canonicalSource?.description || "Canonical collection rule"} Union preserved from duplicate collection ${duplicate.handle}.`,
    targetType: canonicalSource?.targetType || "PRODUCTS",
    inclusion: { matchType: "ANY", conditions },
  };
}

function buildSourceInput(source) {
  return {
    title: source?.title || "Canonical collection rule",
    description: source?.description || "Canonical collection rule",
    targetType: source?.targetType || "PRODUCTS",
    inclusion: {
      matchType: source?.inclusion?.matchType || "ALL",
      conditions: asArray(source?.inclusion?.conditions).map(conditionInput),
    },
  };
}

function buildMappedSourceInput(source, mappingBySource) {
  const unmapped = [];
  const conditions = asArray(source?.inclusion?.conditions).map((condition) => {
    if (condition?.__typename !== "CollectionSourceInclusionConditionProductTag") {
      return conditionInput(condition);
    }
    const values = asArray(condition.values).map((value) => {
      const normalized = normalizeText(value);
      if (!/^salt:/i.test(normalized)) return normalized;
      const mapping = mappingBySource.get(normalizeTag(normalized));
      if (mapping?.status !== "mapped") {
        unmapped.push(normalized);
        return normalized;
      }
      return mapping.target;
    });
    return {
      productTag: {
        relation: condition.relation,
        values,
        matchType: condition.matchType,
      },
    };
  });
  return {
    source: {
      title: source?.title || "Canonical collection rule",
      description: source?.description || "Canonical collection rule",
      targetType: source?.targetType || "PRODUCTS",
      inclusion: {
        matchType: source?.inclusion?.matchType || "ALL",
        conditions,
      },
    },
    unmapped,
  };
}

function collectionRuleFingerprint(source) {
  const conditions = asArray(source?.inclusion?.conditions).map((condition) => {
    if (condition?.__typename === "CollectionSourceInclusionConditionProductTag" || condition?.productTag) {
      const input = condition.productTag || condition;
      return {
        type: "productTag",
        relation: input.relation || "",
        matchType: input.matchType || "",
        values: asArray(input.values).map(normalizeTag).sort(),
      };
    }
    if (condition?.__typename === "CollectionSourceInclusionConditionProductTitle" || condition?.productTitle) {
      const input = condition.productTitle || condition;
      return {
        type: "productTitle",
        relation: input.relation || "",
        matchType: input.matchType || "",
        values: asArray(input.values).map(normalizeText).sort(),
      };
    }
    if (condition?.__typename === "CollectionSourceInclusionConditionVariantPrice" || condition?.variantPrice) {
      const input = condition.variantPrice || condition;
      return {
        type: "variantPrice",
        relation: input.relation || "",
        value: input.value || null,
      };
    }
    if (condition?.__typename === "CollectionSourceInclusionConditionProductCategory" || condition?.productCategory) {
      const input = condition.productCategory || condition;
      return {
        type: "productCategory",
        matchType: input.matchType || "",
        values: asArray(input.values).map((value) => JSON.stringify(value)).sort(),
      };
    }
    return { type: condition?.__typename || "unknown" };
  }).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return JSON.stringify({
    matchType: source?.inclusion?.matchType || "",
    conditions,
  });
}

function buildDuplicateMergePlan(collections, candidates, membership) {
  const byId = new Map(collections.map((collection) => [collection.id, collection]));
  const tasks = [];
  for (const candidate of candidates) {
    if (!candidate.canonical) continue;
    const canonical = byId.get(candidate.canonical.id);
    for (const member of candidate.members) {
      if (member.id === candidate.canonical.id) continue;
      const duplicate = byId.get(member.id);
      const canonicalSource = asArray(canonical?.sources).find((source) => source?.__typename === "CollectionConditionsSource");
      const duplicateSource = asArray(duplicate?.sources).find((source) => source?.__typename === "CollectionConditionsSource");
      const status = canonical && duplicate && canonicalSource && duplicateSource ? "planned" : "held-for-review";
      const canonicalMembers = new Set(Object.entries(membership).filter(([, handles]) => handles.includes(canonical?.handle)).map(([key]) => key));
      const duplicateOnlyMembers = Object.entries(membership)
        .filter(([key, handles]) => handles.includes(duplicate?.handle) && !canonicalMembers.has(key))
        .map(([key]) => key);
      const requiresRuleUpdate = duplicateOnlyMembers.length > 0;
      tasks.push({
        canonicalId: canonical?.id || candidate.canonical.id,
        canonicalHandle: canonical?.handle || candidate.canonical.handle,
        canonicalSource,
        canonicalSourceId: canonicalSource?.id || null,
        duplicateId: duplicate?.id || member.id,
        duplicateHandle: duplicate?.handle || member.handle,
        status,
        requiresRuleUpdate,
        duplicateOnlyMembers,
        reason: status === "planned" ? "duplicate title resolved to checked-in canonical handle" : "duplicate collection source is incomplete",
        unionSource: status === "planned"
          ? requiresRuleUpdate ? buildUnionSource(canonical, duplicate) : buildSourceInput(canonicalSource)
          : null,
      });
    }
  }
  return tasks;
}

function membershipIndex(products) {
  return Object.fromEntries(products.map((product) => [productKey(product), connectionNodes(product.collections).map((collection) => collection.handle).filter(Boolean).sort()]));
}

function sleep(milliseconds) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

async function uploadBulkInput(inputPath, label) {
  const data = await client.run(STAGED_UPLOAD_CREATE_MUTATION, {
    input: [{
      resource: "BULK_MUTATION_VARIABLES",
      filename: basename(inputPath),
      mimeType: "text/jsonl",
      httpMethod: "POST",
    }],
  }, { allowMutations: true, operation: `${label} staged upload` });
  const errors = asArray(data?.stagedUploadsCreate?.userErrors);
  if (errors.length) throw new Error(`${label} staged upload failed: ${errors.map((error) => normalizeText(error.message)).join(" | ")}`);
  const target = data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target?.url) throw new Error(`${label} staged upload returned no target.`);
  const curlArgs = ["-sS", "-X", "POST", target.url];
  for (const parameter of asArray(target.parameters)) curlArgs.push("-F", `${parameter.name}=${parameter.value}`);
  curlArgs.push("-F", `file=@${inputPath};type=text/jsonl`);
  await execFileAsync("curl", curlArgs, { cwd: rootDir, maxBuffer: 20 * 1024 * 1024 });
  const stagedUploadPath = asArray(target.parameters).find((parameter) => parameter.name === "key")?.value;
  if (!stagedUploadPath) throw new Error(`${label} staged upload returned no staged path.`);
  return stagedUploadPath;
}

async function waitForBulkOperation(operationId, label) {
  while (true) {
    const data = await client.run(BULK_OPERATION_STATUS_QUERY, { id: operationId }, { operation: `${label} bulk status` });
    const operation = data?.bulkOperation;
    if (!operation) throw new Error(`${label} bulk operation disappeared: ${operationId}`);
    process.stdout.write(`${label} bulk operation: ${operation.status}, ${operation.objectCount || 0} object(s).\n`);
    if (operation.status === "COMPLETED") return operation;
    if (["FAILED", "CANCELED", "EXPIRED"].includes(operation.status)) {
      throw new Error(`${label} bulk operation ended ${operation.status}: ${operation.errorCode || "unknown error"}`);
    }
    await sleep(5000);
  }
}

async function runBulkProductUpdates(tasks, label, outputStem) {
  if (!tasks.length) return;
  const inputPath = resolve(outputDir, `${outputStem}-input.jsonl`);
  const resultPath = resolve(outputDir, `${outputStem}-result.jsonl`);
  const lines = tasks.map((task) => JSON.stringify({ product: { id: task.productId, tags: task.tags } }));
  await writeFile(inputPath, `${lines.join("\n")}\n`, "utf8");
  const stagedUploadPath = await uploadBulkInput(inputPath, label);
  const started = await client.run(BULK_OPERATION_RUN_MUTATION, {
    mutation: BULK_PRODUCT_UPDATE_MUTATION,
    stagedUploadPath,
  }, { allowMutations: true, operation: `start ${label} bulk operation` });
  const errors = asArray(started?.bulkOperationRunMutation?.userErrors);
  if (errors.length) throw new Error(`${label} bulk start failed: ${errors.map((error) => normalizeText(error.message)).join(" | ")}`);
  const operationId = started?.bulkOperationRunMutation?.bulkOperation?.id;
  if (!operationId) throw new Error(`${label} returned no bulk operation id.`);
  const operation = await waitForBulkOperation(operationId, label);
  if (!operation.url) throw new Error(`${label} completed without a result URL.`);
  await execFileAsync("curl", ["-sS", "-L", operation.url, "-o", resultPath], { cwd: rootDir, maxBuffer: 20 * 1024 * 1024 });
  const results = (await readFile(resultPath, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  if (results.length !== tasks.length) throw new Error(`${label} returned ${results.length}/${tasks.length} result lines.`);
  for (const [index, result] of results.entries()) {
    const lineErrors = [...asArray(result?.errors), ...asArray(result?.data?.productUpdate?.userErrors)];
    if (lineErrors.length) throw new Error(`${tasks[index].handle}: ${lineErrors.map((error) => normalizeText(error.message)).join(" | ")}`);
  }
  return { operation, inputPath, resultPath };
}

async function snapshot({ writeBefore = false, overwriteBefore = false } = {}) {
  const [products, collections, publications] = await Promise.all([
    fetchAll(PRODUCTS_QUERY, { query: productQuery }, "products", "product snapshot"),
    fetchAll(COLLECTIONS_QUERY, {}, "collections", "collection snapshot"),
    fetchAll(PUBLICATIONS_QUERY, {}, "publications", "publication snapshot"),
  ]);
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: { store: client.storeDomain, apiVersion: client.apiVersion, productQuery: productQuery || "all products", freshLiveRead: true },
    products,
    collections,
    publications,
    navigation: { shopifyMenus: { status: "blocked", reason: "Access denied for menus field" }, repository: repositoryNavigationReferences() },
    membership: membershipIndex(products),
  };
  await mkdir(outputDir, { recursive: true });
  if (writeBefore) {
    let beforeExists = true;
    try {
      await access(beforeSnapshotPath);
    } catch {
      beforeExists = false;
    }
    if (overwriteBefore || !beforeExists) await writeFile(beforeSnapshotPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  await writeFile(snapshotPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await writeFile(localSnapshotPath, `${JSON.stringify(result)}\n`, "utf8");
  process.stdout.write(`Cleanup snapshot written: ${products.length} products, ${collections.length} collections, ${publications.length} publications.\n`);
  return result;
}

function buildPlan(snapshotData) {
  const tagMappings = buildTagMappings(snapshotData.products, snapshotData.collections);
  const productPlan = buildProductTagPlan(snapshotData.products, tagMappings);
  const collectionPlan = buildCollectionPlan(snapshotData.collections, tagMappings);
  const duplicateCollections = detectDuplicateCollections(snapshotData.collections);
  const duplicateCollectionMerges = buildDuplicateMergePlan(snapshotData.collections, duplicateCollections, snapshotData.membership);
  const plan = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    policy: {
      preserveManualTags: true,
      addSimpleTagsBeforeLegacyRemoval: true,
      membershipMustMatchSnapshot: true,
      ambiguousProductsHeld: true,
      duplicateCollectionsRequireExplicitCanonical: true,
    },
    tagMappings,
    productTasks: productPlan.tasks,
    collectionTasks: collectionPlan,
    duplicateCollections,
    duplicateCollectionMerges,
    summary: {
      products: snapshotData.products.length,
      saltTags: tagMappings.mappings.length,
      tagCollisions: tagMappings.collisions.length,
      productsHeldForReview: productPlan.held.length,
      productsWithTagChanges: productPlan.tasks.filter((task) => task.status === "planned").length,
      collectionRulesToUpdate: collectionPlan.filter((task) => task.status === "planned").length,
      collectionRulesHeld: collectionPlan.filter((task) => task.status !== "planned").length,
      duplicateCollectionCandidates: duplicateCollections.length,
      ambiguousDuplicateCollections: duplicateCollections.filter((candidate) => candidate.status === "held-for-review").length,
      duplicateCollectionMerges: duplicateCollectionMerges.filter((task) => task.status === "planned").length,
      duplicateCollectionMergesHeld: duplicateCollectionMerges.filter((task) => task.status !== "planned").length,
    },
    snapshot: snapshotPath,
    beforeSnapshot: beforeSnapshotPath,
  };
  return plan;
}

function assertSafePlan(plan) {
  const failures = [];
  if (plan.summary.tagCollisions) failures.push(`${plan.summary.tagCollisions} ambiguous tag collision(s)`);
  if (plan.summary.productsHeldForReview) failures.push(`${plan.summary.productsHeldForReview} product(s) held for tag review`);
  if (plan.summary.collectionRulesHeld) failures.push(`${plan.summary.collectionRulesHeld} collection rule(s) held for review`);
  if (plan.summary.ambiguousDuplicateCollections) failures.push(`${plan.summary.ambiguousDuplicateCollections} duplicate collection candidate(s) held for review`);
  if (plan.summary.duplicateCollectionMergesHeld) failures.push(`${plan.summary.duplicateCollectionMergesHeld} duplicate collection merge(s) held for review`);
  if (failures.length) throw new Error(`Cleanup aborted by safety gate: ${failures.join("; ")}`);
}

async function addSimpleTags(tasks) {
  const updates = tasks
    .filter((entry) => entry.status === "planned")
    .map((task) => ({
      ...task,
      tags: dedupeTags([...task.simpleTags, ...task.initialTags]),
    }));
  return runBulkProductUpdates(updates, "add simple tags", "shopify-tag-collection-cleanup-add-simple-tags");
}

async function updateCollectionRules(tasks) {
  for (const task of tasks.filter((entry) => entry.status === "planned")) {
    const collection = { id: task.collectionId };
    const source = task.source;
    if (!source?.id) throw new Error(`${task.handle}: snapshot source disappeared before rule update.`);
    collection.sourcesToUpdate = [{
      condition: {
        id: source.id,
        title: task.desiredSource.title,
        description: task.desiredSource.description,
        inclusion: {
          matchType: task.desiredSource.inclusion.matchType,
          conditionsToDelete: asArray(source.inclusion?.conditions).map((condition) => condition.id).filter(Boolean),
          conditionsToCreate: asArray(task.desiredSource.inclusion?.conditions),
        },
      },
    }];
    const data = await client.run(COLLECTION_UPDATE_MUTATION, { collection }, { allowMutations: true, operation: `update simple tag rule ${task.handle}` });
    const errors = asArray(data?.collectionUpdate?.userErrors);
    if (errors.length) throw new Error(`${task.handle}: ${errors.map((error) => normalizeText(error.message)).join(" | ")}`);
  }
}

async function mergeDuplicateCollections(tasks) {
  for (const task of tasks.filter((entry) => entry.status === "planned" && entry.requiresRuleUpdate)) {
    const collection = { id: task.canonicalId };
    if (task.canonicalSourceId && task.canonicalSource) {
      collection.sourcesToUpdate = [{
        condition: {
          id: task.canonicalSourceId,
          title: task.unionSource.title,
          description: task.unionSource.description,
          inclusion: {
            matchType: task.unionSource.inclusion.matchType,
            conditionsToDelete: asArray(task.canonicalSource.inclusion?.conditions).map((condition) => condition.id).filter(Boolean),
            conditionsToCreate: asArray(task.unionSource.inclusion?.conditions),
          },
        },
      }];
    } else {
      collection.sourcesToDelete = task.canonicalSourceId ? [task.canonicalSourceId] : [];
      collection.sourcesToCreate = [{ source: task.unionSource }];
    }
    const data = await client.run(COLLECTION_UPDATE_MUTATION, {
      collection,
    }, { allowMutations: true, operation: `union duplicate collection ${task.duplicateHandle} into ${task.canonicalHandle}` });
    const errors = asArray(data?.collectionUpdate?.userErrors);
    if (errors.length) throw new Error(`${task.canonicalHandle}: ${errors.map((error) => normalizeText(error.message)).join(" | ")}`);
  }
}

function expectedMembershipAfterDuplicateMerge(membership, tasks, removeDuplicate = false) {
  const expected = Object.fromEntries(Object.entries(membership).map(([key, handles]) => [key, [...handles]]));
  for (const task of tasks.filter((entry) => entry.status === "planned")) {
    for (const [key, handles] of Object.entries(expected)) {
      if (!handles.includes(task.duplicateHandle)) continue;
      if (!handles.includes(task.canonicalHandle)) handles.push(task.canonicalHandle);
      if (removeDuplicate) {
        expected[key] = handles.filter((handle) => handle !== task.duplicateHandle).sort();
      } else {
        expected[key] = handles.sort();
      }
    }
  }
  return expected;
}

function verifyMembershipMap(liveProducts, expectedMembership, stage) {
  const failures = [];
  for (const product of liveProducts) {
    const key = productKey(product);
    const expected = expectedMembership[key] || [];
    const actual = connectionNodes(product.collections).map((collection) => collection.handle).filter(Boolean).sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) failures.push(`${product.handle}: ${stage} membership mismatch`);
  }
  if (failures.length) throw new Error(`${stage} membership readback failed: ${failures.slice(0, 20).join(" | ")}`);
}

async function unpublishDuplicateCollections(tasks, publications) {
  const onlineStore = publications.find((publication) => normalizeTag(publication?.name) === "online store");
  if (!onlineStore?.id) throw new Error("Online Store publication was not readable; duplicate collection retirement is blocked.");
  for (const task of tasks.filter((entry) => entry.status === "planned")) {
    const data = await client.run(COLLECTION_UNPUBLISH_MUTATION, {
      id: task.duplicateId,
      input: [{ publicationId: onlineStore.id }],
    }, { allowMutations: true, operation: `unpublish duplicate collection ${task.duplicateHandle}` });
    const errors = asArray(data?.publishableUnpublish?.userErrors);
    if (errors.length) throw new Error(`${task.duplicateHandle}: ${errors.map((error) => normalizeText(error.message)).join(" | ")}`);
  }
}

async function retireDuplicateCollections(tasks, publications) {
  const onlineStore = publications.find((publication) => normalizeTag(publication?.name) === "online store");
  if (!onlineStore?.id) throw new Error("Online Store publication was not readable; duplicate collection retirement is blocked.");
  for (const task of tasks.filter((entry) => entry.status === "planned")) {
    const redirect = await client.run(URL_REDIRECT_CREATE_MUTATION, {
      urlRedirect: {
        path: `/collections/${task.duplicateHandle}`,
        target: `/collections/${task.canonicalHandle}`,
      },
    }, { allowMutations: true, operation: `redirect duplicate collection ${task.duplicateHandle}` });
    const redirectErrors = asArray(redirect?.urlRedirectCreate?.userErrors);
    if (redirectErrors.length) throw new Error(`${task.duplicateHandle}: redirect creation failed: ${redirectErrors.map((error) => normalizeText(error.message)).join(" | ")}`);
    if (!redirect?.urlRedirectCreate?.urlRedirect?.id) throw new Error(`${task.duplicateHandle}: Shopify returned no redirect id.`);

    const unpublished = await client.run(COLLECTION_UNPUBLISH_MUTATION, {
      id: task.duplicateId,
      input: [{ publicationId: onlineStore.id }],
    }, { allowMutations: true, operation: `unpublish duplicate collection ${task.duplicateHandle}` });
    const unpublishErrors = asArray(unpublished?.publishableUnpublish?.userErrors);
    if (unpublishErrors.length) throw new Error(`${task.duplicateHandle}: unpublish failed: ${unpublishErrors.map((error) => normalizeText(error.message)).join(" | ")}`);

    const deleted = await client.run(COLLECTION_DELETE_MUTATION, {
      input: { id: task.duplicateId },
    }, { allowMutations: true, operation: `delete duplicate collection ${task.duplicateHandle}` });
    const deleteErrors = asArray(deleted?.collectionDelete?.userErrors);
    if (deleteErrors.length) throw new Error(`${task.duplicateHandle}: collection deletion failed: ${deleteErrors.map((error) => normalizeText(error.message)).join(" | ")}`);
    if (deleted?.collectionDelete?.deletedCollectionId !== task.duplicateId) throw new Error(`${task.duplicateHandle}: Shopify did not confirm duplicate collection deletion.`);
  }
}

async function removeLegacyTags(tasks) {
  const updates = tasks
    .filter((entry) => entry.status === "simple-tags-added-pending")
    .map((task) => ({ ...task, tags: task.finalTags }));
  return runBulkProductUpdates(updates, "remove legacy tags", "shopify-tag-collection-cleanup-remove-legacy-tags");
}

async function verifyLive(snapshotData, plan, expectedMembership = snapshotData.membership) {
  const live = await snapshot();
  const failures = [];
  const taskById = new Map(plan.productTasks.map((task) => [task.productId, task]));
  for (const product of live.products) {
    const key = productKey(product);
    const task = taskById.get(productId(product));
    const before = expectedMembership[key] || [];
    const after = connectionNodes(product.collections).map((collection) => collection.handle).filter(Boolean).sort();
    if (JSON.stringify(before) !== JSON.stringify(after)) failures.push(`${product.handle}: membership changed`);
    if (asArray(product.tags).some((tag) => /^salt:/i.test(tag))) failures.push(`${product.handle}: managed salt tag remains`);
    if (!after.length) failures.push(`${product.handle}: collectionless after cleanup`);
    if (task) {
      const actualTags = dedupeTags(product.tags).map(normalizeTag).sort();
      const expectedTags = dedupeTags(task.finalTags).map(normalizeTag).sort();
      if (JSON.stringify(actualTags) !== JSON.stringify(expectedTags)) failures.push(`${product.handle}: final tag readback mismatch`);
      const manualKeys = new Set(task.manualTags.map((tag) => normalizeTag(tag).replace(/[-_]+/g, " ").replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim()));
      const actualKeys = new Set(product.tags.map((tag) => normalizeTag(tag).replace(/[-_]+/g, " ").replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim()));
      for (const manualKey of manualKeys) if (!actualKeys.has(manualKey)) failures.push(`${product.handle}: manual tag lost`);
      if (new Set(product.tags.map((tag) => normalizeTag(tag).replace(/[-_]+/g, " ").replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim())).size !== product.tags.length) {
        failures.push(`${product.handle}: duplicate canonical tag remains`);
      }
    }
  }
  for (const task of plan.collectionTasks.filter((entry) => entry.status === "planned")) {
    const collection = live.collections.find((entry) => entry.id === task.collectionId);
    const source = asArray(collection?.sources).find((entry) => entry?.__typename === "CollectionConditionsSource");
    if (collectionRuleFingerprint(source) !== collectionRuleFingerprint(task.desiredSource)) {
      failures.push(`${task.handle}: mapped collection rule readback mismatch`);
    }
  }
  for (const task of plan.duplicateCollectionMerges.filter((entry) => entry.status === "planned")) {
    const duplicate = live.collections.find((entry) => entry.id === task.duplicateId);
    if (duplicate) failures.push(`${task.duplicateHandle}: duplicate collection remains after retirement`);
  }
  if (failures.length) throw new Error(`Cleanup live readback failed: ${failures.slice(0, 20).join(" | ")}`);
  return live;
}

async function main() {
  const mode = process.argv.includes("--apply") ? "apply" : process.argv.includes("--snapshot") ? "snapshot" : "dry-run";
  const snapshotData = mode === "snapshot"
    ? await snapshot({ writeBefore: true, overwriteBefore: true })
    : mode === "apply"
      ? await snapshot({ writeBefore: true })
      : JSON.parse(await readFile(
        process.env.SALT_CLEANUP_LOCAL_SNAPSHOT || localSnapshotPath,
        "utf8",
      ));
  if (mode === "snapshot") return;
  const plan = buildPlan(snapshotData);
  await mkdir(outputDir, { recursive: true });
  const serializedPlan = `${JSON.stringify(plan, null, 2)}\n`;
  await writeFile(localPlanPath, serializedPlan, "utf8");
  if (process.env.SALT_CLEANUP_LOCAL_ONLY !== "1") {
    await writeFile(planPath, serializedPlan, "utf8");
  }
  process.stdout.write(`Cleanup dry run: ${plan.summary.productsWithTagChanges} products, ${plan.summary.collectionRulesToUpdate} collection rules, ${plan.summary.productsHeldForReview} held products, ${plan.summary.tagCollisions} tag collisions.\n`);
  assertSafePlan(plan);
  if (mode !== "apply") return;

  // A verified no-op still needs a fresh live readback, but does not need to
  // repeat the full snapshot sequence used for a mutating migration.
  const hasPlannedChanges = [
    ...plan.productTasks,
    ...plan.collectionTasks,
    ...plan.duplicateCollectionMerges,
  ].some((task) => task.status === "planned");
  if (!hasPlannedChanges) {
    await verifyLive(snapshotData, plan, snapshotData.membership);
    process.stdout.write(`Simple tag migration completed: ${plan.summary.products} products, ${plan.summary.saltTags} mapped legacy tags, ${plan.summary.duplicateCollectionMerges} duplicate collection merge(s), zero-salt-tag and live-readback gates passed.\n`);
    return;
  }

  await addSimpleTags(plan.productTasks);
  for (const task of plan.productTasks) if (task.status === "planned") task.status = "simple-tags-added-pending";
  const afterAdd = await snapshot();
  for (const task of plan.productTasks.filter((entry) => entry.status === "simple-tags-added-pending")) {
    const live = afterAdd.products.find((product) => productId(product) === task.productId);
    const missing = task.simpleTags.filter((tag) => !asArray(live?.tags).some((actual) => normalizeTag(actual) === normalizeTag(tag)));
    if (missing.length) throw new Error(`${task.handle}: simple tag readback missing ${missing.join(", ")}`);
  }
  await updateCollectionRules(plan.collectionTasks);
  const afterRuleUpdate = await snapshot();
  verifyMembershipMap(afterRuleUpdate.products, snapshotData.membership, "simple rule migration");
  for (const task of plan.duplicateCollectionMerges) {
    const canonical = afterRuleUpdate.collections.find((collection) => collection.id === task.canonicalId);
    task.canonicalSourceId = asArray(canonical?.sources).find((source) => source?.__typename === "CollectionConditionsSource")?.id || task.canonicalSourceId;
  }
  await mergeDuplicateCollections(plan.duplicateCollectionMerges);
  const afterUnion = await snapshot();
  const expectedBeforeRetirement = expectedMembershipAfterDuplicateMerge(snapshotData.membership, plan.duplicateCollectionMerges, false);
  verifyMembershipMap(afterUnion.products, expectedBeforeRetirement, "duplicate collection union");
  await retireDuplicateCollections(plan.duplicateCollectionMerges, snapshotData.publications);
  const expectedFinalMembership = expectedMembershipAfterDuplicateMerge(snapshotData.membership, plan.duplicateCollectionMerges, true);
  await removeLegacyTags(plan.productTasks);
  await verifyLive(snapshotData, plan, expectedFinalMembership);
  process.stdout.write(`Simple tag migration completed: ${plan.summary.products} products, ${plan.summary.saltTags} mapped legacy tags, ${plan.summary.duplicateCollectionMerges} duplicate collection merge(s), zero-salt-tag and live-readback gates passed.\n`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
