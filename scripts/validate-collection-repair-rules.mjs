#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  COLLECTION_GOVERNANCE_VERSION,
  SEMANTIC_COLLECTION_POLICIES,
  buildProductCollectionTags,
} from "../src/lib/catalog-collection-governance.js";

const rootDir = resolve(import.meta.dirname, "..");
const outputPath = resolve(rootDir, "output", "collection-repair-rules-validation.json");

const EMPTY_KNOWLEDGE = Object.freeze({
  proposedTags: [],
  collectionTargets: [],
  classificationRule: "general-merchandise",
  audience: { id: "unisex" },
});

const REPAIR_CASES = Object.freeze([
  {
    id: "home-safety-mouse-exclusion",
    product: { title: "Ergonomic Wireless Computer Mouse", handle: "ergonomic-wireless-computer-mouse", product_type: "home safety" },
    knowledge: { proposedTags: ["home-safety"], collectionTargets: ["home-safety"], classificationRule: "home-safety" },
    forbidden: ["home-safety"],
  },
  {
    id: "hats-bottle-opener-exclusion",
    product: { title: "Stainless Steel Beer Bottle Opener", handle: "stainless-steel-beer-bottle-opener" },
    knowledge: { proposedTags: ["hats"], collectionTargets: ["hats"], classificationRule: "hats-caps" },
    forbidden: ["hats"],
  },
  {
    id: "technical-product-cannot-inherit-womens-collection",
    product: { title: "Camera Mounting Arm with Female Thread", handle: "camera-mounting-arm-female-thread" },
    knowledge: { proposedTags: ["women", "womens-fashion"], collectionTargets: ["women", "womens-fashion"], departmentId: "women", audience: { id: "women" } },
    forbidden: ["women", "womens-fashion"],
  },
  {
    id: "pet-product-cannot-enter-human-fashion",
    product: { title: "Soft Dog Travel Carrier", handle: "soft-dog-travel-carrier" },
    knowledge: { proposedTags: ["womens-fashion"], collectionTargets: ["womens-fashion"], departmentId: "women", audience: { id: "women" } },
    forbidden: ["womens-fashion"],
  },
  {
    id: "garden-tool-cannot-enter-home-decor",
    product: { title: "Garden Pruning Shears", handle: "garden-pruning-shears" },
    knowledge: { proposedTags: ["home-decor"], collectionTargets: ["home-decor"], departmentId: "home-decor" },
    forbidden: ["home-decor"],
  },
  {
    id: "t-shirt-dress-exclusion",
    product: { title: "Women's Summer Dress", handle: "womens-summer-dress" },
    knowledge: { proposedTags: ["t-shirt"], collectionTargets: ["t-shirt"], subcategoryId: "t-shirts", audience: { id: "women" } },
    forbidden: ["t-shirt"],
  },
  {
    id: "gifts-for-dad-requires-intent-and-recipient",
    product: { title: "Leather Gift Set for Dad", handle: "leather-gift-set-for-dad" },
    knowledge: EMPTY_KNOWLEDGE,
    required: ["gifts-for-dad"],
  },
  {
    id: "gifts-for-mom-requires-intent-and-recipient",
    product: { title: "Personalized Birthday Present for Mom", handle: "personalized-birthday-present-for-mom" },
    knowledge: EMPTY_KNOWLEDGE,
    required: ["gifts-for-mom"],
  },
  {
    id: "back-to-school-requires-context-and-item",
    product: { title: "School Backpack for Students", handle: "school-backpack-for-students" },
    knowledge: EMPTY_KNOWLEDGE,
    required: ["back-to-school"],
  },
  {
    id: "backpack-cover-not-back-to-school",
    product: { title: "School Backpack Rain Cover", handle: "school-backpack-rain-cover" },
    knowledge: EMPTY_KNOWLEDGE,
    forbidden: ["back-to-school"],
  },
  {
    id: "daily-living-aids-requires-product-evidence",
    product: { title: "Adjustable Elderly Bed Rail Assistive Support", handle: "adjustable-elderly-bed-rail" },
    knowledge: EMPTY_KNOWLEDGE,
    required: ["daily-living-aids"],
  },
  {
    id: "senior-living-solutions-requires-product-evidence",
    product: { title: "Caregiver Daily Living Aid for Assisted Living", handle: "caregiver-daily-living-aid" },
    knowledge: EMPTY_KNOWLEDGE,
    required: ["senior-living-solutions"],
  },
  {
    id: "candles-require-candle-evidence",
    product: { title: "Scented Soy Candle in Glass Jar", handle: "scented-soy-candle-glass-jar" },
    knowledge: { ...EMPTY_KNOWLEDGE, subcategoryId: "candles-home-fragrance" },
    required: ["candles"],
  },
  {
    id: "iphone-cases-require-phone-evidence",
    product: { title: "Protective Case for iPhone 15", handle: "protective-case-for-iphone-15" },
    knowledge: { ...EMPTY_KNOWLEDGE, classificationRule: "phone-case" },
    required: ["iphone-cases"],
  },
  {
    id: "mens-tshirt-requires-audience-and-subcategory",
    product: { title: "Men's Cotton Crew Neck T-Shirt", handle: "mens-cotton-crew-neck-t-shirt" },
    knowledge: { ...EMPTY_KNOWLEDGE, subcategoryId: "t-shirts", audience: { id: "men" } },
    required: ["men-t-shirt"],
  },
  {
    id: "pet-grooming-requires-pet-department-and-tool-evidence",
    product: { title: "Dog Grooming Brush", handle: "dog-grooming-brush" },
    knowledge: { ...EMPTY_KNOWLEDGE, departmentId: "pets" },
    required: ["pet-grooming"],
  },
  {
    id: "human-footwear-scope-is-split-and-common",
    product: { title: "Women's Leather Oxford Shoes", handle: "womens-leather-oxford-shoes" },
    knowledge: { ...EMPTY_KNOWLEDGE, departmentId: "women", subcategoryId: "footwear" },
    required: ["footwear", "formal-footwear", "womens-footwear"],
  },
  {
    id: "footwear-accessory-cannot-enter-footwear",
    product: { title: "Universal Shoe Storage Bag", handle: "universal-shoe-storage-bag" },
    knowledge: { ...EMPTY_KNOWLEDGE, departmentId: "general", subcategoryId: "footwear-accessories", proposedTags: ["footwear"], collectionTargets: ["footwear"] },
    forbidden: ["footwear", "formal-footwear", "womens-footwear", "mens-footwear", "kids-footwear"],
  },
  {
    id: "jewelry-scope-includes-subtype-and-broad-collection",
    product: { title: "Gold Statement Ring", handle: "gold-statement-ring" },
    knowledge: { ...EMPTY_KNOWLEDGE, departmentId: "jewelry", subcategoryId: "rings" },
    required: ["rings", "everyday-jewelry", "jewelry-accessories"],
  },
  {
    id: "school-bag-requires-school-context-and-bag",
    product: { title: "School Backpack for Students", handle: "school-backpack-for-students" },
    knowledge: { ...EMPTY_KNOWLEDGE, subcategoryId: "backpacks" },
    required: ["school-bags", "back-to-school"],
  },
  {
    id: "school-bag-cover-cannot-enter-school-collections",
    product: { title: "School Backpack Rain Cover", handle: "school-backpack-rain-cover" },
    knowledge: { ...EMPTY_KNOWLEDGE, subcategoryId: "backpacks" },
    forbidden: ["school-bags", "back-to-school"],
  },
  {
    id: "lunch-box-excludes-bags-and-accessories",
    product: { title: "Kids School Stainless Steel Bento Lunch Box", handle: "kids-school-stainless-steel-bento-lunch-box" },
    knowledge: { ...EMPTY_KNOWLEDGE },
    required: ["lunch-boxes", "back-to-school"],
  },
  {
    id: "lunch-bag-cannot-enter-lunch-boxes",
    product: { title: "Insulated Lunch Box Bag", handle: "insulated-lunch-box-bag" },
    knowledge: { ...EMPTY_KNOWLEDGE },
    forbidden: ["lunch-boxes", "back-to-school"],
  },
  {
    id: "water-bottle-excludes-parts-and-pet-products",
    product: { title: "Kids Leakproof School Water Bottle", handle: "kids-school-water-bottle" },
    knowledge: { ...EMPTY_KNOWLEDGE },
    required: ["water-bottles", "back-to-school"],
  },
  {
    id: "water-bottle-lid-cannot-enter-water-bottles",
    product: { title: "Replacement Water Bottle Lid", handle: "replacement-water-bottle-lid" },
    knowledge: { ...EMPTY_KNOWLEDGE },
    forbidden: ["water-bottles", "back-to-school"],
  },
  {
    id: "artificial-plants-use-canonical-scope",
    product: { title: "Artificial Ivy Vine Plant for Home Decor", handle: "artificial-ivy-vine-plant-home-decor" },
    knowledge: { ...EMPTY_KNOWLEDGE },
    required: ["artificial-plants"],
  },
  {
    id: "artificial-lighting-cannot-enter-artificial-plants",
    product: { title: "Artificial Ivy Vine String Lights", handle: "artificial-ivy-vine-string-lights" },
    knowledge: { ...EMPTY_KNOWLEDGE },
    forbidden: ["artificial-plants"],
  },
  {
    id: "review-products-do-not-leak",
    product: { title: "Ambiguous Product", handle: "ambiguous-product" },
    knowledge: { ...EMPTY_KNOWLEDGE, reviewRequired: true, proposedTags: ["women"], collectionTargets: ["women"] },
    forbidden: ["women", "classification-review"],
  },
]);

const REQUIRED_POLICIES = [
  "home-safety",
  "hats",
  "gifts-for-dad",
  "gifts-for-mom",
  "back-to-school",
  "daily-living-aids",
  "senior-living-solutions",
  "candles",
  "iphone-cases",
  "men-t-shirt",
  "pet-grooming",
  "classification-fallback",
  "artificial-plants",
  "footwear",
  "mens-footwear",
  "formal-footwear",
  "womens-footwear",
  "kids-footwear",
  "wigs",
  "rings",
  "necklaces",
  "bracelets",
  "earrings",
  "everyday-jewelry",
  "school-bags",
  "lunch-boxes",
  "water-bottles",
];

export function validateCollectionRepairRules() {
  const policyHandles = new Set(SEMANTIC_COLLECTION_POLICIES.map((policy) => policy.handle));
  for (const handle of REQUIRED_POLICIES) assert(policyHandles.has(handle), `Missing governed collection policy: ${handle}`);

  const cases = REPAIR_CASES.map((repairCase) => {
    const tags = buildProductCollectionTags(repairCase.product, repairCase.knowledge);
    for (const tag of repairCase.required || []) assert(tags.includes(tag), `${repairCase.id} did not assign ${tag}`);
    for (const tag of repairCase.forbidden || []) assert(!tags.includes(tag), `${repairCase.id} incorrectly assigned ${tag}`);
    return { id: repairCase.id, tags };
  });

  return {
    schemaVersion: 1,
    governanceVersion: COLLECTION_GOVERNANCE_VERSION,
    requiredPolicies: REQUIRED_POLICIES,
    cases,
    status: "passed",
  };
}

export async function writeCollectionRepairRuleReport() {
  const report = {
    generatedAt: new Date().toISOString(),
    mode: "deterministic-collection-repair-rule-validation",
    policy: "Collection exclusions are evaluated before stale taxonomy tags or targets; positive evidence must be present for expanded collections.",
    ...validateCollectionRepairRules(),
  };
  await mkdir(resolve(rootDir, "output"), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

async function main() {
  const report = await writeCollectionRepairRuleReport();
  process.stdout.write(`Collection repair rule validation passed: ${report.cases.length} regression cases, ${report.requiredPolicies.length} governed policies.\n`);
  process.stdout.write(`Saved ${outputPath}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message || error}\n`);
    process.exitCode = 1;
  });
}
