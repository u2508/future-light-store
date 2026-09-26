import assert from "node:assert/strict";
import test from "node:test";

import { buildSeoBatchPlan } from "../src/lib/shopify-seo-batch.js";

test("legacy SEO planner preserves the current variant price and compare-at value", async () => {
  const { products } = await buildSeoBatchPlan([
    {
      Handle: "gold-tone-earrings",
      Title: "Gold Tone Earrings",
      "Variant ID": "123456789",
      "Variant SKU": "EAR-01",
      "Variant Price": "19.99",
      "Variant Compare At Price": "29.99",
      "Cost per item": "2.50",
    },
  ]);

  assert.equal(products[0].variantUpdates.length, 1);
  assert.equal(products[0].variantUpdates[0].price, "19.99");
  assert.equal(products[0].variantUpdates[0].compareAtPrice, "29.99");
});

test("legacy SEO planner does not invent a price when the source price is missing", async () => {
  const { products } = await buildSeoBatchPlan([
    {
      Handle: "unpriced-earrings",
      Title: "Gold Tone Earrings",
      "Variant ID": "987654321",
      "Cost per item": "2.50",
    },
  ]);

  assert.deepEqual(products[0].variantUpdates, []);
});
