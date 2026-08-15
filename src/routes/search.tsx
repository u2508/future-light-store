import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { fetchProducts } from "@/lib/shopify";
import { searchProducts } from "@/lib/vs-search";
import { ProductCard, ProductGridSkeleton } from "@/components/vs/ProductCard";

const searchSchema = z.object({ q: fallback(z.string(), "").default("") });

export const Route = createFileRoute("/search")({
  validateSearch: zodValidator(searchSchema),
  head: () => ({
    meta: [
      { title: "Search — VS Store" },
      { name: "description", content: "Search the VS Store catalog with instant, typo-tolerant results." },
      { property: "og:title", content: "Search — VS Store" },
      { property: "og:description", content: "Search the VS catalog with instant, typo-tolerant results." },
    ],
  }),
  component: SearchPage,
});

function SearchPage() {
  const { q } = Route.useSearch();
  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products", "all"],
    queryFn: () => fetchProducts(100),
    staleTime: 5 * 60 * 1000,
  });

  const results = searchProducts(products, q).map((m) => m.product);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="font-display text-3xl font-bold">{q ? `Results for “${q}”` : "Search"}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {isLoading ? "Searching…" : `${results.length} result${results.length === 1 ? "" : "s"}`}
      </p>

      <div className="mt-6">
        {isLoading ? (
          <ProductGridSkeleton />
        ) : results.length === 0 ? (
          <div className="vs-card p-10 text-center">
            <p className="font-display text-lg font-semibold">Nothing matched that search</p>
            <p className="mt-1 text-sm text-muted-foreground">Try fewer words, or browse the full catalog.</p>
            <Link to="/shop" className="mt-4 inline-block text-sm font-semibold text-primary hover:underline">
              Browse all products →
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {results.map((p) => (
              <ProductCard key={p.node.id} product={p} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
