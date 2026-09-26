import test from "node:test";
import assert from "node:assert/strict";

import {
  assertCompletedTagTransition,
  assertCollectionRuleForMembership,
  assertExactSet,
  classifyTagTransition,
  compareSnapshotPreimage,
  computeExpectedTags,
  validateCollectionClassificationManifest,
} from "./future-light-collection-classification.mjs";

const shopDomain = "vs-future-store-0jl2t-jxu6tnr3.myshopify.com";
const productGid = "gid://shopify/Product/100";
const source = {
  docxSha256: "a".repeat(64),
  catalogSnapshotSha256: "b".repeat(64),
  collectionsSnapshotSha256: "c".repeat(64),
};

function makeRecord(overrides = {}) {
  return {
    productGid,
    handle: "example-item",
    status: "ACTIVE",
    title: "Example Item",
    confidence: 0.98,
    familyLane: "Kids toys & toddler learning",
    visualEvidence: "Product gallery clearly shows the item and its intended use.",
    beforeTags: ["pet-supplies", "kids"],
    beforeMembershipIds: ["gid://shopify/Collection/200", "gid://shopify/Collection/201"],
    addMemberships: [{ tag: "kids-toys-games", collectionGid: "gid://shopify/Collection/202" }],
    removeMemberships: [{ tag: "pet-supplies", collectionGid: "gid://shopify/Collection/200" }],
    ...overrides,
  };
}

function makeManifest(record = makeRecord(), overrides = {}) {
  return {
    schemaVersion: 1,
    authorization: "User requested execution of the existing-product family collection classification plan.",
    source,
    target: {
      shopDomain,
      shopId: "gid://shopify/Shop/106570088529",
      apiVersion: "2026-07",
    },
    mutationScope: ["product.tags only"],
    records: [record],
    ...overrides,
  };
}

test("accepts a bounded tag-only manifest for the exact Future Light store", () => {
  assert.equal(validateCollectionClassificationManifest(makeManifest(), { expectedShopDomain: shopDomain }), true);
});

test("rejects any requested non-tag product field before Shopify access", () => {
  const record = makeRecord({ descriptionHtml: "must never be changed" });
  assert.throws(
    () => validateCollectionClassificationManifest(makeManifest(record), { expectedShopDomain: shopDomain }),
    /forbidden field descriptionHtml/,
  );
});

test("rejects a different store, low confidence, non-active product and fallback target", () => {
  assert.throws(() => validateCollectionClassificationManifest(makeManifest(), { expectedShopDomain: "wrong.myshopify.com" }), /target/);
  assert.throws(() => validateCollectionClassificationManifest(makeManifest(makeRecord({ confidence: 0.7 })), { expectedShopDomain: shopDomain }), /confidence floor/);
  assert.throws(() => validateCollectionClassificationManifest(makeManifest(makeRecord({ status: "ARCHIVED" })), { expectedShopDomain: shopDomain }), /non-active/);
  assert.throws(
    () => assertCollectionRuleForMembership(
      { id: "gid://shopify/Collection/698007158865", handle: "classification-fallback", ruleSet: { appliedDisjunctively: false, rules: [{ column: "TAG", relation: "EQUALS", condition: "classification-fallback" }] } },
      { collectionGid: "gid://shopify/Collection/698007158865", tag: "classification-fallback" },
    ),
    /never a valid target/,
  );
});

test("preimage comparison detects stale tags, status, and incomplete membership pages", () => {
  const record = makeRecord();
  const product = {
    id: productGid,
    handle: record.handle,
    title: record.title,
    status: "ACTIVE",
    tags: record.beforeTags,
    collections: { nodes: record.beforeMembershipIds.map((id) => ({ id })), pageInfo: { hasNextPage: false } },
  };
  assert.equal(compareSnapshotPreimage(record, product), true);
  assert.throws(() => compareSnapshotPreimage(record, { ...product, tags: ["kids"] }), /tags do not match/);
  assert.throws(() => compareSnapshotPreimage(record, { ...product, collections: { ...product.collections, pageInfo: { hasNextPage: true } } }), /incomplete/);
  assert.throws(() => compareSnapshotPreimage(record, { ...product, status: "DRAFT" }), /identity does not match/);
});

test("computes exact expected tags and classifies preimage, partial, and completed idempotent transitions", () => {
  const record = makeRecord();
  const after = computeExpectedTags(record);
  assert.deepEqual(after, ["kids", "kids-toys-games"]);
  assert.deepEqual(classifyTagTransition(record, record.beforeTags), {
    state: "preimage",
    tags: ["kids", "pet-supplies"],
    expectedTags: ["kids", "kids-toys-games"],
    expectedMembershipIds: ["gid://shopify/Collection/200", "gid://shopify/Collection/201"],
    addTags: ["kids-toys-games"],
    removeTags: ["pet-supplies"],
  });
  assert.equal(classifyTagTransition(record, ["kids", "pet-supplies", "kids-toys-games"]).state, "partial");
  assert.equal(classifyTagTransition(record, after).state, "complete");
  assert.throws(() => classifyTagTransition(record, [...after, "unexpected"]), /unexpected concurrent tag/);
  assert.throws(() => classifyTagTransition(record, ["kids-toys-games"]), /lost unrelated preimage tag kids/);
});

test("exact readback set comparison rejects missing or extra memberships", () => {
  assert.equal(assertExactSet(["a", "b"], ["b", "a"], "test set"), true);
  assert.throws(() => assertExactSet(["a", "b", "c"], ["a", "b"], "test set"), /mismatch/);
});

test("transient-writer recovery succeeds only after exact completed tags and memberships read back", () => {
  const record = makeRecord();
  const product = {
    tags: computeExpectedTags(record),
    collections: {
      nodes: ["gid://shopify/Collection/201", "gid://shopify/Collection/202"].map((id) => ({ id })),
      pageInfo: { hasNextPage: false },
    },
  };
  assert.equal(assertCompletedTagTransition(record, product).state, "complete");
  assert.throws(
    () => assertCompletedTagTransition(record, { ...product, collections: { ...product.collections, nodes: [{ id: "gid://shopify/Collection/200" }] } }),
    /final collection memberships mismatch/,
  );
  assert.throws(
    () => assertCompletedTagTransition(record, { ...product, collections: { ...product.collections, pageInfo: { hasNextPage: true } } }),
    /pagination is incomplete/,
  );
  assert.throws(() => assertCompletedTagTransition(record, { ...product, tags: record.beforeTags }), /not complete/);
});

test("collection rule accepts one exact TAG EQUALS rule or an explicit tag-only OR destination", () => {
  assert.equal(assertCollectionRuleForMembership(
    { id: "gid://shopify/Collection/202", handle: "kids-toys-games", ruleSet: { appliedDisjunctively: false, rules: [{ column: "TAG", relation: "EQUALS", condition: "kids-toys-games" }] } },
    { collectionGid: "gid://shopify/Collection/202", tag: "kids-toys-games" },
  ), true);
  assert.equal(assertCollectionRuleForMembership(
    { id: "gid://shopify/Collection/203", handle: "gifts", ruleSet: { appliedDisjunctively: true, rules: [
      { column: "TAG", relation: "EQUALS", condition: "gifts" },
      { column: "TAG", relation: "EQUALS", condition: "holiday-gifts" },
    ] } },
    { collectionGid: "gid://shopify/Collection/203", tag: "holiday-gifts" },
  ), true);
  assert.throws(() => assertCollectionRuleForMembership(
    { id: "gid://shopify/Collection/204", handle: "unsafe-mixed", ruleSet: { appliedDisjunctively: true, rules: [
      { column: "TAG", relation: "EQUALS", condition: "holiday-gifts" },
      { column: "PRODUCT_TYPE", relation: "EQUALS", condition: "gift" },
    ] } },
    { collectionGid: "gid://shopify/Collection/204", tag: "holiday-gifts" },
  ), /single exact TAG EQUALS|explicit tag-only OR/);
});

test("one exact routing tag may explicitly drive multiple distinct smart collections", () => {
  const record = makeRecord({
    beforeTags: ["classification-review"],
    beforeMembershipIds: ["gid://shopify/Collection/201"],
    addMemberships: [
      { tag: "holiday-gifts", collectionGid: "gid://shopify/Collection/205" },
      { tag: "holiday-gifts", collectionGid: "gid://shopify/Collection/206" },
    ],
    removeMemberships: [{ tag: "classification-review", collectionGid: "gid://shopify/Collection/201" }],
  });
  assert.equal(validateCollectionClassificationManifest(makeManifest(record), { expectedShopDomain: shopDomain }), true);
  const completed = classifyTagTransition(record, ["holiday-gifts"]);
  assert.deepEqual(completed.addTags, []);
  assert.deepEqual(completed.expectedMembershipIds, ["gid://shopify/Collection/205", "gid://shopify/Collection/206"]);
  assert.throws(() => validateCollectionClassificationManifest(makeManifest({
    ...record,
    addMemberships: [...record.addMemberships, { tag: "another-tag", collectionGid: "gid://shopify/Collection/206" }],
  }), { expectedShopDomain: shopDomain }), /duplicate mapping or collection/);
});
