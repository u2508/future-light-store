import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, Truck, RotateCcw, Sparkles } from "lucide-react";
import heroImage from "@/assets/vs-hero.jpg";
import { fetchProducts, discountPercent } from "@/lib/shopify";
import { ProductShelf } from "@/components/vs/ProductShelf";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "VS Store — Future-facing marketplace" },
      {
        name: "description",
        content: "Discover new arrivals, best sellers and limited-time offers at VS Store, with tracked delivery and secure checkout.",
      },
      { property: "og:title", content: "VS Store — Future-facing marketplace" },
      { property: "og:description", content: "New arrivals, best sellers and limited-time offers, with tracked delivery." },
    ],
  }),
  component: Index,
});

function Index() {
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
  const underFifty = products.filter((p) => parseFloat(p.node.priceRange.minVariantPrice.amount) <= 50);

  return (
    <div>
      <section className="mx-auto max-w-7xl px-4 pt-6">
        <div className="relative overflow-hidden rounded-3xl border border-border bg-card shadow-[var(--shadow-lift)]">
          <img
            src={heroImage}
            alt="Curated VS Store everyday-carry collection"
            width={1600}
            height={1104}
            className="h-[380px] w-full object-cover sm:h-[460px]"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-background/95 via-background/70 to-transparent" />
          <div className="absolute inset-0 flex flex-col justify-center gap-4 p-8 sm:p-14">
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-accent-foreground">
              <Sparkles className="h-3 w-3" /> New season
            </span>
            <h1 className="max-w-xl font-display text-4xl font-bold leading-[1.05] sm:text-6xl">
              Everyday essentials, engineered forward.
            </h1>
            <p className="max-w-md text-sm text-muted-foreground sm:text-base">
              Precision search, honest pricing, and fulfilment you can follow from checkout to doorstep.
            </p>
            <Link
              to="/shop"
              className="inline-flex w-fit items-center rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Explore the catalog
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-3 px-4 pt-8 sm:grid-cols-3">
        {[
          { icon: Truck, title: "Tracked delivery", copy: "Live status on every order" },
          { icon: RotateCcw, title: "Easy returns", copy: "30-day return window" },
          { icon: ShieldCheck, title: "Secure checkout", copy: "Payments handled by Shopify" },
        ].map((item) => (
          <div key={item.title} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
            <item.icon className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-semibold">{item.title}</p>
              <p className="text-xs text-muted-foreground">{item.copy}</p>
            </div>
          </div>
        ))}
      </section>

      <ProductShelf
        title="New arrivals"
        subtitle="Fresh in the VS catalog"
        products={products.slice(0, 8)}
        isLoading={isLoading}
        action={{ label: "Shop all", to: "/shop" }}
      />

      <ProductShelf
        title="Limited-time offers"
        subtitle="Reduced while stock lasts"
        products={offers.slice(0, 4)}
        isLoading={isLoading}
        action={{ label: "All offers", to: "/offers" }}
        emptyMessage="No offers running right now"
      />

      <ProductShelf
        title="Under $50"
        subtitle="Price-led discovery"
        products={underFifty.slice(0, 4)}
        isLoading={isLoading}
        action={{ label: "Shop all", to: "/shop" }}
        emptyMessage="Nothing under $50 yet"
      />

      <section className="mx-auto max-w-7xl px-4 py-10">
        <div className="rounded-3xl border border-border vs-hero-gradient p-10 text-center text-primary-foreground">
          <h2 className="font-display text-2xl font-bold sm:text-3xl">Get drops before anyone else</h2>
          <p className="mx-auto mt-2 max-w-md text-sm opacity-90">
            Restock alerts, new arrivals and members-only pricing straight to your inbox.
          </p>
          <form
            className="mx-auto mt-5 flex max-w-md gap-2"
            onSubmit={(e) => {
              e.preventDefault();
            }}
          >
            <input
              type="email"
              required
              placeholder="you@email.com"
              aria-label="Email address"
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground"
            />
            <button className="rounded-xl bg-card px-5 py-3 text-sm font-semibold text-foreground">Notify me</button>
          </form>
        </div>
      </section>
    </div>
  );
}
