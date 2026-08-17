function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function isOnlineStorePublication(publication) {
  return normalizeText(publication?.name).toLowerCase() === "online store";
}

export function planProductPublication(product, publications) {
  const activePublications = asArray(publications).filter((publication) => publication?.id);
  const unpublishedIds = new Set(asArray(product?.unpublishedPublications?.nodes).map((publication) => publication?.id).filter(Boolean));
  const unpublished = activePublications.filter((publication) => unpublishedIds.has(publication.id));
  const subscriptionExcluded = product?.requiresSellingPlan === true
    ? activePublications.filter((publication) => !isOnlineStorePublication(publication))
    : [];
  const publish = unpublished.filter((publication) => !subscriptionExcluded.includes(publication));

  return {
    productId: product?.id || "",
    handle: normalizeText(product?.handle),
    title: normalizeText(product?.title),
    active: normalizeText(product?.status).toUpperCase() === "ACTIVE",
    requiresSellingPlan: product?.requiresSellingPlan === true,
    publicationIds: publish.map((publication) => publication.id),
    publicationNames: publish.map((publication) => normalizeText(publication.name)),
    subscriptionExcludedIds: subscriptionExcluded.map((publication) => publication.id),
    subscriptionExcludedNames: subscriptionExcluded.map((publication) => normalizeText(publication.name)),
  };
}

export function verifyProductPublicationReadback(product, expectedPublicationIds, excludedPublicationIds = []) {
  const unpublishedIds = new Set(asArray(product?.unpublishedPublications?.nodes).map((publication) => publication?.id).filter(Boolean));
  const expected = asArray(expectedPublicationIds).filter(Boolean);
  const excluded = new Set(asArray(excludedPublicationIds).filter(Boolean));
  const missing = expected.filter((publicationId) => unpublishedIds.has(publicationId));
  const unexpectedPublished = [...excluded].filter((publicationId) => !unpublishedIds.has(publicationId));

  return {
    ok: missing.length === 0 && unexpectedPublished.length === 0,
    missing,
    unexpectedPublished,
  };
}
