import { formatMoneyValue, normalizePlainText, parseMoneyValue } from "./shopify-seo-batch.js";

const QUANTITY_UNIT_PATTERN = "pcs?|pieces?|units?|packs?|pairs?";

function variantOptionText(variant) {
  if (Array.isArray(variant?.selectedOptions)) {
    return variant.selectedOptions.map((option) => normalizePlainText(option?.value)).filter(Boolean).join(" / ");
  }

  return [variant?.option1, variant?.option2, variant?.option3]
    .map(normalizePlainText)
    .filter(Boolean)
    .join(" / ");
}

export function variantLabel(variant) {
  return normalizePlainText(variant?.title || variantOptionText(variant) || variant?.sku || "");
}

export function extractVariantQuantity(variant) {
  const text = [variantLabel(variant), variant?.sku].filter(Boolean).join(" / ");
  const patterns = [
    new RegExp(`\\b(?:pack|set|lot)\\s*(?:of\\s*)?(\\d+)\\s*(?:${QUANTITY_UNIT_PATTERN})?\\b`, "i"),
    new RegExp(`(?:^|[^0-9])(?:x\\s*)?(\\d+)\\s*(?:${QUANTITY_UNIT_PATTERN})\\b`, "i"),
    new RegExp(`\\b(?:${QUANTITY_UNIT_PATTERN})\\s*[-:]?\\s*(\\d+)\\b`, "i"),
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const quantity = Number(match?.[1] || 0);
    if (Number.isInteger(quantity) && quantity > 0) return quantity;
  }

  return 0;
}

function stripQuantityText(value) {
  return normalizePlainText(value)
    .replace(new RegExp(`\\b(?:pack|set|lot)\\s*(?:of\\s*)?\\d+\\s*(?:${QUANTITY_UNIT_PATTERN})?\\b`, "gi"), " ")
    .replace(new RegExp(`\\b\\d+\\s*(?:${QUANTITY_UNIT_PATTERN})\\b`, "gi"), " ")
    .replace(new RegExp(`\\b(?:${QUANTITY_UNIT_PATTERN})\\s*[-:]?\\s*\\d+\\b`, "gi"), " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function variantFamilyKey(variant) {
  const key = stripQuantityText(variantLabel(variant));
  return key || "__default__";
}

function variantId(variant) {
  return normalizePlainText(variant?.id || variant?.variantId || "");
}

function currentPrice(variant) {
  return parseMoneyValue(variant?.price);
}

function currentCompareAtPrice(variant) {
  return parseMoneyValue(variant?.compareAtPrice ?? variant?.compare_at_price);
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function roundPackPrice(value) {
  if (!Number.isFinite(value) || value <= 0) return "";
  const nearestDollar = Math.round(value);
  if (Math.abs(value - nearestDollar) < 0.005) return formatMoneyValue(nearestDollar);
  return formatMoneyValue(Math.floor(value) + 0.99);
}

function scaleCompareAtPrice(variant, targetPrice) {
  const current = currentPrice(variant);
  const compareAt = currentCompareAtPrice(variant);
  if (!Number.isFinite(current) || current <= 0 || !Number.isFinite(compareAt) || compareAt <= current) return "";

  const ratio = compareAt / current;
  const scaled = Math.max(targetPrice * 1.2, targetPrice * ratio);
  return roundPackPrice(scaled);
}

function asVariantArray(product) {
  if (Array.isArray(product?.variants)) return product.variants;
  if (Array.isArray(product?.variants?.nodes)) return product.variants.nodes;
  return [];
}

function buildGroupRepair(product, variants) {
  const quantityValues = [...new Set(variants.map((variant) => variant.quantity))].sort((left, right) => left - right);
  if (quantityValues.length < 2) return { updates: [], held: [] };

  const byPrice = new Map();
  for (const variant of variants) {
    const key = variant.price.toFixed(2);
    if (!byPrice.has(key)) byPrice.set(key, new Set());
    byPrice.get(key).add(variant.quantity);
  }
  const repeatedPrices = new Set(
    [...byPrice.entries()]
      .filter(([, quantities]) => quantities.size > 1)
      .map(([price]) => price),
  );
  if (!repeatedPrices.size) return { updates: [], held: [] };

  const smallestQuantity = quantityValues[0];
  const baseVariants = variants.filter((variant) => variant.quantity === smallestQuantity);
  const basePrices = baseVariants.map((variant) => variant.price);
  const basePrice = median(basePrices);
  if (!Number.isFinite(basePrice) || basePrice <= 0) {
    return {
      updates: [],
      held: [{ handle: product.handle, family: variants[0].family, reason: "missing-smallest-quantity-price" }],
    };
  }

  const baseSpread = Math.max(...basePrices) - Math.min(...basePrices);
  if (basePrices.length > 1 && baseSpread > Math.max(0.02, basePrice * 0.05)) {
    return {
      updates: [],
      held: [{ handle: product.handle, family: variants[0].family, reason: "ambiguous-base-price" }],
    };
  }

  const unitPrice = basePrice / smallestQuantity;
  const updates = [];
  for (const variant of variants) {
    if (!repeatedPrices.has(variant.price.toFixed(2))) continue;
    const targetPrice = roundPackPrice(unitPrice * variant.quantity);
    if (!targetPrice || Number(targetPrice) <= variant.price + 0.005) continue;
    updates.push({
      variantId: variantId(variant),
      label: variant.label,
      quantity: variant.quantity,
      currentPrice: formatMoneyValue(variant.price),
      price: targetPrice,
      currentCompareAtPrice: Number.isFinite(variant.compareAtPrice) ? formatMoneyValue(variant.compareAtPrice) : "",
      compareAtPrice: scaleCompareAtPrice(variant, Number(targetPrice)),
      family: variant.family,
      reason: "repeated-price-quantity-tier",
    });
  }

  return { updates, held: [] };
}

export function buildVariantPriceRepairPlan(products = []) {
  const byHandle = new Map();
  const held = [];
  let variantsInspected = 0;
  let productsWithRepeatedQuantityPrices = 0;
  let variantsToUpdate = 0;
  let totalPriceDelta = 0;

  for (const product of Array.isArray(products) ? products : []) {
    const pricedVariants = asVariantArray(product)
      .map((variant) => ({
        ...variant,
        label: variantLabel(variant),
        quantity: extractVariantQuantity(variant),
        family: variantFamilyKey(variant),
        price: currentPrice(variant),
        compareAtPrice: currentCompareAtPrice(variant),
      }))
      .filter((variant) => variant.quantity > 0 && Number.isFinite(variant.price) && variant.price > 0 && variantId(variant));
    variantsInspected += pricedVariants.length;

    const groups = new Map();
    for (const variant of pricedVariants) {
      if (!groups.has(variant.family)) groups.set(variant.family, []);
      groups.get(variant.family).push(variant);
    }

    const productUpdates = [];
    let productHeld = false;
    for (const variants of groups.values()) {
      const result = buildGroupRepair(product, variants);
      if (result.held.length) {
        held.push(...result.held);
        productHeld = true;
      }
      productUpdates.push(...result.updates);
    }

    if (productUpdates.length || productHeld) productsWithRepeatedQuantityPrices += 1;
    if (productUpdates.length) {
      byHandle.set(product.handle, productUpdates);
      variantsToUpdate += productUpdates.length;
      totalPriceDelta += productUpdates.reduce((sum, update) => sum + Number(update.price) - Number(update.currentPrice), 0);
    }
  }

  return {
    byHandle,
    held,
    summary: {
      products: Array.isArray(products) ? products.length : 0,
      variantsInspected,
      productsWithRepeatedQuantityPrices,
      productsWithPriceRepairs: byHandle.size,
      variantsToUpdate,
      totalPriceDelta: totalPriceDelta.toFixed(2),
      heldGroups: held.length,
    },
  };
}
