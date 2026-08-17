import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Circle, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatMoney } from "@/lib/shopify";
import { SHOPIFY_ACCOUNT_URL } from "./account";

export const Route = createFileRoute("/track-order")({
  head: () => ({
    meta: [
      { title: "Track your order — VS Store" },
      { name: "description", content: "Enter your VS Store order number and email to check live delivery status." },
      { property: "og:title", content: "Track your order — VS Store" },
      { property: "og:description", content: "Check the live delivery status of your VS Store order." },
    ],
  }),
  component: TrackOrderPage,
});

interface TrackResult {
  found: boolean;
  message?: string;
  order?: {
    name: string;
    placedAt: string;
    cancelledAt: string | null;
    cancelReason: string | null;
    financialStatus: string | null;
    fulfillmentStatus: string | null;
    total: number;
    refunded: number;
    currency: string;
    destination: string | null;
    items: Array<{ title: string; quantity: number; image: string | null; total: number }>;
    tracking: Array<{ number: string | null; url: string | null; company: string | null; status: string | null; updatedAt: string | null }>;
    timeline: Array<{ label: string; at: string | null; done: boolean }>;
  };
}

function TrackOrderPage() {
  const [orderNumber, setOrderNumber] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TrackResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("track-order", {
        body: { orderNumber, email },
      });
      if (fnError) throw fnError;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      setResult(data as TrackResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reach order tracking right now.");
    } finally {
      setBusy(false);
    }
  }

  const order = result?.order;

  return (
    <div className="mx-auto max-w-2xl px-4 py-14">
      <h1 className="font-display text-3xl font-bold">Track your order</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Use the order number from your confirmation email. Status comes straight from Shopify.
      </p>

      <form className="mt-6 space-y-3" onSubmit={submit}>
        <input
          required
          value={orderNumber}
          onChange={(e) => setOrderNumber(e.target.value)}
          placeholder="Order number (e.g. 1001)"
          aria-label="Order number"
          className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm"
        />
        <input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email address"
          aria-label="Email address"
          className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm"
        />
        <button
          disabled={busy}
          className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {busy ? "Checking Shopify…" : "Find my order"}
        </button>
      </form>

      {error && (
        <p className="mt-4 rounded-xl border border-signal/40 bg-signal/5 p-4 text-sm text-signal">{error}</p>
      )}

      {result && !result.found && (
        <p className="mt-4 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          {result.message ?? "No order matched those details."}
        </p>
      )}

      {order && (
        <div className="mt-6 space-y-4">
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-xl font-semibold">Order {order.name}</h2>
              <span className="text-sm text-muted-foreground">{new Date(order.placedAt).toLocaleDateString()}</span>
            </div>
            {order.cancelledAt ? (
              <p className="mt-2 text-sm text-signal">
                Cancelled on {new Date(order.cancelledAt).toLocaleDateString()}
                {order.cancelReason ? ` · ${order.cancelReason}` : ""}
              </p>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                Payment {order.financialStatus?.toLowerCase()} · Fulfilment {order.fulfillmentStatus?.toLowerCase()}
              </p>
            )}
            {order.destination && <p className="mt-1 text-sm text-muted-foreground">Shipping to {order.destination}</p>}
            <p className="mt-2 text-sm font-semibold">{formatMoney(order.total, order.currency)}</p>
            {order.refunded > 0 && (
              <p className="text-sm text-signal">Refunded {formatMoney(order.refunded, order.currency)}</p>
            )}
          </div>

          <ol className="rounded-2xl border border-border bg-card p-5">
            {order.timeline.map((step) => (
              <li key={step.label} className="flex items-center gap-3 py-2 text-sm">
                {step.done ? (
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground" />
                )}
                <span className={step.done ? "font-medium capitalize" : "capitalize text-muted-foreground"}>
                  {step.label}
                </span>
                {step.at && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(step.at).toLocaleDateString()}
                  </span>
                )}
              </li>
            ))}
          </ol>

          {order.tracking.length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-5">
              <h3 className="font-display text-lg font-semibold">Tracking</h3>
              <ul className="mt-3 space-y-2 text-sm">
                {order.tracking.map((t, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{t.company ?? "Carrier"}</span>
                    <span className="text-muted-foreground">{t.number ?? "—"}</span>
                    {t.url && (
                      <a
                        href={t.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-auto inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                      >
                        Track <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-2xl border border-border bg-card p-5">
            <h3 className="font-display text-lg font-semibold">Items</h3>
            <ul className="mt-3 space-y-3">
              {order.items.map((item, i) => (
                <li key={i} className="flex items-center gap-3 text-sm">
                  {item.image && (
                    <img src={item.image} alt={item.title} loading="lazy" className="h-12 w-12 rounded-lg object-cover" />
                  )}
                  <span className="flex-1">{item.title}</span>
                  <span className="text-muted-foreground">×{item.quantity}</span>
                  <span className="font-medium">{formatMoney(item.total, order.currency)}</span>
                </li>
              ))}
            </ul>
          </div>

          <a
            href={SHOPIFY_ACCOUNT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
          >
            Open your Shopify account for invoices and returns <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      )}
    </div>
  );
}
