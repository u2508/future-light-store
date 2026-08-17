function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function productImage(lineItem) {
  return cleanText(
    lineItem?.variant?.image?.url ||
      lineItem?.product?.featuredMedia?.preview?.image?.url ||
      "",
  );
}

function normalizeLineItem(lineItem) {
  const product = lineItem?.product;
  const id = cleanText(product?.id);
  const title = cleanText(product?.title || lineItem?.title);
  const handle = cleanText(product?.handle);
  const image = productImage(lineItem);
  const price = Number(lineItem?.variant?.price);

  if (!id || !title || !handle || !image) return null;

  return {
    id,
    title,
    handle,
    image,
    imageAlt: cleanText(
      lineItem?.variant?.image?.altText ||
        product?.featuredMedia?.preview?.image?.altText ||
        title,
    ),
    price: Number.isFinite(price) && price > 0 ? price : null,
  };
}

export function buildRecentlyOrderedProductsPayload(ordersInput, options = {}) {
  const limit = Math.max(1, Number(options.limit || 4));
  const minPriceExclusive = Number(options.minPriceExclusive || 0);
  const orders = asArray(ordersInput?.nodes || ordersInput);
  const products = [];
  const seen = new Set();

  for (const order of orders) {
    if (order?.cancelledAt) continue;

    for (const lineItem of asArray(order?.lineItems?.nodes)) {
      const product = normalizeLineItem(lineItem);
      if (!product || seen.has(product.id)) continue;
      if (
        minPriceExclusive > 0 &&
        (!Number.isFinite(product.price) || product.price <= minPriceExclusive)
      ) {
        continue;
      }

      seen.add(product.id);
      products.push(product);
      if (products.length >= limit) break;
    }

    if (products.length >= limit) break;
  }

  return {
    generatedAt: options.generatedAt || new Date().toISOString(),
    source: "shopify-admin-orders",
    total: products.length,
    products,
  };
}
