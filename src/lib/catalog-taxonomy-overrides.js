import { CATALOG_TAXONOMY_IMAGE_OVERRIDES } from "./catalog-taxonomy-image-overrides.js";

// Product-specific corrections are deliberately source-controlled. An override
// can only select an existing taxonomy rule and must be explicitly approved.
export const CATALOG_TAXONOMY_OVERRIDE_VERSION = "2026-08-01.2";

const MANUAL_CATALOG_TAXONOMY_OVERRIDES = Object.freeze([
  // {
  //   id: "approved-example",
  //   handle: "example-product-handle",
  //   ruleId: "existing-taxonomy-rule-id",
  //   approved: true,
  //   reason: "Reviewed product-level correction.",
  // },
]);

export const CATALOG_TAXONOMY_OVERRIDES = Object.freeze([
  ...MANUAL_CATALOG_TAXONOMY_OVERRIDES,
  ...CATALOG_TAXONOMY_IMAGE_OVERRIDES,
]);

function normalizeHandle(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeId(value) {
  const id = String(value || "").trim();
  if (!id) return "";
  const shopifyProductId = id.match(/(?:gid:\/\/shopify\/Product\/)?(\d+)$/i);
  return shopifyProductId?.[1] || id;
}

export function getCatalogTaxonomyOverride(product) {
  const productId = normalizeId(product?.id);
  const handle = normalizeHandle(product?.handle);
  return CATALOG_TAXONOMY_OVERRIDES.find((override) => {
    if (!override?.approved || !override?.ruleId) return false;
    if (productId && normalizeId(override.productId) === productId) return true;
    return handle && normalizeHandle(override.handle) === handle;
  }) || null;
}
