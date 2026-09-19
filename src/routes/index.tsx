import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, PackageCheck, ShieldCheck, Headphones } from "lucide-react";
import { fetchCollection } from "@/lib/shopify";
import { HeroCarousel } from "@/components/vs/HeroCarousel";
import { ProductCatalogGridState } from "@/components/vs/CatalogGridState";
import {
  collectionArtwork,
  collectionArtworkSrcSet,
  MERCHANDISING_COLLECTIONS,
} from "@/lib/collection-artwork";
import { canonicalUrl } from "@/lib/seo";
import { HOME_ANSWER_BLOCKS } from "@/lib/seo-content";

const WORLDS = [
  { handle: "portable-gadgets", title: "Everyday, upgraded.", label: "Tech & accessories" },
  { handle: "home-decor", title: "Make room for better.", label: "Home & living" },
  { handle: "beauty-makeup-essentials", title: "Your kind of glow.", label: "Beauty & self-care" },
  { handle: "travel-outdoor", title: "Go a little further.", label: "Travel & outdoors" },
  { handle: "pet-essentials", title: "For your favourite company.", label: "Pet essentials" },
  { handle: "gifts", title: "Give something unexpected.", label: "Gifts & discoveries" },
] as const;

const QUICK_DISCOVERY = [
  { handle: "travel-outdoor", label: "Travel & Outdoor", title: "Go a little further." },
  { handle: "portable-gadgets", label: "Portable Gadgets", title: "Everyday, upgraded." },
  { handle: "kitchen-gadgets", label: "Kitchen", title: "Make it easier." },
  {
    handle: "beauty-makeup-essentials",
    label: "Beauty Essentials",
    title: "Your kind of glow.",
  },
  { handle: "home-decor", label: "Home Decor", title: "Make room for better." },
] as const;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "The future looks good on you — VS Store" },
      {
        name: "description",
        content:
          "Unexpected finds and everyday upgrades. Explore New Arrivals, Best Sellers and Premium Picks at VS Store.",
      },
      { property: "og:title", content: "The future looks good on you — VS Store" },
      {
        property: "og:description",
        content: "Unexpected finds. Everyday upgrades. Discover your next favourite.",
      },
      { property: "og:url", content: canonicalUrl("/") },
    ],
    links: [{ rel: "canonical", href: canonicalUrl("/") }],
  }),
  component: Index,
});

function CollectionShelf({
  handle,
  title,
  subtitle,
}: {
  handle: string;
  title: string;
  subtitle: string;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const [ready, setReady] = useState(false);
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["collection", handle],
    queryFn: () => fetchCollection(handle),
    enabled: ready,
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || typeof IntersectionObserver === "undefined") {
      setReady(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setReady(true);
        observer.disconnect();
      },
      { rootMargin: "700px 0px" },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={sectionRef} className="vs-wide-shell py-10 sm:py-14" aria-label={title}>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {subtitle}
          </p>
          <h2 className="text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">{title}</h2>
        </div>
        <Link
          to="/collections/$handle"
          params={{ handle }}
          className="inline-flex min-h-11 shrink-0 items-center gap-2 text-xs font-semibold sm:text-sm"
        >
          View the edit
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
      <ProductCatalogGridState
        products={(data?.products ?? []).slice(0, 8)}
        isLoading={!ready || isLoading}
        isError={ready && (isError || (!isLoading && !data))}
        isRetrying={ready && isFetching}
        onRetry={() => {
          if (ready) void refetch();
        }}
        loadingLabel={`Loading ${title}`}
        errorTitle={`We couldn’t load ${title.toLowerCase()}`}
        emptyTitle="The next edit is on its way"
        emptyDescription="Explore the other collections while we prepare these picks."
        skeletonCount={8}
        gridClassName="grid grid-cols-2 gap-3 md:grid-cols-4 sm:gap-5"
      />
    </section>
  );
}

function Index() {
  const slides = MERCHANDISING_COLLECTIONS.map((item) => ({
    handle: item.handle,
    eyebrow: item.eyebrow,
    title: item.headline,
    copy: item.copy,
    cta: item.cta,
    imageSrcSet: collectionArtworkSrcSet(item.handle),
    image: collectionArtwork(item.handle),
  }));

  return (
    <div>
      <HeroCarousel slides={slides} />
      <div className="vs-wide-shell flex flex-wrap items-center justify-center gap-x-8 gap-y-3 border-b border-border/60 py-6 text-[11px] text-muted-foreground sm:gap-x-16">
        <span className="inline-flex items-center gap-2">
          <PackageCheck className="h-4 w-4" />
          Tracked delivery
        </span>
        <span className="inline-flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          Secure Shopify checkout
        </span>
        <Link to="/help" className="inline-flex items-center gap-2">
          <Headphones className="h-4 w-4" />
          Here to help
        </Link>
      </div>

      <section className="vs-wide-shell py-8 sm:py-12" aria-labelledby="quick-discovery">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Keep exploring
            </p>
            <h2
              id="quick-discovery"
              className="text-3xl font-semibold tracking-[-0.04em] sm:text-4xl"
            >
              More worlds to discover.
            </h2>
          </div>
          <Link
            to="/collections"
            className="inline-flex min-h-11 shrink-0 items-center gap-2 text-xs font-semibold sm:text-sm"
          >
            Browse all
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 sm:gap-4">
          {QUICK_DISCOVERY.map((world) => {
            const art = collectionArtwork(world.handle);
            return (
              <Link
                key={world.handle}
                to="/collections/$handle"
                params={{ handle: world.handle }}
                className="vs-artwork-card group relative isolate flex min-h-[190px] flex-col justify-end overflow-hidden rounded-[1.25rem] bg-[#101116] p-5 text-white sm:min-h-[230px]"
              >
                {art && (
                  <img
                    src={art}
                    srcSet={collectionArtworkSrcSet(world.handle)}
                    sizes="(min-width: 640px) 20vw, 50vw"
                    alt=""
                    width={1536}
                    height={1024}
                    loading="lazy"
                    className="absolute inset-0 -z-20 h-full w-full object-cover object-right transition-transform duration-500 group-hover:scale-[1.04]"
                  />
                )}
                <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black/95 via-black/20 to-transparent" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/75">
                  {world.label}
                </p>
                <div className="mt-2 flex items-end justify-between gap-3">
                  <h3 className="text-lg font-medium leading-tight tracking-[-0.03em]">
                    {world.title}
                  </h3>
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/30">
                    <ArrowUpRight className="h-4 w-4" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <CollectionShelf handle="new-arrivals" title="Just landed." subtitle="New arrivals" />

      <section className="vs-wide-shell py-8 sm:py-12" aria-labelledby="discover-worlds">
        <div className="mb-7 flex items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Follow your curiosity
            </p>
            <h2
              id="discover-worlds"
              className="text-3xl font-semibold tracking-[-0.04em] sm:text-4xl"
            >
              Find your world.
            </h2>
          </div>
          <Link
            to="/collections"
            className="inline-flex min-h-11 shrink-0 items-center gap-2 text-xs font-semibold sm:text-sm"
          >
            All collections
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {WORLDS.map((world) => {
            const art = collectionArtwork(world.handle);
            return (
              <Link
                key={world.handle}
                to="/collections/$handle"
                params={{ handle: world.handle }}
                className="vs-artwork-card group relative isolate flex min-h-[310px] flex-col justify-end overflow-hidden rounded-[1.5rem] bg-[#101116] p-6 text-white"
              >
                {art && (
                  <img
                    src={art}
                    srcSet={collectionArtworkSrcSet(world.handle)}
                    sizes="(min-width: 1024px) 400px, (min-width: 640px) 50vw, 100vw"
                    alt=""
                    width={1536}
                    height={1024}
                    loading="lazy"
                    className="absolute inset-0 -z-20 h-full w-full object-cover object-right"
                  />
                )}
                <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black/95 via-black/10 to-transparent" />
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/75">
                  {world.label}
                </p>
                <div className="mt-2 flex items-end justify-between gap-4">
                  <h3 className="max-w-[235px] text-2xl font-medium leading-tight tracking-[-0.03em]">
                    {world.title}
                  </h3>
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/30">
                    <ArrowUpRight className="h-4 w-4" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <CollectionShelf handle="best-sellers" title="Worth the attention." subtitle="Best sellers" />

      <section className="vs-wide-shell py-6" aria-labelledby="premium-edit">
        <Link
          to="/collections/$handle"
          params={{ handle: "premium-picks" }}
          className="vs-artwork-card relative isolate flex min-h-[420px] items-end overflow-hidden rounded-[1.5rem] bg-[#111217] p-7 text-white sm:min-h-[450px] sm:items-center sm:p-14"
        >
          <img
            src={collectionArtwork("premium-picks")}
            srcSet={collectionArtworkSrcSet("premium-picks")}
            sizes="(min-width: 1280px) 1248px, 100vw"
            alt=""
            width={1536}
            height={1024}
            loading="lazy"
            className="absolute inset-0 -z-20 h-full w-full object-cover object-right"
          />
          <div className="absolute inset-0 -z-10 bg-gradient-to-r from-black/90 via-black/25 to-transparent max-sm:bg-gradient-to-t max-sm:from-black/95" />
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] text-white/75">
              The premium edit
            </p>
            <h2
              id="premium-edit"
              className="mt-5 max-w-[350px] text-4xl font-medium leading-[1.08] tracking-[-0.04em] sm:text-5xl"
            >
              Extraordinary.
              <br />
              Every day.
            </h2>
            <p className="mt-4 max-w-[290px] text-sm leading-6 text-white/75">
              A considered collection of pieces that bring a little more to your world.
            </p>
            <span className="mt-6 inline-flex min-h-12 items-center gap-6 rounded-full border border-white/40 px-5 text-sm">
              Discover Premium Picks
              <ArrowUpRight className="h-4 w-4" />
            </span>
          </div>
        </Link>
      </section>

      <CollectionShelf
        handle="premium-picks"
        title="A little more special."
        subtitle="Premium picks"
      />

      <section
        className="vs-wide-shell border-t border-border py-12"
        aria-labelledby="vs-store-answers"
      >
        <h2 id="vs-store-answers" className="text-2xl font-semibold tracking-tight">
          Good finds. Clear answers.
        </h2>
        <div className="mt-6 grid gap-7 md:grid-cols-3">
          {HOME_ANSWER_BLOCKS.map((block) => (
            <article key={block.question}>
              <h3 className="text-sm font-semibold">{block.question}</h3>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{block.answer}</p>
            </article>
          ))}
        </div>
        <Link
          to="/help"
          className="mt-7 inline-flex min-h-11 items-center gap-2 text-sm font-medium"
        >
          Visit the help centre
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </section>
    </div>
  );
}
