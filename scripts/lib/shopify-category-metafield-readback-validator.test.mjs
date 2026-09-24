import assert from "node:assert/strict";
import test from "node:test";
import { validateShopifyCategoryMetafieldReadback } from "./shopify-category-metafield-readback-validator.mjs";

const productId = "gid://shopify/Product/101";
const categoryId = "gid://shopify/TaxonomyCategory/apparel";
const colorReferenceId = "gid://shopify/Metaobject/color-red";
const sizeReferenceId = "gid://shopify/Metaobject/size-medium";

function expectedFixture() {
  return [
    {
      productId,
      categoryId,
      metafields: [
        {
          definitionKey: { namespace: "shopify", key: "color-pattern" },
          expectedType: "metaobject_reference",
          canonicalReference: colorReferenceId,
        },
        {
          definitionKey: { namespace: "shopify", key: "size" },
          expectedType: "list.metaobject_reference",
          canonicalReference: [sizeReferenceId],
        },
        {
          definitionKey: { namespace: "custom", key: "care-note" },
          expectedType: "single_line_text_field",
          canonicalValue: "Cold wash",
        },
      ],
    },
  ];
}

function readbackFixture() {
  return [
    {
      id: productId,
      category: { id: categoryId },
      metafields: [
        {
          namespace: "shopify",
          key: "color-pattern",
          type: "metaobject_reference",
          value: colorReferenceId,
          reference: { id: colorReferenceId },
        },
        {
          namespace: "shopify",
          key: "size",
          type: "list.metaobject_reference",
          value: JSON.stringify([sizeReferenceId]),
          references: { nodes: [{ id: sizeReferenceId }] },
        },
        {
          namespace: "custom",
          key: "care-note",
          type: "single_line_text_field",
          value: "Cold wash",
        },
      ],
    },
  ];
}

test("passes exact category, scalar reference, list reference, and value readbacks", () => {
  const result = validateShopifyCategoryMetafieldReadback({
    expectedProducts: expectedFixture(),
    readbackProducts: readbackFixture(),
  });

  assert.equal(result.status, "pass");
  assert.deepEqual(result.summary, {
    expectedProducts: 1,
    readbackProducts: 1,
    checks: 4,
    matched: 4,
    missing: 0,
    mismatch: 0,
    unexpected: 0,
  });
  assert.deepEqual(
    result.checks.map(({ status }) => status),
    ["match", "match", "match", "match"],
  );
});

test("reports absent products, categories, and expected metafields as missing", () => {
  const expected = expectedFixture();
  const missingProduct = validateShopifyCategoryMetafieldReadback({
    expectedProducts: expected,
    readbackProducts: [],
  });
  assert.deepEqual(
    missingProduct.checks.map(({ status, type }) => [status, type]),
    [["missing", "product"]],
  );

  const readback = readbackFixture();
  readback[0].category = null;
  readback[0].metafields = [];
  const result = validateShopifyCategoryMetafieldReadback({
    expectedProducts: expected,
    readbackProducts: readback,
  });
  assert.deepEqual(
    result.checks.map(({ status }) => status),
    ["missing", "missing", "missing", "missing"],
  );
  assert.deepEqual(result.summary, {
    expectedProducts: 1,
    readbackProducts: 1,
    checks: 4,
    matched: 0,
    missing: 4,
    mismatch: 0,
    unexpected: 0,
  });
});

test("reports differing category IDs, values, and references as mismatches", () => {
  const readback = readbackFixture();
  readback[0].category.id = "gid://shopify/TaxonomyCategory/footwear";
  readback[0].metafields[0].reference.id = "gid://shopify/Metaobject/color-blue";
  readback[0].metafields[1].references.nodes[0].id = "gid://shopify/Metaobject/size-large";
  readback[0].metafields[2].value = "Hand wash";

  const result = validateShopifyCategoryMetafieldReadback({
    expectedProducts: expectedFixture(),
    readbackProducts: readback,
  });
  assert.deepEqual(
    result.checks.map(({ status }) => status),
    ["mismatch", "mismatch", "mismatch", "mismatch"],
  );
  assert.equal(result.summary.mismatch, 4);
});

test("reports extra products and managed namespace fields as unexpected", () => {
  const readback = readbackFixture();
  readback[0].metafields.push({
    namespace: "custom",
    key: "unplanned",
    type: "single_line_text_field",
    value: "extra",
  });
  readback.push({ id: "gid://shopify/Product/999", category: { id: categoryId }, metafields: [] });

  const result = validateShopifyCategoryMetafieldReadback({
    expectedProducts: expectedFixture(),
    readbackProducts: readback,
    managedMetafieldNamespaces: ["custom"],
  });
  assert.deepEqual(
    result.checks
      .filter(({ status }) => status === "unexpected")
      .map(({ type, productId, definitionKey }) => ({ type, productId, definitionKey })),
    [
      { type: "metafield", productId, definitionKey: "custom.unplanned" },
      { type: "product", productId: "gid://shopify/Product/999", definitionKey: undefined },
    ],
  );
  assert.equal(result.summary.unexpected, 2);
  assert.equal(result.status, "fail");
});

test("ignores unknown metafields outside declared managed scope by default", () => {
  const readback = readbackFixture();
  readback[0].metafields.push(
    { namespace: "custom", key: "unplanned", type: "single_line_text_field", value: "extra" },
    { namespace: "shopify", key: "another-extra", type: "single_line_text_field", value: "extra" },
  );

  const result = validateShopifyCategoryMetafieldReadback({
    expectedProducts: expectedFixture(),
    readbackProducts: readback,
  });
  assert.equal(result.status, "pass");
  assert.equal(result.summary.unexpected, 0);
  assert.deepEqual(
    result.checks.map(({ status }) => status),
    ["match", "match", "match", "match"],
  );
});

test("reports unknown fields through an exact managed-key allowlist or full snapshot mode", () => {
  const readback = readbackFixture();
  readback[0].metafields.push(
    { namespace: "private", key: "managed", type: "single_line_text_field", value: "one" },
    { namespace: "private", key: "outside", type: "single_line_text_field", value: "two" },
  );

  const allowlisted = validateShopifyCategoryMetafieldReadback({
    expectedProducts: expectedFixture(),
    readbackProducts: readback,
    managedMetafieldDefinitionKeys: ["private.managed"],
  });
  assert.deepEqual(
    allowlisted.checks
      .filter(({ status }) => status === "unexpected")
      .map(({ definitionKey }) => definitionKey),
    ["private.managed"],
  );

  const fullSnapshot = validateShopifyCategoryMetafieldReadback({
    expectedProducts: expectedFixture(),
    readbackProducts: readback,
    fullMetafieldSnapshot: true,
  });
  assert.deepEqual(
    fullSnapshot.checks
      .filter(({ status }) => status === "unexpected")
      .map(({ definitionKey }) => definitionKey),
    ["private.managed", "private.outside"],
  );
});

test("reports an expected metafield type mismatch using the existing mismatch status", () => {
  const readback = readbackFixture();
  readback[0].metafields[2].type = "multi_line_text_field";

  const result = validateShopifyCategoryMetafieldReadback({
    expectedProducts: expectedFixture(),
    readbackProducts: readback,
  });
  assert.deepEqual(
    result.checks.map(({ status }) => status),
    ["match", "match", "match", "mismatch"],
  );
  assert.equal(result.checks[3].reason, "type-mismatch");
  assert.equal(result.checks[3].expected.type, "single_line_text_field");
  assert.equal(result.checks[3].actual.type, "multi_line_text_field");
});

test("flags duplicate actual metafield rows and product rows as mismatches", () => {
  const expected = expectedFixture();
  const readback = readbackFixture();
  readback[0].metafields.push({ ...readback[0].metafields[0] });
  readback.push({ ...readback[0] });

  const result = validateShopifyCategoryMetafieldReadback({
    expectedProducts: expected,
    readbackProducts: readback,
  });
  assert.equal(result.checks.length, 1);
  assert.equal(result.checks[0].status, "mismatch");
  assert.equal(result.checks[0].reason, "duplicate-product-readback");
});

test("does not mutate frozen expected or readback fixtures", () => {
  const expected = Object.freeze(
    expectedFixture().map((product) =>
      Object.freeze({
        ...product,
        metafields: Object.freeze(
          product.metafields.map((metafield) =>
            Object.freeze({
              ...metafield,
              definitionKey: Object.freeze({ ...metafield.definitionKey }),
              ...(Array.isArray(metafield.canonicalReference)
                ? { canonicalReference: Object.freeze([...metafield.canonicalReference]) }
                : {}),
            }),
          ),
        ),
      }),
    ),
  );
  const readback = readbackFixture();
  const snapshot = structuredClone(readback);

  validateShopifyCategoryMetafieldReadback({
    expectedProducts: expected,
    readbackProducts: readback,
  });
  assert.deepEqual(readback, snapshot);
});

test("rejects ambiguous or duplicate expected identities", () => {
  const expected = expectedFixture();
  expected[0].metafields[0].canonicalValue = "red";
  assert.throws(
    () =>
      validateShopifyCategoryMetafieldReadback({
        expectedProducts: expected,
        readbackProducts: [],
      }),
    /exactly one of canonicalValue or canonicalReference/,
  );

  assert.throws(
    () =>
      validateShopifyCategoryMetafieldReadback({
        expectedProducts: [...expectedFixture(), ...expectedFixture()],
        readbackProducts: [],
      }),
    /Duplicate expected productId/,
  );
});
