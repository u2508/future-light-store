import assert from "node:assert/strict";
import test from "node:test";

import { aggregateShopifySalesOrders } from "./future-light-shopify-sales-baseline.mjs";

const now = Date.parse("2026-09-25T00:00:00.000Z");
const productId = "gid://shopify/Product/10";
const variantId = "gid://shopify/ProductVariant/11";

function line({ quantity = 2, amount = "40.00", currency = "USD" } = {}) {
  return {
    currentQuantity: quantity,
    priceAfterAllDiscountsBeforeTaxesSet: { shopMoney: { amount, currencyCode: currency } },
    product: { id: productId },
    variant: { id: variantId },
  };
}

test("sales baseline counts only completed non-test orders and net refunded quantities", () => {
  const result = aggregateShopifySalesOrders({
    now,
    shopCurrency: "USD",
    catalogProductIds: new Set([productId]),
    orders: [
      { createdAt: "2026-09-20T00:00:00Z", displayFinancialStatus: "PAID", lineItems: { nodes: [line({ quantity: 1, amount: "20.00" })] } },
      { createdAt: "2026-08-20T00:00:00Z", displayFinancialStatus: "PARTIALLY_REFUNDED", lineItems: { nodes: [line({ quantity: 1, amount: "20.00" })] } },
      { createdAt: "2026-09-20T00:00:00Z", displayFinancialStatus: "PAID", test: true, lineItems: { nodes: [line()] } },
      { createdAt: "2026-09-20T00:00:00Z", displayFinancialStatus: "PAID", cancelledAt: "2026-09-21T00:00:00Z", lineItems: { nodes: [line()] } },
      { createdAt: "2026-09-20T00:00:00Z", displayFinancialStatus: "PENDING", lineItems: { nodes: [line()] } },
    ],
  });

  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].days28.paidOrderCount, 1);
  assert.equal(result.products[0].days28.netUnits, 1);
  assert.equal(result.products[0].days28.netMerchandiseSales, 20);
  assert.equal(result.products[0].days60.paidOrderCount, 2);
  assert.equal(result.products[0].days60.netUnits, 2);
  assert.deepEqual(result.excludedOrderCounts, { test: 1, cancelled: 1, unpaidOrOtherFinancialStatus: 1 });
});

test("baseline counts an order once per product and keeps variant-level sales separate", () => {
  const secondVariant = "gid://shopify/ProductVariant/12";
  const result = aggregateShopifySalesOrders({
    now,
    shopCurrency: "USD",
    catalogProductIds: new Set([productId]),
    orders: [{
      createdAt: "2026-09-20T00:00:00Z",
      displayFinancialStatus: "PAID",
      lineItems: { nodes: [line({ quantity: 1, amount: "10.00" }), { ...line({ quantity: 2, amount: "30.00" }), variant: { id: secondVariant } }] },
    }],
  });

  assert.equal(result.products[0].days28.paidOrderCount, 1);
  assert.equal(result.products[0].days28.netUnits, 3);
  assert.equal(result.products[0].days28.netMerchandiseSales, 40);
  assert.equal(result.variants.length, 2);
  assert.equal(result.variants[0].days28.netUnits, 2);
});

test("baseline holds malformed scope or mismatched line currency", () => {
  assert.throws(() => aggregateShopifySalesOrders({ orders: [], catalogProductIds: [], shopCurrency: "USD" }), /Set/);
  assert.throws(() => aggregateShopifySalesOrders({ orders: [], catalogProductIds: new Set(), shopCurrency: "" }), /Shop currency/);
  assert.throws(() => aggregateShopifySalesOrders({
    now,
    shopCurrency: "USD",
    catalogProductIds: new Set([productId]),
    orders: [{ createdAt: "2026-09-20T00:00:00Z", displayFinancialStatus: "PAID", lineItems: { nodes: [line({ currency: "CAD" })] } }],
  }), /currency/);
});
