import { createFileRoute, Link } from "@tanstack/react-router";
import { Minus, Plus, Trash2 } from "lucide-react";
import { formatMoney } from "@/lib/shopify";
import { useCartStore } from "@/stores/cartStore";

export const Route = createFileRoute("/cart")({
  head: () => ({
    meta: [
      { title: "Your bag — VS Store" },
      { name: "description", content: "Review the items in your VS Store bag and continue to secure checkout." },
      { property: "og:title", content: "Your bag — VS Store" },
      { property: "og:description", content: "Review your bag and continue to secure checkout." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: CartPage,
});

function CartPage() {
  const { items, updateQuantity, removeItem, checkoutUrl, isLoading } = useCartStore();
  const currency = items[0]?.price.currencyCode ?? "USD";
  const subtotal = items.reduce((sum, i) => sum + parseFloat(i.price.amount) * i.quantity, 0);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="font-display text-3xl font-bold">Your bag</h1>
      {items.length === 0 ? (
        <div className="vs-card mt-6 p-12 text-center">
          <p className="font-display text-lg font-semibold">Your bag is empty</p>
          <Link to="/shop" className="mt-3 inline-block text-sm font-semibold text-primary hover:underline">
            Start shopping →
          </Link>
        </div>
      ) : (
        <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_320px]">
          <ul className="space-y-3">
            {items.map((item) => (
              <li key={item.variantId} className="flex gap-4 rounded-2xl border border-border bg-card p-4">
                <img
                  src={item.product.node.images.edges[0]?.node.url ?? ""}
                  alt={item.product.node.title}
                  className="h-24 w-24 rounded-xl object-cover"
                />
                <div className="flex-1">
                  <p className="font-medium">{item.product.node.title}</p>
                  <p className="text-xs text-muted-foreground">{item.variantTitle}</p>
                  <div className="mt-3 flex items-center gap-3">
                    <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
                      <button
                        aria-label="Decrease quantity"
                        onClick={() => updateQuantity(item.variantId, Math.max(1, item.quantity - 1))}
                        className="grid h-7 w-7 place-items-center rounded hover:bg-muted"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-7 text-center text-sm">{item.quantity}</span>
                      <button
                        aria-label="Increase quantity"
                        onClick={() => updateQuantity(item.variantId, item.quantity + 1)}
                        className="grid h-7 w-7 place-items-center rounded hover:bg-muted"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <button
                      onClick={() => removeItem(item.variantId)}
                      aria-label="Remove item"
                      className="text-muted-foreground hover:text-signal"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <p className="font-display font-semibold">
                  {formatMoney(String(parseFloat(item.price.amount) * item.quantity), item.price.currencyCode)}
                </p>
              </li>
            ))}
          </ul>

          <aside className="h-fit rounded-2xl border border-border bg-card p-5">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-display text-lg font-bold">{formatMoney(String(subtotal), currency)}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Taxes and shipping calculated at checkout.</p>
            <button
              onClick={() => checkoutUrl && window.open(checkoutUrl, "_blank")}
              disabled={!checkoutUrl || isLoading}
              className="mt-4 block w-full rounded-xl bg-primary py-3 text-center text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Checkout
            </button>
          </aside>
        </div>
      )}
    </div>
  );
}
