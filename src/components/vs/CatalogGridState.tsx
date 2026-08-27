import type { ReactNode } from "react";
import { AlertTriangle, Loader2, PackageOpen, RefreshCw } from "lucide-react";
import type { ShopifyProduct } from "@/lib/shopify";
import { ProductCard } from "@/components/vs/ProductCard";

interface CatalogRequestErrorProps {
  title: string;
  description?: string;
  onRetry?: (() => void) | undefined;
  isRetrying?: boolean | undefined;
}

export function CatalogRequestError({
  title,
  description = "Check your connection and try again.",
  onRetry,
  isRetrying = false,
}: CatalogRequestErrorProps) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="vs-card flex flex-col items-center gap-2 px-6 py-12 text-center"
    >
      <AlertTriangle className="h-8 w-8 text-signal" aria-hidden="true" />
      <p className="font-display text-lg font-semibold">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={isRetrying}
          className="mt-2 inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold transition-colors hover:border-primary hover:text-primary disabled:cursor-wait disabled:opacity-60"
        >
          {isRetrying ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {isRetrying ? "Trying again…" : "Try again"}
        </button>
      ) : null}
    </div>
  );
}

interface CatalogEmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
  compact?: boolean;
}

export function CatalogEmptyState({
  title,
  description,
  action,
  compact = false,
}: CatalogEmptyStateProps) {
  return (
    <div
      role="status"
      className={`rounded-3xl border border-border bg-card text-center ${
        compact ? "px-4 py-8" : "px-6 py-12"
      }`}
    >
      <PackageOpen
        className={`mx-auto text-muted-foreground ${compact ? "h-6 w-6" : "h-8 w-8"}`}
        aria-hidden="true"
      />
      <p className={`font-display font-semibold ${compact ? "mt-3 text-sm" : "mt-3 text-lg"}`}>
        {title}
      </p>
      <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-muted-foreground">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

interface ProductCatalogGridStateProps {
  products: ShopifyProduct[];
  isLoading: boolean;
  isError: boolean;
  gridClassName: string;
  loadingLabel: string;
  errorTitle: string;
  errorDescription?: string;
  emptyTitle: string;
  emptyDescription: string;
  emptyAction?: ReactNode;
  onRetry?: (() => void) | undefined;
  isRetrying?: boolean | undefined;
  skeletonCount?: number;
}

export function ProductCatalogGridState({
  products,
  isLoading,
  isError,
  gridClassName,
  loadingLabel,
  errorTitle,
  errorDescription,
  emptyTitle,
  emptyDescription,
  emptyAction,
  onRetry,
  isRetrying,
  skeletonCount = 8,
}: ProductCatalogGridStateProps) {
  if (isError) {
    return (
      <CatalogRequestError
        title={errorTitle}
        description={errorDescription}
        onRetry={onRetry}
        isRetrying={isRetrying}
      />
    );
  }

  if (isLoading) {
    return (
      <ProductCatalogSkeleton
        count={skeletonCount}
        gridClassName={gridClassName}
        label={loadingLabel}
      />
    );
  }

  if (products.length === 0) {
    return (
      <CatalogEmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
    );
  }

  return (
    <div className={gridClassName} aria-label={`${products.length} products`}>
      {products.map((product) => (
        <ProductCard key={product.node.id} product={product} />
      ))}
    </div>
  );
}

export function ProductCatalogSkeleton({
  count,
  gridClassName,
  label,
}: {
  count: number;
  gridClassName: string;
  label: string;
}) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" aria-label={label}>
      <span className="sr-only">{label}</span>
      <div className={gridClassName} aria-hidden="true">
        {Array.from({ length: count }, (_, index) => (
          <div key={index} className="vs-card overflow-hidden">
            <div className="aspect-square animate-pulse bg-muted" />
            <div className="space-y-3 p-3">
              <div className="h-3.5 w-4/5 animate-pulse rounded bg-muted" />
              <div className="flex items-end justify-between gap-3">
                <div className="h-5 w-2/5 animate-pulse rounded bg-muted" />
                <div className="h-9 w-9 animate-pulse rounded-xl bg-muted" />
              </div>
              <div className="h-2.5 w-3/5 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CollectionCardGridSkeleton({
  count = 8,
  label = "Loading collections",
}: {
  count?: number;
  label?: string;
}) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" aria-label={label}>
      <span className="sr-only">{label}</span>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-hidden="true">
        {Array.from({ length: count }, (_, index) => (
          <div key={index} className="overflow-hidden rounded-3xl border border-border/70 bg-card">
            <div className="h-36 animate-pulse bg-muted" />
            <div className="space-y-3 p-5">
              <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
              <div className="h-3 w-full animate-pulse rounded bg-muted" />
              <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CollectionListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Loading collection shortcuts"
    >
      <span className="sr-only">Loading collection shortcuts</span>
      <div className="space-y-2" aria-hidden="true">
        {Array.from({ length: count }, (_, index) => (
          <div key={index} className="h-14 animate-pulse rounded-2xl bg-muted" />
        ))}
      </div>
    </div>
  );
}
