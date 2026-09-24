const MINIMUM_OBSERVATION_DAYS = 14;

function nonNegativeNumber(value, fieldName) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${fieldName} must be a non-negative number`);
  }
  return number;
}

function optionalPositiveNumber(value, fieldName) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${fieldName} must be a positive number when provided`);
  }
  return number;
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function round(value, digits = 4) {
  return value === null ? null : Number(value.toFixed(digits));
}

function dateDays(from, to) {
  if (!from || !to) return null;
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.floor((end - start) / 86_400_000) + 1;
}

function normalizeProduct(product, index) {
  if (!product || typeof product !== "object") {
    throw new Error(`products[${index}] must be an object`);
  }
  const handle = String(product.handle || "").trim();
  if (!handle) throw new Error(`products[${index}].handle is required`);

  return {
    handle,
    clicks: nonNegativeNumber(product.clicks, `${handle}.clicks`),
    productViews: nonNegativeNumber(product.productViews, `${handle}.productViews`),
    addToCart: nonNegativeNumber(product.addToCart, `${handle}.addToCart`),
    beginCheckout: nonNegativeNumber(product.beginCheckout, `${handle}.beginCheckout`),
    purchases: nonNegativeNumber(product.purchases, `${handle}.purchases`),
    adSpend: nonNegativeNumber(product.adSpend, `${handle}.adSpend`),
    revenue: nonNegativeNumber(product.revenue, `${handle}.revenue`),
    refunds: nonNegativeNumber(product.refunds, `${handle}.refunds`),
    landedCost: nonNegativeNumber(product.landedCost, `${handle}.landedCost`),
    allowableCpa: optionalPositiveNumber(product.allowableCpa, `${handle}.allowableCpa`),
  };
}

function signalFor(product, decisionEligible) {
  let signal;
  let reason;

  if (product.purchases > 0) {
    if (product.allowableCpa === null) {
      signal = "manual-margin-review";
      reason = "Purchases exist, but allowable CPA is not recorded; do not scale automatically.";
    } else if (product.adSpend / product.purchases <= product.allowableCpa) {
      signal = "scale-next-cycle";
      reason = "CPA is at or below the approved allowable CPA.";
    } else {
      signal = "pause-product";
      reason = "CPA is above the approved allowable CPA.";
    }
  } else if (product.beginCheckout > 0) {
    signal = "fix-payment-price-delivery";
    reason =
      "Checkout started but no purchase was recorded; review payment, final price, and delivery.";
  } else if (product.addToCart > 0) {
    signal = "fix-shipping-trust-product-page";
    reason =
      "Add-to-cart exists but checkout did not start; review shipping, trust, and product-page clarity.";
  } else if (product.productViews > 0) {
    signal = "fix-product-price-offer";
    reason = "Product views exist but add-to-cart did not; review the product, price, and offer.";
  } else if (product.clicks > 0) {
    signal = "change-creative-targeting";
    reason = "Clicks exist without product engagement; change creative or targeting.";
  } else {
    signal = "insufficient-signal";
    reason = "No measurable funnel signal was supplied for this product.";
  }

  return {
    signal,
    decision: decisionEligible ? signal : "observe-until-14-days",
    reason: decisionEligible
      ? reason
      : `Observation window is incomplete; provisional signal was ${signal}. Do not change budget yet.`,
  };
}

export function buildProductPerformance(product, { decisionEligible }) {
  const normalized = normalizeProduct(product, 0);
  const netRevenue = normalized.revenue - normalized.refunds;
  const grossProfitBeforeAds = netRevenue - normalized.landedCost;
  const cpa = ratio(normalized.adSpend, normalized.purchases);
  const result = signalFor(normalized, decisionEligible);

  return {
    handle: normalized.handle,
    funnel: {
      clicks: normalized.clicks,
      productViews: normalized.productViews,
      addToCart: normalized.addToCart,
      beginCheckout: normalized.beginCheckout,
      purchases: normalized.purchases,
      clickToViewRate: round(ratio(normalized.productViews, normalized.clicks)),
      viewToCartRate: round(ratio(normalized.addToCart, normalized.productViews)),
      cartToCheckoutRate: round(ratio(normalized.beginCheckout, normalized.addToCart)),
      checkoutToPurchaseRate: round(ratio(normalized.purchases, normalized.beginCheckout)),
      clickToPurchaseRate: round(ratio(normalized.purchases, normalized.clicks)),
    },
    economics: {
      currency: "USD",
      adSpend: round(normalized.adSpend, 2),
      revenue: round(normalized.revenue, 2),
      refunds: round(normalized.refunds, 2),
      netRevenue: round(netRevenue, 2),
      landedCost: round(normalized.landedCost, 2),
      grossProfitBeforeAds: round(grossProfitBeforeAds, 2),
      contributionAfterAds: round(grossProfitBeforeAds - normalized.adSpend, 2),
      allowableCpa: round(normalized.allowableCpa, 2),
      cpa: round(cpa, 2),
      averageOrderValue: round(ratio(normalized.revenue, normalized.purchases), 2),
      refundRate: round(ratio(normalized.refunds, normalized.revenue)),
    },
    signal: result.signal,
    decision: result.decision,
    reason: result.reason,
    budgetAction: "hold",
  };
}

export function buildPerformanceReport(input) {
  if (!input || typeof input !== "object") throw new Error("Performance input must be an object");
  const period = input.period && typeof input.period === "object" ? input.period : {};
  const from = String(period.from || "").trim() || null;
  const to = String(period.to || "").trim() || null;
  const days = Number.isFinite(Number(period.days)) ? Number(period.days) : dateDays(from, to);
  if (days !== null && (!Number.isInteger(days) || days <= 0)) {
    throw new Error("period.days must be a positive integer");
  }

  const products = Array.isArray(input.products)
    ? input.products.map((product, index) => normalizeProduct(product, index))
    : [];
  const decisionEligible = days !== null && days >= MINIMUM_OBSERVATION_DAYS;
  const productReports = products.map((product) =>
    buildProductPerformance(product, { decisionEligible }),
  );
  const totals = products.reduce(
    (sum, product) => {
      sum.clicks += product.clicks;
      sum.productViews += product.productViews;
      sum.addToCart += product.addToCart;
      sum.beginCheckout += product.beginCheckout;
      sum.purchases += product.purchases;
      sum.adSpend += product.adSpend;
      sum.revenue += product.revenue;
      sum.refunds += product.refunds;
      sum.landedCost += product.landedCost;
      return sum;
    },
    {
      clicks: 0,
      productViews: 0,
      addToCart: 0,
      beginCheckout: 0,
      purchases: 0,
      adSpend: 0,
      revenue: 0,
      refunds: 0,
      landedCost: 0,
    },
  );
  const netRevenue = totals.revenue - totals.refunds;
  const grossProfitBeforeAds = netRevenue - totals.landedCost;

  return {
    schemaVersion: "2026-09-21.vs-store.marketing-performance.1",
    mode: "read-only",
    source: String(input.source || "operator-supplied Meta/Google performance export"),
    period: { from, to, days },
    minimumObservationDays: MINIMUM_OBSERVATION_DAYS,
    decisionEligible,
    currency: String(input.currency || "USD").toUpperCase(),
    products: productReports,
    totals: {
      ...totals,
      netRevenue: round(netRevenue, 2),
      grossProfitBeforeAds: round(grossProfitBeforeAds, 2),
      contributionAfterAds: round(grossProfitBeforeAds - totals.adSpend, 2),
      cpa: round(ratio(totals.adSpend, totals.purchases), 2),
      conversionRate: round(ratio(totals.purchases, totals.clicks)),
      averageOrderValue: round(ratio(totals.revenue, totals.purchases), 2),
      refundRate: round(ratio(totals.refunds, totals.revenue)),
    },
    guardrails: {
      automaticBudgetChanges: false,
      automaticCampaignCreation: false,
      automaticProductPause: false,
      note: "Decisions are recommendations for operator review; no ad platform or Shopify mutation is performed.",
    },
  };
}

export { MINIMUM_OBSERVATION_DAYS };
