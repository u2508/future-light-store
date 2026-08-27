import { lazy, Suspense, useState } from "react";
import { createLazyFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth, useIsStaff } from "@/hooks/useAuth";
import { formatMoney } from "@/lib/shopify";
import { callAdmin } from "./admin.finance";

const FinanceChart = lazy(() => import("@/components/vs/FinanceChart"));

export const Route = createLazyFileRoute("/admin/finance")({
  component: FinancePage,
});

interface FinanceResponse {
  currency: string;
  totals: Record<string, number>;
  series: Array<{ date: string; gross: number; refunds: number; net: number; orders: number }>;
  refundRows: Array<{
    id: string;
    order: string;
    date: string;
    amount: number;
    reason: string | null;
  }>;
  disputes: Array<{
    id: string;
    order: string;
    status: string | null;
    initiatedAs: string | null;
    amount: number;
  }>;
  recentOrders: Array<{
    id: string;
    name: string;
    email: string | null;
    date: string;
    total: number;
    refunded: number;
    financialStatus: string | null;
    fulfillmentStatus: string | null;
    cancelledAt: string | null;
  }>;
  reconciliation: {
    shopifyOrders: number;
    mirroredOrders: number;
    lastSyncedAt: string;
    inSync: boolean;
  };
}

const RANGES = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "12 months", days: 365 },
];

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className="vs-card rounded-2xl border border-border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={`mt-1 font-display text-2xl font-bold ${
          tone === "bad" ? "text-signal" : tone === "good" ? "text-primary" : ""
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function FinancePage() {
  const { user, loading } = useAuth();
  const isStaff = useIsStaff(user);
  const [days, setDays] = useState(30);

  const from = isoDaysAgo(days);
  const to = new Date().toISOString().slice(0, 10);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["admin-finance", from, to],
    queryFn: () => callAdmin<FinanceResponse>({ action: "finance", from, to }),
    enabled: Boolean(user) && isStaff === true,
  });

  if (loading)
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 text-sm text-muted-foreground">Loading…</div>
    );

  if (!user) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="font-display text-2xl font-bold">Staff sign-in required</h1>
        <Link
          to="/auth"
          className="mt-6 inline-block rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground"
        >
          Sign in
        </Link>
      </div>
    );
  }

  if (isStaff === false) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="font-display text-2xl font-bold">No admin access</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account ({user.email}) doesn't have the admin role for the VS finance workspace.
        </p>
      </div>
    );
  }

  const c = data?.currency ?? "USD";
  const t = data?.totals ?? {};

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Finance workspace</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live Shopify data · {from} → {to}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {RANGES.map((r) => (
            <button
              key={r.days}
              onClick={() => setDays(r.days)}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
                days === r.days
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card"
              }`}
            >
              {r.label}
            </button>
          ))}
          <button
            onClick={() => refetch()}
            className="rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium"
          >
            {isFetching ? "Syncing…" : "Sync now"}
          </button>
          <Link
            to="/admin/orders"
            className="rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium"
          >
            Orders
          </Link>
        </div>
      </div>

      {isError && (
        <div className="mt-6 rounded-2xl border border-signal/40 bg-signal/5 p-4 text-sm">
          <p className="font-semibold text-signal">Couldn't load finance data</p>
          <p className="mt-1 text-muted-foreground">{(error as Error)?.message}</p>
        </div>
      )}

      {isLoading ? (
        <p className="mt-10 text-sm text-muted-foreground">Pulling orders from Shopify…</p>
      ) : data ? (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Gross sales"
              value={formatMoney(t["grossSales"] ?? 0, c)}
              hint={`${t["orders"] ?? 0} orders`}
            />
            <Stat
              label="Net sales"
              value={formatMoney(t["netSales"] ?? 0, c)}
              tone="good"
              hint={`AOV ${formatMoney(t["averageOrderValue"] ?? 0, c)}`}
            />
            <Stat
              label="Refunds"
              value={formatMoney(t["refunds"] ?? 0, c)}
              tone="bad"
              hint={`${(t["refundRate"] ?? 0).toFixed(1)}% of gross`}
            />
            <Stat
              label="Chargebacks"
              value={formatMoney(t["chargebackAmount"] ?? 0, c)}
              tone="bad"
              hint={`${t["chargebacks"] ?? 0} disputes`}
            />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <div className="vs-card rounded-2xl border border-border bg-card p-4 lg:col-span-2">
              <h2 className="font-display text-lg font-semibold">Net sales trend</h2>
              <div className="mt-4 h-64">
                <Suspense
                  fallback={
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      Loading chart…
                    </div>
                  }
                >
                  <FinanceChart data={data.series} currency={c} />
                </Suspense>
              </div>
            </div>

            <div className="vs-card rounded-2xl border border-border bg-card p-4">
              <h2 className="font-display text-lg font-semibold">Profit &amp; loss</h2>
              <table className="mt-3 w-full text-sm">
                <tbody>
                  {[
                    ["Gross sales", t["grossSales"] ?? 0],
                    ["Discounts", -(t["discounts"] ?? 0)],
                    ["Refunds", -(t["refunds"] ?? 0)],
                    ["Net sales", t["netSales"] ?? 0],
                    ["Cost of goods", -(t["cogs"] ?? 0)],
                    ["Gross profit", t["grossProfit"] ?? 0],
                    ["Tax collected", t["tax"] ?? 0],
                    ["Shipping", t["shipping"] ?? 0],
                    ["Total collected", t["totalCollected"] ?? 0],
                  ].map(([label, value]) => (
                    <tr key={String(label)} className="border-b border-border/60 last:border-0">
                      <td className="py-2 text-muted-foreground">{label}</td>
                      <td
                        className={`py-2 text-right font-medium ${Number(value) < 0 ? "text-signal" : ""}`}
                      >
                        {formatMoney(Number(value), c)}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="py-2 text-muted-foreground">Margin</td>
                    <td className="py-2 text-right font-medium">
                      {(t["margin"] ?? 0).toFixed(1)}%
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="vs-card rounded-2xl border border-border bg-card p-4">
              <h2 className="font-display text-lg font-semibold">Refunds</h2>
              {data.refundRows.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">No refunds in this range.</p>
              ) : (
                <div className="mt-3 max-h-64 overflow-auto">
                  <table className="w-full text-sm">
                    <tbody>
                      {data.refundRows.map((r) => (
                        <tr key={r.id} className="border-b border-border/60 last:border-0">
                          <td className="py-2 font-medium">{r.order}</td>
                          <td className="py-2 text-muted-foreground">{r.date?.slice(0, 10)}</td>
                          <td className="py-2 text-right text-signal">
                            {formatMoney(r.amount, c)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="vs-card rounded-2xl border border-border bg-card p-4">
              <h2 className="font-display text-lg font-semibold">Chargebacks &amp; disputes</h2>
              {data.disputes.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">No disputes in this range.</p>
              ) : (
                <ul className="mt-3 space-y-2 text-sm">
                  {data.disputes.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center justify-between border-b border-border/60 pb-2 last:border-0"
                    >
                      <span className="font-medium">{d.order}</span>
                      <span className="text-muted-foreground">{d.status}</span>
                      <span className="text-signal">{formatMoney(d.amount, c)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="mt-6 vs-card rounded-2xl border border-border bg-card p-4">
            <h2 className="font-display text-lg font-semibold">Reconciliation</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-4 text-sm">
              <div>
                <p className="text-muted-foreground">Shopify orders</p>
                <p className="font-semibold">{data.reconciliation.shopifyOrders}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Mirrored in database</p>
                <p className="font-semibold">{data.reconciliation.mirroredOrders}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Status</p>
                <p
                  className={`font-semibold ${data.reconciliation.inSync ? "text-primary" : "text-signal"}`}
                >
                  {data.reconciliation.inSync ? "In sync" : "Drift detected"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Last synced</p>
                <p className="font-semibold">
                  {new Date(data.reconciliation.lastSyncedAt).toLocaleString()}
                </p>
              </div>
            </div>
            <button
              onClick={async () => {
                try {
                  const res = await callAdmin<{ results: Array<{ topic: string; ok: boolean }> }>({
                    action: "register_webhooks",
                  });
                  const ok = res.results.filter((r) => r.ok).length;
                  alert(`Webhook subscriptions active: ${ok}/${res.results.length}`);
                } catch (e) {
                  alert(e instanceof Error ? e.message : "Failed to register webhooks");
                }
              }}
              className="mt-4 rounded-xl border border-border px-4 py-2 text-sm font-semibold"
            >
              Register Shopify webhooks
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
