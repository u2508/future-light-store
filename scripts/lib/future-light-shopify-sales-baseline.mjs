const WINDOWS_DAYS = [28, 60];

function emptyMetrics() {
  return {
    paidOrderCount: 0,
    netUnits: 0,
    netMerchandiseSales: 0,
    _orders: new Set(),
  };
}

function addLine(metrics, orderKey, quantity, sales) {
  if (quantity <= 0) return;
  metrics._orders.add(orderKey);
  metrics.netUnits += quantity;
  metrics.netMerchandiseSales += sales;
}

function finalizeMetrics(metrics) {
  return {
    paidOrderCount: metrics._orders.size,
    netUnits: metrics.netUnits,
    netMerchandiseSales: Number(metrics.netMerchandiseSales.toFixed(2)),
  };
}

/** Aggregate only product-linked, completed, non-test Shopify order lines. */
export function aggregateShopifySalesOrders({
  orders,
  catalogProductIds,
  shopCurrency,
  now = Date.now(),
} = {}) {
  if (!Array.isArray(orders)) throw new TypeError("orders must be an array");
  if (!(catalogProductIds instanceof Set))
    throw new TypeError("catalogProductIds must be a Set of complete Shopify product IDs");
  const currency = String(shopCurrency || "").trim().toUpperCase();
  if (!currency) throw new Error("Shop currency is required to aggregate sales safely");
  const products = new Map();
  const variants = new Map();
  const excluded = { test: 0, cancelled: 0, unpaidOrOtherFinancialStatus: 0 };
  let includedOrderCount = 0;
  let unlinkedLineItems = 0;

  for (let orderIndex = 0; orderIndex < orders.length; orderIndex += 1) {
    const order = orders[orderIndex];
    if (order?.test === true) {
      excluded.test += 1;
      continue;
    }
    if (order?.cancelledAt) {
      excluded.cancelled += 1;
      continue;
    }
    const financialStatus = String(order?.displayFinancialStatus || "").toUpperCase();
    if (!["PAID", "PARTIALLY_REFUNDED"].includes(financialStatus)) {
      excluded.unpaidOrOtherFinancialStatus += 1;
      continue;
    }

    const createdAt = Date.parse(order?.createdAt || "");
    if (!Number.isFinite(createdAt)) throw new Error("A Shopify order has an invalid createdAt value");
    if (createdAt < now - 60 * 24 * 60 * 60 * 1000) continue;
    const orderKey = String(orderIndex);
    const eligibleLines = [];

    for (const line of order?.lineItems?.nodes || []) {
      const productId = String(line?.product?.id || "");
      const variantId = String(line?.variant?.id || "");
      const quantity = Number(line?.currentQuantity);
      const amount = Number(line?.priceAfterAllDiscountsBeforeTaxesSet?.shopMoney?.amount);
      const lineCurrency = String(
        line?.priceAfterAllDiscountsBeforeTaxesSet?.shopMoney?.currencyCode || "",
      ).toUpperCase();
      if (!productId || !variantId || !Number.isSafeInteger(quantity) || quantity < 0) {
        unlinkedLineItems += 1;
        continue;
      }
      if (!Number.isFinite(amount) || amount < 0 || lineCurrency !== currency) {
        throw new Error(`Order line for ${variantId} has incomplete or mismatched shop-currency sales data`);
      }
      if (quantity === 0) continue;
      eligibleLines.push({ productId, variantId, quantity, amount });
    }

    if (!eligibleLines.length) continue;
    includedOrderCount += 1;
    for (const line of eligibleLines) {
      const productRow = products.get(line.productId) || {
        productId: line.productId,
        inCurrentCatalog: catalogProductIds.has(line.productId),
        ...Object.fromEntries(WINDOWS_DAYS.map((days) => [`days${days}`, emptyMetrics()])),
      };
      const row = variants.get(line.variantId) || {
        variantId: line.variantId,
        productId: line.productId,
        inCurrentCatalog: catalogProductIds.has(line.productId),
        ...Object.fromEntries(WINDOWS_DAYS.map((days) => [`days${days}`, emptyMetrics()])),
      };
      for (const days of WINDOWS_DAYS) {
        const cutoff = now - days * 24 * 60 * 60 * 1000;
        if (createdAt >= cutoff) {
          addLine(productRow[`days${days}`], orderKey, line.quantity, line.amount);
          addLine(row[`days${days}`], orderKey, line.quantity, line.amount);
        }
      }
      products.set(line.productId, productRow);
      variants.set(line.variantId, row);
    }
  }

  const finalizeRows = (map) => [...map.values()]
    .map((row) => ({
      ...row,
      ...Object.fromEntries(WINDOWS_DAYS.map((days) => [
        `days${days}`,
        finalizeMetrics(row[`days${days}`]),
      ])),
    }))
    .sort((left, right) =>
      right.days28.netUnits - left.days28.netUnits ||
      right.days60.netUnits - left.days60.netUnits ||
      left.productId.localeCompare(right.productId),
    );

  return {
    currencyCode: currency,
    windowsDays: WINDOWS_DAYS,
    includedOrderCount,
    excludedOrderCounts: excluded,
    unlinkedLineItems,
    products: finalizeRows(products),
    variants: finalizeRows(variants),
  };
}
