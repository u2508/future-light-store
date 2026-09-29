import { buildVariantOptionGroups } from "@/lib/product-variant-selection.mjs";
import type { ShopifyVariant } from "@/lib/shopify";
import { cn } from "@/lib/utils";

export function ProductVariantOptions({
  options,
  variants,
  selectedVariantId,
  unavailableVariantIds,
  productTitle,
  compact = false,
  onSelect,
}: {
  options: Array<{ name: string; values: string[] }>;
  variants: ShopifyVariant[];
  selectedVariantId: string | null;
  unavailableVariantIds: Set<string>;
  productTitle: string;
  compact?: boolean;
  onSelect: (variant: ShopifyVariant) => void;
}) {
  const groups = buildVariantOptionGroups({
    options,
    variants,
    selectedVariantId,
    unavailableVariantIds,
    productTitle,
  });

  if (!groups.length) return null;

  return (
    <div className={compact ? "space-y-3" : "space-y-4"} aria-label="Product options">
      {groups.map((group) => (
        <fieldset key={group.name} className="min-w-0">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {group.label}
          </legend>
          <div className="flex flex-wrap gap-2">
            {group.values.map((value) => {
              const nextVariant = variants.find((variant) => variant.id === value.variantId);
              const disabled = !value.available || !nextVariant;
              return (
                <button
                  type="button"
                  key={value.value}
                  disabled={disabled}
                  aria-pressed={value.selected}
                  aria-label={`${group.label}: ${value.displayValue}${disabled ? ", unavailable" : ""}`}
                  data-testid="variant-option-value"
                  onClick={() => nextVariant && onSelect(nextVariant)}
                  className={cn(
                    "inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors",
                    compact && "px-2.5 text-xs",
                    value.selected
                      ? "border-primary bg-accent text-accent-foreground"
                      : "border-border hover:border-primary",
                    disabled && "cursor-not-allowed opacity-40 line-through",
                  )}
                >
                  {value.image && (
                    <img
                      src={value.image.url}
                      alt=""
                      loading="lazy"
                      className={cn(
                        "h-7 w-7 shrink-0 rounded-md border border-border/70 object-cover",
                        compact && "h-6 w-6",
                      )}
                    />
                  )}
                  <span>{value.displayValue}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
