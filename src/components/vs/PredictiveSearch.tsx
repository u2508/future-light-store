import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search, X, Clock, TrendingUp, Loader2 } from "lucide-react";
import { fetchCollections, fetchProducts, formatMoney } from "@/lib/shopify";
import {
  POPULAR_SEARCHES,
  getRecentSearches,
  highlight,
  pushRecentSearch,
  searchCollections,
  searchProducts,
  suggestedCategories,
} from "@/lib/vs-search";
import { cn } from "@/lib/utils";

function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlight(text, query).map((chunk, i) => (
        <span key={i} className={chunk.match ? "font-semibold text-primary" : undefined}>
          {chunk.text}
        </span>
      ))}
    </>
  );
}

export function PredictiveSearch({
  autoFocus,
  onNavigate,
  className,
}: {
  autoFocus?: boolean;
  onNavigate?: () => void;
  className?: string;
}) {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [recent, setRecent] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => setRecent(getRecentSearches()), [open]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), 180);
    return () => clearTimeout(t);
  }, [value]);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products", "all"],
    queryFn: () => fetchProducts(99),
    staleTime: 5 * 60 * 1000,
  });
  const { data: collections = [] } = useQuery({
    queryKey: ["collections"],
    queryFn: () => fetchCollections(20),
    staleTime: 5 * 60 * 1000,
  });

  const matches = useMemo(() => searchProducts(products, debounced).slice(0, 6), [products, debounced]);
  const collectionMatches = useMemo(
    () => searchCollections(collections, debounced).slice(0, 4),
    [collections, debounced],
  );
  const categories = useMemo(() => suggestedCategories(products, debounced).slice(0, 4), [products, debounced]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const submit = (term: string) => {
    const q = term.trim();
    if (!q) return;
    pushRecentSearch(q);
    setOpen(false);
    onNavigate?.();
    navigate({ to: "/search", search: { q } });
  };

  const goToProduct = (handle: string) => {
    setOpen(false);
    onNavigate?.();
    navigate({ to: "/products/$handle", params: { handle } });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const match = matches[activeIndex];
      if (activeIndex >= 0 && match) goToProduct(match.product.node.handle);
      else submit(value);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const showResults = debounced.trim().length > 0;

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2 shadow-[var(--shadow-card)] focus-within:border-primary focus-within:ring-2 focus-within:ring-ring/25">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={open}
          aria-controls="vs-search-results"
          aria-label="Search VS Store"
          placeholder="Search products, collections, SKUs…"
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              setValue("");
              setDebounced("");
            }}
            aria-label="Clear search"
            className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => submit(value)}
          className="hidden rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 sm:block"
        >
          Search
        </button>
      </div>

      {open && (
        <div
          id="vs-search-results"
          className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-[70vh] overflow-y-auto rounded-2xl border border-border bg-popover p-2 shadow-[var(--shadow-lift)]"
        >
          {isLoading && (
            <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading catalog…
            </div>
          )}

          {!showResults && !isLoading && (
            <div className="space-y-3 p-2">
              {recent.length > 0 && (
                <div>
                  <p className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Recent searches
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {recent.map((term) => (
                      <button
                        key={term}
                        onClick={() => submit(term)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs transition-colors hover:border-primary hover:text-primary"
                      >
                        <Clock className="h-3 w-3" /> {term}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <p className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Popular right now
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {POPULAR_SEARCHES.map((term) => (
                    <button
                      key={term}
                      onClick={() => submit(term)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
                    >
                      <TrendingUp className="h-3 w-3" /> {term}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {showResults && !isLoading && (
            <div className="space-y-2">
              {matches.length > 0 && (
                <div>
                  <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Top matches
                  </p>
                  {matches.map(({ product }, i) => {
                    const n = product.node;
                    const img = n.images.edges[0]?.node;
                    return (
                      <button
                        key={n.id}
                        onMouseEnter={() => setActiveIndex(i)}
                        onClick={() => goToProduct(n.handle)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors",
                          i === activeIndex ? "bg-accent" : "hover:bg-muted",
                        )}
                      >
                        <span className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-border bg-secondary">
                          {img && <img src={img.url} alt={img.altText ?? n.title} className="h-full w-full object-cover" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">
                            <Highlighted text={n.title} query={debounced} />
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {n.productType || n.vendor || "VS Store"}
                          </span>
                        </span>
                        <span className="shrink-0 text-sm font-semibold">
                          {formatMoney(n.priceRange.minVariantPrice.amount, n.priceRange.minVariantPrice.currencyCode)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {collectionMatches.length > 0 && (
                <div>
                  <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Collections
                  </p>
                  <div className="flex flex-wrap gap-1.5 px-3 pb-2">
                    {collectionMatches.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          setOpen(false);
                          onNavigate?.();
                          navigate({ to: "/collections/$handle", params: { handle: c.handle } });
                        }}
                        className="rounded-full border border-border px-3 py-1.5 text-xs transition-colors hover:border-primary hover:text-primary"
                      >
                        {c.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {categories.length > 0 && (
                <div>
                  <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Suggested categories
                  </p>
                  <div className="flex flex-wrap gap-1.5 px-3 pb-2">
                    {categories.map((c) => (
                      <button
                        key={c}
                        onClick={() => submit(c)}
                        className="rounded-full bg-secondary px-3 py-1.5 text-xs transition-colors hover:bg-accent"
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {matches.length === 0 && collectionMatches.length === 0 && (
                <div className="space-y-3 px-3 py-6 text-center">
                  <p className="text-sm font-medium">No matches for “{debounced}”</p>
                  <p className="text-xs text-muted-foreground">Try a broader term or browse popular searches.</p>
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {POPULAR_SEARCHES.slice(0, 3).map((term) => (
                      <button
                        key={term}
                        onClick={() => submit(term)}
                        className="rounded-full bg-secondary px-3 py-1.5 text-xs transition-colors hover:bg-accent"
                      >
                        {term}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
