import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { fetchCollection } from "@/lib/shopify";
import { ProductCard, ProductGridSkeleton, EmptyProducts } from "@/components/vs/ProductCard";

export const Route = createFileRoute("/collections/$handle")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.handle.replace(/-/g, " ")} — VS Store` },
      { name: "description", content: `Shop the ${params.handle.replace(/-/g, " ")} collection at VS Store.` },
      { property: "og:title", content: `${params.handle.replace(/-/g, " ")} — VS Store` },
      { property: "og:description", content: `Shop the ${params.handle.replace(/-/g, " ")} collection at VS Store.` },
      { property: "og:url", content: `https://future-light-store.lovable.app/collections/${params.handle}` },
    ],
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
    url: `https://future-light-store.lovable.app/collections/${handle}`,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: (data?.products ?? []).map((p, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `https://future-light-store.lovable.app/products/${p.node.handle}`,
        name: p.node.title,
      })),
    },
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionJsonLd) }} />
      <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
        {data?.title ?? handle.replace(/-/g, " ")}
      </h1>
      {data?.description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{data.description}</p>}
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
