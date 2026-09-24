import { useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { fetchSearchProducts } from "@/lib/shopify";
import { searchProducts } from "@/lib/vs-search";
import { ProductGridSkeleton } from "@/components/vs/ProductCard";
import { ProgressiveProductGrid } from "@/components/vs/CatalogGridState";
import { trackSearch } from "@/lib/marketingAnalytics";
import { canonicalUrl } from "@/lib/seo";

const searchSchema = z.object({ q: fallback(z.string(), "").default("") });

export const Route = createFileRoute("/search")({
  validateSearch: zodValidator(searchSchema),
  head: () => ({
    meta: [
      { title: "Search — VS Store" },
      {
        name: "description",
        content: "Search the VS Store catalog with instant, typo-tolerant results.",
      },
      { property: "og:title", content: "Search — VS Store" },
      {
        property: "og:description",
        content: "Search the VS catalog with instant, typo-tolerant results.",
      },
      { name: "robots", content: "noindex, follow" },
    ],
    links: [{ rel: "canonical", href: canonicalUrl("/search") }],
  }),
  component: SearchPage,
});

function SearchPage() {
  const { q } = Route.useSearch();
  const normalizedQuery = q.trim();
  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products", "search-index", normalizedQuery],
    queryFn: () => fetchSearchProducts(normalizedQuery),
    enabled: normalizedQuery.length > 0,
    staleTime: 0,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const results = normalizedQuery
    ? searchProducts(products, normalizedQuery).map((m) => m.product)
    : [];

  useEffect(() => {
    if (normalizedQuery && !isLoading) trackSearch(normalizedQuery, results.length);
  }, [normalizedQuery, isLoading, results.length]);

  return (
    <div className="vs-wide-shell py-8">
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
            <p className="mt-1 text-sm text-muted-foreground">
              Try fewer words, or browse the full catalog.
            </p>
            <Link
              to="/shop"
              className="mt-4 inline-block text-sm font-semibold text-primary hover:underline"
            >
              Browse all products →
            </Link>
          </div>
        ) : (
          <ProgressiveProductGrid
            products={results}
            resetKey={q}
            gridClassName="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4"
          />
        )}
      </div>
    </div>
  );
}
