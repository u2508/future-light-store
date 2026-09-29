import test from "node:test";
import assert from "node:assert/strict";

import {
  freshPricePreimageFailure,
  reviewedUsComparables,
} from "./shopify-price-rework.mjs";

const now = Date.parse("2026-09-27T12:00:00.000Z");

function comparable(index, overrides = {}) {
  const day = new Date(now - 60 * 60 * 1000).toISOString();
  return {
    retailer: `Retailer ${index}`,
    url: `https://retailer-${index}.example/product-${index}`,
    market: "US",
    currencyCode: "USD",
    matchType: "exact",
    checkedAt: day,
    itemPrice: 49.99 + index,
    shippingPrice: 0,
    reviewStatus: "approved",
    reviewedBy: "Pricing reviewer",
    reviewedAt: day,
    ...overrides,
  };
}

function expectedProduct(overrides = {}) {
  return {
    productId: "gid://shopify/Product/100",
    handle: "test-product",
    variants: [{
      variantId: "gid://shopify/ProductVariant/200",
      cost: "10.00",
      unitCostCurrencyCode: "USD",
      currentPrice: "25.00",
      currentCompareAtPrice: "30.00",
    }],
    ...overrides,
  };
}

function liveProduct(overrides = {}) {
  return {
    id: "gid://shopify/Product/100",
    handle: "test-product",
    variants: {
      nodes: [{
        id: "gid://shopify/ProductVariant/200",
        price: "25.00",
        compareAtPrice: "30.00",
        inventoryItem: { unitCost: { amount: "10.00", currencyCode: "USD" } },
      }],
      pageInfo: { hasNextPage: false },
    },
    ...overrides,
  };
}

test("admits only three fresh, explicitly reviewed, independent exact US/USD comparables", () => {
  const result = reviewedUsComparables([comparable(1), comparable(2), comparable(3)], { now });
  assert.equal(result.reason, "");
  assert.equal(result.comparables.length, 3);
});

test("holds when comparable review is missing, stale, future-dated, or not US/USD exact", () => {
  const cases = [
    [comparable(1, { reviewStatus: "pending" }), comparable(2), comparable(3)],
    [comparable(1, { reviewedBy: "" }), comparable(2), comparable(3)],
    [comparable(1, { reviewedAt: "2026-08-01T00:00:00.000Z" }), comparable(2), comparable(3)],
    [comparable(1, { reviewedAt: "2026-09-27T13:00:00.000Z" }), comparable(2), comparable(3)],
    [comparable(1, { market: "CA" }), comparable(2), comparable(3)],
    [comparable(1, { currencyCode: "CAD" }), comparable(2), comparable(3)],
    [comparable(1, { matchType: "similar" }), comparable(2), comparable(3)],
  ];
  for (const comparables of cases) {
    const result = reviewedUsComparables(comparables, { now });
    assert.notEqual(result.reason, "");
    assert.ok(result.comparables.length < 3);
  }
});

test("does not count duplicate retailer hosts as independent reviewed evidence", () => {
  const result = reviewedUsComparables([
    comparable(1, { url: "https://retailer.example/product-a" }),
    comparable(2, { url: "https://www.retailer.example/product-b" }),
    comparable(3),
  ], { now });
  assert.match(result.reason, /at least 3/);
  assert.equal(result.comparables.length, 2);
});

test("accepts a fresh Shopify preimage only when exact variant price, compare-at, cost, and currency match", () => {
  assert.equal(freshPricePreimageFailure(expectedProduct(), liveProduct()), "");
});

test("holds a missing or changed exact variant preimage", () => {
  const expected = expectedProduct();
  const missingVariant = liveProduct({ variants: { nodes: [], pageInfo: { hasNextPage: false } } });
  assert.match(freshPricePreimageFailure(expected, missingVariant), /missing exact variant/);

  const changedCost = liveProduct();
  changedCost.variants.nodes[0].inventoryItem.unitCost.amount = "10.01";
  assert.match(freshPricePreimageFailure(expected, changedCost), /unit cost\/currency changed/);

  const changedCurrency = liveProduct();
  changedCurrency.variants.nodes[0].inventoryItem.unitCost.currencyCode = "CAD";
  assert.match(freshPricePreimageFailure(expected, changedCurrency), /unit cost\/currency changed/);

  const changedPrice = liveProduct();
  changedPrice.variants.nodes[0].price = "24.99";
  assert.match(freshPricePreimageFailure(expected, changedPrice), /current price changed/);

  const changedCompareAt = liveProduct();
  changedCompareAt.variants.nodes[0].compareAtPrice = null;
  assert.match(freshPricePreimageFailure(expected, changedCompareAt), /compare-at price changed/);
});

test("holds an incomplete paginated preimage and a plan without an exact positive USD cost", () => {
  const incomplete = liveProduct({ variants: { nodes: [], pageInfo: { hasNextPage: true } } });
  assert.match(freshPricePreimageFailure(expectedProduct(), incomplete), /variant list is incomplete/);

  const noCost = expectedProduct();
  noCost.variants[0].cost = "";
  assert.match(freshPricePreimageFailure(noCost, liveProduct()), /no exact positive USD/);
});
