function asString(value) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (value == null) {
    return "";
  }

  return String(value).trim();
}

function asNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const raw = asString(value);
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function asBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = asString(value).toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  return null;
}

function uniqueValues(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeProductReference(input) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const source = input;
  const id = asString(source.id || source.legacyResourceId || source.legacy_resource_id || "");
  const handle = asString(source.handle || source.slug || source.key || "");
  const title = asString(source.title || source.name || source.displayName || handle || id);
  const productType = asString(source.productType || source.product_type || "");
  const vendor = asString(source.vendor || "");
  const image =
    asString(source.image?.src || source.image?.url || source.featuredImage?.url || source.featured_image?.src || "");
  const legacyResourceId = asNumber(source.legacyResourceId || source.legacy_resource_id);
  const referenceType = asString(source.__typename || source.type || source.referenceType || "");

  if (!id && !handle && !title) {
    return null;
  }

  return {
    id,
    legacyResourceId,
    handle,
    title,
    productType,
    vendor,
    image: image || null,
    referenceType: referenceType || null,
  };
}

function normalizeProductReferenceList(input) {
  const items = [];

  if (Array.isArray(input)) {
    items.push(...input);
  } else if (input && typeof input === "object") {
    if (Array.isArray(input.nodes)) {
      items.push(...input.nodes);
    } else if (Array.isArray(input.references)) {
      items.push(...input.references);
    } else if (input.reference) {
      items.push(input.reference);
    }
  }

  return uniqueValues(
    items
      .map((entry) => normalizeProductReference(entry))
      .filter(Boolean)
      .map((entry) => JSON.stringify(entry)),
  ).map((entry) => JSON.parse(entry));
}

function normalizeMetafieldReference(input) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const referenceType = asString(input.__typename || input.type || "");
  const reference = normalizeProductReference(input);
  if (reference) {
    return reference;
  }

  const id = asString(input.id || input.handle || input.key || "");
  const handle = asString(input.handle || "");
  const title = asString(input.title || input.displayName || input.name || handle || id);
  const fields = input.fields && typeof input.fields === "object" ? input.fields : undefined;

  if (!id && !handle && !title) {
    return null;
  }

  return {
    id,
    handle,
    title,
    referenceType: referenceType || null,
    fields: fields || undefined,
  };
}

function normalizeRawMetafieldEntry(input) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const namespace = asString(input.namespace);
  const key = asString(input.key);
  if (!namespace || !key) {
    return null;
  }

  const references = normalizeProductReferenceList(
    input.references?.nodes ||
      (Array.isArray(input.references?.edges)
        ? input.references.edges.map((edge) => edge?.node).filter(Boolean)
        : null) ||
      input.references,
  );

  return {
    namespace,
    key,
    type: asString(input.type || ""),
    value: input.value == null ? "" : String(input.value),
    jsonValue: input.jsonValue,
    reference: normalizeMetafieldReference(input.reference),
    references: references.length ? references : [],
  };
}

function normalizeRawMetafieldMap(input) {
  if (!input) {
    return {};
  }

  const entries = Array.isArray(input)
    ? input
    : Object.values(input).filter(Boolean);

  return entries.reduce((accumulator, entry) => {
    const normalized = normalizeRawMetafieldEntry(entry);
    if (!normalized) {
      return accumulator;
    }

    accumulator[`${normalized.namespace}.${normalized.key}`] = normalized;
    return accumulator;
  }, {});
}

function getMetafieldValue(rawMetafields, namespace, key) {
  const entry = rawMetafields?.[`${namespace}.${key}`];
  if (!entry) {
    return null;
  }

  if (entry.jsonValue !== undefined && entry.jsonValue !== null) {
    return entry.jsonValue;
  }

  if (entry.value !== undefined && entry.value !== null && entry.value !== "") {
    return entry.value;
  }

  return null;
}

function normalizeStringList(input) {
  const values = [];

  if (Array.isArray(input)) {
    for (const entry of input) {
      if (Array.isArray(entry)) {
        values.push(...entry);
      } else if (entry != null) {
        values.push(entry);
      }
    }
  } else if (input != null) {
    values.push(input);
  }

  return uniqueValues(
    values
      .flatMap((entry) => String(entry).split(/[\n,;|]+/g))
      .map((entry) => asString(entry))
      .filter(Boolean),
  );
}

function normalizeProductCustomData(input) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const rawMetafields = normalizeRawMetafieldMap(input.metafields);
  const subtitle = asString(
    input.subtitle ??
      getMetafieldValue(rawMetafields, "descriptors", "subtitle"),
  );
  const badgeText = asString(
    input.badgeText ??
      getMetafieldValue(rawMetafields, "salt-marketing", "badge_text"),
  );
  const highlights = normalizeStringList(
    input.highlights ??
      getMetafieldValue(rawMetafields, "salt-marketing", "highlights"),
  );
  const rating = asNumber(
    input.rating ??
      input.averageRating ??
      getMetafieldValue(rawMetafields, "reviews", "rating"),
  );
  const ratingCount = asNumber(
    input.ratingCount ??
      input.totalReviews ??
      getMetafieldValue(rawMetafields, "reviews", "rating_count"),
  );
  const relatedProductsDisplay = asString(
    input.relatedProductsDisplay ??
      getMetafieldValue(
        rawMetafields,
        "shopify--discovery--product_recommendation",
        "related_products_display",
      ),
  );
  const standardSearchProductBoosts = normalizeStringList(
    input.searchProductBoosts ??
      getMetafieldValue(
        rawMetafields,
        "shopify--discovery--product_search_boost",
        "queries",
      ),
  );
  const searchProductBoostFallback = normalizeStringList(
    input.searchProductBoostFallback ??
      getMetafieldValue(rawMetafields, "salt-search", "query_terms"),
  );
  const searchProductBoosts = standardSearchProductBoosts.length
    ? standardSearchProductBoosts
    : searchProductBoostFallback;
  const relatedProducts = normalizeProductReferenceList(
    input.relatedProducts ??
      getMetafieldValue(
        rawMetafields,
        "shopify--discovery--product_recommendation",
        "related_products",
      ) ??
      rawMetafields["shopify--discovery--product_recommendation.related_products"]?.references,
  );
  const standardComplementaryProducts = normalizeProductReferenceList(
    input.complementaryProducts ??
      getMetafieldValue(
        rawMetafields,
        "shopify--discovery--product_recommendation",
        "complementary_products",
      ) ??
      rawMetafields["shopify--discovery--product_recommendation.complementary_products"]?.references,
  );
  const complementaryProductsFallbackInput =
    input.complementaryProductsFallback ??
    getMetafieldValue(rawMetafields, "salt-recommendations", "complementary_products");
  const normalizedComplementaryProductsFallback = normalizeProductReferenceList(
    complementaryProductsFallbackInput,
  );
  const complementaryProductsFallback = normalizedComplementaryProductsFallback.length
    ? normalizedComplementaryProductsFallback
    : normalizeProductReferenceList(
        rawMetafields["salt-recommendations.complementary_products"]?.references,
      );
  const complementaryProducts = standardComplementaryProducts.length
    ? standardComplementaryProducts
    : complementaryProductsFallback;
  const googleCustomProduct = asBoolean(
    input.googleCustomProduct ??
      getMetafieldValue(rawMetafields, "mm-google-shopping", "custom_product"),
  );
  const shopChannelMinimumQuantity = asNumber(
    input.shopChannelMinimumQuantity ??
      getMetafieldValue(rawMetafields, "salt-marketing", "shop_channel_minimum_quantity"),
  );
  const collectionSignal = asString(
    input.collectionSignal ??
      getMetafieldValue(rawMetafields, "salt-marketing", "collection_signal"),
  );

  const diaperType =
    input.diaperType ??
    getMetafieldValue(rawMetafields, "shopify", "diaper-type") ??
    (rawMetafields["shopify.diaper-type"]?.references?.length
      ? rawMetafields["shopify.diaper-type"].references
      : null) ??
    getMetafieldValue(rawMetafields, "app", "diaper_type") ??
    getMetafieldValue(rawMetafields, "custom", "diaper_type") ??
    getMetafieldValue(rawMetafields, "products", "diaper_type") ??
    null;

  return {
    subtitle: subtitle || null,
    badgeText: badgeText || null,
    highlights,
    rating,
    ratingCount,
    relatedProductsDisplay: relatedProductsDisplay || null,
    relatedProducts: relatedProducts.length ? relatedProducts : [],
    complementaryProducts: complementaryProducts.length ? complementaryProducts : [],
    searchProductBoosts,
    googleCustomProduct,
    shopChannelMinimumQuantity,
    collectionSignal: collectionSignal || null,
    diaperType,
    metafields: rawMetafields,
  };
}

function mergeProductCustomData(base, override) {
  const normalizedBase = normalizeProductCustomData(base);
  const normalizedOverride = normalizeProductCustomData(override);

  if (!normalizedBase && !normalizedOverride) {
    return null;
  }

  if (!normalizedBase) {
    return normalizedOverride;
  }

  if (!normalizedOverride) {
    return normalizedBase;
  }

  const pickArray = (primary, fallback) => (primary && primary.length ? primary : fallback);
  const pickValue = (primary, fallback) => (primary !== undefined && primary !== null ? primary : fallback);
  const mergedMetafields = {
    ...normalizedBase.metafields,
    ...normalizedOverride.metafields,
  };

  return {
    subtitle: pickValue(normalizedOverride.subtitle, normalizedBase.subtitle),
    badgeText: pickValue(normalizedOverride.badgeText, normalizedBase.badgeText),
    highlights: pickArray(normalizedOverride.highlights, normalizedBase.highlights),
    rating: pickValue(normalizedOverride.rating, normalizedBase.rating),
    ratingCount: pickValue(normalizedOverride.ratingCount, normalizedBase.ratingCount),
    relatedProductsDisplay: pickValue(
      normalizedOverride.relatedProductsDisplay,
      normalizedBase.relatedProductsDisplay,
    ),
    relatedProducts: pickArray(normalizedOverride.relatedProducts, normalizedBase.relatedProducts),
    complementaryProducts: pickArray(
      normalizedOverride.complementaryProducts,
      normalizedBase.complementaryProducts,
    ),
    searchProductBoosts: pickArray(
      normalizedOverride.searchProductBoosts,
      normalizedBase.searchProductBoosts,
    ),
    googleCustomProduct: pickValue(
      normalizedOverride.googleCustomProduct,
      normalizedBase.googleCustomProduct,
    ),
    shopChannelMinimumQuantity: pickValue(
      normalizedOverride.shopChannelMinimumQuantity,
      normalizedBase.shopChannelMinimumQuantity,
    ),
    collectionSignal: pickValue(
      normalizedOverride.collectionSignal,
      normalizedBase.collectionSignal,
    ),
    diaperType: pickValue(normalizedOverride.diaperType, normalizedBase.diaperType),
    metafields: mergedMetafields,
  };
}

function normalizeCollectionCustomData(input) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const rawMetafields = normalizeRawMetafieldMap(input.metafields);
  const heroKicker = asString(
    input.heroKicker ??
      getMetafieldValue(rawMetafields, "salt-marketing", "hero_kicker"),
  );
  const heroSummary = asString(
    input.heroSummary ??
      getMetafieldValue(rawMetafields, "salt-marketing", "hero_summary"),
  );
  const featuredProducts = normalizeProductReferenceList(
    input.featuredProducts ??
      getMetafieldValue(rawMetafields, "salt-marketing", "featured_products") ??
      rawMetafields["salt-marketing.featured_products"]?.references,
  );
  const trustStrip = normalizeStringList(
    input.trustStrip ??
      getMetafieldValue(rawMetafields, "salt-marketing", "trust_strip"),
  );

  return {
    heroKicker: heroKicker || null,
    heroSummary: heroSummary || null,
    featuredProducts,
    trustStrip,
    metafields: rawMetafields,
  };
}

function normalizeShopCustomData(input) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const rawMetafields = normalizeRawMetafieldMap(input.metafields);
  const bannerText = asString(
    input.bannerText ??
      getMetafieldValue(rawMetafields, "salt-marketing", "banner_text"),
  );
  const trustStrip = normalizeStringList(
    input.trustStrip ??
      getMetafieldValue(rawMetafields, "salt-marketing", "trust_strip"),
  );

  return {
    bannerText: bannerText || null,
    trustStrip,
    metafields: rawMetafields,
  };
}

export {
  getMetafieldValue,
  mergeProductCustomData,
  normalizeCollectionCustomData,
  normalizeMetafieldReference,
  normalizeProductCustomData,
  normalizeProductReference,
  normalizeProductReferenceList,
  normalizeRawMetafieldEntry,
  normalizeRawMetafieldMap,
  normalizeStringList,
  normalizeShopCustomData,
};
