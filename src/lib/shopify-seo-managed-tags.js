import { parseMoneyValue } from "./shopify-seo-batch.js";

export const MINIMUM_QUANTITY_TWO_TAG = "minimum-qty-2";
export const MINIMUM_QUANTITY_THREE_TAG = "minimum-qty-3";

const MANAGED_MINIMUM_QUANTITY_TAGS = new Set([
  MINIMUM_QUANTITY_TWO_TAG,
  MINIMUM_QUANTITY_THREE_TAG,
]);

export function normalizeShopifyTags(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(",");
  const seen = new Set();
  const tags = [];

  for (const entry of values) {
    const tag = String(entry || "").trim();
    const normalized = tag.toLowerCase();
    if (!tag || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    tags.push(tag);
  }

  return tags;
}

export function getMinimumQuantityTagForPrice(value) {
  const price = parseMoneyValue(value);
  if (!Number.isFinite(price) || price <= 0) {
    return "";
  }
  if (price < 15) {
    return MINIMUM_QUANTITY_THREE_TAG;
  }
  if (price > 15 && price < 25) {
    return MINIMUM_QUANTITY_TWO_TAG;
  }
  return "";
}

export function getMinimumQuantityTagForPrices(values = []) {
  const prices = values
    .map((value) => parseMoneyValue(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  return prices.length ? getMinimumQuantityTagForPrice(Math.min(...prices)) : "";
}

export function reconcileManagedMinimumQuantityTags(existingTags, desiredTag) {
  const desired = String(desiredTag || "").trim().toLowerCase();
  const preserved = normalizeShopifyTags(existingTags).filter(
    (tag) => !MANAGED_MINIMUM_QUANTITY_TAGS.has(tag.toLowerCase()),
  );

  if (MANAGED_MINIMUM_QUANTITY_TAGS.has(desired)) {
    preserved.push(desired);
  }

  return preserved;
}

export function managedMinimumQuantityTagFromTags(tags) {
  return normalizeShopifyTags(tags).find((tag) => MANAGED_MINIMUM_QUANTITY_TAGS.has(tag.toLowerCase()))?.toLowerCase() || "";
}
