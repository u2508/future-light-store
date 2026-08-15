import { Link } from "@tanstack/react-router";
import type { ShopifyProduct } from "@/lib/shopify";
import { ProductCard, ProductGridSkeleton, EmptyProducts } from "@/components/vs/ProductCard";

export function SectionHeading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string | undefined;
  action?: { label: string; to: "/shop" | "/offers" } | undefined;
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action && (
        <Link to={action.to} className="shrink-0 text-sm font-semibold text-primary hover:underline">
          {action.label} →
        </Link>
      )}
    </div>
  );
}

export function ProductShelf({
  title,
  subtitle,
  products,
  isLoading,
  action,
  emptyMessage,
}: {
  title: string;
  subtitle?: string | undefined;
  products: ShopifyProduct[];
  isLoading?: boolean | undefined;
  action?: { label: string; to: "/shop" | "/offers" } | undefined;
  emptyMessage?: string | undefined;
}) {
  return (
    <section className="mx-auto max-w-7xl px-4 py-10">
      <SectionHeading title={title} subtitle={subtitle} action={action} />
      {isLoading ? (
        <ProductGridSkeleton count={4} />
      ) : products.length === 0 ? (
        <EmptyProducts message={emptyMessage ?? "No products found"} />
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {products.map((p) => (
            <ProductCard key={p.node.id} product={p} />
          ))}
        </div>
      )}
    </section>
  );
}
