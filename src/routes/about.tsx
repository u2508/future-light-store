import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, Compass, PackageCheck, Search, ShieldCheck, Sparkles } from "lucide-react";
import heroImage from "@/assets/vs-hero.jpg";
import { canonicalUrl } from "@/lib/seo";

const PRINCIPLES = [
  {
    icon: Compass,
    title: "Curated discovery",
    copy: "Start with a useful edit instead of an endless wall of products. Collections give every browse session a clearer direction.",
  },
  {
    icon: ShieldCheck,
    title: "Honest context",
    copy: "Prices, availability, delivery estimates and return guidance stay close to the decision, so shopping feels more considered.",
  },
  {
    icon: PackageCheck,
    title: "Visible fulfilment",
    copy: "From secure Shopify checkout to tracking after dispatch, the journey should feel as polished as the product discovery.",
  },
];

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About VS Store — Everyday essentials, engineered forward" },
      {
        name: "description",
        content:
          "Learn how VS Store makes everyday shopping calmer with curated discovery, honest context and visible fulfilment.",
      },
      { property: "og:title", content: "About VS Store" },
      {
        property: "og:description",
        content: "A calmer way to discover useful everyday upgrades.",
      },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: canonicalUrl("/about") }],
  }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[720px] bg-[radial-gradient(circle_at_top,rgba(60,110,255,0.13),transparent_42%),linear-gradient(to_bottom,rgba(255,255,255,0.85),transparent)]" />

      <section className="mx-auto max-w-7xl px-4 py-10 sm:py-14">
        <div className="grid gap-7 lg:grid-cols-[1.03fr_0.97fr] lg:items-stretch">
          <div className="rounded-[2rem] vs-hero-gradient p-7 text-primary-foreground shadow-[var(--shadow-lift)] sm:p-10">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] opacity-75">
              VS Store / About us
            </p>
            <h1 className="mt-5 max-w-2xl font-display text-4xl font-bold leading-[1.03] sm:text-6xl">
              Less noise. Better finds.
            </h1>
            <p className="mt-5 max-w-xl text-sm leading-7 opacity-85 sm:text-base">
              VS Store is a future-facing marketplace for everyday upgrades—built to make discovery
              feel clearer, checkout feel calmer and delivery feel easier to follow.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link
                to="/shop"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-primary-foreground px-5 py-3 text-sm font-semibold text-foreground transition-transform hover:-translate-y-0.5"
              >
                Explore the store <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                to="/policies/$slug"
                params={{ slug: "contact" }}
                className="inline-flex items-center justify-center rounded-full border border-primary-foreground/25 bg-primary-foreground/10 px-5 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-foreground/15"
              >
                Talk to us
              </Link>
            </div>
          </div>

          <div className="relative min-h-[360px] overflow-hidden rounded-[2rem] border border-border/70 bg-card shadow-[var(--shadow-lift)] sm:min-h-[460px]">
            <img
              src={heroImage}
              alt="A considered selection of everyday lifestyle products"
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-foreground/75 via-foreground/10 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-7 text-background sm:p-9">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-background/70">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                The VS point of view
              </div>
              <p className="mt-3 max-w-md font-display text-2xl font-semibold leading-tight sm:text-3xl">
                Useful things should still feel beautiful to discover.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-8 sm:py-12" aria-labelledby="our-point-of-view">
        <div className="grid gap-8 rounded-[2rem] border border-border/70 bg-card p-7 shadow-[var(--shadow-card)] sm:p-10 lg:grid-cols-[0.72fr_1.28fr] lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">
              Why VS Store exists
            </p>
            <h2 id="our-point-of-view" className="mt-3 font-display text-2xl font-bold sm:text-3xl">
              Shopping should give you momentum, not more tabs.
            </h2>
          </div>
          <div className="space-y-4 text-sm leading-7 text-muted-foreground sm:text-base">
            <p>
              The internet gives us more choice than ever, but more choice does not always make a
              decision easier. VS Store brings products into practical, good-looking edits so you
              can move from inspiration to the right next step with less friction.
            </p>
            <p>
              We care about the small moments: a useful search result, a product page that answers
              the obvious questions, a checkout that feels secure and tracking that keeps you in the
              loop after dispatch.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-8 sm:py-12" aria-labelledby="vs-principles">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">
              Our principles
            </p>
            <h2 id="vs-principles" className="mt-2 font-display text-2xl font-bold sm:text-3xl">
              Built around the way people actually shop.
            </h2>
          </div>
          <p className="max-w-sm text-sm leading-6 text-muted-foreground">
            A simple standard for every collection, product page and support interaction.
          </p>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {PRINCIPLES.map((principle, index) => (
            <article
              key={principle.title}
              className="vs-card rounded-[1.5rem] p-6 transition-transform hover:-translate-y-0.5"
            >
              <div className="flex items-start justify-between">
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-accent text-primary">
                  <principle.icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <span className="text-xs font-semibold tracking-[0.2em] text-muted-foreground">
                  0{index + 1}
                </span>
              </div>
              <h3 className="mt-6 font-display text-lg font-semibold">{principle.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{principle.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-8 sm:py-12" aria-labelledby="how-vs-works">
        <div className="grid gap-7 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="vs-premium-panel rounded-[2rem] p-7 sm:p-10">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">
              How it works
            </p>
            <h2 id="how-vs-works" className="mt-3 font-display text-2xl font-bold sm:text-3xl">
              A better rhythm from browse to doorstep.
            </h2>
            <div className="mt-8 space-y-5">
              {[
                [
                  "01",
                  "Choose your starting point",
                  "Begin with a collection, a search or a price-led edit.",
                ],
                [
                  "02",
                  "Make the decision easier",
                  "Use product context, live availability and clear options to narrow it down.",
                ],
                [
                  "03",
                  "Stay in the loop",
                  "Checkout securely and follow tracking once your order is dispatched.",
                ],
              ].map(([number, title, copy]) => (
                <div
                  key={number}
                  className="flex gap-4 border-t border-border/70 pt-5 first:border-t-0 first:pt-0"
                >
                  <span className="pt-0.5 text-xs font-semibold tracking-[0.2em] text-primary">
                    {number}
                  </span>
                  <div>
                    <h3 className="font-semibold">{title}</h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{copy}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-[2rem] border border-border/70 bg-foreground p-7 text-background shadow-[var(--shadow-lift)] sm:p-10">
            <Search className="h-6 w-6 text-background/70" aria-hidden="true" />
            <h2 className="mt-7 font-display text-2xl font-bold sm:text-3xl">
              Start with something that fits your life.
            </h2>
            <p className="mt-4 text-sm leading-7 text-background/70">
              Explore everyday essentials, home finds, portable tech, beauty and more—organised for
              a faster, calmer browse.
            </p>
            <Link
              to="/collections"
              className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-background transition-colors hover:text-background/75"
            >
              Browse collections <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10 sm:py-14">
        <div className="rounded-[2rem] vs-hero-gradient p-8 text-center text-primary-foreground shadow-[var(--shadow-lift)] sm:p-12">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] opacity-75">
            Ready when you are
          </p>
          <h2 className="mx-auto mt-3 max-w-2xl font-display text-2xl font-bold sm:text-4xl">
            Find your next everyday upgrade.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-7 opacity-85">
            Start with the catalog, follow your curiosity and let the right collection do the
            sorting.
          </p>
          <Link
            to="/shop"
            className="mt-7 inline-flex items-center gap-2 rounded-full bg-primary-foreground px-5 py-3 text-sm font-semibold text-foreground transition-transform hover:-translate-y-0.5"
          >
            Shop all products <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </section>
    </div>
  );
}
