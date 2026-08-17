function asText(value) {
  if (typeof value === "string") {
    return value;
  }

  if (value == null) {
    return "";
  }

  return String(value);
}

function normalizeKey(value) {
  return asText(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeWhitespace(value) {
  return asText(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function repairMojibake(value) {
  return asText(value)
    .replace(/\u00a0/g, " ")
    .replace(/Ã¢ÂÂ|Ã¢ÂÂ/g, "-")
    .replace(/Ã¢ÂÂ/g, "'")
    .replace(/Ã¢ÂÂ|Ã¢ÂÂ/g, '"')
    .replace(/Ã¢ÂÂ¢/g, "")
    .replace(/Ã¢ÂÂ¦/g, "...")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
}

function hasMeaningfulValue(value) {
  return normalizeWhitespace(value) !== "";
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (hasMeaningfulValue(value)) {
      return value;
    }
  }

  return "";
}

export function normalizePlainText(input) {
  return normalizeWhitespace(repairMojibake(input));
}

export function normalizeHtmlValue(input) {
  return repairMojibake(input).replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim();
}

function normalizeSlug(input) {
  const raw = normalizePlainText(input);
  if (!raw) {
    return "";
  }

  const handleCandidate = raw.includes("://") || raw.includes("/products/") ? raw.split("?")[0] : raw;
  const slug = handleCandidate
    .split("/")
    .filter(Boolean)
    .at(-1)
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return slug || "";
}

export function normalizeHandleValue(input) {
  return normalizeSlug(input);
}

export function normalizeUrlForMatch(input) {
  const raw = normalizePlainText(input);
  if (!raw) {
    return "";
  }

  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "").toLowerCase();
  } catch {
    return raw.split("?")[0].split("#")[0].replace(/\/+$/, "").toLowerCase();
  }
}

export function parseMoneyValue(input) {
  const raw = normalizePlainText(input);
  if (!raw) {
    return null;
  }

  const sanitized = raw.replace(/[^\d,.-]/g, "").replace(/\s+/g, "");
  if (!sanitized) {
    return null;
  }

  const normalized =
    sanitized.includes(".") && sanitized.includes(",")
      ? sanitized.replace(/,/g, "")
      : sanitized.replace(/,/g, ".");

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function formatMoneyValue(input) {
  const value = typeof input === "number" ? input : parseMoneyValue(input);
  if (value == null || !Number.isFinite(value)) {
    return "";
  }

  return value.toFixed(2);
}

function suggestRetailPriceFromCost(cost) {
  if (!Number.isFinite(cost) || cost <= 0) {
    return "";
  }

  const bandTarget =
    cost < 5 ? cost * 4 : cost < 15 ? cost * 3 : cost < 30 ? cost * 2.5 : cost * 2;
  const raw = Math.max(cost + 17, bandTarget);
  if (!Number.isFinite(raw) || raw <= 0) {
    return "";
  }

  return (Math.max(0.99, Math.round(raw) - 0.01)).toFixed(2);
}

function escapeHtml(value) {
  return normalizePlainText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function hashText(value) {
  const text = normalizePlainText(value);
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
}

function buildEnhancedProductTitle(title, productType) {
  const cleanTitle = normalizePlainText(title);
  if (!cleanTitle) {
    return "";
  }

  const cleanProductType = normalizePlainText(productType);
  let compressedTitle = cleanTitle;

  if (compressedTitle.length > 54) {
    const cutPoints = [
      /\s+(?:for women|for men|for kids|fashion|elegant|sexy|party|club|beach|summer|winter|outdoor|indoor|casual|luxury)\b/i,
      /\s+-\s+/,
      /\s+\|\s+/,
    ];

    for (const pattern of cutPoints) {
      const matchIndex = compressedTitle.search(pattern);
      if (matchIndex >= 24) {
        compressedTitle = compressedTitle.slice(0, matchIndex).trim();
        break;
      }
    }

    if (compressedTitle.length > 54) {
      compressedTitle = shortenAtWordBoundary(compressedTitle, 54);
    }
  }

  if (!cleanProductType) {
    return compressedTitle;
  }

  const titleLower = compressedTitle.toLowerCase();
  const productTypeLower = cleanProductType.toLowerCase();
  if (titleLower.includes(productTypeLower) || compressedTitle.length >= 28 || compressedTitle !== cleanTitle) {
    return compressedTitle;
  }

  return `${compressedTitle} - ${cleanProductType}`;
}

function shortenAtWordBoundary(value, maxLength) {
  const text = normalizePlainText(value);
  if (text.length <= maxLength) {
    return text;
  }

  const truncated = text.slice(0, maxLength).trim();
  const lastSpace = truncated.lastIndexOf(" ");
  const cut = lastSpace > 18 ? truncated.slice(0, lastSpace).trim() : truncated;
  return cut.replace(/[,-]+$/g, "");
}

function buildEnhancedDescriptionHtml(title, bodyHtml, productType, tags, seed = "") {
  const cleanTitle = normalizePlainText(title);
  const cleanBody = normalizeHtmlValue(bodyHtml);
  const cleanProductType = normalizePlainText(productType);
  const tagList = Array.isArray(tags)
    ? tags.map((tag) => normalizePlainText(tag)).filter(Boolean).slice(0, 4)
    : [];

  if (!cleanTitle && !cleanBody && !tagList.length) {
    return "";
  }

  const parts = [];
  const variantSeed = hashText([cleanTitle, cleanProductType, tagList.join("|"), seed].join("::"));
  const introTemplates = [
    {
      withType: (titleText, typeText) =>
        `<p><strong>${escapeHtml(titleText)}</strong> is a ${escapeHtml(typeText.toLowerCase())} listing, rewritten to feel clearer, cleaner, and easier to discover.</p>`,
      withoutType: (titleText) =>
        `<p><strong>${escapeHtml(titleText)}</strong> is rewritten to feel clearer, cleaner, and easier to discover in search.</p>`,
    },
    {
      withType: (titleText, typeText) =>
        `<p><strong>${escapeHtml(titleText)}</strong> brings a more polished ${escapeHtml(typeText.toLowerCase())} story to the page, helping shoppers scan the essentials faster.</p>`,
      withoutType: (titleText) =>
        `<p><strong>${escapeHtml(titleText)}</strong> brings a more polished story to the page, helping shoppers scan the essentials faster.</p>`,
    },
    {
      withType: (titleText, typeText) =>
        `<p><strong>${escapeHtml(titleText)}</strong> now reads like a tighter ${escapeHtml(typeText.toLowerCase())} product brief with stronger search clarity.</p>`,
      withoutType: (titleText) =>
        `<p><strong>${escapeHtml(titleText)}</strong> now reads like a tighter product brief with stronger search clarity.</p>`,
    },
    {
      withType: (titleText, typeText) =>
        `<p><strong>${escapeHtml(titleText)}</strong> is presented as a refined ${escapeHtml(typeText.toLowerCase())} entry that feels more natural to shoppers and search engines alike.</p>`,
      withoutType: (titleText) =>
        `<p><strong>${escapeHtml(titleText)}</strong> is presented as a refined listing that feels more natural to shoppers and search engines alike.</p>`,
    },
  ];
  const introTemplate = introTemplates[variantSeed % introTemplates.length];

  if (cleanTitle) {
    parts.push(
      cleanProductType ? introTemplate.withType(cleanTitle, cleanProductType) : introTemplate.withoutType(cleanTitle),
    );
  }

  if (cleanBody) {
    parts.push(cleanBody);
  }

  if (tagList.length) {
    parts.push(`<p><strong>Popular search terms:</strong> ${tagList.map((tag) => escapeHtml(tag)).join(", ")}</p>`);
  }

  const tagSummary = tagList.length
    ? tagList.length === 1
      ? escapeHtml(tagList[0])
      : tagList.length === 2
        ? `${escapeHtml(tagList[0])} and ${escapeHtml(tagList[1])}`
        : `${tagList
            .slice(0, -1)
            .map((tag) => escapeHtml(tag))
            .join(", ")}, and ${escapeHtml(tagList.at(-1))}`
    : "";
  const supportTemplates = [
    () =>
      cleanProductType
        ? `<p>This updated ${escapeHtml(cleanProductType.toLowerCase())} copy keeps the page focused on the item itself while still surfacing the most useful search cues${tagSummary ? `, like ${tagSummary}` : ""}.</p>`
        : `<p>This updated copy keeps the page focused on the item itself while still surfacing the most useful search cues${tagSummary ? `, like ${tagSummary}` : ""}.</p>`,
    () =>
      `<p>It reads more like a curated product story than a raw import row, which makes the listing easier to scan, easier to trust, and easier to remember.</p>`,
    () =>
      `<p>The rewritten copy also leaves room for the original body details, so the page stays informative without feeling crowded or repetitive.</p>`,
    () =>
      `<p>Together, the title, body, and search phrases create a more complete listing that feels cleaner at the top and more useful as shoppers scroll.</p>`,
  ];
  const supportTemplate = supportTemplates[variantSeed % supportTemplates.length];
  parts.push(supportTemplate());

  const closerTemplates = [
    "Use this enhanced description to give shoppers a quicker read on the product while keeping the listing easy to find in search.",
    "A cleaner copy block helps the product page feel more focused, more readable, and easier to rank.",
    "The result is a more polished product story that still stays grounded in the source file.",
  ];
  parts.push(`<p>${closerTemplates[variantSeed % closerTemplates.length]}</p>`);

  return parts.filter(Boolean).join("\n");
}

function isEarringProductRow(row) {
  const values = [
    getRowValue(row, ["Handle"]),
    getRowValue(row, ["Title"]),
    getRowValue(row, ["Type", "Product Type"]),
    getRowValue(row, ["Product Category", "Google Shopping / Google Product Category"]),
    getRowValue(row, ["Tags"]),
  ];

  return values.some((value) => /earring/i.test(normalizePlainText(value)));
}

function enforceMinimumSellPrice(price, row) {
  const numeric = parseMoneyValue(price);
  if (!Number.isFinite(numeric)) {
    return "";
  }

  const floor = isEarringProductRow(row) ? 20 : 0;
  return Math.max(numeric, floor).toFixed(2);
}

function enforceMinimumCompareAtPrice(price, row, sellPrice) {
  const numeric = parseMoneyValue(price);
  const sellNumeric = parseMoneyValue(sellPrice);
  if (!isEarringProductRow(row)) {
    return Number.isFinite(numeric) ? numeric.toFixed(2) : "";
  }

  const minimum =
    Number.isFinite(sellNumeric) && sellNumeric > 0
      ? Math.max(28.99, sellNumeric + 0.01)
      : 28.99;

  if (!Number.isFinite(numeric)) {
    return minimum.toFixed(2);
  }

  return Math.max(numeric, minimum).toFixed(2);
}

export function toShopifyGid(typeOrValue, maybeValue) {
  const type = maybeValue === undefined ? "Product" : normalizePlainText(typeOrValue) || "Product";
  const value = maybeValue === undefined ? typeOrValue : maybeValue;

  const text = normalizePlainText(value);
  if (!text) {
    return "";
  }

  if (/^gid:\/\/shopify\/[a-z0-9_]+\/\d+$/i.test(text)) {
    return text;
  }

  const numeric = text.match(/\d+/)?.[0] || "";
  if (!numeric) {
    return "";
  }

  return `gid://shopify/${type}/${numeric}`;
}

function getRowValue(row, candidates) {
  const entries = Object.entries(row || {});
  const lookup = new Map(entries.map(([key, value]) => [normalizeKey(key), value]));

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeKey(candidate);
    if (lookup.has(normalizedCandidate)) {
      return lookup.get(normalizedCandidate);
    }
  }

  return "";
}

function splitTags(input) {
  const raw = normalizePlainText(input);
  if (!raw) {
    return [];
  }

  const values = raw
    .split(/[,\n;|]+/g)
    .map((entry) => normalizePlainText(entry))
    .filter(Boolean);

  const seen = new Set();
  const result = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }

  return result;
}

function buildVariantPlanFromRow(row) {
  const variantId = toShopifyGid("ProductVariant", getRowValue(row, ["Variant ID", "ID"]));
  const sku = normalizePlainText(getRowValue(row, ["Variant SKU"]));
  const optionValues = [
    normalizePlainText(getRowValue(row, ["Option1 Value"])),
    normalizePlainText(getRowValue(row, ["Option2 Value"])),
    normalizePlainText(getRowValue(row, ["Option3 Value"])),
  ].filter(Boolean);
  const variantTitle = normalizePlainText(getRowValue(row, ["Variant Title"]));
  const hasVariantIdentity = Boolean(variantId || sku || optionValues.length || variantTitle);
  const label =
    optionValues.join(" / ") ||
    variantTitle ||
    sku ||
    normalizePlainText(getRowValue(row, ["Title"]));
  const sourceCostValue = parseMoneyValue(getRowValue(row, ["Cost per item"]));
  const sourceCost = formatMoneyValue(sourceCostValue);
  const explicitPrice = formatMoneyValue(firstNonEmpty(getRowValue(row, ["Variant Price"]), getRowValue(row, ["Price / International"])));
  const derivedPrice = suggestRetailPriceFromCost(sourceCostValue);
  const price = enforceMinimumSellPrice(derivedPrice || explicitPrice, row);
  const compareAtPrice = enforceMinimumCompareAtPrice(
    formatMoneyValue(
    firstNonEmpty(getRowValue(row, ["Variant Compare At Price"]), getRowValue(row, ["Compare At Price / International"])),
    ),
    row,
    price,
  );

  if (!hasVariantIdentity) {
    return null;
  }

  return {
    variantId,
    sku,
    label,
    optionValues,
    price,
    compareAtPrice,
    sourceCost,
  };
}

function buildMediaPlanFromRow(row) {
  const imageSrc = normalizeUrlForMatch(getRowValue(row, ["Image Src"]));
  const alt = normalizePlainText(getRowValue(row, ["Image Alt Text"]));

  if (!imageSrc || !alt) {
    return null;
  }

  return {
    imageSrc,
    alt,
  };
}

function createBlankProductPlan(handle) {
  return {
    handle,
    productId: "",
    productInput: {
      title: "",
      descriptionHtml: "",
      productType: "",
      seo: {
        title: "",
        description: "",
      },
    },
    variantUpdates: [],
    mediaTargets: [],
    categoryQuery: "",
    categoryId: "",
  };
}

function dedupeArrayByKey(items, keyFn) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(item);
  }

  return result;
}

function mergeProductInput(target, row) {
  const title = buildEnhancedProductTitle(
    getRowValue(row, ["Title"]),
    firstNonEmpty(getRowValue(row, ["Type"]), getRowValue(row, ["Product Type"])),
  );
  const descriptionHtml = buildEnhancedDescriptionHtml(
    getRowValue(row, ["Title"]),
    getRowValue(row, ["Body (HTML)"]),
    firstNonEmpty(getRowValue(row, ["Type"]), getRowValue(row, ["Product Type"])),
    splitTags(getRowValue(row, ["Tags"])),
    getRowValue(row, ["Handle"]),
  );
  const productType = normalizePlainText(firstNonEmpty(getRowValue(row, ["Type"]), getRowValue(row, ["Product Type"])));
  const seoTitle = normalizePlainText(getRowValue(row, ["SEO Title"]));
  const seoDescription = normalizePlainText(getRowValue(row, ["SEO Description"]));
  const productId = toShopifyGid("Product", firstNonEmpty(getRowValue(row, ["Product ID"]), getRowValue(row, ["ID"])));
  const categoryQuery = normalizePlainText(
    firstNonEmpty(
      getRowValue(row, ["Google Shopping / Google Product Category"]),
      getRowValue(row, ["Google Shopping Category"]),
      getRowValue(row, ["Product Category"]),
    ),
  );

  if (title && !target.productInput.title) {
    target.productInput.title = title;
  }

  if (descriptionHtml && !target.productInput.descriptionHtml) {
    target.productInput.descriptionHtml = descriptionHtml;
  }

  if (productType && !target.productInput.productType) {
    target.productInput.productType = productType;
  }

  if (seoTitle && !target.productInput.seo.title) {
    target.productInput.seo.title = seoTitle;
  }

  if (seoDescription && !target.productInput.seo.description) {
    target.productInput.seo.description = seoDescription;
  }

  if (productId && !target.productId) {
    target.productId = productId;
  }

  if (categoryQuery && !target.categoryQuery) {
    target.categoryQuery = categoryQuery;
  }
}

export async function buildSeoBatchPlan(rows, { resolveCategoryId, suppressCategoryWarnings } = {}) {
  const groups = new Map();
  const warnings = [];
  const resolveCategory =
    typeof resolveCategoryId === "function"
      ? resolveCategoryId
      : async () => null;

  rows.forEach((row, rowIndex) => {
    const handle = normalizeHandleValue(getRowValue(row, ["Handle"]));
    if (!handle) {
      warnings.push(`Row ${rowIndex + 1} is missing a handle and was skipped.`);
      return;
    }

    const productPlan = groups.get(handle) || createBlankProductPlan(handle);
    mergeProductInput(productPlan, row);

    const variantPlan = buildVariantPlanFromRow(row);
    if (variantPlan) {
      productPlan.variantUpdates.push(variantPlan);
    }

    const mediaPlan = buildMediaPlanFromRow(row);
    if (mediaPlan) {
      productPlan.mediaTargets.push(mediaPlan);
    }

    groups.set(handle, productPlan);
  });

  const products = [];
  for (const productPlan of groups.values()) {
    productPlan.variantUpdates = dedupeArrayByKey(productPlan.variantUpdates, (entry) => {
      return [
        entry.variantId || "",
        entry.sku || "",
        entry.label || "",
        entry.price || "",
        entry.compareAtPrice || "",
      ].join("|");
    });

    productPlan.mediaTargets = dedupeArrayByKey(productPlan.mediaTargets, (entry) => entry.imageSrc);

    if (productPlan.categoryQuery) {
      productPlan.categoryId = await resolveCategory(productPlan.categoryQuery);
      if (!productPlan.categoryId && !suppressCategoryWarnings) {
        warnings.push(`Could not resolve category "${productPlan.categoryQuery}" for ${productPlan.handle}.`);
      }
    }

    products.push(productPlan);
  }

  return {
    products,
    warnings,
  };
}

export function buildMediaUpdateTargets(mediaNodes, mediaTargets) {
  const liveMedia = Array.isArray(mediaNodes) ? mediaNodes : [];
  const plannedTargets = Array.isArray(mediaTargets) ? mediaTargets : [];
  const liveLookup = liveMedia
    .map((node) => {
      const imageUrl = normalizeUrlForMatch(node?.image?.url);
      return imageUrl ? { node, imageUrl } : null;
    })
    .filter(Boolean);

  const updates = [];
  for (const target of plannedTargets) {
    const imageSrc = normalizeUrlForMatch(target?.imageSrc);
    const alt = normalizePlainText(target?.alt);
    if (!imageSrc || !alt) {
      continue;
    }

    const match = liveLookup.find((entry) => entry.imageUrl === imageSrc);
    if (!match?.node?.id) {
      continue;
    }

    updates.push({
      id: match.node.id,
      alt,
    });
  }

  return dedupeArrayByKey(updates, (entry) => entry.id);
}
