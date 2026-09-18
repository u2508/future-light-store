import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Heart, Loader2, Minus, Plus, Ruler, ShieldCheck, Truck } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { discountPercent, fetchProduct, formatMoney, type ShopifyProduct } from "@/lib/shopify";
import { requestCartOpen, useCartStore } from "@/stores/cartStore";
import { useWishlistStore } from "@/stores/wishlistStore";
import { cn } from "@/lib/utils";

export function QuickActionsSheet({
  product,
  open,
  onOpenChange,
}: {
  product: ShopifyProduct;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const n = product.node;
  const variantCount = n.variantsCount?.count ?? n.variants.edges.length;
  const needsFullProduct = variantCount > n.variants.edges.length;
  const {
    data: fullProduct,
    isError: fullProductError,
    isLoading: fullProductLoading,
  } = useQuery({
    queryKey: ["product", n.handle, "quick-actions"],
    queryFn: () => fetchProduct(n.handle),
    enabled: open && needsFullProduct,
    staleTime: 5 * 60 * 1000,
  });
  const activeProduct = fullProduct ? { node: fullProduct } : product;
  const activeNode = activeProduct.node;
  const variants = useMemo(() => activeNode.variants.edges.map((e) => e.node), [activeNode]);
  const defaultVariantId =
    variants.find((variant) => variant.availableForSale)?.id ?? variants[0]?.id ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(defaultVariantId);
  const [hasSelectedVariant, setHasSelectedVariant] = useState(false);
  const [unavailableVariantIds, setUnavailableVariantIds] = useState<Set<string>>(new Set());
  const [quantity, setQuantity] = useState(1);
  const [imageIndex, setImageIndex] = useState(0);
  const addItem = useCartStore((s) => s.addItem);
  const isLoading = useCartStore((s) => s.isLoading);
  const wishlisted = useWishlistStore((s) => s.items.some((i) => i.node.handle === n.handle));
  const toggleWishlist = useWishlistStore((s) => s.toggle);

  useEffect(() => {
    if (open) {
      setQuantity(1);
      setImageIndex(0);
      setHasSelectedVariant(false);
      setUnavailableVariantIds(new Set());
    }
  }, [open, n.handle]);

  useEffect(() => {
    if (open) setSelectedId(defaultVariantId);
  }, [open, defaultVariantId]);

  const images = activeNode.images.edges.map((e) => e.node);
  const selected = variants.find((v) => v.id === selectedId) ?? null;
  const selectedAvailable =
    Boolean(selected?.availableForSale) && !unavailableVariantIds.has(selected?.id ?? "");
  const selectedLowStock =
    hasSelectedVariant &&
    selectedAvailable &&
    selected?.quantityAvailable != null &&
    selected.quantityAvailable > 0 &&
    selected.quantityAvailable <= 5;
  const price = selected?.price ?? activeNode.priceRange.minVariantPrice;
  const compareAt = selected?.compareAtPrice?.amount ?? null;
  const off = discountPercent(price.amount, compareAt);

  const handleAdd = async () => {
    if (fullProductLoading || fullProductError || (needsFullProduct && !fullProduct)) {
      toast.error("Product options are still loading", { position: "top-center" });
      return;
    }
    if (!selected) {
      toast.error("Select an option first", { position: "top-center" });
      return;
    }
    if (!selectedAvailable) return;
    const addResult = await addItem({
      product: activeProduct,
      variantId: selected.id,
      variantTitle: selected.title,
      price: selected.price,
      quantity,
      selectedOptions: selected.selectedOptions ?? [],
    });
    if (addResult.success) {
      toast.success("Added to bag", {
        description: `${activeNode.title} × ${quantity}`,
        position: "top-center",
      });
      onOpenChange(false);
      requestCartOpen();
    } else {
      if (addResult.unavailable) {
        setUnavailableVariantIds((current) => new Set(current).add(selected.id));
      }
      toast.error("Couldn’t add this item", {
        description: addResult.message,
        position: "top-center",
      });
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[90vh] overflow-y-auto rounded-t-3xl sm:max-w-2xl sm:mx-auto"
      >
        <SheetHeader className="text-left">
          <SheetTitle className="font-display text-xl">{activeNode.title}</SheetTitle>
          <SheetDescription>
            {activeNode.productType || activeNode.vendor || "VS Store"}
          </SheetDescription>
        </SheetHeader>

        <div className="grid gap-6 pt-4 sm:grid-cols-2">
          <div className="space-y-3">
            <div className="aspect-square overflow-hidden rounded-2xl border border-border bg-secondary">
              {images[imageIndex] ? (
                <img
                  src={images[imageIndex]!.url}
                  alt={images[imageIndex]!.altText ?? activeNode.title}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="grid h-full place-items-center text-xs text-muted-foreground">
                  No image
                </div>
              )}
            </div>
            {images.length > 1 && (
              <div className="flex gap-2 overflow-x-auto">
                {images.map((img, i) => (
                  <button
                    key={img.url}
                    onClick={() => setImageIndex(i)}
                    aria-label={`View image ${i + 1}`}
                    className={cn(
                      "h-14 w-14 shrink-0 overflow-hidden rounded-lg border",
                      i === imageIndex ? "border-primary" : "border-border",
                    )}
                  >
                    <img src={img.url} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-2xl font-bold">
                {formatMoney(price.amount, price.currencyCode)}
              </span>
              {off > 0 && compareAt && (
                <>
                  <span className="text-sm text-muted-foreground line-through">
                    {formatMoney(compareAt, price.currencyCode)}
                  </span>
                  <span className="rounded-full bg-signal px-2 py-0.5 text-[11px] font-bold text-signal-foreground">
                    {off}% off
                  </span>
                </>
              )}
            </div>

            {variants.length > 1 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Select option
                  </p>
                  <button className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    <Ruler className="h-3 w-3" /> Size guide
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {variants.map((v) => (
                    <button
                      key={v.id}
                      disabled={!v.availableForSale || unavailableVariantIds.has(v.id)}
                      onClick={() => {
                        setSelectedId(v.id);
                        setHasSelectedVariant(true);
                      }}
                      className={cn(
                        "rounded-xl border px-3 py-2 text-sm transition-colors",
                        v.id === selectedId
                          ? "border-primary bg-accent text-accent-foreground"
                          : "border-border hover:border-primary",
                        (!v.availableForSale || unavailableVariantIds.has(v.id)) &&
                          "cursor-not-allowed opacity-40 line-through",
                      )}
                    >
                      {v.title}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Qty
              </span>
              <div className="flex items-center gap-1 rounded-xl border border-border p-1">
                <button
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  aria-label="Decrease quantity"
                  className="grid h-7 w-7 place-items-center rounded-lg hover:bg-muted"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="w-8 text-center text-sm">{quantity}</span>
                <button
                  onClick={() => setQuantity((q) => q + 1)}
                  aria-label="Increase quantity"
                  className="grid h-7 w-7 place-items-center rounded-lg hover:bg-muted"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className={selectedAvailable ? "text-muted-foreground" : "text-signal"}>
                  {selectedAvailable ? "In stock" : "Sold out"}
                </span>
                {selectedLowStock && <span className="font-semibold text-signal">Low stock</span>}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleAdd}
                disabled={
                  isLoading || fullProductLoading || Boolean(fullProductError) || !selectedAvailable
                }
                className="flex-1 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
              >
                {isLoading ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Add to bag"}
              </button>
              <button
                onClick={() => {
                  const added = toggleWishlist(product);
                  toast(added ? "Saved to wishlist" : "Removed from wishlist", {
                    position: "top-center",
                  });
                }}
                aria-label="Toggle wishlist"
                className="grid h-12 w-12 place-items-center rounded-xl border border-border transition-colors hover:border-signal"
              >
                <Heart className={cn("h-4 w-4", wishlisted && "fill-signal text-signal")} />
              </button>
            </div>

            <div className="space-y-1.5 text-xs text-muted-foreground">
              <p className="flex items-center gap-2">
                <Truck className="h-3.5 w-3.5" /> Delivery estimate shown at checkout
              </p>
              <p className="flex items-center gap-2">
                <ShieldCheck className="h-3.5 w-3.5" /> Secure Shopify checkout
              </p>
            </div>

            <Link
              to="/products/$handle"
              params={{ handle: n.handle }}
              onClick={() => onOpenChange(false)}
              className="inline-block text-sm font-medium text-primary hover:underline"
            >
              View full details →
            </Link>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
