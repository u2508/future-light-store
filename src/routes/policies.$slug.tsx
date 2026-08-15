import { createFileRoute } from "@tanstack/react-router";

const POLICIES: Record<string, { title: string; body: string[] }> = {
  shipping: {
    title: "Shipping policy",
    body: [
      "Orders are processed within 1–2 business days. Delivery estimates and costs are calculated at checkout based on your address.",
      "Once dispatched, you'll receive a tracking link by email.",
    ],
  },
  returns: {
    title: "Returns policy",
    body: [
      "Unused items in original packaging can be returned within 30 days of delivery.",
      "Refunds are issued to the original payment method once the return is received.",
    ],
  },
  privacy: {
    title: "Privacy policy",
    body: [
      "We collect only the information needed to process and deliver your orders.",
      "Payment details are handled by Shopify and never stored by VS Store.",
    ],
  },
  terms: {
    title: "Terms of service",
    body: [
      "By placing an order you agree to our pricing, delivery and returns terms as described on this site.",
      "Prices and availability may change without notice.",
    ],
  },
};

export const Route = createFileRoute("/policies/$slug")({
  head: ({ params }) => {
    const policy = POLICIES[params.slug];
    const title = policy?.title ?? "Policy";
    return {
      meta: [
        { title: `${title} — VS Store` },
        { name: "description", content: `${title} for VS Store orders, delivery and customer data.` },
        { property: "og:title", content: `${title} — VS Store` },
        { property: "og:description", content: `${title} for VS Store orders and customers.` },
      ],
    };
  },
  component: PolicyPage,
});

function PolicyPage() {
  const { slug } = Route.useParams();
  const policy = POLICIES[slug];

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="font-display text-3xl font-bold">{policy?.title ?? "Policy not found"}</h1>
      <div className="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground">
        {(policy?.body ?? ["This policy isn't available."]).map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>
    </div>
  );
}
