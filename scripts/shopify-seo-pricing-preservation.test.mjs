import assert from "node:assert/strict";
import test from "node:test";

import {
  enforceCompareAtValue,
  suggestRetailPriceFromSignals,
} from "../src/lib/shopify-seo-batch-intelligence.js";

test("SEO pricing preserves the existing price regardless of cost, anchor, or confidence", () => {
  assert.equal(
    suggestRetailPriceFromSignals({
      cost: 9.4,
      anchorPrice: 44.99,
      currentPrice: 19.99,
      confidence: 100,
    }),
    "19.99",
  );
  assert.equal(suggestRetailPriceFromSignals({ currentPrice: "4.9" }), "4.90");
});

test("SEO pricing does not invent a retail price when the current price is missing", () => {
  assert.equal(
    suggestRetailPriceFromSignals({
      cost: 2,
      anchorPrice: 29.99,
      currentPrice: null,
      confidence: 100,
    }),
    "",
  );
});

test("SEO planning preserves only an existing compare-at value and never creates a sale anchor", () => {
  assert.equal(enforceCompareAtValue("29.99", "19.99", { Title: "Earrings" }), "29.99");
  assert.equal(enforceCompareAtValue(null, "19.99", { Title: "Earrings" }), "");
});
