/** Return the exact mapped variant image, or the product's primary gallery image. */
export function selectVariantGalleryIndex(galleryImageUrls, variantImageUrl) {
  if (!Array.isArray(galleryImageUrls)) return 0;
  const normalizedVariantUrl = normalizeImageUrl(variantImageUrl);
  const exactIndex = normalizedVariantUrl
    ? galleryImageUrls.findIndex((url) => normalizeImageUrl(url) === normalizedVariantUrl)
    : -1;
  return exactIndex >= 0 ? exactIndex : 0;
}

function normalizeImageUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  return value.trim().split(/[?#]/, 1)[0];
}

/** Prefer Shopify's explicitly assigned variant image; never infer a color from a filename. */
export function getVariantImage(variant) {
  const image = variant?.image;
  return image?.url ? image : null;
}

/** Merge product images, Shopify media images, and explicit variant images without duplicates. */
export function getProductGalleryImages(product, variants = []) {
  const images = [
    ...(product?.images?.edges ?? []).map((edge) => edge?.node),
    ...(product?.media?.edges ?? [])
      .filter((edge) => edge?.node?.mediaContentType === "IMAGE")
      .map((edge) => {
        const media = edge.node;
        const image = media.image;
        return image?.url ? { ...image, altText: image.altText || media.alt || null } : null;
      }),
    ...variants.map(getVariantImage),
  ];
  const unique = new Map();
  for (const image of images) {
    if (!image?.url) continue;
    const key = normalizeImageUrl(image.url);
    if (!unique.has(key)) unique.set(key, image);
  }
  return [...unique.values()];
}

/** Keep an in-flight shopper selection when asynchronously loaded variant pages arrive. */
export function preserveSelectedVariantId(currentId, variants, preferredId) {
  if (currentId && variants?.some((variant) => variant.id === currentId)) return currentId;
  if (preferredId && variants?.some((variant) => variant.id === preferredId)) return preferredId;
  return variants?.[0]?.id ?? null;
}

/**
 * Merge Shopify's public product JSON media into the Storefront product.
 * Exact Shopify variant_ids are authoritative. When those are absent, only a
 * unique exact option-to-image label match is inferred; ambiguous matches are
 * deliberately left unmapped.
 */
export function mergePublishedProductMedia(product, publishedMedia) {
  if (!product || !publishedMedia || publishedMedia.handle !== product.handle) return product;
  if (normalizeShopifyId(publishedMedia.productId) !== normalizeShopifyId(product.id)) {
    return product;
  }

  const publishedImages = (publishedMedia.images ?? []).filter((image) =>
    isSafeImageUrl(image?.url),
  );
  if (publishedImages.length === 0) return product;

  const gallery = getProductGalleryImages(
    product,
    product.variants?.edges?.map((edge) => edge.node) ?? [],
  );
  const imageByUrl = new Map(gallery.map((image) => [normalizeImageUrl(image.url), image]));
  for (const image of publishedImages) {
    const key = normalizeImageUrl(image.url);
    if (!imageByUrl.has(key))
      imageByUrl.set(key, { url: image.url, altText: image.altText ?? null });
  }
  const mergedImages = [...imageByUrl.values()];
  const primaryUrl = normalizeImageUrl(mergedImages[0]?.url);
  const imageByVariantId = new Map();
  for (const image of publishedImages) {
    for (const variantId of image.variantIds ?? []) {
      const key = normalizeShopifyId(variantId);
      if (key && !imageByVariantId.has(key)) imageByVariantId.set(key, image);
    }
  }
  const variants = (product.variants?.edges ?? []).map((edge) => {
    const variant = edge.node;
    const variantKey = normalizeShopifyId(variant.id);
    const explicitlyMapped = variantKey ? imageByVariantId.get(variantKey) : null;
    const existingImage = getVariantImage(variant);
    const existingImageIsNonPrimary =
      existingImage && normalizeImageUrl(existingImage.url) !== primaryUrl;
    const inferredImage = inferVariantImage(variant, publishedImages);
    const assignedImage =
      explicitlyMapped ?? (existingImageIsNonPrimary ? existingImage : inferredImage);
    return {
      ...variant,
      image: assignedImage
        ? {
            id: assignedImage.id ?? null,
            url: assignedImage.url,
            altText: assignedImage.altText ?? null,
          }
        : null,
    };
  });

  return {
    ...product,
    images: { edges: mergedImages.map((node) => ({ node })) },
    variants: { ...product.variants, edges: variants.map((node) => ({ node })) },
  };
}

function inferVariantImage(variant, images) {
  const eligibleOptions = (variant?.selectedOptions ?? []).filter((option) =>
    /^(color|colour|pattern|finish|style|design)$/i.test(String(option?.name ?? "").trim()),
  );
  for (const option of eligibleOptions) {
    const value = normalizeWords(option?.value);
    if (!value || /^(default title|one size|standard|regular)$/i.test(value)) continue;
    const matching = images.filter((image) => {
      const urlPath = safeUrlPath(image.url);
      const descriptor = normalizeWords(`${image.altText ?? ""} ${urlPath}`);
      return descriptor.includes(value);
    });
    if (matching.length === 1) return matching[0];
  }
  return null;
}

function normalizeShopifyId(value) {
  const id =
    String(value ?? "")
      .split("/")
      .pop() ?? "";
  return /^\d+$/.test(id) ? id : "";
}

function normalizeWords(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function safeUrlPath(value) {
  try {
    return decodeURIComponent(new URL(value).pathname.split("/").pop() ?? "").replace(
      /\.[^.]+$/,
      "",
    );
  } catch {
    return "";
  }
}

function isSafeImageUrl(value) {
  try {
    return new URL(value.startsWith("//") ? `https:${value}` : value).protocol === "https:";
  } catch {
    return false;
  }
}
