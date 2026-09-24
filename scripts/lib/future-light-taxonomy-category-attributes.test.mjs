import assert from "node:assert/strict";
import test from "node:test";
import {
  chunkTaxonomyCategoryIds,
  collectAssignedTaxonomyCategories,
  reconcileTaxonomyCategoryAttributes,
} from "./future-light-taxonomy-category-attributes.mjs";

const categoryId = "gid://shopify/TaxonomyCategory/el-1";
const secondCategoryId = "gid://shopify/TaxonomyCategory/aa-6-10-1";
function completePage() {
  return { hasNextPage: false, endCursor: null };
}

function productRecords() {
  return [
    { id: "gid://shopify/Product/1", category: { id: categoryId, name: "Cases", fullName: "Electronics > Cases" } },
    { id: "gid://shopify/Product/2", category: { id: categoryId, name: "Cases", fullName: "Electronics > Cases" } },
    { id: "gid://shopify/Product/3", category: { id: secondCategoryId, name: "Watch Bands", fullName: "Apparel & Accessories > Jewelry > Watch Accessories > Watch Bands" } },
    { id: "gid://shopify/Product/4", category: null },
  ];
}

function categoryNodes() {
  return [
    {
      __typename: "TaxonomyCategory",
      id: categoryId,
      name: "Cases",
      fullName: "Electronics > Cases",
      isLeaf: true,
      attributes: {
        nodes: [
          {
            __typename: "TaxonomyChoiceListAttribute",
            id: "gid://shopify/TaxonomyAttribute/1",
            name: "Color",
            values: {
              nodes: [
                { id: "gid://shopify/TaxonomyValue/1", name: "Black" },
                { id: "gid://shopify/TaxonomyValue/2", name: "Blue" },
              ],
              pageInfo: completePage(),
            },
          },
          { __typename: "TaxonomyAttribute", id: "gid://shopify/TaxonomyAttribute/2" },
          {
            __typename: "TaxonomyMeasurementAttribute",
            id: "gid://shopify/TaxonomyAttribute/3",
            name: "Length",
            options: [{ key: "value", value: "cm" }],
          },
        ],
        pageInfo: completePage(),
      },
    },
    {
      __typename: "TaxonomyCategory",
      id: secondCategoryId,
      name: "Watch Bands",
      fullName: "Apparel & Accessories > Jewelry > Watch Accessories > Watch Bands",
      isLeaf: true,
      attributes: { nodes: [], pageInfo: completePage() },
    },
  ];
}

test("collects each assigned category once and counts products without altering the source", () => {
  const products = productRecords();
  const categories = collectAssignedTaxonomyCategories(products);
  assert.equal(categories.length, 2);
  assert.equal(categories.find((category) => category.id === categoryId).productCount, 2);
  assert.equal(categories.find((category) => category.id === secondCategoryId).productCount, 1);
  assert.equal(products[0].category.name, "Cases");
});

test("chunks category IDs with a strict bounded batch size", () => {
  const categories = collectAssignedTaxonomyCategories(productRecords());
  assert.deepEqual(chunkTaxonomyCategoryIds(categories, 1), [[secondCategoryId], [categoryId]]);
  assert.throws(() => chunkTaxonomyCategoryIds(categories, 0), /from 1 to 250/);
  assert.throws(() => chunkTaxonomyCategoryIds([...categories, categories[0]]), /must be unique/);
});

test("reconciles live category identity, leaf status, attributes, allowed values, and measurements", () => {
  const result = reconcileTaxonomyCategoryAttributes({
    productRecords: productRecords(),
    categoryNodes: categoryNodes(),
  });
  assert.deepEqual(result.counts, {
    categories: 2,
    attributes: 3,
    choiceValues: 2,
    measurementAttributes: 1,
    unnamedTaxonomyAttributes: 1,
  });
  const cases = result.categories.find((category) => category.id === categoryId);
  assert.equal(cases.attributes[0].name, "Color");
  assert.deepEqual(cases.attributes[0].values.map((value) => value.name), ["Black", "Blue"]);
  assert.deepEqual(cases.attributes[2].options, [{ key: "value", value: "cm" }]);
});

test("fails closed on missing, extra, misidentified, or non-leaf-metadata responses", () => {
  assert.throws(
    () => reconcileTaxonomyCategoryAttributes({ productRecords: productRecords(), categoryNodes: [] }),
    /cohort mismatch/,
  );
  const changedIdentity = categoryNodes();
  changedIdentity[0].fullName = "Wrong path";
  assert.throws(
    () =>
      reconcileTaxonomyCategoryAttributes({
        productRecords: productRecords(),
        categoryNodes: changedIdentity,
      }),
    /identity disagrees/,
  );
  const missingLeafFlag = categoryNodes();
  delete missingLeafFlag[0].isLeaf;
  assert.throws(
    () =>
      reconcileTaxonomyCategoryAttributes({
        productRecords: productRecords(),
        categoryNodes: missingLeafFlag,
      }),
    /leaf-category flag/,
  );
});

test("fails closed on paginated category attributes or allowed choice values", () => {
  const moreAttributePages = categoryNodes();
  moreAttributePages[0].attributes.pageInfo.hasNextPage = true;
  assert.throws(
    () =>
      reconcileTaxonomyCategoryAttributes({
        productRecords: productRecords(),
        categoryNodes: moreAttributePages,
      }),
    /Attributes for .* is truncated/,
  );

  const missingAttributePageInfo = categoryNodes();
  delete missingAttributePageInfo[0].attributes.pageInfo;
  assert.throws(
    () =>
      reconcileTaxonomyCategoryAttributes({
        productRecords: productRecords(),
        categoryNodes: missingAttributePageInfo,
      }),
    /Attributes for .* incomplete pagination metadata/,
  );

  const moreChoicePages = categoryNodes();
  moreChoicePages[0].attributes.nodes[0].values.pageInfo.hasNextPage = true;
  assert.throws(
    () =>
      reconcileTaxonomyCategoryAttributes({
        productRecords: productRecords(),
        categoryNodes: moreChoicePages,
      }),
    /Choice values for .* is truncated/,
  );

  const missingChoicePageInfo = categoryNodes();
  delete missingChoicePageInfo[0].attributes.nodes[0].values.pageInfo;
  assert.throws(
    () =>
      reconcileTaxonomyCategoryAttributes({
        productRecords: productRecords(),
        categoryNodes: missingChoicePageInfo,
      }),
    /Choice values for .* incomplete pagination metadata/,
  );
});
