import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { buildPlan } from "./future-light-seo-final-apply.mjs";
import {
  assertFutureLightApprovedCopyWrites,
  assertFutureLightCopyReadback,
  createFutureLightApprovedCopyManifest,
  FUTURE_LIGHT_SHOP_DOMAIN,
} from "./lib/future-light-approved-copy-manifest.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function fixture() {
  const products = [
    {
      id: "gid://shopify/Product/1001",
      handle: "accurate-product",
      status: "ACTIVE",
      vendor: "VS Store",
      title: "  Accurate title, preserved exactly  ",
      descriptionHtml: "<p>Keep &amp; preserve.\r\nExact bytes.</p>",
      seo: { title: null, description: "Existing SEO description." },
    },
    {
      id: "gid://shopify/Product/1002",
      handle: "product-to-rewrite",
      status: "ACTIVE",
      vendor: "VS Store",
      title: "Generic old title",
      descriptionHtml: "<p>Old copy.</p>",
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
    title: "Compact Desk Phone Stand",
    seoDescription: "A compact stand keeps a phone upright on a desk.",
  };
  const decisions = [
    {
      productId: products[0].id,
      decision: "approved_keep",
      reason: "Current copy is accurate and must remain untouched.",
      reviewer: "human-approved-copy-review",
      evidenceFingerprint: HASH_A,
    },
    {
      productId: products[1].id,
      decision: "needs_rewrite",
      reason: "The current title is generic and does not identify the product.",
      reviewer: "human-approved-copy-review",
      evidenceFingerprint: HASH_B,
      proposal,
      claimLedger: [
        {
          claimId: "product-identity",
          text: "A compact stand keeps a phone upright on a desk.",
          evidence: [
            {
              kind: "product-image",
              sourceId: "gid://shopify/MediaImage/5001",
              sourceSha256: HASH_A,
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
    createdAt: "2026-09-27T08:00:00.000Z",
  });
  const artifact = {
    products: [
      {
        productId: products[0].id,
        handle: products[0].handle,
        title: "Unapproved generated title",
        descriptionHtml: "<p>Unapproved generated description.</p>",
        seoTitle: "Unapproved SEO title",
        seoDescription: "Unapproved SEO description",
      },
      {
        productId: products[1].id,
        handle: products[1].handle,
        title: proposal.title,
        descriptionHtml: products[1].descriptionHtml,
        seoTitle: "Unapproved field is ignored",
        seoDescription: proposal.seoDescription,
      },
    ],
  };
  return { products, proposal, approvalManifest, artifact };
}

test("approved_keep is byte-preserved and never becomes a writer mutation", () => {
  const { products, approvalManifest, artifact } = fixture();
  const plan = buildPlan(products, artifact, approvalManifest);
  const keep = plan[0];

  assert.deepEqual(keep.desired, {
    title: products[0].title,
    descriptionHtml: products[0].descriptionHtml,
    seoTitle: null,
    seoDescription: products[0].seo.description,
  });
  assert.deepEqual(keep.update, { id: products[0].id });
  assert.equal(keep.changed, false);
});

test("rewrite plan carries only exact product-ID-bound approved fields", () => {
  const { products, proposal, approvalManifest, artifact } = fixture();
  const rewrite = buildPlan(products, artifact, approvalManifest)[1];

  assert.deepEqual(rewrite.update, {
    id: products[1].id,
    title: proposal.title,
    seo: { description: proposal.seoDescription },
  });
  assert.deepEqual(rewrite.desired, {
    title: proposal.title,
    descriptionHtml: products[1].descriptionHtml,
    seoTitle: null,
    seoDescription: proposal.seoDescription,
  });
  assertFutureLightApprovedCopyWrites(approvalManifest, [rewrite.approvedWrite]);
  assert.throws(
    () => assertFutureLightCopyReadback(approvalManifest, [
      { ...products[0], title: `${products[0].title}!` },
      {
        ...products[1],
        title: proposal.title,
        seo: { title: null, description: proposal.seoDescription },
      },
    ]),
    /Exact copy readback mismatch/,
  );
  assertFutureLightCopyReadback(approvalManifest, [
    products[0],
    {
      ...products[1],
      title: proposal.title,
      seo: { title: null, description: proposal.seoDescription },
    },
  ]);
});

test("missing approval and stale or wrong product preimages are rejected", () => {
  const { products, approvalManifest, artifact } = fixture();
  assert.throws(() => buildPlan(products, artifact), /Missing exact approved-copy manifest/);
  assert.throws(
    () => buildPlan([
      { ...products[0], descriptionHtml: `${products[0].descriptionHtml}!` },
      products[1],
    ], artifact, approvalManifest),
    /preimage changed since approval/,
  );
  assert.throws(
    () => buildPlan([
      { ...products[0], id: "gid://shopify/Product/9999" },
      products[1],
    ], artifact, approvalManifest),
    /Live preimage is missing product/,
  );
});

test("artifact identity and approved proposal values must match exactly", () => {
  const { products, approvalManifest, artifact } = fixture();
  const wrongIdArtifact = structuredClone(artifact);
  wrongIdArtifact.products[1].productId = "gid://shopify/Product/9999";
  assert.throws(
    () => buildPlan(products, wrongIdArtifact, approvalManifest),
    /artifact is missing.*live active handle/,
  );

  const alteredProposalArtifact = structuredClone(artifact);
  alteredProposalArtifact.products[1].title += "!";
  assert.throws(
    () => buildPlan(products, alteredProposalArtifact, approvalManifest),
    /differs from the exact approved proposal/,
  );
});
