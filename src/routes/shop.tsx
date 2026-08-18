import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { fetchAllProducts, fetchCollections, isShopifyConfigured } from "@/lib/shopify";
import { CollectionBrowser } from "@/components/vs/CollectionBrowser";
import { canonicalUrl } from "@/lib/seo";

const searchSchema = z.object({
  q: fallback(z.string(), "").default(""),
  min_price: fallback(z.number(), 0).default(0),
  max_price: fallback(z.number(), 0).default(0),
  availability: fallback(z.string(), "").default(""),
  tag: fallback(z.string(), "").default(""),
  category: fallback(z.string(), "").default(""),
  vendor: fallback(z.string(), "").default(""),
  size: fallback(z.string(), "").default(""),
  color: fallback(z.string(), "").default(""),
  discount: fallback(z.number(), 0).default(0),
  sort: fallback(z.string(), "featured").default("featured"),
});

export const Route = createFileRoute("/shop")({
  validateSearch: zodValidator(searchSchema),
  head: () => ({
    meta: [
      { title: "Shop all — VS Store" },
      { name: "description", content: "Filter the full VS Store catalog by price, availability, size, colour and more." },
      { property: "og:title", content: "Shop all — VS Store" },
      { property: "og:description", content: "Filter the full VS catalog by price, availability, size, colour and more." },
    ],
    links: [{ rel: "canonical", href: canonicalUrl("/shop") }],
  }),
  component: ShopPage,
});

function ShopPage() {
  const search = Route.useSearch();
  const { data: products = [], isLoading, isError } = useQuery({
    queryKey: ["products", "shop-all"],
    queryFn: () => fetchAllProducts(),
    staleTime: 5 * 60 * 1000,
  });
  const { data: collections = [], isLoading: collectionsLoading } = useQuery({
    queryKey: ["collections", "sidebar"],
    queryFn: () => fetchCollections(100),
    staleTime: 5 * 60 * 1000,
  });

  const title = useMemo(() => (search.q ? `Results for “${search.q}”` : "Shop all"), [search.q]);

  return (
    <CollectionBrowser
      title={title}
      description="Every product in the VS catalog, live from Shopify."
      products={products}
      collections={collections}
      collectionsLoading={collectionsLoading}
      isLoading={isLoading}
      isError={isError || !isShopifyConfigured}
      routeTo="/shop"
      search={search}
    />
  );
}
