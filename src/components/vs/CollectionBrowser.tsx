import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, SlidersHorizontal, X } from "lucide-react";
import type { ShopifyProduct } from "@/lib/shopify";
import { discountPercent, type ShopifyCollection } from "@/lib/shopify";
import { searchProducts } from "@/lib/vs-search";
import { cn } from "@/lib/utils";
import {
  CatalogEmptyState,
  CollectionListSkeleton,
  ProductCatalogGridState,
} from "@/components/vs/CatalogGridState";

export interface BrowserSearch {
  q: string;
  min_price: number;
  max_price: number;
  availability: string;
  tag: string;
  category: string;
  vendor: string;
  size: string;
  color: string;
  discount: number;
  sort: string;
}

const SORTS = [
  { value: "featured", label: "Featured" },
  { value: "newest", label: "Newest" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
  { value: "discount", label: "Biggest discount" },
  { value: "best-selling", label: "Best selling" },
];

function variantOptionValues(products: ShopifyProduct[], optionName: string) {
  const values = new Set<string>();
  products.forEach((p) =>
    p.node.options.forEach((o) => {
      if (o.name.toLowerCase() === optionName) o.values.forEach((v) => values.add(v));
    }),
  );
  return [...values].slice(0, 14);
}

export function CollectionBrowser({
  title,
  description,
  products,
  collections,
  collectionsLoading,
  isLoading,
  isError,
  routeTo,
  search,
}: {
  title: string;
  description?: string;
  products: ShopifyProduct[];
  collections: ShopifyCollection[];
  collectionsLoading: boolean;
  isLoading: boolean;
  isError?: boolean;
  routeTo: "/shop";
  search: BrowserSearch;
}) {
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const setFilter = (patch: Partial<BrowserSearch>) => {
    navigate({ to: routeTo, search: (prev) => ({ ...(prev as BrowserSearch), ...patch }) });
  };
  const clearAll = () =>
    navigate({
      to: routeTo,
      search: {
        q: search.q,
        min_price: 0,
        max_price: 0,
        availability: "",
        tag: "",
        category: "",
        vendor: "",
        size: "",
        color: "",
        discount: 0,
        sort: "featured",
      },
    });

  const tags = useMemo(() => {
    const t = new Set<string>();
    products.forEach((p) => p.node.tags?.forEach((tag) => t.add(tag)));
    return [...t].slice(0, 16);
  }, [products]);
  const categories = useMemo(
    () => [...new Set(products.map((p) => p.node.productType).filter(Boolean))],
    [products],
  );
  const vendors = useMemo(
    () => [...new Set(products.map((p) => p.node.vendor).filter(Boolean))],
    [products],
  );
  const sizes = useMemo(() => variantOptionValues(products, "size"), [products]);
  const colors = useMemo(() => variantOptionValues(products, "color"), [products]);
  const maxCatalogPrice = useMemo(
    () =>
      Math.ceil(
        products.reduce(
          (max, p) => Math.max(max, parseFloat(p.node.priceRange.minVariantPrice.amount)),
          0,
        ) || 1000,
      ),
    [products],
  );

  const filtered = useMemo(() => {
    let list = products;
    if (search.q) list = searchProducts(list, search.q).map((m) => m.product);

    list = list.filter((p) => {
      const n = p.node;
      const variants = n.variants.edges.map((v) => v.node);
      const price = parseFloat(n.priceRange.minVariantPrice.amount);
      const compareAt = variants[0]?.compareAtPrice?.amount ?? null;
      const off = discountPercent(String(price), compareAt);
      const stockQty = variants.reduce((sum, v) => sum + (v.quantityAvailable ?? 0), 0);

      if (search.min_price && price < search.min_price) return false;
      if (search.max_price && price > search.max_price) return false;
      if (search.availability === "in-stock" && !n.availableForSale) return false;
      if (search.availability === "out-of-stock" && n.availableForSale) return false;
      if (
        search.availability === "low-stock" &&
        !(n.availableForSale && stockQty > 0 && stockQty <= 5)
      )
        return false;
      if (search.tag && !(n.tags ?? []).includes(search.tag)) return false;
      if (search.category && n.productType !== search.category) return false;
      if (search.vendor && n.vendor !== search.vendor) return false;
      if (search.discount && off < search.discount) return false;
      if (
        search.size &&
        !variants.some((v) =>
          v.selectedOptions.some((o) => o.name.toLowerCase() === "size" && o.value === search.size),
        )
      )
        return false;
      if (
        search.color &&
        !variants.some((v) =>
          v.selectedOptions.some(
            (o) => o.name.toLowerCase() === "color" && o.value === search.color,
          ),
        )
      )
        return false;
      return true;
    });

    const priceOf = (p: ShopifyProduct) => parseFloat(p.node.priceRange.minVariantPrice.amount);
    const sorted = [...list];
    if (search.sort === "price-asc") sorted.sort((a, b) => priceOf(a) - priceOf(b));
    else if (search.sort === "price-desc") sorted.sort((a, b) => priceOf(b) - priceOf(a));
    else if (search.sort === "discount")
      sorted.sort(
        (a, b) =>
          discountPercent(
            b.node.priceRange.minVariantPrice.amount,
            b.node.variants.edges[0]?.node.compareAtPrice?.amount ?? null,
          ) -
          discountPercent(
            a.node.priceRange.minVariantPrice.amount,
            a.node.variants.edges[0]?.node.compareAtPrice?.amount ?? null,
          ),
      );
    return sorted;
  }, [products, search]);

  const activeChips = [
    search.availability && {
      label: search.availability.replace("-", " "),
      clear: { availability: "" },
    },
    search.tag && { label: `Tag: ${search.tag}`, clear: { tag: "" } },
    search.category && { label: search.category, clear: { category: "" } },
    search.vendor && { label: search.vendor, clear: { vendor: "" } },
    search.size && { label: `Size ${search.size}`, clear: { size: "" } },
    search.color && { label: search.color, clear: { color: "" } },
    search.discount > 0 && { label: `${search.discount}%+ off`, clear: { discount: 0 } },
    (search.min_price > 0 || search.max_price > 0) && {
      label: `$${search.min_price} – $${search.max_price || maxCatalogPrice}`,
      clear: { min_price: 0, max_price: 0 },
    },
  ].filter(Boolean) as Array<{ label: string; clear: Partial<BrowserSearch> }>;

  const FilterPanel = (
    <div className="space-y-6">
      <fieldset>
        <legend className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Price
        </legend>
        <input
          type="range"
          min={0}
          max={maxCatalogPrice}
          value={search.max_price || maxCatalogPrice}
          onChange={(e) => setFilter({ max_price: Number(e.target.value) })}
          className="w-full accent-[var(--primary)]"
          aria-label="Maximum price"
        />
        <div className="mt-2 flex items-center gap-2">
          <input
            type="number"
            id="min_price"
            name="min_price"
            value={search.min_price || ""}
            placeholder="Min"
            aria-label="Minimum price"
            onChange={(e) => setFilter({ min_price: Number(e.target.value) || 0 })}
            className="w-full rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
          />
          <span className="text-muted-foreground">–</span>
          <input
            type="number"
            id="max_price"
            name="max_price"
            value={search.max_price || ""}
            placeholder="Max"
            aria-label="Maximum price"
            onChange={(e) => setFilter({ max_price: Number(e.target.value) || 0 })}
            className="w-full rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
          />
        </div>
      </fieldset>

      <FilterGroup
        label="Availability"
        options={[
          { value: "in-stock", label: "In stock" },
          { value: "low-stock", label: "Low stock" },
          { value: "out-of-stock", label: "Out of stock" },
        ]}
        value={search.availability}
        onChange={(v) => setFilter({ availability: v })}
      />
      {categories.length > 0 && (
        <FilterGroup
          label="Category"
          options={categories.map((c) => ({ value: c, label: c }))}
          value={search.category}
          onChange={(v) => setFilter({ category: v })}
        />
      )}
      {vendors.length > 0 && (
        <FilterGroup
          label="Brand"
          options={vendors.map((v) => ({ value: v, label: v }))}
          value={search.vendor}
          onChange={(v) => setFilter({ vendor: v })}
        />
      )}
      {sizes.length > 0 && (
        <FilterGroup
          label="Size"
          options={sizes.map((s) => ({ value: s, label: s }))}
          value={search.size}
          onChange={(v) => setFilter({ size: v })}
        />
      )}
      {colors.length > 0 && (
        <FilterGroup
          label="Colour"
          options={colors.map((c) => ({ value: c, label: c }))}
          value={search.color}
          onChange={(v) => setFilter({ color: v })}
        />
      )}
      {tags.length > 0 && (
        <FilterGroup
          label="Tags"
          options={tags.map((t) => ({ value: t, label: t }))}
          value={search.tag}
          onChange={(v) => setFilter({ tag: v })}
        />
      )}
      <FilterGroup
        label="Discount"
        options={[10, 25, 50].map((d) => ({ value: String(d), label: `${d}% or more` }))}
        value={search.discount ? String(search.discount) : ""}
        onChange={(v) => setFilter({ discount: Number(v) || 0 })}
      />
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="vs-section-shell rounded-[2rem] p-6 sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">
              Catalog browser
            </p>
            <h1 className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">
              {title}
            </h1>
            {description && (
              <p className="mt-3 text-sm leading-7 text-muted-foreground">{description}</p>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
              <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Sort</p>
              <p className="mt-1 text-sm font-semibold">
                {isError
                  ? "Catalog unavailable"
                  : isLoading
                    ? "Loading catalog"
                    : `${filtered.length} products`}
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
              <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                Filters
              </p>
              <p className="mt-1 text-sm font-semibold">
                {activeChips.length ? `${activeChips.length} active` : "Ready to refine"}
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
              <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                Catalog
              </p>
              <p className="mt-1 text-sm font-semibold">
                {collectionsLoading ? "Syncing collections" : `${collections.length} collections`}
              </p>
            </div>
          </div>
        </div>
      </div>

      <form
        aria-label="Product filters"
        onSubmit={(event) => event.preventDefault()}
        className="mt-8 grid gap-8 xl:grid-cols-[280px_minmax(0,1fr)] 2xl:grid-cols-[280px_minmax(0,1fr)_260px]"
      >
        <aside className="hidden lg:block">
          <div className="sticky top-32 space-y-6 rounded-[2rem] border border-border/70 bg-card p-5 shadow-[var(--shadow-card)]">
            <div className="flex items-center justify-between">
              <p className="font-display font-semibold">Filters</p>
              <button
                type="button"
                onClick={clearAll}
                className="text-xs text-primary hover:underline"
              >
                Clear all
              </button>
            </div>
            {FilterPanel}
          </div>
        </aside>

        <div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm shadow-sm lg:hidden"
            >
              <SlidersHorizontal className="h-4 w-4" /> Filters
            </button>
            <p className="text-sm text-muted-foreground">
              {isError
                ? "Unable to load results"
                : isLoading
                  ? "Loading…"
                  : `${filtered.length} result${filtered.length === 1 ? "" : "s"}`}
            </p>
            <select
              value={search.sort}
              onChange={(e) => setFilter({ sort: e.target.value })}
              aria-label="Sort products"
              className="ml-auto rounded-full border border-border bg-card px-4 py-2 text-sm shadow-sm"
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {activeChips.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {activeChips.map((chip) => (
                <button
                  type="button"
                  key={chip.label}
                  onClick={() => setFilter(chip.clear)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground shadow-sm"
                >
                  {chip.label} <X className="h-3 w-3" />
                </button>
              ))}
              <button
                type="button"
                onClick={clearAll}
                className="text-xs font-semibold text-primary hover:underline"
              >
                Clear all
              </button>
            </div>
          )}

          <ProductCatalogGridState
            products={filtered}
            isLoading={isLoading}
            isError={Boolean(isError)}
            onRetry={() => window.location.reload()}
            loadingLabel="Loading catalog products"
            errorTitle="We couldn’t reach the catalog"
            emptyTitle={
              products.length === 0
                ? "No products available yet"
                : "No products match these filters"
            }
            emptyDescription={
              products.length === 0
                ? "The next catalog drop will appear here as soon as it is available."
                : "Try removing one or more filters to widen your results."
            }
            emptyAction={
              products.length > 0 ? (
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-sm font-semibold text-primary hover:underline"
                >
                  Clear all filters
                </button>
              ) : undefined
            }
            skeletonCount={12}
            gridClassName="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6"
          />
        </div>

        <aside className="hidden 2xl:block">
          <div className="sticky top-32 rounded-[2rem] border border-border/70 bg-card p-5 shadow-[var(--shadow-card)]">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-display font-semibold">Collections</p>
                <p className="text-xs text-muted-foreground">Jump into curated product groups</p>
              </div>
              <span className="text-xs text-muted-foreground">{collections.length}</span>
            </div>
            <div className="mt-4 space-y-2">
              {collectionsLoading ? (
                <CollectionListSkeleton count={6} />
              ) : collections.length === 0 ? (
                <CatalogEmptyState
                  compact
                  title="No collection shortcuts yet"
                  description="Use the filters or browse the product grid while collections are prepared."
                />
              ) : (
                collections.map((collection) => (
                  <Link
                    key={collection.id}
                    to="/collections/$handle"
                    params={{ handle: collection.handle }}
                    className="group flex items-center justify-between rounded-2xl border border-border/70 bg-surface/60 px-3 py-3 transition-colors hover:border-primary hover:bg-accent"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{collection.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {collection.description || "Curated collection"}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                  </Link>
                ))
              )}
            </div>
          </div>
        </aside>
      </form>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="flex-1 bg-foreground/40" onClick={() => setDrawerOpen(false)} />
          <div className="w-[85%] max-w-sm overflow-y-auto bg-card p-5 shadow-[var(--shadow-lift)]">
            <div className="mb-4 flex items-center justify-between">
              <p className="font-display font-semibold">Filters</p>
              <button type="button" onClick={() => setDrawerOpen(false)} aria-label="Close filters">
                <X className="h-4 w-4" />
              </button>
            </div>
            {FilterPanel}
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="mt-6 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground"
            >
              Show {filtered.length} results
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(value === o.value ? "" : o.value)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs capitalize transition-colors",
              value === o.value
                ? "border-primary bg-accent text-accent-foreground"
                : "border-border hover:border-primary",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
