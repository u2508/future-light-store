export const PRICE_REWORK_STRATEGY_ID = "future-light-nominal-market-2026-09-17-v1";

export const PRICE_REWORK_RULES = Object.freeze({
  overhead: 16,
  minimumNetContribution: 10,
  minimumSellPrice: 0.99,
  compareAtMultiplier: 1.25,
  marketBands: Object.freeze([
    Object.freeze({ id: "beauty", label: "Beauty & personal care", maxPrice: 399.99, patterns: /\b(?:beauty|makeup|cosmetic|lipstick|lip gloss|lash|eyelash|mascara|eyeshadow|blush|foundation|concealer|skincare|skin care|facial|hair|nail|manicure|pedicure|shampoo|wig)\b/i }),
    Object.freeze({ id: "jewelry", label: "Jewelry & accessories", maxPrice: 199.99, patterns: /\b(?:jewelry|jewellery|necklace|earring|bracelet|ring|brooch|lapel pin|pendant|watch box|wallet|card holder|handbag|purse|bag)\b/i }),
    Object.freeze({ id: "apparel", label: "Apparel & footwear", maxPrice: 199.99, patterns: /\b(?:women'?s|men'?s|girl|boy|dress|shirt|t-shirt|hoodie|jacket|coat|sweater|pants|trouser|jeans|shorts|skirt|clothing|apparel|shoe|sneaker|boot|sandal|slipper)\b/i }),
    Object.freeze({ id: "pet", label: "Pet supplies", maxPrice: 129.99, patterns: /\b(?:pet|dog|puppy|cat toy|kitten|bird|aquarium|fish tank|hamster|leash|collar|pet toy|dog toy)\b/i }),
    Object.freeze({ id: "baby", label: "Baby & kids", maxPrice: 199.99, patterns: /\b(?:baby|toddler|infant|newborn|kids|kid|children|child|stroller|crib|diaper|feeding bottle|educational toy|building block)\b/i }),
    Object.freeze({ id: "audio", label: "Audio & headphones", maxPrice: 299.99, patterns: /\b(?:headphones?|earphones?|earbuds?|speakers?|microphones?|soundbars?|audio|amplifier|mixer|hi-fi|hifi)\b/i }),
    Object.freeze({ id: "camera", label: "Cameras & imaging", maxPrice: 999.99, patterns: /\b(?:camera|camcorder|projector|gimbal|tripod|lens|webcam|binocular|telescope|security camera|surveillance)\b/i }),
    Object.freeze({ id: "gaming", label: "Gaming & consoles", maxPrice: 599.99, patterns: /\b(?:playstation|xbox|nintendo|game console|gaming console|gamepad|controller|arcade|handheld game)\b/i }),
    Object.freeze({ id: "electronics", label: "Electronics & tech", maxPrice: 499.99, patterns: /\b(?:smart watch|smartwatch|smart glasses|tablet|monitor|router|switch|keyboard|mouse|charger|adapter|cable|usb|hdmi|led|electronic|phone holder|phone stand)\b/i }),
    Object.freeze({ id: "outdoor", label: "Outdoor & camping", maxPrice: 399.99, patterns: /\b(?:camping|tent|backpack|hiking|trekking|outdoor|fishing|hunting|tactical|sleeping bag|stove|cooler|beach|lawn|garden)\b/i }),
    Object.freeze({ id: "home", label: "Home & living", maxPrice: 499.99, patterns: /\b(?:home|kitchen|cook|furniture|sofa|chair|table|storage|organizer|cleaning|bathroom|decor|decoration|lamp|lighting|mattress|blanket|curtain|office)\b/i }),
    Object.freeze({ id: "automotive", label: "Automotive", maxPrice: 299.99, patterns: /\b(?:car|auto|automotive|motorcycle|vehicle|truck|dash cam|car phone|tire|led headlight)\b/i }),
    Object.freeze({ id: "default", label: "General merchandise", maxPrice: 299.99, patterns: null }),
  ]),
  costBands: Object.freeze([
    Object.freeze({ maxCostExclusive: 5, multiplier: 4.2 }),
    Object.freeze({ maxCostExclusive: 15, multiplier: 3.25 }),
    Object.freeze({ maxCostExclusive: 30, multiplier: 2.75 }),
    Object.freeze({ maxCostExclusive: 50, multiplier: 2.35 }),
    Object.freeze({ maxCostExclusive: Number.POSITIVE_INFINITY, multiplier: 1.95 }),
  ]),
});

function normalizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function multiplierForCost(costValue) {
  const cost = normalizeNumber(costValue);
  if (cost == null || cost <= 0) return null;
  return PRICE_REWORK_RULES.costBands.find((band) => cost < band.maxCostExclusive)?.multiplier || 1.95;
}

export function roundPsychologicalPrice(value) {
  const number = normalizeNumber(value);
  if (number == null || number <= 0) return null;
  if (number < 10) return Math.max(PRICE_REWORK_RULES.minimumSellPrice, Math.round(number * 100) / 100).toFixed(2);
  if (number < 25) return (Math.floor(number) + 0.99).toFixed(2);
  if (number < 100) return (Math.floor(number / 5) * 5 + 4.99).toFixed(2);
  return (Math.floor(number / 10) * 10 + 9.99).toFixed(2);
}

export function roundPsychologicalPriceAtLeast(value, floorValue) {
  const valueNumber = normalizeNumber(value);
  const floor = normalizeNumber(floorValue);
  if (valueNumber == null || floor == null) return null;
  let rounded = Number(roundPsychologicalPrice(valueNumber));
  if (!Number.isFinite(rounded)) return null;
  while (rounded + 0.0001 < floor) {
    rounded = Number(roundPsychologicalPrice(rounded + (rounded < 25 ? 1 : rounded < 100 ? 5 : 10)));
    if (!Number.isFinite(rounded)) return null;
  }
  return rounded.toFixed(2);
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
  if (matches(/\b(?:beauty|makeup|cosmetic|lipstick|lip gloss|lash|eyelash|mascara|eyeshadow|blush|foundation|concealer|skincare|skin care|facial|hair|nail|manicure|pedicure|shampoo|wig)\b/)) return matching("beauty");
  if (matches(/\b(?:jewelry|jewellery|necklace|earring|bracelet|ring|brooch|lapel pin|pendant|watch box|wallet|card holder|handbag|purse)\b/)) return matching("jewelry");
  if (matches(/\b(?:women'?s|men'?s|girl|boy|dress|shirt|t-shirt|hoodie|jacket|coat|sweater|pants|trouser|jeans|shorts|skirt|clothing|apparel|shoe|sneaker|boot|sandal|slipper)\b/)) return matching("apparel");
  if (matches(/\b(?:pet|dog|puppy|cat toy|kitten|bird|aquarium|fish tank|hamster|leash|collar|pet toy|dog toy)\b/)) return matching("pet");
  if (matches(/\b(?:baby|toddler|infant|newborn|kids|kid|children|child|stroller|crib|diaper|feeding bottle|educational toy|building block)\b/)) return matching("baby");
  if (matches(/\b(?:headphones?|earphones?|earbuds?|speakers?|microphones?|soundbars?|audio|amplifier|mixer|hi-fi|hifi)\b/)) return matching("audio");
  if (matches(/\b(?:projector|gimbal|tripod|camera|camera lens|webcam|binocular|telescope|security camera|surveillance|digital camera|camcorder)\b/) &&
      !matches(/\b(?:cable|adapter|charger|power bank|case|cover|holder|stand|mount|bag|backpack)\b/)) return matching("camera");
  if (matches(/\b(?:cable|adapter|charger|charging station|power bank|powerbank|usb|hdmi|keyboard|mouse|router|tablet|smart watch|smartwatch|smart glasses|phone holder|phone stand|computer accessory)\b/)) return matching("electronics");
  if (matches(/\b(?:playstation|xbox|nintendo|game console|gaming console|gamepad|controller|arcade|handheld game)\b/)) return matching("gaming");
  if (matches(/\b(?:camping|tent|backpack|rucksack|hiking|trekking|outdoor|fishing|hunting|tactical|sleeping bag|stove|cooler|beach|lawn|garden)\b/)) return matching("outdoor");
  if (matches(/\b(?:home|kitchen|cook|furniture|sofa|chair|table|storage|organizer|cleaning|bathroom|decor|decoration|lamp|lighting|mattress|blanket|curtain|office)\b/)) return matching("home");
  if (matches(/\b(?:car|auto|automotive|motorcycle|vehicle|truck|dash cam|car phone|tire|led headlight)\b/)) return matching("automotive");
  return matching("default");
}

function effectiveCostFor(costValue, marketBand, currentPriceValue, referenceCosts = [], referencePrices = []) {
  const cost = normalizeNumber(costValue);
  const currentPrice = normalizeNumber(currentPriceValue);
  if (cost == null || cost <= 0) return { cost: null, scaleFactor: 1, reason: "invalid-cost" };

  // Several live records contain exact decimal-shift fingerprints such as
  // 1497/149700. Only correct the effective pricing input when the resulting
  // value fits the product's market band and the live price is also clearly
  // outside that band. The source Shopify cost is never mutated.
  const shouldInspectForScale = cost >= 1000;
  if (shouldInspectForScale) {
    for (const factor of [10, 100, 1000]) {
      const candidate = cost / factor;
      if (candidate >= 0.01 && candidate <= marketBand.maxPrice * 0.9) {
        return { cost: candidate, scaleFactor: factor, reason: "decimal-scale-cost-anomaly" };
      }
    }
  }
  const peerCosts = referenceCosts.map(normalizeNumber).filter((value) => value != null && value > 0).sort((left, right) => left - right);
  const peerPrices = referencePrices.map(normalizeNumber).filter((value) => value != null && value > 0).sort((left, right) => left - right);
  if (peerCosts.length >= 2 && peerPrices.length >= 2) {
    const medianCost = peerCosts[Math.floor((peerCosts.length - 1) / 2)];
    const medianPrice = peerPrices[Math.floor((peerPrices.length - 1) / 2)];
    for (const factor of [10, 100, 1000]) {
      const candidate = cost / factor;
      const costMatchesPeers = Math.abs(candidate - medianCost) <= Math.max(0.5, medianCost * 0.35);
      const priceIsAnOutlier = currentPrice != null && currentPrice >= medianPrice * 4;
      if (candidate >= 0.01 && candidate <= marketBand.maxPrice * 0.9 && costMatchesPeers && priceIsAnOutlier) {
        return { cost: candidate, scaleFactor: factor, reason: "variant-relative-cost-scale-anomaly" };
      }
    }
  }
  return { cost, scaleFactor: 1, reason: "verified-live-cost" };
}

export function nominalMarketPriceFor({ cost, currentPrice = null, handle = "", title = "", productTitle = "", variantTitle = "", referenceCosts = [], referencePrices = [], minimumSellPrice = PRICE_REWORK_RULES.minimumSellPrice } = {}) {
  const marketBand = marketBandFor({ handle, title, productTitle, variantTitle });
  const effective = effectiveCostFor(cost, marketBand, currentPrice, referenceCosts, referencePrices);
  if (!effective.cost) {
    return { price: null, marketBand, effectiveCost: null, scaleFactor: effective.scaleFactor, reason: effective.reason, blockedReason: effective.reason };
  }

  // The approved $16 overhead and $10 minimum contribution are both hard
  // per-variant requirements. The previous implementation used overhead as
  // the floor and treated the contribution as an upper target, which left
  // thousands of low-cost products below the approved net contribution.
  const floor = Math.max(
    Number(minimumSellPrice) || PRICE_REWORK_RULES.minimumSellPrice,
    effective.cost + PRICE_REWORK_RULES.overhead + PRICE_REWORK_RULES.minimumNetContribution,
  );
  const contributionTarget = floor;
  if (floor > marketBand.maxPrice) {
    return {
      price: null,
      marketBand,
      effectiveCost: effective.cost,
      scaleFactor: effective.scaleFactor,
      reason: effective.reason,
      blockedReason: "cost-plus floor exceeds nominal market band; source cost needs review",
    };
  }

  const candidate = contributionTarget;
  const boundedCandidate = Math.min(candidate, marketBand.maxPrice);
  const price = roundPsychologicalPriceAtLeast(boundedCandidate, floor);
  if (!price || Number(price) > marketBand.maxPrice + 0.001) {
    return {
      price: null,
      marketBand,
      effectiveCost: effective.cost,
      scaleFactor: effective.scaleFactor,
      reason: effective.reason,
      blockedReason: "psychological price rounding exceeds nominal market band",
    };
  }
  return {
    price,
    marketBand,
    effectiveCost: effective.cost,
    scaleFactor: effective.scaleFactor,
    reason: effective.reason,
    blockedReason: "",
  };
}

export function costBasedPriceFor(costValue, context = {}) {
  return nominalMarketPriceFor({ cost: costValue, ...context }).price;
}

export function compareAtPriceFor(sellPriceValue, existingCompareAtValue) {
  const sellPrice = normalizeNumber(sellPriceValue);
  const existingCompareAt = normalizeNumber(existingCompareAtValue);
  if (sellPrice == null || existingCompareAt == null || existingCompareAt <= 0) return null;
  return roundPsychologicalPrice(Math.max(sellPrice * PRICE_REWORK_RULES.compareAtMultiplier, sellPrice + 0.01));
}

export function scalePrice(priceValue, multiplier) {
  const price = Number(priceValue);
  const factor = Number(multiplier);
  if (!Number.isFinite(price) || !Number.isFinite(factor)) {
    return null;
  }

  return (Math.round(price * factor * 100) / 100).toFixed(2);
}
