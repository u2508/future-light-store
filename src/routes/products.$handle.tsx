import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Heart, Loader2, Minus, Plus, RotateCcw, ShieldCheck, Truck } from "lucide-react";
import { toast } from "sonner";
import { discountPercent, fetchProduct, fetchProductInventory, formatMoney } from "@/lib/shopify";
import { requestCartOpen, useCartStore } from "@/stores/cartStore";
import { useRecentStore, useWishlistStore } from "@/stores/wishlistStore";
import { cn } from "@/lib/utils";
import { canonicalUrl } from "@/lib/seo";
import { normalizeMetaCatalogId, trackViewItem } from "@/lib/marketingAnalytics";
import { US_SHIPPING_PROMISE } from "@/lib/shipping-promise";
import { displayBrandName } from "@/lib/brand";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { JudgeMeReviews } from "@/components/vs/JudgeMeReviews";
import { ProductVariantOptions } from "@/components/vs/ProductVariantOptions";
import {
  getProductGalleryImages,
  getVariantImage,
  selectGalleryImageForDisplay,
  selectVariantGalleryIndex,
} from "@/lib/product-variant-image.mjs";
import {
  chooseProductVariantId,
  hasImageBearingOption,
  isVerifiedVariantImage,
} from "@/lib/product-variant-selection.mjs";

const PRODUCT_DESCRIPTION_TAGS = new Set(["h2", "h3", "p", "ul", "ol", "li", "strong", "em", "br"]);

function sanitizeProductDescriptionHtml(value: string) {
  return String(value || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(
      /<\s*(script|style|iframe|object|embed|form|svg|math)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi,
      "",
    )
    .replace(/<[^>]*>/g, (tag) => {
      const tagName = tag.match(/^<\s*\/?\s*([a-z0-9]+)/i)?.[1]?.toLowerCase();
      if (!tagName || !PRODUCT_DESCRIPTION_TAGS.has(tagName)) return "";
      if (/^<\s*\//.test(tag)) return `</${tagName}>`;
      return tagName === "br" ? "<br>" : `<${tagName}>`;
    });
}

function ProductDescription({
  description,
  descriptionHtml,
}: {
  description: string;
  descriptionHtml?: string | undefined;
}) {
  const structuredDescription = sanitizeProductDescriptionHtml(descriptionHtml || "");

  return (
    <section
      aria-label="Product description"
      className="rounded-[2rem] border border-border bg-card p-5 shadow-[var(--shadow-card)] sm:p-6"
    >
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

function ProductInformationTabs({
  product,
}: {
  product: { id: string; title: string; description: string; descriptionHtml?: string | undefined };
}) {
  const [tabSelection, setTabSelection] = useState({ productId: product.id, value: "details" });
  const activeTab = tabSelection.productId === product.id ? tabSelection.value : "details";

  return (
    <Tabs
      key={product.id}
      value={activeTab}
      onValueChange={(value) => setTabSelection({ productId: product.id, value })}
      className="w-full"
    >
      <TabsList className="grid h-auto w-full grid-cols-2 rounded-xl border border-border bg-muted/70 p-1">
        <TabsTrigger value="details" className="min-h-10 rounded-lg">
          Details
        </TabsTrigger>
        <TabsTrigger value="reviews" className="min-h-10 rounded-lg">
          Reviews
        </TabsTrigger>
      </TabsList>
      <TabsContent value="details">
        {product.description ? (
          <ProductDescription
            description={product.description}
            descriptionHtml={product.descriptionHtml}
          />
        ) : (
          <section className="rounded-[2rem] border border-border bg-card p-5 text-sm leading-7 text-muted-foreground shadow-[var(--shadow-card)] sm:p-6">
            Product details are not available yet.
          </section>
        )}
      </TabsContent>
      <TabsContent value="reviews" forceMount>
        <JudgeMeReviews
          active={activeTab === "reviews"}
          productId={product.id}
          productTitle={product.title}
        />
      </TabsContent>
    </Tabs>
  );
}

export const Route = createFileRoute("/products/$handle")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.handle.replace(/-/g, " ")} — VS Associates` },
      {
        name: "description",
        content: `Buy ${params.handle.replace(/-/g, " ")} at VS Associates with secure checkout and tracked delivery.`,
      },
      { property: "og:title", content: `${params.handle.replace(/-/g, " ")} — VS Associates` },
      {
        property: "og:description",
        content: "Secure checkout and tracked delivery from VS Associates.",
      },
      { property: "og:type", content: "product" },
      { property: "og:url", content: canonicalUrl(`/products/${params.handle}`) },
    ],
    links: [{ rel: "canonical", href: canonicalUrl(`/products/${params.handle}`) }],
  }),
  component: ProductPage,
});

function ProductPage() {
  const { handle } = Route.useParams();
  const requestedVariant =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("variant");
  const {
    data: product,
    isLoading,
    isError,
    refetch: refetchProduct,
  } = useQuery({
    queryKey: ["product", handle],
    queryFn: () => fetchProduct(handle),
    staleTime: 0,
    refetchInterval: 60 * 1000,
    retry: 1,
    // Keep a successfully loaded live product visible while a background
    // revalidation is in flight. A focus event must never blank the PDP.
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });
  const { data: productInventory } = useQuery({
    queryKey: ["product-inventory", handle],
    queryFn: () => fetchProductInventory(handle),
    enabled: Boolean(product),
    staleTime: 0,
    retry: false,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hasSelectedVariant, setHasSelectedVariant] = useState(false);
  const [unavailableVariantIds, setUnavailableVariantIds] = useState<Set<string>>(new Set());
  const [quantity, setQuantity] = useState(1);
  const [imageIndex, setImageIndex] = useState(0);
  const [failedImageUrls, setFailedImageUrls] = useState<Set<string>>(new Set());
  const [manualGallerySelection, setManualGallerySelection] = useState(false);
  const lastImageSelectionId = useRef<string | null>(null);
  const selectionRouteKey = `${handle}:${requestedVariant ?? ""}`;
  const selectionRouteKeyRef = useRef(selectionRouteKey);
  const userSelectedVariant = useRef(false);
  const addItem = useCartStore((s) => s.addItem);
  const isAdding = useCartStore((s) => s.isLoading);
  const toggleWishlist = useWishlistStore((s) => s.toggle);
  const wishlisted = useWishlistStore((s) => s.items.some((i) => i.node.handle === handle));
  const pushRecent = useRecentStore((s) => s.push);
  const trackedProductView = useRef<string>("");

  useEffect(() => {
    if (selectionRouteKeyRef.current !== selectionRouteKey) {
      selectionRouteKeyRef.current = selectionRouteKey;
      userSelectedVariant.current = false;
      setSelectedId(null);
      setHasSelectedVariant(false);
    }
  }, [selectionRouteKey]);

  useEffect(() => {
    setUnavailableVariantIds(new Set());
    setHasSelectedVariant(false);
    setFailedImageUrls(new Set());
    setManualGallerySelection(false);
    lastImageSelectionId.current = null;
  }, [handle]);

  useEffect(() => {
    if (product) {
      pushRecent(product.handle);
      const variants = product.variants.edges.map((e) => e.node);
      // Product feeds append a variant ID to the landing URL. Always honor it
      // on entry, even if a cached/default selection is already valid. Once a
      // shopper picks an option, keep that choice through background refreshes.
      setSelectedId((current) =>
        chooseProductVariantId({
          variants,
          requestedVariant,
          currentId: current,
          userSelected: userSelectedVariant.current,
        }),
      );
    }
  }, [product, pushRecent, requestedVariant]);

  useEffect(() => {
    if (lastImageSelectionId.current !== selectedId) {
      lastImageSelectionId.current = selectedId;
      setManualGallerySelection(false);
    }
    if (!product || !selectedId || manualGallerySelection) return;
    const selectedVariant = product.variants.edges
      .map((edge) => edge.node)
      .find((variant) => variant.id === selectedId);
    const variantImageUrl = getVariantImage(selectedVariant)?.url;
    const galleryUrls = getProductGalleryImages(
      product,
      product.variants.edges.map((edge) => edge.node),
    ).map((image) => image.url);
    // Never leave the previous variant's photo selected when the newly
    // selected option has no exact mapped image. Use this product's primary
    // image as a neutral fallback instead of implying a wrong variant match.
    setImageIndex(selectVariantGalleryIndex(galleryUrls, variantImageUrl));
  }, [product, selectedId, manualGallerySelection]);

  useEffect(() => {
    if (!product || typeof document === "undefined") return;
    const pageTitle = product.seo?.title?.trim() || `${product.title} | VS Associates`;
    const pageDescription = (product.seo?.description || String(product.description || ""))
      .replace(/<[^>]*>/g, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 158)
      .replace(/\s+\S*$/, "")
      .trim();
    document.title = pageTitle;
    const upsertMeta = (
      selector: string,
      attribute: "name" | "property",
      key: string,
      content: string,
    ) => {
      if (!content) return;
      const matches = Array.from(document.head.querySelectorAll<HTMLMetaElement>(selector));
      let element = matches.shift();
      if (!element) {
        element = document.createElement("meta");
        element.setAttribute(attribute, key);
        document.head.appendChild(element);
      }
      element.content = content;
      matches.forEach((duplicate) => duplicate.remove());
    };
    upsertMeta('meta[name="description"]', "name", "description", pageDescription);
    upsertMeta('meta[property="og:title"]', "property", "og:title", pageTitle);
    upsertMeta('meta[property="og:description"]', "property", "og:description", pageDescription);
  }, [product]);

  useEffect(() => {
    if (!product || !selectedId || trackedProductView.current === product.id) return;
    const selectedVariant = product.variants.edges
      .map((edge) => edge.node)
      .find((variant) => variant.id === selectedId);
    if (!selectedVariant) return;

    trackViewItem({
      item_id: normalizeMetaCatalogId(selectedVariant.id),
      item_name: product.title,
      price: Number(selectedVariant.price.amount),
      item_variant: selectedVariant.title,
      item_brand: product.vendor || undefined,
      item_category: product.productType || undefined,
    });
    trackedProductView.current = product.id;
  }, [product, selectedId]);

  if (isLoading && !product) {
    return (
      <div className="vs-wide-shell grid gap-8 py-10 md:grid-cols-2">
        <div className="aspect-square animate-pulse rounded-3xl bg-muted" />
        <div className="space-y-4">
          <div className="h-8 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-6 w-1/3 animate-pulse rounded bg-muted" />
          <div className="h-24 animate-pulse rounded bg-muted" />
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="font-display text-2xl font-bold">
          {isError ? "This product didn’t load" : "Product unavailable"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isError
            ? "A temporary connection issue may have interrupted this page. Try again, or browse products while we reconnect."
            : "This item may have been removed from the catalog."}
        </p>
        {isError && (
          <button
            type="button"
            onClick={() => void refetchProduct()}
            className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
        )}
        <Link
          to="/shop"
          className="mt-4 inline-block text-sm font-semibold text-primary hover:underline"
        >
          Browse all products →
        </Link>
      </div>
    );
  }

  const inventoryById = new Map(
    (productInventory?.variants?.edges ?? []).map((edge) => [edge.node.id, edge.node]),
  );
  const variants = product.variants.edges.map((e) => {
    const inventoryVariant = inventoryById.get(e.node.id);
    return inventoryVariant ? { ...e.node, ...inventoryVariant } : e.node;
  });
  const images = getProductGalleryImages(product, variants);
  const visibleImages = images
    .map((image, originalIndex) => ({ image, originalIndex }))
    .filter(({ image }) => !failedImageUrls.has(image.url));
  const selected = variants.find((v) => v.id === selectedId) ?? null;
  const exactImageRequired = hasImageBearingOption(product.options);
  const selectedImageVerified = isVerifiedVariantImage(selected);
  const needsImageMappingReview = exactImageRequired && !selectedImageVerified;
  const activeImage = selectGalleryImageForDisplay(
    images,
    exactImageRequired && needsImageMappingReview && !manualGallerySelection ? 0 : imageIndex,
    failedImageUrls,
  );
  const selectedAvailable =
    Boolean(selected?.availableForSale) && !unavailableVariantIds.has(selected?.id ?? "");
  const selectedLowStock =
    hasSelectedVariant &&
    selectedAvailable &&
    selected?.quantityAvailable != null &&
    selected.quantityAvailable > 0 &&
    selected.quantityAvailable <= 5;
  const price = selected?.price ?? product.priceRange.minVariantPrice;
  const compareAt = selected?.compareAtPrice?.amount ?? null;
  const off = discountPercent(price.amount, compareAt);
  const productSummary = (product.description ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const handleAdd = async () => {
    if (!selected) {
      toast.error("Select an option first", { position: "top-center" });
      return;
    }
    if (!selectedAvailable) {
      toast.error("This option is sold out", { position: "top-center" });
      return;
    }
    const addResult = await addItem({
      product: { node: product },
      variantId: selected.id,
      variantTitle: selected.title,
      variantImageUrl: selectedImageVerified ? (getVariantImage(selected)?.url ?? null) : null,
      variantImageAlt: selectedImageVerified ? (getVariantImage(selected)?.altText ?? null) : null,
      price: selected.price,
      quantity,
      selectedOptions: selected.selectedOptions ?? [],
    });
    if (addResult.success) {
      toast.success("Added to bag", { description: product.title, position: "top-center" });
      requestCartOpen();
    } else {
      if (addResult.unavailable) {
        setUnavailableVariantIds((current) => new Set(current).add(selected.id));
      }
      const refreshed = await refetchProduct();
      const refreshedSelected = refreshed.data?.variants.edges
        .map((edge) => edge.node)
        .find((variant) => variant.id === selected.id);
      const soldOutDuringAdd =
        addResult.unavailable || refreshedSelected?.availableForSale === false;
      toast.error("Couldn’t add this item", {
        description: soldOutDuringAdd
          ? "This option just sold out. Choose another option."
          : addResult.message,
        position: "top-center",
      });
    }
  };

  const productJsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Product",
        name: product.title,
        description: product.description ?? undefined,
        image: images.map((i) => i.url),
          brand: product.vendor
            ? { "@type": "Brand", name: displayBrandName(product.vendor) }
            : undefined,
        sku: selected?.id,
        url: canonicalUrl(`/products/${handle}`),
        offers: {
          "@type": "Offer",
          price: price.amount,
          priceCurrency: price.currencyCode,
          availability: selectedAvailable
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
          {
            "@type": "ListItem",
            position: 3,
            name: product.title,
            item: canonicalUrl(`/products/${handle}`),
          },
        ],
      },
    ],
  };

  return (
    <div className="vs-wide-shell py-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
      />
      <nav
        aria-label="Breadcrumb"
        className="mb-5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
      >
        <Link to="/" className="transition-colors hover:text-primary">
          Home
        </Link>
        <span aria-hidden="true">/</span>
        <Link to="/shop" className="transition-colors hover:text-primary">
          Shop all
        </Link>
        <span aria-hidden="true">/</span>
        <span className="max-w-[18rem] truncate text-foreground">{product.title}</span>
      </nav>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:items-start">
        <div className="min-w-0 space-y-3 lg:sticky lg:top-24">
          <div className="relative aspect-square overflow-hidden rounded-[2rem] border border-border/70 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.92),rgba(241,245,249,0.98))] shadow-[var(--shadow-lift)]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(59,130,246,0.14),transparent_32%),radial-gradient(circle_at_80%_80%,rgba(14,165,233,0.12),transparent_28%)]" />
            {activeImage ? (
              <>
                <img
                  src={activeImage.url}
                  alt={activeImage.altText ?? product.title}
                  fetchPriority="high"
                  className="h-full w-full object-cover"
                  onError={() =>
                    setFailedImageUrls((current) => new Set(current).add(activeImage.url))
                  }
                />
                {needsImageMappingReview && !manualGallerySelection && (
                  <p
                    role="status"
                    className="absolute inset-x-3 bottom-3 rounded-xl bg-amber-50/95 px-3 py-2 text-center text-xs font-medium leading-5 text-amber-950 shadow-sm"
                  >
                  Product gallery preview — the selected option’s exact photo is not confirmed yet.
                  </p>
                )}
              </>
            ) : (
              <div className="grid h-full place-items-center p-10 text-center">
                <div className="max-w-xs space-y-2">
                  <div className="mx-auto h-14 w-14 rounded-2xl bg-primary/10" />
                  <p className="font-display text-lg font-semibold">
                    {needsImageMappingReview && !manualGallerySelection
                      ? "Photo match being verified"
                      : "Visual coming soon"}
                  </p>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {needsImageMappingReview && !manualGallerySelection
                      ? "We won’t present an unconfirmed design as the selected option. Browse the product photos below while we verify the exact match."
                      : "Product media is unavailable for this item, so the page now stays visually anchored with a premium placeholder."}
                  </p>
                </div>
              </div>
            )}
          </div>
          {visibleImages.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {visibleImages.map(({ image: img, originalIndex }) => (
                <button
                  type="button"
                  key={img.url}
                  onClick={() => {
                    setManualGallerySelection(true);
                    setImageIndex(originalIndex);
                  }}
                  aria-label={`View image ${originalIndex + 1}`}
                  className={cn(
                    "h-16 w-16 shrink-0 overflow-hidden rounded-xl border bg-card shadow-sm",
                    originalIndex === imageIndex
                      ? "border-primary ring-2 ring-primary/15"
                      : "border-border",
                  )}
                >
                  <img
                    src={img.url}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                    onError={() => setFailedImageUrls((current) => new Set(current).add(img.url))}
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="min-w-0 space-y-5 lg:pt-3">
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
              {displayBrandName(product.vendor || product.productType)}
            </p>
            <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
              {product.title}
            </h1>
            <p className="max-w-2xl text-sm leading-7 text-muted-foreground">
              {productSummary
                ? `${productSummary.slice(0, 220)}${productSummary.length > 220 ? "…" : ""}`
                : "A considered everyday upgrade, ready for a secure checkout."}
            </p>
            <div className="flex flex-wrap gap-2 text-xs font-semibold">
              <span className="rounded-full border border-border bg-card px-3 py-1.5 text-muted-foreground">
                {selectedAvailable ? "In stock" : "Currently unavailable"}
              </span>
              {product.productType && (
                <span className="rounded-full border border-border bg-card px-3 py-1.5 text-muted-foreground">
                  {product.productType}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-baseline gap-3 rounded-[1.5rem] border border-border bg-card px-4 py-3 shadow-[var(--shadow-card)]">
            <span className="font-display text-3xl font-bold">
              {formatMoney(price.amount, price.currencyCode)}
            </span>
            {off > 0 && compareAt && (
              <>
                <span className="text-muted-foreground line-through">
                  {formatMoney(compareAt, price.currencyCode)}
                </span>
                <span className="rounded-full bg-signal px-2.5 py-1 text-xs font-bold text-signal-foreground">
                  {off}% off
                </span>
              </>
            )}
          </div>

          {variants.length > 1 && (
            <div className="space-y-3">
              <ProductVariantOptions
                options={product.options}
                variants={variants}
                selectedVariantId={selectedId}
                unavailableVariantIds={unavailableVariantIds}
                productTitle={product.title}
                onSelect={(variant) => {
                  userSelectedVariant.current = true;
                  setManualGallerySelection(false);
                  setSelectedId(variant.id);
                  setHasSelectedVariant(true);
                  setImageIndex(
                    selectVariantGalleryIndex(
                      images.map((image) => image.url),
                      getVariantImage(variant)?.url,
                    ),
                  );
                }}
              />
              {needsImageMappingReview && (
                <p
                  role="status"
                  className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950"
                >
                  The photo match for this design or color is not confirmed yet. You can still add
                  the selected option; please compare the gallery photos before ordering.
                </p>
              )}
            </div>
          )}

          <div className="flex items-center gap-3 rounded-[1.5rem] border border-border bg-card px-4 py-3 shadow-[var(--shadow-card)]">
            <div className="flex items-center gap-1 rounded-xl border border-border/70 bg-background p-1">
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                aria-label="Decrease quantity"
                className="grid h-8 w-8 place-items-center rounded-lg hover:bg-muted"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-8 text-center text-sm">{quantity}</span>
              <button
                type="button"
                onClick={() => setQuantity((q) => q + 1)}
                aria-label="Increase quantity"
                className="grid h-8 w-8 place-items-center rounded-lg hover:bg-muted"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <span
              className={cn("text-sm", selectedAvailable ? "text-muted-foreground" : "text-signal")}
            >
              {selectedAvailable ? "In stock" : "Sold out"}
            </span>
            {selectedLowStock && (
              <span className="text-sm font-semibold text-signal">Low stock</span>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleAdd}
              disabled={isAdding || !selectedAvailable}
              className="flex-1 rounded-xl bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
            >
              {isAdding ? (
                <Loader2 className="mx-auto h-4 w-4 animate-spin" />
              ) : selectedAvailable ? (
                "Add to cart"
              ) : (
                "Sold out"
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                const added = toggleWishlist({ node: product });
                toast(added ? "Saved to wishlist" : "Removed from wishlist", {
                  position: "top-center",
                });
              }}
              aria-label="Toggle wishlist"
              className="grid h-13 w-13 place-items-center rounded-xl border border-border px-4 transition-colors hover:border-signal"
            >
              <Heart className={cn("h-4 w-4", wishlisted && "fill-signal text-signal")} />
            </button>
          </div>

          <div className="grid gap-2 rounded-[1.5rem] border border-border bg-card p-4 text-xs text-muted-foreground shadow-[var(--shadow-card)]">
            <p className="flex items-center gap-2">
              <Truck className="h-3.5 w-3.5" /> {US_SHIPPING_PROMISE.summary}
            </p>
            <p className="pl-5 text-[11px] leading-5">
              Shopify confirms the eligible delivery option, taxes and any address-specific
              exceptions at checkout.
            </p>
            <p className="flex items-center gap-2">
              <RotateCcw className="h-3.5 w-3.5" /> 30-day returns
            </p>
            <p className="flex items-center gap-2">
              <ShieldCheck className="h-3.5 w-3.5" /> Secure Shopify checkout
            </p>
          </div>

          <ProductInformationTabs product={product} />

          <section className="rounded-[1.5rem] border border-border bg-card p-4 shadow-[var(--shadow-card)]">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              Need a hand?
            </p>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Questions about delivery, returns or checkout?
              </p>
              <Link
                to="/help"
                className="shrink-0 text-sm font-semibold text-primary hover:underline"
              >
                Visit help centre →
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
