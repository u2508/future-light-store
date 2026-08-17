import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth, useIsStaff } from "@/hooks/useAuth";
import { formatMoney } from "@/lib/shopify";
import { callAdmin } from "./admin.finance";

export const Route = createFileRoute("/admin/orders")({
  head: () => ({
    meta: [
      { title: "Orders — VS Admin" },
      { name: "description", content: "VS Store admin order feed synced from Shopify." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminOrdersPage,
});

interface AdminOrder {
  id: string;
  name: string;
  email: string | null;
  date: string;
  total: number;
  currency: string;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  cancelledAt: string | null;
  items: Array<{ title: string; quantity: number }>;
}

function AdminOrdersPage() {
  const { user, loading } = useAuth();
  const isStaff = useIsStaff(user);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["admin-orders"],
    queryFn: () => callAdmin<{ orders: AdminOrder[] }>({ action: "orders" }),
    enabled: Boolean(user) && isStaff === true,
  });

  if (loading) return <div className="mx-auto max-w-7xl px-4 py-16 text-sm text-muted-foreground">Loading…</div>;

  if (!user || isStaff === false) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="font-display text-2xl font-bold">Staff access required</h1>
        <Link to="/auth" className="mt-6 inline-block rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold tracking-tight">Orders</h1>
        <Link to="/admin/finance" className="rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium">
          Finance
        </Link>
      </div>

      {isError && <p className="mt-6 text-sm text-signal">{(error as Error)?.message}</p>}
      {isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading orders…</p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-3">Order</th>
                <th className="p-3">Date</th>
                <th className="p-3">Customer</th>
                <th className="p-3">Payment</th>
                <th className="p-3">Fulfilment</th>
                <th className="p-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {(data?.orders ?? []).map((o) => (
                <tr key={o.id} className="border-b border-border/60 last:border-0">
                  <td className="p-3 font-medium">{o.name}</td>
                  <td className="p-3 text-muted-foreground">{o.date?.slice(0, 10)}</td>
                  <td className="p-3 text-muted-foreground">{o.email ?? "—"}</td>
                  <td className="p-3">{o.cancelledAt ? "CANCELLED" : (o.financialStatus ?? "—")}</td>
                  <td className="p-3">{o.fulfillmentStatus ?? "—"}</td>
                  <td className="p-3 text-right font-medium">{formatMoney(o.total, o.currency)}</td>
                </tr>
              ))}
              {(data?.orders ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-muted-foreground">
                    No orders yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
