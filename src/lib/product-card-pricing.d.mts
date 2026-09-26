type Money = { amount: string; currencyCode: string };

type ProductCardPricingInput = {
  variants?: {
    edges?: Array<{
      node?: {
        price?: Money;
        compareAtPrice?: Money | null;
        availableForSale?: boolean;
      } | null;
    }>;
  };
  variantsCount?: { count?: number };
  priceRange?: { minVariantPrice?: Money };
};

export function resolveProductCardPricing(product: ProductCardPricingInput): {
  price: Money | null;
  compareAt: string | null;
  showFrom: boolean;
};
