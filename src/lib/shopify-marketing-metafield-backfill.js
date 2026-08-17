import { normalizePlainText, parseMoneyValue, toShopifyGid } from "./shopify-seo-batch.js";
import { serializeListValue, serializeProductReferenceList } from "./shopify-product-metafield-backfill.js";

const COLLECTION_FIELD_IDS = {
  heroKicker: "salt-marketing.hero_kicker",
  heroSummary: "salt-marketing.hero_summary",
  featuredProducts: "salt-marketing.featured_products",
  trustStrip: "salt-marketing.trust_strip",
};

const SHOP_FIELD_IDS = {
  bannerText: "salt-marketing.banner_text",
  trustStrip: "salt-marketing.trust_strip",
};

function uniqueValues(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((value) => normalizePlainText(value)).filter(Boolean)));
}

function stripHtml(input) {
  return normalizePlainText(String(input || "").replace(/<[^>]+>/g, " "));
}

function splitTokens(input) {
  return stripHtml(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
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

function parseNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function getProductPrice(product) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const values = variants
    .map((variant) => parseMoneyValue(variant?.price))
    .filter((value) => Number.isFinite(value) && value > 0);

  return values.length ? Math.min(...values) : null;
}

function getProductCompareAtPrice(product) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const values = variants
    .map((variant) => parseMoneyValue(variant?.compare_at_price))
    .filter((value) => Number.isFinite(value) && value > 0);

  return values.length ? Math.max(...values) : null;
}

function getCollectionProducts(collection, context) {
  const handle = String(collection?.handle || "").trim().toLowerCase();
  const candidateIds = Array.isArray(context.collectionProductIdsByHandle?.get(handle))
    ? context.collectionProductIdsByHandle.get(handle)
    : [];
  const productIds = candidateIds.length > 0 ? candidateIds : Number(collection?.products_count || 0) > 0 ? context.products.map((product) => product.id) : [];

  return productIds
    .map((productId) => context.productsById.get(Number(productId)))
    .filter(Boolean);
}

function scoreFeaturedProduct(product, collection) {
  if (!product) {
    return 0;
  }

  const titleTokens = splitTokens(product.title);
  const collectionTokens = splitTokens(collection.title);
  const productTypeTokens = splitTokens(product.product_type || "");
  const tagTokens = splitTokens(Array.isArray(product.tags) ? product.tags.join(" ") : product.tags || "");
  const reviewCount = parseNumber(product.average_rating ? product.total_reviews || 0 : product.customData?.ratingCount || product.total_reviews || 0) || 0;
  const rating = parseNumber(product.average_rating || product.customData?.rating || 0) || 0;
  const price = getProductPrice(product) || 0;
  const compareAt = getProductCompareAtPrice(product) || 0;
  const savings = compareAt > price && price > 0 ? Math.round(((compareAt - price) / compareAt) * 100) : 0;
  const imageBoost = product.image?.src || (Array.isArray(product.images) && product.images.length ? product.images[0]?.src : "") ? 10 : 0;

  let score = 0;
  score += reviewCount * 4;
  score += rating * 12;
  score += savings * 1.5;
  score += imageBoost;
  score += Math.min(18, collectionTokens.filter((token) => titleTokens.includes(token)).length * 6);
  score += Math.min(10, collectionTokens.filter((token) => productTypeTokens.includes(token)).length * 5);
  score += Math.min(8, collectionTokens.filter((token) => tagTokens.includes(token)).length * 4);

  return score;
}

function pickFeaturedProducts(collection, context, limit = 3) {
  const candidates = getCollectionProducts(collection, context);
  const ranked = candidates
    .map((product) => ({
      product,
      score: scoreFeaturedProduct(product, collection),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      const leftPrice = getProductPrice(left.product) || 0;
      const rightPrice = getProductPrice(right.product) || 0;
      if (leftPrice !== rightPrice) {
        return leftPrice - rightPrice;
      }

      return String(left.product.handle || "").localeCompare(String(right.product.handle || ""));
    });

  return ranked.slice(0, limit).map((entry) => entry.product);
}

function buildCollectionHeroKicker(collection) {
  const title = normalizePlainText(collection?.title || "");
  if (!title) {
    return "Featured collection";
  }

  return `Shop ${title}`;
}

function buildCollectionHeroSummary(collection, featuredProducts = [], catalogProductCount = null) {
  const handle = String(collection?.handle || "").trim().toLowerCase();
  const count = handle === "all-products" && Number.isFinite(Number(catalogProductCount))
    ? Number(catalogProductCount)
    : Number(collection?.products_count || featuredProducts.length || 0);
  if (handle === "all-products") {
    return `Discover ${count.toLocaleString()} products across the full SALT catalog.`;
  }

  const description = stripHtml(collection?.description || "");
  if (description) {
    return description;
  }

  const title = normalizePlainText(collection?.title || "");
  const countLabel = count > 0 ? `${count.toLocaleString()} product${count === 1 ? "" : "s"}` : "curated picks";

  if (!title) {
    return `Discover ${countLabel} selected for easier browsing and stronger conversion.`;
  }

  return `Discover ${countLabel} in ${title.toLowerCase()} selected for easier browsing and stronger conversion.`;
}

function isGeneratedCollectionHeroSummary(value) {
  const normalized = normalizePlainText(value || "");
  return (
    /^Discover [\d,]+ products in .+ selected for easier browsing and stronger conversion\.$/i.test(normalized) ||
    /^Discover [\d,]+ products across the full SALT catalog\.$/i.test(normalized)
  );
}

function buildCollectionTrustStrip(collection, featuredProducts = []) {
  const title = normalizePlainText(collection?.title || "");
  const count = Number(collection?.products_count || featuredProducts.length || 0);
  const countLabel = count > 0 ? `${count.toLocaleString()} picks` : "curated selection";

  return uniqueValues([
    "Fast US shipping",
    "Secure checkout",
    title ? `${title} ${countLabel}` : countLabel,
  ]).slice(0, 3);
}

function buildShopBannerText(context) {
  const productCount = Number(context.products.length || 0);
  const collectionCount = Number(context.collections.length || 0);
  return `Shop ${productCount.toLocaleString()} products across ${collectionCount.toLocaleString()} collections with stronger discovery and merchandising.`;
}

function buildShopTrustStrip() {
  return ["US shipping included", "Secure checkout", "Shop by collection"];
}

function buildCollectionPlan(collection, context) {
  const customData = collection?.customData || null;
  const featuredProducts = pickFeaturedProducts(collection, context, 3);
  const heroKicker = buildCollectionHeroKicker(collection);
  const heroSummary = buildCollectionHeroSummary(collection, featuredProducts, context.products.length);
  const trustStrip = buildCollectionTrustStrip(collection, featuredProducts);

  const writes = [];
  const skipped = [];

  if (!hasMeaningfulValue(customData?.heroKicker) && heroKicker) {
    writes.push({
      fieldId: COLLECTION_FIELD_IDS.heroKicker,
      label: "Collection hero kicker",
      namespace: "salt-marketing",
      key: "hero_kicker",
      type: "single_line_text_field",
      ownerId: toShopifyGid("Collection", collection.id),
      value: heroKicker,
      reason: "Generated collection-level merchandising kicker",
    });
  } else if (hasMeaningfulValue(customData?.heroKicker)) {
    skipped.push({ fieldId: COLLECTION_FIELD_IDS.heroKicker, reason: "already set" });
  }

  const refreshGeneratedHeroSummary =
    hasMeaningfulValue(customData?.heroSummary) &&
    isGeneratedCollectionHeroSummary(customData.heroSummary) &&
    customData.heroSummary !== heroSummary;

  if ((!hasMeaningfulValue(customData?.heroSummary) || refreshGeneratedHeroSummary) && heroSummary) {
    writes.push({
      fieldId: COLLECTION_FIELD_IDS.heroSummary,
      label: "Collection hero summary",
      namespace: "salt-marketing",
      key: "hero_summary",
      type: "multi_line_text_field",
      ownerId: toShopifyGid("Collection", collection.id),
      value: heroSummary,
      reason: refreshGeneratedHeroSummary
        ? "Refreshed generated collection summary after catalog count changed"
        : "Generated collection-level merchandising summary",
    });
  } else if (hasMeaningfulValue(customData?.heroSummary)) {
    skipped.push({ fieldId: COLLECTION_FIELD_IDS.heroSummary, reason: "already set" });
  }

  if (!hasMeaningfulValue(customData?.featuredProducts) && featuredProducts.length) {
    writes.push({
      fieldId: COLLECTION_FIELD_IDS.featuredProducts,
      label: "Featured products",
      namespace: "salt-marketing",
      key: "featured_products",
      type: "list.product_reference",
      ownerId: toShopifyGid("Collection", collection.id),
      value: serializeProductReferenceList(featuredProducts.map((product) => toShopifyGid("Product", product.id))),
      reason: `Selected ${featuredProducts.length} high-signal collection product(s)`,
    });
  } else if (hasMeaningfulValue(customData?.featuredProducts)) {
    skipped.push({ fieldId: COLLECTION_FIELD_IDS.featuredProducts, reason: "already set" });
  }

  if (!hasMeaningfulValue(customData?.trustStrip) && trustStrip.length) {
    writes.push({
      fieldId: COLLECTION_FIELD_IDS.trustStrip,
      label: "Collection trust strip",
      namespace: "salt-marketing",
      key: "trust_strip",
      type: "list.single_line_text_field",
      ownerId: toShopifyGid("Collection", collection.id),
      value: serializeListValue(trustStrip),
      reason: "Generated short trust statements for the collection header",
    });
  } else if (hasMeaningfulValue(customData?.trustStrip)) {
    skipped.push({ fieldId: COLLECTION_FIELD_IDS.trustStrip, reason: "already set" });
  }

  return {
    ownerType: "COLLECTION",
    id: collection.id,
    handle: String(collection.handle || "").trim(),
    title: normalizePlainText(collection.title || ""),
    writes,
    skipped,
  };
}

function buildShopPlan(shop, context) {
  const customData = shop?.customData || null;
  const bannerText = buildShopBannerText(context);
  const trustStrip = buildShopTrustStrip();
  const writes = [];
  const skipped = [];
  const shopId = String(shop?.id || "");
  const shopIdIsValid = /^gid:\/\/shopify\/Shop\/\d+$/i.test(shopId);

  if (!shopIdIsValid) {
    return {
      ownerType: "SHOP",
      id: shopId || "shop",
      handle: "shop",
      title: normalizePlainText(shop?.name || "SALT"),
      writes,
      skipped: [{ fieldId: "salt-marketing.banner_text", reason: "shop id unavailable" }],
    };
  }

  if (!hasMeaningfulValue(customData?.bannerText) && bannerText) {
    writes.push({
      fieldId: SHOP_FIELD_IDS.bannerText,
      label: "Shop banner text",
      namespace: "salt-marketing",
      key: "banner_text",
      type: "single_line_text_field",
      ownerId: shop.id,
      value: bannerText,
      reason: "Generated global sales banner text from catalog size",
    });
  } else if (hasMeaningfulValue(customData?.bannerText)) {
    skipped.push({ fieldId: SHOP_FIELD_IDS.bannerText, reason: "already set" });
  }

  if (!hasMeaningfulValue(customData?.trustStrip) && trustStrip.length) {
    writes.push({
      fieldId: SHOP_FIELD_IDS.trustStrip,
      label: "Shop trust strip",
      namespace: "salt-marketing",
      key: "trust_strip",
      type: "list.single_line_text_field",
      ownerId: shop.id,
      value: serializeListValue(trustStrip),
      reason: "Generated global trust statements for the storefront shell",
    });
  } else if (hasMeaningfulValue(customData?.trustStrip)) {
    skipped.push({ fieldId: SHOP_FIELD_IDS.trustStrip, reason: "already set" });
  }

  return {
    ownerType: "SHOP",
    id: shop.id,
    handle: "shop",
    title: normalizePlainText(shop.name || "SALT"),
    writes,
    skipped,
  };
}

function buildMarketingBackfillPlan(input = {}) {
  const products = Array.isArray(input.products) ? input.products : [];
  const collections = Array.isArray(input.collections) ? input.collections : [];
  const collectionProducts = input.collectionProducts || { collections: {} };
  const shop = input.shop || { id: "shop", name: "SALT", customData: null };

  const productsById = new Map(
    products
      .map((product) => {
        const id = Number(product?.id || 0);
        if (!Number.isFinite(id) || id <= 0) {
          return null;
        }

        return [id, product];
      })
      .filter(Boolean),
  );

  const collectionProductIdsByHandle = new Map(
    Object.entries(collectionProducts.collections || {}).map(([handle, entry]) => [
      String(handle || "").trim().toLowerCase(),
      Array.isArray(entry?.productIds) ? entry.productIds.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0) : [],
    ]),
  );

  const context = {
    products,
    productsById,
    collections,
    collectionProducts,
    collectionProductIdsByHandle,
  };

  const collectionPlans = collections
    .map((collection) => buildCollectionPlan(collection, context))
    .filter((plan) => plan.writes.length > 0 || plan.skipped.length > 0);

  const shopPlan = buildShopPlan(shop, context);
  const ownerPlans = [...collectionPlans, ...(shopPlan.writes.length > 0 || shopPlan.skipped.length > 0 ? [shopPlan] : [])];

  const writesByField = {};
  const skippedByReason = {};
  let totalWrites = 0;

  for (const plan of ownerPlans) {
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
    collectionPlans,
    shopPlan,
    ownerPlans,
    summary: {
      scannedCollections: collections.length,
      scannedProducts: products.length,
      totalWrites,
      writesByField,
      skippedByReason,
    },
  };
}

function buildMarketingMetafieldSetBatches(ownerPlans, maxEntries = 25) {
  const batches = [];
  let currentEntries = [];
  let currentOwnerDescriptors = [];

  const flush = () => {
    if (!currentEntries.length) {
      return;
    }

    batches.push({
      entries: currentEntries,
      ownerDescriptors: uniqueValues(currentOwnerDescriptors),
      size: currentEntries.length,
    });

    currentEntries = [];
    currentOwnerDescriptors = [];
  };

  for (const plan of ownerPlans) {
    if (!Array.isArray(plan.writes) || !plan.writes.length) {
      continue;
    }

    const entries = plan.writes.map((write) => ({
      ownerId: write.ownerId,
      namespace: write.namespace,
      key: write.key,
      type: write.type,
      value: write.value,
      fieldId: write.fieldId,
      label: write.label,
      reason: write.reason,
      ownerType: plan.ownerType,
      ownerHandle: plan.handle,
      ownerTitle: plan.title,
    }));

    if (entries.length > maxEntries) {
      flush();
      for (let index = 0; index < entries.length; index += maxEntries) {
        batches.push({
          entries: entries.slice(index, index + maxEntries),
          ownerDescriptors: [plan.title],
          size: Math.min(maxEntries, entries.length - index),
        });
      }
      continue;
    }

    if (currentEntries.length && currentEntries.length + entries.length > maxEntries) {
      flush();
    }

    currentEntries.push(...entries);
    currentOwnerDescriptors.push(plan.title);
  }

  flush();
  return batches;
}

export {
  COLLECTION_FIELD_IDS,
  SHOP_FIELD_IDS,
  buildMarketingBackfillPlan,
  buildMarketingMetafieldSetBatches,
};
