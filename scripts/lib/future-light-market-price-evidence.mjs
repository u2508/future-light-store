import { createHash } from "node:crypto";

const MAX_EVIDENCE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const PRODUCT_GID = /^gid:\/\/shopify\/Product\/\d+$/;
const VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/\d+$/;

function reject(message) {
  throw new Error(`Market-price evidence rejected: ${message}`);
}

export function validateMarketPriceEvidence(
  document,
  { storeDomain, currencyCode, now = Date.now() } = {},
) {
  if (!document || document.schemaVersion !== 1) reject("schemaVersion must be 1.");
  const expectedStore = String(storeDomain || "")
    .trim()
    .toLowerCase();
  const evidenceStore = String(document.storeDomain || "")
    .trim()
    .toLowerCase();
  if (!expectedStore || evidenceStore !== expectedStore)
    reject("store domain does not match the verified Shopify target.");

  const expectedCurrency = String(currencyCode || "")
    .trim()
    .toUpperCase();
  const evidenceCurrency = String(document.currencyCode || "")
    .trim()
    .toUpperCase();
  if (expectedCurrency !== "USD" || evidenceCurrency !== expectedCurrency)
    reject("both live store and evidence currency must be USD.");

  const createdAt = Date.parse(document.createdAt || "");
  if (
    !Number.isFinite(createdAt) ||
    createdAt > now + 60 * 60 * 1000 ||
    createdAt < now - MAX_EVIDENCE_AGE_MS
  ) {
    reject("manifest creation time is missing, in the future, or older than 30 days.");
  }
  if (!Array.isArray(document.products)) reject("products must be an array.");

  const byVariantId = new Map();
  const productIds = new Set();
  for (const product of document.products) {
    const productId = String(product?.productId || "").trim();
    if (!PRODUCT_GID.test(productId))
      reject("every record must contain a full Shopify Product GID.");
    if (productIds.has(productId)) reject(`duplicate product record ${productId}.`);
    productIds.add(productId);
    if (!Array.isArray(product.variants)) reject(`variants must be an array for ${productId}.`);
    for (const variant of product.variants) {
      const variantId = String(variant?.variantId || "").trim();
      if (!VARIANT_GID.test(variantId))
        reject(`every variant must contain a full Shopify ProductVariant GID under ${productId}.`);
      if (byVariantId.has(variantId)) reject(`duplicate variant record ${variantId}.`);
      byVariantId.set(variantId, { ...variant, productId });
    }
  }

  return {
    createdAt: new Date(createdAt).toISOString(),
    storeDomain: expectedStore,
    currencyCode: expectedCurrency,
    byVariantId,
    fingerprint: createHash("sha256").update(JSON.stringify(document)).digest("hex"),
  };
}

/** Ensure every evidence row's variant still belongs to its declared live Shopify product. */
export function assertMarketPriceEvidenceOwnership(marketEvidence, liveProducts) {
  if (!marketEvidence?.byVariantId || !(marketEvidence.byVariantId instanceof Map))
    throw new TypeError("Validated market evidence with a variant map is required.");
  if (!Array.isArray(liveProducts))
    throw new TypeError("A complete live Shopify product catalog is required.");

  const liveVariantsByProduct = new Map();
  for (const product of liveProducts) {
    const productId = String(product?.id || "");
    const variants = Array.isArray(product?.variants?.nodes)
      ? product.variants.nodes
      : Array.isArray(product?.variants)
        ? product.variants
        : [];
    liveVariantsByProduct.set(productId, new Set(variants.map((variant) => String(variant?.id || ""))));
  }

  for (const [variantId, evidence] of marketEvidence.byVariantId) {
    const productId = String(evidence?.productId || "");
    if (!liveVariantsByProduct.get(productId)?.has(String(variantId))) {
      throw new Error(
        `Market-price evidence is stale or maps ${variantId} to a different live Shopify product. No price was planned.`,
      );
    }
  }
  return true;
}

export const MARKET_PRICE_EVIDENCE_MAX_AGE_DAYS = MAX_EVIDENCE_AGE_MS / (24 * 60 * 60 * 1000);
