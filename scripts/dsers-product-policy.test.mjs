import test from "node:test";
import assert from "node:assert/strict";
import { inspectDsersProductCandidate } from "../src/lib/dsers-product-policy.mjs";

test("allows a complete customer-ready product", () => {
  assert.equal(inspectDsersProductCandidate({
    title: "Silicone Baby Bib with Food Catcher",
    variants: ["Sage Green", "Sand"],
  }).allowed, true);
});
test("rejects replacement and repair listings from the title", () => {
  const result = inspectDsersProductCandidate({
    title: "Replacement Screen Repair Kit for Tablet",
  });
  assert.equal(result.allowed, false);
  assert.deepEqual(result.reasonCodes, ["replacement", "repair"]);
});

test("rejects spare, refurbished, damaged, and open-box signals in variants and metadata", () => {
  const result = inspectDsersProductCandidate({
    title: "Smart Watch",
    description: "Complete watch body",
    variants: ["Black", "Refurbished open-box", "Spare part"],
  });
  assert.equal(result.allowed, false);
  assert.deepEqual(result.reasonCodes, ["spare-part", "refurbished", "open-box"]);
});

test("rejects for-parts listings even when the title looks like a normal product", () => {
  const result = inspectDsersProductCandidate({
    title: "Wireless Earbuds",
    description: "Sold for parts only; not a complete retail product",
  });
  assert.equal(result.allowed, false);
  assert.deepEqual(result.reasonCodes, ["parts-only"]);
});
