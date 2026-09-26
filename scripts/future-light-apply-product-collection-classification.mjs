#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { open, readFile, rename, unlink, writeFile, mkdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { hostname } from "node:os";

import { createShopifyAdminGraphQLClient } from "./shopify-admin-graphql-client.mjs";
import { loadFutureLightEnv } from "./lib/future-light-env.mjs";
import {
  assertCompletedTagTransition,
  assertCollectionRuleForMembership,
  assertExactSet,
  classifyTagTransition,
  compareSnapshotPreimage,
  validateCollectionClassificationManifest,
} from "../src/lib/future-light-collection-classification.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const outputDir = join(rootDir, "output");
const lockPath = join(outputDir, "future-light-collection-classification.lock");
const expectedDomain = "vs-future-store-0jl2t-jxu6tnr3.myshopify.com";
const expectedShopId = "gid://shopify/Shop/106570088529";
const maxSnapshotAgeMs = 30 * 60 * 1000;
const membershipPollAttempts = 40;
const membershipPollDelayMs = 1500;

const SHOP_AND_RECORDS_QUERY = /* GraphQL */ `
  query ClassificationPreflight($productIds: [ID!]!, $collectionIds: [ID!]!) {
    shop { id myshopifyDomain }
    products: nodes(ids: $productIds) {
      ... on Product {
        id
        handle
        title
        status
        vendor
        productType
        descriptionHtml
        totalInventory
        category { id name fullName }
        seo { title description }
        tags
        metafields(first: 250) {
          nodes {
            id
            namespace
            key
            type
            value
            reference {
              __typename
              ... on Metaobject { id type handle }
              ... on TaxonomyValue { id name }
            }
          }
          pageInfo { hasNextPage }
        }
        variants(first: 250) {
          nodes {
            id
            legacyResourceId
            title
            sku
            selectedOptions { name value }
            price
            compareAtPrice
            inventoryQuantity
            media(first: 250) {
              nodes { id }
              pageInfo { hasNextPage }
            }
          }
          pageInfo { hasNextPage }
        }
        media(first: 250) {
          nodes {
            id
            __typename
            mediaContentType
            status
            alt
            preview { image { url altText width height } }
            ... on MediaImage { image { url altText width height } }
          }
          pageInfo { hasNextPage }
        }
        collections(first: 250) {
          nodes { id handle title }
          pageInfo { hasNextPage }
        }
        resourcePublications(first: 100, onlyPublished: false) {
          nodes { isPublished publication { id name } }
          pageInfo { hasNextPage }
        }
      }
    }
    collections: nodes(ids: $collectionIds) {
      ... on Collection {
        id
        handle
        title
        ruleSet {
          appliedDisjunctively
          rules { column relation condition }
        }
      }
    }
  }
`;

const TAGS_ADD = /* GraphQL */ `
  mutation ClassificationTagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) { userErrors { field message } }
  }
`;

const TAGS_REMOVE = /* GraphQL */ `
  mutation ClassificationTagsRemove($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) { userErrors { field message } }
  }
`;

function parseArgs(args) {
  let manifestPath = "";
  let mode = "dry-run";
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--manifest") manifestPath = args[++index] || "";
    else if (args[index] === "--apply") mode = "apply";
    else if (args[index] === "--dry-run") mode = "dry-run";
    else throw new Error(`Unknown argument: ${args[index]}`);
  }
  if (!manifestPath) throw new Error("Provide --manifest <reviewed-manifest.json>");
  return { manifestPath: resolve(rootDir, manifestPath), mode };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function completeConnection(connection, label) {
  if (!Array.isArray(connection?.nodes) || connection?.pageInfo?.hasNextPage !== false) {
    throw new Error(`${label} connection is missing or incomplete`);
  }
  return connection.nodes;
}

function publicationProjection(nodes) {
  return nodes
    .map((record) => ({
      isPublished: Boolean(record.isPublished),
      publication: { id: record.publication?.id || null, name: record.publication?.name || null },
    }))
    .sort((a, b) => String(a.publication.id).localeCompare(String(b.publication.id)));
}

function metafieldProjection(nodes) {
  return nodes
    .map((item) => ({
      id: item.id,
      namespace: item.namespace,
      key: item.key,
      type: item.type,
      value: item.value,
      reference: item.reference
        ? {
            typename: item.reference.__typename,
            id: item.reference.id || null,
            type: item.reference.type || null,
            handle: item.reference.handle || null,
            name: item.reference.name || null,
          }
        : null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function mediaProjection(nodes) {
  return nodes.map((item) => ({
    id: item.id,
    typename: item.__typename,
    mediaContentType: item.mediaContentType,
    status: item.status,
    alt: item.alt || "",
    preview: item.preview?.image
      ? { url: item.preview.image.url, altText: item.preview.image.altText || "", width: item.preview.image.width, height: item.preview.image.height }
      : null,
    image: item.image
      ? { url: item.image.url, altText: item.image.altText || "", width: item.image.width, height: item.image.height }
      : null,
  }));
}

function variantProjection(nodes) {
  return nodes.map((variant) => ({
    id: variant.id,
    legacyResourceId: variant.legacyResourceId,
    title: variant.title,
    sku: variant.sku,
    selectedOptions: variant.selectedOptions,
    price: variant.price,
    compareAtPrice: variant.compareAtPrice,
    inventoryQuantity: variant.inventoryQuantity,
    mediaIds: completeConnection(variant.media, `variant ${variant.id} media`).map((item) => item.id),
  }));
}

function productUnchangedProjection(product) {
  const variants = completeConnection(product.variants, `product ${product.id} variants`);
  const media = completeConnection(product.media, `product ${product.id} media`);
  const collections = completeConnection(product.collections, `product ${product.id} collections`);
  const publications = completeConnection(product.resourcePublications, `product ${product.id} publications`);
  const metafields = completeConnection(product.metafields, `product ${product.id} metafields`);
  return {
    id: product.id,
    handle: product.handle,
    title: product.title,
    status: product.status,
    vendor: product.vendor,
    productType: product.productType,
    descriptionHtml: product.descriptionHtml,
    totalInventory: product.totalInventory,
    category: product.category ? { id: product.category.id, name: product.category.name, fullName: product.category.fullName } : null,
    seo: product.seo ? { title: product.seo.title, description: product.seo.description } : null,
    metafields: metafieldProjection(metafields),
    variants: variantProjection(variants),
    media: mediaProjection(media),
    collectionMembershipReadComplete: true,
    resourcePublications: publicationProjection(publications),
  };
}

function snapshotUnchangedProjection(product) {
  const variants = completeConnection(product.variants, `snapshot product ${product.id} variants`);
  const media = completeConnection(product.media, `snapshot product ${product.id} media`);
  const publications = completeConnection(product.resourcePublications, `snapshot product ${product.id} publications`);
  const metafields = completeConnection(product.metafields, `snapshot product ${product.id} metafields`);
  completeConnection(product.collections, `snapshot product ${product.id} collections`);
  return {
    id: product.id,
    handle: product.handle,
    title: product.title,
    status: product.status,
    vendor: product.vendor,
    productType: product.productType,
    descriptionHtml: product.descriptionHtml,
    totalInventory: product.totalInventory,
    category: product.category ? { id: product.category.id, name: product.category.name, fullName: product.category.fullName } : null,
    seo: product.seo ? { title: product.seo.title, description: product.seo.description } : null,
    metafields: metafieldProjection(metafields),
    variants: variantProjection(variants),
    media: mediaProjection(media),
    collectionMembershipReadComplete: true,
    resourcePublications: publicationProjection(publications),
  };
}

function assertSnapshotCoverage(snapshot, label) {
  const required = ["products", "productStatuses", "productVariants", "productMedia", "variantMediaAssociations", "collectionMemberships", "resourcePublications"];
  for (const key of required) {
    if (snapshot.coverage?.[key] !== "complete") throw new Error(`${label} coverage ${key} is not complete`);
  }
}

function ageMs(iso) {
  const parsed = Date.parse(iso || "");
  if (!Number.isFinite(parsed)) throw new Error("Source snapshot has an invalid createdAt time");
  return Date.now() - parsed;
}

async function loadSourceAndManifest(manifestPath) {
  const manifestText = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestText);
  validateCollectionClassificationManifest(manifest, { expectedShopDomain: expectedDomain });
  const paths = {
    docx: resolve(rootDir, manifest.source.docx),
    catalog: resolve(rootDir, manifest.source.catalogSnapshot),
    collections: resolve(rootDir, manifest.source.collectionsSnapshot),
  };
  const [docxBytes, catalogBytes, collectionsBytes] = await Promise.all([
    readFile(paths.docx),
    readFile(paths.catalog),
    readFile(paths.collections),
  ]);
  if (sha256(docxBytes) !== manifest.source.docxSha256) throw new Error("DOCX source hash no longer matches the reviewed source");
  if (sha256(catalogBytes) !== manifest.source.catalogSnapshotSha256) throw new Error("Catalog snapshot hash no longer matches the reviewed source");
  if (sha256(collectionsBytes) !== manifest.source.collectionsSnapshotSha256) throw new Error("Collections snapshot hash no longer matches the reviewed source");
  const catalog = JSON.parse(catalogBytes);
  const collections = JSON.parse(collectionsBytes);
  if (catalog.shopDomain !== expectedDomain || catalog.apiVersion !== manifest.target.apiVersion) throw new Error("Catalog snapshot target/version mismatch");
  if (collections.shop?.id !== expectedShopId || collections.shop?.myshopifyDomain !== expectedDomain || collections.apiVersion !== manifest.target.apiVersion) {
    throw new Error("Collection snapshot target/version mismatch");
  }
  assertSnapshotCoverage(catalog, "Catalog");
  if (!Array.isArray(collections.collections) || collections.collections.length !== 115) throw new Error("Collection snapshot is not the reviewed complete 115-collection set");
  if (ageMs(catalog.createdAt) < 0 || ageMs(catalog.createdAt) > maxSnapshotAgeMs) throw new Error("Catalog snapshot is older than the 30-minute write window; refresh it before applying");
  if (ageMs(collections.createdAt) < 0 || ageMs(collections.createdAt) > maxSnapshotAgeMs) throw new Error("Collection snapshot is older than the 30-minute write window; refresh it before applying");
  const byProductId = new Map(catalog.products.map((product) => [product.id, product]));
  const byCollectionId = new Map(collections.collections.map((collection) => [collection.id, collection]));
  for (const record of manifest.records) compareSnapshotPreimage(record, byProductId.get(record.productGid));
  return { manifest, catalog, collections, byProductId, byCollectionId };
}

function collectionIdsForRecord(record) {
  return [...new Set([
    ...record.beforeMembershipIds,
    ...record.addMemberships.map((item) => item.collectionGid),
    ...record.removeMemberships.map((item) => item.collectionGid),
  ])].sort();
}

function ruleCollectionsForRecord(record) {
  return [...record.addMemberships, ...record.removeMemberships];
}

function validateLocalRules(record, collectionIndex) {
  for (const mapping of ruleCollectionsForRecord(record)) {
    const collection = collectionIndex.get(mapping.collectionGid);
    assertCollectionRuleForMembership(collection, mapping);
  }
}

async function fetchLiveRecord(client, record) {
  const ids = collectionIdsForRecord(record);
  const data = await client.run(SHOP_AND_RECORDS_QUERY, {
    productIds: [record.productGid],
    collectionIds: ids,
  }, { operation: `read exact collection-classification preimage ${record.productGid}` });
  if (data.shop?.id !== expectedShopId || data.shop?.myshopifyDomain !== expectedDomain) {
    throw new Error(`Live Shopify Shop identity mismatch for ${record.productGid}`);
  }
  const product = data.products?.find((item) => item?.id === record.productGid);
  if (!product) throw new Error(`Live Shopify product ${record.productGid} is missing or inaccessible`);
  const collections = new Map((data.collections || []).filter(Boolean).map((item) => [item.id, item]));
  if (collections.size !== ids.length) throw new Error(`Live target/membership collection read is incomplete for ${record.productGid}`);
  for (const mapping of ruleCollectionsForRecord(record)) assertCollectionRuleForMembership(collections.get(mapping.collectionGid), mapping);
  return { product, collections };
}

function assertLiveProductIdentity(record, product) {
  if (product.id !== record.productGid || product.handle !== record.handle || product.title !== record.title || product.status !== record.status) {
    throw new Error(`Live product identity/status changed for ${record.productGid}; no mutation made`);
  }
}

function assertUnchangedAgainstSnapshot(snapshotProduct, liveProduct, label) {
  const snapshot = snapshotUnchangedProjection(snapshotProduct);
  const live = productUnchangedProjection(liveProduct);
  if (stableJson(snapshot) !== stableJson(live)) {
    throw new Error(`${label} has non-tag drift from the reviewed live snapshot; no mutation made`);
  }
}

function expectedMembershipsForTagState(record, transition) {
  return transition.expectedMembershipIds;
}

function assertLiveTransition(record, product) {
  const currentMembershipIds = completeConnection(product.collections, `product ${product.id} collections`).map((collection) => collection.id);
  const transition = classifyTagTransition(record, product.tags || []);
  assertExactSet(currentMembershipIds, expectedMembershipsForTagState(record, transition), `${record.productGid} interim collection membership`);
  return transition;
}

function userErrorsOrThrow(payload, label) {
  const errors = payload?.userErrors || [];
  if (errors.length) {
    throw new Error(`${label}: ${errors.map((item) => item.message || "Shopify user error").join(" | ")}`);
  }
}

async function waitForTransition(client, record, { expectedState = "complete" } = {}) {
  let latest;
  for (let attempt = 0; attempt < membershipPollAttempts; attempt += 1) {
    const live = await fetchLiveRecord(client, record);
    assertLiveProductIdentity(record, live.product);
    const transition = classifyTagTransition(record, live.product.tags || []);
    try {
      assertExactSet(
        completeConnection(live.product.collections, `product ${record.productGid} collections`).map((collection) => collection.id),
        expectedMembershipsForTagState(record, transition),
        `${record.productGid} collection membership for current tag state`,
      );
      if (transition.state === expectedState || (expectedState === "complete" && transition.state === "complete")) {
        return { ...live, transition };
      }
      latest = `${record.productGid} tags are ${transition.state}, waiting for requested ${expectedState} state`;
    } catch (error) {
      latest = error.message;
    }
    if (attempt + 1 < membershipPollAttempts) await new Promise((resolveDelay) => setTimeout(resolveDelay, membershipPollDelayMs));
  }
  throw new Error(latest || `Timed out waiting for Shopify collection readback for ${record.productGid}`);
}

async function mutateTags(client, record, addTags, removeTags) {
  if (addTags.length) {
    const result = await client.run(TAGS_ADD, { id: record.productGid, tags: addTags }, {
      allowMutations: true,
      operation: `add exact family collection route tags to ${record.productGid}`,
    });
    userErrorsOrThrow(result.tagsAdd, `Shopify tagsAdd ${record.productGid}`);
  }
  if (removeTags.length) {
    const result = await client.run(TAGS_REMOVE, { id: record.productGid, tags: removeTags }, {
      allowMutations: true,
      operation: `remove exact incorrect collection route tags from ${record.productGid}`,
    });
    userErrorsOrThrow(result.tagsRemove, `Shopify tagsRemove ${record.productGid}`);
  }
}

let lockHandle;
async function acquireLock() {
  await mkdir(outputDir, { recursive: true });
  lockHandle = await open(lockPath, "wx", 0o600);
  await lockHandle.writeFile(`${JSON.stringify({ pid: process.pid, host: hostname(), startedAt: new Date().toISOString(), runner: basename(import.meta.filename) })}\n`);
}

async function releaseLock() {
  if (!lockHandle) return;
  await lockHandle.close();
  lockHandle = null;
  await unlink(lockPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
}

async function persistReceipt(path, receipt) {
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  await rename(tempPath, path);
}

async function run() {
  const { manifestPath, mode } = parseArgs(process.argv.slice(2));
  const loaded = await loadSourceAndManifest(manifestPath);
  const { manifest, byProductId, byCollectionId } = loaded;
  for (const record of manifest.records) validateLocalRules(record, byCollectionId);

  await loadFutureLightEnv({ rootDir });
  const client = createShopifyAdminGraphQLClient({ rootDir, agentName: "existing-product-collection-classification" });
  if (client.storeDomain !== expectedDomain || client.apiVersion !== manifest.target.apiVersion) {
    throw new Error("Configured Shopify CLI target/API version does not match the reviewed manifest");
  }

  const receiptPath = join(outputDir, `future-light-collection-classification-${new Date().toISOString().replaceAll(":", "-")}-${process.pid}.json`);
  const receipt = {
    schemaVersion: 1,
    runId: randomUUID(),
    mode,
    startedAt: new Date().toISOString(),
    target: manifest.target,
    manifest: manifestPath.slice(rootDir.length + 1),
    source: manifest.source,
    state: mode === "apply" ? "running" : "dry-run-complete",
    results: [],
  };

  if (mode === "apply") await acquireLock();
  try {
    for (const record of manifest.records) {
      const resultRecord = {
        productGid: record.productGid,
        handle: record.handle,
        familyLane: record.familyLane,
        addedTags: [...new Set(record.addMemberships.map((item) => item.tag))].sort(),
        removedTags: [...new Set(record.removeMemberships.map((item) => item.tag))].sort(),
        state: "preflight",
      };
      receipt.results.push(resultRecord);
      try {
        const snapshotProduct = byProductId.get(record.productGid);
        let before = await fetchLiveRecord(client, record);
        assertLiveProductIdentity(record, before.product);
        assertUnchangedAgainstSnapshot(snapshotProduct, before.product, record.productGid);
        let transition = classifyTagTransition(record, before.product.tags || []);
        if (transition.state !== "preimage") {
          before = await waitForTransition(client, record, { expectedState: transition.state });
          transition = before.transition;
        } else {
          transition = assertLiveTransition(record, before.product);
        }
        resultRecord.beforeTags = transition.tags;
        resultRecord.beforeMembershipIds = completeConnection(before.product.collections, `product ${record.productGid} collections`).map((item) => item.id).sort();

        if (mode === "dry-run") {
          resultRecord.state = transition.state === "complete" ? "already-complete" : "ready";
          resultRecord.expectedTags = transition.expectedTags;
          resultRecord.currentStateMembershipIds = transition.expectedMembershipIds;
          resultRecord.expectedAfterMembershipIds = classifyTagTransition(record, transition.expectedTags).expectedMembershipIds;
          continue;
        }

        if (transition.state !== "complete") {
          await mutateTags(client, record, transition.addTags, transition.removeTags);
        }
        const after = await waitForTransition(client, record, { expectedState: "complete" });
        const finalTransition = assertCompletedTagTransition(record, after.product);
        assertUnchangedAgainstSnapshot(snapshotProduct, after.product, record.productGid);
        resultRecord.state = transition.state === "complete" ? "already-complete" : "verified";
        resultRecord.afterTags = after.product.tags;
        resultRecord.afterMembershipIds = completeConnection(after.product.collections, `product ${record.productGid} collections`).map((item) => item.id).sort();
        resultRecord.nonTagFieldsUnchanged = true;
        resultRecord.verifiedAt = new Date().toISOString();
      } catch (error) {
        const originalError = String(error?.message || error);
        try {
          const observed = await fetchLiveRecord(client, record);
          assertLiveProductIdentity(record, observed.product);
          const observedTransition = assertCompletedTagTransition(record, observed.product);
          assertUnchangedAgainstSnapshot(byProductId.get(record.productGid), observed.product, record.productGid);
          resultRecord.state = "verified-after-transient-readback";
          resultRecord.afterTags = observedTransition.expectedTags;
          resultRecord.afterMembershipIds = completeConnection(observed.product.collections, `product ${record.productGid} collections`).map((item) => item.id).sort();
          resultRecord.nonTagFieldsUnchanged = true;
          resultRecord.recoveredFrom = originalError;
          resultRecord.verifiedAt = new Date().toISOString();
        } catch (readbackError) {
          resultRecord.state = "failed-stop";
          resultRecord.error = originalError;
          resultRecord.observedAfterFailure = {
            readbackError: String(readbackError?.message || readbackError),
          };
          try {
            const observed = await fetchLiveRecord(client, record);
            const observedTransition = classifyTagTransition(record, observed.product.tags || []);
            resultRecord.observedAfterFailure = {
              tags: observedTransition.tags,
              state: observedTransition.state,
              collectionIds: completeConnection(observed.product.collections, `product ${record.productGid} collections`).map((item) => item.id).sort(),
            };
          } catch (finalReadbackError) {
            resultRecord.observedAfterFailure.finalReadbackError = String(finalReadbackError?.message || finalReadbackError);
          }
          receipt.state = "failed-stop";
          receipt.error = originalError;
          receipt.updatedAt = new Date().toISOString();
          await persistReceipt(receiptPath, receipt);
          throw error;
        }
        receipt.updatedAt = new Date().toISOString();
        await persistReceipt(receiptPath, receipt);
      }
      receipt.updatedAt = new Date().toISOString();
      await persistReceipt(receiptPath, receipt);
    }
    receipt.state = mode === "apply" ? "complete" : "dry-run-complete";
    receipt.completedAt = new Date().toISOString();
    await persistReceipt(receiptPath, receipt);
    process.stdout.write(`${JSON.stringify({ receipt: receiptPath, state: receipt.state, results: receipt.results }, null, 2)}\n`);
  } finally {
    await releaseLock();
  }
}

run().catch((error) => {
  process.stderr.write(`Collection classification stopped safely: ${error?.message || error}\n`);
  process.exitCode = 1;
});
