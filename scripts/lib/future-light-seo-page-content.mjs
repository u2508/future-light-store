const countFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function positiveCount(value) {
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
}

export function resolveCollectionProducts(productIds, productsById) {
  if (!Array.isArray(productIds) || !(productsById instanceof Map)) return [];
  return productIds.map((id) => productsById.get(String(id))).filter(Boolean);
}

export function formatProductPriceRange(product) {
  const prices = (Array.isArray(product?.variants) ? product.variants : [])
    .map((variant) => Number(variant?.price))
    .filter((price) => Number.isFinite(price) && price >= 0);

  if (!prices.length) return "";

  const lowest = Math.min(...prices);
  const highest = Math.max(...prices);
  return lowest === highest
    ? usdFormatter.format(lowest)
    : `${usdFormatter.format(lowest)}–${usdFormatter.format(highest)}`;
}

export function buildHomepageAnswer({
  productCount,
  collectionCount,
  catalogDate,
  shippingSummary,
} = {}) {
  const products = positiveCount(productCount);
  const collections = positiveCount(collectionCount);
  const catalogLine =
    products && collections
      ? `The Shopify catalog snapshot dated ${catalogDate || "at the latest build"} contains ${countFormatter.format(products)} product listings across ${countFormatter.format(collections)} collections.`
      : "Browse the Shopify catalog by collection, product details and available options.";

  return [
    "VS Associates is a curated online marketplace for practical everyday essentials, home, tech and lifestyle products.",
    catalogLine,
    "Product pages present the listing photos, description, variants and prices; Shopify checkout confirms the final total and delivery details for the shopper’s address.",
    shippingSummary,
  ]
    .filter(Boolean)
    .join(" ");
}

export function buildHomepageMetaDescription({ productCount, collectionCount } = {}) {
  const products = countFormatter.format(positiveCount(productCount));
  const collections = countFormatter.format(positiveCount(collectionCount));
  return `Shop ${products} products across ${collections} VS Associates collections. Free US shipping; 5–8 business days after dispatch plus 1–2 processing days. Secure Shopify checkout.`;
}

export function buildCollectionAnswer({ title, productCount, catalogDate } = {}) {
  const label = String(title || "This").trim();
  const count = positiveCount(productCount);
  const countLine = count
    ? `The ${label} collection at VS Associates contains ${countFormatter.format(count)} product listings in the Shopify catalog snapshot dated ${catalogDate || "at the latest build"}.`
    : `Browse the ${label} collection at VS Associates.`;

  return `${countLine} Use the product links below to compare listing photos, product-specific details, variant options and prices. Open a listing for live product information; Shopify checkout confirms availability and delivery details for the entered address.`;
}
