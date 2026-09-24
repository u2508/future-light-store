#!/usr/bin/env node

import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";

import { createShopifyAdminGraphQLClient } from "./shopify-admin-graphql-client.mjs";
import { loadFutureLightEnv } from "./lib/future-light-env.mjs";
import { FUTURE_LIGHT_SHOP_DOMAIN } from "./lib/product-image-health.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const outputDir = join(rootDir, "output");
const pageSize = 100;
const maxPages = 100;

const READ_ONLY_ENV_KEYS = new Set([
  "CONVERSATION_ID",
  "FUTURE_LIGHT_SHOP_DOMAIN",
  "FUTURE_LIGHT_SHOP_URL",
  "FUTURE_LIGHT_SHOPIFY_ADMIN_ACCESS_TOKEN",
  "FUTURE_LIGHT_SHOPIFY_API_VERSION",
  "FUTURE_LIGHT_SHOPIFY_CLI_AGENT_IDS",
  "FUTURE_LIGHT_SHOPIFY_CLI_AGENT_INFO",
  "FUTURE_LIGHT_SHOPIFY_MAX_REQUEST_ATTEMPTS",
  "FUTURE_LIGHT_SHOPIFY_MAX_RETRY_DELAY_MS",
  "FUTURE_LIGHT_SHOPIFY_REQUEST_CONCURRENCY",
  "FUTURE_LIGHT_SHOPIFY_REQUEST_DELAY_MS",
  "FUTURE_LIGHT_SHOPIFY_REQUEST_TIMEOUT_MS",
  "SHOPIFY_ADMIN_API_VERSION",
  "SHOPIFY_CLI_BINARY",
]);

const COLLECTIONS_QUERY = /* GraphQL */ `
  query FutureLightCollectionSnapshot($after: String) {
    collections(first: 100, after: $after) {
      nodes {
        id
        handle
        title
        createdAt
        updatedAt
        descriptionHtml
        sortOrder
        templateSuffix
        productsCount {
          count
          precision
        }
        seo {
          title
          description
        }
        image {
          url
          altText
          width
          height
        }
        resourcePublications(first: 100, onlyPublished: false) {
          edges {
            node {
              isPublished
              publication {
                id
                name
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
        ruleSet {
          appliedDisjunctively
          rules {
            column
            relation
            condition
            conditionObject {
              __typename
              ... on CollectionRuleMetafieldCondition {
                metafieldDefinition {
                  id
                  namespace
                  key
                }
              }
              ... on CollectionRuleProductCategoryCondition {
                __typename
              }
              ... on CollectionRuleTextCondition {
                value
              }
            }
          }
        }
        sources {
          __typename
          id
          title
          ... on CollectionConditionsSource {
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
                ... on CollectionSourceInclusionConditionProductType {
                  relation
                  values
                  matchType
                }
                ... on CollectionSourceInclusionConditionProductTitle {
                  relation
                  values
                  matchType
                }
                ... on CollectionSourceInclusionConditionProductVendor {
                  relation
                  values
                  matchType
                }
                ... on CollectionSourceInclusionConditionProductStatus {
                  relation
                  values
                  matchType
                }
                ... on CollectionSourceInclusionConditionProductCategory {
                  relation
                  matchType
                  values {
                    includeDescendants
                    category {
                      id
                      name
                      fullName
                    }
                  }
                }
              }
              selections(first: 250) {
                nodes {
                  product {
                    id
                    handle
                    title
                  }
                }
                pageInfo {
                  hasNextPage
                  endCursor
                }
              }
            }
            exclusion {
              matchType
              conditions {
                __typename
                id
                ... on CollectionSourceExclusionConditionProductTag {
                  relation
                  values
                  matchType
                }
                ... on CollectionSourceExclusionConditionProductType {
                  relation
                  values
                  matchType
                }
                ... on CollectionSourceExclusionConditionProductVendor {
                  relation
                  values
                  matchType
                }
                ... on CollectionSourceExclusionConditionProductCategory {
                  relation
                  values {
                    includeDescendants
                    category {
                      id
                      name
                      fullName
                    }
                  }
                }
                ... on CollectionSourceExclusionConditionCollection {
                  values {
                    id
                    handle
                    title
                  }
                }
              }
              selections(first: 250) {
                nodes {
                  product {
                    id
                    handle
                    title
                  }
                }
                pageInfo {
                  hasNextPage
                  endCursor
                }
              }
            }
          }
          ... on CollectionSubCollectionsSource {
            collections {
              id
              handle
              title
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

function summarize(collections) {
  const sourceTypes = {};
  for (const collection of collections) {
    for (const source of collection.sources || []) {
      sourceTypes[source.__typename] = (sourceTypes[source.__typename] || 0) + 1;
    }
  }
  const titles = new Map();
  for (const collection of collections) {
    const key = String(collection.title || "").trim().toLocaleLowerCase("en-US");
    if (!key) continue;
    titles.set(key, [...(titles.get(key) || []), collection.id]);
  }
  const duplicateTitles = [...titles.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([title, ids]) => ({ title, ids }));
  return {
    collections: collections.length,
    emptyByExactAdminCount: collections.filter((entry) => Number(entry.productsCount?.count) === 0).length,
    impreciseProductCounts: collections.filter((entry) => entry.productsCount?.precision !== "EXACT").length,
    duplicateTitles,
    sourceTypes,
    manualSelectionPagesIncomplete: collections.flatMap((collection) =>
      (collection.sources || []).flatMap((source) => {
        if (source.__typename !== "CollectionConditionsSource") return [];
        const pageInfos = [source.inclusion?.selections?.pageInfo, source.exclusion?.selections?.pageInfo];
        return pageInfos.some((page) => page?.hasNextPage)
          ? [{ id: collection.id, handle: collection.handle, title: collection.title, sourceId: source.id }]
          : [];
      }),
    ),
    resourcePublicationPagesIncomplete: collections
      .filter((collection) => collection.resourcePublications?.pageInfo?.hasNextPage)
      .map((collection) => ({ id: collection.id, handle: collection.handle, title: collection.title })),
  };
}

async function writeSnapshot(snapshot) {
  await mkdir(outputDir, { recursive: true });
  const filename = `future-light-shopify-collections-snapshot-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.json`;
  const path = join(outputDir, filename);
  const tempPath = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
  return { path, filename };
}

async function fetchAllCollections(client) {
  const result = [];
  const cursors = new Set();
  let after = null;
  for (let page = 1; page <= maxPages; page += 1) {
    const data = await client.run(
      COLLECTIONS_QUERY,
      { after },
      { operation: `read Shopify collection snapshot page ${page}` },
    );
    const connection = data?.collections;
    const nodes = connection?.nodes;
    const pageInfo = connection?.pageInfo;
    if (!Array.isArray(nodes) || !pageInfo || typeof pageInfo.hasNextPage !== "boolean") {
      throw new Error(`Collection snapshot page ${page} returned an incomplete GraphQL connection.`);
    }
    if (!nodes.length && pageInfo.hasNextPage) {
      throw new Error(`Collection snapshot page ${page} is empty but reports another page.`);
    }
    result.push(...nodes);
    if (!pageInfo.hasNextPage) return result;
    const cursor = pageInfo.endCursor;
    if (typeof cursor !== "string" || cursor.length === 0 || cursors.has(cursor)) {
      throw new Error(`Collection snapshot page ${page} returned a missing or repeated cursor.`);
    }
    cursors.add(cursor);
    after = cursor;
  }
  throw new Error(`Collection snapshot exceeded the ${maxPages}-page safety limit.`);
}

async function main() {
  await loadFutureLightEnv({ rootDir, allowedKeys: READ_ONLY_ENV_KEYS });
  const client = createShopifyAdminGraphQLClient({ rootDir, agentName: "collection-snapshot" });
  if (client.storeDomain !== FUTURE_LIGHT_SHOP_DOMAIN) {
    throw new Error(`Refused collection snapshot target ${client.storeDomain}.`);
  }
  const identity = await client.run(
    "query FutureLightCollectionSnapshotTarget { shop { id name myshopifyDomain primaryDomain { host url } } }",
    {},
    { operation: "verify read-only Shopify target before collection snapshot" },
  );
  if (
    identity?.shop?.myshopifyDomain !== FUTURE_LIGHT_SHOP_DOMAIN ||
    identity?.shop?.id !== "gid://shopify/Shop/106570088529"
  ) {
    throw new Error("Refused collection snapshot: live Shop identity does not match the verified Future Light target.");
  }
  const collections = await fetchAllCollections(client);
  const ids = new Set(collections.map((collection) => collection.id));
  const handles = new Set(collections.map((collection) => collection.handle));
  if (ids.size !== collections.length || handles.size !== collections.length) {
    throw new Error("Collection snapshot contains duplicate collection IDs or handles; no report saved.");
  }
  const snapshot = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    shop: {
      id: identity.shop.id,
      name: identity.shop.name,
      myshopifyDomain: identity.shop.myshopifyDomain,
      primaryDomain: identity.shop.primaryDomain,
    },
    apiVersion: client.apiVersion,
    source: "shopify-admin-graphql-read-only-collection-pages",
    pagination: { complete: true, pageSize },
    summary: summarize(collections),
    collectionRecords: collections.length,
    collections,
  };
  const saved = await writeSnapshot(snapshot);
  process.stdout.write(
    `${JSON.stringify({
      file: saved.filename,
      createdAt: snapshot.createdAt,
      shopId: snapshot.shop.id,
      ...snapshot.summary,
    }, null, 2)}\n`,
  );
}

main().catch((error) => {
  const message = String(error?.message || error).replace(/(X-Shopify-Access-Token|access token)\s*[:=]\s*\S+/gi, "$1=[redacted]");
  process.stderr.write(`Collection snapshot stopped without store changes: ${message}\n`);
  process.exitCode = 1;
});
