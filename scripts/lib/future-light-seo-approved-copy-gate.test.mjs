import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  assertExactSeoCopyReadback,
  assertFutureLightSeoBatchApproval,
  authorizeFutureLightSeoItems,
  exactSeoCopyFromProduct,
  needsExactSeoCopyWrite,
  sameExactSeoCopy,
} from "./future-light-seo-approved-copy-gate.mjs";
import {
  createFutureLightApprovedCopyManifest,
  FUTURE_LIGHT_SHOP_DOMAIN,
} from "./future-light-approved-copy-manifest.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function fixture() {
  const products = [
    {
      id: "gid://shopify/Product/1001",
      handle: "approved-keep",
      status: "ACTIVE",
      title: "  Keep this title exactly  ",
      descriptionHtml: "<p>Keep &amp; preserve.\r\nExact bytes.</p>",
      seo: { title: null, description: "Existing SEO\r\ncopy." },
    },
    {
      id: "gid://shopify/Product/1002",
      handle: "held-product",
      status: "ACTIVE",
      title: "Held title stays as-is",
      descriptionHtml: "<p>Held description.\r\nDo not rewrite.</p>",
      seo: { title: "Held SEO title", description: null },
    },
    {
      id: "gid://shopify/Product/1003",
      handle: "rewrite-product",
      status: "ACTIVE",
      title: "Generic source title",
      descriptionHtml: "<p>Original description.</p>",
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
  const proposal = {
    title: "  Exact approved rewrite  ",
    descriptionHtml: "<p>Approved first line.\r\nApproved second line.</p>",
    seoDescription: "Approved SEO description.\r\nKeep exact spacing.",
  };
  const decisions = [
    {
      productId: products[0].id,
      decision: "approved_keep",
      reason: "Current copy is accurate.",
      reviewer: "reviewer",
      evidenceFingerprint: HASH_A,
    },
    {
      productId: products[1].id,
      decision: "held",
      reason: "Product identity needs review.",
      reviewer: "reviewer",
      evidenceFingerprint: HASH_B,
    },
    {
      productId: products[2].id,
      decision: "needs_rewrite",
      reason: "Source copy is generic.",
      reviewer: "reviewer",
      evidenceFingerprint: HASH_A,
      proposal,
      claimLedger: [
        {
          claimId: "product-identity",
          text: "The approved product description identifies the item.",
          evidence: [
            {
              kind: "product-image",
              sourceId: "gid://shopify/MediaImage/3001",
              sourceSha256: HASH_B,
            },
          ],
        },
      ],
    },
  ];
  const sourceSnapshotBytes = Buffer.from(JSON.stringify(snapshot));
  const approvalManifest = createFutureLightApprovedCopyManifest({
    snapshot,
    sourceSnapshotBytes,
    sourceSnapshotSha256: createHash("sha256").update(sourceSnapshotBytes).digest("hex"),
    decisions,
    createdAt: "2026-09-28T00:00:00.000Z",
  });
  const items = [
    {
      productId: products[0].id,
      handle: products[0].handle,
      desired: { title: "Generated replacement", descriptionHtml: "<p>Generated.</p>" },
    },
    {
      productId: products[1].id,
      handle: products[1].handle,
      desired: { title: "Generated held title", descriptionHtml: "<p>Generated held copy.</p>" },
    },
    {
      productId: products[2].id,
      handle: products[2].handle,
      desired: {
        ...proposal,
        seoTitle: "Unapproved SEO title is ignored",
      },
    },
  ];
  return { products, proposal, approvalManifest, items };
}

function authorize(data) {
  return authorizeFutureLightSeoItems({
    approvalManifest: data.approvalManifest,
    liveProducts: data.products,
    expectedProducts: data.products,
    items: data.items,
  });
}

test("missing approved-copy manifest is rejected", () => {
  const data = fixture();
  assert.throws(
    () => authorizeFutureLightSeoItems({
      liveProducts: data.products,
      expectedProducts: data.products,
      items: data.items,
    }),
    /Missing exact approved-copy manifest/,
  );
});

test("plan identity must match the exact approved product ID and live handle", () => {
  const data = fixture();
  data.items[2].handle = "approved-keep";
  assert.throws(() => authorize(data), /handle does not match live product/);

  const wrongId = fixture();
  wrongId.items[2].productId = "gid://shopify/Product/9999";
  assert.throws(() => authorize(wrongId), /outside the exact execution scope/);
});

test("changed proposed values are rejected before a write can be authorized", () => {
  const data = fixture();
  data.items[2].desired.title += "!";
  assert.throws(() => authorize(data), /differs from the exact approved value/);
});

test("resume accepts only an exact approved postimage and rejects any other live drift", () => {
  const data = fixture();
  data.products[2] = {
    ...data.products[2],
    title: data.proposal.title,
    descriptionHtml: data.proposal.descriptionHtml,
    seo: { title: null, description: data.proposal.seoDescription },
  };
  const resumed = authorize(data);
  assert.equal(needsExactSeoCopyWrite(resumed[2], data.products[2]), false);

  data.products[2] = {
    ...data.products[2],
    descriptionHtml: `${data.products[2].descriptionHtml}!`,
  };
  assert.throws(() => authorize(data), /neither the frozen preimage nor exact approved rewrite/);
});

test("keep and held copy preserve whitespace and CRLF exactly; rewrite/readback are byte-exact", () => {
  const data = fixture();
  const items = authorize(data);
  const keep = items[0];
  const held = items[1];
  const rewrite = items[2];

  assert.equal(keep.approvalDecision, "approved_keep");
  assert.equal(keep.approvedWrite, null);
  assert.deepEqual(keep.desired, exactSeoCopyFromProduct(data.products[0]));
  assert.throws(
    () => assertFutureLightSeoBatchApproval(data.approvalManifest, [keep]),
    /forbidden for unapproved product/,
  );
  assert.equal(keep.desired.title, "  Keep this title exactly  ");
  assert.match(keep.desired.descriptionHtml, /\r\n/);
  assert.match(keep.desired.seoDescription, /\r\n/);

  assert.equal(held.approvalDecision, "held");
  assert.equal(held.approvedWrite, null);
  assert.deepEqual(held.desired, exactSeoCopyFromProduct(data.products[1]));
  assert.throws(
    () => assertFutureLightSeoBatchApproval(data.approvalManifest, [held]),
    /forbidden for unapproved product/,
  );

  assert.equal(rewrite.approvalDecision, "needs_rewrite");
  assert.deepEqual(rewrite.desired, {
    ...exactSeoCopyFromProduct(data.products[2]),
    ...data.proposal,
  });
  assert.equal(assertFutureLightSeoBatchApproval(data.approvalManifest, [rewrite]), true);

  const exactReadback = {
    ...data.products[2],
    title: data.proposal.title,
    descriptionHtml: data.proposal.descriptionHtml,
    seo: { title: null, description: data.proposal.seoDescription },
  };
  assert.equal(assertExactSeoCopyReadback(rewrite, exactReadback), true);
  assert.equal(needsExactSeoCopyWrite(rewrite, data.products[2]), true);
  assert.equal(needsExactSeoCopyWrite(rewrite, exactReadback), false);

  const whitespaceChanged = { ...exactReadback, title: data.proposal.title.trim() };
  assert.equal(sameExactSeoCopy(exactSeoCopyFromProduct(whitespaceChanged), rewrite.desired), false);
  assert.equal(needsExactSeoCopyWrite(rewrite, whitespaceChanged), true);
  assert.throws(() => assertExactSeoCopyReadback(rewrite, whitespaceChanged), /Exact copy readback mismatch/);

  const newlineChanged = {
    ...exactReadback,
    descriptionHtml: data.proposal.descriptionHtml.replaceAll("\r\n", "\n"),
  };
  assert.throws(() => assertExactSeoCopyReadback(rewrite, newlineChanged), /Exact copy readback mismatch/);
});
