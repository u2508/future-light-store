import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/orders")({
  head: () => ({
    meta: [
      { title: "Orders — VS Store" },
      { name: "description", content: "See your VS Store order history and delivery status." },
      { property: "og:title", content: "Orders — VS Store" },
      { property: "og:description", content: "See your VS Store order history and delivery status." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: OrdersPage,
});

function OrdersPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <h1 className="font-display text-3xl font-bold">Orders</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Order history appears here once accounts are enabled. Guest orders can be tracked with an order number.
      </p>
      <Link to="/track-order" className="mt-6 inline-block rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground">
        Track an order
      </Link>
    </div>
  );
}
