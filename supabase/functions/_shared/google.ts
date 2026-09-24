type Money = { amount: string; currencyCode: string };

export interface GooglePurchaseOrder {
  id: string;
  name: string;
  customAttributes?: Array<{ key: string; value: string }>;
  createdAt: string;
  processedAt: string | null;
  displayFinancialStatus: string | null;
  currentTotalPriceSet: { shopMoney: Money };
  currentTotalTaxSet?: { shopMoney: { amount: string } } | null;
  totalShippingPriceSet?: { shopMoney: { amount: string } } | null;
  lineItems: {
    nodes: Array<{
      title: string;
      quantity: number;
      sku: string | null;
      discountedTotalSet: { shopMoney: { amount: string } };
      product: { id: string } | null;
      variant: { id: string } | null;
    }>;
  };
}

export interface GooglePurchaseResult {
  sent: boolean;
  skipped?: boolean;
  reason?: string;
  eventId?: string;
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function numericId(value: unknown) {
  const raw = String(value ?? "");
  return raw.match(/\d+$/)?.[0] ?? raw;
}

function isPaidTopic(topic: string) {
  return topic.toLowerCase().replaceAll("_", "/") === "orders/paid";
}

function isPaidStatus(status: string | null) {
  return ["PAID", "PARTIALLY_PAID"].includes(String(status ?? "").toUpperCase());
}

function orderAttribute(order: GooglePurchaseOrder, key: string) {
  return (order.customAttributes ?? []).find((attribute) => attribute.key === key)?.value || "";
}

export function buildGooglePurchasePayload(order: GooglePurchaseOrder, clientId: string) {
  const eventId = `shopify-order-${numericId(order.id)}`;
  const lines = order.lineItems?.nodes ?? [];
  const items = lines.map((line) => {
    const id = numericId(line.product?.id || line.variant?.id || line.sku || line.title);
    const quantity = Math.max(1, Math.floor(numberValue(line.quantity)));
    const lineTotal = numberValue(line.discountedTotalSet?.shopMoney?.amount);
    return {
      item_id: id,
      item_name: line.title,
      quantity,
      ...(lineTotal > 0 ? { price: Number((lineTotal / quantity).toFixed(2)) } : {}),
    };
  });
  const total = numberValue(order.currentTotalPriceSet?.shopMoney?.amount);
  const currency = order.currentTotalPriceSet?.shopMoney?.currencyCode ?? "USD";

  return {
    client_id: clientId,
    events: [
      {
        name: "purchase",
        params: {
          transaction_id: order.name || numericId(order.id),
          value: Number(total.toFixed(2)),
          currency,
          event_id: eventId,
          ...(order.currentTotalTaxSet
            ? { tax: Number(numberValue(order.currentTotalTaxSet.shopMoney.amount).toFixed(2)) }
            : {}),
          ...(order.totalShippingPriceSet
            ? {
                shipping: Number(
                  numberValue(order.totalShippingPriceSet.shopMoney.amount).toFixed(2),
                ),
              }
            : {}),
          items,
        },
      },
    ],
  };
}

export async function sendGooglePurchase(
  order: GooglePurchaseOrder,
  topic: string,
): Promise<GooglePurchaseResult> {
  if (!isPaidTopic(topic) && !isPaidStatus(order.displayFinancialStatus)) {
    return { sent: false, skipped: true, reason: "order_not_paid" };
  }

  const measurementId = Deno.env.get("GOOGLE_ANALYTICS_MEASUREMENT_ID")?.trim() ?? "";
  const apiSecret = Deno.env.get("GOOGLE_ANALYTICS_API_SECRET")?.trim() ?? "";
  if (!measurementId || !apiSecret) {
    return { sent: false, reason: "missing_google_measurement_protocol_secrets" };
  }

  const clientId =
    orderAttribute(order, "marketing_ga_client_id") || `vs-shopify-${numericId(order.id)}`;
  const payload = buildGooglePurchasePayload(order, clientId);
  const response = await fetch(
    `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!response.ok) throw new Error(`Google purchase event rejected (${response.status})`);
  return { sent: true, eventId: payload.events[0].params.event_id };
}
