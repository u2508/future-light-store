import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { adminGraphql, ORDER_FIELDS, orderRow, num, type AdminOrder } from "../_shared/shopify.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const LOOKUP_QUERY = `
  query Lookup($query: String!) {
    orders(first: 5, query: $query, sortKey: PROCESSED_AT, reverse: true) {
      nodes { ${ORDER_FIELDS} }
    }
  }
`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const rawNumber = typeof body.orderNumber === "string" ? body.orderNumber.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

    if (!rawNumber || rawNumber.length > 40) return json({ error: "Order number is required" }, 400);
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "A valid email is required" }, 400);

    const orderNumber = rawNumber.replace(/^#/, "").replace(/[^A-Za-z0-9._-]/g, "");
    const data: { orders: { nodes: AdminOrder[] } } = await adminGraphql(LOOKUP_QUERY, {
      query: `name:${orderNumber} OR name:#${orderNumber}`,
    });

    const order = (data.orders?.nodes ?? []).find(
      (o) => (o.email ?? "").toLowerCase() === email,
    );

    if (!order) {
      return json({ found: false, message: "No order matches that order number and email." });
    }

    const service = createClient(SUPABASE_URL, SERVICE_ROLE);
    await service.from("shopify_orders").upsert(orderRow(order));

    const tracking = (order.fulfillments ?? []).flatMap((f) =>
      (f.trackingInfo ?? []).map((t) => ({
        number: t.number,
        url: t.url,
        company: t.company,
        status: f.status,
        updatedAt: f.updatedAt ?? f.createdAt,
      })),
    );

    const timeline: Array<{ label: string; at: string | null; done: boolean }> = [
      { label: "Order placed", at: order.processedAt ?? order.createdAt, done: true },
      {
        label: "Payment " + (order.displayFinancialStatus ?? "pending").toLowerCase(),
        at: order.processedAt ?? order.createdAt,
        done: order.displayFinancialStatus === "PAID" || order.displayFinancialStatus === "PARTIALLY_REFUNDED",
      },
      {
        label: "Fulfilled",
        at: order.fulfillments?.[0]?.createdAt ?? null,
        done: order.displayFulfillmentStatus === "FULFILLED",
      },
      {
        label: "Delivered",
        at: order.fulfillments?.[0]?.updatedAt ?? null,
        done: (order.fulfillments ?? []).some((f) => f.status === "SUCCESS" && order.displayFulfillmentStatus === "FULFILLED"),
      },
    ];

    return json({
      found: true,
      order: {
        name: order.name,
        placedAt: order.processedAt ?? order.createdAt,
        cancelledAt: order.cancelledAt,
        cancelReason: order.cancelReason,
        financialStatus: order.displayFinancialStatus,
        fulfillmentStatus: order.displayFulfillmentStatus,
        total: num(order.currentTotalPriceSet?.shopMoney?.amount),
        refunded: num(order.totalRefundedSet?.shopMoney?.amount),
        currency: order.currentTotalPriceSet?.shopMoney?.currencyCode ?? "USD",
        destination: order.shippingAddress
          ? [order.shippingAddress.city, order.shippingAddress.province, order.shippingAddress.country]
              .filter(Boolean)
              .join(", ")
          : null,
        items: (order.lineItems?.nodes ?? []).map((li) => ({
          title: li.title,
          quantity: li.quantity,
          image: li.image?.url ?? null,
          total: num(li.discountedTotalSet?.shopMoney?.amount),
        })),
        tracking,
        timeline,
      },
    });
  } catch (error) {
    console.error("track-order error", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
