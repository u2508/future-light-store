const QUIRKY_GIFT_LIMIT = 12;

const HOME_COLLECTION_SOURCES = {
  bestSellerProducts: "appplaza-best-sellers",
  quirkyGiftPicks: "gifts",
  everydayEssentialProducts: "garden-tools",
};

// Prefer the perfume-led bestseller mix that is currently merchandised on the
// collection page. If any of those catalog items disappear, the collection
// fallback keeps the rail filled with other best-seller entries.
const BEST_SELLER_PRODUCT_PREFERENCES = [
  { titleIncludes: ["unisex fresh elegant perfume for daily wear and everyday fragrance"], price: 69.99 },
  { titleIncludes: ["unisex fresh floral perfume for daily wear and everyday fragrance"], price: 149.99 },
  { titleIncludes: ["unisex fresh floral perfume for daily wear and everyday fragrance"], price: 89.99 },
  { titleIncludes: ["unisex fresh floral perfume for daily wear and everyday fragrance"], price: 69.99 },
  { titleIncludes: ["unisex fresh floral perfume for day and evening wear"], price: 94.99 },
  { titleIncludes: ["unisex fresh perfume for daily wear and everyday fragrance use"], price: 129.99 },
  { titleIncludes: ["unisex fresh perfume for day and evening wear and everyday fragrance"], price: 69.99 },
  { titleIncludes: ["unisex fresh signature scent perfume for daily wear"], price: 64.99 },
  { titleIncludes: ["unisex fresh signature scent perfume for day and evening wear"], price: 89.99 },
  { titleIncludes: ["unisex fresh signature scent perfume for day and evening wear"], price: 69.99 },
  { titleIncludes: ["unisex perfume for daily wear and everyday fragrance use"], price: 64.99 },
  { titleIncludes: ["unisex perfume for daily wear and everyday fragrance use"], price: 64.99 },
];

const QUIRKY_GIFT_TERMS = [
  ["quirky", 12],
  ["unique", 10],
  ["novelty", 10],
  ["gift", 9],
  ["gadget", 8],
  ["fun", 8],
  ["toy", 7],
  ["game", 7],
  ["party", 6],
  ["candle", 5],
  ["fountain", 5],
  ["light", 4],
  ["lamp", 4],
  ["glow", 4],
  ["decor", 3],
  ["ornament", 3],
  ["diy", 2],
];

const GIFT_CATEGORIES = [
  ["gifts", ["gift", "present", "surprise"]],
  ["novelty", ["quirky", "unique", "novelty", "fun"]],
  ["play", ["toy", "game", "party", "diy"]],
  ["ambience", ["candle", "aroma", "diffuser", "light", "lamp", "glow"]],
  ["decor", ["decor", "ornament", "fountain", "vase", "flower"]],
  ["gadgets", ["gadget", "opener", "electronic", "smart"]],
];

// These handles are resolved from products.json at build time—not rendered as
// hardcoded cards. They keep the storefront mix genuinely giftable while the
// fallback scorer fills any slot if a catalog item is retired.
const QUIRKY_GIFT_HANDLE_PREFERENCES = [
  "graduation-money-box-gift-holder-pull-out-cash-surprise",
  "square-ball-shaped-scented-candle-handcrafted-colorful-birthday-gift",
  "luminous-sand-glow-in-dark-pebbles-stone-garden-yard-outdoor-path-lawn-decorations",
  "desktop-fountain-home-decor-mini-water-black-resin-indoor-fountains-waterfalls-relaxation-desk-small-tabletop-feature",
  "floating-teapot-water-fountain-ornament-indoor-tabletop-waterfall-decoration-with-led-light-stones-home-office-table-decor",
  "star-shaped-telescopic-pointer-wand-extendable-teacher-party-prop",
  "6-in-1-bottle-opener-multifunctional-screw-cap-jar-can-openers-lid-grip-opener-home-camping-safety-can-opener-kitchen-gadgets",
  "3d-geometric-pillar-candle-mold-diy-aromatherapy-resin-mold",
  "2m-20-led-artificial-ivy-string-lights-green-leaf-vine-fairy-lights-home-decorative-garland-lamp-for-christmas-living-room-decor",
  "3pcs-dollhouse-diy-miniature-model-home-decor-flower-pot-ornament-living-room-decoration-table-flowers-hydroponic-vase",
  "2pcs-electric-grinder-salt-pepper-mill-sets-with-led-light-one-hand-automatic-operation-adjustable-coarseness-kitchen-gadget",
  "mini-train-shape-aromatherapy-diffuser-with-led-lamp",
];

const EXCLUDED_GIFT_TERMS = [
  "baby",
  "bath",
  "toddler",
  "belt",
  "deodorant",
  "lint",
  "hair remover",
  "garden",
  "shovel",
  "hoe",
  "personal care",
  "underwear",
  "bra ",
  "shoe ",
];

function normalizedText(input) {
  return String(input || "")
    .replace(/<[^>]+>/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function finitePrice(input) {
  const price = Number(input);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function productPrice(product) {
  const cheapest = cheapestVariant(product?.variants);
  return finitePrice(cheapest?.price);
}

function cheapestVariant(variants) {
  return (Array.isArray(variants) ? variants : [])
    .map((variant) => ({
      variant,
      price: finitePrice(variant?.price),
    }))
    .filter((entry) => entry.price !== null)
    .sort((left, right) => left.price - right.price)[0]?.variant || null;
}

function giftCategory(searchText) {
  for (const [category, terms] of GIFT_CATEGORIES) {
    if (terms.some((term) => searchText.includes(term))) {
      return category;
    }
  }

  return "other";
}

function buildCandidate(product) {
  const id = Number(product?.id || 0);
  const title = String(product?.title || "").replace(/\s+/g, " ").trim();
  const handle = String(product?.handle || "").trim();
  const image = String(product?.image?.src || product?.images?.[0]?.src || "").trim();
  const cheapest = cheapestVariant(product?.variants);
  const price = finitePrice(cheapest?.price);

  if (!id || !title || !handle || !image || price === null) {
    return null;
  }

  const tags = Array.isArray(product?.tags) ? product.tags.join(" ") : String(product?.tags || "");
  const searchText = normalizedText(`${title} ${handle} ${product?.product_type || ""} ${tags}`);
  const score = QUIRKY_GIFT_TERMS.reduce(
    (total, [term, weight]) => total + (searchText.includes(term) ? weight : 0),
    0,
  );

  if (!score) {
    return null;
  }

  const compareAtPrice = finitePrice(cheapest?.compare_at_price);
  const savings = compareAtPrice && compareAtPrice > price ? (compareAtPrice - price) / compareAtPrice : 0;

  return {
    id,
    title,
    handle,
    image,
    price,
    compareAtPrice: compareAtPrice && compareAtPrice > price ? compareAtPrice : null,
    score,
    savings,
    category: giftCategory(searchText),
    titleKey: normalizedText(title),
    excluded: EXCLUDED_GIFT_TERMS.some((term) => searchText.includes(term)),
  };
}

function matchesProductPreference(product, preference) {
  const title = normalizedText(product?.title || "");
  const handle = normalizedText(product?.handle || "");
  const tags = Array.isArray(product?.tags) ? product.tags.join(" ") : String(product?.tags || "");
  const searchText = normalizedText(`${title} ${handle} ${product?.product_type || ""} ${tags}`);
  const titleIncludes = Array.isArray(preference?.titleIncludes)
    ? preference.titleIncludes
    : [preference?.titleIncludes];
  const expectedPrice = finitePrice(preference?.price);
  const actualPrice = productPrice(product);

  if (expectedPrice !== null && actualPrice !== expectedPrice) {
    return false;
  }

  return titleIncludes.filter(Boolean).every((token) => searchText.includes(normalizedText(token)));
}

function selectPreferredProducts(products, preferences) {
  const selected = [];
  const selectedIds = new Set();
  const selectedHandles = new Set();

  for (const preference of Array.isArray(preferences) ? preferences : []) {
    const matchedProduct = (Array.isArray(products) ? products : []).find((product) => {
      const id = Number(product?.id || 0);
      const handle = String(product?.handle || "").trim();
      if (!id || !handle || selectedIds.has(id) || selectedHandles.has(handle)) {
        return false;
      }

      return matchesProductPreference(product, preference);
    });

    const compact = matchedProduct ? compactProduct(matchedProduct) : null;
    if (!compact) {
      continue;
    }

    selected.push(compact);
    selectedIds.add(compact.id);
    selectedHandles.add(compact.handle);
  }

  return selected;
}

function byGiftPriority(left, right) {
  return (
    right.score - left.score ||
    right.savings - left.savings ||
    left.price - right.price ||
    right.id - left.id
  );
}

function selectQuirkyGiftPicks(products, limit = QUIRKY_GIFT_LIMIT) {
  const candidates = (Array.isArray(products) ? products : [])
    .map(buildCandidate)
    .filter(Boolean)
    .sort(byGiftPriority);
  const candidatesByHandle = new Map(candidates.map((candidate) => [candidate.handle, candidate]));
  const selected = [];
  const selectedIds = new Set();
  const selectedTitles = new Set();
  const categoryCounts = new Map();

  const addCandidate = (candidate, enforceCategoryLimit) => {
    if (
      selected.length >= limit ||
      selectedIds.has(candidate.id) ||
      selectedTitles.has(candidate.titleKey) ||
      (enforceCategoryLimit && (categoryCounts.get(candidate.category) || 0) >= 2)
    ) {
      return;
    }

    selected.push(candidate);
    selectedIds.add(candidate.id);
    selectedTitles.add(candidate.titleKey);
    categoryCounts.set(candidate.category, (categoryCounts.get(candidate.category) || 0) + 1);
  };

  QUIRKY_GIFT_HANDLE_PREFERENCES.forEach((handle) => {
    const candidate = candidatesByHandle.get(handle);
    if (candidate) {
      addCandidate(candidate, false);
    }
  });

  candidates.filter((candidate) => !candidate.excluded).forEach((candidate) => addCandidate(candidate, true));
  candidates.filter((candidate) => !candidate.excluded).forEach((candidate) => addCandidate(candidate, false));

  return selected.map(({ score, savings, category, titleKey, excluded, ...product }) => product);
}

function compactProduct(product) {
  const id = Number(product?.id || 0);
  const title = String(product?.title || "").replace(/\s+/g, " ").trim();
  const handle = String(product?.handle || "").trim();
  const image = String(product?.image?.src || product?.images?.[0]?.src || "").trim();
  const cheapest = cheapestVariant(product?.variants);
  const price = finitePrice(cheapest?.price);
  if (!id || !title || !handle || !image || price === null) return null;
  const compareAtPrice = finitePrice(cheapest?.compare_at_price);
  return {
    id,
    title,
    handle,
    image,
    price,
    compareAtPrice: compareAtPrice && compareAtPrice > price ? compareAtPrice : null,
  };
}

function productsFromCollection(
  products,
  collectionProductsPayload,
  handle,
  limit = QUIRKY_GIFT_LIMIT,
  preferredProducts = [],
) {
  const productIds = collectionProductsPayload?.collections?.[handle]?.productIds;
  if (!Array.isArray(productIds) || !productIds.length) return [];
  const productsById = new Map((Array.isArray(products) ? products : []).map((product) => [Number(product?.id || 0), product]));
  const collectionProducts = productIds.map((id) => compactProduct(productsById.get(Number(id)))).filter(Boolean);
  const selected = [];
  const seenIds = new Set();
  const seenHandles = new Set();

  const pushProduct = (product) => {
    if (!product || seenIds.has(product.id) || seenHandles.has(product.handle)) {
      return;
    }

    selected.push(product);
    seenIds.add(product.id);
    seenHandles.add(product.handle);
  };

  selectPreferredProducts(products, preferredProducts).forEach(pushProduct);
  collectionProducts.forEach(pushProduct);

  return selected.slice(0, limit);
}

export function buildHomeFeaturedProductsPayload(productsPayload, collectionProductsPayload = null) {
  const products = Array.isArray(productsPayload?.products) ? productsPayload.products : [];
  const bestSellerProducts = productsFromCollection(
    products,
    collectionProductsPayload,
    HOME_COLLECTION_SOURCES.bestSellerProducts,
    QUIRKY_GIFT_LIMIT,
    BEST_SELLER_PRODUCT_PREFERENCES,
  );
  const collectionGiftPicks = productsFromCollection(products, collectionProductsPayload, HOME_COLLECTION_SOURCES.quirkyGiftPicks);
  const everydayEssentialProducts = productsFromCollection(products, collectionProductsPayload, HOME_COLLECTION_SOURCES.everydayEssentialProducts);
  const quirkyGiftPicks = collectionGiftPicks.length ? collectionGiftPicks : selectQuirkyGiftPicks(products);

  return {
    generatedAt: productsPayload?.generatedAt || new Date().toISOString(),
    source: productsPayload?.source || "/data/products.json",
    total: quirkyGiftPicks.length,
    sources: HOME_COLLECTION_SOURCES,
    bestSellerProducts,
    quirkyGiftPicks,
    everydayEssentialProducts,
  };
}

export {
  BEST_SELLER_PRODUCT_PREFERENCES,
  HOME_COLLECTION_SOURCES,
  QUIRKY_GIFT_HANDLE_PREFERENCES,
  QUIRKY_GIFT_LIMIT,
  productsFromCollection,
  selectQuirkyGiftPicks,
};
