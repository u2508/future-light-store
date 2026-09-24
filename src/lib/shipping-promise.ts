/**
 * Customer-facing US delivery promise verified against the current Shopify
 * Store default shipping profile. Keep the checkout wording as the final
 * authority because eligibility, taxes, and destination exceptions are
 * calculated by Shopify for the actual address and cart.
 */
export const US_SHIPPING_PROMISE = {
  label: "US standard shipping",
  cost: "Free",
  estimate: "5–8 business days",
  summary: "Free standard US shipping · 5–8 business days",
} as const;
