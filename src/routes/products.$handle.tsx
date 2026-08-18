import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Heart, Loader2, Minus, Plus, RotateCcw, ShieldCheck, Truck } from "lucide-react";
import { toast } from "sonner";
import { discountPercent, fetchProduct, formatMoney } from "@/lib/shopify";
import { useCartStore } from "@/stores/cartStore";
import { useRecentStore, useWishlistStore } from "@/stores/wishlistStore";
import { cn } from "@/lib/utils";
import { canonicalUrl } from "@/lib/seo";

const PRODUCT_DESCRIPTION_TAGS = new Set(["h2", "h3", "p", "ul", "ol", "li", "strong", "em", "br"]);

function sanitizeProductDescriptionHtml(value: string) {
  return String(value || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\s*(script|style|iframe|object|embed|form|svg|math)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, "")
    .replace(/<[^>]*>/g, (tag) => {
      const tagName = tag.match(/^<\s*\/?\s*([a-z0-9]+)/i)?.[1]?.toLowerCase();
      if (!tagName || !PRODUCT_DESCRIPTION_TAGS.has(tagName)) return "";
      if (/^<\s*\//.test(tag)) return `</${tagName}>`;
      return tagName === "br" ? "<br>" : `<${tagName}>`;
    });
}

function ProductDescription({ description, descriptionHtml }: { description: string; descriptionHtml?: string }) {
  const structuredDescription = sanitizeProductDescriptionHtml(descriptionHtml || "");

  return (
    <section aria-label="Product description" className="rounded-3xl border border-border bg-card p-5 sm:p-6">
      {structuredDescription ? (
        <div
          className={cn(
            "space-y-4 text-sm leading-7 text-muted-foreground",
            "[&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground",
            "[&_h3]:mt-7 [&_h3]:border-t [&_h3]:border-border [&_h3]:pt-5 [&_h3]:font-display [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:uppercase [&_h3]:tracking-[0.14em] [&_h3]:text-foreground",
            "[&_p]:m-0 [&_p+_p]:mt-2 [&_strong]:font-semibold [&_strong]:text-foreground",
            "[&_ul]:my-0 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_ol]:my-0 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5 [&_li]:pl-1",
          )}
          dangerouslySetInnerHTML={{ __html: structuredDescription }}
        />
      ) : (
        <p className="whitespace-pre-line text-sm leading-7 text-muted-foreground">{description}</p>
      )}
    </section>
  );
}

export const Route = createFileRoute("/products/$handle")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.handle.replace(/-/g, " ")} — VS Store` },
      { name: "description", content: `Buy ${params.handle.replace(/-/g, " ")} at VS Store with secure checkout and tracked delivery.` },
      { property: "og:title", content: `${params.handle.replace(/-/g, " ")} — VS Store` },
      { property: "og:description", content: "Secure checkout and tracked delivery from VS Store." },
      { property: "og:type", content: "product" },
      { property: "og:url", content: canonicalUrl(`/products/${params.handle}`) },
    ],
    links: [{ rel: "canonical", href: canonicalUrl(`/products/${params.handle}`) }],
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

  const productJsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Product",
        name: product.title,
        description: product.description ?? undefined,
        image: images.map((i) => i.url),
        brand: product.vendor ? { "@type": "Brand", name: product.vendor } : undefined,
        sku: selected?.id,
        url: canonicalUrl(`/products/${handle}`),
        offers: {
          "@type": "Offer",
          price: price.amount,
          priceCurrency: price.currencyCode,
          availability: selected?.availableForSale
            ? "https://schema.org/InStock"
            : "https://schema.org/OutOfStock",
          url: canonicalUrl(`/products/${handle}`),
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: canonicalUrl("/") },
          { "@type": "ListItem", position: 2, name: "Shop all", item: canonicalUrl("/shop") },
          { "@type": "ListItem", position: 3, name: product.title, item: canonicalUrl(`/products/${handle}`) },
        ],
      },
    ],
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 lg:px-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }} />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:items-start">
        <div className="space-y-3 lg:sticky lg:top-24">
          <div className="relative aspect-square overflow-hidden rounded-[2rem] border border-border/70 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.92),rgba(241,245,249,0.98))] shadow-[var(--shadow-lift)]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(59,130,246,0.14),transparent_32%),radial-gradient(circle_at_80%_80%,rgba(14,165,233,0.12),transparent_28%)]" />
            {images[imageIndex] ? (
              <img src={images[imageIndex]!.url} alt={images[imageIndex]!.altText ?? product.title} className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full place-items-center p-10 text-center">
                <div className="max-w-xs space-y-2">
                  <div className="mx-auto h-14 w-14 rounded-2xl bg-primary/10" />
                  <p className="font-display text-lg font-semibold">Visual coming soon</p>
                  <p className="text-sm leading-6 text-muted-foreground">
                    Product media is unavailable for this item, so the page now stays visually anchored with a premium placeholder.
                  </p>
                </div>
              </div>
            )}
          </div>
          {images.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {images.map((img, i) => (
                <button
                  key={img.url}
                  onClick={() => setImageIndex(i)}
                  aria-label={`View image ${i + 1}`}
                  className={cn(
                    "h-16 w-16 shrink-0 overflow-hidden rounded-xl border bg-card shadow-sm",
                    i === imageIndex ? "border-primary ring-2 ring-primary/15" : "border-border",
                  )}
                >
                  <img src={img.url} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-5 lg:pt-3">
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">{product.vendor || product.productType}</p>
            <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{product.title}</h1>
            <p className="max-w-2xl text-sm leading-7 text-muted-foreground">
              A refined product layout with better balance, so the content reads more like a premium storefront and less like a blank split screen.
            </p>
          </div>

          <div className="flex items-baseline gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-[var(--shadow-card)]">
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

          <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-[var(--shadow-card)]">
            <div className="flex items-center gap-1 rounded-xl border border-border/70 bg-background p-1">
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

          {product.description && (
            <ProductDescription description={product.description} descriptionHtml={product.descriptionHtml} />
          )}

          <div className="grid gap-2 rounded-2xl border border-border bg-card p-4 text-xs text-muted-foreground shadow-[var(--shadow-card)]">
            <p className="flex items-center gap-2"><Truck className="h-3.5 w-3.5" /> Delivery estimate at checkout</p>
            <p className="flex items-center gap-2"><RotateCcw className="h-3.5 w-3.5" /> 30-day returns</p>
            <p className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5" /> Secure Shopify checkout</p>
          </div>

          <section>
            <h2 className="font-display text-lg font-semibold">Reviews</h2>
            <div className="mt-2 rounded-2xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
              No reviews yet.
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
