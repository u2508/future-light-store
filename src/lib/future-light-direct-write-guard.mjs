const DIRECT_WRITE_RUNNERS = new Set([
  "orders-bundle",
  "seo-release",
  "gpt-seo",
  "variant-cost-price-alignment",
  "price-rework",
  "seo-final-artifact",
  "curated-seo-apply",
  "specificity-repair",
  "new-product-seo-pipeline",
  "automatic-variant-image-mapping",
  "visual-variant-apply",
]);

const DIRECT_WRITE_REASONS = Object.freeze({
  "orders-bundle": "its default bundle multiplier is not bound to live costs, current market evidence, or the approved price manifest",
  "seo-release": "it can write inferred SEO and quantity-tier prices without the approved copy and pricing manifests",
  "gpt-seo": "it can write generated copy without consuming the exact approved-copy manifest and checking live preimages",
  "variant-cost-price-alignment": "it aligns prices from cost groups without approved product-specific market and basket-economics evidence",
  "price-rework": "the required per-order cost allocation, reviewed comparables, and matching approved price manifest are not complete",
  "seo-final-artifact": "it can apply a local storefront artifact without a current, reviewed product-bound copy approval manifest",
  "curated-seo-apply": "it can mutate Shopify before enforcing a reviewed copy approval manifest and the exact current product preimage",
  "specificity-repair": "its hard-coded copy repairs do not consume the current source-bound approval manifest",
  "new-product-seo-pipeline": "it writes Google-specific variant metafields, outside the Shopify-only approved scope, and does not consume the reviewed copy manifest",
  "automatic-variant-image-mapping": "nearest-image matching can attach a different product or option image; variant media requires exact, product-bound visual approval",
  "visual-variant-apply": "the local visual approval flow is not yet fully bound to typed Shopify identities and generated-asset content hashes",
});

export function assertFutureLightDirectWriteDisabled({ runner, mode }) {
  const runnerName = String(runner || "");
  if (mode !== "apply" || !DIRECT_WRITE_RUNNERS.has(runnerName)) return true;
  throw new Error(
    `Direct ${runnerName} Shopify apply is blocked: ${DIRECT_WRITE_REASONS[runnerName]}. ` +
      "No Shopify request or mutation was made. Use only the guarded Future Light release after its live handlers and readbacks are enabled.",
  );
}
