import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Heart, Loader2, Minus, Plus, RotateCcw, ShieldCheck, Truck } from "lucide-react";
import { toast } from "sonner";
import { discountPercent, fetchProduct, formatMoney } from "@/lib/shopify";
import { useCartStore } from "@/stores/cartStore";
import { useRecentStore, useWishlistStore } from "@/stores/wishlistStore";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/products/$handle")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.handle.replace(/-/g, " ")} — VS Store` },
      { name: "description", content: `Buy ${params.handle.replace(/-/g, " ")} at VS Store with secure checkout and tracked delivery.` },
      { property: "og:title", content: `${params.handle.replace(/-/g, " ")} — VS Store` },
      { property: "og:description", content: "Secure checkout and tracked delivery from VS Store." },
    ],
  }),
  component: ProductPage,
});

function ProductPage() {
  const { handle } = Route.useParams();
  const { data: product, isLoading, isError } = useQuery({
    queryKey: ["product", handle],
    queryFn: () => fetchProduct(handle),
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [imageIndex, setImageIndex] = useState(0);
  const addItem = useCartStore((s) => s.addItem);
  const isAdding = useCartStore((s) => s.isLoading);
  const toggleWishlist = useWishlistStore((s) => s.toggle);
  const wishlisted = useWishlistStore((s) => s.items.some((i) => i.node.handle === handle));
  const pushRecent = useRecentStore((s) => s.push);

  useEffect(() => {
    if (product) {
      pushRecent(product.handle);
      const variants = product.variants.edges.map((e) => e.node);
      const preferred = variants.find((v) => v.availableForSale) ?? variants[0];
      setSelectedId((current) =>
        current && variants.some((v) => v.id === current) ? current : (preferred?.id ?? null),
      );
    }
  }, [product, pushRecent]);


  if (isLoading) {
    return (
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 md:grid-cols-2">
        <div className="aspect-square animate-pulse rounded-3xl bg-muted" />
        <div className="space-y-4">
          <div className="h-8 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-6 w-1/3 animate-pulse rounded bg-muted" />
          <div className="h-24 animate-pulse rounded bg-muted" />
        </div>
      </div>
    );
  }

  if (isError || !product) {
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="font-display text-2xl font-bold">Product unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">This item may have been removed from the catalog.</p>
        <Link to="/shop" className="mt-4 inline-block text-sm font-semibold text-primary hover:underline">
          Browse all products →
        </Link>
      </div>
    );
  }

  const images = product.images.edges.map((e) => e.node);
  const variants = product.variants.edges.map((e) => e.node);
  const selected = variants.find((v) => v.id === selectedId) ?? null;
  const price = selected?.price ?? product.priceRange.minVariantPrice;
  const compareAt = selected?.compareAtPrice?.amount ?? null;
  const off = discountPercent(price.amount, compareAt);

  const handleAdd = async () => {
    if (!selected) {
      toast.error("Select an option first", { position: "top-center" });
      return;
    }
    await addItem({
      product: { node: product },
      variantId: selected.id,
      variantTitle: selected.title,
      price: selected.price,
      quantity,
      selectedOptions: selected.selectedOptions ?? [],
    });
    toast.success("Added to bag", { description: product.title, position: "top-center" });
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="grid gap-10 md:grid-cols-2">
        <div className="space-y-3">
          <div className="aspect-square overflow-hidden rounded-3xl border border-border bg-secondary">
            {images[imageIndex] ? (
              <img src={images[imageIndex]!.url} alt={images[imageIndex]!.altText ?? product.title} className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full place-items-center text-sm text-muted-foreground">No image</div>
            )}
          </div>
          {images.length > 1 && (
            <div className="flex gap-2 overflow-x-auto">
              {images.map((img, i) => (
                <button
                  key={img.url}
                  onClick={() => setImageIndex(i)}
                  aria-label={`View image ${i + 1}`}
                  className={cn("h-16 w-16 shrink-0 overflow-hidden rounded-xl border", i === imageIndex ? "border-primary" : "border-border")}
                >
                  <img src={img.url} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-5">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">{product.vendor || product.productType}</p>
            <h1 className="mt-1 font-display text-3xl font-bold tracking-tight">{product.title}</h1>
          </div>

          <div className="flex items-baseline gap-3">
            <span className="font-display text-3xl font-bold">{formatMoney(price.amount, price.currencyCode)}</span>
            {off > 0 && compareAt && (
              <>
                <span className="text-muted-foreground line-through">{formatMoney(compareAt, price.currencyCode)}</span>
                <span className="rounded-full bg-signal px-2.5 py-1 text-xs font-bold text-signal-foreground">{off}% off</span>
              </>
            )}
          </div>

          {variants.length > 1 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Select option</p>
              <div className="flex flex-wrap gap-2">
                {variants.map((v) => (
                  <button
                    key={v.id}
                    disabled={!v.availableForSale}
                    onClick={() => setSelectedId(v.id)}
                    className={cn(
                      "rounded-xl border px-4 py-2 text-sm transition-colors",
                      v.id === selectedId ? "border-primary bg-accent text-accent-foreground" : "border-border hover:border-primary",
                      !v.availableForSale && "cursor-not-allowed opacity-40 line-through",
                    )}
                  >
                    {v.title}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 rounded-xl border border-border p-1">
              <button onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="Decrease quantity" className="grid h-8 w-8 place-items-center rounded-lg hover:bg-muted">
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-8 text-center text-sm">{quantity}</span>
              <button onClick={() => setQuantity((q) => q + 1)} aria-label="Increase quantity" className="grid h-8 w-8 place-items-center rounded-lg hover:bg-muted">
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <span className={cn("text-sm", product.availableForSale ? "text-muted-foreground" : "text-signal")}>
              {product.availableForSale ? "In stock" : "Sold out"}
            </span>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={isAdding || !product.availableForSale}
              className="flex-1 rounded-xl bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
            >
              {isAdding ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Add to bag"}
            </button>
            <button
              onClick={() => {
                const added = toggleWishlist({ node: product });
                toast(added ? "Saved to wishlist" : "Removed from wishlist", { position: "top-center" });
              }}
              aria-label="Toggle wishlist"
              className="grid h-13 w-13 place-items-center rounded-xl border border-border px-4 transition-colors hover:border-signal"
            >
              <Heart className={cn("h-4 w-4", wishlisted && "fill-signal text-signal")} />
            </button>
          </div>

          {product.description && <p className="text-sm leading-relaxed text-muted-foreground">{product.description}</p>}

          <div className="grid gap-2 rounded-2xl border border-border bg-card p-4 text-xs text-muted-foreground">
            <p className="flex items-center gap-2"><Truck className="h-3.5 w-3.5" /> Delivery estimate at checkout</p>
            <p className="flex items-center gap-2"><RotateCcw className="h-3.5 w-3.5" /> 30-day returns</p>
            <p className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5" /> Secure Shopify checkout</p>
          </div>

          <section>
            <h2 className="font-display text-lg font-semibold">Reviews</h2>
            <div className="mt-2 rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No reviews yet.
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
