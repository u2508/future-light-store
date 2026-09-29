#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertCollectionRuleForMembership,
  validateCollectionClassificationManifest,
} from "../src/lib/future-light-collection-classification.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const outputDir = join(rootDir, "output");
const expectedDomain = "vs-future-store-0jl2t-jxu6tnr3.myshopify.com";
const expectedShopId = "gid://shopify/Shop/106570088529";
const expectedApiVersion = "2026-07";
const expectedCollectionCount = 115;
// A classification readback must be regenerated within one day of verification.
const maxEvidenceAgeMs = 24 * 60 * 60 * 1000;
const requiredCoverageDimensions = [
  "products",
  "productStatuses",
  "productVariants",
  "productMedia",
  "variantMediaAssociations",
  "productMetafields",
  "productMetafieldReferences",
  "collectionMemberships",
  "resourcePublications",
];

function parseArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    if (!args[index]?.startsWith("--")) throw new Error(`Unexpected argument ${args[index]}`);
    values[args[index].slice(2)] = args[++index] || "";
  }
  for (const key of ["manifest", "before", "after", "collections-before", "collections-after"]) {
    if (!values[key]) throw new Error(`Missing --${key}`);
  }
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, resolve(rootDir, value)]));
}

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function set(values) {
  return new Set(values || []);
}

function sorted(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function sameSet(left, right) {
  return stableJson(sorted(set(left))) === stableJson(sorted(set(right)));
}

function expectedTags(record) {
  const tags = set(record.beforeTags);
  for (const { tag } of record.addMemberships) tags.add(tag);
  for (const { tag } of record.removeMemberships) tags.delete(tag);
  return sorted(tags);
}

function expectedMembershipIds(record) {
  const ids = set(record.beforeMembershipIds);
  for (const { collectionGid } of record.addMemberships) ids.add(collectionGid);
  for (const { collectionGid } of record.removeMemberships) ids.delete(collectionGid);
  return sorted(ids);
}

function comparableProduct(product) {
  const { tags: _tags, collections: _collections, updatedAt: _updatedAt, ...unchangedFields } = product;
  return unchangedFields;
}

function pageComplete(snapshot, label, issues) {
  for (const key of requiredCoverageDimensions) {
    if (snapshot?.coverage?.[key] !== "complete") {
      issues.push(`${label} coverage ${key} is missing or incomplete`);
    }
  }
}

function assertRule(collection, mapping, label, issues) {
  try {
    assertCollectionRuleForMembership(collection, mapping);
  } catch (error) {
    issues.push(`${label} ${error.message}`);
  }
}

function increment(map, key, delta) {
  map.set(key, (map.get(key) || 0) + delta);
}

function snapshotTimestamp(snapshot, label, now, issues) {
  const timestamp = Date.parse(snapshot?.createdAt || "");
  if (!Number.isFinite(timestamp)) {
    issues.push(`${label} snapshot timestamp is missing or invalid`);
    return null;
  }
  if (timestamp > now + 5 * 60 * 1000) issues.push(`${label} snapshot timestamp is in the future`);
  if (now - timestamp > maxEvidenceAgeMs) issues.push(`${label} snapshot evidence is stale`);
  return timestamp;
}

function hasUniqueIds(items, getId, label, issues, pattern) {
  const ids = items.map((item) => getId(item || {}));
  if (ids.some((id) => typeof id !== "string" || !id || (pattern && !pattern.test(id)))) {
    issues.push(`${label} contains a missing or invalid ID`);
  }
  if (new Set(ids).size !== ids.length) issues.push(`${label} contains duplicate IDs`);
}

function snapshotMembershipCount(products, label, issues) {
  let count = 0;
  for (const product of products) {
    const productId = product?.id || "(unknown)";
    if (!Array.isArray(product?.collections?.nodes)) {
      issues.push(`${label} product ${productId} has no collection membership list`);
      continue;
    }
    if (product.collections.pageInfo?.hasNextPage !== false) {
      issues.push(`${label} product ${productId} has incomplete collection membership pagination`);
    }
    hasUniqueIds(product.collections.nodes, (collection) => collection?.id, `${label} product ${productId} memberships`, issues, /^gid:\/\/shopify\/Collection\/\d+$/);
    count += product.collections.nodes.length;
  }
  return count;
}

function invalidEvidenceResult(issues) {
  return { issues, expectedMembershipDelta: null, collectionDeltas: [] };
}

export function validateClassificationEvidence({
  manifest,
  before,
  after,
  collectionsBefore,
  collectionsAfter,
  sourceBeforeHash,
  sourceCollectionsBeforeHash,
  now = Date.now(),
}) {
  const issues = [];
  try {
    validateCollectionClassificationManifest(manifest, { expectedShopDomain: expectedDomain });
  } catch (error) {
    issues.push(`manifest validation failed: ${error.message}`);
    return invalidEvidenceResult(issues);
  }

  if (manifest.target.shopId !== expectedShopId || manifest.target.apiVersion !== expectedApiVersion) {
    issues.push("manifest shop ID or API version does not match the pinned target");
  }
  if (!Array.isArray(before?.products) || !Array.isArray(after?.products)) {
    issues.push("catalog snapshots must contain product arrays");
    return invalidEvidenceResult(issues);
  }
  if (!Array.isArray(collectionsBefore?.collections) || !Array.isArray(collectionsAfter?.collections)) {
    issues.push("collection snapshots must contain collection arrays");
    return invalidEvidenceResult(issues);
  }
  if ([...before.products, ...after.products, ...collectionsBefore.collections, ...collectionsAfter.collections].some((item) => !item || typeof item !== "object")) {
    issues.push("snapshots contain invalid product or collection records");
    return invalidEvidenceResult(issues);
  }

  if (sourceBeforeHash !== manifest.source.catalogSnapshotSha256) issues.push("before catalog SHA-256 differs from the reviewed manifest");
  if (sourceCollectionsBeforeHash !== manifest.source.collectionsSnapshotSha256) issues.push("before collections SHA-256 differs from the reviewed manifest");
  if (before.shopDomain !== expectedDomain || after.shopDomain !== expectedDomain) issues.push("catalog snapshot shop domain mismatch");
  if (collectionsBefore.shop?.id !== expectedShopId || collectionsAfter.shop?.id !== expectedShopId) issues.push("collection snapshot Shop GID mismatch");
  if (collectionsBefore.shop?.myshopifyDomain !== expectedDomain || collectionsAfter.shop?.myshopifyDomain !== expectedDomain) issues.push("collection snapshot Shopify domain mismatch");
  if ([before.apiVersion, after.apiVersion, collectionsBefore.apiVersion, collectionsAfter.apiVersion].some((version) => version !== expectedApiVersion)) {
    issues.push("Admin API version mismatch");
  }

  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs)) issues.push("verification time is invalid");
  const timestamps = {
    beforeCatalog: snapshotTimestamp(before, "before catalog", nowMs, issues),
    afterCatalog: snapshotTimestamp(after, "after catalog", nowMs, issues),
    beforeCollections: snapshotTimestamp(collectionsBefore, "before collections", nowMs, issues),
    afterCollections: snapshotTimestamp(collectionsAfter, "after collections", nowMs, issues),
  };
  if (timestamps.beforeCatalog !== null && timestamps.afterCatalog !== null && timestamps.afterCatalog <= timestamps.beforeCatalog) {
    issues.push("after catalog snapshot does not follow the before snapshot");
  }
  if (timestamps.beforeCollections !== null && timestamps.afterCollections !== null && timestamps.afterCollections <= timestamps.beforeCollections) {
    issues.push("after collections snapshot does not follow the before snapshot");
  }
  const beforeTimes = [timestamps.beforeCatalog, timestamps.beforeCollections].filter(Number.isFinite);
  const afterTimes = [timestamps.afterCatalog, timestamps.afterCollections].filter(Number.isFinite);
  if (beforeTimes.length === 2 && afterTimes.length === 2 && Math.min(...afterTimes) <= Math.max(...beforeTimes)) {
    issues.push("after evidence is not newer than all before evidence");
  }

  pageComplete(before, "before catalog", issues);
  pageComplete(after, "after catalog", issues);
  for (const [label, snapshot] of [["before", collectionsBefore], ["after", collectionsAfter]]) {
    if (snapshot.pagination?.complete !== true) issues.push(`${label} collection snapshot pagination is incomplete`);
    if (snapshot.collections.length !== expectedCollectionCount || snapshot.collectionRecords !== expectedCollectionCount || snapshot.summary?.collections !== expectedCollectionCount) {
      issues.push(`${label} collection snapshot count does not match the expected ${expectedCollectionCount} collections`);
    }
    hasUniqueIds(snapshot.collections, (collection) => collection.id, `${label} collections`, issues, /^gid:\/\/shopify\/Collection\/\d+$/);
  }

  for (const [label, snapshot] of [["before", before], ["after", after]]) {
    if (!snapshot.counts || !Number.isInteger(snapshot.counts.products) || snapshot.counts.products !== snapshot.products.length) {
      issues.push(`${label} catalog product count does not match its product records`);
    }
    hasUniqueIds(snapshot.products, (product) => product.id, `${label} products`, issues, /^gid:\/\/shopify\/Product\/\d+$/);
    const actualMembershipCount = snapshotMembershipCount(snapshot.products, label, issues);
    if (snapshot.counts?.collectionMemberships !== actualMembershipCount) {
      issues.push(`${label} catalog membership count does not match its product records`);
    }
  }

  if (before.products.length !== after.products.length) issues.push("product count changed during collection classification");
  if (before.counts?.products !== after.counts?.products) issues.push("catalog product count changed during collection classification");
  if (before.counts?.variants !== after.counts?.variants) issues.push("variant count changed during collection classification");
  if (before.counts?.productMedia !== after.counts?.productMedia) issues.push("product media count changed during collection classification");
  if (before.counts?.productMetafields !== after.counts?.productMetafields) issues.push("product metafield count changed during collection classification");
  if (before.counts?.resourcePublications !== after.counts?.resourcePublications) issues.push("product publication record count changed during collection classification");

  const beforeProducts = new Map(before.products.map((product) => [product.id, product]));
  const afterProducts = new Map(after.products.map((product) => [product.id, product]));
  const reviewed = new Map(manifest.records.map((record) => [record.productGid, record]));
  const collectionDeltas = new Map();

  for (const id of reviewed.keys()) {
    if (!beforeProducts.has(id)) issues.push(`reviewed product ${id} is missing from the before snapshot`);
    if (!afterProducts.has(id)) issues.push(`reviewed product ${id} is missing from the after snapshot`);
  }

  for (const [id, sourceProduct] of beforeProducts) {
    const liveProduct = afterProducts.get(id);
    if (!liveProduct) {
      issues.push(`product ${id} disappeared from the after snapshot`);
      continue;
    }
    const record = reviewed.get(id);
    const oldMembershipIds = sourceProduct.collections?.nodes?.map((item) => item.id) || [];
    const newMembershipIds = liveProduct.collections?.nodes?.map((item) => item.id) || [];
    const oldMembershipSet = set(oldMembershipIds);
    const newMembershipSet = set(newMembershipIds);
    const actualAdded = sorted([...newMembershipSet].filter((value) => !oldMembershipSet.has(value)));
    const actualRemoved = sorted([...oldMembershipSet].filter((value) => !newMembershipSet.has(value)));
    const expectedAdded = record ? record.addMemberships.map((item) => item.collectionGid) : [];
    const expectedRemoved = record ? record.removeMemberships.map((item) => item.collectionGid) : [];
    if (!sameSet(actualAdded, expectedAdded) || !sameSet(actualRemoved, expectedRemoved)) {
      if (actualAdded.length || actualRemoved.length || expectedAdded.length || expectedRemoved.length) {
        issues.push(`${id} has unplanned Product↔Collection membership changes`);
      }
    }
    if (record) {
      if (sourceProduct.handle !== record.handle || sourceProduct.title !== record.title || sourceProduct.status !== record.status) issues.push(`${id} before identity differs from the reviewed manifest`);
      if (!sameSet(sourceProduct.tags, record.beforeTags)) issues.push(`${id} before tags differ from the reviewed manifest`);
      if (!sameSet(oldMembershipIds, record.beforeMembershipIds)) issues.push(`${id} before memberships differ from the reviewed manifest`);
      if (!sameSet(liveProduct.tags, expectedTags(record))) issues.push(`${id} after tags do not equal the approved tag delta`);
      if (!sameSet(newMembershipIds, expectedMembershipIds(record))) issues.push(`${id} after memberships do not equal the approved collection delta`);
      if (stableJson(comparableProduct(sourceProduct)) !== stableJson(comparableProduct(liveProduct))) issues.push(`${id} non-tag product data changed during classification`);
      for (const mapping of [...record.addMemberships, ...record.removeMemberships]) {
        const oldCollection = collectionsBefore.collections.find((item) => item.id === mapping.collectionGid);
        const newCollection = collectionsAfter.collections.find((item) => item.id === mapping.collectionGid);
        assertRule(oldCollection, mapping, `${id} old collection ${mapping.collectionGid}`, issues);
        assertRule(newCollection, mapping, `${id} current collection ${mapping.collectionGid}`, issues);
      }
    }
    for (const removed of actualRemoved) increment(collectionDeltas, removed, -1);
    for (const added of actualAdded) increment(collectionDeltas, added, 1);
  }
  for (const id of afterProducts.keys()) if (!beforeProducts.has(id)) issues.push(`new product ${id} appeared; classification task must not add products`);
  if (reviewed.size !== manifest.records.length) issues.push("duplicate reviewed product GIDs in manifest");

  const oldCollectionMap = new Map(collectionsBefore.collections.map((item) => [item.id, item]));
  const newCollectionMap = new Map(collectionsAfter.collections.map((item) => [item.id, item]));
  if (oldCollectionMap.size !== expectedCollectionCount || newCollectionMap.size !== expectedCollectionCount) issues.push(`collection count changed from the reviewed ${expectedCollectionCount}-collection store`);
  for (const [id, oldCollection] of oldCollectionMap) {
    const current = newCollectionMap.get(id);
    if (!current) {
      issues.push(`collection ${id} disappeared`);
      continue;
    }
    if (oldCollection.handle !== current.handle || oldCollection.title !== current.title || stableJson(oldCollection.ruleSet) !== stableJson(current.ruleSet)) {
      issues.push(`collection identity/rules changed for ${id}`);
    }
    const beforeCount = oldCollection.productsCount?.count;
    if (!Number.isInteger(beforeCount) || beforeCount < 0 || oldCollection.productsCount.precision !== "EXACT") {
      issues.push(`collection ${id} before product count is not an exact non-negative integer`);
    }
    const expectedCount = Number.isInteger(beforeCount) ? beforeCount + (collectionDeltas.get(id) || 0) : null;
    if (current.productsCount?.precision !== "EXACT" || current.productsCount?.count !== expectedCount) {
      issues.push(`collection ${id} exact product count differs from membership delta`);
    }
  }
  for (const id of newCollectionMap.keys()) if (!oldCollectionMap.has(id)) issues.push(`new collection ${id} appeared; collection creation is out of scope`);

  const expectedMembershipDelta = [...collectionDeltas.values()].reduce((sum, value) => sum + value, 0);
  if (after.counts?.collectionMemberships !== before.counts?.collectionMemberships + expectedMembershipDelta) {
    issues.push("aggregate catalog collection-membership count does not match the approved deltas");
  }

  return {
    issues,
    expectedMembershipDelta,
    collectionDeltas: [...collectionDeltas.entries()].map(([collectionGid, delta]) => ({ collectionGid, delta })).sort((a, b) => a.collectionGid.localeCompare(b.collectionGid)),
  };
}

async function main() {
  const paths = parseArgs(process.argv.slice(2));
  const [manifestBytes, beforeBytes, afterBytes, collectionsBeforeBytes, collectionsAfterBytes] = await Promise.all([
    readFile(paths.manifest),
    readFile(paths.before),
    readFile(paths.after),
    readFile(paths["collections-before"]),
    readFile(paths["collections-after"]),
  ]);
  const manifest = JSON.parse(manifestBytes);
  const before = JSON.parse(beforeBytes);
  const after = JSON.parse(afterBytes);
  const collectionsBefore = JSON.parse(collectionsBeforeBytes);
  const collectionsAfter = JSON.parse(collectionsAfterBytes);
  const sourceBeforeHash = hash(beforeBytes);
  const sourceCollectionsBeforeHash = hash(collectionsBeforeBytes);
  const validation = validateClassificationEvidence({
    manifest,
    before,
    after,
    collectionsBefore,
    collectionsAfter,
    sourceBeforeHash,
    sourceCollectionsBeforeHash,
  });
  const { issues, expectedMembershipDelta, collectionDeltas } = validation;

  const report = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    state: issues.length ? "failed" : "verified",
    target: { shopDomain: expectedDomain, shopId: expectedShopId },
    sourceSnapshots: {
      before: { path: paths.before.slice(rootDir.length + 1), createdAt: before?.createdAt ?? null, sha256: sourceBeforeHash },
      after: { path: paths.after.slice(rootDir.length + 1), createdAt: after?.createdAt ?? null, sha256: hash(afterBytes) },
      collectionsBefore: { path: paths["collections-before"].slice(rootDir.length + 1), createdAt: collectionsBefore?.createdAt ?? null, sha256: sourceCollectionsBeforeHash },
      collectionsAfter: { path: paths["collections-after"].slice(rootDir.length + 1), createdAt: collectionsAfter?.createdAt ?? null, sha256: hash(collectionsAfterBytes) },
      manifest: { path: paths.manifest.slice(rootDir.length + 1), sha256: hash(manifestBytes) },
    },
    counts: {
      productsBefore: before.counts?.products ?? null,
      productsAfter: after.counts?.products ?? null,
      variantsBefore: before.counts?.variants ?? null,
      variantsAfter: after.counts?.variants ?? null,
      productMediaBefore: before.counts?.productMedia ?? null,
      productMediaAfter: after.counts?.productMedia ?? null,
      membershipsBefore: before.counts?.collectionMemberships ?? null,
      membershipsAfter: after.counts?.collectionMemberships ?? null,
      expectedMembershipDelta,
    },
    changedProducts: (Array.isArray(manifest?.records) ? manifest.records : []).filter((record) => record && typeof record === "object").map((record) => ({
      productGid: record.productGid,
      handle: record.handle,
      addedTags: [...new Set((Array.isArray(record.addMemberships) ? record.addMemberships : []).map((item) => item?.tag).filter(Boolean))].sort(),
      removedTags: [...new Set((Array.isArray(record.removeMemberships) ? record.removeMemberships : []).map((item) => item?.tag).filter(Boolean))].sort(),
      addedCollectionIds: (Array.isArray(record.addMemberships) ? record.addMemberships : []).map((item) => item?.collectionGid).filter(Boolean),
      removedCollectionIds: (Array.isArray(record.removeMemberships) ? record.removeMemberships : []).map((item) => item?.collectionGid).filter(Boolean),
    })),
    collectionDeltas,
    issues,
  };
  await mkdir(outputDir, { recursive: true });
  const reportPath = join(outputDir, `future-light-collection-classification-reconciliation-${String(after.createdAt || "invalid-timestamp").replaceAll(":", "-")}.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ report: reportPath, state: report.state, counts: report.counts, issues }, null, 2)}\n`);
  if (issues.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`Collection classification reconciliation failed: ${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
