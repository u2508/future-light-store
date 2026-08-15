import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Heart, Loader2, ShoppingBag, Star } from "lucide-react";
import { toast } from "sonner";
import { discountPercent, formatMoney, type ShopifyProduct } from "@/lib/shopify";
import { useCartStore } from "@/stores/cartStore";
import { useWishlistStore } from "@/stores/wishlistStore";
import { QuickActionsSheet } from "@/components/vs/QuickActionsSheet";
import { cn } from "@/lib/utils";

export function ProductCard({ product }: { product: ShopifyProduct }) {
  const n = product.node;
  const [quickOpen, setQuickOpen] = useState(false);
  const addItem = useCartStore((s) => s.addItem);
  const isLoading = useCartStore((s) => s.isLoading);
  const wishlisted = useWishlistStore((s) => s.items.some((i) => i.node.handle === n.handle));
  const toggleWishlist = useWishlistStore((s) => s.toggle);

  const image = n.images.edges[0]?.node;
  const variants = n.variants.edges.map((e) => e.node);
  const firstVariant = variants[0];
  const price = firstVariant?.price ?? n.priceRange.minVariantPrice;
  const compareAt = firstVariant?.compareAtPrice?.amount ?? null;
  const off = discountPercent(price.amount, compareAt);
  const singleVariant = variants.length === 1;
  const soldOut = !n.availableForSale;
  const lowStock = variants.some((v) => v.quantityAvailable !== null && v.quantityAvailable > 0 && v.quantityAvailable <= 5);

  const quickAdd = async () => {
    if (soldOut) return;
    if (!singleVariant) {
      setQuickOpen(true);
      return;
    }
    if (!firstVariant) return;
    await addItem({
      product,
      variantId: firstVariant.id,
      variantTitle: firstVariant.title,
      price: firstVariant.price,
      quantity: 1,
      selectedOptions: firstVariant.selectedOptions ?? [],
    });
    toast.success("Added to bag", { description: n.title, position: "top-center" });
  };

  return (
    <>
      <article className="group relative flex flex-col overflow-hidden vs-card hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]">
        <div className="relative aspect-square overflow-hidden bg-secondary">
          <Link to="/products/$handle" params={{ handle: n.handle }} aria-label={n.title}>
            {image ? (
              <img
                src={image.url}
                alt={image.altText ?? n.title}
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
              />
            ) : (
              <div className="grid h-full w-full place-items-center text-xs text-muted-foreground">No image</div>
            )}
          </Link>

          <button
            onClick={() => {
              const added = toggleWishlist(product);
              toast(added ? "Saved to wishlist" : "Removed from wishlist", { position: "top-center" });
            }}
            aria-label={wishlisted ? "Remove from wishlist" : "Save to wishlist"}
            className="absolute left-3 top-3 grid h-9 w-9 place-items-center rounded-full border border-border bg-card/90 backdrop-blur transition-colors hover:border-signal"
          >
            <Heart className={cn("h-4 w-4", wishlisted ? "fill-signal text-signal" : "text-muted-foreground")} />
          </button>

          {off > 0 && (
            <span className="absolute right-3 top-3 rounded-full bg-signal px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-signal-foreground">
              {off}% off
            </span>
          )}
          {soldOut && (
            <span className="absolute inset-x-0 bottom-0 bg-foreground/85 py-1.5 text-center text-[11px] font-semibold uppercase tracking-widest text-background">
              Sold out
            </span>
          )}

          <div className="absolute inset-x-3 bottom-3 translate-y-3 opacity-0 transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100 max-sm:hidden">
            <button
              onClick={() => setQuickOpen(true)}
              className="w-full rounded-xl border border-border bg-card/95 py-2 text-xs font-semibold backdrop-blur transition-colors hover:border-primary hover:text-primary"
            >
              Quick view
            </button>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-2 p-4">
          <Link to="/products/$handle" params={{ handle: n.handle }} className="line-clamp-2 text-sm font-medium hover:text-primary">
            {n.title}
          </Link>
          <div className="mt-auto flex items-end justify-between gap-2">
            <div>
              <p className="font-display text-lg font-bold">{formatMoney(price.amount, price.currencyCode)}</p>
              {off > 0 && compareAt && (
                <p className="text-xs text-muted-foreground line-through">{formatMoney(compareAt, price.currencyCode)}</p>
              )}
            </div>
            <button
              onClick={quickAdd}
              disabled={soldOut || isLoading}
              aria-label={singleVariant ? "Add to bag" : "Choose options"}
              className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingBag className="h-4 w-4" />}
            </button>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            {lowStock && !soldOut && <span className="font-semibold text-signal">Low stock</span>}
            {n.productType && <span className="truncate">{n.productType}</span>}
            <span className="ml-auto inline-flex items-center gap-1">
              <Star className="h-3 w-3" /> No reviews yet
            </span>
          </div>
        </div>
      </article>

      <QuickActionsSheet product={product} open={quickOpen} onOpenChange={setQuickOpen} />
    </>
  );
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="vs-card overflow-hidden">
          <div className="aspect-square animate-pulse bg-muted" />
          <div className="space-y-2 p-4">
            <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-5 w-1/3 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyProducts({ message = "No products found" }: { message?: string }) {
  return (
    <div className="vs-card flex flex-col items-center gap-2 px-6 py-16 text-center">
      <ShoppingBag className="h-8 w-8 text-muted-foreground" />
      <p className="font-display text-lg font-semibold">{message}</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Your catalog is empty. Tell the chat what product you want and at what price, and it will be created in Shopify.
      </p>
    </div>
  );
}
