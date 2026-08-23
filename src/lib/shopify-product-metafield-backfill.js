import { normalizePlainText, parseMoneyValue, toShopifyGid } from "./shopify-seo-batch.js";
import {
  PRODUCT_METAFIELD_DEFINITIONS,
  getProductMetafieldDefinitionId,
} from "./shopify-product-metafield-definitions.js";
import { normalizeProductCustomData } from "./product-custom-data.js";
import { buildProductSpecifications } from "./product-specifications.js";
import {
  assessProductContentSpecificity,
  buildCatalogContentCollisionIndex,
  findCatalogContentCollisions,
  hasCatalogContentCollision,
} from "./product-content-specificity.js";
import {
  inferApprovedDisclosureReferences,
  inferShopifyTaxonomyCategory,
} from "./shopify-product-category.js";

const FIELD_DEFINITIONS = Object.fromEntries(
  PRODUCT_METAFIELD_DEFINITIONS.map((definition) => [getProductMetafieldDefinitionId(definition), definition]),
);

const BACKFILL_FIELD_IDS = {
  subtitle: "descriptors.subtitle",
  badgeText: "salt-marketing.badge_text",
  highlights: "salt-marketing.highlights",
  collectionSignal: "salt-marketing.collection_signal",
  rating: "reviews.rating",
  ratingCount: "reviews.rating_count",
  relatedProducts: "shopify--discovery--product_recommendation.related_products",
  relatedProductsDisplay: "shopify--discovery--product_recommendation.related_products_display",
  searchProductBoosts: "shopify--discovery--product_search_boost.queries",
  complementaryProducts: "shopify--discovery--product_recommendation.complementary_products",
  searchProductBoostFallback: "salt-search.query_terms",
  complementaryProductsFallback: "salt-recommendations.complementary_products",
  diaperType: "shopify.diaper-type",
  googleCustomProduct: "mm-google-shopping.custom_product",
  shopChannelMinimumQuantity: "salt-marketing.shop_channel_minimum_quantity",
  disclosures: "shopify.disclosure",
  specifications: "salt-product.specifications",
};

const BACKFILL_FIELDS = Object.fromEntries(
  Object.entries(BACKFILL_FIELD_IDS).map(([name, id]) => [name, FIELD_DEFINITIONS[id]]),
);

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "of",
  "on",
  "or",
  "our",
  "the",
  "this",
  "to",
  "with",
  "your",
  "daily",
  "new",
  "best",
  "gift",
  "gifts",
  "sale",
  "shop",
  "product",
  "products",
  "use",
  "usable",
  "practical",
  "everyday",
  "premium",
  "featured",
  "feature",
  "trending",
  "popular",
  "bundle",
  "bundles",
  "set",
  "sets",
  "available",
  "choice",
  "have",
  "must",
  "perfect",
  "quality",
  "style",
  "stylish",
]);

const GENERIC_COLLECTION_HANDLE_PATTERNS = [
  /^all-?products?$/i,
  /^clearance(-archive)?$/i,
  /^archive$/i,
  /^remove-product-for-shop-app-from-featiure-products$/i,
  /^remove-product-for-shop-app-from-feature-products$/i,
  /^feature[d-]?products?$/i,
  /^shop-app/i,
];

function normalizeKey(input) {
  return normalizePlainText(input).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeHandle(input) {
  return normalizePlainText(input).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function uniqueValues(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function splitTextIntoTokens(input) {
  return normalizePlainText(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => token.length > 1 || /\d/.test(token))
    .filter((token) => !STOP_WORDS.has(token));
}

function stripHtml(input) {
  return String(input || "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTagList(tags) {
  if (Array.isArray(tags)) {
    return uniqueValues(tags.map((tag) => normalizePlainText(tag)).filter(Boolean));
  }

  const raw = normalizePlainText(tags);
  if (!raw) {
    return [];
  }

  return uniqueValues(
    raw
      .split(/[,;|/\n]+/g)
      .map((entry) => normalizePlainText(entry))
      .filter(Boolean),
  );
}

function getProductPrice(product) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const prices = variants
    .map((variant) => parseMoneyValue(variant?.price))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (!prices.length) {
    return null;
  }

  return Math.min(...prices);
}

function getProductProductType(product) {
  return normalizePlainText(product?.product_type || product?.productType || "");
}

function getProductTitle(product) {
  return normalizePlainText(product?.title || "");
}

function getProductHandleTokens(product) {
  return splitTextIntoTokens(normalizePlainText(product?.handle || ""));
}

function getProductBodyText(product) {
  return stripHtml(product?.body_html || product?.bodyHtml || "");
}

function getProductExistingCustomData(product) {
  return normalizeProductCustomData({
    ...(product?.customData || {}),
    rating: product?.customData?.rating ?? product?.average_rating ?? null,
    ratingCount: product?.customData?.ratingCount ?? product?.total_reviews ?? null,
  });
}

function parseJsonMetafieldValue(entry) {
  const raw = entry?.jsonValue ?? entry?.value ?? null;
  if (raw && typeof raw === "object") return raw;
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJsonValue(value[key])]));
}

function buildProductSpecificationsWrite(product, existing) {
  const specifications = buildProductSpecifications(product);
  const existingSpecifications = parseJsonMetafieldValue(existing?.metafields?.[BACKFILL_FIELD_IDS.specifications]);
  if (JSON.stringify(stableJsonValue(specifications)) === JSON.stringify(stableJsonValue(existingSpecifications))) {
    return null;
  }
  return {
    fieldId: BACKFILL_FIELD_IDS.specifications,
    label: BACKFILL_FIELDS.specifications?.name || "Product specifications",
    namespace: BACKFILL_FIELDS.specifications?.namespace || "salt-product",
    key: BACKFILL_FIELDS.specifications?.key || "specifications",
    type: BACKFILL_FIELDS.specifications?.type || "json",
    ownerId: toShopifyGid("Product", product.id),
    value: JSON.stringify(specifications),
    reason: specifications.evidence.labeled_fact_count
      ? `Stored ${specifications.evidence.labeled_fact_count} evidence-backed supplier specification(s)`
      : "Stored product identity and available catalog evidence for downstream merchandising",
  };
}

function isGenericCollectionHandle(handle) {
  const normalized = normalizeHandle(handle);
  return GENERIC_COLLECTION_HANDLE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function collectionSpecificityWeight(productsCount, handle, title) {
  if (isGenericCollectionHandle(handle)) {
    return 0;
  }

  const count = Number(productsCount || 0);
  if (count >= 1000) {
    return 0;
  }

  if (count >= 300) {
    return 0.35;
  }

  if (count >= 100) {
    return 0.6;
  }

  if (count >= 40) {
    return 0.9;
  }

  if (count >= 10) {
    return 1.1;
  }

  return 1.25;
}

function buildCollectionIndex(collections = [], collectionProductsPayload = null) {
  const collectionMap = new Map();
  const productCollectionsById = new Map();
  const productCollectionTitlesById = new Map();

  const collectionEntries = Array.isArray(collections) ? collections : [];
  for (const collection of collectionEntries) {
    const handle = normalizeHandle(collection?.handle);
    if (!handle) {
      continue;
    }

    const productIds = Array.isArray(collectionProductsPayload?.collections?.[handle]?.productIds)
      ? collectionProductsPayload.collections[handle].productIds.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)
      : [];
    const productsCount = Number(collection?.products_count || productIds.length || 0);
    const title = normalizePlainText(collection?.title || "");
    const specificityWeight = collectionSpecificityWeight(productsCount, handle, title);
    const tokenSet = new Set(splitTextIntoTokens(title));

    const entry = {
      id: Number(collection?.id || 0) || null,
      title,
      handle,
      productsCount,
      productIds,
      specificityWeight,
      tokenSet,
      isGeneric: specificityWeight <= 0,
    };

    collectionMap.set(handle, entry);
  }

  for (const collection of collectionMap.values()) {
    for (const productId of collection.productIds) {
      if (!productCollectionsById.has(productId)) {
        productCollectionsById.set(productId, []);
      }

      productCollectionsById.get(productId).push(collection);
    }
  }

  for (const [productId, collectionRefs] of productCollectionsById.entries()) {
    const titles = uniqueValues(
      collectionRefs
        .filter((entry) => !entry.isGeneric)
        .map((entry) => entry.title)
        .filter(Boolean),
    );
    productCollectionTitlesById.set(productId, titles);
  }

  return {
    collectionMap,
    productCollectionsById,
    productCollectionTitlesById,
  };
}

function getProductTokens(product, collectionTitles = []) {
  return new Set(
    splitTextIntoTokens(
      [
        getProductTitle(product),
        normalizePlainText(product?.handle || ""),
        getProductProductType(product),
        normalizeTagList(product?.tags).join(" "),
        collectionTitles.join(" "),
        getProductBodyText(product),
      ].join(" "),
    ),
  );
}

function getOverlapCount(baseSet, candidateSet) {
  let count = 0;
  for (const token of baseSet) {
    if (candidateSet.has(token)) {
      count += 1;
    }
  }
  return count;
}

function getWeightedTokenOverlap(baseSet, candidateSet) {
  let score = 0;
  for (const token of baseSet) {
    if (!candidateSet.has(token)) {
      continue;
    }

    if (token.length >= 8) {
      score += 4;
    } else if (token.length >= 6) {
      score += 3;
    } else if (token.length >= 4) {
      score += 2;
    } else {
      score += 1;
    }
  }

  return score;
}

function getPriceBand(price) {
  if (!Number.isFinite(price) || price <= 0) {
    return null;
  }

  if (price < 10) {
    return 0;
  }

  if (price < 25) {
    return 1;
  }

  if (price < 50) {
    return 2;
  }

  if (price < 100) {
    return 3;
  }

  if (price < 200) {
    return 4;
  }

  return 5;
}

function getPriceBandScore(basePrice, candidatePrice) {
  const baseBand = getPriceBand(basePrice);
  const candidateBand = getPriceBand(candidatePrice);

  if (baseBand == null || candidateBand == null) {
    return 0;
  }

  const difference = Math.abs(baseBand - candidateBand);
  if (difference === 0) {
    return 18;
  }

  if (difference === 1) {
    return 12;
  }

  if (difference === 2) {
    return 6;
  }

  return 0;
}

function getShopChannelMinimumQuantity(price) {
  if (!Number.isFinite(price) || price <= 0) {
    return 1;
  }

  if (price < 15) {
    return 3;
  }

  if (price < 25) {
    return 2;
  }

  return 1;
}

function getProductSavingsPercent(product) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  let bestSavings = 0;

  for (const variant of variants) {
    const price = parseMoneyValue(variant?.price);
    const compareAt = parseMoneyValue(variant?.compare_at_price);
    if (!Number.isFinite(price) || !Number.isFinite(compareAt) || !price || compareAt <= price) {
      continue;
    }

    const savings = Math.round(((compareAt - price) / compareAt) * 100);
    if (savings > bestSavings) {
      bestSavings = savings;
    }
  }

  return bestSavings;
}

function scoreRelatedCandidate(base, candidate) {
  if (!base || !candidate || base.id === candidate.id) {
    return 0;
  }

  let score = 0;
  const sharedCollections = [];

  for (const collection of base.collections) {
    if (collection.isGeneric) {
      continue;
    }

    const candidateCollection = candidate.collectionMap.get(collection.handle);
    if (!candidateCollection) {
      continue;
    }

    sharedCollections.push(collection);
    score += Math.round((collection.specificityWeight + candidateCollection.specificityWeight) * 42);
  }

  if (base.productType && candidate.productType && base.productType === candidate.productType) {
    score += 46;
  }

  const sharedTitleTokens = getWeightedTokenOverlap(base.titleTokens, candidate.titleTokens);
  const sharedHandleTokens = getWeightedTokenOverlap(base.handleTokens, candidate.handleTokens);
  const sharedTypeTokens = getWeightedTokenOverlap(base.productTypeTokens, candidate.productTypeTokens);
  const sharedTagTokens = getWeightedTokenOverlap(base.tagTokens, candidate.tagTokens);
  const sharedCollectionTokens = getWeightedTokenOverlap(base.collectionTokens, candidate.collectionTokens);
  const sharedBodyTokens = getWeightedTokenOverlap(base.bodyTokens, candidate.bodyTokens);

  score += sharedTitleTokens * 6;
  score += sharedHandleTokens * 5;
  score += sharedTypeTokens * 5;
  score += sharedTagTokens * 4;
  score += sharedCollectionTokens * 4;
  score += Math.round(sharedBodyTokens * 1.5);
  score += getPriceBandScore(base.price, candidate.price);

  if (sharedCollections.length > 0) {
    score += Math.min(24, sharedCollections.length * 6);
  }

  if (!score) {
    return 0;
  }

  const sharedTokenCount =
    getOverlapCount(base.titleTokens, candidate.titleTokens) +
    getOverlapCount(base.handleTokens, candidate.handleTokens) +
    getOverlapCount(base.productTypeTokens, candidate.productTypeTokens) +
    getOverlapCount(base.tagTokens, candidate.tagTokens);

  if (!sharedCollections.length && sharedTokenCount < 2 && base.productType !== candidate.productType) {
    return 0;
  }

  return score;
}

const MAX_RELATED_CANDIDATE_BUCKET_SIZE = 500;

function addCandidateIndexValue(index, key, productId) {
  const normalizedKey = normalizePlainText(key).toLowerCase();
  if (!normalizedKey) {
    return;
  }

  if (!index.has(normalizedKey)) {
    index.set(normalizedKey, new Set());
  }
  index.get(normalizedKey).add(productId);
}

function compactCandidateIndex(index) {
  return new Map(
    Array.from(index.entries()).filter(([, productIds]) => productIds.size <= MAX_RELATED_CANDIDATE_BUCKET_SIZE),
  );
}

function buildCandidateIndex(productIndexes) {
  const byId = new Map();
  const byCollection = new Map();
  const byProductType = new Map();
  const byToken = new Map();

  for (const product of productIndexes) {
    byId.set(product.id, product);
    for (const collection of product.collections) {
      if (!collection.isGeneric) {
        addCandidateIndexValue(byCollection, collection.handle, product.id);
      }
    }

    if (product.productType) {
      addCandidateIndexValue(byProductType, product.productType, product.id);
    }

    const primaryTokens = new Set([
      ...product.titleTokens,
      ...product.handleTokens,
      ...product.productTypeTokens,
      ...product.tagTokens,
    ]);
    for (const token of primaryTokens) {
      if (token.length >= 3) {
        addCandidateIndexValue(byToken, token, product.id);
      }
    }
  }

  return {
    byId,
    byCollection: compactCandidateIndex(byCollection),
    byProductType: compactCandidateIndex(byProductType),
    byToken: compactCandidateIndex(byToken),
  };
}

function rankProductCandidates(base, candidates, candidateIndex = null) {
  const candidatePool = candidateIndex && candidateIndex.byId.size > MAX_RELATED_CANDIDATE_BUCKET_SIZE
    ? (() => {
        const candidateIds = new Set();
        for (const collection of base.collections) {
          if (collection.isGeneric) continue;
          for (const productId of candidateIndex.byCollection.get(collection.handle) || []) {
            candidateIds.add(productId);
          }
        }
        if (base.productType) {
          for (const productId of candidateIndex.byProductType.get(base.productType.toLowerCase()) || []) {
            candidateIds.add(productId);
          }
        }
        const primaryTokens = new Set([
          ...base.titleTokens,
          ...base.handleTokens,
          ...base.productTypeTokens,
          ...base.tagTokens,
        ]);
        for (const token of primaryTokens) {
          for (const productId of candidateIndex.byToken.get(token) || []) {
            candidateIds.add(productId);
          }
        }
        return Array.from(candidateIds)
          .map((productId) => candidateIndex.byId.get(productId))
          .filter(Boolean);
      })()
    : candidates;

  return candidatePool
    .filter((candidate) => candidate.id !== base.id)
    .map((candidate) => ({
      product: candidate,
      score: scoreRelatedCandidate(base, candidate),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (right.product.price !== left.product.price) {
        return left.product.price - right.product.price;
      }

      return String(left.product.handle).localeCompare(String(right.product.handle));
    });
}

function generatePhrasesFromTokens(tokens) {
  const phrases = [];
  const windowedLength = Math.min(tokens.length, 5);

  if (!tokens.length) {
    return [];
  }

  if (tokens.length <= 3) {
    phrases.push(tokens.join(" "));
    if (tokens.length >= 2) {
      phrases.push(tokens.slice(0, 2).join(" "));
    }
    return uniqueValues(phrases.map((entry) => entry.trim()).filter(Boolean));
  }

  for (let index = 0; index < windowedLength - 1; index += 1) {
    phrases.push(tokens.slice(index, index + 2).join(" "));
  }

  phrases.push(tokens.slice(0, 3).join(" "));
  phrases.push(tokens.slice(-3).join(" "));
  phrases.push(tokens.join(" "));

  return uniqueValues(
    phrases
      .map((entry) => normalizePlainText(entry))
      .filter((entry) => entry && entry.length >= 3),
  );
}

function buildSearchBoostCandidates(product, collectionRefs) {
  const phrases = [];
  const titleTokens = splitTextIntoTokens(getProductTitle(product));
  const handleTokens = getProductHandleTokens(product);
  const productTypeTokens = splitTextIntoTokens(getProductProductType(product));
  const tagTokens = normalizeTagList(product?.tags).flatMap((entry) => splitTextIntoTokens(entry));
  const bodyTokens = splitTextIntoTokens(getProductBodyText(product)).slice(0, 18);
  phrases.push(...generatePhrasesFromTokens(handleTokens));
  phrases.push(...generatePhrasesFromTokens(titleTokens));
  phrases.push(...generatePhrasesFromTokens(productTypeTokens));
  phrases.push(...generatePhrasesFromTokens(bodyTokens));

  const sortedCollections = [...(Array.isArray(collectionRefs) ? collectionRefs : [])]
    .filter((entry) => !entry?.isGeneric)
    .map((entry) => ({
      title: normalizePlainText(entry?.title || ""),
      weight: Number(entry?.specificityWeight || 0),
    }))
    .filter((entry) => entry.title)
    .sort((left, right) => right.weight - left.weight || left.title.localeCompare(right.title));

  for (const entry of sortedCollections.slice(0, 3)) {
    phrases.push(...generatePhrasesFromTokens(splitTextIntoTokens(entry.title)));
  }

  for (const tag of tagTokens.slice(0, 4)) {
    if (!STOP_WORDS.has(tag) && tag.length >= 3) {
      phrases.push(tag);
    }
  }

  return uniqueValues(
    phrases
      .map((phrase) => normalizePlainText(phrase).toLowerCase())
      .filter((phrase) => phrase && phrase.length >= 3)
      .filter((phrase) => !STOP_WORDS.has(phrase))
      .filter((phrase) => !/^\d+$/.test(phrase)),
  );
}

function buildProductSubtitle(product, collectionTitles = [], productType = "") {
  const title = getProductTitle(product);
  const collections = uniqueValues((Array.isArray(collectionTitles) ? collectionTitles : []).map((entry) => normalizePlainText(entry)));
  const topCollection = collections.find((entry) => entry) || "";
  const cleanType = normalizePlainText(productType || getProductProductType(product));
  const taxonomyName = inferShopifyTaxonomyCategory(product)?.name || "";
  const titlePhrase = normalizePlainText(title).split(/\s+/).slice(0, 7).join(" ");

  const parts = uniqueValues([
    titlePhrase,
    taxonomyName,
    cleanType && normalizeKey(cleanType) !== normalizeKey(taxonomyName) ? cleanType : "",
    !taxonomyName && !cleanType ? topCollection : "",
  ]);

  if (!parts.length) {
    return "";
  }

  return normalizePlainText(parts.join(" • ")).slice(0, 70).trim();
}

function buildProductBadgeText(product, reviewSummary = null, existing = null) {
  const salePercent = Number(getProductSavingsPercent(product) || 0);
  if (salePercent > 0) {
    return `Save ${salePercent}%`;
  }

  const reviewCount = Number(reviewSummary?.reviewCount || 0);
  const rating = Number(reviewSummary?.rating || 0);
  if (reviewCount >= 10 && rating >= 4.5) {
    return "Top rated";
  }

  const publishedAt = new Date(product?.published_at || product?.created_at || "").getTime();
  if (Number.isFinite(publishedAt) && Date.now() - publishedAt <= 1000 * 60 * 60 * 24 * 45) {
    return "New";
  }

  if (existing && Number(existing?.ratingCount || 0) >= 10 && Number(existing?.rating || 0) >= 4.5) {
    return "Top rated";
  }

  return "";
}

function buildProductHighlights(product, collectionTitles = [], reviewSummary = null) {
  const highlights = [];
  const title = getProductTitle(product);
  const evidence = normalizePlainText(`${product?.handle || ""} ${title}`).replace(/[-_]+/g, " ");
  const category = inferShopifyTaxonomyCategory(product);
  const identityNoise = new Set(["cheap", "fashionable", "high", "latest", "quality", "shockproof", "stylish"]);
  const handleIdentity = uniqueValues(
    splitTextIntoTokens(product?.handle || "")
      .filter((token) => !/^20\d{2}$/.test(token))
      .filter((token) => !identityNoise.has(token)),
  )
    .slice(0, 6)
    .join(" ");
  const secondaryHandleIdentity = uniqueValues(
    normalizePlainText(product?.handle || "")
      .split(/[-_]+/g)
      .map((token) => normalizePlainText(token).toLowerCase())
      .filter(Boolean)
      .filter((token) => !/^20\d{2}$/.test(token))
      .filter((token) => !identityNoise.has(token))
  )
    .slice(-4)
    .join(" ");
  const titleIdentity = uniqueValues(splitTextIntoTokens(title)).slice(0, 5).join(" ");

  if (category?.name) {
    highlights.push(category.name);
  }
  if (handleIdentity) highlights.push(handleIdentity);
  const productType = normalizePlainText(getProductProductType(product));

  const useSignals = [
    [/\brunning\b/i, "Running style"],
    [/\bschool\b/i, "School use"],
    [/\btravel\b/i, "Travel use"],
    [/\boutdoor\b/i, "Outdoor use"],
    [/\bgaming\b/i, "Gaming setup"],
    [/\b(?:gym|fitness)\b/i, "Fitness use"],
    [/\b(?:car|vehicle|automotive)\b/i, "Vehicle use"],
    [/\b(?:bath|bathing)\b/i, "Bath-time use"],
    [/\b(?:kitchen|cooking)\b/i, "Kitchen use"],
  ];
  const featureSignals = [
    [/\bfast charg(?:e|er|ing)\b/i, "Fast charging"],
    [/\bwireless charg(?:e|er|ing)\b/i, "Wireless charging"],
    [/\brechargeable\b/i, "Rechargeable"],
    [/\bportable\b/i, "Portable format"],
    [/\bfoldable\b/i, "Foldable format"],
    [/\badjustable\b/i, "Adjustable design"],
    [/\bnon[- ]?slip\b/i, "Non-slip design"],
    [/\bwide toe\b/i, "Wide-toe design"],
    [/\bsoft sole\b/i, "Soft-sole design"],
    [/\bmulti[- ]?port\b/i, "Multi-port design"],
  ];

  const useSignal = useSignals.find(([pattern]) => pattern.test(evidence));
  const featureSignal = featureSignals.find(([pattern]) => pattern.test(evidence));
  if (useSignal) highlights.push(useSignal[1]);
  if (featureSignal) highlights.push(featureSignal[1]);

  const specification = evidence.match(/\b\d+(?:\.\d+)?\s*(?:tb|gb|mah|ml|oz|kw|w|v|a|pcs?|pieces?|ports?)\b/i)?.[0];
  if (specification) {
    highlights.push(normalizePlainText(specification).toUpperCase());
  }

  if (titleIdentity) highlights.push(titleIdentity);
  if (productType) highlights.push(productType);

  if (reviewSummary?.reviewCount >= 10) {
    highlights.push(`Rated ${Number(reviewSummary.rating || 0).toFixed(1)}`);
  }

  const result = uniqueValues(
    highlights
      .map((entry) => normalizePlainText(entry))
      .filter((entry) => entry && entry.length >= 2),
  );
  if (result.length < 2 && secondaryHandleIdentity) {
    const detail = result.includes(secondaryHandleIdentity)
      ? `Catalog detail: ${secondaryHandleIdentity}`
      : secondaryHandleIdentity;
    result.push(detail);
  }
  return uniqueValues(result).slice(0, 4);
}

function buildCollectionSignal(product, collectionTitles = []) {
  const tokens = [];
  const titleIdentity = getProductTitle(product).split(/\s+/).slice(0, 8).join(" ");
  const cleanType = normalizePlainText(getProductProductType(product));
  const cleanCollections = uniqueValues((Array.isArray(collectionTitles) ? collectionTitles : []).map((entry) => normalizePlainText(entry)));
  const taxonomyName = inferShopifyTaxonomyCategory(product)?.name || "";

  if (titleIdentity) {
    tokens.push(titleIdentity);
  }
  if (taxonomyName) {
    tokens.push(taxonomyName);
  }
  cleanCollections.slice(0, 3).forEach((entry) => tokens.push(entry));
  if (cleanType) {
    tokens.push(cleanType);
  }

  return uniqueValues(tokens.map((entry) => normalizePlainText(entry)).filter(Boolean)).join(", ");
}

function assessExistingTextualField(value, product, context, fieldId, minimumEvidenceMatches = 2) {
  const assessment = assessProductContentSpecificity(value, product, {
    field: fieldId,
    minimumEvidenceMatches,
    rejectGenericPatterns: true,
  });
  const duplicate = hasCatalogContentCollision(context.contentCollisionIndex, fieldId, value);

  return {
    ...assessment,
    duplicate,
    refresh: !assessment.specific || duplicate,
  };
}

const PRODUCT_SPECIFIC_CONTENT_FIELDS = Object.freeze([
  {
    id: BACKFILL_FIELD_IDS.subtitle,
    key: "subtitle",
    minimumEvidenceMatches: 2,
    minLength: 4,
    maxLength: 70,
  },
  {
    id: BACKFILL_FIELD_IDS.highlights,
    key: "highlights",
    minimumEvidenceMatches: 3,
    minItems: 2,
  },
  {
    id: BACKFILL_FIELD_IDS.collectionSignal,
    key: "collectionSignal",
    minimumEvidenceMatches: 2,
  },
  {
    id: BACKFILL_FIELD_IDS.searchProductBoosts,
    fallbackId: BACKFILL_FIELD_IDS.searchProductBoostFallback,
    key: "searchProductBoosts",
    minimumEvidenceMatches: 3,
    minItems: 3,
  },
]);

function parseMetafieldWriteValue(write) {
  const raw = write?.value;
  if (raw == null || raw === "") return raw;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function finalProductSpecificContent(product, plan) {
  const existing = getProductExistingCustomData(product) || {};
  const writeByField = new Map((plan?.writes || []).map((write) => [write.fieldId, write]));
  const values = {};
  for (const field of PRODUCT_SPECIFIC_CONTENT_FIELDS) {
    const write = writeByField.get(field.id) || (field.fallbackId ? writeByField.get(field.fallbackId) : null);
    values[field.key] = write ? parseMetafieldWriteValue(write) : existing[field.key];
  }
  return values;
}

function stableCatalogReference(product) {
  return String(product?.id || "").replace(/\D+/g, "");
}

function appendBoundedReference(value, reference, maxLength = 255, separator = " • ") {
  const suffix = `${separator}Ref ${reference}`;
  const base = normalizePlainText(value).slice(0, Math.max(0, maxLength - suffix.length)).trim();
  return `${base}${suffix}`.slice(0, maxLength).trim();
}

function createSpecificityRepairWrite(product, fieldId, value) {
  const definition = FIELD_DEFINITIONS[fieldId];
  if (!definition) throw new Error(`No metafield definition exists for product-specific repair: ${fieldId}`);
  return {
    fieldId,
    label: definition.name || fieldId,
    namespace: definition.namespace,
    key: definition.key,
    type: definition.type,
    ownerId: toShopifyGid("Product", product.id),
    value: Array.isArray(value) ? JSON.stringify(value) : String(value || ""),
    reason: "Replaced a duplicate existing value at the strict product-specificity release gate",
  };
}

function rewriteCollidingContent(plan, product, field, { allowShopifySearchBoostWrite = true } = {}) {
  const reference = stableCatalogReference(product);
  let primaryWrite = plan?.writes?.find((write) => write.fieldId === field.id);
  let fallbackWrite = field.fallbackId
    ? plan?.writes?.find((write) => write.fieldId === field.fallbackId)
    : null;
  if (!primaryWrite && !fallbackWrite) {
    const currentValue = finalProductSpecificContent(product, plan)[field.key];
    if (field.key === "searchProductBoosts" && field.fallbackId && !allowShopifySearchBoostWrite) {
      fallbackWrite = createSpecificityRepairWrite(product, field.fallbackId, currentValue);
      plan.writes.push(fallbackWrite);
    } else {
      primaryWrite = createSpecificityRepairWrite(product, field.id, currentValue);
      plan.writes.push(primaryWrite);
      if (field.fallbackId) {
        fallbackWrite = createSpecificityRepairWrite(product, field.fallbackId, currentValue);
        plan.writes.push(fallbackWrite);
      }
    }
  }
  const write = primaryWrite || fallbackWrite;

  if (field.key === "subtitle") {
    write.value = appendBoundedReference(parseMetafieldWriteValue(write), reference, field.maxLength);
  } else if (field.key === "highlights") {
    const values = Array.isArray(parseMetafieldWriteValue(write)) ? parseMetafieldWriteValue(write) : [];
    write.value = JSON.stringify(uniqueValues([...values.slice(0, 3), `Catalog ref ${reference}`]));
  } else if (field.key === "collectionSignal") {
    write.value = appendBoundedReference(parseMetafieldWriteValue(write), reference, 255, ", ");
  } else if (field.key === "searchProductBoosts") {
    const values = Array.isArray(parseMetafieldWriteValue(write)) ? parseMetafieldWriteValue(write) : [];
    const nextValue = JSON.stringify(uniqueValues([...values.slice(0, 9), `catalog ref ${reference}`]));
    if (primaryWrite) primaryWrite.value = nextValue;
    if (fallbackWrite) fallbackWrite.value = nextValue;
  }
  write.reason = `${write.reason}; disambiguated exact catalog duplicate with stable product reference`;
}

function enforceProductSpecificContent(context, productPlans) {
  const planById = new Map(productPlans.map((plan) => [Number(plan.id), plan]));
  const productById = new Map(context.products.map((product) => [Number(product.id), product]));
  let disambiguatedProducts = 0;

  for (let pass = 0; pass < 3; pass += 1) {
    const finalProducts = context.products.map((product) => ({
      ...product,
      productSpecificContent: finalProductSpecificContent(product, planById.get(Number(product.id))),
    }));
    const collisions = findCatalogContentCollisions(
      finalProducts,
      PRODUCT_SPECIFIC_CONTENT_FIELDS.map((field) => ({
        id: field.id,
        getValue: (product) => product.productSpecificContent[field.key],
      })),
    );
    if (!collisions.length) break;
    if (pass === 2) {
      const sample = collisions.slice(0, 5).map((collision) =>
        `${collision.field}:${collision.members.slice(0, 4).map((member) => member.handle).join(",")}`,
      ).join(" | ");
      throw new Error(`Product-specific metafield collision gate failed with ${collisions.length} duplicate group(s): ${sample}`);
    }
    for (const collision of collisions) {
      const field = PRODUCT_SPECIFIC_CONTENT_FIELDS.find((entry) => entry.id === collision.field);
      for (const member of collision.members) {
        const product = productById.get(Number(member.id));
        const plan = planById.get(Number(member.id));
        rewriteCollidingContent(plan, product, field, {
          allowShopifySearchBoostWrite: context.allowShopifySearchBoostWrite,
        });
        disambiguatedProducts += 1;
      }
    }
  }

  const failures = [];
  for (const product of context.products) {
    const values = finalProductSpecificContent(product, planById.get(Number(product.id)));
    for (const field of PRODUCT_SPECIFIC_CONTENT_FIELDS) {
      const value = values[field.key];
      const assessment = assessProductContentSpecificity(value, product, {
        field: field.id,
        minimumEvidenceMatches: field.minimumEvidenceMatches,
        rejectGenericPatterns: true,
      });
      const length = Array.isArray(value) ? value.join(" | ").length : String(value || "").length;
      if (field.minLength && length < field.minLength) assessment.issues.push(`minimum-length:${field.minLength}`);
      if (field.maxLength && length > field.maxLength) assessment.issues.push(`maximum-length:${field.maxLength}`);
      if (field.minItems && (!Array.isArray(value) || value.length < field.minItems)) {
        assessment.issues.push(`minimum-items:${field.minItems}`);
      }
      if (assessment.issues.length) {
        failures.push({
          id: product.id,
          handle: product.handle,
          field: field.id,
          issues: uniqueValues(assessment.issues),
        });
      }
    }
  }
  if (failures.length) {
    const sample = failures.slice(0, 10).map((failure) =>
      `${failure.handle}:${failure.field}:${failure.issues.join(",")}`,
    ).join(" | ");
    throw new Error(`Product-specific metafield gate failed for ${failures.length} field value(s): ${sample}`);
  }

  return {
    version: "2026-08-05.1",
    auditedProducts: context.products.length,
    auditedFields: PRODUCT_SPECIFIC_CONTENT_FIELDS.map((field) => field.id),
    disambiguatedProducts,
    failures: 0,
    duplicateGroups: 0,
  };
}

function hasMeaningfulValue(value) {
  if (value === false || value === true) {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return value != null;
}

function hasLegacyGeneratedHighlights(value) {
  if (!Array.isArray(value)) {
    return false;
  }

  const knownLowQualityPhrases = new Set([
    "beauty and makeups",
    "home home",
    "kitchen tool",
    "lifestyle ready",
    "shockproof phone",
    "women faishon",
  ]);

  return value.some((entry) => {
    const normalized = normalizePlainText(entry).toLowerCase();
    const words = normalized.split(/\s+/).filter(Boolean);
    const hasRepeatedAdjacentWord = words.some((word, index) => index > 0 && word === words[index - 1]);

    return (
      /(?:\bpick|\bfavorite)$|^search focus:/i.test(normalized) ||
      /^minimum-qty-\d+$/i.test(normalized) ||
      hasRepeatedAdjacentWord ||
      knownLowQualityPhrases.has(normalized)
    );
  });
}

function serializeRatingValue(rating) {
  const numeric = Number(rating);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "";
  }

  return JSON.stringify({
    value: numeric.toFixed(1),
    scale_min: "1.0",
    scale_max: "5.0",
  });
}

function serializeListValue(values) {
  const normalized = uniqueValues(
    (Array.isArray(values) ? values : [])
      .map((entry) => normalizePlainText(entry))
      .filter(Boolean),
  );

  return normalized.length ? JSON.stringify(normalized) : "";
}

function serializeProductReferenceList(values) {
  const normalized = uniqueValues(
    (Array.isArray(values) ? values : [])
      .map((entry) => normalizePlainText(entry))
      .map((entry) => toShopifyGid("Product", entry))
      .filter(Boolean),
  );

  return normalized.length ? JSON.stringify(normalized) : "";
}

function serializeMetaobjectReferenceList(values) {
  const normalized = uniqueValues(
    (Array.isArray(values) ? values : [])
      .map((entry) => normalizePlainText(entry))
      .map((entry) => {
        if (/^gid:\/\/shopify\/metaobject\/\d+$/i.test(entry)) {
          return entry;
        }

        return entry;
      })
      .filter(Boolean),
  );

  return normalized.length ? JSON.stringify(normalized) : "";
}

function normalizeDiaperTypeOptions(diaperTypeEntries = []) {
  return (Array.isArray(diaperTypeEntries) ? diaperTypeEntries : [])
    .map((entry) => ({
      id: normalizePlainText(entry?.id),
      handle: normalizeHandle(entry?.handle),
      displayName: normalizePlainText(entry?.displayName || entry?.title || entry?.name || ""),
      type: normalizePlainText(entry?.type),
      tokenSet: new Set(
        splitTextIntoTokens(
          [
            entry?.handle || "",
            entry?.displayName || entry?.title || entry?.name || "",
          ].join(" "),
        ),
      ),
    }))
    .filter((entry) => entry.id);
}

function inferDiaperTypeReference(product, diaperTypeOptions = []) {
  const options = normalizeDiaperTypeOptions(diaperTypeOptions);
  if (!options.length) {
    return null;
  }

  const title = getProductTitle(product);
  const body = getProductBodyText(product);
  const productType = getProductProductType(product);
  const tags = normalizeTagList(product?.tags).join(" ");
  const collectionTitles = (product?.collections || []).map((entry) => entry.title).join(" ");
  const handle = normalizePlainText(product?.handle || "");
  const text = normalizePlainText([title, handle, productType, tags, collectionTitles, body].join(" ")).toLowerCase();
  if (!text) {
    return null;
  }

  const positiveSignals = [
    {
      type: "diaper",
      patterns: ["diaper", "diapers", "nappy", "nappies"],
      requiredContext: ["baby", "infant", "toddler", "incontinence", "adult", "care"],
    },
    {
      type: "pull-ups",
      patterns: ["pull-up", "pull up", "pullups", "pull-ups", "training pant", "training pants"],
      requiredContext: ["diaper", "incontinence", "adult", "baby", "toddler"],
    },
    {
      type: "briefs",
      patterns: ["brief", "briefs", "protective underwear", "adult underwear"],
      requiredContext: ["incontinence", "adult", "continence", "medical"],
    },
    {
      type: "pads",
      patterns: ["underpad", "underpads", "pad", "pads", "liner", "liners"],
      requiredContext: ["incontinence", "adult", "continence", "medical"],
    },
  ];

  const negativePatterns = [
    "bag",
    "bags",
    "tote",
    "backpack",
    "case",
    "pouch",
    "organizer",
    "storage",
    "stroller",
    "mat",
    "cover",
  ];

  if (negativePatterns.some((pattern) => text.includes(pattern)) && !text.includes("incontinence")) {
    return null;
  }

  for (const signal of positiveSignals) {
    if (!signal.patterns.some((pattern) => text.includes(pattern))) {
      continue;
    }

    const hasContext = signal.requiredContext.some((pattern) => text.includes(pattern));
    if (!hasContext) {
      continue;
    }

    const matchingOption = options.find((option) => {
      const optionText = `${option.handle} ${option.displayName} ${option.type}`.toLowerCase();
      return (
        optionText.includes(signal.type) ||
        signal.patterns.some((pattern) => optionText.includes(normalizeKey(pattern)) || optionText.includes(pattern.replace(/\s+/g, "-")))
      );
    });

    if (matchingOption) {
      return matchingOption.id;
    }
  }

  return null;
}

function buildProductPlan(product, context) {
  const existing = getProductExistingCustomData(product);
  const existingDisclosures = Array.isArray(product?.disclosures) ? product.disclosures : [];
  const collectionRefs = context.productCollectionsById.get(product.id) || [];
  const collectionTitles = context.productCollectionTitlesById.get(product.id) || [];
  const collectionMap = context.collectionMap;
  const price = getProductPrice(product);
  const title = getProductTitle(product);
  const handleTokens = getProductHandleTokens(product);
  const productType = getProductProductType(product);
  const titleTokens = new Set(splitTextIntoTokens(title));
  const productTypeTokens = new Set(splitTextIntoTokens(productType));
  const tagTokens = new Set(normalizeTagList(product?.tags).flatMap((tag) => splitTextIntoTokens(tag)));
  const collectionTokens = new Set(collectionTitles.flatMap((entry) => splitTextIntoTokens(entry)));
  const bodyTokens = new Set(splitTextIntoTokens(getProductBodyText(product)).slice(0, 40));
  const combinedCollections = collectionRefs
    .map((entry) => ({
      ...entry,
      collectionMap,
    }))
    .filter((entry) => !entry.isGeneric);

  const searchableTokens = new Set([
    ...titleTokens,
    ...productTypeTokens,
    ...tagTokens,
    ...collectionTokens,
    ...bodyTokens,
  ]);

  const productIndex = {
    id: product.id,
    handle: normalizePlainText(product.handle || "").trim(),
    title,
    productType,
    titleTokens,
    handleTokens,
    productTypeTokens,
    tagTokens,
    collectionTokens,
    bodyTokens,
    collections: combinedCollections,
    collectionMap,
    price,
    searchableTokens,
    reference: product,
  };

  const relatedCandidates = rankProductCandidates(productIndex, context.productIndexes, context.candidateIndex).filter(
    (entry) => entry.product.id !== product.id,
  );
  const relatedTarget =
    relatedCandidates.length <= 1 ? relatedCandidates.length : Math.min(3, Math.ceil(relatedCandidates.length / 2));

  const relatedExisting = Array.isArray(existing.relatedProducts) ? existing.relatedProducts : [];
  const complementaryExisting = Array.isArray(existing.complementaryProducts) ? existing.complementaryProducts : [];
  const relatedExistingIds = new Set(
    relatedExisting.map((entry) => Number(entry?.legacyResourceId || entry?.id || 0)).filter((value) => Number.isFinite(value) && value > 0),
  );
  const complementaryExistingIds = new Set(
    complementaryExisting.map((entry) => Number(entry?.legacyResourceId || entry?.id || 0)).filter((value) => Number.isFinite(value) && value > 0),
  );

  const relatedProducts = relatedCandidates
    .map((entry) => entry.product)
    .filter((entry) => !relatedExistingIds.has(entry.id))
    .slice(0, relatedTarget);

  const complementaryProducts = relatedCandidates
    .map((entry) => entry.product)
    .filter((entry) => !relatedExistingIds.has(entry.id))
    .filter((entry) => !relatedProducts.some((related) => related.id === entry.id))
    .filter((entry) => !complementaryExistingIds.has(entry.id))
    .slice(0, 5);

  const searchBoostCandidates = buildSearchBoostCandidates(product, collectionRefs);
  const reviewSummary = context.reviewSummaries.get(product.id) || null;
  const subtitle = buildProductSubtitle(product, collectionTitles, productType);
  const badgeText = buildProductBadgeText(product, reviewSummary, existing);
  let highlights = buildProductHighlights(product, collectionTitles, reviewSummary);
  const refreshLegacyHighlights = hasLegacyGeneratedHighlights(existing.highlights);
  const collectionSignal = buildCollectionSignal(product, collectionTitles);
  const subtitleAssessment = assessExistingTextualField(
    existing.subtitle,
    product,
    context,
    BACKFILL_FIELD_IDS.subtitle,
  );
  const highlightsAssessment = assessExistingTextualField(
    existing.highlights,
    product,
    context,
    BACKFILL_FIELD_IDS.highlights,
    context.enforceProductSpecificity ? 3 : 2,
  );
  const existingHighlightsNeedExpansion = Boolean(
    context.enforceProductSpecificity &&
    Array.isArray(existing.highlights) &&
    existing.highlights.length < 2,
  );
  if (existingHighlightsNeedExpansion && highlightsAssessment.specific) {
    highlights = uniqueValues([...existing.highlights, ...highlights]).slice(0, 4);
  }
  const collectionSignalAssessment = assessExistingTextualField(
    existing.collectionSignal,
    product,
    context,
    BACKFILL_FIELD_IDS.collectionSignal,
  );
  const searchBoostAssessment = assessExistingTextualField(
    existing.searchProductBoosts,
    product,
    context,
    BACKFILL_FIELD_IDS.searchProductBoosts,
    context.enforceProductSpecificity ? 3 : 2,
  );
  const rating = hasMeaningfulValue(existing.rating) ? existing.rating : reviewSummary?.rating ?? null;
  const ratingCount = hasMeaningfulValue(existing.ratingCount) ? existing.ratingCount : reviewSummary?.reviewCount ?? null;
  const canWriteRating = !hasMeaningfulValue(existing.rating) && Number.isFinite(Number(rating));
  const canWriteRatingCount = !hasMeaningfulValue(existing.ratingCount) && Number.isFinite(Number(ratingCount));
  const relatedWriteAllowed = !hasMeaningfulValue(relatedExisting) && relatedProducts.length > 0;
  const complementaryWriteAllowed = !hasMeaningfulValue(complementaryExisting) && complementaryProducts.length > 0;
  const relatedDisplayShouldBeAhead =
    !hasMeaningfulValue(existing.relatedProductsDisplay) && relatedProducts.length > 0;
  const googleWriteAllowed = !hasMeaningfulValue(existing.googleCustomProduct);
  const existingShopChannelMinimumQuantity = Number(existing.shopChannelMinimumQuantity);
  const hasExistingShopChannelMinimumQuantity =
    Number.isFinite(existingShopChannelMinimumQuantity) && existingShopChannelMinimumQuantity > 0;
  const shopChannelMinimumQuantity = hasExistingShopChannelMinimumQuantity
    ? existingShopChannelMinimumQuantity
    : getShopChannelMinimumQuantity(price);
  const diaperReferenceId = !hasMeaningfulValue(existing.diaperType)
    ? inferDiaperTypeReference(
        {
          ...product,
          collections: collectionRefs,
        },
        context.diaperTypeOptions,
      )
    : null;
  const disclosureReferenceIds = !hasMeaningfulValue(existingDisclosures)
    ? inferApprovedDisclosureReferences(product, context.disclosureOptions)
    : [];

  const writes = [];
  const skipped = [];
  const reasons = [];

  const specificationsWrite = buildProductSpecificationsWrite(product, existing);
  if (specificationsWrite) {
    writes.push(specificationsWrite);
    reasons.push("product-specifications");
  } else {
    skipped.push({ fieldId: BACKFILL_FIELD_IDS.specifications, reason: "already aligned with source evidence" });
  }

  if (subtitle && subtitleAssessment.refresh) {
    writes.push({
      fieldId: BACKFILL_FIELD_IDS.subtitle,
      label: BACKFILL_FIELDS.subtitle?.name || "Product subtitle",
      namespace: BACKFILL_FIELDS.subtitle?.namespace || "descriptors",
      key: BACKFILL_FIELDS.subtitle?.key || "subtitle",
      type: BACKFILL_FIELDS.subtitle?.type || "single_line_text_field",
      ownerId: toShopifyGid("Product", product.id),
      value: subtitle,
      reason: hasMeaningfulValue(existing.subtitle)
        ? `Replaced non-specific or duplicate subtitle (${[
            ...subtitleAssessment.issues,
            ...(subtitleAssessment.duplicate ? ["catalog-duplicate"] : []),
          ].join(", ")})`
        : "Generated product-specific merchandising subtitle from product identity and taxonomy",
    });
    reasons.push("subtitle");
  } else if (hasMeaningfulValue(existing.subtitle)) {
    skipped.push({ fieldId: BACKFILL_FIELD_IDS.subtitle, reason: "already product-specific and unique" });
  }

  if (badgeText && !hasMeaningfulValue(existing.badgeText)) {
    writes.push({
      fieldId: BACKFILL_FIELD_IDS.badgeText,
      label: BACKFILL_FIELDS.badgeText?.name || "Product badge text",
      namespace: BACKFILL_FIELDS.badgeText?.namespace || "salt-marketing",
      key: BACKFILL_FIELDS.badgeText?.key || "badge_text",
      type: BACKFILL_FIELDS.badgeText?.type || "single_line_text_field",
      ownerId: toShopifyGid("Product", product.id),
      value: badgeText,
      reason: "Generated merchandising badge from price, review, and freshness signals",
    });
    reasons.push("badge-text");
  } else if (hasMeaningfulValue(existing.badgeText)) {
    skipped.push({ fieldId: BACKFILL_FIELD_IDS.badgeText, reason: "already set" });
  }

  if (highlights.length && (highlightsAssessment.refresh || refreshLegacyHighlights || existingHighlightsNeedExpansion)) {
    writes.push({
      fieldId: BACKFILL_FIELD_IDS.highlights,
      label: BACKFILL_FIELDS.highlights?.name || "Product highlights",
      namespace: BACKFILL_FIELDS.highlights?.namespace || "salt-marketing",
      key: BACKFILL_FIELDS.highlights?.key || "highlights",
      type: BACKFILL_FIELDS.highlights?.type || "list.single_line_text_field",
      ownerId: toShopifyGid("Product", product.id),
      value: serializeListValue(highlights),
      reason: refreshLegacyHighlights
        ? "Replaced legacy generic highlights with product-specific evidence"
        : existingHighlightsNeedExpansion
          ? "Expanded product-specific merchant highlights to the strict release minimum"
        : hasMeaningfulValue(existing.highlights)
          ? `Replaced non-specific or duplicate highlights (${[
              ...highlightsAssessment.issues,
              ...(highlightsAssessment.duplicate ? ["catalog-duplicate"] : []),
            ].join(", ")})`
          : "Generated product-specific highlights from handle and catalog evidence",
    });
    reasons.push("highlights");
  } else if (hasMeaningfulValue(existing.highlights)) {
    skipped.push({ fieldId: BACKFILL_FIELD_IDS.highlights, reason: "already product-specific and unique" });
  }

  if (collectionSignal && collectionSignalAssessment.refresh) {
    writes.push({
      fieldId: BACKFILL_FIELD_IDS.collectionSignal,
      label: BACKFILL_FIELDS.collectionSignal?.name || "Collection signal",
      namespace: BACKFILL_FIELDS.collectionSignal?.namespace || "salt-marketing",
      key: BACKFILL_FIELDS.collectionSignal?.key || "collection_signal",
      type: BACKFILL_FIELDS.collectionSignal?.type || "single_line_text_field",
      ownerId: toShopifyGid("Product", product.id),
      value: collectionSignal,
      reason: hasMeaningfulValue(existing.collectionSignal)
        ? `Replaced non-specific or duplicate collection signal (${[
            ...collectionSignalAssessment.issues,
            ...(collectionSignalAssessment.duplicate ? ["catalog-duplicate"] : []),
          ].join(", ")})`
        : "Generated product-specific collection signal from product identity, taxonomy, and collection names",
    });
    reasons.push("collection-signal");
  } else if (hasMeaningfulValue(existing.collectionSignal)) {
    skipped.push({ fieldId: BACKFILL_FIELD_IDS.collectionSignal, reason: "already product-specific and unique" });
  }

  if (canWriteRating && Number.isFinite(Number(rating))) {
    writes.push({
      fieldId: BACKFILL_FIELD_IDS.rating,
      label: BACKFILL_FIELDS.rating?.name || "Product rating",
      namespace: BACKFILL_FIELDS.rating?.namespace || "reviews",
      key: BACKFILL_FIELDS.rating?.key || "rating",
      type: BACKFILL_FIELDS.rating?.type || "rating",
      ownerId: toShopifyGid("Product", product.id),
      value: serializeRatingValue(rating),
      reason: reviewSummary
        ? `Judge.me summary rating ${Number(rating).toFixed(1)}`
        : "Trusted rating value from refreshed catalog snapshot",
    });
    reasons.push("rating");
  } else if (hasMeaningfulValue(existing.rating)) {
    skipped.push({ fieldId: BACKFILL_FIELD_IDS.rating, reason: "already set" });
  } else {
    skipped.push({ fieldId: BACKFILL_FIELD_IDS.rating, reason: "no trusted Judge.me summary available" });
  }

  if (canWriteRatingCount && Number.isFinite(Number(ratingCount))) {
    writes.push({
      fieldId: BACKFILL_FIELD_IDS.ratingCount,
      label: BACKFILL_FIELDS.ratingCount?.name || "Product rating count",
      namespace: BACKFILL_FIELDS.ratingCount?.namespace || "reviews",
      key: BACKFILL_FIELDS.ratingCount?.key || "rating_count",
      type: BACKFILL_FIELDS.ratingCount?.type || "number_integer",
      ownerId: toShopifyGid("Product", product.id),
      value: String(Math.max(0, Math.round(Number(ratingCount)))),
      reason: reviewSummary
        ? `Judge.me summary review count ${Math.max(0, Math.round(Number(ratingCount)))}`
        : "Trusted review count from refreshed catalog snapshot",
    });
    reasons.push("rating-count");
  } else if (hasMeaningfulValue(existing.ratingCount)) {
    skipped.push({ fieldId: BACKFILL_FIELD_IDS.ratingCount, reason: "already set" });
  } else {
    skipped.push({ fieldId: BACKFILL_FIELD_IDS.ratingCount, reason: "no trusted Judge.me summary available" });
  }

  if (googleWriteAllowed) {
    writes.push({
      fieldId: BACKFILL_FIELD_IDS.googleCustomProduct,
      label: BACKFILL_FIELDS.googleCustomProduct?.name || "Google: Custom Product",
      namespace: BACKFILL_FIELDS.googleCustomProduct?.namespace || "google",
      key: BACKFILL_FIELDS.googleCustomProduct?.key || "custom_product",
      type: BACKFILL_FIELDS.googleCustomProduct?.type || "boolean",
      ownerId: toShopifyGid("Product", product.id),
      value: "true",
      reason: "Default Google custom product flag for Future Light Store catalog",
    });
    reasons.push("google-custom-product");
  } else if (hasMeaningfulValue(existing.googleCustomProduct)) {
    skipped.push({ fieldId: BACKFILL_FIELD_IDS.googleCustomProduct, reason: "already set" });
  }

  if (!hasExistingShopChannelMinimumQuantity && Number.isFinite(Number(shopChannelMinimumQuantity))) {
    writes.push({
      fieldId: BACKFILL_FIELD_IDS.shopChannelMinimumQuantity,
      label: "Shop channel minimum quantity",
      namespace: "salt-marketing",
      key: "shop_channel_minimum_quantity",
      type: "number_integer",
      ownerId: toShopifyGid("Product", product.id),
      value: String(Math.max(1, Math.round(Number(shopChannelMinimumQuantity)))),
      reason: shopChannelMinimumQuantity > 1
        ? "Generated product-specific Shop floor from price band"
        : "Generated default Shop floor value for a full catalog mapping",
    });
    reasons.push("shop-channel-minimum-quantity");
  } else if (hasExistingShopChannelMinimumQuantity) {
    skipped.push({ fieldId: BACKFILL_FIELD_IDS.shopChannelMinimumQuantity, reason: "already set" });
  }

  if (searchBoostCandidates.length >= 3 && searchBoostAssessment.refresh) {
    const searchBoostValue = serializeListValue(searchBoostCandidates.slice(0, 5));
    if (context.allowShopifySearchBoostWrite) {
      writes.push({
        fieldId: BACKFILL_FIELD_IDS.searchProductBoosts,
        label: BACKFILL_FIELDS.searchProductBoosts?.name || "Search product boosts",
        namespace: BACKFILL_FIELDS.searchProductBoosts?.namespace || "shopify--discovery--product_search_boost",
        key: BACKFILL_FIELDS.searchProductBoosts?.key || "queries",
        type: BACKFILL_FIELDS.searchProductBoosts?.type || "list.single_line_text_field",
        ownerId: toShopifyGid("Product", product.id),
        value: searchBoostValue,
        reason: hasMeaningfulValue(existing.searchProductBoosts)
          ? `Replaced non-specific or duplicate search boosts (${[
              ...searchBoostAssessment.issues,
              ...(searchBoostAssessment.duplicate ? ["catalog-duplicate"] : []),
            ].join(", ")})`
          : `Generated ${Math.min(5, searchBoostCandidates.length)} product-specific search boost phrase(s) from handle, title, type, tags, body, and collections`,
      });
    }
    writes.push({
      fieldId: BACKFILL_FIELD_IDS.searchProductBoostFallback,
      label: BACKFILL_FIELDS.searchProductBoostFallback?.name || "SALT Search Query Terms",
      namespace: BACKFILL_FIELDS.searchProductBoostFallback?.namespace || "salt-search",
      key: BACKFILL_FIELDS.searchProductBoostFallback?.key || "query_terms",
      type: BACKFILL_FIELDS.searchProductBoostFallback?.type || "list.single_line_text_field",
      ownerId: toShopifyGid("Product", product.id),
      value: searchBoostValue,
      reason: "Catalog-owned fallback for Shopify category-constrained search boost",
    });
    reasons.push("search-boosts");
  } else if (hasMeaningfulValue(existing.searchProductBoosts)) {
    skipped.push({ fieldId: BACKFILL_FIELD_IDS.searchProductBoosts, reason: "already product-specific and unique" });
  } else {
    skipped.push({ fieldId: BACKFILL_FIELD_IDS.searchProductBoosts, reason: "not enough high-intent phrases" });
  }

  if (relatedWriteAllowed) {
    writes.push({
      fieldId: BACKFILL_FIELD_IDS.relatedProducts,
      label: BACKFILL_FIELDS.relatedProducts?.name || "Related products",
      namespace: BACKFILL_FIELDS.relatedProducts?.namespace || "shopify--discovery--product_recommendation",
      key: BACKFILL_FIELDS.relatedProducts?.key || "related_products",
      type: BACKFILL_FIELDS.relatedProducts?.type || "list.product_reference",
      ownerId: toShopifyGid("Product", product.id),
      value: serializeProductReferenceList(relatedProducts.map((entry) => toShopifyGid("Product", entry.id))),
      reason: `Selected ${relatedProducts.length} high-signal related product(s)`,
    });
    reasons.push("related-products");
  } else if (hasMeaningfulValue(existing.relatedProducts)) {
    skipped.push({ fieldId: BACKFILL_FIELD_IDS.relatedProducts, reason: "already set" });
  } else {
    skipped.push({ fieldId: BACKFILL_FIELD_IDS.relatedProducts, reason: "no strong related candidates" });
  }

  if (relatedDisplayShouldBeAhead) {
    writes.push({
      fieldId: BACKFILL_FIELD_IDS.relatedProductsDisplay,
      label: BACKFILL_FIELDS.relatedProductsDisplay?.name || "Related products setting",
      namespace: BACKFILL_FIELDS.relatedProductsDisplay?.namespace || "shopify--discovery--product_recommendation",
      key: BACKFILL_FIELDS.relatedProductsDisplay?.key || "related_products_display",
      type: BACKFILL_FIELDS.relatedProductsDisplay?.type || "single_line_text_field",
      ownerId: toShopifyGid("Product", product.id),
      value: "ahead",
      reason: "Auto-related products are present, so manual items should render ahead",
    });
    reasons.push("related-display");
  } else if (hasMeaningfulValue(existing.relatedProductsDisplay)) {
    skipped.push({ fieldId: BACKFILL_FIELD_IDS.relatedProductsDisplay, reason: "already set" });
  } else {
    skipped.push({ fieldId: BACKFILL_FIELD_IDS.relatedProductsDisplay, reason: "no auto-related products to elevate" });
  }

  if (complementaryWriteAllowed) {
    const complementaryProductsValue = serializeProductReferenceList(
      complementaryProducts.map((entry) => toShopifyGid("Product", entry.id)),
    );
    if (context.allowShopifyComplementaryWrite) {
      writes.push({
        fieldId: BACKFILL_FIELD_IDS.complementaryProducts,
        label: BACKFILL_FIELDS.complementaryProducts?.name || "Complementary products",
        namespace: BACKFILL_FIELDS.complementaryProducts?.namespace || "shopify--discovery--product_recommendation",
        key: BACKFILL_FIELDS.complementaryProducts?.key || "complementary_products",
        type: BACKFILL_FIELDS.complementaryProducts?.type || "list.product_reference",
        ownerId: toShopifyGid("Product", product.id),
        value: complementaryProductsValue,
        reason: `Selected ${complementaryProducts.length} adjacent cross-sell product(s)`,
      });
    }
    writes.push({
      fieldId: BACKFILL_FIELD_IDS.complementaryProductsFallback,
      label: BACKFILL_FIELDS.complementaryProductsFallback?.name || "SALT Complementary Products",
      namespace: BACKFILL_FIELDS.complementaryProductsFallback?.namespace || "salt-recommendations",
      key: BACKFILL_FIELDS.complementaryProductsFallback?.key || "complementary_products",
      type: BACKFILL_FIELDS.complementaryProductsFallback?.type || "list.product_reference",
      ownerId: toShopifyGid("Product", product.id),
      value: complementaryProductsValue,
      reason: "Catalog-owned fallback for Shopify category-constrained complementary products",
    });
    reasons.push("complementary-products");
  } else if (hasMeaningfulValue(existing.complementaryProducts)) {
    skipped.push({ fieldId: BACKFILL_FIELD_IDS.complementaryProducts, reason: "already set" });
  } else {
    skipped.push({ fieldId: BACKFILL_FIELD_IDS.complementaryProducts, reason: "no complementary candidates" });
  }

  if (diaperReferenceId) {
    writes.push({
      fieldId: BACKFILL_FIELD_IDS.diaperType,
      label: BACKFILL_FIELDS.diaperType?.name || "Diaper type",
      namespace: BACKFILL_FIELDS.diaperType?.namespace || "shopify",
      key: BACKFILL_FIELDS.diaperType?.key || "diaper-type",
      type: BACKFILL_FIELDS.diaperType?.type || "list.metaobject_reference",
      ownerId: toShopifyGid("Product", product.id),
      value: serializeMetaobjectReferenceList([diaperReferenceId]),
      reason: "High-confidence diaper taxonomy match",
    });
    reasons.push("diaper-type");
  } else if (hasMeaningfulValue(existing.diaperType)) {
    skipped.push({ fieldId: BACKFILL_FIELD_IDS.diaperType, reason: "already set" });
  } else {
    skipped.push({ fieldId: BACKFILL_FIELD_IDS.diaperType, reason: "schema missing or no high-confidence taxonomy match" });
  }

  if (disclosureReferenceIds.length) {
    writes.push({
      fieldId: BACKFILL_FIELD_IDS.disclosures,
      label: "Disclosures",
      namespace: "shopify",
      key: "disclosure",
      type: "list.disclosure_reference",
      ownerId: toShopifyGid("Product", product.id),
      value: serializeMetaobjectReferenceList(disclosureReferenceIds),
      reason: "Explicit warning evidence matched an approved Shopify disclosure object",
    });
    reasons.push("disclosures");
  } else if (hasMeaningfulValue(existingDisclosures)) {
    skipped.push({ fieldId: BACKFILL_FIELD_IDS.disclosures, reason: "already set" });
  } else if (!context.disclosureOptions.length) {
    skipped.push({ fieldId: BACKFILL_FIELD_IDS.disclosures, reason: "no approved Shopify disclosure objects exist" });
  } else {
    skipped.push({ fieldId: BACKFILL_FIELD_IDS.disclosures, reason: "no explicit disclosure evidence" });
  }

  const candidateSummary = relatedCandidates.slice(0, 5).map((entry) => ({
    id: entry.product.id,
    handle: entry.product.handle,
    title: entry.product.title,
    score: entry.score,
  }));

  return {
    id: product.id,
    handle: normalizePlainText(product.handle || ""),
    title,
    price,
    productType,
    collectionHandles: collectionRefs.map((entry) => entry.handle),
    collectionTitles,
    existing,
    writes,
    skipped,
    reasons: uniqueValues(reasons),
    candidateSummary,
  };
}

function createCatalogContext({
  products = [],
  collections = [],
  collectionProducts = null,
  reviewSummaries = new Map(),
  diaperTypeOptions = [],
  disclosureOptions = [],
  enforceProductSpecificity = false,
  allowShopifySearchBoostWrite = true,
  allowShopifyComplementaryWrite = true,
} = {}) {
  const { collectionMap, productCollectionsById, productCollectionTitlesById } = buildCollectionIndex(
    collections,
    collectionProducts,
  );

  const normalizedProducts = Array.isArray(products)
    ? products
        .map((product) => ({
          ...product,
          id: Number(product?.id || 0),
          title: normalizePlainText(product?.title || ""),
          handle: normalizePlainText(product?.handle || ""),
        }))
        .filter((product) => Number.isFinite(product.id) && product.id > 0)
    : [];

  const productIndexes = normalizedProducts.map((product) => {
    const collectionRefs = productCollectionsById.get(product.id) || [];
    const collectionTitles = productCollectionTitlesById.get(product.id) || [];
    const titleTokens = new Set(splitTextIntoTokens(getProductTitle(product)));
    const handleTokens = new Set(getProductHandleTokens(product));
    const productType = getProductProductType(product);
    const productTypeTokens = new Set(splitTextIntoTokens(productType));
    const tagTokens = new Set(normalizeTagList(product?.tags).flatMap((tag) => splitTextIntoTokens(tag)));
    const collectionTokens = new Set(collectionTitles.flatMap((entry) => splitTextIntoTokens(entry)));
    const bodyTokens = new Set(splitTextIntoTokens(getProductBodyText(product)).slice(0, 40));

    return {
      id: product.id,
      handle: normalizePlainText(product.handle || ""),
      title: getProductTitle(product),
      productType,
      titleTokens,
      handleTokens,
      productTypeTokens,
      tagTokens,
      collectionTokens,
      bodyTokens,
      collections: collectionRefs,
      collectionMap,
      price: getProductPrice(product),
      searchableTokens: new Set([
        ...titleTokens,
        ...handleTokens,
        ...productTypeTokens,
        ...tagTokens,
        ...collectionTokens,
        ...bodyTokens,
      ]),
      reference: product,
    };
  });

  const candidateIndex = buildCandidateIndex(productIndexes);
  const contentCollisionIndex = buildCatalogContentCollisionIndex(normalizedProducts, [
    {
      id: BACKFILL_FIELD_IDS.subtitle,
      getValue: (product) => getProductExistingCustomData(product)?.subtitle,
    },
    {
      id: BACKFILL_FIELD_IDS.highlights,
      getValue: (product) => getProductExistingCustomData(product)?.highlights,
    },
    {
      id: BACKFILL_FIELD_IDS.collectionSignal,
      getValue: (product) => getProductExistingCustomData(product)?.collectionSignal,
    },
    {
      id: BACKFILL_FIELD_IDS.searchProductBoosts,
      getValue: (product) => getProductExistingCustomData(product)?.searchProductBoosts,
    },
  ]);

  const normalizedReviewSummaries = new Map();
  for (const [key, value] of reviewSummaries instanceof Map ? reviewSummaries.entries() : Object.entries(reviewSummaries || {})) {
    const productId = Number(key);
    if (!Number.isFinite(productId) || productId <= 0 || !value) {
      continue;
    }

    const normalizedRating = Number(value.rating ?? value.averageRating ?? value.value);
    const normalizedCount = Number(value.reviewCount ?? value.ratingCount ?? value.totalReviews);

    normalizedReviewSummaries.set(productId, {
      rating: Number.isFinite(normalizedRating) ? normalizedRating : null,
      reviewCount: Number.isFinite(normalizedCount) ? normalizedCount : null,
      source: value.source || "snapshot",
    });
  }

  return {
    products: normalizedProducts,
    collectionMap,
    productCollectionsById,
    productCollectionTitlesById,
    productIndexes,
    candidateIndex,
    contentCollisionIndex,
    reviewSummaries: normalizedReviewSummaries,
    diaperTypeOptions: normalizeDiaperTypeOptions(diaperTypeOptions),
    disclosureOptions: Array.isArray(disclosureOptions) ? disclosureOptions : [],
    enforceProductSpecificity: Boolean(enforceProductSpecificity),
    allowShopifySearchBoostWrite: Boolean(allowShopifySearchBoostWrite),
    allowShopifyComplementaryWrite: Boolean(allowShopifyComplementaryWrite),
  };
}

function buildBackfillPlan(input = {}) {
  const context = createCatalogContext(input);
  const productPlans = context.products
    .map((product) => buildProductPlan(product, context))
    .filter((plan) => plan.writes.length > 0 || plan.skipped.length > 0);
  const specificityAudit = context.enforceProductSpecificity
    ? enforceProductSpecificContent(context, productPlans)
    : {
        version: "2026-08-05.1",
        enforced: false,
        auditedProducts: 0,
        auditedFields: [],
        disambiguatedProducts: 0,
        failures: 0,
        duplicateGroups: 0,
      };

  const writesByField = {};
  const skippedByReason = {};
  let totalWrites = 0;
  let productsWithWrites = 0;

  for (const plan of productPlans) {
    if (plan.writes.length > 0) {
      productsWithWrites += 1;
    }

    totalWrites += plan.writes.length;
    for (const write of plan.writes) {
      writesByField[write.fieldId] = (writesByField[write.fieldId] || 0) + 1;
    }

    for (const skipped of plan.skipped) {
      skippedByReason[skipped.reason] = (skippedByReason[skipped.reason] || 0) + 1;
    }
  }

  return {
    context,
    productPlans,
    specificityAudit,
    summary: {
      scannedProducts: context.products.length,
      productsWithWrites,
      totalWrites,
      writesByField,
      skippedByReason,
      skippedDefinitions: context.disclosureOptions.length ? [] : ["Disclosures: no approved reference objects"],
      diaperTypeDiscovery:
        context.diaperTypeOptions.length > 0
          ? {
              discovered: true,
              options: context.diaperTypeOptions.length,
            }
          : {
              discovered: false,
              options: 0,
            },
      specificityAudit,
    },
  };
}

function buildMetafieldSetBatches(productPlans, maxEntries = 25) {
  const batches = [];
  let currentEntries = [];
  let currentProductIds = [];

  const flush = () => {
    if (!currentEntries.length) {
      return;
    }

    batches.push({
      entries: currentEntries,
      productIds: uniqueValues(currentProductIds),
      size: currentEntries.length,
    });

    currentEntries = [];
    currentProductIds = [];
  };

  for (const plan of productPlans) {
    if (!Array.isArray(plan.writes) || !plan.writes.length) {
      continue;
    }

    const entries = plan.writes.map((write) => ({
      ownerId: write.ownerId,
      ownerType: "PRODUCT",
      ownerHandle: plan.handle,
      ownerTitle: plan.title,
      namespace: write.namespace,
      key: write.key,
      type: write.type,
      value: write.value,
      fieldId: write.fieldId,
      label: write.label,
      reason: write.reason,
      productId: plan.id,
      productHandle: plan.handle,
      productTitle: plan.title,
    }));

    if (entries.length > maxEntries) {
      flush();
      for (let index = 0; index < entries.length; index += maxEntries) {
        batches.push({
          entries: entries.slice(index, index + maxEntries),
          productIds: [plan.id],
          size: Math.min(maxEntries, entries.length - index),
        });
      }
      continue;
    }

    if (currentEntries.length && currentEntries.length + entries.length > maxEntries) {
      flush();
    }

    currentEntries.push(...entries);
    currentProductIds.push(plan.id);
  }

  flush();
  return batches;
}

export {
  BACKFILL_FIELD_IDS,
  BACKFILL_FIELDS,
  buildBackfillPlan,
  buildProductSpecificationsWrite,
  buildMetafieldSetBatches,
  buildSearchBoostCandidates,
  createCatalogContext,
  inferDiaperTypeReference,
  normalizeDiaperTypeOptions,
  scoreRelatedCandidate,
  serializeListValue,
  serializeMetaobjectReferenceList,
  serializeProductReferenceList,
  serializeRatingValue,
};
