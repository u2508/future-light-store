import test from "node:test";
import assert from "node:assert/strict";

import { classifyCatalogTaxonomy } from "../../src/lib/catalog-taxonomy.js";
import { CATALOG_TAXONOMY_IMAGE_OVERRIDES } from "../../src/lib/catalog-taxonomy-image-overrides.js";

function classify({ handle, title, productType = "", tags = [] }) {
  return classifyCatalogTaxonomy({ handle, title, productType, tags });
}

test("automotive emergency first-aid kits classify as first aid, not car accessories", () => {
  const result = classify({
    handle:
      "first-aid-kit-first-aid-supplies-for-emergencies-and-survival-situations-ideal-for-cars-trucks",
    title: "First Aid Supplies Emergencies Survival Medical Kit",
    productType: "Automotive Product",
    tags: ["automotive", "car-accessories", "vehicle-accessories"],
  });

  assert.equal(result.ruleId, "automotive-emergency-first-aid-kits");
  assert.equal(result.departmentId, "health-wellness");
  assert.equal(result.subcategoryId, "first-aid-supplies");
  assert.ok(!result.collectionTargets.includes("car-accessories"));
});

test("AirPods protective cases classify as earbud cases, not phone cases", () => {
  const result = classify({
    handle: "for-airpods-pro-3-earphone-case-silicone-protective-headphone-box-cover",
    title: "Silicone Protective Earphone Case for AirPods Pro",
  });

  assert.equal(result.ruleId, "airpods-protective-cases");
  assert.equal(result.categoryId, "covers-cases");
  assert.equal(result.subcategoryId, "earbuds-cases");
  assert.notEqual(result.subcategoryId, "phone-cases");
});

test("AirPods Max carrying cases stay in headphone accessories", () => {
  const result = classify({
    handle: "portable-headphones-bag-and-carrying-case-for-airpods-max",
    title: "Protective Carrying Case for AirPods Max Headphones",
  });

  assert.equal(result.ruleId, "airpods-max-carrying-cases");
  assert.equal(result.categoryId, "audio");
  assert.equal(result.subcategoryId, "headphones-headsets");
});

test("Huawei smartwatch covers classify as watch accessories, not phone cases", () => {
  const result = classify({
    handle:
      "watch-case-protective-cover-for-huawei-honor-choice-rossini-2i-hard-pc-frame-glass-full-coverage-cases-shell-accessories",
    title: "Huawei Honor Choice Rossini 2i Watch Protective Case Cover",
  });

  assert.equal(result.ruleId, "huawei-watch-protective-cases");
  assert.equal(result.departmentId, "watches");
  assert.equal(result.categoryId, "watches");
  assert.equal(result.subcategoryId, "watch-cases");
  assert.notEqual(result.subcategoryId, "phone-cases");
});

test("a Huawei case without explicit phone or watch context is held for review", () => {
  const result = classify({
    handle: "protective-case-cover-for-huawei-honor",
    title: "Protective Case Cover for Huawei Honor",
  });

  assert.equal(result.ruleId, "unclassified");
  assert.equal(result.reviewRequired, true);
  assert.equal(result.seoEligible, false);
});

test("explicit phone cases retain the phone-cases classification", () => {
  const result = classify({
    handle: "shockproof-phone-case-for-samsung-galaxy-s24",
    title: "Shockproof Phone Case for Samsung Galaxy S24",
  });

  assert.equal(result.ruleId, "phone-case");
  assert.equal(result.subcategoryId, "phone-cases");
});

test("recreated product IDs do not inherit an older image review for the same handle", () => {
  assert.equal(
    CATALOG_TAXONOMY_IMAGE_OVERRIDES.some(
      (override) => override.id === "image-future-light-15983063826513",
    ),
    false,
  );
});
