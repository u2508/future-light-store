export const NEW_ARRIVALS_LIMIT = 500;
export const BEST_SELLERS_LIMIT = 250;

function text(value) {
  return String(value || "").trim();
}

function handle(value) {
  return text(value).toLowerCase();
}

function numericId(product) {
  const match = text(product?.legacyResourceId || product?.id).match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function timestamp(product, ...fields) {
  for (const field of fields) {
    const value = Date.parse(text(product?.[field]));
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function isActive(product) {
  return text(product?.status || "ACTIVE").toUpperCase() === "ACTIVE";
}

function newestFirst(left, right) {
  return timestamp(right, "updated_at", "updatedAt", "created_at", "createdAt") -
      timestamp(left, "updated_at", "updatedAt", "created_at", "createdAt") ||
    timestamp(right, "created_at", "createdAt") - timestamp(left, "created_at", "createdAt") ||
    numericId(right) - numericId(left) ||
    handle(left?.handle).localeCompare(handle(right?.handle));
}

function productByHandle(products) {
  return new Map((Array.isArray(products) ? products : [])
    .map((product) => [handle(product?.handle), product])
    .filter(([productHandle, product]) => productHandle && product && isActive(product)));
}

function orderedProductHandles(recentlyOrderedPayload, catalogByHandle) {
  const seen = new Set();
  const ordered = [];
  for (const entry of Array.isArray(recentlyOrderedPayload?.products) ? recentlyOrderedPayload.products : []) {
    const productHandle = handle(entry?.handle);
    const orderCount = Number(entry?.orderCount);
    const quantitySold = Number(entry?.quantitySold);
    const hasSalesEvidence = (Number.isFinite(orderCount) && orderCount > 0) ||
      (Number.isFinite(quantitySold) && quantitySold > 0);
    if (!hasSalesEvidence) continue;
    if (!productHandle || seen.has(productHandle) || !catalogByHandle.has(productHandle)) continue;
    seen.add(productHandle);
    ordered.push(productHandle);
  }
  return ordered;
}

/**
 * Build the two customer-facing merchandising cohorts from one deterministic
 * source. New Arrivals is recency-based; Best Sellers contains only catalog
 * products with positive order-count or quantity-sold evidence. If fewer than
 * 250 products have verified sales, return fewer rather than padding the list.
 */
export function buildMerchandisingCollectionMembership(products, recentlyOrderedPayload = {}) {
  const active = (Array.isArray(products) ? products : [])
    .filter(isActive)
    .filter((product) => handle(product?.handle));
  const newest = [...active].sort(newestFirst);
  const catalogByHandle = productByHandle(active);
  const orderedHandles = orderedProductHandles(recentlyOrderedPayload, catalogByHandle);

  return {
    "new-arrivals": newest.slice(0, NEW_ARRIVALS_LIMIT),
    "best-sellers": orderedHandles.slice(0, BEST_SELLERS_LIMIT).map((productHandle) => catalogByHandle.get(productHandle)),
  };
}

export function buildMerchandisingAssignments(products, recentlyOrderedPayload = {}) {
  const assignments = new Map((Array.isArray(products) ? products : [])
    .map((product) => [handle(product?.handle), new Set()]));
  const membership = buildMerchandisingCollectionMembership(products, recentlyOrderedPayload);
  for (const [collectionHandle, entries] of Object.entries(membership)) {
    for (const product of entries) {
      const productAssignments = assignments.get(handle(product?.handle));
      productAssignments?.add(collectionHandle);
    }
  }
  return assignments;
}

export function sortMerchandisingProducts(products) {
  return [...(Array.isArray(products) ? products : [])].sort(newestFirst);
}
