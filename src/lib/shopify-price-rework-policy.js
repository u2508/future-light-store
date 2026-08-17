export const PRICE_REWORK_STRATEGY_ID = "tiered-multiplier-2026-08-03-v1";

export const PRICE_REWORK_RULES = Object.freeze({
  threshold: 35,
  lowPriceCeiling: 20,
  underTwenty: Object.freeze({ minMultiplier: 1.8, maxMultiplier: 2 }),
  twentyToThirtyFive: Object.freeze({ minMultiplier: 1.4, maxMultiplier: 1.7 }),
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function priceMultiplierFor(priceValue) {
  const price = Number(priceValue);
  if (!Number.isFinite(price) || price <= 0 || price >= PRICE_REWORK_RULES.threshold) {
    return 1;
  }

  if (price < PRICE_REWORK_RULES.lowPriceCeiling) {
    const progress = clamp(price / PRICE_REWORK_RULES.lowPriceCeiling, 0, 1);
    return PRICE_REWORK_RULES.underTwenty.maxMultiplier -
      progress * (PRICE_REWORK_RULES.underTwenty.maxMultiplier - PRICE_REWORK_RULES.underTwenty.minMultiplier);
  }

  const progress = clamp(
    (price - PRICE_REWORK_RULES.lowPriceCeiling) /
      (PRICE_REWORK_RULES.threshold - PRICE_REWORK_RULES.lowPriceCeiling),
    0,
    1,
  );
  return PRICE_REWORK_RULES.twentyToThirtyFive.maxMultiplier -
    progress * (PRICE_REWORK_RULES.twentyToThirtyFive.maxMultiplier - PRICE_REWORK_RULES.twentyToThirtyFive.minMultiplier);
}

export function scalePrice(priceValue, multiplier) {
  const price = Number(priceValue);
  const factor = Number(multiplier);
  if (!Number.isFinite(price) || !Number.isFinite(factor)) {
    return null;
  }

  return (Math.round(price * factor * 100) / 100).toFixed(2);
}
