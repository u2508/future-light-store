import assert from "node:assert/strict";
import test from "node:test";
import { reconcileShopifyCategoryMetafieldDefinitions } from "./shopify-category-metafield-definitions.mjs";

const categoryId = "gid://shopify/TaxonomyCategory/aa-1";
const secondCategoryId = "gid://shopify/TaxonomyCategory/aa-2";
const definitionId = "gid://shopify/MetafieldDefinition/101";

function products() {
  return [
    { id: "gid://shopify/Product/1", category: { id: categoryId, name: "Brooches", fullName: "Apparel > Jewelry > Brooches" } },
    { id: "gid://shopify/Product/2", category: { id: secondCategoryId, name: "Bracelets", fullName: "Apparel > Jewelry > Bracelets" } },
  ];
}

function definition(overrides = {}) {
  return {
    id: definitionId,
    name: "Jewelry material",
    namespace: "shopify",
    key: "jewelry-material",
    ownerType: "PRODUCT",
    type: { name: "list.metaobject_reference" },
    validations: [{ name: "metaobject_definition_id", value: "gid://shopify/MetaobjectDefinition/55" }],
    constraints: { key: "category" },
    ...overrides,
  };
}

function completeResults() {
  return [
    { categoryId, definitions: [definition()], hasNextPage: false },
    { categoryId: secondCategoryId, definitions: [definition()], hasNextPage: false },
  ];
}

test("reconciles exact Shopify category definitions and their typed reference schema", () => {
  const result = reconcileShopifyCategoryMetafieldDefinitions({
    productRecords: products(),
    definitionsByCategory: completeResults(),
  });
  assert.deepEqual(result.counts, {
    categories: 2,
    categoryDefinitionAssignments: 2,
    uniqueDefinitions: 1,
    validationRules: 1,
  });
  assert.equal(result.categories[0].definitions[0].definitionKey, "shopify.jewelry-material");
  assert.equal(result.categories[0].definitions[0].type, "list.metaobject_reference");
  assert.equal(result.categories[0].definitions[0].validations[0].value, "gid://shopify/MetaobjectDefinition/55");
});

test("fails closed on a missing, duplicate, or extra category result", () => {
  assert.throws(
    () => reconcileShopifyCategoryMetafieldDefinitions({ productRecords: products(), definitionsByCategory: [] }),
    /cohort mismatch.*missing 2/,
  );
  assert.throws(
    () => reconcileShopifyCategoryMetafieldDefinitions({ productRecords: products(), definitionsByCategory: [completeResults()[0], completeResults()[0]] }),
    /Duplicate category/,
  );
  assert.throws(
    () => reconcileShopifyCategoryMetafieldDefinitions({ productRecords: products(), definitionsByCategory: [...completeResults(), { categoryId: "gid://shopify/TaxonomyCategory/extra", definitions: [], hasNextPage: false }] }),
    /unassigned category/,
  );
});

test("refuses incomplete pages or missing definition fields", () => {
  const paginated = completeResults();
  paginated[0].hasNextPage = true;
  assert.throws(
    () => reconcileShopifyCategoryMetafieldDefinitions({ productRecords: products(), definitionsByCategory: paginated }),
    /not fully paginated/,
  );
  const missingType = completeResults();
  missingType[0].definitions[0].type = null;
  assert.throws(
    () => reconcileShopifyCategoryMetafieldDefinitions({ productRecords: products(), definitionsByCategory: missingType }),
    /value type must be a non-empty string/,
  );
});

test("refuses non-product or non-category definitions and duplicate keys", () => {
  for (const changes of [
    { ownerType: "PRODUCTVARIANT" },
    { constraints: { key: "vendor" } },
  ]) {
    const rows = completeResults();
    rows[0].definitions[0] = definition(changes);
    assert.throws(
      () => reconcileShopifyCategoryMetafieldDefinitions({ productRecords: products(), definitionsByCategory: rows }),
      /not owned by PRODUCT|not constrained by product category/,
    );
  }
  const duplicates = completeResults();
  duplicates[0].definitions.push(definition({ id: "gid://shopify/MetafieldDefinition/102" }));
  assert.throws(
    () => reconcileShopifyCategoryMetafieldDefinitions({ productRecords: products(), definitionsByCategory: duplicates }),
    /Duplicate category metafield definition/,
  );
});

test("allows one shared definition across categories but rejects conflicting schema", () => {
  const rows = completeResults();
  const result = reconcileShopifyCategoryMetafieldDefinitions({ productRecords: products(), definitionsByCategory: rows });
  assert.equal(result.counts.uniqueDefinitions, 1);
  rows[1].definitions[0] = definition({ type: { name: "single_line_text_field" } });
  assert.throws(
    () => reconcileShopifyCategoryMetafieldDefinitions({ productRecords: products(), definitionsByCategory: rows }),
    /conflicting schema/,
  );
});
