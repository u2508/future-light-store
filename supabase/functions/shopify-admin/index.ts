import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { adminGraphql, ORDER_FIELDS, orderRow, num, type AdminOrder } from "../_shared/shopify.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const ORDERS_QUERY = `
  query Orders($first: Int!, $query: String, $after: String) {
    orders(first: $first, query: $query, sortKey: PROCESSED_AT, reverse: true, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { ${ORDER_FIELDS} }
    }
  }
`;

async function fetchOrders(query: string, max = 250): Promise<AdminOrder[]> {
  const out: AdminOrder[] = [];
  let after: string | null = null;
  while (out.length < max) {
    const data: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: AdminOrder[] } } =
      await adminGraphql(ORDERS_QUERY, { first: Math.min(100, max - out.length), query, after });
    out.push(...data.orders.nodes);
    if (!data.orders.pageInfo.hasNextPage) break;
    after = data.orders.pageInfo.endCursor;
  }
  return out;
}

function buildFinance(orders: AdminOrder[]) {
  let gross = 0,
    discounts = 0,
    tax = 0,
    shipping = 0,
    refunds = 0,
    cogs = 0,
    cancelled = 0,
    units = 0;
  let currency = "USD";
  const disputes: Array<Record<string, unknown>> = [];
  const refundRows: Array<Record<string, unknown>> = [];
  const byDay = new Map<string, { date: string; gross: number; refunds: number; net: number; orders: number }>();

  for (const o of orders) {
    currency = o.currentTotalPriceSet?.shopMoney?.currencyCode ?? currency;
    const total = num(o.currentTotalPriceSet?.shopMoney?.amount);
    const refunded = num(o.totalRefundedSet?.shopMoney?.amount);
    const subtotal = num(o.currentSubtotalPriceSet?.shopMoney?.amount);
    gross += subtotal + num(o.currentTotalDiscountsSet?.shopMoney?.amount);
    discounts += num(o.currentTotalDiscountsSet?.shopMoney?.amount);
    tax += num(o.currentTotalTaxSet?.shopMoney?.amount);
    shipping += num(o.totalShippingPriceSet?.shopMoney?.amount);
    refunds += refunded;
    if (o.cancelledAt) cancelled += 1;

    for (const li of o.lineItems?.nodes ?? []) {
      units += li.quantity ?? 0;
      const unitCost = num(li.variant?.inventoryItem?.unitCost?.amount);
      cogs += unitCost * (li.quantity ?? 0);
    }

    for (const r of o.refunds ?? []) {
      refundRows.push({
        id: r.id,
        order: o.name,
        date: r.createdAt,
        amount: num(r.totalRefundedSet?.shopMoney?.amount),
        reason: r.note,
        currency,
      });
    }

    for (const d of o.disputes ?? []) {
      disputes.push({ id: d.id, order: o.name, status: d.status, initiatedAs: d.initiatedAs, amount: total });
    }

    const day = (o.processedAt ?? o.createdAt ?? "").slice(0, 10);
    if (day) {
      const bucket = byDay.get(day) ?? { date: day, gross: 0, refunds: 0, net: 0, orders: 0 };
      bucket.gross += subtotal;
      bucket.refunds += refunded;
      bucket.net += subtotal - refunded;
      bucket.orders += 1;
      byDay.set(day, bucket);
    }
  }

  const netSales = gross - discounts - refunds;
  const orderCount = orders.length;

  return {
    currency,
    totals: {
      grossSales: gross,
      discounts,
      refunds,
      netSales,
      tax,
      shipping,
      totalCollected: netSales + tax + shipping,
      cogs,
      grossProfit: netSales - cogs,
      margin: netSales > 0 ? ((netSales - cogs) / netSales) * 100 : 0,
      orders: orderCount,
      cancelled,
      units,
      averageOrderValue: orderCount > 0 ? netSales / orderCount : 0,
      refundRate: gross > 0 ? (refunds / gross) * 100 : 0,
      chargebacks: disputes.length,
      chargebackAmount: disputes.reduce((s, d) => s + num(d['amount']), 0),
    },
    series: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    refundRows: refundRows.sort((a, b) => String(b['date']).localeCompare(String(a['date']))).slice(0, 50),
    disputes,
    recentOrders: orders.slice(0, 25).map((o) => ({
      id: o.id,
      name: o.name,
      email: o.email,
      date: o.processedAt ?? o.createdAt,
      total: num(o.currentTotalPriceSet?.shopMoney?.amount),
      refunded: num(o.totalRefundedSet?.shopMoney?.amount),
      financialStatus: o.displayFinancialStatus,
      fulfillmentStatus: o.displayFulfillmentStatus,
      cancelledAt: o.cancelledAt,
      currency,
    })),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) return json({ error: "Unauthorized" }, 401);

    const service = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: roles } = await service
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id);
    const isStaff = (roles ?? []).some((r: { role: string }) => r.role === "admin" || r.role === "staff");
    if (!isStaff) return json({ error: "Forbidden: admin access required" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = typeof body.action === "string" ? body.action : "finance";
    const from = typeof body.from === "string" ? body.from : null;
    const to = typeof body.to === "string" ? body.to : null;

    const parts: string[] = [];
    if (from) parts.push(`processed_at:>=${from}`);
    if (to) parts.push(`processed_at:<=${to}`);
    const shopifyQuery = parts.join(" AND ");

    if (action === "finance" || action === "orders") {
      const orders = await fetchOrders(shopifyQuery, action === "orders" ? 100 : 250);

      // mirror into Supabase for reconciliation + track-order lookups
      if (orders.length > 0) {
        await service.from("shopify_orders").upsert(orders.map(orderRow));
        const refundRows = orders.flatMap((o) =>
          (o.refunds ?? []).map((r) => ({
            id: r.id,
            order_id: o.id,
            kind: "refund",
            amount: num(r.totalRefundedSet?.shopMoney?.amount),
            currency: r.totalRefundedSet?.shopMoney?.currencyCode ?? "USD",
            reason: r.note,
            processed_at: r.createdAt,
            raw: r as unknown as Record<string, unknown>,
          })),
        );
        if (refundRows.length > 0) await service.from("shopify_refunds").upsert(refundRows);
      }

      if (action === "orders") {
        return json({
          orders: orders.map((o) => ({
            id: o.id,
            name: o.name,
            email: o.email,
            date: o.processedAt ?? o.createdAt,
            total: num(o.currentTotalPriceSet?.shopMoney?.amount),
            currency: o.currentTotalPriceSet?.shopMoney?.currencyCode ?? "USD",
            financialStatus: o.displayFinancialStatus,
            fulfillmentStatus: o.displayFulfillmentStatus,
            cancelledAt: o.cancelledAt,
            items: (o.lineItems?.nodes ?? []).map((li) => ({ title: li.title, quantity: li.quantity })),
          })),
        });
      }

      const finance = buildFinance(orders);
      const { count: mirroredCount } = await service
        .from("shopify_orders")
        .select("id", { count: "exact", head: true });

      return json({
        ...finance,
        reconciliation: {
          shopifyOrders: orders.length,
          mirroredOrders: mirroredCount ?? 0,
          lastSyncedAt: new Date().toISOString(),
          inSync: (mirroredCount ?? 0) >= orders.length,
        },
      });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (error) {
    console.error("shopify-admin error", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
