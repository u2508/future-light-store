import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readProductCatalogPayload } from "./product-catalog-files.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const collectionProductsPath = path.join(projectRoot, "public/data/collection-products.json");
const outputPath = path.join(projectRoot, "public/data/home-collection-products.json");
const PRODUCT_LIMIT = 12;

const sectionConfigs = [
  {
    key: "everydayEssentials",
    title: "Everyday Essentials",
    handle: "everyday-essentials",
    sourceHandles: ["everyday-essentials", "dining-essentials", "outdoor-essentials"],
    maxPerCategory: 2,
    categories: [
      ["kitchen", ["kitchen tool", "utensil", "cookware", "bottle opener", "food storage"]],
      ["organization", ["organizer", "storage box", "storage basket", "drawer", "holder"]],
      ["cleaning", ["cleaning brush", "cleaner", "microfiber", "lint remover", "mop"]],
      ["lighting", ["night light", "table lamp", "portable lamp", "led light"]],
      ["hydration", ["water bottle", "tumbler", "travel mug", "thermos"]],
      ["home-care", ["sprayer", "garden tool", "pruning", "pet brush", "shoe rack"]],
    ],
    blocked: ["makeup", "cosmetic", "perfume", "beer", "lingerie", "underwear", "costume", "doll", "sex", "stationery", "pencil", "pen holder", "card holder", "phone case", "earbud", "camping", "kids"],
  },
  {
    key: "womensBeautyEssentials",
    title: "Women's Beauty Essentials",
    handle: "womens-beauty-essentials",
    sourceHandles: ["womens-beauty-essentials", "beauty-makeup-essentials", "eye-beauty-collection"],
    maxPerCategory: 3,
    categories: [
      ["skincare", ["skincare", "skin care", "serum", "moisturizer", "face cream", "facial"]],
      ["makeup", ["makeup", "cosmetic", "foundation", "concealer", "blush", "lipstick"]],
      ["eyes", ["eyelash", "eyebrow", "mascara", "eyeliner", "eyeshadow"]],
      ["tools", ["makeup brush", "beauty tool", "face roller", "manicure", "nail"]],
    ],
    blocked: ["baby", "doll", "toy", "pet", "kitchen", "toilet", "cleaner"],
  },
  {
    key: "portableGadgets",
    title: "Portable Gadgets",
    handle: "portable-gadgets",
    sourceHandles: ["portable-gadgets"],
    maxPerCategory: 3,
    categories: [
      ["audio", ["earbuds", "earphone", "headphone", "bluetooth speaker", "mini speaker"]],
      ["power", ["power bank", "powerbank", "charger", "charging cable", "wireless charging"]],
      ["stands", ["phone stand", "laptop stand", "tripod", "phone mount"]],
      ["wearables", ["smart watch", "smartwatch", "fitness tracker"]],
      ["accessories", ["usb hub", "electronic", "gadget", "portable light"]],
    ],
    blocked: ["bag", "tote", "burlap", "jute", "purse", "handbag", "dress", "shirt", "kitchen", "knife", "hot water bottle", "toy", "game", "funny", "fake poop", "beer", "bottle opener", "piano"],
  },
  {
    key: "travelOutdoor",
    title: "Travel & Outdoor",
    handle: "travel-outdoor",
    sourceHandles: ["travel-outdoor", "shopping-bags-jute-bags", "outdoor-essentials", "travel-organizers"],
    maxPerCategory: 3,
    categories: [
      ["camping", ["camping", "hiking", "outdoor cookware", "camping cookware", "picnic"]],
      ["organizers", ["travel organizer", "packing bag", "storage bag", "tool bag"]],
      ["carry", ["travel bag", "backpack", "duffel", "luggage"]],
      ["coolers", ["cooler bag", "insulated", "thermal lunch", "lunch bag"]],
      ["gear", ["lantern", "water bottle", "foldable stool", "waterproof", "portable outdoor"]],
    ],
    blocked: ["makeup", "cosmetic", "baby", "diaper", "kid", "fitness accessory", "gym", "handbag", "purse", "jute", "burlap"],
  },
];

function normalizeText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildProductCard(product) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const pricedVariants = variants
    .map((variant) => ({
      price: Number(variant?.price),
      compareAtPrice: Number(variant?.compare_at_price),
    }))
    .filter((variant) => Number.isFinite(variant.price) && variant.price > 0)
    .sort((left, right) => left.price - right.price);
  const cheapest = pricedVariants[0];
  const image = String(product?.image?.src || product?.images?.[0]?.src || "").trim();
  const id = Number(product?.id || 0);
  const title = String(product?.title || "").replace(/\s+/g, " ").trim();
  const handle = String(product?.handle || "").trim();

  if (!id || !title || !handle || !image || !cheapest) {
    return null;
  }

  return {
    id,
    title,
    handle,
    image,
    price: cheapest.price,
    compareAtPrice:
      Number.isFinite(cheapest.compareAtPrice) && cheapest.compareAtPrice > cheapest.price
        ? cheapest.compareAtPrice
        : null,
  };
}

function selectProducts(products, collectionMap, config) {
  const collectionIds = new Set(
    config.sourceHandles.flatMap((handle) => collectionMap[handle]?.productIds || []),
  );
  const candidates = products
    .map((product) => {
      const card = buildProductCard(product);
      if (!card) return null;

      const tags = Array.isArray(product.tags) ? product.tags.join(" ") : product.tags || "";
      const search = normalizeText(`${product.title} ${product.handle} ${product.product_type || ""} ${tags}`);
      if (config.blocked.some((term) => search.includes(normalizeText(term)))) return null;

      const categoryMatches = config.categories
        .map(([category, terms]) => ({
          category,
          matches: terms.filter((term) => search.includes(normalizeText(term))).length,
        }))
        .filter((entry) => entry.matches > 0);
      if (!categoryMatches.length) return null;

      const keywordScore = categoryMatches.reduce((total, entry) => total + entry.matches * 3, 0);
      return {
        card,
        category: categoryMatches.sort((left, right) => right.matches - left.matches)[0].category,
        score: keywordScore + (collectionIds.has(card.id) ? 2 : 0),
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || left.card.price - right.card.price);

  const selected = [];
  const seenIds = new Set();
  const seenTitles = new Set();
  const categoryCounts = new Map();
  const add = (candidate, enforceDiversity) => {
    const titleKey = normalizeText(candidate.card.title);
    if (
      selected.length >= PRODUCT_LIMIT ||
      seenIds.has(candidate.card.id) ||
      seenTitles.has(titleKey) ||
      (enforceDiversity && (categoryCounts.get(candidate.category) || 0) >= config.maxPerCategory)
    ) return;

    selected.push(candidate.card);
    seenIds.add(candidate.card.id);
    seenTitles.add(titleKey);
    categoryCounts.set(candidate.category, (categoryCounts.get(candidate.category) || 0) + 1);
  };

  candidates.forEach((candidate) => add(candidate, true));
  candidates.forEach((candidate) => add(candidate, false));
  return selected;
}

const [productsPayload, collectionProductsPayload] = await Promise.all([
  readProductCatalogPayload(path.join(projectRoot, "public/data")),
  readFile(collectionProductsPath, "utf8").then(JSON.parse),
]);
const products = Array.isArray(productsPayload?.products) ? productsPayload.products : [];
const collectionMap = collectionProductsPayload?.collections || {};
const sections = Object.fromEntries(
  sectionConfigs.map((config) => [
    config.key,
    {
      title: config.title,
      handle: config.handle,
      products: selectProducts(products, collectionMap, config),
    },
  ]),
);

const payload = {
  generatedAt: productsPayload?.generatedAt || new Date().toISOString(),
  source: productsPayload?.source || "/data/products.json",
  sections,
};

await writeFile(outputPath, `${JSON.stringify(payload)}\n`, "utf8");
console.log(
  `Wrote ${Object.values(sections).reduce((total, section) => total + section.products.length, 0)} homepage collection products to ${outputPath}`,
);
