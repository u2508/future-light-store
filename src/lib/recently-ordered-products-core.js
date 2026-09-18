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
    quantity: Math.max(1, Number(lineItem?.quantity) || 1),
  };
}

export function buildRecentlyOrderedProductsPayload(ordersInput, options = {}) {
  const limit = Math.max(1, Number(options.limit || 4));
  const minPriceExclusive = Number(options.minPriceExclusive || 0);
  const orders = asArray(ordersInput?.nodes || ordersInput);
  const byProductId = new Map();

  for (const order of orders) {
    if (order?.cancelledAt) continue;

    for (const lineItem of asArray(order?.lineItems?.nodes)) {
      const product = normalizeLineItem(lineItem);
      if (!product) continue;
      if (
        minPriceExclusive > 0 &&
        (!Number.isFinite(product.price) || product.price <= minPriceExclusive)
      ) {
        continue;
      }

      const existing = byProductId.get(product.id);
      const orderCreatedAt = cleanText(order?.createdAt);
      if (existing) {
        existing.quantitySold += product.quantity;
        existing.orderCount += 1;
        if (!existing.lastOrderedAt || Date.parse(orderCreatedAt) > Date.parse(existing.lastOrderedAt)) {
          existing.lastOrderedAt = orderCreatedAt;
        }
      } else {
        byProductId.set(product.id, {
          ...product,
          quantitySold: product.quantity,
          orderCount: 1,
          lastOrderedAt: orderCreatedAt || null,
        });
      }
    }
  }

  const products = [...byProductId.values()]
    .sort((left, right) =>
      right.quantitySold - left.quantitySold ||
      right.orderCount - left.orderCount ||
      Date.parse(right.lastOrderedAt || 0) - Date.parse(left.lastOrderedAt || 0) ||
      left.handle.localeCompare(right.handle),
    )
    .slice(0, limit)
    .map(({ quantity, ...product }) => product);

  return {
    generatedAt: options.generatedAt || new Date().toISOString(),
    source: "shopify-admin-orders",
    total: products.length,
    products,
  };
}
