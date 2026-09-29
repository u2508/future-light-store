import assert from "node:assert/strict";
import test from "node:test";

import { buildVariantImageReviewEntries } from "./future-light-variant-image-review-queue.mjs";

const targetStoreDomain = "vs-future-store-0jl2t-jxu6tnr3.myshopify.com";

function media(id, url = `https://cdn.example.test/${id}.jpg`) {
  return {
    __typename: "MediaImage",
    id: `gid://shopify/MediaImage/${id}`,
    alt: `Image ${id}`,
    image: { url, width: 1200, height: 1200, altText: `Alt ${id}` },
  };
}

function variant(id, mediaIds = [], value = `Option ${id}`) {
  return {
    __typename: "ProductVariant",
    id: `gid://shopify/ProductVariant/${id}`,
    title: value,
    sku: `sku-${id}`,
    selectedOptions: [{ name: "Color", value }],
    media: {
      nodes: mediaIds.map((mediaId) => ({
        __typename: "MediaImage",
        id: `gid://shopify/MediaImage/${mediaId}`,
        __parentId: `gid://shopify/ProductVariant/${id}`,
      })),
      pageInfo: { hasNextPage: false },
    },
  };
}

function connection(items) {
  return { nodes: items, pageInfo: { hasNextPage: false } };
}

function fixture() {
  const active = {
    id: "gid://shopify/Product/1",
    handle: "active-product",
    title: "Active product",
    status: "ACTIVE",
    media: connection([media(10), media(11)]),
    variants: connection([variant(20, [10], "Navy"), variant(21, [], "Black")]),
  };
  const archived = {
    id: "gid://shopify/Product/2",
    handle: "archived-product",
    title: "Archived product",
    status: "ARCHIVED",
    media: connection([media(12), media(13)]),
    variants: connection([variant(22, [12], "Gray")]),
  };
  return {
    shopDomain: targetStoreDomain,
    coverage: {
      productVariants: "complete",
      productMedia: "complete",
      variantMediaAssociations: "complete",
    },
    counts: { products: 2, variants: 3, productMedia: 4, variantMediaAssociations: 2 },
    products: [active, archived],
  };
}

test("queues every active variant and every product image candidate, excluding archived products", () => {
  const result = buildVariantImageReviewEntries(fixture(), { targetStoreDomain });

  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].variants.length, 2);
  assert.deepEqual(
    result.entries[0].media.map((item) => item.id),
    ["gid://shopify/MediaImage/10", "gid://shopify/MediaImage/11"],
  );
  assert.deepEqual(result.entries[0].variants[0].expectedCurrentMediaIds, [
    "gid://shopify/MediaImage/10",
  ]);
  assert.equal(result.entries[0].variants[1].currentMedia.length, 0);
  assert.equal(result.entries[0].variants[1].decisionRequired, true);
  assert.deepEqual(result.summary, {
    activeProducts: 1,
    variantsRequiringReview: 2,
    productImageCandidates: 2,
    activeVariantsWithoutCurrentImage: 1,
  });
});

test("refuses partial bulk-query coverage even if rows are present", () => {
  const snapshot = fixture();
  snapshot.coverage.variantMediaAssociations = "partial";
  assert.throws(
    () => buildVariantImageReviewEntries(snapshot, { targetStoreDomain }),
    /variantMediaAssociations coverage is not complete/,
  );
});

test("refuses a declared catalog count that differs from observed complete rows", () => {
  const snapshot = fixture();
  snapshot.counts.variants -= 1;
  assert.throws(
    () => buildVariantImageReviewEntries(snapshot, { targetStoreDomain }),
    /variant count mismatch/,
  );
});

test("refuses an association whose image is not in that exact product gallery", () => {
  const snapshot = fixture();
  snapshot.products[0].variants.nodes[0].media.nodes[0].id = "gid://shopify/MediaImage/999";
  assert.throws(
    () => buildVariantImageReviewEntries(snapshot, { targetStoreDomain }),
    /outside product .* complete gallery/,
  );
});

test("refuses variant rows with unfinished pagination", () => {
  const snapshot = fixture();
  snapshot.products[0].variants.pageInfo.hasNextPage = true;
  assert.throws(
    () => buildVariantImageReviewEntries(snapshot, { targetStoreDomain }),
    /variants for active-product pagination is incomplete/,
  );
});
