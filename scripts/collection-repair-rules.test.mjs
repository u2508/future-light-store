import test from "node:test";
import assert from "node:assert/strict";

import { classifyCatalogTaxonomyByRuleId } from "../src/lib/catalog-taxonomy.js";
import { validateCollectionRepairRules } from "./validate-collection-repair-rules.mjs";

test("Future Light Store collection guards cover cross-category leakage and evidence gates", () => {
  const report = validateCollectionRepairRules();
  assert.equal(report.status, "passed");
  assert.equal(report.cases.length >= 10, true);
  assert.equal(report.cases.every((entry) => Array.isArray(entry.tags)), true);
});

test("retired face-mask taxonomy target resolves to canonical health-wellness", () => {
  const classification = classifyCatalogTaxonomyByRuleId(
    { title: "Wearable LED Facial Treatment Mask", handle: "wearable-led-facial-treatment-mask" },
    "face-masks",
  );
  assert.equal(classification.collectionTargets.includes("health-wellness"), true);
  assert.equal(classification.collectionTargets.includes("face-mask"), false);
});
