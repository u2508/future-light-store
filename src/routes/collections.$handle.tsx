import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { fetchCollection, type ShopifyProduct } from "@/lib/shopify";
import { ProductCard, ProductGridSkeleton, EmptyProducts } from "@/components/vs/ProductCard";
import { getCollectionEditorial } from "@/lib/collection-seo";
import { canonicalUrl } from "@/lib/seo";
import { CatalogErrorState } from "@/components/vs/CatalogState";
import { collectionArtwork, collectionArtworkSrcSet } from "@/lib/collection-artwork";
import { trackCollectionView } from "@/lib/marketingAnalytics";

function publicCollectionPresentation(
  handle: string,
  title?: string | null,
  description?: string | null,
) {
  if (handle === "best-sellers") {
    return {
      title: "Curated Picks",
      description:
        "A considered mix of everyday upgrades with tracked delivery and clear returns information.",
    };
  }
  return {
    title: title || handle.replace(/-/g, " "),
    description: description || "",
  };
}

export const Route = createFileRoute("/collections/$handle")({
  head: ({ params }) => {
    const presentation = publicCollectionPresentation(params.handle);
    return {
      meta: [
        { title: `${presentation.title} — VS Store` },
        {
          name: "description",
          content: `Shop ${presentation.title} at VS Store.`,
        },
        { property: "og:title", content: `${presentation.title} — VS Store` },
        {
          property: "og:description",
          content: `Shop ${presentation.title} at VS Store.`,
        },
        { property: "og:url", content: canonicalUrl(`/collections/${params.handle}`) },
      ],
      links: [{ rel: "canonical", href: canonicalUrl(`/collections/${params.handle}`) }],
    };
  },
  component: CollectionPage,
});

function CollectionPage() {
  const { handle } = Route.useParams();
  const [additionalProducts, setAdditionalProducts] = useState<ShopifyProduct[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["collection", handle],
    queryFn: () => fetchCollection(handle, 24),
    staleTime: 0,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  useEffect(() => {
    setAdditionalProducts([]);
    setNextCursor(null);
    setLoadMoreError(null);
  }, [handle]);
  useEffect(() => {
    if (!data) return;
    setNextCursor(data.nextCursor ?? null);
  }, [data]);
  const artwork = collectionArtwork(handle, data?.image?.url);
  const presentation = publicCollectionPresentation(handle, data?.title, data?.description);
  const collectionId = data?.id;
  const collectionTitle = presentation.title;
  const products = [...(data?.products ?? []), ...additionalProducts];
  const collectionItemCount = data?.products.length;

  useEffect(() => {
    if (!collectionId || !collectionTitle || collectionItemCount === undefined) return;
    trackCollectionView({
      id: collectionId,
      name: collectionTitle,
      itemCount: collectionItemCount,
    });
  }, [collectionId, collectionTitle, collectionItemCount]);

  const loadMore = async () => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    setLoadMoreError(null);
    try {
      const nextPage = await fetchCollection(handle, 24, nextCursor);
      if (!nextPage) throw new Error("Collection page unavailable");
      setAdditionalProducts((current) => [...current, ...nextPage.products]);
      setNextCursor(nextPage.nextCursor ?? null);
    } catch (error) {
      setLoadMoreError(error instanceof Error ? error.message : "Couldn’t load more products.");
    } finally {
      setIsLoadingMore(false);
    }
  };

  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: presentation.title,
    description: presentation.description || undefined,
    url: canonicalUrl(`/collections/${handle}`),
    mainEntity: {
      "@type": "ItemList",
      itemListElement: products.map((p, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: canonicalUrl(`/products/${p.node.handle}`),
        name: p.node.title,
      })),
    },
    breadcrumb: {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: canonicalUrl("/") },
        {
          "@type": "ListItem",
          position: 2,
          name: "Collections",
          item: canonicalUrl("/collections"),
        },
        {
          "@type": "ListItem",
          position: 3,
          name: presentation.title,
          item: canonicalUrl(`/collections/${handle}`),
        },
      ],
    },
  };

  return (
    <div className="vs-wide-shell py-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionJsonLd) }}
      />
      <div
        className={
          artwork
            ? "relative isolate flex min-h-[360px] flex-col justify-end overflow-hidden rounded-3xl bg-[#101116] p-6 text-white sm:min-h-[390px] sm:p-12"
            : ""
        }
      >
        {artwork && (
          <>
            <img
              src={artwork}
              srcSet={collectionArtworkSrcSet(handle)}
              sizes="(min-width: 1280px) 1248px, 100vw"
              alt=""
              width={1536}
              height={1024}
              fetchPriority="high"
              className="absolute inset-0 -z-20 h-full w-full object-cover object-right"
            />
            <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black/95 via-black/30 to-transparent sm:bg-gradient-to-r sm:from-black/90 sm:via-black/40" />
            <p className="mb-4 text-[10px] uppercase tracking-[0.24em] text-white/75">
              The VS Store edit
            </p>
          </>
        )}
        <h1 className="max-w-xl text-3xl font-semibold tracking-[-0.04em] sm:text-5xl">
          {presentation.title}
        </h1>
        {presentation.description && (
          <p
            className={
              artwork
                ? "mt-4 max-w-lg text-sm leading-6 text-white/80"
                : "mt-2 max-w-2xl text-sm text-muted-foreground"
            }
          >
            {presentation.description}
          </p>
        )}
      </div>
      {getCollectionEditorial(handle) && (
        <section
          className="mt-6 max-w-3xl rounded-2xl border border-border bg-card p-5"
          aria-labelledby="collection-editorial-heading"
        >
          <h2 id="collection-editorial-heading" className="font-display text-lg font-semibold">
            {getCollectionEditorial(handle)?.heading}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {getCollectionEditorial(handle)?.body}
          </p>
        </section>
      )}
      <div className="mt-6">
        {isLoading ? (
          <ProductGridSkeleton />
        ) : isError || !data ? (
          <CatalogErrorState
            title="Collection unavailable"
            description="We couldn’t load this collection. Try again or browse the full catalog."
            onRetry={() => window.location.reload()}
          />
        ) : products.length === 0 ? (
          <EmptyProducts message="No products in this collection" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
              {products.map((p) => (
                <ProductCard key={p.node.id} product={p} />
              ))}
            </div>
            {nextCursor && (
              <div className="mt-8 flex flex-col items-center gap-3">
                {loadMoreError && (
                  <p role="alert" className="text-sm text-destructive">
                    {loadMoreError}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={isLoadingMore}
                  className="min-h-11 rounded-full border border-border bg-card px-5 text-sm font-semibold transition-colors hover:border-primary disabled:opacity-50"
                >
                  {isLoadingMore ? "Loading more…" : "Load more products"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
