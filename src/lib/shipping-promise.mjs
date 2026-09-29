/**
 * Customer-facing US delivery promise, combining the confirmed dispatch
 * processing window with the Shopify shipping profile's transit estimate.
 * Checkout remains the authority for address- and cart-specific details.
 */
export const US_SHIPPING_PROMISE = Object.freeze({
  label: "US standard shipping",
  cost: "Free",
  estimate: "5–8 business days after dispatch",
  processing: "1–2 business days",
  summary:
    "Free standard US shipping · 5–8 business days after dispatch; allow 1–2 business days for processing (about 6–10 business days total)",
});
