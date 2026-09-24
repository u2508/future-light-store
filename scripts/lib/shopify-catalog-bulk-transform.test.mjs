import assert from "node:assert/strict";
import test from "node:test";
import {
  parseShopifyBulkJsonl,
  reconcileShopifyBulkCatalog,
} from "./shopify-catalog-bulk-transform.mjs";

const productId = "gid://shopify/Product/1";
const secondProductId = "gid://shopify/Product/2";
const variantId = "gid://shopify/ProductVariant/1";
const secondVariantId = "gid://shopify/ProductVariant/2";
const mediaId = "gid://shopify/MediaImage/1";
const metafieldId = "gid://shopify/Metafield/1";
const metaobjectId = "gid://shopify/Metaobject/1";

function fixture() {
  return {
    catalogRecords: [
      { __typename: "Product", id: productId, handle: "test-product", status: "ACTIVE" },
      { __typename: "Product", id: secondProductId, handle: "another-product", status: "DRAFT" },
      { __typename: "ProductVariant", id: variantId, __parentId: productId, sku: "SKU-1" },
      {
        __typename: "ProductVariant",
        id: secondVariantId,
        __parentId: secondProductId,
        sku: "SKU-2",
      },
      { __typename: "MediaImage", id: mediaId, __parentId: productId, alt: "Product image" },
      {
        __typename: "Metafield",
        id: metafieldId,
        __parentId: productId,
        namespace: "shopify",
        key: "color-pattern",
        type: "list.metaobject_reference",
        value: JSON.stringify([metaobjectId]),
      },
      {
        __typename: "Metaobject",
        id: metaobjectId,
        __parentId: metafieldId,
        type: "shopify--color-pattern",
        handle: "warm-gold",
        displayName: "Warm Gold",
      },
      {
        __typename: "Product",
        id: "gid://shopify/Product/3",
        __parentId: metafieldId,
        handle: "a-product-metafield-reference",
      },
      {
        __typename: "Collection",
        id: "gid://shopify/Collection/1",
        __parentId: productId,
        handle: "home",
      },
      {
        __typename: "Collection",
        id: "gid://shopify/Collection/1",
        __parentId: secondProductId,
        handle: "home",
      },
    ],
    variantMediaRecords: [
      { __typename: "ProductVariant", id: variantId, product: { id: productId } },
      { __typename: "ProductVariant", id: secondVariantId, product: { id: secondProductId } },
      { __typename: "MediaImage", id: mediaId, __parentId: variantId, alt: "Product image" },
    ],
    publicationRecords: [
      { __typename: "Product", id: productId },
      { __typename: "Product", id: secondProductId },
      {
        __typename: "ResourcePublication",
        __parentId: productId,
        isPublished: true,
        publication: { id: "gid://shopify/Publication/1", name: "Online Store" },
      },
    ],
  };
}

test("parses Shopify bulk JSONL and rebuilds complete product connections", () => {
  const records = parseShopifyBulkJsonl('{"id":"1"}\n\n{"id":"2"}\n');
  assert.equal(records.length, 2);

  const result = reconcileShopifyBulkCatalog({
    ...fixture(),
    expectedOperationCounts: {
      catalogRootObjectCount: 2,
      variantMediaRootObjectCount: 2,
      publicationRootObjectCount: 2,
    },
  });

  assert.equal(result.products.length, 2);
  assert.equal(result.products[0].variants.pageInfo.hasNextPage, false);
  assert.equal(result.products[0].variants.nodes[0].media.nodes[0].id, mediaId);
  assert.equal(result.products[0].resourcePublications.nodes[0].publication.name, "Online Store");
  assert.equal(result.counts.productMedia, 1);
  assert.equal(result.counts.productMetafields, 1);
  assert.equal(result.counts.productMetafieldReferences, 1);
  assert.equal(
    result.products[0].metafields.nodes[0].references.nodes[0].displayName,
    "Warm Gold",
  );
  assert.equal(result.counts.collectionMemberships, 2);
  assert.equal(result.counts.variantMediaAssociations, 1);
});

test("fails closed when list metafield reference values are not fully read back", () => {
  const missingReference = fixture();
  missingReference.catalogRecords = missingReference.catalogRecords.filter(
    (record) => record.__typename !== "Metaobject",
  );
  assert.throws(
    () => reconcileShopifyBulkCatalog(missingReference),
    /reference readback mismatch: value lists 1, fetched 0/,
  );

  const invalidValue = fixture();
  const metafield = invalidValue.catalogRecords.find((record) => record.__typename === "Metafield");
  metafield.value = "not-json";
  assert.throws(
    () => reconcileShopifyBulkCatalog(invalidValue),
    /invalid list\.metaobject_reference JSON/,
  );
});

test("reconciles metafield-reference export against the complete catalog cohort", () => {
  const source = fixture();
  const referenceMetafield = source.catalogRecords.find(
    (record) => record.__typename === "Metafield",
  );
  const referenceObject = source.catalogRecords.find(
    (record) => record.__typename === "Metaobject",
  );
  const metafieldReferenceRecords = [
    { __typename: "Product", id: productId },
    { __typename: "Product", id: secondProductId },
    { ...referenceMetafield },
    { ...referenceObject },
  ];
  source.catalogRecords = source.catalogRecords.filter(
    (record) => record.__typename !== "Metaobject",
  );

  const result = reconcileShopifyBulkCatalog({ ...source, metafieldReferenceRecords });
  assert.equal(result.products[0].metafields.nodes[0].references.nodes[0].id, metaobjectId);

  const inconsistent = structuredClone(metafieldReferenceRecords);
  inconsistent.find((record) => record.__typename === "Metafield").value = "[]";
  assert.throws(
    () =>
      reconcileShopifyBulkCatalog({
        ...source,
        metafieldReferenceRecords: inconsistent,
      }),
    /disagrees with catalog metafield .* on value/,
  );
});

test("rejects malformed JSONL with its exact line number", () => {
  assert.throws(() => parseShopifyBulkJsonl('{"ok":true}\nnot-json\n'), /line 2/);
});

test("fails closed when a child points to an absent product or variant", () => {
  const missingProduct = fixture();
  missingProduct.catalogRecords[2].__parentId = "gid://shopify/Product/404";
  assert.throws(
    () => reconcileShopifyBulkCatalog(missingProduct),
    /missing parent|cohort mismatch/,
  );

  const missingVariant = fixture();
  missingVariant.variantMediaRecords[2].__parentId = "gid://shopify/ProductVariant/404";
  assert.throws(() => reconcileShopifyBulkCatalog(missingVariant), /missing parent/);
});

test("rejects cohort, duplicate, and root-count mismatches", () => {
  const missingPublication = fixture();
  missingPublication.publicationRecords = [];
  assert.throws(() => reconcileShopifyBulkCatalog(missingPublication), /cohort mismatch/);

  const duplicate = fixture();
  duplicate.catalogRecords.push({ ...duplicate.catalogRecords[0] });
  assert.throws(() => reconcileShopifyBulkCatalog(duplicate), /Duplicate Product ID/);

  assert.throws(
    () =>
      reconcileShopifyBulkCatalog({
        ...fixture(),
        expectedOperationCounts: { catalogRootObjectCount: 3 },
      }),
    /root count mismatch/,
  );
});
