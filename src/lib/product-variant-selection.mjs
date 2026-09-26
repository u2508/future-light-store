function comparableVariantId(value) {
  return (
    String(value ?? "")
      .split("/")
      .pop() ?? ""
  );
}

export function chooseProductVariantId({
  variants,
  requestedVariant,
  currentId,
  userSelected = false,
}) {
  const requestedId = comparableVariantId(requestedVariant);
  const requestedMatch = requestedId
    ? variants.find((variant) => comparableVariantId(variant.id) === requestedId)
    : null;

  // A feed URL is an explicit product-offer promise. Honor it on entry even
  // when a valid default variant is already selected; only a shopper's own
  // subsequent choice should take precedence during background revalidation.
  if (requestedMatch && !userSelected) return requestedMatch.id;

  const currentMatch = variants.find((variant) => variant.id === currentId);
  if (currentMatch) return currentMatch.id;

  return variants.find((variant) => variant.availableForSale)?.id ?? variants[0]?.id ?? null;
}
