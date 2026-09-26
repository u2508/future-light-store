import test from "node:test";
import assert from "node:assert/strict";
import {
  collectionProductsCountIssue,
  collectionPublicationReadbackIssue,
} from "./collection-readback-guard.mjs";

test("requires complete collection publication readback before classifying visibility", () => {
  assert.match(
    collectionPublicationReadbackIssue({ resourcePublications: { nodes: [] } }),
    /incomplete/,
  );
  assert.match(
    collectionPublicationReadbackIssue({
      resourcePublications: { nodes: [], pageInfo: { hasNextPage: true } },
    }),
    /not fully paginated/,
  );
  assert.equal(
    collectionPublicationReadbackIssue({
      resourcePublications: { nodes: [], pageInfo: { hasNextPage: false } },
    }),
    null,
  );
});

test("rejects an empty public collection without a reviewed exception", () => {
  assert.match(
    collectionProductsCountIssue({
      isPublishedToOnlineStore: true,
      count: 0,
      precision: "EXACT",
    }),
    /zero products/,
  );
});

test("accepts non-empty public collections only with exact count readback", () => {
  assert.equal(
    collectionProductsCountIssue({
      isPublishedToOnlineStore: true,
      count: 12,
      precision: "EXACT",
    }),
    null,
  );
  assert.match(
    collectionProductsCountIssue({
      isPublishedToOnlineStore: true,
      count: 12,
      precision: "SOME",
    }),
    /not exact/,
  );
});

test("requires a reason to permit an intentionally empty public collection", () => {
  assert.match(
    collectionProductsCountIssue({
      isPublishedToOnlineStore: true,
      count: 0,
      precision: "EXACT",
      allowEmpty: true,
      allowEmptyReason: "",
    }),
    /zero products/,
  );
  assert.equal(
    collectionProductsCountIssue({
      isPublishedToOnlineStore: true,
      count: 0,
      precision: "EXACT",
      allowEmpty: true,
      allowEmptyReviewed: true,
      allowEmptyReason: "Seasonal collection intentionally paused",
    }),
    null,
  );
  assert.match(
    collectionProductsCountIssue({
      isPublishedToOnlineStore: true,
      count: 0,
      precision: "EXACT",
      allowEmpty: true,
      allowEmptyReason: "Seasonal collection intentionally paused",
    }),
    /zero products/,
  );
});

test("does not block unpublished internal collections for having no products", () => {
  assert.equal(
    collectionProductsCountIssue({
      isPublishedToOnlineStore: false,
      count: 0,
      precision: "EXACT",
    }),
    null,
  );
});

test("fails closed when the live count is missing", () => {
  assert.match(
    collectionProductsCountIssue({
      isPublishedToOnlineStore: true,
      count: null,
      precision: null,
    }),
    /no valid product-count readback/,
  );
});
