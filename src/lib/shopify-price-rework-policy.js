export const PRICE_REWORK_STRATEGY_ID = "future-light-competitive-contribution-2026-09-25-v3";

export const PRICE_REWORK_RULES = Object.freeze({
  overhead: 16,
  acquisitionCost: 13,
  // Owner-approved minimum net contribution, after verified costs and fees.
  minimumNetContribution: 10,
  minimumSellPrice: 0.99,
  targetUndercutFraction: 0.05,
  minimumIndependentComparables: 3,
  maximumComparableAgeDays: 30,
  marketBands: Object.freeze([
    Object.freeze({
      id: "beauty",
      label: "Beauty & personal care",
      patterns:
        /\b(?:beauty|makeup|cosmetic|lipstick|lip gloss|lash|eyelash|mascara|eyeshadow|blush|foundation|concealer|skincare|skin care|facial|hair|nail|manicure|pedicure|shampoo|wig)\b/i,
    }),
    Object.freeze({
      id: "jewelry",
      label: "Jewelry & accessories",
      patterns:
        /\b(?:jewelry|jewellery|necklace|earring|bracelet|ring|brooch|lapel pin|pendant|watch box|wallet|card holder|handbag|purse|bag)\b/i,
    }),
    Object.freeze({
      id: "apparel",
      label: "Apparel & footwear",
      patterns:
        /\b(?:women'?s|men'?s|girl|boy|dress|shirt|t-shirt|hoodie|jacket|coat|sweater|pants|trouser|jeans|shorts|skirt|clothing|apparel|shoe|sneaker|boot|sandal|slipper)\b/i,
    }),
    Object.freeze({
      id: "pet",
      label: "Pet supplies",
      patterns:
        /\b(?:pet|dog|puppy|cat toy|kitten|bird|aquarium|fish tank|hamster|leash|collar|pet toy|dog toy)\b/i,
    }),
    Object.freeze({
      id: "baby",
      label: "Baby & kids",
      patterns:
        /\b(?:baby|toddler|infant|newborn|kids|kid|children|child|stroller|crib|diaper|feeding bottle|educational toy|building block)\b/i,
    }),
    Object.freeze({
      id: "audio",
      label: "Audio & headphones",
      patterns:
        /\b(?:headphones?|earphones?|earbuds?|speakers?|microphones?|soundbars?|audio|amplifier|mixer|hi-fi|hifi)\b/i,
    }),
    Object.freeze({
      id: "camera",
      label: "Cameras & imaging",
      patterns:
        /\b(?:camera|camcorder|projector|gimbal|tripod|lens|webcam|binocular|telescope|security camera|surveillance)\b/i,
    }),
    Object.freeze({
      id: "gaming",
      label: "Gaming & consoles",
      patterns:
        /\b(?:playstation|xbox|nintendo|game console|gaming console|gamepad|controller|arcade|handheld game)\b/i,
    }),
    Object.freeze({
      id: "electronics",
      label: "Electronics & tech",
      patterns:
        /\b(?:smart watch|smartwatch|smart glasses|tablet|monitor|router|switch|keyboard|mouse|charger|adapter|cable|usb|hdmi|led|electronic|phone holder|phone stand)\b/i,
    }),
    Object.freeze({
      id: "outdoor",
      label: "Outdoor & camping",
      patterns:
        /\b(?:camping|tent|backpack|hiking|trekking|outdoor|fishing|hunting|tactical|sleeping bag|stove|cooler|beach|lawn|garden)\b/i,
    }),
    Object.freeze({
      id: "home",
      label: "Home & living",
      patterns:
        /\b(?:home|kitchen|cook|furniture|sofa|chair|table|storage|organizer|cleaning|bathroom|decor|decoration|lamp|lighting|mattress|blanket|curtain|office)\b/i,
    }),
    Object.freeze({
      id: "automotive",
      label: "Automotive",
      patterns:
        /\b(?:car|auto|automotive|motorcycle|vehicle|truck|dash cam|car phone|tire|led headlight)\b/i,
    }),
    Object.freeze({ id: "default", label: "General merchandise", patterns: null }),
  ]),
});

function normalizeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function charmPriceAtOrBelow(value) {
  const amount = normalizeNumber(value);
  if (amount == null || amount < 1) return null;
  return (Math.floor(amount - 0.99) + 0.99).toFixed(2);
}

function contextText(context = {}) {
  // Handles are the stable product identity. A previous generated title can
  // contain a wrong category, so it must not override the handle during price
  // band selection. Variant text is only a tie-breaker for otherwise unknown
  // products.
  const primary = context.handle || context.productTitle || context.title;
  return String(primary || context.variantTitle || "")
    .replace(/[-_]+/g, " ")
    .toLowerCase();
}

export function marketBandFor(context = {}) {
  const text = contextText(context);
  const matching = (id) => PRICE_REWORK_RULES.marketBands.find((band) => band.id === id);
  const matches = (pattern) => pattern.test(text);

  // Keep specific product families ahead of broad words such as "bag",
  // "switch", and "camera" that frequently occur in accessory handles.
  if (
    matches(
      /\b(?:beauty|makeup|cosmetic|lipstick|lip gloss|lash|eyelash|mascara|eyeshadow|blush|foundation|concealer|skincare|skin care|facial|hair|nail|manicure|pedicure|shampoo|wig)\b/,
    )
  )
    return matching("beauty");
  if (
    matches(
      /\b(?:jewelry|jewellery|necklace|earring|bracelet|ring|brooch|lapel pin|pendant|watch box|wallet|card holder|handbag|purse)\b/,
    )
  )
    return matching("jewelry");
  if (
    matches(
      /\b(?:women'?s|men'?s|girl|boy|dress|shirt|t-shirt|hoodie|jacket|coat|sweater|pants|trouser|jeans|shorts|skirt|clothing|apparel|shoe|sneaker|boot|sandal|slipper)\b/,
    )
  )
    return matching("apparel");
  if (
    matches(
      /\b(?:pet|dog|puppy|cat toy|kitten|bird|aquarium|fish tank|hamster|leash|collar|pet toy|dog toy)\b/,
    )
  )
    return matching("pet");
  if (
    matches(
      /\b(?:baby|toddler|infant|newborn|kids|kid|children|child|stroller|crib|diaper|feeding bottle|educational toy|building block)\b/,
    )
  )
    return matching("baby");
  if (
    matches(
      /\b(?:headphones?|earphones?|earbuds?|speakers?|microphones?|soundbars?|audio|amplifier|mixer|hi-fi|hifi)\b/,
    )
  )
    return matching("audio");
  if (
    matches(
      /\b(?:projector|gimbal|tripod|camera|camera lens|webcam|binocular|telescope|security camera|surveillance|digital camera|camcorder)\b/,
    ) &&
    !matches(/\b(?:cable|adapter|charger|power bank|case|cover|holder|stand|mount|bag|backpack)\b/)
  )
    return matching("camera");
  if (
    matches(
      /\b(?:cable|adapter|charger|charging station|power bank|powerbank|usb|hdmi|keyboard|mouse|router|tablet|smart watch|smartwatch|smart glasses|phone holder|phone stand|computer accessory)\b/,
    )
  )
    return matching("electronics");
  if (
    matches(
      /\b(?:playstation|xbox|nintendo|game console|gaming console|gamepad|controller|arcade|handheld game)\b/,
    )
  )
    return matching("gaming");
  if (
    matches(
      /\b(?:camping|tent|backpack|rucksack|hiking|trekking|outdoor|fishing|hunting|tactical|sleeping bag|stove|cooler|beach|lawn|garden)\b/,
    )
  )
    return matching("outdoor");
  if (
    matches(
      /\b(?:home|kitchen|cook|furniture|sofa|chair|table|storage|organizer|cleaning|bathroom|decor|decoration|lamp|lighting|mattress|blanket|curtain|office)\b/,
    )
  )
    return matching("home");
  if (
    matches(
      /\b(?:car|auto|automotive|motorcycle|vehicle|truck|dash cam|car phone|tire|led headlight)\b/,
    )
  )
    return matching("automotive");
  return matching("default");
}

function validatedComparablePrices(comparables, now = Date.now()) {
  if (!Array.isArray(comparables)) return { values: [], reason: "missing-market-comparables" };
  const cutoff = now - PRICE_REWORK_RULES.maximumComparableAgeDays * 24 * 60 * 60 * 1000;
  const seenRetailers = new Set();
  const valid = [];
  for (const record of comparables) {
    const checkedAt = Date.parse(record?.checkedAt || "");
    const market = String(record?.market || "")
      .trim()
      .toUpperCase();
    const currencyCode = String(record?.currencyCode || "")
      .trim()
      .toUpperCase();
    const retailer = String(record?.retailer || "")
      .trim()
      .toLowerCase();
    const url = String(record?.url || "").trim();
    let hostname = "";
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") continue;
      hostname = parsed.hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    const itemPrice = normalizeNumber(record?.itemPrice);
    const shippingPrice = normalizeNumber(record?.shippingPrice);
    if (
      record?.matchType !== "exact" ||
      market !== "US" ||
      currencyCode !== "USD" ||
      !retailer ||
      seenRetailers.has(hostname) ||
      !Number.isFinite(checkedAt) ||
      checkedAt < cutoff ||
      checkedAt > now + 60 * 60 * 1000 ||
      itemPrice == null ||
      itemPrice <= 0 ||
      shippingPrice == null ||
      shippingPrice < 0
    )
      continue;
    seenRetailers.add(hostname);
    valid.push({
      deliveredPrice: itemPrice + shippingPrice,
      retailer,
      hostname,
      checkedAt: new Date(checkedAt).toISOString(),
    });
  }
  if (valid.length < PRICE_REWORK_RULES.minimumIndependentComparables) {
    return { values: valid, reason: "insufficient-current-independent-exact-comparables" };
  }
  return { values: valid, reason: "" };
}

function median(sortedValues) {
  const middle = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2
    ? sortedValues[middle]
    : (sortedValues[middle - 1] + sortedValues[middle]) / 2;
}

export function nominalMarketPriceFor({
  cost,
  currentPrice = null,
  handle = "",
  title = "",
  productTitle = "",
  variantTitle = "",
  currencyCode = "",
  unitCostCurrencyCode = "",
  landedCost = null,
  landedCostVerified = false,
  paymentFeeRate = null,
  paymentFeeFixed = null,
  paymentFeesVerified = false,
  orderCostAllocation = null,
  orderCostAllocationVerified = false,
  expectedDiscountRate = null,
  discountPolicyVerified = false,
  minimumSellPrice = PRICE_REWORK_RULES.minimumSellPrice,
  comparables = [],
  now = Date.now(),
} = {}) {
  const marketBand = marketBandFor({ handle, title, productTitle, variantTitle });
  const unitCost = normalizeNumber(cost);
  const landed = normalizeNumber(landedCost);
  const fixedPaymentFee = normalizeNumber(paymentFeeFixed);
  const feeRate = normalizeNumber(paymentFeeRate);
  const discountRate = normalizeNumber(expectedDiscountRate);
  const minimumPrice = normalizeNumber(minimumSellPrice);
  const blocked = (blockedReason, extra = {}) => ({
    price: null,
    marketBand,
    effectiveCost: unitCost,
    scaleFactor: 1,
    reason: blockedReason,
    blockedReason,
    ...extra,
  });

  if (
    String(currencyCode).toUpperCase() !== "USD" ||
    String(unitCostCurrencyCode).toUpperCase() !== String(currencyCode).toUpperCase()
  ) {
    return blocked("store-and-cost-currency-must-be-verified-as-USD");
  }
  if (unitCost == null || unitCost <= 0) return blocked("invalid-live-unit-cost");
  if (!landedCostVerified || landed == null || landed < 0)
    return blocked("verified-landed-fulfillment-cost-required");
  if (
    !paymentFeesVerified ||
    feeRate == null ||
    feeRate < 0 ||
    feeRate >= 0.5 ||
    fixedPaymentFee == null ||
    fixedPaymentFee < 0
  ) {
    return blocked("verified-payment-fee-schedule-required");
  }
  const allocatedOverhead = normalizeNumber(orderCostAllocation?.overheadPerUnit);
  const allocatedAcquisitionCost = normalizeNumber(orderCostAllocation?.acquisitionPerUnit);
  const allocatedMinimumContribution = normalizeNumber(orderCostAllocation?.minimumContributionPerUnit);
  const allocatedPaymentFeeFixed = normalizeNumber(orderCostAllocation?.paymentFeeFixedPerUnit);
  // Acquisition is a per-order cost. Do not infer a per-variant split: the
  // caller must provide an explicitly verified basket allocation or pricing
  // remains held. This calculator cannot establish that allocation itself.
  if (
    !orderCostAllocationVerified ||
    allocatedOverhead == null || Math.abs(allocatedOverhead - PRICE_REWORK_RULES.overhead) > 0.001 ||
    allocatedAcquisitionCost == null || allocatedAcquisitionCost < 0 || allocatedAcquisitionCost > PRICE_REWORK_RULES.acquisitionCost ||
    allocatedMinimumContribution == null || allocatedMinimumContribution < PRICE_REWORK_RULES.minimumNetContribution ||
    allocatedPaymentFeeFixed == null || allocatedPaymentFeeFixed < 0 || allocatedPaymentFeeFixed > fixedPaymentFee
  ) {
    return blocked("verified-order-level-cost-allocation-required");
  }
  if (!discountPolicyVerified || discountRate == null || discountRate < 0 || discountRate >= 0.9)
    return blocked("expected-discount-rate-invalid");

  const comparableSet = validatedComparablePrices(comparables, now);
  if (comparableSet.reason)
    return blocked(comparableSet.reason, { validComparableCount: comparableSet.values.length });

  const deliveredPrices = comparableSet.values
    .map((record) => record.deliveredPrice)
    .sort((left, right) => left - right);
  const comparableMedian = median(deliveredPrices);
  const undercutTarget = Math.max(
    deliveredPrices[0],
    comparableMedian * (1 - PRICE_REWORK_RULES.targetUndercutFraction),
  );
  const competitiveBaseTarget = undercutTarget / (1 - discountRate);
  const charmPrice = charmPriceAtOrBelow(competitiveBaseTarget);
  const lowestComparableGuard =
    (deliveredPrices[0] * (1 - PRICE_REWORK_RULES.targetUndercutFraction)) / (1 - discountRate);
  const price =
    charmPrice && Number(charmPrice) >= lowestComparableGuard
      ? charmPrice
      : (Math.floor(competitiveBaseTarget * 100) / 100).toFixed(2);
  const requiredCheckoutRevenue =
    (unitCost +
      landed +
      allocatedOverhead +
      allocatedAcquisitionCost +
      allocatedMinimumContribution +
      allocatedPaymentFeeFixed) /
    (1 - feeRate);
  const requiredBasePrice = requiredCheckoutRevenue / (1 - discountRate);
  const evidence = {
    validComparableCount: comparableSet.values.length,
    comparableMedian: Number(comparableMedian.toFixed(2)),
    lowestComparableDeliveredPrice: Number(deliveredPrices[0].toFixed(2)),
    aggressiveCheckoutTarget: Number(undercutTarget.toFixed(2)),
    requiredBasePrice: Number(requiredBasePrice.toFixed(2)),
    expectedDiscountRate: discountRate,
    orderCostAllocation: {
      overheadPerUnit: allocatedOverhead,
      acquisitionPerUnit: allocatedAcquisitionCost,
      minimumContributionPerUnit: allocatedMinimumContribution,
      paymentFeeFixedPerUnit: allocatedPaymentFeeFixed,
    },
  };
  if (
    !price ||
    minimumPrice == null ||
    Number(price) < minimumPrice ||
    Number(price) < requiredBasePrice - 0.001
  ) {
    return blocked("market-price-cannot-support-costs-and-required-contribution", evidence);
  }
  return {
    price,
    marketBand,
    effectiveCost: unitCost,
    scaleFactor: 1,
    reason: "current-exact-us-comparables-under-cut-with-contribution-floor",
    blockedReason: "",
    ...evidence,
  };
}

export function costBasedPriceFor(costValue, context = {}) {
  return nominalMarketPriceFor({ cost: costValue, ...context }).price;
}

export function compareAtPriceFor(_sellPriceValue, existingCompareAtValue) {
  const existingCompareAt = normalizeNumber(existingCompareAtValue);
  if (existingCompareAt == null || existingCompareAt <= 0) return null;
  return existingCompareAt.toFixed(2);
}

export function scalePrice(priceValue, multiplier) {
  const price = Number(priceValue);
  const factor = Number(multiplier);
  if (!Number.isFinite(price) || !Number.isFinite(factor)) {
    return null;
  }

  return (Math.round(price * factor * 100) / 100).toFixed(2);
}
