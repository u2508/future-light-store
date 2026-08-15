import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { discountPercent, fetchProducts } from "@/lib/shopify";
import { ProductCard, ProductGridSkeleton, EmptyProducts } from "@/components/vs/ProductCard";

export const Route = createFileRoute("/offers")({
  head: () => ({
    meta: [
      { title: "Offers — VS Store" },
      { name: "description", content: "Live price drops and limited-time offers across the VS Store catalog." },
      { property: "og:title", content: "Offers — VS Store" },
      { property: "og:description", content: "Live price drops and limited-time offers at VS Store." },
    ],
  }),
  component: OffersPage,
});

function OffersPage() {
  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products", "all"],
    queryFn: () => fetchProducts(100),
    staleTime: 5 * 60 * 1000,
  });

  const offers = products.filter(
    (p) =>
      discountPercent(
        p.node.priceRange.minVariantPrice.amount,
        p.node.variants.edges[0]?.node.compareAtPrice?.amount ?? null,
      ) > 0,
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <h1 className="font-display text-3xl font-bold">Offers</h1>
      <p className="mt-1 text-sm text-muted-foreground">Reduced while stock lasts.</p>
      <div className="mt-6">
        {isLoading ? (
          <ProductGridSkeleton />
        ) : offers.length === 0 ? (
          <EmptyProducts message="No offers running right now" />
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {offers.map((p) => (
              <ProductCard key={p.node.id} product={p} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
