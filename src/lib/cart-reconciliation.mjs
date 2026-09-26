/**
 * Reconcile locally cached cart rows only from a complete, internally
 * consistent Shopify cart snapshot. Incomplete pages or unknown remote lines
 * are held so a partial response can never silently erase a shopper's bag.
 */
export function reconcileCartSnapshot(localItems, cart) {
  if (cart == null) return { status: "empty" };

  const edges = cart?.lines?.edges;
  const hasNextPage = cart?.lines?.pageInfo?.hasNextPage;
  const totalQuantity = Number(cart?.totalQuantity);
  if (
    !Array.isArray(localItems) ||
    !Array.isArray(edges) ||
    hasNextPage !== false ||
    !Number.isInteger(totalQuantity) ||
    totalQuantity < 0
  ) {
    return { status: "hold" };
  }

  if (totalQuantity === 0 && edges.length === 0) return { status: "empty" };

  const localByVariant = new Map();
  for (const item of localItems) {
    if (!item?.variantId || localByVariant.has(item.variantId)) return { status: "hold" };
    localByVariant.set(item.variantId, item);
  }

  const remoteVariantIds = new Set();
  const remoteItems = [];
  let countedQuantity = 0;

  for (const edge of edges) {
    const line = edge?.node;
    const variant = line?.merchandise;
    const variantId = String(variant?.id ?? "");
    const quantity = Number(line?.quantity);
    const amount = String(variant?.price?.amount ?? "");
    const currencyCode = String(variant?.price?.currencyCode ?? "");
    const options = variant?.selectedOptions;

    if (
      !line?.id ||
      !variantId ||
      remoteVariantIds.has(variantId) ||
      !localByVariant.has(variantId) ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      !amount ||
      !Number.isFinite(Number(amount)) ||
      !currencyCode ||
      !Array.isArray(options)
    ) {
      return { status: "hold" };
    }

    remoteVariantIds.add(variantId);
    countedQuantity += quantity;
    const localItem = localByVariant.get(variantId);
    remoteItems.push({
      ...localItem,
      lineId: line.id,
      quantity,
      variantTitle: String(variant.title ?? localItem.variantTitle),
      price: { amount, currencyCode },
      selectedOptions: options.map((option) => ({
        name: String(option?.name ?? ""),
        value: String(option?.value ?? ""),
      })),
    });
  }

  if (countedQuantity !== totalQuantity || remoteItems.length !== edges.length) {
    return { status: "hold" };
  }

  return { status: "reconciled", items: remoteItems };
}
