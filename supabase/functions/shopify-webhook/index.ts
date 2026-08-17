import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { adminGraphql, ORDER_FIELDS, orderRow, num, type AdminOrder } from "../_shared/shopify.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ORDER_QUERY = `query Order($id: ID!) { order(id: $id) { ${ORDER_FIELDS} } }`;

function toGid(id: unknown): string | null {
  if (typeof id === "string" && id.startsWith("gid://")) return id;
  if (typeof id === "number" || (typeof id === "string" && /^\d+$/.test(id))) {
    return `gid://shopify/Order/${id}`;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  const topic = req.headers.get("x-shopify-topic") ?? "unknown";
  const service = createClient(SUPABASE_URL, SERVICE_ROLE);
  let payload: Record<string, unknown> = {};

  try {
    payload = await req.json();
  } catch {
    payload = {};
  }

  // The payload is treated as untrusted: we only read the order id from it and
  // re-fetch the authoritative record from the Shopify Admin API.
  const orderGid =
    toGid(payload["admin_graphql_api_id"]) ??
    toGid(payload["id"]) ??
    toGid(payload["order_id"]) ??
    toGid((payload["order"] as Record<string, unknown> | undefined)?.["id"]);

  const eventInsert = {
    topic,
    shopify_id: orderGid,
    payload: payload as Record<string, unknown>,
    status: "received",
    error: null as string | null,
  };

  try {
    if (!orderGid) throw new Error("Webhook payload has no resolvable order id");

    const data: { order: AdminOrder | null } = await adminGraphql(ORDER_QUERY, { id: orderGid });
    const order = data.order;
    if (!order) throw new Error(`Order ${orderGid} not found in Shopify`);

    await service.from("shopify_orders").upsert(orderRow(order));

    const refundRows = (order.refunds ?? []).map((r) => ({
      id: r.id,
      order_id: order.id,
      kind: (order.disputes ?? []).length > 0 ? "refund" : "refund",
      amount: num(r.totalRefundedSet?.shopMoney?.amount),
      currency: r.totalRefundedSet?.shopMoney?.currencyCode ?? "USD",
      reason: r.note,
      processed_at: r.createdAt,
      raw: r as unknown as Record<string, unknown>,
    }));
    if (refundRows.length > 0) await service.from("shopify_refunds").upsert(refundRows);

    const disputeRows = (order.disputes ?? []).map((d) => ({
      id: d.id,
      order_id: order.id,
      kind: "chargeback",
      amount: num(order.currentTotalPriceSet?.shopMoney?.amount),
      currency: order.currentTotalPriceSet?.shopMoney?.currencyCode ?? "USD",
      reason: d.status,
      processed_at: order.processedAt ?? order.createdAt,
      raw: d as unknown as Record<string, unknown>,
    }));
    if (disputeRows.length > 0) await service.from("shopify_refunds").upsert(disputeRows);

    eventInsert.status = "processed";
  } catch (error) {
    eventInsert.status = "failed";
    eventInsert.error = error instanceof Error ? error.message : String(error);
    console.error("shopify-webhook error", topic, eventInsert.error);
  }

  await service.from("shopify_webhook_events").insert(eventInsert);

  // Always 200 so Shopify does not disable the subscription; failures are logged.
  return new Response(JSON.stringify({ ok: eventInsert.status === "processed" }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
