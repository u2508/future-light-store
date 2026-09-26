import test from "node:test";
import assert from "node:assert/strict";
import {
  assertCompleteProductMediaPagination,
  productMediaPaginationIssues,
} from "./product-media-pagination.mjs";

const complete = () => ({
  id: "gid://shopify/Product/1",
  handle: "sample-product",
  media: { nodes: [], pageInfo: { hasNextPage: false } },
  variants: {
    nodes: [
      {
        id: "gid://shopify/ProductVariant/1",
        media: { nodes: [], pageInfo: { hasNextPage: false } },
      },
      {
        id: "gid://shopify/ProductVariant/2",
        media: { nodes: [], pageInfo: { hasNextPage: false } },
      },
    ],
    pageInfo: { hasNextPage: false },
  },
});

test("accepts complete product, variant, and nested variant-media pages", () => {
  const product = complete();
  assert.deepEqual(productMediaPaginationIssues(product), []);
  assert.equal(assertCompleteProductMediaPagination(product), product);
});

test("rejects truncated root media, variants, and any nested variant media", () => {
  for (const mutate of [
    (product) => {
      product.media.pageInfo.hasNextPage = true;
    },
    (product) => {
      product.variants.pageInfo.hasNextPage = true;
    },
    (product) => {
      product.variants.nodes[1].media.pageInfo.hasNextPage = true;
    },
  ]) {
    const product = complete();
    mutate(product);
    assert.throws(
      () => assertCompleteProductMediaPagination(product),
      /Incomplete media or variant pagination/,
    );
  }
});

test("rejects missing pagination proof instead of treating a partial connection as complete", () => {
  const product = complete();
  delete product.variants.nodes[0].media.pageInfo;
  assert.deepEqual(productMediaPaginationIssues(product), [
    "variant-media:gid://shopify/ProductVariant/1:pagination-unverified",
  ]);
});
