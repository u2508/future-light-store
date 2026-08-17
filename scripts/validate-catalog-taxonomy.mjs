#!/usr/bin/env node

import { resolve } from "node:path";

import {
  CATALOG_TAXONOMY_VERSION,
  getCatalogTaxonomyDefinitions,
} from "../src/lib/catalog-taxonomy.js";
import { CATALOG_TAXONOMY_OVERRIDES } from "../src/lib/catalog-taxonomy-overrides.js";
import { isImageReviewedCatalogTaxonomyOverride } from "../src/lib/catalog-taxonomy-image-overrides.js";
import { classifyProductKnowledge } from "../src/lib/product-knowledge-base.js";
import { readProductCatalogPayload } from "./product-catalog-files.mjs";
import { readCatalogKnowledgeModel } from "./catalog-knowledge-model-files.mjs";
import { scoreCatalogKnowledgeModelBatch } from "./catalog-knowledge-model-accelerator.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const dataDir = resolve(rootDir, "public", "data");
const ruleIds = new Set(getCatalogTaxonomyDefinitions().map((entry) => entry.id));

function addError(errors, message) {
  if (errors.length < 100) errors.push(message);
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function productImageUrls(product) {
  return [...new Set(
    (Array.isArray(product?.images) ? product.images : [])
      .map((image) => (typeof image === "string" ? image : image?.src || image?.url || image?.originalSrc || ""))
      .map(normalizeText)
      .filter(Boolean),
  )];
}

function validateOverrides(errors, products) {
  const productById = new Map(products.map((product) => [normalizeText(product?.id), product]));
  const productByHandle = new Map(products.map((product) => [normalizeText(product?.handle).toLowerCase(), product]));
  const overrideIds = new Set();
  const productIds = new Set();
  const handles = new Set();

  for (const override of CATALOG_TAXONOMY_OVERRIDES) {
    const id = String(override?.id || "unknown");
    if (overrideIds.has(id)) addError(errors, `Override ${id} is duplicated.`);
    overrideIds.add(id);
    if (!override?.approved) addError(errors, `Override ${id} is not explicitly approved.`);
    if (!override?.ruleId || !ruleIds.has(override.ruleId)) {
      addError(errors, `Override ${id} references an unknown taxonomy rule.`);
    }
    if (!override?.productId && !override?.handle) {
      addError(errors, `Override ${id} does not identify a product.`);
    }
    if (!String(override?.reason || "").trim()) {
      addError(errors, `Override ${id} has no review reason.`);
    }
    if (override?.productId) {
      const productId = normalizeText(override.productId);
      if (productIds.has(productId)) addError(errors, `Override ${id} duplicates product ID ${productId}.`);
      productIds.add(productId);
    }
    if (override?.handle) {
      const handle = normalizeText(override.handle).toLowerCase();
      if (handles.has(handle)) addError(errors, `Override ${id} duplicates handle ${handle}.`);
      handles.add(handle);
    }
    if (!override?.imageReviewed) continue;

    const product = productById.get(normalizeText(override.productId)) || productByHandle.get(normalizeText(override.handle).toLowerCase());
    if (!product) {
      addError(errors, `Image-reviewed override ${id} does not match a product in the current catalog.`);
      continue;
    }
    if (!isImageReviewedCatalogTaxonomyOverride(override)) {
      addError(errors, `Image-reviewed override ${id} has incomplete evidence.`);
      continue;
    }
    if (!productImageUrls(product).includes(normalizeText(override.imageUrl))) {
      addError(errors, `Image-reviewed override ${id} references an image absent from the current catalog.`);
    }
  }
}

function validateFalseFriendFixtures(errors) {
  const fixtures = [
    ["belt", { id: 1, title: "Women Leather Waist Belt", handle: "women-leather-waist-belt" }, "belts"],
    ["pants", { id: 2, title: "Men Cargo Pants", handle: "men-cargo-pants" }, "trousers-pants"],
    ["phone case", { id: 3, title: "Shockproof iPhone Case", handle: "shockproof-iphone-case" }, "phone-cases"],
    ["phone holder", { id: 4, title: "Car Phone Holder Mount", handle: "car-phone-holder-mount" }, "phone-holders-mounts"],
    ["ring light", { id: 5, title: "Ring Light With Tripod", handle: "ring-light-tripod" }, "ring-lights"],
    ["charger", { id: 6, title: "Fast USB C Charger", handle: "fast-usb-c-charger", tags: ["lighting"] }, "power-adapters-chargers"],
    [
      "pants with a belt in the supplier handle",
      {
        id: 7,
        title: "Unisex Casual Elegant Pants For Work And Weekend Looks",
        handle: "womens-trousers-autumn-new-one-perfect-pant-store-streetwear-fashion-belt-casual-slim-pants-black-sexy-elegant-female-trousers",
      },
      "trousers-pants",
    ],
    [
      "watch with a night light in the supplier handle",
      {
        id: 8,
        title: "Smael Mens Watch Multifunctional Sports 50m",
        handle: "smael-8109-new-mens-watch-multifunctional-sports-50m-waterproof-dual-display-led-night-light-leisure-student-electronic-watch",
      },
      "fashion-watches",
    ],
    [
      "vehicle charger with night lamp supplier wording",
      {
        id: 9,
        title: "Automatic Solar Panel Battery Charger Board Night Light LED Lamp",
        handle: "automatic-solar-panel-battery-charger-board-night-light-led-lamp-control-switch-battery-charger-charging-controller-module",
        tags: ["car", "electronic assessories"],
      },
      "vehicle-battery-chargers",
    ],
  ];

  for (const [name, product, expectedSubcategory] of fixtures) {
    const knowledge = classifyProductKnowledge(product);
    if (knowledge.subcategoryId !== expectedSubcategory) {
      addError(errors, `False-friend fixture ${name} resolved to ${knowledge.subcategoryId || "unknown"}.`);
    }
  }
}

async function main() {
  const payload = await readProductCatalogPayload(dataDir);
  const products = Array.isArray(payload?.products) ? payload.products : [];
  const knowledgeModel = await readCatalogKnowledgeModel({
    required: process.env.SALT_REQUIRE_KNOWLEDGE_MODEL === "1",
  });
  const modelEvidenceByKey = await scoreCatalogKnowledgeModelBatch(knowledgeModel, products);
  if (modelEvidenceByKey) {
    process.stdout.write(`MLX/Metal knowledge scoring completed for ${modelEvidenceByKey.size}/${products.length} products.\n`);
  }
  const errors = [];
  const knowledgeIds = new Set();
  const specificTypeKeys = new Set();
  let eligibleProducts = 0;
  let heldProducts = 0;

  if (!products.length) addError(errors, "Catalog has no products.");
  validateOverrides(errors, products);
  validateFalseFriendFixtures(errors);

  for (const product of products) {
    const modelEvidence = modelEvidenceByKey?.get(String(product?.id || product?.handle || ""));
    const knowledge = classifyProductKnowledge(product, { knowledgeModel, modelEvidence });
    const label = String(product?.handle || product?.id || "unknown-product");
    const tags = Array.isArray(knowledge.proposedTags) ? knowledge.proposedTags : [];

    if (!knowledge.productKnowledgeId) addError(errors, `${label}: missing product knowledge identity.`);
    if (knowledgeIds.has(knowledge.productKnowledgeId)) {
      addError(errors, `${label}: duplicate product knowledge identity ${knowledge.productKnowledgeId}.`);
    }
    knowledgeIds.add(knowledge.productKnowledgeId);

    if (!knowledge.specificTypeKey) addError(errors, `${label}: missing specific product descriptor key.`);
    if (specificTypeKeys.has(knowledge.specificTypeKey)) {
      addError(errors, `${label}: duplicate specific product descriptor key ${knowledge.specificTypeKey}.`);
    }
    specificTypeKeys.add(knowledge.specificTypeKey);

    if (knowledge.reviewRequired || !knowledge.seoEligible) {
      heldProducts += 1;
      if (knowledge.seoEligible) addError(errors, `${label}: review-required product is SEO eligible.`);
      if (tags.length) addError(errors, `${label}: review-required product has managed SEO tags.`);
      continue;
    }

    eligibleProducts += 1;
    if (knowledge.classificationRule === "unclassified") addError(errors, `${label}: unclassified product is SEO eligible.`);
    if ((knowledge.confidence || 0) < 72) addError(errors, `${label}: SEO-eligible confidence is below 72.`);
    if (!knowledge.departmentId || !knowledge.categoryId || !knowledge.subcategoryId || !knowledge.canonicalTypeId) {
      addError(errors, `${label}: SEO-eligible product is missing taxonomy fields.`);
    }
    if (!tags.length) addError(errors, `${label}: SEO-eligible product has no canonical managed tags.`);
    if (new Set(tags).size !== tags.length) addError(errors, `${label}: proposed managed tags contain duplicates.`);
    if (tags.some((tag) => !String(tag).trim() || String(tag).includes(":"))) {
      addError(errors, `${label}: proposed tags must use canonical simple syntax.`);
    }
  }

  const summary = {
    taxonomyVersion: CATALOG_TAXONOMY_VERSION,
    products: products.length,
    eligibleProducts,
    heldProducts,
    uniqueProductKnowledgeRecords: knowledgeIds.size,
    uniqueSpecificProductDescriptorKeys: specificTypeKeys.size,
    overrideCount: CATALOG_TAXONOMY_OVERRIDES.length,
    errors: errors.length,
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (errors.length) {
    process.stderr.write(`Catalog taxonomy validation failed:\n${errors.map((error) => `- ${error}`).join("\n")}\n`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
