const PIXEL_ID = Deno.env.get("META_PIXEL_ID") ?? "921792280984136";
const ACCESS_TOKEN =
  Deno.env.get("META_CONVERSIONS_API_ACCESS_TOKEN") ??
  Deno.env.get("META_PIXEL_ACCESS_TOKEN") ??
  "";
const GRAPH_VERSION = (Deno.env.get("META_GRAPH_VERSION") ?? "v23.0").replace(/^v/i, "v");
const STORE_URL = Deno.env.get("META_EVENT_SOURCE_URL") ?? "https://vss-store.vercel.app/";

type Money = { amount: string; currencyCode: string };

export interface MetaPurchaseOrder {
  id: string;
  name: string;
  email: string | null;
  createdAt: string;
  processedAt: string | null;
  displayFinancialStatus: string | null;
  currentTotalPriceSet: { shopMoney: Money };
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

export interface MetaPurchaseResult {
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

function eventTime(order: MetaPurchaseOrder) {
  const parsed = Date.parse(order.processedAt ?? order.createdAt);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : Math.floor(Date.now() / 1000);
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isPaidTopic(topic: string) {
  return topic.toLowerCase().replaceAll("_", "/") === "orders/paid";
}

function isPaidStatus(status: string | null) {
  return ["PAID", "PARTIALLY_PAID"].includes(String(status ?? "").toUpperCase());
}

export async function sendMetaPurchase(
  order: MetaPurchaseOrder,
  topic: string,
): Promise<MetaPurchaseResult> {
  if (!isPaidTopic(topic) && !isPaidStatus(order.displayFinancialStatus)) {
    return { sent: false, skipped: true, reason: "order_not_paid" };
  }
  if (!ACCESS_TOKEN) {
    return { sent: false, reason: "missing_meta_conversions_api_access_token" };
  }
  if (!PIXEL_ID) return { sent: false, reason: "missing_meta_pixel_id" };

  const lines = order.lineItems?.nodes ?? [];
  const contents = lines.map((line) => {
    // Match the product identity used by the storefront ProductView/AddToCart
    // events so Meta can join the paid order to the catalog item.
    const id = numericId(line.product?.id || line.variant?.id || line.sku || line.title);
    const quantity = Math.max(1, Math.floor(numberValue(line.quantity)));
    const lineTotal = numberValue(line.discountedTotalSet?.shopMoney?.amount);
    return {
      id,
      quantity,
      ...(lineTotal > 0 ? { item_price: Number((lineTotal / quantity).toFixed(2)) } : {}),
    };
  });
  const contentIds = [...new Set(contents.map((content) => content.id).filter(Boolean))];
  const total = numberValue(order.currentTotalPriceSet?.shopMoney?.amount);
  const currency = order.currentTotalPriceSet?.shopMoney?.currencyCode ?? "USD";
  const eventId = `shopify-order-${numericId(order.id)}`;
  const userData: Record<string, unknown> = {};
  if (order.email) userData.em = [await sha256(order.email.trim().toLowerCase())];

  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${PIXEL_ID}/events`);
  url.searchParams.set("access_token", ACCESS_TOKEN);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data: [
        {
          event_name: "Purchase",
          event_time: eventTime(order),
          event_id: eventId,
          action_source: "website",
          event_source_url: STORE_URL,
          user_data: userData,
          custom_data: {
            currency,
            value: Number(total.toFixed(2)),
            order_id: order.name || numericId(order.id),
            content_type: "product",
            content_ids: contentIds,
            contents,
            num_items: contents.reduce((sum, content) => sum + content.quantity, 0),
          },
        },
      ],
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    events_received?: number;
    error?: { message?: string };
  };
  if (!response.ok || payload.error || Number(payload.events_received ?? 0) < 1) {
    throw new Error(
      `Meta Purchase event rejected (${response.status}): ${payload.error?.message ?? "no events received"}`,
    );
  }

  return { sent: true, eventId };
}
