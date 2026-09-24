import test from "node:test";
import assert from "node:assert/strict";

import { buildPerformanceReport } from "./lib/marketing-performance.mjs";

const base = {
  handle: "demo-product",
  clicks: 0,
  productViews: 0,
  addToCart: 0,
  beginCheckout: 0,
  purchases: 0,
  adSpend: 0,
  revenue: 0,
  refunds: 0,
  landedCost: 0,
};

test("classifies each funnel failure at an eligible 14-day window", () => {
  const report = buildPerformanceReport({
    period: { days: 14 },
    products: [
      { ...base, handle: "creative", clicks: 12 },
      { ...base, handle: "offer", clicks: 12, productViews: 10 },
      { ...base, handle: "shipping", productViews: 10, addToCart: 2 },
      { ...base, handle: "checkout", addToCart: 2, beginCheckout: 1 },
    ],
  });

  assert.equal(report.decisionEligible, true);
  assert.deepEqual(
    report.products.map((product) => product.decision),
    [
      "change-creative-targeting",
      "fix-product-price-offer",
      "fix-shipping-trust-product-page",
      "fix-payment-price-delivery",
    ],
  );
  assert.ok(report.products.every((product) => product.budgetAction === "hold"));
});

test("only recommends scale or pause after approved CPA exists", () => {
  const report = buildPerformanceReport({
    period: { from: "2026-09-01", to: "2026-09-14" },
    products: [
      {
        ...base,
        handle: "winner",
        clicks: 100,
        productViews: 80,
        addToCart: 20,
        beginCheckout: 10,
        purchases: 2,
        adSpend: 10,
        revenue: 80,
        landedCost: 30,
        allowableCpa: 6,
      },
      {
        ...base,
        handle: "loser",
        purchases: 1,
        adSpend: 20,
        revenue: 40,
        landedCost: 15,
        allowableCpa: 10,
      },
      { ...base, handle: "unapproved-margin", purchases: 1, adSpend: 5, revenue: 30 },
    ],
  });

  assert.equal(report.period.days, 14);
  assert.deepEqual(
    report.products.map((product) => product.decision),
    ["scale-next-cycle", "pause-product", "manual-margin-review"],
  );
  assert.equal(report.products[0].economics.cpa, 5);
  assert.equal(report.products[0].economics.averageOrderValue, 40);
  assert.equal(report.totals.purchases, 4);
});

test("holds all decisions before the 14-day observation window", () => {
  const report = buildPerformanceReport({
    period: { days: 7 },
    products: [{ ...base, clicks: 30, productViews: 20, addToCart: 1 }],
  });

  assert.equal(report.decisionEligible, false);
  assert.equal(report.products[0].signal, "fix-shipping-trust-product-page");
  assert.equal(report.products[0].decision, "observe-until-14-days");
  assert.equal(report.guardrails.automaticBudgetChanges, false);
});

test("rejects negative metrics and missing handles", () => {
  assert.throws(
    () => buildPerformanceReport({ period: { days: 14 }, products: [{ ...base, clicks: -1 }] }),
    /clicks must be a non-negative number/,
  );
  assert.throws(
    () => buildPerformanceReport({ period: { days: 14 }, products: [{ ...base, handle: "" }] }),
    /handle is required/,
  );
});
