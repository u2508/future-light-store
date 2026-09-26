import test from "node:test";
import assert from "node:assert/strict";

import {
  PRICE_REWORK_STRATEGY_ID,
  PRICE_REWORK_RULES,
  compareAtPriceFor,
  nominalMarketPriceFor,
} from "../src/lib/shopify-price-rework-policy.js";

const now = Date.parse("2026-09-25T12:00:00.000Z");

function comparable(retailer, price, checkedAt = "2026-09-25T11:00:00.000Z") {
  return {
    retailer,
    url: `https://www.${retailer.toLowerCase().replace(/[^a-z0-9]+/g, "")}.com/product`,
    market: "US",
    currencyCode: "USD",
    matchType: "exact",
    checkedAt,
    itemPrice: price,
    shippingPrice: 0,
  };
}

function viableEvidence(overrides = {}) {
  return {
    cost: 10,
    currencyCode: "USD",
    unitCostCurrencyCode: "USD",
    landedCost: 2,
    landedCostVerified: true,
    paymentFeeRate: 0.03,
    paymentFeeFixed: 0.3,
    paymentFeesVerified: true,
    orderCostAllocation: {
      overheadPerUnit: 16,
      acquisitionPerUnit: 13,
      minimumContributionPerUnit: 10,
      paymentFeeFixedPerUnit: 0.3,
    },
    orderCostAllocationVerified: true,
    expectedDiscountRate: 0,
    discountPolicyVerified: true,
    comparables: [
      comparable("Retailer One", 99),
      comparable("Retailer Two", 100),
      comparable("Retailer Three", 105),
    ],
    now,
    ...overrides,
  };
}

test("competitive price undercuts current exact US comparables and clears positive contribution", () => {
  const pricing = nominalMarketPriceFor({ ...viableEvidence(), handle: "usb-charging-adapter" });

  assert.equal(PRICE_REWORK_STRATEGY_ID, "future-light-competitive-contribution-2026-09-25-v3");
  assert.equal(PRICE_REWORK_RULES.overhead, 16);
  assert.equal(PRICE_REWORK_RULES.acquisitionCost, 13);
  assert.equal(PRICE_REWORK_RULES.minimumNetContribution, 10);
  assert.equal(pricing.price, "98.99");
  assert.equal(pricing.comparableMedian, 100);
  assert.ok(Number(pricing.price) <= pricing.aggressiveCheckoutTarget);
  const netContribution = Number(pricing.price) * 0.97 - 0.3 - 10 - 2 - 16 - 13;
  assert.ok(netContribution >= 10);
});

test("charm rounding never overshoots the competitive target", () => {
  const pricing = nominalMarketPriceFor(
    viableEvidence({
      comparables: [
        comparable("Retailer One", 42),
        comparable("Retailer Two", 42),
        comparable("Retailer Three", 42),
      ],
      cost: 1,
      landedCost: 0,
    }),
  );
  assert.equal(pricing.price, "41.99");
  assert.ok(Number(pricing.price) <= pricing.aggressiveCheckoutTarget);
});

test("holds a product when aggressive market price cannot cover cost, overhead, acquisition, fees, and contribution", () => {
  const pricing = nominalMarketPriceFor({
    ...viableEvidence({
      cost: 9.4,
      landedCost: 0,
      comparables: [
        comparable("Retailer One", 19.99),
        comparable("Retailer Two", 22.99),
        comparable("Retailer Three", 32.99),
      ],
    }),
    handle: "montessori-busy-board",
  });

  assert.equal(pricing.price, null);
  assert.equal(pricing.reason, "market-price-cannot-support-costs-and-required-contribution");
  assert.ok(pricing.requiredBasePrice > pricing.aggressiveCheckoutTarget);
});

test("requires complete, current, independent, exact US delivered-price comparables", () => {
  const examples = viableEvidence().comparables;
  const tooFew = nominalMarketPriceFor(viableEvidence({ comparables: examples.slice(0, 2) }));
  assert.equal(tooFew.price, null);
  assert.equal(tooFew.reason, "insufficient-current-independent-exact-comparables");

  const stale = nominalMarketPriceFor(
    viableEvidence({
      comparables: [
        comparable("Retailer One", 99, "2026-08-01T00:00:00.000Z"),
        comparable("Retailer Two", 100, "2026-08-01T00:00:00.000Z"),
        comparable("Retailer Three", 105, "2026-08-01T00:00:00.000Z"),
      ],
    }),
  );
  assert.equal(stale.price, null);
});

test("does not count duplicate retailer domains as independent evidence", () => {
  const duplicateDomains = [
    { ...comparable("Store A", 99), url: "https://storea.com/product" },
    { ...comparable("Store A mirror", 100), url: "https://www.storea.com/another-product" },
    comparable("Store B", 105),
  ];
  const pricing = nominalMarketPriceFor(viableEvidence({ comparables: duplicateDomains }));
  assert.equal(pricing.price, null);
  assert.equal(pricing.validComparableCount, 2);
});

test("never scales a suspicious Shopify cost down to fit a market category", () => {
  const pricing = nominalMarketPriceFor(
    viableEvidence({
      cost: 149700,
      landedCost: 0,
      comparables: [
        comparable("Retailer One", 100),
        comparable("Retailer Two", 105),
        comparable("Retailer Three", 110),
      ],
    }),
  );
  assert.equal(pricing.price, null);
  assert.equal(pricing.effectiveCost, 149700);
  assert.equal(pricing.scaleFactor, 1);
});

test("blocks missing landed cost, unverified fees, and currency mismatch", () => {
  assert.equal(
    nominalMarketPriceFor(viableEvidence({ landedCostVerified: false })).reason,
    "verified-landed-fulfillment-cost-required",
  );
  assert.equal(
    nominalMarketPriceFor(viableEvidence({ paymentFeesVerified: false })).reason,
    "verified-payment-fee-schedule-required",
  );
  assert.equal(
    nominalMarketPriceFor(viableEvidence({ orderCostAllocationVerified: false })).reason,
    "verified-order-level-cost-allocation-required",
  );
  assert.equal(
    nominalMarketPriceFor(viableEvidence({ expectedDiscountRate: null })).reason,
    "expected-discount-rate-invalid",
  );
  assert.equal(
    nominalMarketPriceFor(viableEvidence({ discountPolicyVerified: false })).reason,
    "expected-discount-rate-invalid",
  );
  assert.equal(
    nominalMarketPriceFor(viableEvidence({ unitCostCurrencyCode: "CAD" })).reason,
    "store-and-cost-currency-must-be-verified-as-USD",
  );
});

test("requires the owner-approved $10 contribution floor and does not infer an acquisition split", () => {
  const belowFloor = nominalMarketPriceFor(
    viableEvidence({
      orderCostAllocation: {
        ...viableEvidence().orderCostAllocation,
        minimumContributionPerUnit: 9.99,
      },
    }),
  );
  assert.equal(belowFloor.price, null);
  assert.equal(belowFloor.reason, "verified-order-level-cost-allocation-required");

  const noVerifiedBasketSplit = nominalMarketPriceFor(
    viableEvidence({
      orderCostAllocation: {
        ...viableEvidence().orderCostAllocation,
        acquisitionPerUnit: 0,
      },
      orderCostAllocationVerified: false,
    }),
  );
  assert.equal(noVerifiedBasketSplit.price, null);
  assert.equal(noVerifiedBasketSplit.reason, "verified-order-level-cost-allocation-required");
});

test("keeps $16 overhead on every product while allocating the $13 acquisition and order contribution across basket lines", () => {
  const comparables = [
    comparable("Retailer One", 50),
    comparable("Retailer Two", 52),
    comparable("Retailer Three", 55),
  ];
  const pricing = nominalMarketPriceFor(viableEvidence({
    orderCostAllocation: {
      overheadPerUnit: 16,
      acquisitionPerUnit: 6.5,
      minimumContributionPerUnit: 10,
      paymentFeeFixedPerUnit: 0.15,
    },
    comparables,
  }));
  assert.equal(pricing.price, "49.99");
  assert.deepEqual(pricing.orderCostAllocation, {
    overheadPerUnit: 16,
    acquisitionPerUnit: 6.5,
    minimumContributionPerUnit: 10,
    paymentFeeFixedPerUnit: 0.15,
  });

  for (const overheadPerUnit of [0, 8, 15.99, 16.01]) {
    const invalidAllocation = nominalMarketPriceFor(viableEvidence({
      orderCostAllocation: { ...viableEvidence().orderCostAllocation, overheadPerUnit },
    }));
    assert.equal(invalidAllocation.price, null);
    assert.equal(invalidAllocation.reason, "verified-order-level-cost-allocation-required");
  }

  const singleItemScenario = nominalMarketPriceFor(
    viableEvidence({
      comparables: [
        comparable("Retailer One", 60),
        comparable("Retailer Two", 62),
        comparable("Retailer Three", 65),
      ],
    }),
  );
  assert.equal(singleItemScenario.price, "59.99");
  assert.ok(Number(singleItemScenario.price) * 0.97 - 0.3 - 10 - 2 - 16 - 13 >= 10);
});

test("accounts for a planned checkout discount while keeping the displayed price competitive", () => {
  const pricing = nominalMarketPriceFor(viableEvidence({ expectedDiscountRate: 0.15 }));
  assert.ok(pricing.price);
  assert.ok(Number(pricing.price) * 0.85 <= pricing.aggressiveCheckoutTarget);
  assert.ok(Number(pricing.price) * 0.85 * 0.97 - 0.3 - 10 - 2 - 16 - 13 >= 10);
});

test("handle identity wins over a stale generated title for segment labels", () => {
  const pricing = nominalMarketPriceFor(
    viableEvidence({
      handle: "camping-wine-cooler-bag-insulated-tote",
      title: "Women's Handbag",
    }),
  );
  assert.equal(pricing.marketBand.id, "outdoor");
});

test("preserves existing compare-at values and never generates an unsupported sale anchor", () => {
  assert.equal(compareAtPriceFor(98.99, 129.99), "129.99");
  assert.equal(compareAtPriceFor(98.99, null), null);
});
