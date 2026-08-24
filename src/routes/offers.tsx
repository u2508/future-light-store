import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { discountPercent, fetchAllProducts } from "@/lib/shopify";
import { ProductCard, ProductGridSkeleton, EmptyProducts } from "@/components/vs/ProductCard";
import { canonicalUrl } from "@/lib/seo";

export const Route = createFileRoute("/offers")({
  head: () => ({
    meta: [
      { title: "Offers — VS Store" },
      {
        name: "description",
        content: "Live price drops and limited-time offers across the VS Store catalog.",
      },
      { property: "og:title", content: "Offers — VS Store" },
      {
        property: "og:description",
        content: "Live price drops and limited-time offers at VS Store.",
      },
    ],
    links: [{ rel: "canonical", href: canonicalUrl("/offers") }],
  }),
  component: OffersPage,
});

function OffersPage() {
  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products", "offers"],
    queryFn: () => fetchAllProducts(),
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
      <section className="grid gap-6 rounded-[2rem] vs-hero-gradient p-7 text-primary-foreground shadow-[var(--shadow-lift)] sm:p-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] opacity-75">
            VS Store / Value edit
          </p>
          <h1 className="mt-4 max-w-2xl font-display text-3xl font-bold sm:text-5xl">
            Better finds, while they last.
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-7 opacity-85">
            Browse current price drops across the full catalog, with the same tracked delivery and
            secure checkout experience.
          </p>
        </div>
        <div className="rounded-[1.5rem] border border-primary-foreground/20 bg-primary-foreground/10 p-5">
          <p className="text-xs uppercase tracking-[0.24em] opacity-70">Live offer count</p>
          <p className="mt-2 font-display text-3xl font-bold">{isLoading ? "—" : offers.length}</p>
          <p className="mt-1 text-sm opacity-80">discounted products currently available</p>
        </div>
      </section>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Reduced while stock lasts.</p>
        <Link to="/shop" className="text-sm font-semibold text-primary hover:underline">
          Browse the full catalog →
        </Link>
      </div>
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
