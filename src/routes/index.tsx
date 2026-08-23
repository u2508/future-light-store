import { createFileRoute, Link, useHydrated } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, ShieldCheck, Star, Truck, RotateCcw } from "lucide-react";
import { fetchProducts, fetchCollections, discountPercent } from "@/lib/shopify";
import { ProductShelf } from "@/components/vs/ProductShelf";
import { HeroCarousel } from "@/components/vs/HeroCarousel";
import { canonicalUrl } from "@/lib/seo";
import { HERO_COLLECTION_BANNERS, HOME_ANSWER_BLOCKS } from "@/lib/seo-content";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Everyday essentials, engineered forward — VS Store" },
      {
        name: "description",
        content: "Discover new arrivals, best sellers and limited-time offers at VS Store, with tracked delivery and secure checkout.",
      },
      { property: "og:title", content: "Everyday essentials, engineered forward — VS Store" },
      { property: "og:description", content: "New arrivals, best sellers and limited-time offers, with tracked delivery." },
      { property: "og:url", content: canonicalUrl("/") },
    ],
    links: [{ rel: "canonical", href: canonicalUrl("/") }],
  }),
  component: Index,
});

function Index() {
  const hydrated = useHydrated();
  const { data: products = [], isLoading: queryLoading } = useQuery({
    queryKey: ["products", "all"],
    queryFn: () => fetchProducts(99),
    staleTime: 5 * 60 * 1000,
  });
  const { data: collections = [] } = useQuery({
    queryKey: ["collections", "home"],
    queryFn: () => fetchCollections(100),
    staleTime: 10 * 60 * 1000,
  });
  const isLoading = !hydrated || queryLoading;

  const heroSlides = HERO_COLLECTION_BANNERS.map((banner) => {
    const live = collections.find((c) => c.handle === banner.handle);
    return {
      handle: banner.handle,
      eyebrow: banner.eyebrow,
      title: banner.title,
      copy: banner.copy,
      image: live?.image?.url,
    };
  });

  const spotlightCollections = collections
    .filter((c) => c.handle !== "all-products" && c.handle !== "classification-review")
    .slice(0, 12);

  const offers = products.filter(
    (p) =>
      discountPercent(
        p.node.priceRange.minVariantPrice.amount,
        p.node.variants.edges[0]?.node.compareAtPrice?.amount ?? null,
      ) > 0,
  );
  const underFifty = products.filter((p) => parseFloat(p.node.priceRange.minVariantPrice.amount) <= 50);


  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[780px] bg-[radial-gradient(circle_at_top,rgba(60,110,255,0.13),transparent_42%),radial-gradient(circle_at_80%_10%,rgba(42,186,170,0.16),transparent_24%),linear-gradient(to_bottom,rgba(255,255,255,0.85),transparent)]" />
      <section className="mx-auto max-w-7xl px-4 pt-8">
        <h1 className="max-w-3xl font-display text-4xl font-bold leading-[1.03] sm:text-6xl">
          Everyday essentials, engineered forward.
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
          Shop the collections VS customers order most — tech, travel, home and beauty, with tracked delivery and
          secure Shopify checkout.
        </p>
      </section>

      <HeroCarousel slides={heroSlides} />


      <section className="mx-auto max-w-7xl px-4 pt-8">
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: Truck, title: "Tracked delivery", copy: "Live status on every order", accent: "from-primary/10 to-primary/5" },
            { icon: RotateCcw, title: "Easy returns", copy: "30-day return window", accent: "from-electric/10 to-electric/5" },
            { icon: ShieldCheck, title: "Secure checkout", copy: "Payments handled by Shopify", accent: "from-signal/10 to-signal/5" },
          ].map((item) => (
            <div
              key={item.title}
              className={`flex items-center gap-4 rounded-3xl border border-border/70 bg-gradient-to-br ${item.accent} p-5 shadow-[var(--shadow-card)]`}
            >
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/80 shadow-sm">
                <item.icon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold">{item.title}</p>
                <p className="text-xs leading-5 text-muted-foreground">{item.copy}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-4 px-4 pt-8 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="vs-premium-panel rounded-[2rem] p-6 sm:p-8">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">
            <Star className="h-4 w-4 text-primary" />
            Premium curation
          </div>
          <h2 className="mt-3 font-display text-2xl font-bold sm:text-3xl">
            Designed to feel editorial, not transactional.
          </h2>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {[
              "Silky gradients",
              "Refined cards",
              "Luxury spacing",
            ].map((feature) => (
              <div key={feature} className="rounded-2xl border border-border/70 bg-white/70 px-4 py-3 text-sm font-medium shadow-sm">
                {feature}
              </div>
            ))}
          </div>
        </div>
        <div className="vs-card flex flex-col justify-between rounded-[2rem] p-6 sm:p-8">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">
            <BadgeCheck className="h-4 w-4 text-electric" />
            Trusted shopping
          </div>
          <div className="mt-6 rounded-2xl border border-border bg-muted/60 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Experience upgrade</p>
            <p className="mt-2 text-sm font-medium">
              More depth, more breathing room, and a more premium visual cadence.
            </p>
          </div>
        </div>
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

      <section className="mx-auto max-w-7xl px-4 py-10" aria-labelledby="home-collection-paths">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 id="home-collection-paths" className="font-display text-2xl font-bold">
              Shop by intent
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">Find the right starting point for your next upgrade.</p>
          </div>
          <Link to="/collections" className="hidden text-sm font-semibold text-primary hover:underline sm:block">
            View all collections →
          </Link>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURED_COLLECTION_LINKS.map((collection) => (
            <Link
              key={collection.handle}
              to="/collections/$handle"
              params={{ handle: collection.handle }}
              className="group rounded-3xl border border-border/70 bg-card p-5 shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[var(--shadow-lift)]"
            >
              <div className="mb-6 h-12 w-12 rounded-2xl bg-primary/10 transition-colors group-hover:bg-primary/15" />
              <h3 className="font-semibold">{collection.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{collection.description}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10" aria-labelledby="vs-store-answers">
        <div className="rounded-[2rem] border border-border/70 bg-card p-6 shadow-[var(--shadow-card)] sm:p-8">
          <h2 id="vs-store-answers" className="font-display text-2xl font-bold">
            Answers for everyday shopping
          </h2>
          <div className="mt-5 grid gap-5 md:grid-cols-3">
            {HOME_ANSWER_BLOCKS.map((block) => (
              <article key={block.question} className="rounded-2xl bg-muted/50 p-4">
                <h3 className="font-semibold">{block.question}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{block.answer}</p>
              </article>
            ))}
          </div>
          <Link to="/help" className="mt-6 inline-block text-sm font-semibold text-primary hover:underline">
            Read all delivery, returns and tracking answers →
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10">
        <div className="rounded-[2rem] border border-border/70 vs-hero-gradient p-10 text-center text-primary-foreground shadow-[var(--shadow-lift)]">
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
              className="w-full rounded-full border border-border bg-card px-4 py-3 text-sm text-foreground shadow-sm outline-none ring-0 transition-colors placeholder:text-muted-foreground focus:border-primary"
            />
            <button className="rounded-full bg-card px-5 py-3 text-sm font-semibold text-foreground shadow-sm transition-transform hover:-translate-y-0.5">
              Notify me
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
