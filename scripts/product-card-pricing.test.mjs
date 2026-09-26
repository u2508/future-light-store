import assert from "node:assert/strict";
import test from "node:test";
import { resolveProductCardPricing } from "../src/lib/product-card-pricing.mjs";

const money = (amount) => ({ amount, currencyCode: "USD" });

test("variable-price cards show the product minimum as From and avoid cross-variant markdowns", () => {
  const result = resolveProductCardPricing({
    variantsCount: { count: 3 },
    priceRange: { minVariantPrice: money("29.99") },
    variants: {
      edges: [
        {
          node: {
            price: money("34.99"),
            compareAtPrice: money("44.99"),
            availableForSale: true,
          },
        },
      ],
    },
  });

  assert.deepEqual(result, { price: money("29.99"), compareAt: null, showFrom: true });
});

test("single-variant cards retain the exact variant price and compare-at value", () => {
  const result = resolveProductCardPricing({
    variantsCount: { count: 1 },
    priceRange: { minVariantPrice: money("19.99") },
    variants: {
      edges: [
        {
          node: {
            price: money("19.99"),
            compareAtPrice: money("24.99"),
            availableForSale: true,
          },
        },
      ],
    },
  });

  assert.deepEqual(result, { price: money("19.99"), compareAt: "24.99", showFrom: false });
});

test("missing variant-count metadata derives variable pricing from returned options", () => {
  const result = resolveProductCardPricing({
    priceRange: { minVariantPrice: money("12.00") },
    variants: {
      edges: [
        { node: { price: money("15.00"), availableForSale: true } },
        { node: { price: money("12.00"), availableForSale: true } },
      ],
    },
  });

  assert.deepEqual(result, { price: money("12.00"), compareAt: null, showFrom: true });
});
