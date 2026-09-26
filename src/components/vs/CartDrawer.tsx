import { useEffect, useState } from "react";
import { ExternalLink, Loader2, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { CART_OPEN_EVENT, useCartStore } from "@/stores/cartStore";
import { formatMoney } from "@/lib/shopify";
import { normalizeMetaCatalogId, trackBeginCheckout } from "@/lib/marketingAnalytics";
import { US_SHIPPING_PROMISE } from "@/lib/shipping-promise";

export function CartDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  const [mutationMessage, setMutationMessage] = useState("");
  const { items, isLoading, isSyncing, updateQuantity, removeItem, getCheckoutUrl, syncCart } =
    useCartStore();
  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
  const currency = items[0]?.price.currencyCode ?? "USD";
  const totalPrice = items.reduce(
    (sum, item) => sum + parseFloat(item.price.amount) * item.quantity,
    0,
  );

  useEffect(() => {
    if (isOpen) syncCart();
  }, [isOpen, syncCart]);

  useEffect(() => {
    const openCart = () => setIsOpen(true);
    window.addEventListener(CART_OPEN_EVENT, openCart);
    return () => window.removeEventListener(CART_OPEN_EVENT, openCart);
  }, []);

  const handleCheckout = () => {
    const checkoutUrl = getCheckoutUrl();
    if (checkoutUrl) {
      trackBeginCheckout({
        currency,
        value: totalPrice,
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
      setIsOpen(false);
    }
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
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <button
          className="relative inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium transition-colors hover:border-primary"
          aria-label={`Bag, ${totalItems} items`}
        >
          <ShoppingBag className="h-4 w-4" />
          <span className="hidden sm:inline">Bag</span>
          {totalItems > 0 && (
            <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-signal px-1 text-[11px] font-bold text-signal-foreground">
              {totalItems}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent className="flex h-full w-full flex-col sm:max-w-lg">
        <SheetHeader className="flex-shrink-0">
          <SheetTitle className="font-display">Your bag</SheetTitle>
          <SheetDescription>
            {totalItems === 0
              ? "Your bag is empty"
              : `${totalItems} item${totalItems !== 1 ? "s" : ""} ready`}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col pt-6">
          {items.length === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center">
                <ShoppingBag className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Nothing here yet — start exploring.</p>
              </div>
            </div>
          ) : (
            <>
              {mutationMessage && (
                <p role="alert" aria-live="polite" className="mb-3 text-sm text-signal">
                  {mutationMessage}
                </p>
              )}
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-2">
                {items.map((item) => (
                  <div key={item.variantId} className="flex gap-4">
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-border bg-secondary">
                      {(item.variantImageUrl || item.product.node.images?.edges?.[0]?.node) && (
                        <img
                          src={
                            item.variantImageUrl ?? item.product.node.images?.edges?.[0]?.node.url
                          }
                          alt={
                            item.variantImageAlt ||
                            `${item.product.node.title} — ${item.variantTitle}`
                          }
                          className="h-full w-full object-cover"
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.product.node.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.selectedOptions
                          .map((option) => `${option.name}: ${option.value}`)
                          .join(" · ") || item.variantTitle}
                      </p>
                      <p className="text-sm font-semibold">
                        {formatMoney(item.price.amount, item.price.currencyCode)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <button
                        onClick={() => void removeCartItem(item.variantId)}
                        aria-label="Remove item"
                        disabled={isLoading || isSyncing}
                        className="rounded-lg p-1 text-muted-foreground hover:text-signal disabled:opacity-40"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                      <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
                        <button
                          onClick={() => void changeQuantity(item.variantId, item.quantity - 1)}
                          aria-label="Decrease quantity"
                          disabled={isLoading || isSyncing}
                          className="grid h-6 w-6 place-items-center rounded hover:bg-muted disabled:opacity-40"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="w-6 text-center text-sm">{item.quantity}</span>
                        <button
                          onClick={() => void changeQuantity(item.variantId, item.quantity + 1)}
                          aria-label="Increase quantity"
                          disabled={isLoading || isSyncing}
                          className="grid h-6 w-6 place-items-center rounded hover:bg-muted disabled:opacity-40"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex-shrink-0 space-y-4 border-t border-border bg-background pt-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Subtotal</span>
                  <span className="font-display text-xl font-bold">
                    {formatMoney(totalPrice, currency)}
                  </span>
                </div>
                <button
                  onClick={handleCheckout}
                  disabled={items.length === 0 || isLoading || isSyncing}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
                >
                  {isLoading || isSyncing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <ExternalLink className="h-4 w-4" /> Secure checkout
                    </>
                  )}
                </button>
                <p className="text-center text-[11px] text-muted-foreground">
                  {US_SHIPPING_PROMISE.summary}. Taxes and address-specific exceptions are
                  confirmed at checkout.
                </p>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
