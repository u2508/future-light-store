import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { fetchCollection } from "@/lib/shopify";
import { ProductCard, ProductGridSkeleton, EmptyProducts } from "@/components/vs/ProductCard";
import { getCollectionEditorial } from "@/lib/collection-seo";
import { canonicalUrl } from "@/lib/seo";

export const Route = createFileRoute("/collections/$handle")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.handle.replace(/-/g, " ")} — VS Store` },
      { name: "description", content: `Shop the ${params.handle.replace(/-/g, " ")} collection at VS Store.` },
      { property: "og:title", content: `${params.handle.replace(/-/g, " ")} — VS Store` },
      { property: "og:description", content: `Shop the ${params.handle.replace(/-/g, " ")} collection at VS Store.` },
      { property: "og:url", content: canonicalUrl(`/collections/${params.handle}`) },
    ],
    links: [{ rel: "canonical", href: canonicalUrl(`/collections/${params.handle}`) }],
  }),
  component: CollectionPage,
});

function CollectionPage() {
  const { handle } = Route.useParams();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["collection", handle],
    queryFn: () => fetchCollection(handle),
  });

  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: data?.title ?? handle.replace(/-/g, " "),
    description: data?.description ?? undefined,
    url: canonicalUrl(`/collections/${handle}`),
    mainEntity: {
      "@type": "ItemList",
      itemListElement: (data?.products ?? []).map((p, i) => ({
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
        { "@type": "ListItem", position: 2, name: "Collections", item: canonicalUrl("/collections") },
        { "@type": "ListItem", position: 3, name: data?.title ?? handle.replace(/-/g, " "), item: canonicalUrl(`/collections/${handle}`) },
      ],
    },
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionJsonLd) }} />
      <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
        {data?.title ?? handle.replace(/-/g, " ")}
      </h1>
      {data?.description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{data.description}</p>}
      {getCollectionEditorial(handle) && (
        <section className="mt-6 max-w-3xl rounded-2xl border border-border bg-card p-5" aria-labelledby="collection-editorial-heading">
          <h2 id="collection-editorial-heading" className="font-display text-lg font-semibold">
            {getCollectionEditorial(handle)?.heading}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{getCollectionEditorial(handle)?.body}</p>
        </section>
      )}
      <div className="mt-6">
        {isLoading ? (
          <ProductGridSkeleton />
        ) : isError || !data ? (
          <div className="vs-card p-10 text-center">
            <p className="font-display text-lg font-semibold">Collection unavailable</p>
            <Link to="/shop" className="mt-3 inline-block text-sm font-semibold text-primary hover:underline">
              Browse all products →
            </Link>
          </div>
        ) : data.products.length === 0 ? (
          <EmptyProducts message="No products in this collection" />
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {data.products.map((p) => (
              <ProductCard key={p.node.id} product={p} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
