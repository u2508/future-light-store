import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { adminGraphql, ORDER_FIELDS, orderRow, num, type AdminOrder } from "../_shared/shopify.ts";
import { sendMetaPurchase } from "../_shared/meta.ts";
import { sendGooglePurchase } from "../_shared/google.ts";
import {
  shopifyWebhookSignatureHeader,
  verifyShopifyWebhookRequest,
} from "../_shared/shopify-webhook-signature.ts";
import { webhookFailureStatus, webhookReceiptKey } from "../_shared/shopify-webhook-reliability.ts";

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

type Receipt = { status: string; attempts: number };
type ServiceClient = ReturnType<typeof createClient>;

async function claimReceipt(
  service: ServiceClient,
  dedupeKey: string,
  topic: string,
  shopifyId: string,
): Promise<"process" | "duplicate" | "in_flight"> {
  const inserted = await service
    .from("shopify_webhook_receipts")
    .insert({
      dedupe_key: dedupeKey,
      topic,
      shopify_id: shopifyId,
      status: "processing",
      attempts: 1,
    })
    .select("status, attempts")
    .maybeSingle();
  if (!inserted.error) return "process";
  if (inserted.error.code !== "23505") throw inserted.error;

  const existing = await service
    .from("shopify_webhook_receipts")
    .select("status, attempts")
    .eq("dedupe_key", dedupeKey)
    .maybeSingle();
  if (existing.error) throw existing.error;
  const receipt = existing.data as Receipt | null;
  if (!receipt) throw new Error(`Webhook receipt ${dedupeKey} disappeared during retry claim`);
  if (receipt.status === "processed" || receipt.status === "processed_with_warnings") {
    return "duplicate";
  }
  if (receipt.status === "processing") return "in_flight";

  const updated = await service
    .from("shopify_webhook_receipts")
    .update({
      status: "processing",
      attempts: Number(receipt.attempts || 0) + 1,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("dedupe_key", dedupeKey);
  if (updated.error) throw updated.error;
  return "process";
}

async function updateReceipt(
  service: ServiceClient,
  dedupeKey: string,
  status: string,
  lastError: string | null,
) {
  const result = await service
    .from("shopify_webhook_receipts")
    .update({ status, last_error: lastError, updated_at: new Date().toISOString() })
    .eq("dedupe_key", dedupeKey);
  if (result.error) throw result.error;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  const topic = req.headers.get("x-shopify-topic") ?? "unknown";
  const rawBody = await req.text();
  const webhookSecret = Deno.env.get("SHOPIFY_WEBHOOK_SECRET");
  const signatureValid = await verifyShopifyWebhookRequest(
    rawBody,
    shopifyWebhookSignatureHeader(req.headers),
    webhookSecret,
  );
  if (!signatureValid) {
    const status = webhookSecret ? 401 : 503;
    return new Response(
      JSON.stringify({
        ok: false,
        error: webhookSecret ? "invalid_signature" : "webhook_secret_not_configured",
      }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const service = createClient(SUPABASE_URL, SERVICE_ROLE);
  let payload: Record<string, unknown> = {};

  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
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

  if (!orderGid) {
    return new Response(
      JSON.stringify({ ok: false, error: "Webhook payload has no resolvable order id" }),
      { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const dedupeKey = webhookReceiptKey(topic, orderGid);

  const eventInsert = {
    topic,
    shopify_id: orderGid,
    payload: payload as Record<string, unknown>,
    status: "received",
    error: null as string | null,
  };

  let receiptClaim: "process" | "duplicate" | "in_flight";
  try {
    receiptClaim = await claimReceipt(service, dedupeKey, topic, orderGid);
  } catch (error) {
    console.error("shopify-webhook receipt claim failed", error);
    return new Response(JSON.stringify({ ok: false, error: "receipt_claim_failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "5" },
    });
  }
  if (receiptClaim === "duplicate") {
    return new Response(JSON.stringify({ ok: true, duplicate: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (receiptClaim === "in_flight") {
    return new Response(JSON.stringify({ ok: false, error: "webhook_processing_in_flight" }), {
      status: 409,
      headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "5" },
    });
  }

  try {
    const data: { order: AdminOrder | null } = await adminGraphql(ORDER_QUERY, { id: orderGid });
    const order = data.order;
    if (!order) throw new Error(`Order ${orderGid} not found in Shopify`);

    const mirroredOrder = await service.from("shopify_orders").upsert(orderRow(order));
    if (mirroredOrder.error) throw mirroredOrder.error;

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
    if (refundRows.length > 0) {
      const mirroredRefunds = await service.from("shopify_refunds").upsert(refundRows);
      if (mirroredRefunds.error) throw mirroredRefunds.error;
    }

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
    if (disputeRows.length > 0) {
      const mirroredDisputes = await service.from("shopify_refunds").upsert(disputeRows);
      if (mirroredDisputes.error) throw mirroredDisputes.error;
    }

    let metaPurchase: Awaited<ReturnType<typeof sendMetaPurchase>>;
    try {
      metaPurchase = await sendMetaPurchase(order, topic);
    } catch (error) {
      // Meta is a downstream analytics sink. Never turn a successfully mirrored
      // Shopify order into a failed webhook just because CAPI is unavailable.
      metaPurchase = {
        sent: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    if (metaPurchase.sent) {
      eventInsert.status = "processed";
    } else if (metaPurchase.skipped) {
      eventInsert.status = "processed";
    } else {
      eventInsert.status = "processed_with_warnings";
      eventInsert.error = `Meta Purchase event not sent: ${metaPurchase.reason}`;
      console.error("Meta Purchase event not sent", topic, metaPurchase.reason);
    }
    let googlePurchase: Awaited<ReturnType<typeof sendGooglePurchase>>;
    try {
      googlePurchase = await sendGooglePurchase(order, topic);
    } catch (error) {
      googlePurchase = {
        sent: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    if (!googlePurchase.sent && !googlePurchase.skipped) {
      eventInsert.status = "processed_with_warnings";
      const warning = `Google Purchase event not sent: ${googlePurchase.reason}`;
      eventInsert.error = eventInsert.error ? `${eventInsert.error}; ${warning}` : warning;
      console.error("Google Purchase event not sent", topic, googlePurchase.reason);
    }
    await updateReceipt(service, dedupeKey, eventInsert.status, eventInsert.error);
  } catch (error) {
    eventInsert.status = "failed";
    eventInsert.error = error instanceof Error ? error.message : String(error);
    console.error("shopify-webhook error", topic, eventInsert.error);
    await updateReceipt(service, dedupeKey, "failed", eventInsert.error);
  }

  const eventWrite = await service.from("shopify_webhook_events").insert(eventInsert);
  if (eventWrite.error) {
    console.error("shopify-webhook event log write failed", eventWrite.error.message);
    return new Response(JSON.stringify({ ok: false, error: "webhook_event_log_failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "5" },
    });
  }

  const failureStatus =
    eventInsert.status === "failed" ? webhookFailureStatus(eventInsert.error) : 200;
  return new Response(
    JSON.stringify({ ok: eventInsert.status !== "failed", status: eventInsert.status }),
    {
      status: failureStatus,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        ...(failureStatus >= 500 ? { "Retry-After": "5" } : {}),
      },
    },
  );
});
