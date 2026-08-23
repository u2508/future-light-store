import { formatMoneyValue, normalizePlainText, parseMoneyValue } from "./shopify-seo-batch.js";

const VARIANT_SEO_TITLE_MAX = 70;
const VARIANT_SEO_SITE_SUFFIX = " | Future Light Store";

function shorten(value, maxLength) {
  const text = normalizePlainText(value);
  if (maxLength <= 0) return "";
  if (text.length <= maxLength) return text;
  const truncated = text.slice(0, maxLength + 1);
  const boundary = truncated.lastIndexOf(" ");
  return `${(boundary > maxLength * 0.65 ? truncated.slice(0, boundary) : truncated.slice(0, maxLength)).replace(/[\s,;:|/-]+$/g, "")}`;
}

function buildVariantSeoTitle(productTitle, label, collisionNumber = 0) {
  const normalizedProductTitle = normalizePlainText(productTitle || "Future Light Store product");
  const normalizedLabel = normalizePlainText(label);
  const collisionSuffix = collisionNumber > 1 ? ` (${collisionNumber})` : "";
  const separator = normalizedLabel ? " - " : "";
  const fixedLength = VARIANT_SEO_SITE_SUFFIX.length + separator.length + collisionSuffix.length;
  const contentBudget = Math.max(1, VARIANT_SEO_TITLE_MAX - fixedLength);

  // Keep enough product context for search while reserving the remaining title
  // budget for the exact option label. This prevents long product titles from
  // truncating away the variant identity.
  const minimumProductLength = normalizedLabel ? Math.min(18, contentBudget) : contentBudget;
  const productBudget = normalizedLabel
    ? Math.min(
        Math.max(1, contentBudget - Math.min(normalizedLabel.length, contentBudget - minimumProductLength)),
        Math.max(1, contentBudget - 1),
      )
    : contentBudget;
  const remainingLabelBudget = Math.max(0, contentBudget - productBudget);
  const productText = shorten(normalizedProductTitle, productBudget);
  const labelText = normalizedLabel
    ? shorten(normalizedLabel, Math.max(1, remainingLabelBudget))
    : "";
  const content = labelText ? `${productText}${separator}${labelText}` : productText;
  return `${content}${collisionSuffix}${VARIANT_SEO_SITE_SUFFIX}`.slice(0, VARIANT_SEO_TITLE_MAX);
}

export function variantSeoLabel(variant) {
  const title = normalizePlainText(variant?.title || "");
  if (!title || /^default\s+title$/i.test(title)) return "";
  return title;
}

export function buildVariantSeoProfile(product, variant, { currency = "USD" } = {}) {
  const productTitle = normalizePlainText(product?.title || "Future Light Store product");
  const label = variantSeoLabel(variant);
  const price = parseMoneyValue(variant?.price);
  const title = buildVariantSeoTitle(productTitle, label);
  const priceText = Number.isFinite(price) && price > 0 ? ` Available for ${formatMoneyValue(price)} ${currency}.` : "";
  const description = shorten(
    `Shop ${productTitle}${label ? ` in the ${label} option` : ""}. See the exact variant image, availability, and pricing before checkout.${priceText}`,
    160,
  );

  return {
    variantId: String(variant?.id || variant?.variantId || ""),
    label: label || "Standard Option",
    title,
    description,
    price: Number.isFinite(price) ? price.toFixed(2) : "",
    currency,
  };
}

export function buildVariantSeoProfiles(product, { currency = "USD" } = {}) {
  const variants = Array.isArray(product?.variants)
    ? product.variants
    : Array.isArray(product?.variants?.nodes)
      ? product.variants.nodes
      : [];
  const productTitle = normalizePlainText(product?.title || "Future Light Store product");
  const usedTitles = new Set();

  return variants.map((variant) => {
    const profile = buildVariantSeoProfile(product, variant, { currency });
    const label = profile.label === "Standard Option" ? "" : profile.label;
    let collisionNumber = 0;
    let title = profile.title;
    while (usedTitles.has(title.toLowerCase())) {
      collisionNumber += 1;
      title = buildVariantSeoTitle(productTitle, label, collisionNumber + 1);
    }
    usedTitles.add(title.toLowerCase());
    return title === profile.title ? profile : { ...profile, title };
  });
}

export function hasDistinctVariantSeo(product) {
  const profiles = buildVariantSeoProfiles(product);
  return profiles.length > 1 && new Set(profiles.map((profile) => profile.label.toLowerCase())).size > 1;
}
