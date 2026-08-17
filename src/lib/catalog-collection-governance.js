import { CATALOG_COLLECTION_PLAN } from "./catalog-collection-plan.js";
import { normalizeCatalogText } from "./catalog-taxonomy.js";

export const COLLECTION_GOVERNANCE_VERSION = "2026-08-10.3";
export const COLLECTION_TAG_PREFIX = "salt:collection:";

// These collections were merged into their canonical targets. Keep the map so
// legacy product tags and navigation references resolve without recreating the
// retired collections.
export const RETIRED_COLLECTION_HANDLE_MAP = Object.freeze({
  "caregiver-essentials": "health-wellness",
  "mobility-support": "health-wellness",
  "posture-support": "health-wellness",
  "camping-gear": "travel-outdoor",
  "holiday-gifts": "gifts",
  "viral-tiktok-products": "trending-finds",
});

const PRICE_COLLECTIONS = [
  { handle: "under-25", title: "Under $25", maximumExclusive: 25 },
  { handle: "under-35", title: "Under $35", maximumExclusive: 35 },
  { handle: "under-44-99", title: "Under $44.99", maximumExclusive: 45, legacyHandles: ["under-100"] },
  { handle: "under-50", title: "Under $50", maximumExclusive: 50 },
  { handle: "under-60", title: "Under $60", maximumExclusive: 60, legacyHandles: ["gloves"] },
  { handle: "premium-picks", title: "Premium Picks", minimumExclusive: 99.99 },
];

export const PRICE_COLLECTION_POLICIES = Object.freeze(
  PRICE_COLLECTIONS.map((entry) => Object.freeze({
    legacyHandles: Object.freeze([]),
    ...entry,
    legacyHandles: Object.freeze([...(entry.legacyHandles || [])]),
    currencyCode: "USD",
    kind: "price",
  })),
);

export const ALL_PRODUCTS_COLLECTION_POLICY = Object.freeze({
  handle: "all-products",
  title: "All Products",
  kind: "catalog-boundary",
  legacyHandles: Object.freeze([]),
});

function spec(handle, title, match = {}, legacyHandles = []) {
  return Object.freeze({
    handle,
    title,
    kind: "semantic",
    tag: collectionTagForHandle(handle),
    match: Object.freeze({ ...match }),
    legacyHandles: Object.freeze([...legacyHandles]),
  });
}

const EXTRA_SEMANTIC_SPECS = [
  spec("classification-review", "Classification Review", { dynamic: "classification-review" }),
  spec("best-sellers", "Best Sellers", { dynamic: "best-sellers" }, ["appplaza-best-sellers"]),
  spec("artificial-aquarium-decor-plants", "Artificial Aquarium Decor Plants", { subcategories: ["aquarium-supplies"], textAny: ["artificial aquarium plant", "aquarium decor plant"] }),
  spec("back-to-school", "Back to School", { categories: ["office-school-supplies"], targets: ["back-to-school"] }),
  spec("beauty-makeup-essentials", "Beauty Makeup Essentials", { subcategories: ["eye-makeup", "face-makeup", "lip-care-makeup", "makeup-tools", "beauty-tools"], targets: ["beauty-makeup-essentials"] }),
  spec("blush-glow", "Blush & Glow", { textAny: ["blush", "cheek tint", "highlighter", "illuminator"], targets: ["blush-glow"] }),
  spec("senior-living-solutions", "Senior Living Solutions", { dynamic: "senior-living", textAny: ["senior", "elderly", "daily living aid", "caregiver", "mobility aid", "pill organizer"] }, ["books"]),
  spec("camping-gear", "Camping Gear", { categories: ["camping-essentials"], targets: ["camping-gear"] }),
  spec("candles", "Candles", { subcategories: ["candles-home-fragrance"], targets: ["candles"] }),
  spec("car-accessories", "Home & Car Accessories", { departments: ["automotive"], categories: ["home-car-accessories"], targets: ["car-accessories"] }),
  spec("caregiver-essentials", "Caregiver Essentials", { dynamic: "caregiver", textAny: ["caregiver", "patient aid", "daily living aid", "medicine organizer"] }),
  spec("cat-supplies", "Cat Supplies", { subcategories: ["cat-supplies"], textAll: ["cat"] }),
  spec("cleaning-tools", "Cleaning Tools", { subcategories: ["cleaning-tools"], targets: ["cleaning-tools"] }),
  spec("coffee-tea-accessories", "Coffee & Tea Accessories", { subcategories: ["coffee-tea-accessories"], textAny: ["coffee", "tea infuser", "tea set", "teapot"] }),
  spec("daily-living-aids", "Daily Living Aids", { dynamic: "daily-living", subcategories: ["medicine-organizers", "mobility-support", "vision-care"], targets: ["daily-living-aids"] }),
  spec("decorative-accessories", "Decorative Accessories", { subcategories: ["home-decor", "planters-garden-decor", "aroma-decor"], targets: ["decorative-accessories"] }),
  spec("dining-essentials", "Dining Essentials", { subcategories: ["dining-serveware", "drinkware"], targets: ["dining-essentials"] }),
  spec("dog-supplies", "Dog Supplies", { subcategories: ["dog-supplies"], textAll: ["dog"] }),
  spec("dramatic-lashes", "Dramatic Lashes", { textAny: ["false eyelash", "eyelashes", "lash extension", "lash cluster"] }),
  spec("earbuds-and-cases", "Earbuds & Cases", { subcategories: ["earbuds-earphones", "earbuds-cases"] }),
  spec("eye-beauty-collection", "Eye Beauty Collection", { subcategories: ["eye-makeup"], targets: ["eye-beauty-collection"] }),
  spec("face-creams-moisturizers", "Face Creams & Moisturizers", { textAny: ["face cream", "moisturizer", "moisturiser", "facial cream"], targets: ["face-creams-moisturizers"] }),
  spec("garden-tools", "Garden & Tools", { subcategories: ["garden-tools", "tools-hardware", "home-repair-tools"], targets: ["garden-tools"] }),
  spec("general-merchandise", "General Merchandise", { departments: ["general"] }),
  spec("gifts", "Gifts Collection", { dynamic: "gifts", departments: ["gifts"], targets: ["gifts"], textAny: ["gift box", "gift set", "birthday gift", "christmas gift", "housewarming gift"] }),
  spec("gifts-for-dad", "Gifts for Dad", { dynamic: "gifts-for-dad" }),
  spec("gifts-for-mom", "Gifts for Mom", { dynamic: "gifts-for-mom" }),
  spec("gifts-for-seniors", "Gifts for Seniors", { dynamic: "gifts-for-seniors" }),
  spec("glam-eye-palettes", "Glam Eye Palettes", { textAny: ["eyeshadow palette", "eye shadow palette", "makeup palette"] }),
  spec("hair-nourishment", "Hair Nourishment", { subcategories: ["hair-care"], textAny: ["hair oil", "hair mask", "hair nourishment", "hair treatment"], targets: ["hair-nourishment"] }),
  spec("hair-wash-essentials", "Hair Wash Essentials", { textAny: ["shampoo", "conditioner", "hair wash", "scalp cleanser"] }),
  spec("holiday-gifts", "Holiday Gifts", { dynamic: "holiday-gifts", textAny: ["christmas gift", "holiday gift", "festive gift"] }),
  spec("home-safety", "Home Safety", { dynamic: "home-safety", textAny: ["home safety", "anti slip", "grab bar", "safety rail", "door alarm"] }),
  spec("housewarming-gifts", "Housewarming Gifts", { dynamic: "housewarming-gifts", textAny: ["housewarming gift", "new home gift"] }),
  spec("iphone-cases", "iPhone Cases", { require: { rules: ["phone-case"], textAny: ["iphone"] } }),
  spec("jeans", "Jeans", { subcategories: ["jeans"], rules: ["jeans"] }),
  spec("jewelry-accessories", "Jewelry & Accessories", { departments: ["jewelry"] }),
  spec("kitchen-gadgets", "Kitchen Gadgets", { subcategories: ["kitchen-gadgets"], targets: ["kitchen-gadgets"] }),
  spec("lips-and-care", "Lip Care", { subcategories: ["lip-care-makeup"], targets: ["lips-and-care"] }),
  spec("luxury-fragrances", "Luxury Fragrances", { subcategories: ["fragrance"], textAny: ["perfume", "fragrance", "cologne", "eau de parfum", "eau de toilette"] }),
  spec("magsafe-gadgets", "MagSafe Gadgets", { textAny: ["magsafe", "mag safe"] }),
  spec("mascara-collection", "Mascara Collection", { textAny: ["mascara"] }),
  spec("massage-tools", "Massage Tools", { subcategories: ["massage-recovery"], targets: ["massage-tools"] }),
  spec("medical-accessories", "Medical Accessories", { subcategories: ["medical-accessories", "medicine-organizers", "vision-care"], textAny: ["medical", "pill box", "pill cutter", "medicine organizer"] }),
  spec("memory-organization", "Memory & Organization", { dynamic: "memory-organization", textAny: ["memory", "reminder", "planner", "goal setting"] }),
  spec("men-t-shirt", "Men's T-Shirts", { require: { subcategories: ["t-shirts"], audiences: ["men"] } }),
  spec("mobility-support", "Mobility Support", { subcategories: ["mobility-support"], targets: ["mobility-support"] }),
  spec("new-arrivals", "New Arrivals", { dynamic: "new-arrivals" }),
  spec("pet-essentials", "Pet Essentials", { departments: ["pets"], targets: ["pet-assocerries"] }, ["pet-assocerries"]),
  spec("pet-feeding", "Pet Feeding", { subcategories: ["pet-feeding-accessories"], textAll: ["pet"], textAny: ["feeding", "feeder", "bowl"] }),
  spec("pet-grooming", "Pet Grooming", { textAll: ["pet"], textAny: ["grooming", "groomer", "pet brush", "pet comb", "nail clipper"] }),
  spec("pet-toys", "Pet Toys", { textAll: ["pet"], textAny: ["toy", "ball", "chew"] }),
  spec("pet-travel", "Pet Travel", { textAll: ["pet"], textAny: ["travel", "carrier", "car seat", "portable"] }),
  spec("posture-support", "Posture Support", { textAny: ["posture", "back brace", "posture corrector"], targets: ["posture-support"] }),
  spec("relaxation-products", "Relaxation Products", { subcategories: ["sleep-relaxation", "aromatherapy-essential-oils"], targets: ["relaxation-products"] }),
  spec("repair-shine-serums", "Repair & Shine Serums", { textAny: ["hair serum", "repair serum", "shine serum", "split end serum"] }),
  spec("robe", "Robes", { subcategories: ["robes-sleepwear"], rules: ["robes-sleepwear"] }),
  spec("seasonal-decor", "Seasonal Decor", { textAny: ["christmas decor", "halloween decor", "holiday decor", "seasonal decor"] }),
  spec("sleep-essentials", "Sleep Essentials", { subcategories: ["sleep-relaxation"], rules: ["sleep-support-pillows"], targets: ["sleep-essentials"] }),
  spec("staff-picks", "Staff Picks", { dynamic: "staff-picks" }),
  spec("stationery", "Stationery", { categories: ["office-school-supplies"], targets: ["stationery"] }),
  spec("storage-organization", "Storage & Organization", { subcategories: ["storage-organization", "food-storage-containers", "kitchen-storage"], targets: ["storage-organization"] }),
  spec("t-shirt", "T-Shirts", { subcategories: ["t-shirts"], rules: ["t-shirts", "mens-graphic-tshirts"] }),
  spec("trousers", "Trousers", { subcategories: ["trousers-pants"], rules: ["trousers-pants"] }),
  spec("trending-finds", "Trending Finds", { dynamic: "trending-finds" }, ["unique-products"]),
  spec("viral-tiktok-products", "Viral TikTok Products", { textAny: ["viral", "tiktok", "tik tok"] }),
  spec("wall-art", "Wall Art", { subcategories: ["wall-decor"], textAny: ["wall art", "wall poster", "canvas print"] }),
  spec("wall-lights", "Wall Lights", { textAny: ["wall light", "wall lamp", "wall sconce"], targets: ["wall-lights"] }),
];

const MERGED_COLLECTION_TAGS = Object.freeze({
  gifts: Object.freeze(["gifts", "holiday-gifts"]),
  "trending-finds": Object.freeze(["trending-finds", "viral-tiktok-products"]),
});

function buildPlanSpecs() {
  return CATALOG_COLLECTION_PLAN.map((entry) => spec(
    entry.handle,
    entry.title,
    entry.handle === "creator-essentials" || entry.handle === "anime-collectables"
      ? { dynamic: entry.handle }
      : { taxonomyTags: [entry.ruleTag], targets: [entry.handle, ...entry.legacyHandles] },
    entry.legacyHandles,
  ));
}

const semanticByHandle = new Map();
for (const entry of [...buildPlanSpecs(), ...EXTRA_SEMANTIC_SPECS]) {
  if (RETIRED_COLLECTION_HANDLE_MAP[entry.handle]) continue;
  semanticByHandle.set(entry.handle, entry);
}

export const SEMANTIC_COLLECTION_POLICIES = Object.freeze(
  [...semanticByHandle.values()].sort((left, right) => left.handle.localeCompare(right.handle)),
);

export const COLLECTION_GOVERNANCE_POLICIES = Object.freeze([
  ALL_PRODUCTS_COLLECTION_POLICY,
  ...PRICE_COLLECTION_POLICIES,
  ...SEMANTIC_COLLECTION_POLICIES,
]);

export function normalizeCollectionHandle(value) {
  return normalizeCatalogText(value).replace(/\s+/g, "-");
}

export function canonicalCollectionHandle(value) {
  const normalized = normalizeCollectionHandle(value);
  return RETIRED_COLLECTION_HANDLE_MAP[normalized] || normalized;
}

export function collectionTagForHandle(handle) {
  const normalized = canonicalCollectionHandle(handle);
  if (!normalized) throw new Error("Collection handle is required for a controlled tag.");
  return normalized;
}

export function isManagedCollectionTag(tag) {
  const normalized = normalizeCollectionHandle(tag);
  return SEMANTIC_COLLECTION_POLICIES.some((policy) => normalizeCollectionHandle(policy.tag) === normalized);
}

export function semanticCollectionRuleTags(policy) {
  return [...(MERGED_COLLECTION_TAGS[policy?.handle] || [policy?.tag]).filter(Boolean)];
}

function normalizeSet(values) {
  return new Set((Array.isArray(values) ? values : []).map(normalizeCatalogText).filter(Boolean));
}

function productText(product) {
  return normalizeCatalogText([
    product?.title,
    product?.handle,
    product?.product_type || product?.productType,
  ].filter(Boolean).join(" "));
}

function hasPhrase(text, phrase) {
  const normalized = normalizeCatalogText(phrase);
  if (!normalized) return false;
  return ` ${text} `.includes(` ${normalized} `);
}

function matchesRequiredSignals(requirement, product, knowledge) {
  if (!requirement) return true;
  const text = productText(product);
  const tests = [];
  if (requirement.departments?.length) tests.push(requirement.departments.map(normalizeCatalogText).includes(normalizeCatalogText(knowledge?.departmentId)));
  if (requirement.categories?.length) tests.push(requirement.categories.map(normalizeCatalogText).includes(normalizeCatalogText(knowledge?.categoryId)));
  if (requirement.subcategories?.length) tests.push(requirement.subcategories.map(normalizeCatalogText).includes(normalizeCatalogText(knowledge?.subcategoryId)));
  if (requirement.rules?.length) tests.push(requirement.rules.map(normalizeCatalogText).includes(normalizeCatalogText(knowledge?.classificationRule || knowledge?.ruleId)));
  if (requirement.audiences?.length) tests.push(requirement.audiences.map(normalizeCatalogText).includes(normalizeCatalogText(knowledge?.audience?.id)));
  if (requirement.textAll?.length) tests.push(requirement.textAll.every((phrase) => hasPhrase(text, phrase)));
  if (requirement.textAny?.length) tests.push(requirement.textAny.some((phrase) => hasPhrase(text, phrase)));
  return tests.length > 0 && tests.every(Boolean);
}

export function productMatchesSemanticCollection(policy, product, knowledge, dynamicAssignments = new Set()) {
  if (!policy || policy.kind !== "semantic") return false;
  const match = policy.match || {};
  if (match.require && matchesRequiredSignals(match.require, product, knowledge)) return true;
  if (match.dynamic && dynamicAssignments.has(match.dynamic)) return true;

  const proposedTags = normalizeSet(knowledge?.proposedTags);
  if ((match.taxonomyTags || []).some((tag) => proposedTags.has(normalizeCatalogText(tag)))) return true;

  const targets = new Set(
    [...normalizeSet(knowledge?.collectionTargets)].map(canonicalCollectionHandle),
  );
  if ([policy.handle, ...policy.legacyHandles, ...(match.targets || [])]
    .map(canonicalCollectionHandle)
    .some((handle) => targets.has(handle))) return true;

  if ((match.departments || []).map(normalizeCatalogText).includes(normalizeCatalogText(knowledge?.departmentId))) return true;
  if ((match.categories || []).map(normalizeCatalogText).includes(normalizeCatalogText(knowledge?.categoryId))) return true;
  if ((match.subcategories || []).map(normalizeCatalogText).includes(normalizeCatalogText(knowledge?.subcategoryId))) return true;
  if ((match.rules || []).map(normalizeCatalogText).includes(normalizeCatalogText(knowledge?.classificationRule || knowledge?.ruleId))) return true;
  if ((match.audiences || []).map(normalizeCatalogText).includes(normalizeCatalogText(knowledge?.audience?.id))) {
    if (!(match.subcategories || []).length && !(match.categories || []).length) return true;
    const subcategoryMatch = (match.subcategories || []).map(normalizeCatalogText).includes(normalizeCatalogText(knowledge?.subcategoryId));
    const categoryMatch = (match.categories || []).map(normalizeCatalogText).includes(normalizeCatalogText(knowledge?.categoryId));
    if (subcategoryMatch || categoryMatch) return true;
  }

  const text = productText(product);
  const allMatches = (match.textAll || []).every((phrase) => hasPhrase(text, phrase));
  const anyMatches = !(match.textAny || []).length || (match.textAny || []).some((phrase) => hasPhrase(text, phrase));
  return Boolean((match.textAll || []).length || (match.textAny || []).length) && allMatches && anyMatches;
}

export function buildProductCollectionTags(product, knowledge, dynamicAssignments = new Set()) {
  return SEMANTIC_COLLECTION_POLICIES
    .filter((policy) => productMatchesSemanticCollection(policy, product, knowledge, dynamicAssignments))
    .map((policy) => policy.tag);
}

export function productMatchesPricePolicy(product, policy) {
  const variants = Array.isArray(product?.variants?.nodes)
    ? product.variants.nodes
    : Array.isArray(product?.variants)
      ? product.variants
      : [];
  return variants.some((variant) => {
    const price = Number(variant?.price);
    if (!Number.isFinite(price)) return false;
    if (Number.isFinite(policy?.maximumExclusive) && !(price < policy.maximumExclusive)) return false;
    if (Number.isFinite(policy?.minimumExclusive) && !(price > policy.minimumExclusive)) return false;
    return true;
  });
}

export function resolveCollectionPolicyByLiveHandle(handle) {
  const normalized = canonicalCollectionHandle(handle);
  return COLLECTION_GOVERNANCE_POLICIES.find((policy) =>
    policy.handle === normalized || policy.legacyHandles?.includes(normalized),
  ) || null;
}

export function assertCompleteCollectionGovernance(collections) {
  const unknown = (Array.isArray(collections) ? collections : [])
    .map((collection) => normalizeCollectionHandle(collection?.handle))
    .filter(Boolean)
    .filter((handle) => !resolveCollectionPolicyByLiveHandle(handle));
  if (unknown.length) {
    throw new Error(`Live collections missing checked-in governance: ${unknown.join(", ")}`);
  }
  return true;
}

export function buildPriceCollectionSource(policy) {
  const conditions = [];
  if (Number.isFinite(policy?.maximumExclusive)) {
    conditions.push({
      variantPrice: {
        relation: "LESS_THAN",
        value: { amount: String(policy.maximumExclusive), currencyCode: policy.currencyCode },
      },
    });
  }
  if (Number.isFinite(policy?.minimumExclusive)) {
    conditions.push({
      variantPrice: {
        relation: "GREATER_THAN",
        value: { amount: String(policy.minimumExclusive), currencyCode: policy.currencyCode },
      },
    });
  }
  return {
    title: `SALT price policy ${COLLECTION_GOVERNANCE_VERSION}`,
    description: `Controlled price collection for ${policy.title}.`,
    targetType: "PRODUCTS",
    inclusion: { matchType: "ALL", conditions },
  };
}

export function buildSemanticCollectionSource(policy) {
  const ruleTags = semanticCollectionRuleTags(policy);
  return {
    title: `SALT collection policy ${COLLECTION_GOVERNANCE_VERSION}`,
    description: `Controlled exact membership for ${policy.title}; source tag ${policy.tag}.`,
    targetType: "PRODUCTS",
    inclusion: {
      matchType: ruleTags.length > 1 ? "ANY" : "ALL",
      conditions: ruleTags.map((tag) => ({
        productTag: { relation: "TAGGED_WITH", values: [tag], matchType: "ANY" },
      })),
    },
  };
}
