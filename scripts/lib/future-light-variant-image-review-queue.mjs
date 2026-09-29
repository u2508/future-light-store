const REQUIRED_COVERAGE = ["productVariants", "productMedia", "variantMediaAssociations"];

function normalize(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function nodes(connection, label) {
  if (Array.isArray(connection)) return connection;
  if (Array.isArray(connection?.nodes)) return connection.nodes;
  throw new Error(`Catalog snapshot has no complete ${label} node list.`);
}

function assertCompleteConnection(connection, label) {
  if (!connection || connection.pageInfo?.hasNextPage !== false) {
    throw new Error(`Catalog snapshot ${label} pagination is incomplete.`);
  }
}

function typedId(value, type, label) {
  const id = normalize(value);
  if (!new RegExp(`^gid://shopify/${type}/\\d+$`).test(id)) {
    throw new Error(`Catalog snapshot has an invalid ${label} Shopify GID.`);
  }
  return id;
}

/**
 * Build review evidence for every variant on every active product from one
 * completed Shopify catalog snapshot. This function never selects a candidate
 * or writes to Shopify; all media candidates remain product-bound.
 */
export function buildVariantImageReviewEntries(snapshot, { targetStoreDomain } = {}) {
  if (!snapshot || snapshot.shopDomain !== targetStoreDomain) {
    throw new Error(
      `Variant image snapshot targets ${snapshot?.shopDomain || "an unknown store"}, not ${targetStoreDomain || "the configured store"}.`,
    );
  }
  for (const field of REQUIRED_COVERAGE) {
    if (snapshot.coverage?.[field] !== "complete") {
      throw new Error(`Catalog snapshot ${field} coverage is not complete.`);
    }
  }
  if (!Array.isArray(snapshot.products) || snapshot.counts?.products !== snapshot.products.length) {
    throw new Error("Catalog snapshot product count does not match its complete product list.");
  }

  const seenProducts = new Set();
  const seenVariants = new Set();
  const seenMedia = new Set();
  let totalVariants = 0;
  let totalMedia = 0;
  let totalAssociations = 0;
  const entries = [];

  for (const product of snapshot.products) {
    const productId = typedId(product?.id, "Product", "product");
    const handle = normalize(product?.handle);
    const title = normalize(product?.title);
    if (!handle || !title)
      throw new Error(`Catalog snapshot product ${productId} is missing its handle or title.`);
    if (seenProducts.has(productId))
      throw new Error(`Catalog snapshot duplicates product ${productId}.`);
    seenProducts.add(productId);

    assertCompleteConnection(product?.media, `media for ${handle}`);
    assertCompleteConnection(product?.variants, `variants for ${handle}`);
    const mediaNodes = nodes(product.media, `media for ${handle}`);
    const variantNodes = nodes(product.variants, `variants for ${handle}`);
    totalMedia += mediaNodes.length;
    totalVariants += variantNodes.length;

    const mediaById = new Map();
    for (const media of mediaNodes) {
      if (media?.__typename && media.__typename !== "MediaImage") continue;
      if (media?.mediaContentType && media.mediaContentType !== "IMAGE") continue;
      const mediaId = typedId(media?.id, "MediaImage", `media on ${handle}`);
      const image = media.image || {};
      const url = normalize(image.url || media.url);
      if (!url)
        throw new Error(`Catalog snapshot image ${mediaId} on ${handle} has no source URL.`);
      if (mediaById.has(mediaId))
        throw new Error(`Catalog snapshot duplicates image ${mediaId} on ${handle}.`);
      if (seenMedia.has(mediaId))
        throw new Error(`Catalog snapshot image ${mediaId} is attached to more than one product.`);
      seenMedia.add(mediaId);
      mediaById.set(mediaId, {
        id: mediaId,
        url,
        alt: normalize(media.alt || image.altText),
        width: Number.isFinite(image.width) ? image.width : null,
        height: Number.isFinite(image.height) ? image.height : null,
      });
    }

    for (const variant of variantNodes) {
      const variantId = typedId(variant?.id, "ProductVariant", `variant on ${handle}`);
      if (seenVariants.has(variantId))
        throw new Error(`Catalog snapshot duplicates variant ${variantId}.`);
      seenVariants.add(variantId);
      assertCompleteConnection(variant?.media, `variant media for ${variantId}`);
      const currentMediaNodes = nodes(variant.media, `variant media for ${variantId}`);
      totalAssociations += currentMediaNodes.length;
      const currentMedia = currentMediaNodes.map((media) => {
        if (media?.__typename && media.__typename !== "MediaImage") {
          throw new Error(
            `Variant ${variantId} has a non-image association that needs separate review.`,
          );
        }
        const mediaId = typedId(media?.id, "MediaImage", `variant media on ${variantId}`);
        if (media.__parentId && normalize(media.__parentId) !== variantId) {
          throw new Error(
            `Variant ${variantId} has image evidence owned by another Shopify variant.`,
          );
        }
        const candidate = mediaById.get(mediaId);
        if (!candidate)
          throw new Error(
            `Variant ${variantId} points to image ${mediaId} outside product ${productId}'s complete gallery.`,
          );
        return { ...candidate, associationParentId: normalize(media.__parentId) || null };
      });

      if (!Array.isArray(variant.selectedOptions)) {
        throw new Error(`Variant ${variantId} has no complete selected-option evidence.`);
      }
    }

    if (product.status !== "ACTIVE") continue;
    const variants = variantNodes.map((variant) => {
      const variantId = normalize(variant.id);
      const currentMedia = nodes(variant.media, `variant media for ${variantId}`).map((media) =>
        mediaById.get(normalize(media.id)),
      );
      return {
        variantId,
        title: normalize(variant.title),
        sku: normalize(variant.sku),
        selectedOptions: variant.selectedOptions.map((option) => ({
          name: normalize(option?.name),
          value: normalize(option?.value),
        })),
        currentMedia,
        expectedCurrentMediaIds: currentMedia.map((media) => media.id),
        decisionRequired: true,
      };
    });

    entries.push({
      productId,
      handle,
      title,
      status: product.status,
      media: [...mediaById.values()],
      variants,
    });
  }

  if (snapshot.counts.variants !== totalVariants) {
    throw new Error(
      `Catalog snapshot variant count mismatch: declared ${snapshot.counts.variants}, found ${totalVariants}.`,
    );
  }
  if (snapshot.counts.productMedia !== totalMedia) {
    throw new Error(
      `Catalog snapshot product media count mismatch: declared ${snapshot.counts.productMedia}, found ${totalMedia}.`,
    );
  }
  if (snapshot.counts.variantMediaAssociations !== totalAssociations) {
    throw new Error(
      `Catalog snapshot variant-media count mismatch: declared ${snapshot.counts.variantMediaAssociations}, found ${totalAssociations}.`,
    );
  }

  return {
    entries,
    summary: {
      activeProducts: entries.length,
      variantsRequiringReview: entries.reduce((sum, entry) => sum + entry.variants.length, 0),
      productImageCandidates: entries.reduce((sum, entry) => sum + entry.media.length, 0),
      activeVariantsWithoutCurrentImage: entries.reduce(
        (sum, entry) =>
          sum + entry.variants.filter((variant) => variant.currentMedia.length === 0).length,
        0,
      ),
    },
  };
}
