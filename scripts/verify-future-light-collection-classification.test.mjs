import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";

import { validateClassificationEvidence } from "./verify-future-light-collection-classification.mjs";

const NOW = Date.parse("2026-09-28T12:00:00.000Z");
const SHOP_DOMAIN = "vs-future-store-0jl2t-jxu6tnr3.myshopify.com";
const SHOP_ID = "gid://shopify/Shop/106570088529";
const OLD_COLLECTION_ID = "gid://shopify/Collection/1001";
const NEW_COLLECTION_ID = "gid://shopify/Collection/1002";

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function makeProduct(index, after = false) {
  const id = `gid://shopify/Product/${2000 + index}`;
  return {
    id,
    handle: `fixture-product-${index}`,
    title: `Fixture product ${index}`,
    status: "ACTIVE",
    productType: "Fixture",
    tags: after ? ["new-route"] : ["old-route"],
    collections: {
      nodes: [{ id: after ? NEW_COLLECTION_ID : OLD_COLLECTION_ID }],
      pageInfo: { hasNextPage: false },
    },
  };
}

function makeCollection(index, { before, productCount }) {
  const isOld = index === 1;
  const isNew = index === 2;
  const id = isOld ? OLD_COLLECTION_ID : isNew ? NEW_COLLECTION_ID : `gid://shopify/Collection/${1000 + index}`;
  const tag = isOld ? "old-route" : isNew ? "new-route" : `fixture-route-${index}`;
  return {
    id,
    handle: `fixture-collection-${index}`,
    title: `Fixture collection ${index}`,
    ruleSet: {
      appliedDisjunctively: false,
      rules: [{ column: "TAG", relation: "EQUALS", condition: tag }],
    },
    productsCount: {
      count: isOld ? (before ? productCount : 0) : isNew ? (before ? 0 : productCount) : 0,
      precision: "EXACT",
    },
  };
}

function makeRecord(index) {
  return {
    productGid: `gid://shopify/Product/${2000 + index}`,
    handle: `fixture-product-${index}`,
    status: "ACTIVE",
    title: `Fixture product ${index}`,
    confidence: 0.99,
    familyLane: "Fixture classification lane",
    visualEvidence: "Reviewed fixture gallery and options; evidence confirms this fixture product identity.",
    beforeTags: ["old-route"],
    beforeMembershipIds: [OLD_COLLECTION_ID],
    addMemberships: [{ tag: "new-route", collectionGid: NEW_COLLECTION_ID }],
    removeMemberships: [{ tag: "old-route", collectionGid: OLD_COLLECTION_ID }],
  };
}

function makeFixture({ productCount = 1 } = {}) {
  const beforeProducts = Array.from({ length: productCount }, (_, index) => makeProduct(index + 1));
  const afterProducts = Array.from({ length: productCount }, (_, index) => makeProduct(index + 1, true));
  const coverage = {
    products: "complete",
    productStatuses: "complete",
    productVariants: "complete",
    productMedia: "complete",
    variantMediaAssociations: "complete",
    productMetafields: "complete",
    productMetafieldReferences: "complete",
    collectionMemberships: "complete",
    resourcePublications: "complete",
  };
  const counts = {
    products: productCount,
    variants: productCount,
    productMedia: productCount,
    productMetafields: 0,
    resourcePublications: 0,
    collectionMemberships: productCount,
  };
  const before = {
    createdAt: new Date(NOW - 2 * 60 * 60 * 1000).toISOString(),
    shopDomain: SHOP_DOMAIN,
    apiVersion: "2026-07",
    coverage: structuredClone(coverage),
    counts: structuredClone(counts),
    products: beforeProducts,
  };
  const after = {
    createdAt: new Date(NOW - 30 * 60 * 1000).toISOString(),
    shopDomain: SHOP_DOMAIN,
    apiVersion: "2026-07",
    coverage: structuredClone(coverage),
    counts: structuredClone(counts),
    products: afterProducts,
  };
  const makeCollectionSnapshot = (beforeSnapshot) => {
    const collections = Array.from({ length: 115 }, (_, index) => makeCollection(index + 1, {
      before: beforeSnapshot,
      productCount,
    }));
    return {
      createdAt: new Date(NOW - (beforeSnapshot ? 110 : 20) * 60 * 1000).toISOString(),
      shop: { id: SHOP_ID, myshopifyDomain: SHOP_DOMAIN },
      apiVersion: "2026-07",
      pagination: { complete: true, pageSize: 100 },
      summary: { collections: 115 },
      collectionRecords: 115,
      collections,
    };
  };
  const collectionsBefore = makeCollectionSnapshot(true);
  const collectionsAfter = makeCollectionSnapshot(false);
  const manifest = {
    schemaVersion: 1,
    purpose: "Fixture-only collection classification verification",
    authorization: "User requested execution of the fixture verifier contract test.",
    mutationScope: ["product.tags only"],
    target: { shopDomain: SHOP_DOMAIN, shopId: SHOP_ID, apiVersion: "2026-07" },
    source: {
      docxSha256: "a".repeat(64),
      catalogSnapshot: "before-catalog.json",
      catalogSnapshotSha256: "",
      collectionsSnapshot: "before-collections.json",
      collectionsSnapshotSha256: "",
    },
    records: Array.from({ length: productCount }, (_, index) => makeRecord(index + 1)),
  };
  const input = () => {
    const sourceBeforeHash = sha256(before);
    const sourceCollectionsBeforeHash = sha256(collectionsBefore);
    manifest.source.catalogSnapshotSha256 = sourceBeforeHash;
    manifest.source.collectionsSnapshotSha256 = sourceCollectionsBeforeHash;
    return {
      manifest,
      before,
      after,
      collectionsBefore,
      collectionsAfter,
      sourceBeforeHash,
      sourceCollectionsBeforeHash,
      now: NOW,
    };
  };
  return { manifest, before, after, collectionsBefore, collectionsAfter, input };
}

function issuesFor(fixture) {
  return validateClassificationEvidence(fixture.input()).issues;
}

test("accepts a complete, fresh, ordered classification evidence fixture", () => {
  assert.deepEqual(issuesFor(makeFixture()), []);
});

test("rejects an empty classification record list", () => {
  const fixture = makeFixture();
  fixture.manifest.records = [];
  assert.match(issuesFor(fixture).join("\n"), /no classification records/i);
});

test("rejects duplicate reviewed product records", () => {
  const fixture = makeFixture();
  fixture.manifest.records.push(structuredClone(fixture.manifest.records[0]));
  assert.match(issuesFor(fixture).join("\n"), /duplicate Product GID/i);
});

test("rejects a changed product omitted from the reviewed manifest", () => {
  const fixture = makeFixture({ productCount: 2 });
  fixture.manifest.records.pop();
  assert.match(issuesFor(fixture).join("\n"), /unplanned Product↔Collection membership changes/i);
});

test("rejects a product missing from the after snapshot", () => {
  const fixture = makeFixture();
  fixture.after.products = [];
  fixture.after.counts.products = 0;
  fixture.after.counts.collectionMemberships = 0;
  assert.match(issuesFor(fixture).join("\n"), /disappeared from the after snapshot/i);
});

test("rejects omitted required snapshot coverage dimensions", () => {
  const fixture = makeFixture();
  delete fixture.after.coverage.collectionMemberships;
  assert.match(issuesFor(fixture).join("\n"), /after catalog coverage collectionMemberships is missing or incomplete/i);
});

test("rejects catalog counts that do not match the snapshot product records", () => {
  const fixture = makeFixture();
  fixture.after.counts.products += 1;
  assert.match(issuesFor(fixture).join("\n"), /after catalog product count does not match its product records/i);
});

test("rejects aggregate membership counts that do not match exact product memberships", () => {
  const fixture = makeFixture();
  fixture.after.counts.collectionMemberships += 1;
  assert.match(issuesFor(fixture).join("\n"), /after catalog membership count does not match its product records/i);
});

test("rejects evidence older than the freshness window", () => {
  const fixture = makeFixture();
  fixture.before.createdAt = new Date(NOW - 25 * 60 * 60 * 1000).toISOString();
  assert.match(issuesFor(fixture).join("\n"), /before catalog snapshot evidence is stale/i);
  fixture.before.createdAt = new Date(NOW - 2 * 60 * 60 * 1000).toISOString();
  fixture.collectionsAfter.createdAt = new Date(NOW - 25 * 60 * 60 * 1000).toISOString();
  assert.match(issuesFor(fixture).join("\n"), /after collections snapshot evidence is stale/i);
});

test("rejects reversed before and after snapshot timestamps", () => {
  const fixture = makeFixture();
  const originalBefore = fixture.before.createdAt;
  fixture.before.createdAt = fixture.after.createdAt;
  fixture.after.createdAt = originalBefore;
  assert.match(issuesFor(fixture).join("\n"), /after catalog snapshot does not follow the before snapshot/i);

  const collectionFixture = makeFixture();
  const originalCollectionsBefore = collectionFixture.collectionsBefore.createdAt;
  collectionFixture.collectionsBefore.createdAt = collectionFixture.collectionsAfter.createdAt;
  collectionFixture.collectionsAfter.createdAt = originalCollectionsBefore;
  assert.match(issuesFor(collectionFixture).join("\n"), /after collections snapshot does not follow the before snapshot/i);
});
