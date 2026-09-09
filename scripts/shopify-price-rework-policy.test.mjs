import test from "node:test";
import assert from "node:assert/strict";

import {
  PRICE_REWORK_RULES,
  costBasedPriceFor,
  multiplierForCost,
} from "../src/lib/shopify-price-rework-policy.js";

test("cost-based pricing adds the fixed overhead to the multiplier target", () => {
  const cost = 10;
  const multiplier = multiplierForCost(cost);
  const expectedBeforeRounding = cost * multiplier + PRICE_REWORK_RULES.overhead;
  const target = Number(costBasedPriceFor(cost));

  assert.equal(multiplier, 3.25);
  assert.ok(target >= expectedBeforeRounding);
  assert.ok(target >= cost + PRICE_REWORK_RULES.overhead);
  assert.notEqual(target, Number((cost * multiplier).toFixed(2)));
});

test("pricing policy exposes the requested per-product overhead", () => {
  assert.equal(PRICE_REWORK_RULES.overhead, 16);
});
