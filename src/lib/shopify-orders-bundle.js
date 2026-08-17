import {
  formatMoneyValue,
  normalizeHandleValue,
  normalizePlainText,
  parseMoneyValue,
} from "./shopify-seo-batch.js";

export const DEFAULT_PRICE_INCREASE_PERCENT = 35;

export const DEFAULT_BUNDLE_TIERS = [
  {
    minimumQuantity: 2,
    discountPercent: 20,
    label: "Buy 2 - 20% Off",
  },
  {
    minimumQuantity: 3,
    discountPercent: 30,
    label: "Buy 3 - 30% Off",
  },
  {
    minimumQuantity: 4,
    discountPercent: 40,
    label: "Buy 4 - 40% Off",
  },
  {
    minimumQuantity: 11,
    discountPercent: 50,
    label: "Bulk 11+ - 50% Off",
  },
];

const PRODUCT_HANDLE_OVERRIDES = {
  [normalizeKey("LED Roller Skates Kids Adults Light-up Quad")]: [
    "led-roller-skates-light-up-quad-skating-shoes",
  ],
  [normalizeKey("Car Clock Luminous Automobiles Internal Stick-on Mini")]: [
    "car-clock-luminous-automobiles-internal-stick-on-mini-digital-watch-mechanics-quartz-clocks-auto-ornament-car-accessories-gifts-1",
  ],
  [normalizeKey("Color Changing Foundation Stick for Smooth Coverage")]: [
    "lakerain-color-changing-foundation-stick-high-coverage-oil-control-concealer-skincare-ingredients-concealer-foundation-2-in-1",
  ],
  [normalizeKey("Unisex Waterproof Running Waist Bag Lightweight Fanny")]: [
    "unisex-waterproof-running-waist-bag-lightweight-fanny-pack",
  ],
  [normalizeKey("14-grid 7-day Pill Box Weekly Organizer Vitamins for Easy Everyday Use")]: [
    "14-grid-7-day-pill-box-weekly-organizer-for-vitamins-medicine",
  ],
  [normalizeKey("Colorful Black Drinking Straws Flexible")]: [
    "colorful-flexible-drinking-straws-wedding-party-supplies",
  ],
  [normalizeKey("Cycling Face Mask UV Protection Breathable Neck")]: [
    "cycling-face-mask-uv-protection-breathable-neck-gaiter",
  ],
  [normalizeKey("Foot Callus Remover Tool Stainless Steel Pedicure")]: [
    "foot-callus-remover-tool-stainless-steel-pedicure-scraper-file",
  ],
  [normalizeKey("Summer Full Face Mask Brim Sun Protection")]: [
    "summer-full-face-mask-with-brim-sun-protection-beach-facekini",
  ],
  [normalizeKey("Waterproof Adult Mealtime Bib Clothing Protection")]: [
    "large-waterproof-adult-mealtime-bibs-disability-clothes-bib-cook-protector-tool",
  ],
  [normalizeKey("Silicone Waterproof Adult Bib Reusable Food Catcher")]: [
    "1pc-silicone-waterproof-adult-bib-reusable-anti-oil-1",
  ],
  [normalizeKey("Men's Slim Fit Stretch Jeans Casual Cotton Denim Pants Available in 7 Colors")]: [
    "stretch-jean-mens-slim-fit-casual-trousers",
  ],
  [normalizeKey("Stretch Jean - Men's Slim-Fit Casual Trousers")]: [
    "stretch-jean-mens-slim-fit-casual-trousers",
  ],
  [normalizeKey("Glitter Sequins Turban Hat | Hijab & Chemo Cap")]: [
    "soft-velvet-stretchy-turban-bonnet-muslim-hijab-cap",
  ],
  [normalizeKey("Motorcycle Cooling Full Face Mask Summer Breathable Motorbike Riding Hood Neck Cover Motocross Cycling Helmet Headgear")]: [
    "motorcycle-balaclava-face-mask-breathable-windproof-riding-hood",
  ],
  [normalizeKey("Motorcycle Riding Mask Windproof Outdoor Racing Skiing Off-Road Mask Bicycle Vehicle Sports Full Face Protection Tactical Helmet")]: [
    "motorcycle-balaclava-face-mask-breathable-windproof-riding-hood",
  ],
  [normalizeKey("Ladies and Men's Summer Full Face Hyaluronic Acid Sunscreen Mask UPF 500+UV Protection Breathable Ice Silk Mask for Outdoor Spor")]: [
    "ladies-and-mens-summer-full-face-hyaluronic-acid-sunscreen-mask-upf-500-uv-protection-breathable-ice-silk-mask-for-outdoor-spor",
  ],
};

const COLOR_WORDS = new Set([
  "black",
  "white",
  "gray",
  "grey",
  "silver",
  "gold",
  "blue",
  "green",
  "red",
  "yellow",
  "orange",
  "purple",
  "pink",
  "beige",
  "brown",
  "khaki",
  "navy",
  "turmeric",
  "rose",
  "lavender",
  "cyan",
  "wine",
  "ivory",
  "cream",
  "tan",
  "transparent",
]);

function normalizeKey(value) {
  return normalizePlainText(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function pushUnique(values, nextValue) {
  const normalized = normalizePlainText(nextValue);
  if (!normalized) {
    return;
  }

  if (!values.includes(normalized)) {
    values.push(normalized);
  }
}

function splitLineItemName(lineItemName) {
  const raw = normalizePlainText(lineItemName);
  if (!raw) {
    return {
      productTitle: "",
      variantLabel: "",
    };
  }

  const separators = [" - ", " – ", " — "];
  let splitIndex = -1;
  let separatorLength = 0;

  for (const separator of separators) {
    const index = raw.lastIndexOf(separator);
    if (index > splitIndex) {
      splitIndex = index;
      separatorLength = separator.length;
    }
  }

  if (splitIndex < 0) {
    return {
      productTitle: raw,
      variantLabel: "",
    };
  }

  return {
    productTitle: raw.slice(0, splitIndex).trim(),
    variantLabel: raw.slice(splitIndex + separatorLength).trim(),
  };
}

function toNumber(value) {
  const numeric = typeof value === "number" ? value : parseMoneyValue(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function roundMoney(value) {
  if (!Number.isFinite(value)) {
    return "";
  }

  return formatMoneyValue(Math.round(value * 100) / 100);
}

export function computeUpdatedPrice(sourcePrice, priceIncreasePercent = DEFAULT_PRICE_INCREASE_PERCENT) {
  const numeric = toNumber(sourcePrice);
  if (numeric == null) {
    return "";
  }

  return roundMoney(numeric * (1 + priceIncreasePercent / 100));
}

export function computeUpdatedCompareAtPrice(
  sourcePrice,
  sourceCompareAtPrice,
  priceIncreasePercent = DEFAULT_PRICE_INCREASE_PERCENT,
) {
  const basePrice = toNumber(sourcePrice);
  const compareAt = toNumber(sourceCompareAtPrice);
  if (compareAt == null || basePrice == null || compareAt <= basePrice) {
    return "";
  }

  return roundMoney(compareAt * (1 + priceIncreasePercent / 100));
}

export function buildBundleTiers(updatedPrice, bundleTiers = DEFAULT_BUNDLE_TIERS) {
  const numericPrice = toNumber(updatedPrice);
  if (numericPrice == null) {
    return [];
  }

  return bundleTiers.map((tier) => {
    const discountMultiplier = 1 - tier.discountPercent / 100;
    const price = roundMoney(numericPrice * discountMultiplier);
    const totalPrice = roundMoney((toNumber(price) || 0) * tier.minimumQuantity);
    const savingsTotal = roundMoney(numericPrice * tier.minimumQuantity - (toNumber(totalPrice) || 0));

    return {
      minimumQuantity: tier.minimumQuantity,
      discountPercent: tier.discountPercent,
      label: tier.label,
      price,
      totalPrice,
      savingsTotal,
    };
  });
}

export function getProductLookupCandidates(productTitle) {
  const lookupHandle = getProductLookupHandle(productTitle);
  const normalizedTitle = normalizeKey(productTitle);
  const overrides = PRODUCT_HANDLE_OVERRIDES[normalizedTitle] || [];
  const candidates = [lookupHandle];

  for (const override of overrides) {
    const normalizedOverride = normalizeHandleValue(override);
    if (normalizedOverride && !candidates.includes(normalizedOverride)) {
      candidates.push(normalizedOverride);
    }
  }

  return candidates;
}

function getVariantKey(row, productHandle, lineItemName, lineItemSku, variantLabel) {
  const skuKey = normalizeKey(lineItemSku);
  if (skuKey) {
    return `sku:${skuKey}`;
  }

  const labelKey = normalizeKey(variantLabel);
  if (labelKey) {
    return `label:${labelKey}`;
  }

  const fallbackKey = normalizeKey(`${productHandle}:${lineItemName}`);
  return `row:${fallbackKey}`;
}

function createProductPlan(productTitle, productHandle) {
  return {
    key: `handle:${normalizeKey(productHandle)}`,
    productTitle,
    productHandle,
    offerTitle: `${productTitle} Quantity Breaks`,
    quantitySold: 0,
    sourceRows: [],
    lineItemNames: [],
    lineItemSkus: [],
    variants: [],
    resolvedShopifyProducts: [],
    unresolvedVariants: [],
    _variantMap: new Map(),
  };
}

function createVariantPlan({
  lineItemName,
  lineItemSku,
  productTitle,
  productHandle,
  variantLabel,
  rowNumber,
  quantitySold,
  sourcePrice,
  sourceCompareAtPrice,
}) {
  return {
    key: getVariantKey({}, productHandle, lineItemName, lineItemSku, variantLabel),
    lineItemName,
    lineItemSku,
    productTitle,
    productHandle,
    variantLabel,
    quantitySold,
    orderLineNumbers: [rowNumber],
    sourcePrice,
    sourceCompareAtPrice,
    updatedPrice: computeUpdatedPrice(sourcePrice),
    updatedCompareAtPrice: computeUpdatedCompareAtPrice(sourcePrice, sourceCompareAtPrice),
    observedPrices: sourcePrice ? [sourcePrice] : [],
    observedCompareAtPrices: sourceCompareAtPrice ? [sourceCompareAtPrice] : [],
    bundleTiers: buildBundleTiers(computeUpdatedPrice(sourcePrice)),
    tierBreakdown: "",
  };
}

function finalizeVariantPlan(variantPlan, priceIncreasePercent, bundleTiers, warnings) {
  const sourcePrice = variantPlan.observedPrices[0] || "";
  const sourceCompareAtPrice = variantPlan.observedCompareAtPrices[0] || "";

  if (variantPlan.observedPrices.length > 1) {
    warnings.push(`Multiple prices found for ${variantPlan.lineItemSku || variantPlan.lineItemName}; using ${sourcePrice}.`);
  }

  if (variantPlan.observedCompareAtPrices.length > 1) {
    warnings.push(
      `Multiple compare-at prices found for ${variantPlan.lineItemSku || variantPlan.lineItemName}; using ${sourceCompareAtPrice}.`,
    );
  }

  const updatedPrice = computeUpdatedPrice(sourcePrice, priceIncreasePercent);
  const updatedCompareAtPrice = computeUpdatedCompareAtPrice(
    sourcePrice,
    sourceCompareAtPrice,
    priceIncreasePercent,
  );

  const tierRows = buildBundleTiers(updatedPrice, bundleTiers);
  const tierBreakdown = tierRows.map((tier) => `${tier.minimumQuantity}x ${tier.price}`).join(", ");

  return {
    ...variantPlan,
    sourcePrice,
    sourceCompareAtPrice,
    updatedPrice,
    updatedCompareAtPrice,
    bundleTiers: tierRows,
    tierBreakdown,
  };
}

export function buildOrdersBundleManifest(rows, options = {}) {
  const {
    inputFile = "",
    outputFile = "",
    priceIncreasePercent = DEFAULT_PRICE_INCREASE_PERCENT,
    bundleTiers = DEFAULT_BUNDLE_TIERS,
    generatedAt = new Date().toISOString(),
    status = "dry-run",
    resolvedAt = "",
  } = options;

  const warnings = [];
  const products = new Map();

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const lineItemName = normalizePlainText(row?.["Lineitem name"]);
    if (!lineItemName) {
      warnings.push(`Row ${rowNumber} is missing a line item name and was skipped.`);
      return;
    }

    const quantitySold = Number.parseInt(normalizePlainText(row?.["Lineitem quantity"]) || "1", 10) || 1;
    const sourcePrice = formatMoneyValue(row?.["Lineitem price"]);
    const sourceCompareAtPrice = formatMoneyValue(row?.["Lineitem compare at price"]);
    const lineItemSku = normalizePlainText(row?.["Lineitem sku"]);
    const { productTitle, variantLabel } = splitLineItemName(lineItemName);
    const productHandle = normalizeHandleValue(productTitle);

    if (!productHandle) {
      warnings.push(`Row ${rowNumber} could not derive a product handle from "${lineItemName}" and was skipped.`);
      return;
    }

    const productKey = `handle:${normalizeKey(productHandle)}`;
    const variantKey = getVariantKey({}, productHandle, lineItemName, lineItemSku, variantLabel);

    let productPlan = products.get(productKey);
    if (!productPlan) {
      productPlan = createProductPlan(productTitle, productHandle);
      products.set(productKey, productPlan);
    }

    productPlan.quantitySold += quantitySold;
    productPlan.sourceRows.push(rowNumber);
    pushUnique(productPlan.lineItemNames, lineItemName);
    pushUnique(productPlan.lineItemSkus, lineItemSku);

    let variantPlan = productPlan._variantMap.get(variantKey);
    if (!variantPlan) {
      variantPlan = createVariantPlan({
        lineItemName,
        lineItemSku,
        productTitle,
        productHandle,
        variantLabel,
        rowNumber,
        quantitySold,
        sourcePrice,
        sourceCompareAtPrice,
      });
      productPlan._variantMap.set(variantKey, variantPlan);
      return;
    }

    variantPlan.quantitySold += quantitySold;
    variantPlan.orderLineNumbers.push(rowNumber);
    pushUnique(variantPlan.observedPrices, sourcePrice);
    pushUnique(variantPlan.observedCompareAtPrices, sourceCompareAtPrice);
    if (!variantPlan.lineItemName) {
      variantPlan.lineItemName = lineItemName;
    }
    if (!variantPlan.lineItemSku) {
      variantPlan.lineItemSku = lineItemSku;
    }
  });

  const normalizedProducts = [];
  let variantCount = 0;

  for (const productPlan of products.values()) {
    const variants = [];
    for (const variantPlan of productPlan._variantMap.values()) {
      variants.push(finalizeVariantPlan(variantPlan, priceIncreasePercent, bundleTiers, warnings));
    }

    variantCount += variants.length;

    normalizedProducts.push({
      key: productPlan.key,
      productTitle: productPlan.productTitle,
      productHandle: productPlan.productHandle,
      offerTitle: productPlan.offerTitle,
      quantitySold: productPlan.quantitySold,
      sourceRows: productPlan.sourceRows,
      lineItemNames: productPlan.lineItemNames,
      lineItemSkus: productPlan.lineItemSkus,
      variants,
      resolvedShopifyProducts: [],
      unresolvedVariants: [],
    });
  }

  const quantitySold = normalizedProducts.reduce(
    (total, productPlan) => total + productPlan.quantitySold,
    0,
  );

  const summary = {
    productCount: normalizedProducts.length,
    variantCount,
    entryCount: rows.length,
    quantitySold,
  };

  const manifestWarnings = Array.from(new Set(warnings));

  return {
    generatedAt,
    resolvedAt,
    inputFile,
    outputFile,
    status,
    priceIncreasePercent,
    bundleTiers,
    summary,
    products: normalizedProducts,
    warnings: manifestWarnings,
    totals: {
      products: summary.productCount,
      variants: summary.variantCount,
      quantitySold: summary.quantitySold,
    },
  };
}

export function getProductSearchQuery(productTitle) {
  const title = normalizePlainText(productTitle).replace(/"/g, '\\"');
  return `title:"${title}"`;
}

export function getProductLookupHandle(productTitle) {
  return normalizeHandleValue(productTitle);
}

export function selectLiveVariant(liveVariants, variantPlan) {
  const variants = Array.isArray(liveVariants) ? liveVariants : [];
  if (!variants.length) {
    return null;
  }

  const candidateSku = normalizeKey(variantPlan?.lineItemSku || "");
  const candidateLabel = normalizeKey(variantPlan?.variantLabel || "");
  const candidateName = normalizeKey(variantPlan?.lineItemName || "");

  if (candidateSku) {
    const match = variants.find((variant) => normalizeKey(variant?.sku) === candidateSku);
    if (match) {
      return match;
    }
  }

  if (variants.length === 1) {
    return variants[0];
  }

  if (candidateLabel) {
    const match = variants.find((variant) => {
      const titleMatch = normalizeKey(variant?.title) === candidateLabel;
      const selectedOptions = Array.isArray(variant?.selectedOptions)
        ? variant.selectedOptions.map((option) => normalizePlainText(option?.value)).filter(Boolean).join(" / ")
        : "";
      const selectedMatch = normalizeKey(selectedOptions) === candidateLabel;
      return titleMatch || selectedMatch;
    });
    if (match) {
      return match;
    }
  }

  if (candidateName) {
    const match = variants.find((variant) => normalizeKey(variant?.title) === candidateName);
    if (match) {
      return match;
    }
  }

  const candidateColors = new Set(
    normalizePlainText([variantPlan?.variantLabel, variantPlan?.lineItemName].filter(Boolean).join(" "))
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((token) => COLOR_WORDS.has(token)),
  );
  if (candidateColors.size) {
    const match = variants.find((variant) => {
      const selectedOptions = Array.isArray(variant?.selectedOptions)
        ? variant.selectedOptions.map((option) => normalizePlainText(option?.value)).filter(Boolean).join(" ")
        : "";
      const variantText = normalizePlainText([variant?.title, selectedOptions].filter(Boolean).join(" "))
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter((token) => COLOR_WORDS.has(token));
      return variantText.some((token) => candidateColors.has(token));
    });
    if (match) {
      return match;
    }
  }

  return null;
}
