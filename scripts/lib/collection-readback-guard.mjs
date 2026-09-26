export function collectionPublicationReadbackIssue(collection) {
  const publications = collection?.resourcePublications;
  if (
    !Array.isArray(publications?.nodes) ||
    typeof publications?.pageInfo?.hasNextPage !== "boolean"
  ) {
    return "collection publication readback is incomplete";
  }
  if (publications.pageInfo.hasNextPage) {
    return "collection publication readback is not fully paginated";
  }
  return null;
}

export function collectionProductsCountIssue({
  isPublishedToOnlineStore,
  count,
  precision,
  allowEmpty = false,
  allowEmptyReviewed = false,
  allowEmptyReason = "",
}) {
  if (!isPublishedToOnlineStore) return null;
  if (!Number.isInteger(count) || count < 0) {
    return "public collection has no valid product-count readback";
  }
  if (precision !== "EXACT") {
    return "public collection product count is not exact";
  }
  if (count > 0) return null;
  if (
    allowEmpty === true &&
    allowEmptyReviewed === true &&
    String(allowEmptyReason).trim().length >= 12
  ) return null;
  return "public collection has zero products and no reviewed empty-collection exception";
}
