import test from "node:test";
import assert from "node:assert/strict";

import {
  PRICE_REWORK_RULES,
  nominalMarketPriceFor,
} from "../src/lib/shopify-price-rework-policy.js";

test("nominal pricing includes the fixed overhead and minimum contribution", () => {
  const pricing = nominalMarketPriceFor({
    cost: 10,
    currentPrice: 100,
    title: "USB charging adapter",
  });

  assert.equal(PRICE_REWORK_RULES.overhead, 16);
  assert.ok(Number(pricing.price) >= 10 + PRICE_REWORK_RULES.overhead + PRICE_REWORK_RULES.minimumNetContribution);
  assert.ok(Number(pricing.price) < 100);
});

test("low-cost products cannot fall below the approved overhead plus contribution target", () => {
  const pricing = nominalMarketPriceFor({
    cost: 0.45,
    currentPrice: 17.99,
    title: "Building blocks connection set",
  });

  assert.ok(Number(pricing.price) >= 0.45 + PRICE_REWORK_RULES.overhead + PRICE_REWORK_RULES.minimumNetContribution);
  assert.equal(pricing.price, "29.99");
});

test("handle identity wins over a stale generated title for price band selection", () => {
  const pricing = nominalMarketPriceFor({
    cost: 20,
    handle: "camping-wine-cooler-bag-insulated-tote",
    title: "Women's Handbag",
  });

  assert.equal(pricing.marketBand.id, "outdoor");
});

test("pricing policy exposes the requested per-product overhead", () => {
  assert.equal(PRICE_REWORK_RULES.overhead, 16);
});

test("decimal-scale cost anomalies are normalized only for effective price input", () => {
  const pricing = nominalMarketPriceFor({
    cost: 149700,
    currentPrice: 291939.99,
    title: "Wireless Bluetooth Earbuds",
  });

  assert.equal(pricing.scaleFactor, 1000);
  assert.equal(pricing.effectiveCost.toFixed(2), "149.70");
  assert.ok(Number(pricing.price) < 300);
});

test("variant-relative decimal anomalies use peer cost and price evidence", () => {
  const pricing = nominalMarketPriceFor({
    cost: 152.42,
    currentPrice: 319.99,
    title: "Natural scalp nourishing hair oil",
    referenceCosts: [15.24, 15.24, 152.42],
    referencePrices: [59.99, 59.99, 319.99],
  });

  assert.equal(pricing.scaleFactor, 10);
  assert.equal(pricing.effectiveCost.toFixed(2), "15.24");
  assert.ok(Number(pricing.price) < 100);
});

test("cat-ear headphones stay in audio pricing instead of pet pricing", () => {
  const pricing = nominalMarketPriceFor({
    cost: 149700,
    currentPrice: 291939.99,
    handle: "wireless-headphones-cat-ear-gaming-headset-glow-light-bluetooth-compatible",
    title: "Wireless Bluetooth Earbuds",
  });

  assert.equal(pricing.marketBand.id, "audio");
  assert.equal(pricing.scaleFactor, 1000);
  assert.ok(Number(pricing.price) < 300);
});
