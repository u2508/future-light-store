import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCategoryMetafieldPlanMappings,
  assertCategoryMetafieldReadbackReceipt,
  buildCategoryMetafieldReadbackInput,
  validateCategoryMetafieldReadback,
} from "./category-metafield-release-gate.mjs";

const productId = "gid://shopify/Product/101";
const categoryId = "gid://shopify/TaxonomyCategory/ap-2-2-5";
const metaobjectId = "gid://shopify/Metaobject/color-red";

function plan(overrides = {}) {
  return {
    productId: 101,
    categoryId,
    writes: [{
      productId: 101,
      namespace: "shopify",
      key: "color-pattern",
      type: "list.metaobject_reference",
      currentReferenceIds: [],
      action: "add",
    }],
    skipped: [],
    ...overrides,
  };
}

function resolvedWrite(overrides = {}) {
  return {
    productId: 101,
    namespace: "shopify",
    key: "color-pattern",
    type: "list.metaobject_reference",
    value: JSON.stringify([metaobjectId]),
    ...overrides,
  };
}

test("requires an exact, unique plan for every category-bearing product", () => {
  assert.deepEqual(
    assertCategoryMetafieldPlanMappings({ plans: [plan()], expectedProductIds: [101] }),
    { expectedProducts: 1, unmappedRequiredFields: 0 },
  );
  assert.throws(
    () => assertCategoryMetafieldPlanMappings({ plans: [plan()], expectedProductIds: [101, 102] }),
    /1 missing and 0 unexpected/,
  );
  assert.throws(
    () => assertCategoryMetafieldPlanMappings({
      plans: [plan({ skipped: [{ attributeName: "Color", reason: "no category metafield definition" }] })],
      expectedProductIds: [101],
    }),
    /Unknown or unmapped required category metafield/,
  );
});

test("does not accept a category-bearing product with no evidence-backed metafield value", () => {
  assert.throws(
    () => assertCategoryMetafieldPlanMappings({
      plans: [plan({ writes: [], skipped: [{ reason: "no direct evidence-backed taxonomy value" }] })],
      expectedProductIds: [101],
    }),
    /No evidence-backed category metafield values are available/,
  );
});

test("builds the exact expected product/category/metafield values without guessing", () => {
  const input = buildCategoryMetafieldReadbackInput({
    plans: [plan()],
    resolvedWrites: [resolvedWrite()],
    expectedProductIds: [101],
  });
  assert.deepEqual(input.expectedProducts, [{
    productId,
    categoryId,
    requiredDefinitionKeys: ["shopify.color-pattern"],
    metafields: [{
      definitionKey: { namespace: "shopify", key: "color-pattern" },
      expectedType: "list.metaobject_reference",
      canonicalValue: JSON.stringify([metaobjectId]),
    }],
  }]);
  const result = validateCategoryMetafieldReadback({
    ...input,
    readbackProducts: [{
      id: productId,
      category: { id: categoryId },
      metafields: [{
        namespace: "shopify",
        key: "color-pattern",
        type: "list.metaobject_reference",
        value: JSON.stringify([metaobjectId]),
      }],
    }],
  });
  assert.equal(result.status, "pass");
  assert.deepEqual(result.summary, {
    expectedProducts: 1,
    readbackProducts: 1,
    checks: 2,
    matched: 2,
    missing: 0,
    mismatch: 0,
    unexpected: 0,
  });
});

test("keeps required field completeness scoped to each product, not the shared category", () => {
  const secondProductId = "gid://shopify/Product/102";
  const secondProductPlan = plan({
    productId: 102,
    writes: [{
      productId: 102,
      namespace: "shopify",
      key: "material",
      type: "list.metaobject_reference",
      currentReferenceIds: [],
      action: "add",
    }],
  });
  const input = buildCategoryMetafieldReadbackInput({
    plans: [plan(), secondProductPlan],
    resolvedWrites: [
      resolvedWrite(),
      resolvedWrite({
        productId: 102,
        key: "material",
        value: JSON.stringify(["gid://shopify/Metaobject/material-cotton"]),
      }),
    ],
    expectedProductIds: [101, 102],
  });

  assert.deepEqual(
    input.expectedProducts.map(({ productId: id, requiredDefinitionKeys }) => ({ id, requiredDefinitionKeys })),
    [
      { id: productId, requiredDefinitionKeys: ["shopify.color-pattern"] },
      { id: secondProductId, requiredDefinitionKeys: ["shopify.material"] },
    ],
  );
});

test("fails closed when a required category field has no evidence-backed value", () => {
  assert.throws(
    () => buildCategoryMetafieldReadbackInput({
      plans: [plan({ skipped: [{
        definition: "shopify.color-pattern",
        required: true,
        reason: "no direct evidence-backed taxonomy value",
      }] })],
      resolvedWrites: [],
      expectedProductIds: [101],
    }),
    /Required category metafield shopify\.color-pattern is unresolved/,
  );
  assert.throws(
    () => assertCategoryMetafieldPlanMappings({
      plans: [plan({ writes: [], skipped: [{
        attributeName: "Pattern",
        definition: "shopify.color-pattern",
        reason: "required color evidence missing for color-pattern",
      }] })],
      expectedProductIds: [101],
    }),
    /Required category metafield shopify\.color-pattern is unresolved/,
  );
  assert.throws(
    () => buildCategoryMetafieldReadbackInput({
      plans: [plan({ writes: [], skipped: [{ reason: "category attributes unavailable" }] })],
      resolvedWrites: [],
      expectedProductIds: [101],
    }),
    /Unknown or unmapped required category metafield/,
  );
});

test("only accepts a complete passing readback receipt", () => {
  const receipt = {
    generatedAt: "2026-09-25T00:00:00.000Z",
    status: "pass",
    expectedProducts: 12,
    readbackProducts: 12,
    checkedRequiredFields: 25,
    unmappedRequiredFields: 0,
    missing: 0,
    mismatch: 0,
    unexpected: 0,
  };
  assert.equal(assertCategoryMetafieldReadbackReceipt({ categoryMetafieldReadback: receipt }), receipt);
  assert.throws(
    () => assertCategoryMetafieldReadbackReceipt({ categoryMetafieldReadback: { ...receipt, missing: 1 } }),
    /contains unresolved fields/,
  );
  for (const readbackProducts of [undefined, 11, 13]) {
    assert.throws(
      () => assertCategoryMetafieldReadbackReceipt({
        categoryMetafieldReadback: { ...receipt, readbackProducts },
      }),
      /does not cover the complete product cohort/,
    );
  }
  assert.throws(() => assertCategoryMetafieldReadbackReceipt({}), /missing or failed/);
  assert.throws(
    () => assertCategoryMetafieldReadbackReceipt({
      categoryMetafieldReadback: { ...receipt, checkedRequiredFields: 0 },
    }),
    /no checked required fields/,
  );
});
