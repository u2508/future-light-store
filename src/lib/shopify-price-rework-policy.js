export const PRICE_REWORK_STRATEGY_ID = "cost-based-retail-2026-08-24-v1";

export const PRICE_REWORK_RULES = Object.freeze({
  overhead: 16,
  minimumSellPrice: 0.99,
  compareAtMultiplier: 1.25,
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

export function costBasedPriceFor(costValue) {
  const cost = normalizeNumber(costValue);
  const multiplier = multiplierForCost(cost);
  if (cost == null || cost <= 0 || multiplier == null) return null;
  return roundPsychologicalPrice(Math.max(cost + PRICE_REWORK_RULES.overhead, cost * multiplier));
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
