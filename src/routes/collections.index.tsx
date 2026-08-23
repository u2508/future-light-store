import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { fetchCollections } from "@/lib/shopify";
import { canonicalUrl } from "@/lib/seo";
import { FEATURED_COLLECTION_LINKS } from "@/lib/seo-content";
import { CatalogErrorState, CollectionGridSkeleton } from "@/components/vs/CatalogState";

export const Route = createFileRoute("/collections/")({
  head: () => ({
    meta: [
      { title: "Collections — VS Store" },
      {
        name: "description",
        content:
          "Browse every VS Store collection: curated edits of future-ready essentials, tech and lifestyle.",
      },
      { property: "og:title", content: "Collections — VS Store" },
      { property: "og:description", content: "Browse every VS Store collection." },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: canonicalUrl("/collections") }],
  }),
  component: CollectionsIndex,
});

function CollectionsIndex() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["collections", "all"],
    queryFn: () => fetchCollections(100),
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Collections</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Curated edits from the VS catalogue — shop by theme, category and season.
      </p>

      <section
        className="mt-8 rounded-3xl border border-border bg-card p-6"
        aria-labelledby="shop-by-intent"
      >
        <h2 id="shop-by-intent" className="font-display text-xl font-semibold">
          Shop by intent
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Start with a practical use case, then narrow the live catalog by price, availability or
          product type.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURED_COLLECTION_LINKS.map((collection) => (
            <Link
              key={collection.handle}
              to="/collections/$handle"
              params={{ handle: collection.handle }}
              className="rounded-2xl border border-border p-4 transition-colors hover:border-primary hover:bg-accent"
            >
              <h3 className="font-semibold">{collection.title}</h3>
              <p className="mt-2 text-sm leading-5 text-muted-foreground">
                {collection.description}
              </p>
              <span className="mt-3 inline-block text-sm font-semibold text-primary">
                Explore collection →
              </span>
            </Link>
          ))}
        </div>
      </section>

      {isError ? (
        <div className="mt-8">
          <CatalogErrorState
            title="We couldn’t load the collections"
            onRetry={() => {
              void refetch();
            }}
          />
        </div>
      ) : isLoading ? (
        <div className="mt-8">
          <CollectionGridSkeleton />
        </div>
      ) : (data ?? []).length === 0 ? (
        <div
          role="status"
          className="mt-8 rounded-2xl border border-border bg-card p-10 text-center"
        >
          <p className="font-display text-lg font-semibold">No collections found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create collections in Shopify and they'll appear here automatically.
          </p>
          <Link
            to="/shop"
            className="mt-4 inline-block text-sm font-semibold text-primary hover:underline"
          >
            Browse all products →
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {(data ?? []).map((c) => (
            <Link
              key={c.id}
              to="/collections/$handle"
              params={{ handle: c.handle }}
              className="group overflow-hidden rounded-2xl border border-border bg-card transition-colors hover:border-primary"
            >
              <div className="aspect-[4/3] overflow-hidden bg-muted">
                {c.image?.url ? (
                  <img
                    src={c.image.url}
                    alt={c.image.altText ?? `${c.title} collection`}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center text-xs text-muted-foreground">
                    VS
                  </div>
                )}
              </div>
              <div className="p-3">
                <h2 className="font-display text-sm font-semibold">{c.title}</h2>
                {c.description && (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{c.description}</p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
