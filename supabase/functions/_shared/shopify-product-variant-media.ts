type MediaImage = {
  id: string | null;
  url: string;
  altText: string | null;
  variantIds: string[];
};

type ProductPayload = {
  images?: unknown[];
  variants?: Array<{
    id?: unknown;
    featured_image?: {
      id?: unknown;
      src?: unknown;
      alt?: unknown;
      variant_ids?: unknown;
    } | null;
  }>;
};

/**
 * Normalize the public Shopify product JSON into one image list. A variant's
 * own featured_image is direct evidence that the image belongs to that exact
 * variant, even if Shopify omits variant_ids from the nested image object.
 */
export function extractShopifyProductVariantMedia(
  product: ProductPayload,
  normalizeImageUrl: (value: unknown) => string,
  numericId: (value: unknown) => string,
): MediaImage[] {
  const imagesByUrl = new Map<string, MediaImage>();
  const imageUrl = (source: unknown) => {
    if (typeof source === "string") return normalizeImageUrl(source);
    if (!source || typeof source !== "object") return "";
    const record = source as Record<string, unknown>;
    return normalizeImageUrl(record.src ?? record.url);
  };

  for (const source of Array.isArray(product.images) ? product.images.slice(0, 250) : []) {
    const url = imageUrl(source);
    if (!url || imagesByUrl.has(url)) continue;
    const record =
      source && typeof source === "object" ? (source as Record<string, unknown>) : null;
    imagesByUrl.set(url, {
      id: numericId(record?.id) || null,
      url,
      altText: typeof record?.alt === "string" ? record.alt.slice(0, 500) : null,
      variantIds: [],
    });
  }

  for (const variant of Array.isArray(product.variants) ? product.variants.slice(0, 10_000) : []) {
    const featured = variant?.featured_image;
    const url = imageUrl(featured?.src);
    if (!url) continue;
    const image = imagesByUrl.get(url) ?? {
      id: numericId(featured?.id) || null,
      url,
      altText: typeof featured?.alt === "string" ? featured.alt.slice(0, 500) : null,
      variantIds: [],
    };
    const nestedIds = Array.isArray(featured?.variant_ids) ? featured.variant_ids : [];
    const ids = [variant.id, ...nestedIds].map(numericId).filter(Boolean);
    image.variantIds = [...new Set([...image.variantIds, ...ids])].slice(0, 10_000);
    if (!image.id) image.id = numericId(featured?.id) || null;
    if (!image.altText && typeof featured?.alt === "string") {
      image.altText = featured.alt.slice(0, 500);
    }
    imagesByUrl.set(url, image);
  }

  return [...imagesByUrl.values()];
}
