import test from "node:test";
import assert from "node:assert/strict";
import {
  assertFutureLightApprovedCopyWrites,
  assertFutureLightCopyPreimage,
  assertFutureLightCopyReadback,
  createFutureLightApprovedCopyManifest,
  FUTURE_LIGHT_SHOP_DOMAIN,
} from "./future-light-approved-copy-manifest.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function fixture() {
  const products = [
    {
      id: "gid://shopify/Product/101",
      status: "ACTIVE",
      title: "Accurate Existing Product Title",
      descriptionHtml: "<p>Carefully reviewed description.</p>",
      seo: { title: null, description: "Existing search description." },
    },
    {
      id: "gid://shopify/Product/202",
      status: "ACTIVE",
      title: "Generic Old Title",
      descriptionHtml: "<p>Generic filler.</p>",
      seo: { title: null, description: null },
    },
  ];
  const snapshot = {
    shopDomain: FUTURE_LIGHT_SHOP_DOMAIN,
    apiVersion: "2026-07",
    counts: { products: products.length },
    coverage: { products: "complete" },
    products,
  };
  const decisions = [
    {
      productId: products[0].id,
      decision: "approved_keep",
      reason: "Image and independent product facts support the current copy.",
      reviewer: "codex-visual-pilot",
      evidenceFingerprint: HASH_A,
    },
    {
      productId: products[1].id,
      decision: "needs_rewrite",
      reason: "Current title and description are generic and omit the verified item identity.",
      reviewer: "codex-visual-pilot",
      evidenceFingerprint: HASH_B,
      proposal: {
        title: "Compact Desk Phone Stand",
        descriptionHtml: "<p>A compact stand keeps a phone upright on a desk.</p>",
      },
      claimLedger: [
        {
          claimId: "what-it-is",
          text: "A compact stand holds a phone upright on a desk.",
          evidence: [
            {
              kind: "product-image",
              sourceId: "gid://shopify/MediaImage/9001",
              sourceSha256: HASH_A,
            },
            {
              kind: "shopify-variant",
              sourceId: "gid://shopify/ProductVariant/2021",
              sourceSha256: HASH_B,
            },
          ],
        },
      ],
    },
  ];
  return { products, snapshot, decisions };
}

function makeManifest(overrides = {}) {
  const data = fixture();
  return createFutureLightApprovedCopyManifest({
    snapshot: data.snapshot,
    sourceSnapshotSha256: HASH_A,
    decisions: data.decisions,
    createdAt: "2026-09-25T20:05:00.000Z",
    ...overrides,
  });
}

test("full manifest freezes approved_keep copy exactly and permits only the exact rewrite proposal", () => {
  const { products } = fixture();
  const manifest = makeManifest();
  assert.equal(manifest.products.length, products.length);
  assert.equal(manifest.products[0].decision, "approved_keep");
  assert.equal(manifest.products[0].beforeImage.title, "Accurate Existing Product Title");
  assertFutureLightCopyPreimage(manifest, products);
  assertFutureLightApprovedCopyWrites(manifest, [{
    productId: products[1].id,
    fields: {
      title: "Compact Desk Phone Stand",
      descriptionHtml: "<p>A compact stand keeps a phone upright on a desk.</p>",
    },
  }]);

  const expectedReadback = [
    products[0],
    {
      ...products[1],
      title: "Compact Desk Phone Stand",
      descriptionHtml: "<p>A compact stand keeps a phone upright on a desk.</p>",
    },
  ];
  assertFutureLightCopyReadback(manifest, expectedReadback);
});

test("approved_keep, held, unapproved fields, and altered proposal values cannot be written", () => {
  const { products } = fixture();
  const manifest = makeManifest();
  assert.throws(
    () => assertFutureLightApprovedCopyWrites(manifest, [{ productId: products[0].id, fields: { title: "Changed" } }]),
    /forbidden for approved_keep/,
  );
  assert.throws(
    () => assertFutureLightApprovedCopyWrites(manifest, [{ productId: products[1].id, fields: { vendor: "VS Store" } }]),
    /was not approved/,
  );
  assert.throws(
    () => assertFutureLightApprovedCopyWrites(manifest, [{ productId: products[1].id, fields: { title: "Different title" } }]),
    /differs from the approved proposal/,
  );
  assert.throws(
    () => assertFutureLightApprovedCopyWrites(manifest, [
      { productId: products[1].id, fields: { title: "Compact Desk Phone Stand" } },
      { productId: products[1].id, fields: { title: "Compact Desk Phone Stand" } },
    ]),
    /Duplicate copy write/,
  );
});

test("manifest refuses missing, duplicate, foreign, partial, or changed live preimages", () => {
  const { products, snapshot, decisions } = fixture();
  assert.throws(() => makeManifest({ snapshot: { ...snapshot, shopDomain: "wrong.myshopify.com" } }), /exact Future Light/);
  assert.throws(() => makeManifest({ decisions: decisions.slice(0, 1) }), /Missing content decision/);
  assert.throws(() => makeManifest({ decisions: [...decisions, decisions[0]] }), /decision for/);

  const manifest = makeManifest();
  assert.throws(() => assertFutureLightCopyPreimage(manifest, products.slice(0, 1)), /count does not match/);
  assert.throws(
    () => assertFutureLightCopyPreimage(manifest, [{ ...products[0], title: "Externally changed" }, products[1]]),
    /preimage changed/,
  );
  assert.throws(
    () => assertFutureLightCopyPreimage(manifest, [{ ...products[0], status: "ARCHIVED" }, products[1]]),
    /status changed/,
  );
});

test("rewrites require a claim ledger backed by independent, hash-bound evidence", () => {
  const { snapshot, decisions } = fixture();
  const noLedger = structuredClone(decisions);
  delete noLedger[1].claimLedger;
  assert.throws(() => makeManifest({ decisions: noLedger }), /claim-by-claim evidence ledger/);

  const selfEvidence = structuredClone(decisions);
  selfEvidence[1].claimLedger[0].evidence[0].kind = "generated-copy";
  assert.throws(() => makeManifest({ decisions: selfEvidence }), /not an allowed independent source/);

  const missingDigest = structuredClone(decisions);
  missingDigest[1].claimLedger[0].evidence[0].sourceSha256 = "stale";
  assert.throws(() => makeManifest({ decisions: missingDigest }), /SHA-256 digest/);

  const noWriteForKeep = structuredClone(decisions);
  noWriteForKeep[0].proposal = { title: "Rewrite" };
  assert.throws(() => makeManifest({ snapshot, decisions: noWriteForKeep }), /cannot contain proposed copy/);
});

test("held products preserve copy and never receive a rewrite proposal", () => {
  const { products, snapshot, decisions } = fixture();
  decisions[1] = {
    productId: products[1].id,
    decision: "held",
    reason: "Variant identity is not visually resolved.",
    reviewer: "codex-visual-pilot",
    evidenceFingerprint: HASH_B,
  };
  const manifest = createFutureLightApprovedCopyManifest({
    snapshot,
    sourceSnapshotSha256: HASH_A,
    decisions,
    createdAt: "2026-09-25T20:05:00.000Z",
  });
  assert.throws(
    () => assertFutureLightApprovedCopyWrites(manifest, [{ productId: products[1].id, fields: { title: "Guess" } }]),
    /forbidden for held/,
  );
  assertFutureLightCopyReadback(manifest, products);
});

test("bounded pilot manifest freezes only its explicit cohort and refuses out-of-scope writes", () => {
  const { products, snapshot, decisions } = fixture();
  const pilotProduct = products[1];
  const manifest = createFutureLightApprovedCopyManifest({
    snapshot,
    sourceSnapshotSha256: HASH_A,
    scopeProductIds: [pilotProduct.id],
    decisions: [decisions[1]],
    createdAt: "2026-09-25T20:05:00.000Z",
  });

  assert.equal(manifest.scope.type, "bounded-pilot");
  assert.deepEqual(manifest.scope.productIds, [pilotProduct.id]);
  assert.equal(manifest.sourceSnapshot.productCount, snapshot.products.length);
  assert.equal(manifest.products.length, 1);
  assertFutureLightCopyPreimage(manifest, [pilotProduct]);
  assertFutureLightApprovedCopyWrites(manifest, [{
    productId: pilotProduct.id,
    fields: { title: "Compact Desk Phone Stand" },
  }]);
  assert.throws(() => assertFutureLightCopyPreimage(manifest, products), /count does not match/);
  assert.throws(
    () => assertFutureLightApprovedCopyWrites(manifest, [{ productId: products[0].id, fields: { title: "Changed" } }]),
    /outside the approved manifest/,
  );
  assertFutureLightCopyReadback(manifest, [{
    ...pilotProduct,
    title: "Compact Desk Phone Stand",
    descriptionHtml: "<p>A compact stand keeps a phone upright on a desk.</p>",
  }]);
});

test("bounded pilot scope rejects duplicate and foreign product IDs and omitted decisions", () => {
  const { products, snapshot, decisions } = fixture();
  const createPilot = (scopeProductIds, selectedDecisions) => createFutureLightApprovedCopyManifest({
    snapshot,
    sourceSnapshotSha256: HASH_A,
    scopeProductIds,
    decisions: selectedDecisions,
    createdAt: "2026-09-25T20:05:00.000Z",
  });

  assert.throws(() => createPilot([products[1].id, products[1].id], [decisions[1]]), /duplicate product IDs/);
  assert.throws(() => createPilot(["gid://shopify/Product/999"], []), /outside the frozen catalog/);
  assert.throws(() => createPilot([products[1].id], []), /Missing content decision/);
  assert.throws(() => createPilot([products[0].id], decisions), /outside the declared copy-manifest scope/);
});

test("every gate rejects copy-manifest tampering after approval", () => {
  const { products } = fixture();
  const original = makeManifest();
  const changed = structuredClone(original);
  changed.products[1].proposal.title = "Unreviewed replacement title";

  assert.throws(() => assertFutureLightCopyPreimage(changed, products), /fingerprint mismatch/);
  assert.throws(() => assertFutureLightApprovedCopyWrites(changed, [{
    productId: products[1].id,
    fields: { title: "Unreviewed replacement title" },
  }]), /fingerprint mismatch/);
  assert.throws(() => assertFutureLightCopyReadback(changed, products), /fingerprint mismatch/);
});
