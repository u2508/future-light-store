/**
 * Build a shopper-facing listing price without pairing one option's compare-at
 * price with a different option's minimum price.
 */
export function resolveProductCardPricing(product) {
  const edges = Array.isArray(product?.variants?.edges) ? product.variants.edges : [];
  const variants = edges.map((edge) => edge?.node).filter(Boolean);
  const reportedCount = Number(product?.variantsCount?.count);
  const variantCount = Number.isSafeInteger(reportedCount)
    ? Math.max(reportedCount, variants.length)
    : variants.length;
  const isVariablePrice = variantCount > 1;
  const firstAvailableVariant = variants.find((variant) => variant.availableForSale) ?? variants[0];
  const minimumPrice = product?.priceRange?.minVariantPrice ?? null;
  const price = (isVariablePrice ? minimumPrice : firstAvailableVariant?.price) ??
    firstAvailableVariant?.price ?? minimumPrice;

  return {
    price,
    // A product-level minimum compare-at price is not guaranteed to belong to
    // the minimum-price variant. Hide markdown until the shopper has an exact
    // variant price to compare.
    compareAt: isVariablePrice ? null : firstAvailableVariant?.compareAtPrice?.amount ?? null,
    showFrom: isVariablePrice,
  };
}
