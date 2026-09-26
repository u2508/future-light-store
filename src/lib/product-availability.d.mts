export type ProductAvailability = "available" | "unavailable" | "unknown";

export function getProductAvailability(product: {
  availableForSale?: boolean | null;
  variants?: {
    edges?: Array<{ node?: { availableForSale?: boolean | null } | null } | null>;
  } | null;
} | null | undefined): ProductAvailability;

export function isProductExplicitlyAvailable(
  product: Parameters<typeof getProductAvailability>[0],
): boolean;
