import { createFileRoute, Link } from "@tanstack/react-router";

const FAQS = [
  { q: "How long does delivery take?", a: "Most orders ship within 1–2 business days; delivery estimates are shown at checkout." },
  { q: "Can I return an item?", a: "Yes — unused items can be returned within 30 days of delivery." },
  { q: "Which payment methods are accepted?", a: "Checkout is handled securely by Shopify and supports major cards and wallets." },
  { q: "Where is my order?", a: "Use the order number from your confirmation email on the tracking page." },
];

export const Route = createFileRoute("/help")({
  head: () => ({
    meta: [
      { title: "Help centre — VS Store" },
      { name: "description", content: "Answers on delivery, returns, payments and order tracking at VS Store." },
      { property: "og:title", content: "Help centre — VS Store" },
      { property: "og:description", content: "Answers on delivery, returns, payments and order tracking." },
    ],
  }),
  component: HelpPage,
});

function HelpPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="font-display text-3xl font-bold">Help centre</h1>
      <div className="mt-6 space-y-3">
        {FAQS.map((f) => (
          <details key={f.q} className="rounded-2xl border border-border bg-card p-5">
            <summary className="cursor-pointer font-medium">{f.q}</summary>
            <p className="mt-2 text-sm text-muted-foreground">{f.a}</p>
          </details>
        ))}
      </div>
      <Link to="/track-order" className="mt-6 inline-block text-sm font-semibold text-primary hover:underline">
        Track an order →
      </Link>
    </div>
  );
}
