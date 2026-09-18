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

function timestamp(product, primary, secondary = "") {
  const value = Date.parse(text(product?.[primary]) || text(product?.[secondary]));
  return Number.isFinite(value) ? value : 0;
}

function isActive(product) {
  return text(product?.status || "ACTIVE").toUpperCase() === "ACTIVE";
}

function newestFirst(left, right) {
  return timestamp(right, "updated_at", "created_at") - timestamp(left, "updated_at", "created_at") ||
    timestamp(right, "created_at") - timestamp(left, "created_at") ||
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
    if (!productHandle || seen.has(productHandle) || !catalogByHandle.has(productHandle)) continue;
    seen.add(productHandle);
    ordered.push(productHandle);
  }
  return ordered;
}

/**
 * Build the two customer-facing merchandising cohorts from one deterministic
 * source. New Arrivals is recency-based; Best Sellers keeps the live order
 * feed first and fills the requested 250 slots from the newest eligible
 * catalog products when order history is sparse.
 */
export function buildMerchandisingCollectionMembership(products, recentlyOrderedPayload = {}) {
  const active = (Array.isArray(products) ? products : [])
    .filter(isActive)
    .filter((product) => handle(product?.handle));
  const newest = [...active].sort(newestFirst);
  const catalogByHandle = productByHandle(active);
  const orderedHandles = orderedProductHandles(recentlyOrderedPayload, catalogByHandle);
  const fallbackHandles = newest
    .map((product) => handle(product.handle))
    .filter((productHandle) => !orderedHandles.includes(productHandle));

  return {
    "new-arrivals": newest.slice(0, NEW_ARRIVALS_LIMIT),
    "best-sellers": [...orderedHandles, ...fallbackHandles].slice(0, BEST_SELLERS_LIMIT).map((productHandle) => catalogByHandle.get(productHandle)),
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
