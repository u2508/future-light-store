const ACTIVE_STATUS = "active";

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getExplicitOnlineStorePublication(product) {
  if (typeof product?.onlineStorePublished === "boolean") {
    return product.onlineStorePublished;
  }

  if (typeof product?.online_store_published === "boolean") {
    return product.online_store_published;
  }

  const publications = product?.resourcePublications?.nodes || product?.resource_publications?.nodes;
  if (!Array.isArray(publications)) {
    return null;
  }

  return publications.some(
    (publication) =>
      publication?.isPublished === true && normalizeText(publication?.channel?.name).toLowerCase() === "online store",
  );
}

export function isOnlineStorePublishedProduct(product) {
  const status = String(product?.status || "").trim().toLowerCase();

  if (status && status !== ACTIVE_STATUS) {
    return false;
  }

  // Channel-level publication data is authoritative when available. A product
  // excluded from Online Store must never enter the storefront catalog.
  const explicitPublication = getExplicitOnlineStorePublication(product);
  if (explicitPublication !== null) {
    return explicitPublication;
  }

  // REST/public storefront feeds do not include channel-level publication
  // records. In that narrowly scoped fallback, published_at is the best
  // available Online Store publication marker.
  return Boolean(product?.published_at);
}

export function filterOnlineStoreProducts(products) {
  return (Array.isArray(products) ? products : []).filter(isOnlineStorePublishedProduct);
}

export function filterProductIdsToCatalog(productIds, products) {
  const catalogIds = new Set(
    (Array.isArray(products) ? products : [])
      .map((product) => Number(product?.id))
      .filter((id) => Number.isFinite(id) && id > 0),
  );

  return [...new Set(
    (Array.isArray(productIds) ? productIds : [])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && catalogIds.has(id)),
  )];
}
