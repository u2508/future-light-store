import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Minus, Plus, ShieldCheck, Trash2, Truck } from "lucide-react";
import { formatMoney } from "@/lib/shopify";
import { useCartStore } from "@/stores/cartStore";
import { normalizeMetaCatalogId, trackBeginCheckout } from "@/lib/marketingAnalytics";
import { canonicalUrl } from "@/lib/seo";
import { US_SHIPPING_PROMISE } from "@/lib/shipping-promise";

export const Route = createFileRoute("/cart")({
  head: () => ({
    meta: [
      { title: "Your bag — VS Associates" },
      {
        name: "description",
        content: "Review the items in your VS Associates bag and continue to secure checkout.",
      },
      { property: "og:title", content: "Your bag — VS Associates" },
      { property: "og:description", content: "Review your bag and continue to secure checkout." },
      { name: "robots", content: "noindex, nofollow" },
    ],
    links: [{ rel: "canonical", href: canonicalUrl("/cart") }],
  }),
  component: CartPage,
});

function CartPage() {
  const [mutationMessage, setMutationMessage] = useState("");
  const { items, updateQuantity, removeItem, checkoutUrl, isLoading, isSyncing, syncCart } =
    useCartStore();
  const currency = items[0]?.price.currencyCode ?? "USD";
  const subtotal = items.reduce((sum, i) => sum + parseFloat(i.price.amount) * i.quantity, 0);

  useEffect(() => {
    void syncCart();
  }, [syncCart]);

  const handleCheckout = () => {
    if (!checkoutUrl) return;
    trackBeginCheckout({
      currency,
      value: subtotal,
      items: items.map((item) => ({
        item_id: normalizeMetaCatalogId(item.variantId),
        item_name: item.product.node.title,
        price: Number(item.price.amount),
        quantity: item.quantity,
        item_variant: item.variantTitle,
        item_brand: item.product.node.vendor || undefined,
        item_category: item.product.node.productType || undefined,
      })),
    });
    window.open(checkoutUrl, "_blank");
  };

  const changeQuantity = async (variantId: string, quantity: number) => {
    setMutationMessage("");
    const result = await updateQuantity(variantId, quantity);
    if (!result.success) setMutationMessage(result.message);
  };

  const removeCartItem = async (variantId: string) => {
    setMutationMessage("");
    const result = await removeItem(variantId);
    if (!result.success) setMutationMessage(result.message);
  };

  return (
    <div className="vs-wide-shell py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">
            VS Associates / Checkout
          </p>
          <h1 className="mt-2 font-display text-3xl font-bold">Your bag</h1>
        </div>
        <Link
          to="/shop"
          className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Continue shopping
        </Link>
      </div>
      {items.length === 0 ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_0.7fr]">
          <div className="vs-card p-12 text-center">
            <p className="font-display text-lg font-semibold">Your bag is empty</p>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
              Start with the full catalog or browse a curated collection for your next everyday
              upgrade.
            </p>
            <Link
              to="/shop"
              className="mt-5 inline-flex rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Start shopping →
            </Link>
          </div>
          <div className="rounded-[2rem] border border-border/70 bg-card p-6 shadow-[var(--shadow-card)]">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              Checkout confidence
            </p>
            <div className="mt-5 space-y-4 text-sm text-muted-foreground">
              <p className="flex items-center gap-3">
                <ShieldCheck className="h-4 w-4 text-primary" /> Secure Shopify checkout
              </p>
              <p className="flex items-center gap-3">
                <Truck className="h-4 w-4 text-primary" /> Tracking after dispatch
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_320px]">
          <ul className="space-y-3">
            {items.map((item) => (
              <li
                key={item.variantId}
                className="flex gap-4 rounded-2xl border border-border bg-card p-4"
              >
                <img
                  src={item.variantImageUrl ?? item.product.node.images.edges[0]?.node.url ?? ""}
                  alt={item.variantImageAlt || `${item.product.node.title} — ${item.variantTitle}`}
                  className="h-24 w-24 rounded-xl object-cover"
                />
                <div className="flex-1">
                  <p className="font-medium">{item.product.node.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.selectedOptions?.length
                      ? item.selectedOptions
                          .map((option) => `${option.name}: ${option.value}`)
                          .join(" · ")
                      : item.variantTitle}
                  </p>
                  <div className="mt-3 flex items-center gap-3">
                    <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
                      <button
                        aria-label="Decrease quantity"
                        onClick={() =>
                          void changeQuantity(item.variantId, Math.max(0, item.quantity - 1))
                        }
                        disabled={isLoading || isSyncing}
                        className="grid h-7 w-7 place-items-center rounded hover:bg-muted disabled:opacity-40"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-7 text-center text-sm">{item.quantity}</span>
                      <button
                        aria-label="Increase quantity"
                        onClick={() => void changeQuantity(item.variantId, item.quantity + 1)}
                        disabled={isLoading || isSyncing}
                        className="grid h-7 w-7 place-items-center rounded hover:bg-muted disabled:opacity-40"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <button
                      onClick={() => void removeCartItem(item.variantId)}
                      aria-label="Remove item"
                      disabled={isLoading || isSyncing}
                      className="text-muted-foreground hover:text-signal disabled:opacity-40"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <p className="font-display font-semibold">
                  {formatMoney(
                    String(parseFloat(item.price.amount) * item.quantity),
                    item.price.currencyCode,
                  )}
                </p>
            </li>
            ))}
          </ul>

          <aside className="h-fit rounded-2xl border border-border bg-card p-5">
            {mutationMessage && (
              <p role="alert" aria-live="polite" className="mb-3 text-sm text-signal">
                {mutationMessage}
              </p>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-display text-lg font-bold">
                {formatMoney(String(subtotal), currency)}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {US_SHIPPING_PROMISE.summary}. Taxes and address-specific exceptions are confirmed
              at checkout.
            </p>
            <button
              onClick={handleCheckout}
              disabled={!checkoutUrl || isLoading || isSyncing}
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
