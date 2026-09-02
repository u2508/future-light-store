import {
  buildSeoBatchPlan,
  createSeoCatalogContext,
} from "./shopify-seo-batch-intelligence.js";
import {
  formatMoneyValue,
  normalizeHandleValue,
  normalizeHtmlValue,
  normalizePlainText,
  normalizeUrlForMatch,
  toShopifyGid,
} from "./shopify-seo-batch.js";
import {
  getMinimumQuantityTagForPrices,
  managedMinimumQuantityTagFromTags,
  reconcileManagedMinimumQuantityTags,
} from "./shopify-seo-managed-tags.js";
import {
  buildContentFingerprint,
  tokenizeSpecificityText,
} from "./product-content-specificity.js";
import { buildVariantPriceRepairPlan } from "./shopify-variant-pricing.js";
import { buildVariantSeoProfiles } from "./shopify-variant-seo.js";

const PRODUCT_FIELDS = ["title", "descriptionHtml", "productType"];
const SEO_FIELDS = ["title", "description"];

function asArray(value, key = "") {
  if (Array.isArray(value)) {
    return value;
  }

  if (key && Array.isArray(value?.[key])) {
    return value[key];
  }

  return [];
}

function normalizeComparableText(value) {
  return normalizePlainText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shortenSeoText(value, maximumLength) {
  const text = normalizePlainText(value);
  if (text.length <= maximumLength) return text;
  const shortened = text.slice(0, Math.max(1, maximumLength + 1));
  const boundary = shortened.lastIndexOf(" ");
  return (boundary > maximumLength * 0.6 ? shortened.slice(0, boundary) : shortened.slice(0, maximumLength))
    .replace(/[\s,;:|/-]+$/g, "")
    .trim();
}

function stableCatalogReference(handle) {
  let hash = 2166136261;
  for (const character of normalizeHandleValue(handle)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(6, "0").slice(-6);
}

function titleCaseQualifier(value) {
  return normalizePlainText(value)
    .split(" ")
    .filter(Boolean)
    .map((word) => (/^[a-z]/.test(word) ? `${word[0].toUpperCase()}${word.slice(1)}` : word))
    .join(" ");
}

function buildSemanticGroupQualifier(product, members) {
  const ownTokens = tokenizeSpecificityText(product.handle, { includeGeneric: false });
  const otherTokens = new Set(
    members
      .filter((entry) => entry.handle !== product.handle)
      .flatMap((entry) => tokenizeSpecificityText(entry.handle, { includeGeneric: false })),
  );
  const uniqueTokens = [...new Set(ownTokens)]
    .filter((token) => !otherTokens.has(token) && !/^\d+$/.test(token))
    .slice(0, 3);
  return titleCaseQualifier(uniqueTokens.join(" "));
}

function duplicateSeoGroups(products, field) {
  const groups = new Map();
  for (const product of products) {
    const value = product.desiredProductInput?.seo?.[field] || "";
    const fingerprint = buildContentFingerprint(value);
    if (!fingerprint) continue;
    if (!groups.has(fingerprint)) groups.set(fingerprint, []);
    groups.get(fingerprint).push(product);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

function appendSeoTitleQualifier(value, qualifier) {
  const safeQualifier = shortenSeoText(qualifier, 26);
  const suffix = ` | ${safeQualifier}`;
  return `${shortenSeoText(value, 70 - suffix.length)}${suffix}`;
}

function appendSeoDescriptionQualifier(value, qualifier, isReference) {
  const suffix = isReference
    ? `Future Light Store catalog reference ${qualifier.replace(/^Ref\s+/i, "")}.`
    : `Identifying details include ${normalizePlainText(qualifier).toLowerCase()}.`;
  const base = shortenSeoText(String(value || "").replace(/[.!?]+$/g, ""), 168 - suffix.length);
  return `${base}. ${suffix}`;
}

function appendDescriptionHtmlQualifier(value, qualifier) {
  const safeQualifier = normalizePlainText(qualifier);
  return `${String(value || "").trim()}\n<p>Future Light Store catalog listing reference ${safeQualifier}.</p>`;
}

function updateProductSeoField(product, field, value, qualifier) {
  product.desiredProductInput = {
    ...(product.desiredProductInput || {}),
    seo: {
      ...(product.desiredProductInput?.seo || {}),
      [field]: value,
    },
  };
  product.intelligence = {
    ...(product.intelligence || {}),
    [field === "title" ? "canonicalSeoTitle" : "canonicalSeoDescription"]: value,
  };
  product.productInput = {
    ...(product.productInput || {}),
    seo: {
      ...(product.productInput?.seo || {}),
      [field]: value,
    },
  };
  product.reasons = [...(product.reasons || []), `seo-identity:${qualifier}`];
}

function disambiguateSeoContent(products) {
  for (const field of ["title", "description"]) {
    for (let pass = 0; pass < 2; pass += 1) {
      const duplicateGroups = duplicateSeoGroups(products, field);
      if (!duplicateGroups.length) break;
      for (const group of duplicateGroups) {
        const semanticQualifiers = group.map((product) => buildSemanticGroupQualifier(product, group));
        const semanticQualifiersAreUnique =
          pass === 0 &&
          semanticQualifiers.every(Boolean) &&
          new Set(semanticQualifiers.map((value) => normalizeComparableText(value))).size === group.length;
        group.forEach((product, index) => {
          const qualifier = semanticQualifiersAreUnique
            ? semanticQualifiers[index]
            : `Ref ${stableCatalogReference(product.handle)}`;
          const currentValue = product.desiredProductInput?.seo?.[field] || "";
          const nextValue = field === "title"
            ? appendSeoTitleQualifier(currentValue, qualifier)
            : appendSeoDescriptionQualifier(currentValue, qualifier, !semanticQualifiersAreUnique);
          updateProductSeoField(product, field, nextValue, qualifier);
        });
      }
    }
  }
  return products;
}

function duplicateDescriptionGroups(products) {
  const groups = new Map();
  for (const product of products) {
    const value = product.desiredProductInput?.descriptionHtml || "";
    const fingerprint = buildContentFingerprint(value);
    if (!fingerprint) continue;
    if (!groups.has(fingerprint)) groups.set(fingerprint, []);
    groups.get(fingerprint).push(product);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

function disambiguateDescriptionContent(products) {
  for (const group of duplicateDescriptionGroups(products)) {
    for (const product of group) {
      const qualifier = `Ref ${stableCatalogReference(product.handle)}`;
      const descriptionHtml = appendDescriptionHtmlQualifier(
        product.desiredProductInput?.descriptionHtml,
        qualifier,
      );
      product.desiredProductInput = {
        ...(product.desiredProductInput || {}),
        descriptionHtml,
      };
      product.productInput = {
        ...(product.productInput || {}),
        descriptionHtml,
      };
      product.intelligence = {
        ...(product.intelligence || {}),
        canonicalDescriptionHtml: descriptionHtml,
      };
      product.reasons = [...(product.reasons || []), `description-identity:${qualifier}`];
    }
  }
  return products;
}

function decodeComparableHtmlEntities(value) {
  return String(value || "")
    .replace(/&(?:amp|nbsp|quot|apos|lt|gt|mdash|ndash|hellip|ldquo|rdquo|lsquo|rsquo|laquo|raquo);/gi, (entity) => {
      const replacements = {
        "&amp;": "&",
        "&nbsp;": " ",
        "&quot;": '"',
        "&apos;": "'",
        "&lt;": "<",
        "&gt;": ">",
        "&mdash;": "—",
        "&ndash;": "–",
        "&hellip;": "…",
        "&ldquo;": "“",
        "&rdquo;": "”",
        "&lsquo;": "‘",
        "&rsquo;": "’",
        "&laquo;": "«",
        "&raquo;": "»",
      };
      return replacements[entity.toLowerCase()] || entity;
    })
    .replace(/&#(x?)([0-9a-f]+);/gi, (_match, hexadecimal, digits) => {
      const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _match;
    });
}

export function normalizeComparableHtml(value) {
  // Shopify may return named entities as decoded Unicode (for example, an
  // em dash). Keep Unicode during comparison; normalizeHtmlValue intentionally
  // strips non-ASCII source text for CSV repair and would make equivalent HTML
  // look different during live readback.
  const html = String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .trim();
  return decodeComparableHtmlEntities(html)
    .replace(/>\s+</g, "><")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeComparableMoney(value) {
  return formatMoneyValue(value);
}

function normalizeIdentity(value, type = "") {
  return toShopifyGid(type, value).toLowerCase();
}

function uniqueBy(values, keyFn) {
  const seen = new Set();
  const output = [];

  for (const value of values) {
    const key = keyFn(value);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(value);
  }

  return output;
}

function getProductList(snapshot) {
  return asArray(snapshot?.products, "products");
}

function getCollectionList(snapshot) {
  return asArray(snapshot?.collections, "collections");
}

function getCollectionProducts(snapshot) {
  return snapshot?.collectionProducts || {};
}

function normalizeProductImages(product) {
  return asArray(product?.images).map((image) => ({
    ...image,
    id: image?.id ?? "",
    src: normalizePlainText(image?.src || image?.url || ""),
    alt: normalizePlainText(image?.alt || image?.alt_text || ""),
    variantIds: asArray(image?.variant_ids).map((id) => normalizeIdentity(id, "ProductVariant")),
  }));
}

function findVariantImage(variant, images) {
  const featured = variant?.featured_image;
  if (featured?.src || featured?.url) {
    return {
      ...featured,
      src: normalizePlainText(featured.src || featured.url),
      alt: normalizePlainText(featured.alt || featured.alt_text || ""),
    };
  }

  const variantId = normalizeIdentity(variant?.id, "ProductVariant");
  return (
    images.find((image) => variantId && image.variantIds.includes(variantId)) ||
    images[0] ||
    null
  );
}

function buildCatalogRow(product, variant, images) {
  const image = findVariantImage(variant, images);
  const productId = product?.id ?? "";
  const variantId = variant?.id ?? "";

  return {
    Handle: normalizeHandleValue(product?.handle || ""),
    "Product ID": String(productId || ""),
    Title: normalizePlainText(product?.title || ""),
    "Body (HTML)": normalizeHtmlValue(product?.body_html || product?.bodyHtml || ""),
    Type: normalizePlainText(product?.product_type || product?.productType || ""),
    Tags: asArray(product?.tags).map((tag) => normalizePlainText(tag)).filter(Boolean).join(", "),
    "Variant ID": String(variantId || ""),
    "Variant SKU": normalizePlainText(variant?.sku || ""),
    "Variant Title": normalizePlainText(variant?.title || ""),
    "Option1 Value": normalizePlainText(variant?.option1 || ""),
    "Option2 Value": normalizePlainText(variant?.option2 || ""),
    "Option3 Value": normalizePlainText(variant?.option3 || ""),
    "Variant Price": formatMoneyValue(variant?.price),
    "Variant Compare At Price": formatMoneyValue(variant?.compare_at_price || variant?.compareAtPrice),
    "Image Src": normalizePlainText(image?.src || ""),
    "Image Alt Text": normalizePlainText(image?.alt || ""),
    "Cost per item": formatMoneyValue(variant?.cost || variant?.cost_per_item),
  };
}

/**
 * Converts the refreshed Shopify REST snapshot into the row contract used by
 * the handle-first planner. The adapter never drops variant identity or tags.
 */
export function buildCatalogRowsFromSnapshot(snapshot) {
  const rows = [];

  for (const product of getProductList(snapshot)) {
    const handle = normalizeHandleValue(product?.handle || "");
    if (!handle) {
      continue;
    }

    const images = normalizeProductImages(product);
    const variants = asArray(product?.variants);
    if (!variants.length) {
      rows.push(buildCatalogRow({ ...product, handle }, null, images));
      continue;
    }

    for (const variant of variants) {
      rows.push(buildCatalogRow({ ...product, handle }, variant, images));
    }
  }

  return rows;
}

function numericResourceId(value) {
  return String(value || "").match(/(\d+)$/)?.[1] || "";
}

export function convertLiveProductToCatalogProduct(product) {
  const mediaNodes = Array.isArray(product?.media?.nodes) ? product.media.nodes : [];
  const images = mediaNodes
    .filter((entry) => entry?.__typename === "MediaImage" && entry?.image?.url)
    .map((entry, index) => ({
      id: numericResourceId(entry.id),
      product_id: numericResourceId(product.id),
      position: index + 1,
      src: entry.image.url,
      alt: entry.alt || "",
      variant_ids: [],
    }));
  const firstImage = images[0] || null;
  const variants = (Array.isArray(product?.variants?.nodes) ? product.variants.nodes : []).map((variant) => {
    const optionValues = Array.isArray(variant?.selectedOptions)
      ? variant.selectedOptions.map((option) => option?.value || "")
      : [];
    return {
      id: numericResourceId(variant.id),
      product_id: numericResourceId(product.id),
      title: variant.title || optionValues.filter(Boolean).join(" / ") || "Default Title",
      option1: optionValues[0] || null,
      option2: optionValues[1] || null,
      option3: optionValues[2] || null,
      sku: variant.sku || "",
      price: variant.price || "",
      compare_at_price: variant.compareAtPrice || null,
      featured_image: firstImage,
    };
  });

  return {
    id: Number(numericResourceId(product.id)) || product.id,
    admin_graphql_api_id: product.id,
    title: product.title || "",
    handle: product.handle || "",
    body_html: product.descriptionHtml || "",
    product_type: product.productType || "",
    tags: Array.isArray(product.tags) ? product.tags : [],
    vendor: product.vendor || "",
    status: product.status || "",
    created_at: product.createdAt || null,
    updated_at: product.updatedAt || null,
    published_at: product.publishedAt || null,
    images,
    variants,
  };
}

export function mergeCatalogSnapshotWithLiveProducts(snapshot, liveProducts) {
  const localProducts = getProductList(snapshot);
  const localHandles = new Set(localProducts.map((product) => normalizeHandleValue(product?.handle)).filter(Boolean));
  const liveOnlyProducts = (Array.isArray(liveProducts) ? liveProducts : [])
    .filter((product) => {
      const handle = normalizeHandleValue(product?.handle);
      return handle && !localHandles.has(handle);
    })
    .map(convertLiveProductToCatalogProduct);

  return {
    ...snapshot,
    products: [...localProducts, ...liveOnlyProducts],
    liveOnlyProducts,
  };
}

function buildReleaseDesiredProductInput(productPlan) {
  const desired = productPlan?.desiredProductInput || {};
  const input = {};

  for (const field of PRODUCT_FIELDS) {
    if (normalizePlainText(desired[field])) {
      input[field] = field === "descriptionHtml" ? normalizeHtmlValue(desired[field]) : normalizePlainText(desired[field]);
    }
  }

  if (desired.seo && typeof desired.seo === "object") {
    const seo = {};
    for (const field of SEO_FIELDS) {
      if (normalizePlainText(desired.seo[field])) {
        seo[field] = normalizePlainText(desired.seo[field]);
      }
    }
    if (Object.keys(seo).length) {
      input.seo = seo;
    }
  }

  if (productPlan?.categoryId && productPlan?.categoryQuery) {
    input.category = productPlan.categoryId;
  }

  return input;
}

function buildReleaseDesiredMediaTargets(productPlan) {
  const intelligence = productPlan?.intelligence || {};
  const canonicalAlt = normalizePlainText(intelligence.canonicalAltText);
  const catalogImages = asArray(intelligence.catalogProduct?.images).map((image) => ({
    imageSrc: normalizePlainText(image?.src || image?.url || ""),
    alt: canonicalAlt || normalizePlainText(image?.alt || image?.alt_text || ""),
  }));
  const plannerTargets = (productPlan?.desiredMediaTargets || []).map((target) => ({
    imageSrc: normalizePlainText(target?.imageSrc || ""),
    alt: normalizePlainText(target?.alt || canonicalAlt),
  }));

  return uniqueBy([...catalogImages, ...plannerTargets], (target) => normalizeUrlForMatch(target?.imageSrc))
    .map((target) => ({
      imageSrc: normalizeUrlForMatch(target.imageSrc),
      alt: normalizePlainText(target.alt),
    }))
    .filter((target) => target.imageSrc && target.alt);
}

function buildReleaseDesiredVariants(productPlan) {
  return uniqueBy(productPlan?.desiredVariantUpdates || [], (variant) => {
    return [
      normalizeIdentity(variant?.variantId, "ProductVariant"),
      normalizePlainText(variant?.sku).toLowerCase(),
      normalizeComparableText(variant?.label),
    ].join("|");
  });
}

function variantPlanMatches(left, right) {
  const leftId = normalizeIdentity(left?.variantId, "ProductVariant");
  const rightId = normalizeIdentity(right?.variantId, "ProductVariant");
  if (leftId && rightId) {
    return leftId === rightId;
  }

  const leftSku = normalizeComparableText(left?.sku);
  const rightSku = normalizeComparableText(right?.sku);
  if (leftSku && rightSku) {
    return leftSku === rightSku;
  }

  return Boolean(
    normalizeComparableText(left?.label) &&
      normalizeComparableText(left?.label) === normalizeComparableText(right?.label),
  );
}

export async function buildShopifySeoReleasePlan(
  snapshot,
  { forceExplicitSeo = false, repairVariantPricing = false, knowledgeModel = null } = {},
) {
  const rows = buildCatalogRowsFromSnapshot(snapshot);
  const sourceProductsByHandle = new Map(
    getProductList(snapshot).map((product) => [normalizeHandleValue(product?.handle), product]),
  );
  const catalogContext = createSeoCatalogContext({
    products: getProductList(snapshot),
    collections: getCollectionList(snapshot),
    collectionProducts: getCollectionProducts(snapshot),
  });
  const basePlan = await buildSeoBatchPlan(rows, {
    catalogContext,
    suppressCategoryWarnings: true,
    knowledgeModel,
  });
  const variantPriceRepair = repairVariantPricing
    ? buildVariantPriceRepairPlan(getProductList(snapshot))
    : {
        byHandle: new Map(),
        held: [],
        summary: {
          products: getProductList(snapshot).length,
          variantsInspected: 0,
          productsWithRepeatedQuantityPrices: 0,
          productsWithPriceRepairs: 0,
          variantsToUpdate: 0,
          totalPriceDelta: "0.00",
          heldGroups: 0,
        },
      };

  const products = disambiguateDescriptionContent(disambiguateSeoContent(basePlan.products.map((productPlan) => {
    const desiredProductInput = { ...(productPlan.desiredProductInput || {}) };
    if (forceExplicitSeo) {
      const canonicalSeoTitleBase = normalizePlainText(
        productPlan.intelligence?.canonicalSeoTitle || desiredProductInput.seo?.title || "",
      );
      const canonicalProductTitle = normalizePlainText(
        productPlan.intelligence?.canonicalTitle || desiredProductInput.title || productPlan.title || "",
      );
      // Shopify treats an SEO title equal to the product title as the implicit
      // default and stores it as null. Keep the title product-specific while
      // making the explicit override durable on Shopify.
      const canonicalSeoTitle = canonicalSeoTitleBase && canonicalProductTitle &&
        normalizeComparableText(canonicalSeoTitleBase) === normalizeComparableText(canonicalProductTitle)
        ? appendSeoTitleQualifier(canonicalSeoTitleBase, "Future Light Store")
        : canonicalSeoTitleBase;
      const canonicalSeoDescription = normalizePlainText(
        productPlan.intelligence?.canonicalSeoDescription || desiredProductInput.seo?.description || "",
      );
      desiredProductInput.seo = {
        ...(desiredProductInput.seo || {}),
        ...(canonicalSeoTitle ? { title: canonicalSeoTitle } : {}),
        ...(canonicalSeoDescription ? { description: canonicalSeoDescription } : {}),
      };
    }
    const currentVariantUpdates = buildReleaseDesiredVariants(productPlan);
    const desiredVariantPriceUpdates = variantPriceRepair.byHandle.get(productPlan.handle) || [];
    // Shopify is the sole price authority. SEO can read every variant to
    // understand quality, size, color, or bundle tiers, but it must never
    // normalize their independent prices or compare-at prices.
    const desiredVariantUpdates = currentVariantUpdates.map((variant) => ({ ...variant }));
    return {
      ...productPlan,
      desiredProductInput: buildReleaseDesiredProductInput({ ...productPlan, desiredProductInput }),
      desiredVariantUpdates,
      desiredVariantPriceUpdates,
      currentVariantUpdates,
      variantSeoProfiles: buildVariantSeoProfiles(sourceProductsByHandle.get(productPlan.handle) || {
        title: productPlan.title,
        variants: currentVariantUpdates,
      }),
      desiredMediaTargets: buildReleaseDesiredMediaTargets(productPlan),
      desiredQuantityTag: productPlan?.intelligence?.knowledge?.family === "order-adjustment"
        ? ""
        : getMinimumQuantityTagForPrices(desiredVariantUpdates.map((variant) => variant.price)),
      currentQuantityTag: getMinimumQuantityTagForPrices(currentVariantUpdates.map((variant) => variant.price)),
      categoryAuthoritative: Boolean(productPlan.categoryId && productPlan.categoryQuery),
    };
  })));

  return {
    ...basePlan,
    rows,
    products,
    summary: {
      ...basePlan.summary,
      sourceProducts: getProductList(snapshot).length,
      releaseProducts: products.length,
      desiredVariantCount: products.reduce((count, entry) => count + entry.desiredVariantUpdates.length, 0),
      variantSeoProfiles: products.reduce((count, entry) => count + (entry.variantSeoProfiles?.length || 0), 0),
      desiredMediaCount: products.reduce((count, entry) => count + entry.desiredMediaTargets.length, 0),
      variantPriceRepair: variantPriceRepair.summary,
      variantPriceRepairHeld: variantPriceRepair.held,
    },
  };
}

export function isHandleContentMismatch(productPlan) {
  const intelligence = productPlan?.intelligence || {};
  const canonicalTitle = normalizeComparableText(intelligence.canonicalTitle);
  if (!canonicalTitle || (productPlan?.contentRewriteLevel || productPlan?.rewriteLevel) !== "high") {
    return false;
  }

  const catalogTitle = normalizeComparableText(intelligence.catalogTitle);
  const sourceTitle = normalizeComparableText(intelligence.sourceTitle);
  const handlePhrase = normalizeComparableText(intelligence.handlePhrase);
  const catalogDisagrees = Boolean(catalogTitle && catalogTitle !== canonicalTitle);
  const sourceDisagrees = Boolean(sourceTitle && sourceTitle !== canonicalTitle);
  const handleAbsentFromBothTitles = Boolean(
    handlePhrase &&
      catalogTitle &&
      sourceTitle &&
      !catalogTitle.includes(handlePhrase) &&
      !sourceTitle.includes(handlePhrase),
  );

  return catalogDisagrees || sourceDisagrees || handleAbsentFromBothTitles;
}

export function buildEligibilityScopedReleasePlan(
  productPlan,
  {
    status = "",
    publishedSalesChannels = null,
    metaDescriptionOnly = false,
    isNewProduct = false,
    handleMismatch = isHandleContentMismatch(productPlan),
    initialFullCatalogPass = false,
  } = {},
) {
  const normalizedStatus = normalizePlainText(status).toUpperCase();
  const isDraft = normalizedStatus === "DRAFT";
  const isArchived = normalizedStatus === "ARCHIVED";
  const hasZeroPublishedChannels = publishedSalesChannels === 0;
  const fullSeoEligible =
    initialFullCatalogPass || (!isArchived && (isDraft || hasZeroPublishedChannels || isNewProduct || handleMismatch));
  const fullDesired = productPlan?.desiredProductInput || {};
  const scopedDesired = fullSeoEligible
    ? fullDesired
    : metaDescriptionOnly
      ? fullDesired.seo?.description
        ? { seo: { description: fullDesired.seo.description } }
        : {}
      : {};

  return {
    ...productPlan,
    desiredProductInput: scopedDesired,
    desiredVariantUpdates: fullSeoEligible ? productPlan.desiredVariantUpdates || [] : [],
    desiredMediaTargets: fullSeoEligible ? productPlan.desiredMediaTargets || [] : [],
    desiredQuantityTag: productPlan.desiredQuantityTag || "",
    eligibility: {
      status: normalizedStatus || "UNKNOWN",
      isDraft,
      isArchived,
      publishedSalesChannels,
      hasZeroPublishedChannels,
      handleMismatch,
      isNewProduct,
      fullSeoEligible,
      metaDescriptionOnly: !fullSeoEligible && Boolean(scopedDesired.seo?.description),
      reason: fullSeoEligible
        ? initialFullCatalogPass
          ? "initial full catalog SEO pass"
          : isDraft
          ? "draft product"
          : hasZeroPublishedChannels
            ? "zero published sales channels"
            : isNewProduct
              ? "new product handle"
              : "handle/content mismatch"
        : metaDescriptionOnly
          ? "initial or new-product meta description coverage"
          : "existing eligible content preserved",
    },
  };
}

function variantOptionText(variant) {
  return Array.isArray(variant?.selectedOptions)
    ? variant.selectedOptions.map((option) => normalizePlainText(option?.value)).filter(Boolean).join(" / ")
    : "";
}

function normalizedVariantLabel(variant) {
  return normalizeComparableText(variant?.label || variant?.title || variantOptionText(variant));
}

function resolveLiveVariant(liveVariants, desiredVariant) {
  const variants = Array.isArray(liveVariants) ? liveVariants : [];
  const desiredId = normalizeIdentity(desiredVariant?.variantId, "ProductVariant");
  if (desiredId) {
    const byId = variants.filter((variant) => normalizeIdentity(variant?.id, "ProductVariant") === desiredId);
    if (byId.length === 1) {
      return { match: byId[0] };
    }
    if (byId.length > 1) {
      return { error: "ambiguous-id" };
    }
  }

  const desiredSku = normalizeComparableText(desiredVariant?.sku);
  if (desiredSku) {
    const bySku = variants.filter((variant) => normalizeComparableText(variant?.sku) === desiredSku);
    if (bySku.length === 1) {
      return { match: bySku[0] };
    }
    if (bySku.length > 1) {
      return { error: "ambiguous-sku" };
    }
  }

  const desiredLabel = normalizedVariantLabel(desiredVariant);
  if (desiredLabel) {
    const byLabel = variants.filter((variant) => normalizedVariantLabel(variant) === desiredLabel);
    if (byLabel.length === 1) {
      return { match: byLabel[0] };
    }
    if (byLabel.length > 1) {
      return { error: "ambiguous-label" };
    }
  }

  return { error: "not-found" };
}

function resolveLiveMedia(liveMedia, imageSrc) {
  const targetUrl = normalizeUrlForMatch(imageSrc);
  const matches = (Array.isArray(liveMedia) ? liveMedia : []).filter(
    (media) => normalizeUrlForMatch(media?.image?.url) === targetUrl,
  );

  if (matches.length === 1) {
    return { match: matches[0] };
  }

  return { error: matches.length > 1 ? "ambiguous-url" : "not-found" };
}

function buildProductDiff(liveProduct, productPlan) {
  const desired = productPlan?.desiredProductInput || {};
  const input = { id: liveProduct?.id || productPlan?.productId || "" };
  const changedFields = [];
  const skippedFields = [];

  const productComparisons = [
    ["title", desired.title, liveProduct?.title, normalizePlainText],
    ["body", desired.descriptionHtml, liveProduct?.descriptionHtml, normalizeComparableHtml],
    ["product-type", desired.productType, liveProduct?.productType, normalizePlainText],
  ];

  for (const [field, desiredValue, liveValue, normalizer] of productComparisons) {
    if (!normalizePlainText(desiredValue)) {
      skippedFields.push({ field, reason: "no high-confidence desired value" });
      continue;
    }

    if (normalizer(desiredValue) === normalizer(liveValue)) {
      skippedFields.push({ field, reason: "already aligned" });
      continue;
    }

    const graphqlField = field === "body" ? "descriptionHtml" : field === "product-type" ? "productType" : field;
    input[graphqlField] = field === "body" ? normalizeHtmlValue(desiredValue) : normalizePlainText(desiredValue);
    changedFields.push(field);
  }

  const desiredSeo = desired.seo && typeof desired.seo === "object" ? desired.seo : {};
  const liveSeo = liveProduct?.seo || {};
  // A null Shopify SEO title inherits the product title after the same mutation.
  // Compare against the desired title so a title rewrite cannot leave a stale
  // implicit SEO title that only fails during final readback.
  const effectiveProductTitle = normalizePlainText(desired.title || liveProduct?.title || "");
  const effectiveLiveSeoTitle = normalizePlainText(liveSeo.title || effectiveProductTitle);
  const seoInput = {};
  for (const field of SEO_FIELDS) {
    if (!normalizePlainText(desiredSeo[field])) {
      skippedFields.push({ field: `seo-${field}`, reason: "no medium-confidence desired value" });
      continue;
    }

    const liveSeoValue = field === "title" ? effectiveLiveSeoTitle : liveSeo[field];
    const matchesLiveSeoValue = normalizeComparableText(desiredSeo[field]) === normalizeComparableText(liveSeoValue);
    const needsExplicitSeoTitle = field === "title" && !normalizePlainText(liveSeo.title);
    if (matchesLiveSeoValue && !needsExplicitSeoTitle) {
      skippedFields.push({
        field: `seo-${field}`,
        reason: field === "title" && !normalizePlainText(liveSeo.title) ? "uses product title default" : "already aligned",
      });
      continue;
    }

    seoInput[field] = normalizePlainText(desiredSeo[field]);
    changedFields.push(`seo-${field}`);
  }
  if (Object.keys(seoInput).length) {
    // Shopify treats the nested SEO input as a replacement. Carry forward
    // unchanged explicit siblings so a title-only write cannot erase the
    // existing meta description (or vice versa).
    for (const field of SEO_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(seoInput, field) && normalizePlainText(liveSeo[field])) {
        seoInput[field] = normalizePlainText(liveSeo[field]);
      }
    }
    input.seo = seoInput;
  }

  if (productPlan?.categoryAuthoritative && normalizePlainText(desired.category)) {
    const desiredCategory = normalizePlainText(desired.category);
    const liveCategory = normalizePlainText(liveProduct?.category?.id || "");
    if (desiredCategory === liveCategory) {
      skippedFields.push({ field: "category", reason: "already aligned" });
    } else {
      input.category = desiredCategory;
      changedFields.push("category");
    }
  }

  const desiredQuantityTag = productPlan?.desiredQuantityTag || "";
  const liveTags = asArray(liveProduct?.tags).map((tag) => normalizePlainText(tag)).filter(Boolean);
  const liveQuantityTag = managedMinimumQuantityTagFromTags(liveTags);
  if (liveQuantityTag === desiredQuantityTag) {
    skippedFields.push({ field: "managed-minimum-quantity-tag", reason: "already aligned" });
  } else {
    input.tags = reconcileManagedMinimumQuantityTags(liveTags, desiredQuantityTag);
    changedFields.push("managed-minimum-quantity-tag");
  }

  return { input, changedFields, skippedFields };
}

function buildVariantDiff(liveProduct, productPlan, changedFields, skippedFields) {
  const protectedVariants = Array.isArray(productPlan?.desiredVariantUpdates)
    ? productPlan.desiredVariantUpdates
    : [];
  const priceRepairs = Array.isArray(productPlan?.desiredVariantPriceUpdates)
    ? productPlan.desiredVariantPriceUpdates
    : [];

  if (protectedVariants.length && !priceRepairs.length) {
    skippedFields.push({
      field: "variant-pricing",
      reason: "Shopify-authoritative; SEO preserves each variant price and compare-at price",
    });
  }

  const inputs = [];
  const unresolved = [];
  for (const repair of priceRepairs) {
    const resolution = resolveLiveVariant(liveProduct?.variants?.nodes || liveProduct?.variants, repair);
    if (!resolution.match?.id) {
      unresolved.push({ kind: "variant-price", reason: resolution.error || "not-found", label: repair.label || repair.variantId });
      continue;
    }

    const input = { id: resolution.match.id, price: repair.price };
    if (repair.compareAtPrice) input.compareAtPrice = repair.compareAtPrice;
    const priceMatches = normalizeComparableMoney(resolution.match.price) === normalizeComparableMoney(repair.price);
    const compareMatches = !repair.compareAtPrice || normalizeComparableMoney(resolution.match.compareAtPrice) === normalizeComparableMoney(repair.compareAtPrice);
    if (priceMatches && compareMatches) {
      skippedFields.push({ field: `variant-pricing:${resolution.match.id}`, reason: "already aligned" });
      continue;
    }

    inputs.push(input);
    changedFields.push(`variant-pricing:${resolution.match.id}`);
  }

  return { inputs, unresolved };
}

function buildMediaDiff(liveProduct, productPlan, changedFields, skippedFields) {
  const inputs = [];
  const unresolved = [];
  const liveMedia = Array.isArray(liveProduct?.media?.nodes)
    ? liveProduct.media.nodes
    : Array.isArray(liveProduct?.media)
      ? liveProduct.media
      : [];

  for (const desired of productPlan?.desiredMediaTargets || []) {
    const resolution = resolveLiveMedia(liveMedia, desired.imageSrc);
    if (!resolution.match?.id) {
      unresolved.push({
        kind: "media",
        reason: resolution.error || "not-found",
        imageSrc: desired.imageSrc || "",
      });
      continue;
    }

    const desiredAlt = normalizePlainText(desired.alt);
    const liveAlt = normalizePlainText(resolution.match.alt);
    if (desiredAlt === liveAlt) {
      skippedFields.push({ field: `image-alt:${resolution.match.id}`, reason: "already aligned" });
      continue;
    }

    inputs.push({ id: resolution.match.id, alt: desiredAlt });
    changedFields.push(`image-alt:${resolution.match.id}`);
  }

  return { inputs, unresolved };
}

/**
 * Compares one live Shopify product with the plan. The returned mutation
 * inputs contain only actual field-level differences. Tag writes are limited to
 * reconciling the two managed minimum-quantity tags while preserving all others.
 */
export function compareLiveProductToPlan(liveProduct, productPlan) {
  const productDiff = buildProductDiff(liveProduct, productPlan);
  const changedFields = [...productDiff.changedFields];
  const skippedFields = [...productDiff.skippedFields];
  const variantDiff = buildVariantDiff(liveProduct, productPlan, changedFields, skippedFields);
  const mediaDiff = buildMediaDiff(liveProduct, productPlan, changedFields, skippedFields);
  const unresolved = [...variantDiff.unresolved, ...mediaDiff.unresolved];
  const productInput = Object.fromEntries(
    Object.entries(productDiff.input).filter(([key, value]) => key === "id" || value !== ""),
  );
  const hasProductMutation = Object.keys(productInput).some((key) => key !== "id");

  return {
    productInput: hasProductMutation ? productInput : { id: productInput.id },
    variantInputs: variantDiff.inputs,
    mediaInputs: mediaDiff.inputs,
    changedFields,
    skippedFields,
    unresolved,
    writeCount: (hasProductMutation ? 1 : 0) + variantDiff.inputs.length + mediaDiff.inputs.length,
    hasMutations: Boolean(hasProductMutation || variantDiff.inputs.length || mediaDiff.inputs.length),
  };
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stableValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }

  return value;
}

function hashText(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function buildReleaseFingerprint(value) {
  return hashText(JSON.stringify(stableValue(value)));
}

export function buildDesiredFingerprint(productPlan) {
  const desired = productPlan?.desiredProductInput || {};
  return buildReleaseFingerprint({
    handle: normalizeHandleValue(productPlan?.handle),
    title: normalizeComparableText(desired.title),
    body: normalizeComparableHtml(desired.descriptionHtml),
    productType: normalizeComparableText(desired.productType),
    seo: {
      title: normalizeComparableText(desired.seo?.title),
      description: normalizeComparableText(desired.seo?.description),
    },
    category: normalizePlainText(desired.category),
    managedMinimumQuantityTag: productPlan?.desiredQuantityTag || "",
    variants: (productPlan?.desiredVariantPriceUpdates?.length
      ? productPlan.desiredVariantPriceUpdates
      : productPlan?.desiredVariantUpdates || [])
      .map((variant) => ({
        id: normalizeIdentity(variant.variantId, "ProductVariant"),
        sku: normalizeComparableText(variant.sku),
        label: normalizeComparableText(variant.label),
        price: normalizeComparableMoney(variant.price),
        compareAtPrice: normalizeComparableMoney(variant.compareAtPrice),
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    media: (productPlan?.desiredMediaTargets || [])
      .map((media) => ({
        imageSrc: normalizeUrlForMatch(media.imageSrc),
        alt: normalizeComparableText(media.alt),
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  });
}

export function buildLiveFingerprint(liveProduct) {
  const variants = Array.isArray(liveProduct?.variants?.nodes)
    ? liveProduct.variants.nodes
    : Array.isArray(liveProduct?.variants)
      ? liveProduct.variants
      : [];
  const media = Array.isArray(liveProduct?.media?.nodes)
    ? liveProduct.media.nodes
    : Array.isArray(liveProduct?.media)
      ? liveProduct.media
      : [];

  return buildReleaseFingerprint({
    handle: normalizeHandleValue(liveProduct?.handle),
    title: normalizeComparableText(liveProduct?.title),
    body: normalizeComparableHtml(liveProduct?.descriptionHtml),
    productType: normalizeComparableText(liveProduct?.productType),
    seo: {
      title: normalizeComparableText(liveProduct?.seo?.title || liveProduct?.title),
      description: normalizeComparableText(liveProduct?.seo?.description),
    },
    category: normalizePlainText(liveProduct?.category?.id),
    managedMinimumQuantityTag: managedMinimumQuantityTagFromTags(liveProduct?.tags),
    variants: variants
      .map((variant) => ({
        id: normalizeIdentity(variant.id, "ProductVariant"),
        sku: normalizeComparableText(variant.sku),
        label: normalizeComparableText(variant.title || variantOptionText(variant)),
        price: normalizeComparableMoney(variant.price),
        compareAtPrice: normalizeComparableMoney(variant.compareAtPrice),
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    media: media
      .map((entry) => ({
        id: normalizeIdentity(entry.id, "MediaImage"),
        imageSrc: normalizeUrlForMatch(entry?.image?.url),
        alt: normalizeComparableText(entry.alt),
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  });
}

export function hasOnlyProductMutation(diff) {
  return Boolean(
    diff?.productInput &&
      Object.keys(diff.productInput).some((key) => key !== "id") &&
      !(diff?.variantInputs?.length || diff?.mediaInputs?.length),
  );
}
