import test from "node:test";
import assert from "node:assert/strict";

import { buildFutureLightExistingProductSeoAudit } from "./future-light-existing-product-seo-audit.mjs";

const expectedShopDomain = "vs-future-store-0jl2t-jxu6tnr3.myshopify.com";
const completeCoverage = {
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

function product({ id = "gid://shopify/Product/1", status = "ACTIVE", title = "Blue Cotton Dog Harness" } = {}) {
  return {
    __typename: "Product",
    id,
    legacyResourceId: id.split("/").at(-1),
    handle: id.endsWith("/1") ? "blue-cotton-dog-harness" : `product-${id.split("/").at(-1)}`,
    title,
    descriptionHtml: "<p>A blue cotton dog harness with an adjustable neck and chest strap.</p>",
    vendor: "VS Store",
    productType: "Dog Harness",
    status,
    updatedAt: "2026-09-26T00:00:00.000Z",
    seo: { title: null, description: "Shop Blue Cotton Dog Harness. A practical harness for daily dog walks." },
    category: { id: "gid://shopify/TaxonomyCategory/aa-1", name: "Pet Collars & Harnesses", fullName: "Animals & Pet Supplies > Pet Supplies > Pet Collars & Harnesses" },
    tags: ["pet-essentials"],
    variants: {
      nodes: [{ id: "gid://shopify/ProductVariant/11", legacyResourceId: "11", title: "Blue / Medium", selectedOptions: [{ name: "Color", value: "Blue" }, { name: "Size", value: "Medium" }] }],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
    media: {
      nodes: [{ id: "gid://shopify/MediaImage/21", alt: "Blue cotton dog harness" }],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
    collections: {
      nodes: [{ id: "gid://shopify/Collection/31", handle: "pet-essentials", title: "Pet Essentials" }],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
}

function snapshot(products = [product(), product({ id: "gid://shopify/Product/2", status: "ARCHIVED", title: "Archived Pet Harness" })]) {
  return {
    schemaVersion: 2,
    createdAt: "2026-09-26T00:00:00.000Z",
    shopDomain: expectedShopDomain,
    scope: "all Shopify product statuses",
    queryFilters: { products: "status:active,draft,archived,unlisted" },
    coverage: { ...completeCoverage },
    counts: { products: products.length },
    products,
  };
}

test("audits only current ACTIVE products and records source-bound copy evidence", () => {
  const report = buildFutureLightExistingProductSeoAudit(snapshot(), {
    expectedShopDomain,
    now: Date.parse("2026-09-26T00:05:00.000Z"),
    maxAgeMs: 30 * 60_000,
    snapshotSha256: "snapshot-hash",
  });

  assert.equal(report.readOnly, true);
  assert.equal(report.remoteMutationPerformed, false);
  assert.equal(report.policy.newProductsAdded, false);
  assert.equal(report.summary.activeProducts, 1);
  assert.equal(report.products.length, 1);
  assert.equal(report.products[0].handle, "blue-cotton-dog-harness");
  assert.ok(report.products[0].sourceFingerprint.startsWith("future-light-seo-source-v1:sha256:"));
  assert.ok(report.products[0].issues.includes("missing-seo-title"));
  assert.equal(report.products[0].variants.optionGroups.length, 2);
  assert.deepEqual(report.products[0].media.firstImages.map((image) => image.alt), ["Blue cotton dog harness"]);
});

test("rejects stale, wrong-target, or incomplete snapshots before audit", () => {
  const now = Date.parse("2026-09-26T01:00:00.000Z");
  assert.throws(
    () => buildFutureLightExistingProductSeoAudit(snapshot(), { expectedShopDomain, now, maxAgeMs: 30 * 60_000 }),
    /stale/,
  );
  assert.throws(
    () => buildFutureLightExistingProductSeoAudit({ ...snapshot(), shopDomain: "other.myshopify.com" }, { expectedShopDomain, now: Date.parse("2026-09-26T00:05:00.000Z") }),
    /target mismatch/,
  );
  const incomplete = snapshot();
  incomplete.coverage.productMedia = "partial";
  assert.throws(
    () => buildFutureLightExistingProductSeoAudit(incomplete, { expectedShopDomain, now: Date.parse("2026-09-26T00:05:00.000Z") }),
    /incomplete productMedia coverage/,
  );
});

test("rejects duplicate identities rather than merging product audit rows", () => {
  const duplicated = snapshot([product(), product()]);
  assert.throws(
    () => buildFutureLightExistingProductSeoAudit(duplicated, { expectedShopDomain, now: Date.parse("2026-09-26T00:05:00.000Z") }),
    /duplicate product identity/,
  );
});
