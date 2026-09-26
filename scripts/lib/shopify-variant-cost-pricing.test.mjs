import test from "node:test";
import assert from "node:assert/strict";

import { buildVariantCostPriceAlignmentPlan } from "../../src/lib/shopify-variant-cost-pricing.js";

test("legacy same-product cost alignment holds when exact market and contribution evidence is absent", () => {
  const plan = buildVariantCostPriceAlignmentPlan([
    {
      handle: "sample-widget",
      title: "Sample Widget",
      variants: [
        { id: "gid://shopify/ProductVariant/1", title: "Blue", cost_per_item: 10, price: 19.99 },
        { id: "gid://shopify/ProductVariant/2", title: "Red", cost_per_item: 10.5, price: 20.99 },
      ],
    },
  ]);

  assert.equal(plan.summary.variantsToUpdate, 0);
  assert.equal(plan.blockingHeld.length, 2);
  assert.equal(plan.summary.priceFloor, 0.99);
  assert.ok(
    plan.blockingHeld.every((entry) =>
      /verified[-_ ]landed|comparables|payment[-_ ]fee|currency/i.test(entry.reason),
    ),
  );
});
