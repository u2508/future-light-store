/**
 * Resolve product availability without treating a missing Shopify boolean as
 * proof that the item is sellable. Cards may contain a partial variant sample,
 * so one explicit available variant is sufficient to show the product; a
 * negative result requires an explicit product-level false or a fully false
 * returned variant set. Everything else is unknown and must fail closed.
 */
export function getProductAvailability(product) {
  const variants = Array.isArray(product?.variants?.edges)
    ? product.variants.edges.map((edge) => edge?.node).filter(Boolean)
    : [];

  if (product?.availableForSale === true || variants.some((variant) => variant.availableForSale === true)) {
    return "available";
  }

  if (
    product?.availableForSale === false &&
    (variants.length === 0 || variants.every((variant) => variant.availableForSale === false))
  ) {
    return "unavailable";
  }

  return "unknown";
}

export function isProductExplicitlyAvailable(product) {
  return getProductAvailability(product) === "available";
}
