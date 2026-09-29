import { findReviewedVariantImage } from "./reviewed-variant-image-mappings.mjs";

const IMAGE_OPTION_NAME =
  /^(color|colour|band color|band style|pattern|design|print|style|finish|tone|shade|appearance)$/i;

/** Return the exact mapped variant image, or the product's primary gallery image. */
export function selectVariantGalleryIndex(galleryImageUrls, variantImageUrl) {
  if (!Array.isArray(galleryImageUrls)) return 0;
  const normalizedVariantUrl = normalizeImageUrl(variantImageUrl);
  const exactIndex = normalizedVariantUrl
    ? galleryImageUrls.findIndex((url) => normalizeImageUrl(url) === normalizedVariantUrl)
    : -1;
  return exactIndex >= 0 ? exactIndex : 0;
}

/** Keep the product gallery visible without implying an unverified variant match. */
export function selectGalleryImageForDisplay(images, preferredIndex, failedImageUrls = new Set()) {
  if (!Array.isArray(images)) return null;
  const isAvailable = (image) => Boolean(image?.url) && !failedImageUrls?.has?.(image.url);
  const preferred = images[preferredIndex];
  if (isAvailable(preferred)) return preferred;
  return images.find(isAvailable) ?? null;
}

function normalizeImageUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return `${url.hostname.toLowerCase()}${url.pathname}`;
  } catch {
    return value.trim().split(/[?#]/, 1)[0];
  }
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
        return image?.url
          ? {
              ...image,
              id: media.id ?? image.id ?? null,
              altText: image.altText || media.alt || null,
            }
          : null;
      }),
    ...variants.map(getVariantImage),
  ];
  const unique = new Map();
  for (const image of images) {
    if (!image?.url) continue;
    const key = normalizeImageUrl(image.url);
    if (!key) continue;
    const existing = unique.get(key);
    unique.set(
      key,
      existing
        ? {
            ...existing,
            ...image,
            id: preferredProductImageId(existing.id, image.id),
            altText: image.altText || existing.altText || null,
          }
        : image,
    );
  }
  return [...unique.values()];
}

function preferredProductImageId(existingId, incomingId) {
  const existingIsMediaImage = /^gid:\/\/shopify\/MediaImage\//i.test(String(existingId ?? ""));
  const incomingIsMediaImage = /^gid:\/\/shopify\/MediaImage\//i.test(String(incomingId ?? ""));
  if (existingIsMediaImage) return existingId;
  if (incomingIsMediaImage) return incomingId;
  return incomingId ?? existingId ?? null;
}

/** Keep an in-flight shopper selection when asynchronously loaded variant pages arrive. */
export function preserveSelectedVariantId(currentId, variants, preferredId) {
  if (currentId && variants?.some((variant) => variant.id === currentId)) return currentId;
  if (preferredId && variants?.some((variant) => variant.id === preferredId)) return preferredId;
  return variants?.[0]?.id ?? null;
}

/**
 * Merge Shopify's public product JSON media into the Storefront product.
 * A product-bound reviewed assignment wins. Otherwise use one unique published
 * variant_ids association; conflicts and successful readbacks without an exact
 * association stay unmapped. A non-primary Storefront image is retained only
 * when the published-media readback itself is unavailable. Never infer from
 * filenames or alt text.
 */
export function mergePublishedProductMedia(product, publishedMedia) {
  if (!product) return product;
  if (
    publishedMedia &&
    (publishedMedia.handle !== product.handle ||
      normalizeShopifyId(publishedMedia.productId) !== normalizeShopifyId(product.id))
  ) {
    return product;
  }

  const rawPublishedImages = (publishedMedia?.images ?? []).filter((image) =>
    isSafeImageUrl(image?.url),
  );
  const gallery = getProductGalleryImages(
    product,
    product.variants?.edges?.map((edge) => edge.node) ?? [],
  );
  const imageByUrl = new Map(gallery.map((image) => [normalizeImageUrl(image.url), image]));
  const publishedImages = rawPublishedImages.map((image) => {
    const key = normalizeImageUrl(image.url);
    const graphImage = imageByUrl.get(key);
    return {
      ...graphImage,
      ...image,
      // Shopify's public product JSON uses legacy numeric Image IDs, while
      // Storefront `media` exposes the MediaImage GID used by reviewed
      // assignments. Keep that canonical product-media identity for review
      // lookup; the per-image `variantIds` from public JSON remain intact.
      id: graphImage?.id ?? image.id ?? null,
      altText: image.altText || graphImage?.altText || null,
    };
  });
  for (const image of publishedImages) {
    const key = normalizeImageUrl(image.url);
    if (!imageByUrl.has(key)) imageByUrl.set(key, image);
  }
  const mergedImages = [...imageByUrl.values()];
  const primaryUrl = normalizeImageUrl(mergedImages[0]?.url);
  const imagesByVariantId = new Map();
  for (const image of publishedImages) {
    for (const variantId of image.variantIds ?? []) {
      const key = normalizeShopifyId(variantId);
      if (!key) continue;
      if (!imagesByVariantId.has(key)) imagesByVariantId.set(key, new Map());
      imagesByVariantId.get(key).set(normalizeImageUrl(image.url), image);
    }
  }
  const variantNodes = (product.variants?.edges ?? []).map((edge) => edge.node);
  const optionDefinitions = product.options ?? variantNodes[0]?.selectedOptions ?? [];
  const imageOptionNames = optionDefinitions
    .map((option) => option?.name)
    .filter((name) => IMAGE_OPTION_NAME.test(String(name ?? "").trim()));
  const candidateRecords = variantNodes.map((variant) => {
    const variantKey = normalizeShopifyId(variant.id);
    const associatedImages = variantKey ? imagesByVariantId.get(variantKey) : null;
    const explicitlyMapped =
      associatedImages?.size === 1 ? [...associatedImages.values()][0] : null;
    const hasConflictingPublishedMappings = Boolean(associatedImages && associatedImages.size > 1);
    const reviewCandidates = publishedImages.length ? publishedImages : mergedImages;
    const reviewed = findReviewedVariantImage(product, variant, reviewCandidates);
    const existingImage = getVariantImage(variant);
    const existingImageIsNonPrimary =
      existingImage && normalizeImageUrl(existingImage.url) !== primaryUrl;
    const candidate = reviewed.found
      ? { image: reviewed.image, source: "reviewed" }
      : hasConflictingPublishedMappings
        ? null
        : explicitlyMapped
          ? { image: explicitlyMapped, source: "published" }
          : !publishedMedia && existingImageIsNonPrimary && imageOptionNames.length === 0
            ? { image: existingImage, source: "unverified" }
            : null;
    return { variant, candidate, reviewed, hasConflictingPublishedMappings };
  });

  // Reconcile image-bearing option values across size/pack variants. Shopify's
  // per-image variant_ids can be stale or product-wide; a single variant's
  // association is not enough when sibling sizes for the same color/pattern
  // point at different media, or when one image is assigned across distinct
  // appearance values. Conflict detection may hold a mapping, but never copies
  // one variant's image onto another variant: only a recorded visual review
  // grants the storefront its verified status.
  const optionValueImages = new Map();
  for (const name of imageOptionNames) {
    const publishedImageValues = new Map();
    for (const record of candidateRecords) {
      const value = record.variant.selectedOptions?.find(
        (option) =>
          String(option?.name ?? "")
            .trim()
            .toLowerCase() === String(name).trim().toLowerCase(),
      )?.value;
      if (!value) continue;
      const groupKey = `${String(name).trim().toLowerCase()}\u001f${String(value).trim().toLowerCase()}`;
      if (!optionValueImages.has(groupKey)) {
        optionValueImages.set(groupKey, { urls: new Map(), hasConflict: false });
      }
      const group = optionValueImages.get(groupKey);
      if (record.hasConflictingPublishedMappings) group.hasConflict = true;
      if (!record.candidate?.image?.url) continue;

      const imageUrl = normalizeImageUrl(record.candidate.image.url);
      group.urls.set(imageUrl, record.candidate.image);
      if (record.candidate.source !== "published") continue;
      if (!publishedImageValues.has(imageUrl)) publishedImageValues.set(imageUrl, new Set());
      publishedImageValues.get(imageUrl).add(groupKey);
    }
    for (const groupKeys of publishedImageValues.values()) {
      if (groupKeys.size < 2 || publishedImages.length < 2) continue;
      for (const groupKey of groupKeys) {
        const group = optionValueImages.get(groupKey);
        if (group) group.hasConflict = true;
      }
    }
  }
  const conflictedOptionValues = new Set();
  for (const [groupKey, group] of optionValueImages) {
    if (group.urls.size > 1) group.hasConflict = true;
    if (group.hasConflict) conflictedOptionValues.add(groupKey);
  }

  const variants = candidateRecords.map(
    ({ variant, candidate, reviewed, hasConflictingPublishedMappings }) => {
      if (reviewed.found) {
        return {
          ...variant,
          image: reviewed.image
            ? {
                id: reviewed.image.id ?? null,
                url: reviewed.image.url,
                altText: reviewed.image.altText ?? null,
              }
            : null,
          imageMappingStatus: reviewed.image ? "reviewed" : "conflict",
        };
      }

      const variantGroupKeys = imageOptionNames
        .map((name) => {
          const value = variant.selectedOptions?.find(
            (option) =>
              String(option?.name ?? "")
                .trim()
                .toLowerCase() === String(name).trim().toLowerCase(),
          )?.value;
          return value
            ? `${String(name).trim().toLowerCase()}\u001f${String(value).trim().toLowerCase()}`
            : null;
        })
        .filter(Boolean);
      const hasOptionConflict = variantGroupKeys.some((key) => conflictedOptionValues.has(key));
      if (hasConflictingPublishedMappings || hasOptionConflict) {
        return { ...variant, image: null, imageMappingStatus: "conflict" };
      }

      const candidateImages = new Map();
      if (candidate?.image?.url)
        candidateImages.set(normalizeImageUrl(candidate.image.url), candidate);

      if (candidateImages.size > 1) {
        return { ...variant, image: null, imageMappingStatus: "conflict" };
      }
      const resolved = candidateImages.size === 1 ? [...candidateImages.values()][0] : null;
      return {
        ...variant,
        image: resolved?.image
          ? {
              id: resolved.image.id ?? null,
              url: resolved.image.url,
              altText: resolved.image.altText ?? null,
            }
          : null,
        imageMappingStatus:
          resolved?.source === "reviewed"
            ? "reviewed"
            : resolved?.source === "published"
              ? "assigned"
              : "unverified",
      };
    },
  );

  if (
    !publishedMedia &&
    !variants.some(
      (variant, index) => variant.image !== product.variants?.edges?.[index]?.node?.image,
    )
  ) {
    return product;
  }

  return {
    ...product,
    images: { edges: mergedImages.map((node) => ({ node })) },
    variants: { ...product.variants, edges: variants.map((node) => ({ node })) },
  };
}

function normalizeShopifyId(value) {
  const id =
    String(value ?? "")
      .split("/")
      .pop() ?? "";
  return /^\d+$/.test(id) ? id : "";
}

function isSafeImageUrl(value) {
  try {
    return new URL(value.startsWith("//") ? `https:${value}` : value).protocol === "https:";
  } catch {
    return false;
  }
}
