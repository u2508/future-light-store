import { formatMoneyValue, normalizePlainText, parseMoneyValue } from "./shopify-seo-batch.js";
import { extractVariantQuantity, variantLabel } from "./shopify-variant-pricing.js";
import { compareAtPriceFor, costBasedPriceFor, PRICE_REWORK_STRATEGY_ID } from "./shopify-price-rework-policy.js";

const DEFAULT_COST_TOLERANCE = 2;

function asVariantArray(product) {
  if (Array.isArray(product?.variants)) return product.variants;
  if (Array.isArray(product?.variants?.nodes)) return product.variants.nodes;
  return [];
}

function variantId(variant) {
  return normalizePlainText(variant?.admin_graphql_api_id || variant?.id || variant?.variantId);
}

function variantCost(variant) {
  return parseMoneyValue(
    variant?.cost_per_item ??
      variant?.cost ??
      variant?.inventoryItem?.unitCost?.amount ??
      variant?.inventory_item?.cost,
  );
}

function variantPrice(variant) {
  return parseMoneyValue(variant?.price);
}

function isQuantityTier(variant) {
  return extractVariantQuantity(variant) > 0;
}

function groupByCost(variants, tolerance) {
  const sorted = [...variants].sort((left, right) => left.cost - right.cost || left.index - right.index);
  const groups = [];
  for (const variant of sorted) {
    const group = groups.at(-1);
    if (!group || variant.cost - group[0].cost > tolerance) {
      groups.push([variant]);
    } else {
      group.push(variant);
    }
  }
  return groups;
}

export function buildVariantCostPriceAlignmentPlan(products = [], { tolerance = DEFAULT_COST_TOLERANCE, priceFloor = 35 } = {}) {
  const byHandle = new Map();
  const held = [];
  const blockingHeld = [];
  let variantsInspected = 0;
  let productsWithCostData = 0;
  let productsWithUpdates = 0;
  let variantsToUpdate = 0;

  for (const product of Array.isArray(products) ? products : []) {
    const variants = asVariantArray(product)
      .map((variant, index) => ({
        variant,
        index,
        id: variantId(variant),
        label: variantLabel(variant),
        cost: variantCost(variant),
        price: variantPrice(variant),
        quantityTier: isQuantityTier(variant),
      }))
      .filter((entry) => entry.id && Number.isFinite(entry.cost) && entry.cost >= 0 && Number.isFinite(entry.price) && entry.price > 0);

    variantsInspected += variants.length;
    if (!variants.length) continue;
    productsWithCostData += 1;

    const quantityVariants = variants.filter((entry) => entry.quantityTier);
    const candidates = variants.filter((entry) => !entry.quantityTier);
    if (quantityVariants.length >= 2 && candidates.length >= 2) {
        held.push({
          handle: normalizePlainText(product?.handle),
          reason: "quantity-tier-variants-require-price-rule",
          variantIds: quantityVariants.map((entry) => entry.id),
      });
    }

    const updates = [];
    for (const group of groupByCost(candidates, tolerance)) {
      if (group.length < 2) continue;
      for (const entry of group) {
        const costBasedTarget = costBasedPriceFor(entry.cost);
        if (!costBasedTarget) continue;
        const targetPrice = Math.max(priceFloor, Number(costBasedTarget));
        const compareAt = parseMoneyValue(entry.variant?.compare_at_price ?? entry.variant?.compareAtPrice);
        const targetCompareAt = Number.isFinite(compareAt) && compareAt > 0
          ? compareAtPriceFor(targetPrice, compareAt)
          : null;
        const currentCompareAt = Number.isFinite(compareAt) && compareAt > 0 ? formatMoneyValue(compareAt) : "";
        const normalizedTargetPrice = formatMoneyValue(targetPrice);
        if (formatMoneyValue(entry.price) === normalizedTargetPrice && currentCompareAt === (targetCompareAt || "")) continue;
        updates.push({
          variantId: entry.id,
          label: entry.label,
          costPerItem: formatMoneyValue(entry.cost),
          currentPrice: formatMoneyValue(entry.price),
          price: normalizedTargetPrice,
          ...(Number.isFinite(compareAt) && compareAt > 0 ? { compareAtPrice: targetCompareAt } : {}),
          reason: "cost-based-price-repair-within-same-product-cost-group",
        });
      }
    }

    if (updates.length) {
      byHandle.set(normalizePlainText(product?.handle), updates);
      productsWithUpdates += 1;
      variantsToUpdate += updates.length;
    }
  }

  return {
    byHandle,
    held,
    blockingHeld,
    summary: {
      products: Array.isArray(products) ? products.length : 0,
      variantsInspected,
      productsWithCostData,
      productsWithUpdates,
      variantsToUpdate,
      heldGroups: held.length,
      blockingHeldGroups: blockingHeld.length,
      tolerance: Number(tolerance.toFixed(2)),
      priceFloor: Number(priceFloor.toFixed(2)),
      strategyId: PRICE_REWORK_STRATEGY_ID,
    },
  };
}

export { DEFAULT_COST_TOLERANCE };
