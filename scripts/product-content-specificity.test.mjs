import test from "node:test";
import assert from "node:assert/strict";

import { assessProductContentSpecificity } from "../src/lib/product-content-specificity.js";

const product = {
  handle: "foldable-camping-inflatable-mattress",
  title: "Foldable Camping Inflatable Mattress",
  productType: "Camping Mattress",
  tags: ["outdoor", "sleeping gear"],
};

test("rejects generic copy used by previous SEO templates", () => {
  const assessment = assessProductContentSpecificity(
    "This product serves the specific function identified by its handle. Confirmed product facts and available options help shoppers compare it.",
    product,
    { field: "description", rejectGenericPatterns: true },
  );

  assert.equal(assessment.specific, false);
  assert.ok(assessment.issues.includes("generic-filler-pattern"));
});

test("rejects raw supplier labels and boilerplate care instructions", () => {
  const assessment = assessProductContentSpecificity(
    "Brand Name: Generic Supplier. Catalog tag: camping. Source Specifications. Use it only for the stated task and keep it in a clean, dry place when not in use.",
    product,
    { field: "description", rejectGenericPatterns: true },
  );

  assert.equal(assessment.specific, false);
  assert.ok(assessment.issues.includes("generic-filler-pattern"));
  assert.ok(assessment.genericPatterns.length >= 4);
});

test("decodes HTML entities before detecting boilerplate", () => {
  const assessment = assessProductContentSpecificity(
    "Foldable camping inflatable mattress. Use it only for the stated task &amp; follow all supplied setup, handling, and care instructions.",
    product,
    { field: "description", rejectGenericPatterns: true },
  );

  assert.equal(assessment.specific, false);
  assert.ok(assessment.issues.includes("generic-filler-pattern"));
});

test("accepts product-led, evidence-grounded language without template filler", () => {
  const assessment = assessProductContentSpecificity(
    "A foldable inflatable camping mattress gives you a compact sleeping surface for a tent or guest setup. Check the listed dimensions and packed size against your available space before ordering.",
    product,
    { field: "description", rejectGenericPatterns: true },
  );

  assert.equal(assessment.specific, true);
  assert.deepEqual(assessment.issues, []);
  assert.deepEqual(assessment.genericPatterns, []);
});
