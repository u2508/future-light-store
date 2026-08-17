import { CATALOG_TAXONOMY_VERSION } from "./catalog-taxonomy.js";
import { legacyCatalogTagToSimple } from "./catalog-simple-tags.js";

export const CATALOG_COLLECTION_PLAN_VERSION = `${CATALOG_TAXONOMY_VERSION}-collections.3`;
export const CATALOG_COLLECTION_SOURCE_TITLE = `SALT taxonomy ${CATALOG_TAXONOMY_VERSION}`;

function collection(handle, title, ruleTag, description, legacyHandles = []) {
  const canonicalRuleTag = legacyCatalogTagToSimple(ruleTag) || ruleTag;
  return Object.freeze({
    handle,
    title,
    ruleTag: canonicalRuleTag,
    description,
    legacyHandles: Object.freeze([...legacyHandles]),
  });
}

export const CATALOG_COLLECTION_PLAN = Object.freeze([
  collection("women", "Women", "salt:department:women", "Shop women's fashion, beauty, bags, wallets, and accessories."),
  collection("womens-fashion", "Women's Fashion", "salt:category:women-fashion", "Shop women's clothing, footwear, and everyday fashion essentials."),
  collection("womens-beauty-essentials", "Women's Beauty & Skincare", "salt:category:women-beauty-skincare", "Shop women's beauty, skincare, haircare, and personal care essentials."),
  collection("womens-accessories", "Women's Accessories", "salt:category:women-accessories", "Shop women's accessories, watches, jewelry, sunglasses, and style add-ons.", ["women-sunglases"]),
  collection("women-bags-and-wallets", "Women's Bags & Wallets", "salt:category:women-bags-wallets", "Shop women's bags, wallets, purses, organizers, and everyday carry accessories."),
  collection("men-collection", "Men", "salt:department:men", "Shop men's fashion, grooming, accessories, bags, and everyday essentials."),
  collection("mens-fashion", "Men's Fashion", "salt:category:men-fashion", "Shop men's shirts, pants, jeans, footwear, and casual fashion essentials."),
  collection("mens-bags-wallets", "Men's Bags & Wallets", "salt:category:men-bags-wallets", "Shop men's bags, wallets, briefcases, organizers, and travel carry accessories."),
  collection("mens-accessories", "Men's Accessories", "salt:category:men-accessories", "Shop men's watches, belts, hats, jewelry, sunglasses, and style accessories."),
  collection("hats", "Hats", "salt:category:hats", "Shop hats, caps, beanies, visors, bucket hats, and other headwear accessories."),
  collection("mens-beauty-skincare", "Men's Beauty & Skincare", "salt:category:men-beauty-skincare", "Shop men's grooming, skincare, haircare, fragrance, and personal care essentials."),
  collection("kids", "Kids", "salt:department:kids", "Shop kids' wear, toys, games, baby care, and children's accessories."),
  collection("kids-wear", "Kids Wear", "salt:category:kids-wear", "Shop clothing, footwear, and everyday wear for babies, kids, and teens."),
  collection("kids-toys-games", "Kids Toys & Games", "salt:category:kids-toys-games", "Shop toys, games, puzzles, educational play, and soft toys for kids."),
  collection("home-decor", "Home & Decor", "salt:department:home-decor", "Shop home decor, lighting, kitchen essentials, storage, cleaning, and household accessories."),
  collection("cookware", "Kitchen & Cookware", "salt:category:kitchen-cookware", "Shop cookware, kitchen tools, dining essentials, and food preparation accessories."),
  collection("smart-lighting", "Lighting & Decor", "salt:category:lighting-decor", "Shop lamps, smart lighting, wall lights, decorative lighting, and home accents."),
  collection("bedsheets-handlooms-towels", "Bedsheets, Handlooms & Towels", "salt:category:bedsheets-handlooms-towels", "Shop bedsheets, handlooms, towels, linens, and soft home textiles."),
  collection("car-accessories", "Home & Car Accessories", "salt:category:home-car-accessories", "Shop practical home, vehicle, travel, and everyday utility accessories."),
  collection("portable-gadgets", "Electronic Accessories", "salt:department:electronic-accessories", "Shop chargers, cables, portable gadgets, phone accessories, and everyday electronics.", ["electronic-accessories"]),
  collection("covers-cases", "Covers & Cases", "salt:category:covers-cases", "Shop protective covers, cases, shells, sleeves, and device protection accessories."),
  collection("mouse-keyboard", "Mouse & Keyboard", "salt:category:mouse-keyboard", "Shop wired and wireless mice, keyboards, keycaps, and computer input accessories."),
  collection("audio", "Audio & Earbuds", "salt:category:audio", "Shop earbuds, headphones, speakers, microphones, and personal audio accessories."),
  collection("office-school-supplies", "Office & School Supplies", "salt:category:office-school-supplies", "Shop stationery, writing supplies, planners, notebooks, school, and office essentials."),
  collection("travel-outdoor", "Camping & Travel Essentials", "salt:department:camping-travel", "Shop luggage, outdoor gear, camping essentials, organizers, and travel accessories."),
  collection("watches", "Watches", "salt:category:watches", "Shop fashion watches, smart watches, watch bands, and watch accessories.", ["women-watches"]),
  collection("fitness-equipment", "Sports & Fitness", "salt:category:fitness-equipment", "Shop fitness training, sports protection, recovery, and active lifestyle essentials."),
  collection("health-wellness", "Health & Wellness", "salt:category:health-wellness", "Shop wellness, mobility, posture, relaxation, self-care, and health-support accessories.", ["face-mask"]),
  collection("creator-essentials", "Creator Essentials", "salt:category:creator-essentials", "Shop creator tools for filming, streaming, podcasting, photography, and content production."),
  collection("anime-collectables", "Anime Collectables", "salt:category:anime-collectables", "Shop anime, manga, cosplay, character, and fan collectables."),
]);

export const CATALOG_COLLECTION_RULE_TAGS = Object.freeze(
  CATALOG_COLLECTION_PLAN.map((entry) => entry.ruleTag),
);

export function normalizeCollectionPlanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function normalizeCollectionPlanTag(value) {
  return normalizeCollectionPlanText(value).toLowerCase();
}

export function buildCollectionSource(entry) {
  if (!entry?.ruleTag || entry.ruleTag.includes(":")) {
    throw new Error("Collection rule must use a canonical simple tag.");
  }

  return {
    title: CATALOG_COLLECTION_SOURCE_TITLE,
    description: `Controlled SALT collection rule for ${entry.title}; source tag ${entry.ruleTag}.`,
    targetType: "PRODUCTS",
    inclusion: {
      matchType: "ALL",
      conditions: [
        {
          productTag: {
            relation: "TAGGED_WITH",
            values: [entry.ruleTag],
            matchType: "ANY",
          },
        },
      ],
    },
  };
}

export function collectionSourceMatches(entry, source) {
  const conditions = Array.isArray(source?.inclusion?.conditions) ? source.inclusion.conditions : [];
  const condition = conditions.length === 1 ? conditions[0] : null;
  const values = Array.isArray(condition?.values)
    ? condition.values.map(normalizeCollectionPlanTag).filter(Boolean).sort()
    : [];

  return Boolean(
    source?.__typename === "CollectionConditionsSource" &&
      source?.targetType === "PRODUCTS" &&
      source?.inclusion?.matchType === "ALL" &&
      condition?.__typename === "CollectionSourceInclusionConditionProductTag" &&
      condition?.relation === "TAGGED_WITH" &&
      condition?.matchType === "ANY" &&
      values.length === 1 &&
      values[0] === normalizeCollectionPlanTag(entry?.ruleTag),
  );
}
