import { CATALOG_COLLECTION_PLAN } from "./catalog-collection-plan.js";
import { normalizeCatalogText } from "./catalog-taxonomy.js";

export const COLLECTION_GOVERNANCE_VERSION = "2026-09-10.1";
export const COLLECTION_TAG_PREFIX = "salt:collection:";
// Shopify collections created by tests or an app are never implicitly
// reconciled. Keep this explicit, narrow read-only exception so an unrelated
// collection cannot silently become a release target.
export const DEFAULT_READ_ONLY_LIVE_COLLECTION_HANDLES = Object.freeze(["test"]);

// These collections were merged into their canonical targets. Keep the map so
// legacy product tags and navigation references resolve without recreating the
// retired collections.
export const RETIRED_COLLECTION_HANDLE_MAP = Object.freeze({
  "caregiver-essentials": "health-wellness",
  "face-mask": "health-wellness",
  "mobility-support": "health-wellness",
  "posture-support": "health-wellness",
  "camping-gear": "travel-outdoor",
  "electronic-accessories": "portable-gadgets",
  "holiday-gifts": "gifts",
  "viral-tiktok-products": "trending-finds",
  "artificial-aquarium-decor-plants": "artificial-plants",
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

// These guards are deliberately collection-level rather than supplier-tag
// rules. They protect smart collections when an old managed tag or a stale
// generated target survives on Shopify after the product taxonomy has been
// corrected. Direct title/handle/product-type evidence remains authoritative.
const NON_SHIRT_APPAREL_EXCLUSIONS = Object.freeze([
  "watch", "watches", "wristwatch", "wristwatches", "wrist watch", "smart watch", "smartwatch", "automatic watch", "quartz watch",
  "mechanical watch", "sports watch", "watch for men", "mens watch", "men watch", "watch clock", "clock", "clocks",
  "hat", "hats", "cap", "caps", "beanie", "visor", "bucket hat", "baseball cap",
  "pajama", "pajamas", "robe", "bathrobe", "nightgown", "sleepwear", "underwear",
  "trouser", "trousers", "pants", "wallet", "handbag", "purse", "backpack", "crossbody bag",
  "sneaker", "sneakers", "shoes", "wig",
]);

const NON_TSHIRT_COLLECTION_EXCLUSIONS = Object.freeze([
  ...NON_SHIRT_APPAREL_EXCLUSIONS,
  "skirt", "skirts", "skirt set", "two piece skirt", "dress", "dresses", "gown", "gowns",
]);

const GARDEN_CONTEXT_TERMS = Object.freeze([
  "garden", "gardening", "lawn", "plant", "bonsai", "succulent", "soil", "watering", "pruning",
  "weeding", "grafting",
]);

const GARDEN_TOOL_TERMS = Object.freeze([
  "tool", "tools", "rake", "hoe", "trowel", "shovel", "shears", "secateur", "soil ph", "soil moisture",
  "meter", "tester", "nozzle", "hose", "watering can", "plant stake", "plant support", "garden knife",
  "knee protection", "playhouse", "garden toys", "sand snow",
]);

const HOME_SAFETY_FALSE_POSITIVE_TERMS = Object.freeze([
  "mouse", "computer mouse", "wireless mouse", "gaming mouse", "keyboard", "laptop", "computer accessory",
  "usb hub", "beer bottle opener", "bottle opener", "beer opener", "wine opener", "corkscrew", "can opener",
]);

const HATS_FALSE_POSITIVE_TERMS = Object.freeze([
  "beer bottle opener", "bottle opener", "beer opener", "wine opener", "corkscrew", "can opener", "bar tool",
]);

const HAT_POSITIVE_TERMS = Object.freeze([
  "hat", "hats", "cap", "caps", "beanie", "visor", "headwear", "fedora", "cowboy hat", "bucket hat",
  "baseball cap", "sun hat", "bonnet", "beret", "head scarf",
]);

const HUMAN_FOOTWEAR_SUBCATEGORIES = Object.freeze([
  "footwear", "kids-footwear", "water-shoes",
]);

const HUMAN_FOOTWEAR_DEPARTMENTS = Object.freeze([
  "men", "women", "kids", "general",
]);

const HUMAN_FOOTWEAR_TERMS = Object.freeze([
  "shoe", "shoes", "sneaker", "sneakers", "boot", "boots", "sandal", "sandals",
  "slipper", "slippers", "loafer", "loafers", "moccasin", "moccasins", "footwear",
  "cleat", "cleats", "flat shoes", "heel", "heels", "pump shoes", "pumps", "clogs",
  "trainers", "espadrilles", "mary jane",
]);

const FOOTWEAR_FALSE_POSITIVE_TERMS = Object.freeze([
  "shoe compartment", "shoe storage", "shoe rack", "shoe organizer", "shoe organiser",
  "shoe bag", "shoe cover", "shoe charm", "shoe charms", "sneaker charm", "sneaker charms",
  "insole", "insoles", "shoe insert", "shoe inserts", "shoe polish", "shoe brush", "shoe horn",
  "cold shoe", "phone rig", "mobile phone", "bottle sleeve", "stanley", "hydroflask", "tumbler",
  "trousers", "pants", "shirt", "jeans", "skirt", "hair clip", "handbag", "backpack",
  "organizer", "organiser", "storage box", "car trunk", "pet", "pets", "dog", "dogs", "puppy", "puppies",
  "cat", "cats", "kitten", "kittens",
]);

const FORMAL_FOOTWEAR_TERMS = Object.freeze([
  "formal", "dress shoe", "dress shoes", "business shoe", "business shoes", "office shoe",
  "office shoes", "oxford", "oxfords", "loafer", "loafers", "derby shoe", "derby shoes",
  "moccasin", "moccasins", "wedding shoe", "wedding shoes", "uniform shoe", "uniform shoes",
  "court shoe", "court shoes", "pump shoes", "pumps",
]);

const SCHOOL_BAG_SUBCATEGORIES = Object.freeze([
  "backpacks", "school-shoulder-bags", "school-bags",
]);

const SCHOOL_CONTEXT_TERMS = Object.freeze([
  "school", "student", "students", "daycare", "kindergarten", "preschool", "classroom", "schoolbag",
  "back to school", "college", "campus",
]);

const BACK_TO_SCHOOL_ITEM_TERMS = Object.freeze([
  "school bag", "schoolbag", "school backpack", "student backpack", "book bag", "backpack", "lunch box",
  "lunchbox", "bento box", "tiffin", "water bottle", "school bottle", "stationery", "school supplies",
  "pencil case", "pencil", "pen", "notebook", "planner", "binder", "folder", "crayon", "marker",
  "school uniform", "school shoes", "backdrop",
]);

const SCHOOL_BAG_ITEM_TERMS = Object.freeze([
  "school bag", "schoolbag", "school backpack", "student backpack", "book bag", "school shoulder bag",
  "school rucksack", "student bag", "satchel",
]);

const SCHOOL_BAG_FALSE_POSITIVE_TERMS = Object.freeze([
  "school bag cover", "school backpack cover", "backpack cover", "backpack rain cover",
  "bag pendant", "backpack pendant", "bag ornament", "backpack ornament", "bag keyring", "bag keychain",
  "backpack keyring", "backpack keychain", "bag trinket", "bag charm", "backpack charm", "name tag",
]);

const LUNCH_BOX_TERMS = Object.freeze([
  "lunch box", "lunchbox", "bento box", "bento", "tiffin", "lunch container", "meal prep container",
]);

const LUNCH_BOX_FALSE_POSITIVE_TERMS = Object.freeze([
  "lunch bag", "lunch bags", "lunch box bag", "lunchbox bag", "lunch tote", "lunch pouch",
  "insulated lunch bag", "bento bag", "meal prep bag", "lunch box note", "lunch box notes", "lunchbox note", "lunchbox notes", "name sticker", "name stickers", "label",
  "labels", "sticker", "stickers", "replacement lunch box", "replacement lunchbox", "lunch box cover", "lunchbox cover", "lunch box case", "lunchbox case",
]);

const WATER_BOTTLE_TERMS = Object.freeze([
  "water bottle", "water bottles", "thermal water bottle", "thermal bottle", "thermos", "vacuum flask",
  "tumbler", "drink bottle", "drinking bottle", "sports bottle", "straw water bottle", "hydration bottle",
  "school bottle", "canteen bottle", "reusable bottle", "flask",
]);

const WATER_BOTTLE_FALSE_POSITIVE_TERMS = Object.freeze([
  "hot water bottle", "water bottle cap", "water bottle caps", "water bottle lid", "water bottle lids",
  "water bottle cover", "water bottle holder", "water bottle sleeve", "water bottle bag", "water bottle brush",
  "water bottle replacement", "bottle cap", "bottle lid", "bottle opener", "pet water bottle", "dog water bottle",
  "cat water bottle", "pet feeder bottle", "pill box", "water bottle toy", "squeeze toy", "perfume bottle",
  "baby bottle", "feeding bottle", "spray bottle", "shampoo bottle",
]);

const BACK_TO_SCHOOL_FALSE_POSITIVE_TERMS = Object.freeze([
  "water bottle cap", "water bottle caps", "water bottle lid", "water bottle lids", "water bottle cover",
  "water bottle holder", "water bottle sleeve", "water bottle brush", "water bottle replacement", "bottle cap",
  "bottle lid", "lunch box note", "lunch box notes", "lunchbox note", "lunchbox notes", "lunch bag", "lunch bags",
  "lunch box bag", "lunchbox bag", "lunch tote", "lunch pouch", "school bag cover", "school backpack cover",
  "backpack cover", "backpack rain cover", "bag pendant", "backpack pendant", "bag ornament", "backpack ornament",
  "bag keyring", "bag keychain", "backpack keyring", "backpack keychain", "bag trinket", "name tag",
]);

const STATIONERY_SUBCATEGORIES = Object.freeze([
  "pen-pencil-cases", "stickers-labels", "binders-folders", "id-badge-holders", "labels-stickers",
  "writing-supplies", "notebooks-planners", "school-supplies", "science-lab-supplies", "music-learning-supplies",
  "calendars", "paper-cutting-tools", "reading-accessories",
]);

const STATIONERY_FALSE_POSITIVE_TERMS = Object.freeze([
  ...WATER_BOTTLE_TERMS,
  "water botlte", "water botle", "water botttle", "waterbottle",
  ...SCHOOL_BAG_ITEM_TERMS,
]);

// Do not let animal products enter human-facing semantic collections even if
// an old category or target says otherwise. Standalone `cat` is intentionally
// absent because `cat-eye` is a valid cosmetics phrase.
const PET_PRODUCT_TEXT_TERMS = Object.freeze([
  "pet", "pets", "dog", "dogs", "puppy", "puppies", "canine", "feline", "kitten", "kittens",
  "cat supplies", "cat toy", "cat toys", "cat food", "cat collar", "cat litter", "cat grooming", "cat brush",
  "cat bed", "cat tree", "cat carrier", "cat feeder", "cat bowl", "cat nail", "dog supplies", "dog toy",
  "dog toys", "dog food", "dog collar", "dog leash", "dog grooming", "dog shampoo", "dog brush", "dog bed",
  "dog carrier", "dog feeder", "dog bowl", "dog nail", "pet supplies", "pet toy", "pet toys", "pet food",
  "pet collar", "pet litter", "pet grooming", "pet brush", "pet bed", "pet carrier", "pet feeder", "pet bowl",
  "pet safety", "pet mobility", "pet medical", "pet feeding", "pet travel", "pet harness", "pet shampoo", "pet nail",
]);

const HUMAN_ONLY_COLLECTION_HANDLES = new Set([
  "artificial-plants", "back-to-school", "beauty-makeup-essentials", "blush-glow", "bracelets", "candles",
  "decorative-accessories", "daily-living-aids", "dramatic-lashes", "earrings", "everyday-jewelry",
  "eye-beauty-collection", "face-creams-moisturizers", "footwear", "formal-footwear", "garden-tools",
  "gifts-for-seniors", "glam-eye-palettes", "hair-nourishment", "hair-wash-essentials", "housewarming-gifts",
  "jewelry-accessories", "kids-footwear", "lips-and-care", "lunch-boxes", "luxury-fragrances", "massage-tools",
  "medical-accessories", "mens-accessories", "mens-fashion", "mens-beauty-skincare", "mens-bags-wallets",
  "men-collection", "mens-footwear", "necklaces", "repair-shine-serums", "relaxation-products", "rings",
  "school-bags", "seasonal-decor", "sleep-essentials", "stationery", "water-bottles", "wigs",
  "womens-accessories", "womens-fashion", "womens-beauty-essentials", "womens-footwear", "women-bags-and-wallets", "women",
]);

const AUDIENCE_SCOPED_COLLECTIONS = Object.freeze({
  women: new Set(["women", "womens-fashion", "womens-beauty-essentials", "womens-accessories", "women-bags-and-wallets"]),
  men: new Set(["men-collection", "mens-fashion", "mens-beauty-skincare", "mens-accessories", "mens-bags-wallets"]),
  kids: new Set(["kids", "kids-wear"]),
});

const GIFT_INTENT_TERMS = Object.freeze([
  "gift", "gifts", "present", "presents", "gift set", "gift box", "gift idea", "gift ideas", "birthday",
  "christmas", "holiday", "fathers day", "father s day", "mothers day", "mother s day",
]);

const GIFT_RECIPIENT_TERMS = Object.freeze({
  dad: Object.freeze(["dad", "daddy", "father", "fathers day", "father s day", "husband", "grandpa", "grandfather", "for him", "gift for men", "mens gift", "men gift"]),
  mom: Object.freeze(["mom", "mommy", "mother", "mothers day", "mother s day", "wife", "grandma", "grandmother", "for her", "gift for women", "womens gift", "women gift"]),
});

const DAILY_LIVING_AID_TERMS = Object.freeze([
  "daily living", "daily-living", "elderly", "senior care", "caregiver", "assistive", "adaptive", "mobility aid",
  "pill organizer", "pill box", "medicine organizer", "medication organizer", "reacher grabber", "dressing aid",
  "bed rail", "shower chair", "grab bar", "safety rail", "walker", "walking cane", "wheelchair accessory",
  "hearing aid accessory", "vision aid",
]);

const SENIOR_LIVING_TERMS = Object.freeze([
  "senior", "elderly", "senior care", "caregiver", "assisted living", "nursing home", "retirement", "daily living",
  "mobility aid", "pill organizer", "medicine organizer", "adaptive", "assistive",
]);

const CANDLE_TERMS = Object.freeze([
  "candle", "candles", "scented candle", "soy candle", "wax melt", "tealight", "tea light", "votive",
  "pillar candle", "taper candle", "led candle", "flameless candle", "candle holder", "candlelight",
]);

const EXTRA_SEMANTIC_SPECS = [
  spec("classification-review", "Classification Review", { dynamic: "classification-review" }),
  spec("classification-fallback", "Classification Fallback", { dynamic: "classification-fallback" }),
  spec("best-sellers", "Best Sellers", { dynamic: "best-sellers" }, ["appplaza-best-sellers"]),
  spec("artificial-plants", "Artificial Plants", {
    require: {
      textAny: [
        "artificial aquarium plant", "aquarium decor plant", "aquatic plant", "artificial plant",
        "artificial bonsai", "artificial ivy", "artificial vine", "fake plant", "fake potted plant",
        "artificial flower", "artificial orchid", "artificial succulent", "artificial grass",
      ],
    },
    exclude: { textAny: ["string light", "string lights", "vine light", "vine lights", "lamp", "lighting", "grass mat", "turf"] },
  }, ["artificial-aquarium-decor-plants"]),
  spec("mens-footwear", "Men's Footwear", {
    require: {
      departments: ["men"],
      subcategories: HUMAN_FOOTWEAR_SUBCATEGORIES,
      textAny: HUMAN_FOOTWEAR_TERMS,
    },
    exclude: { textAny: FOOTWEAR_FALSE_POSITIVE_TERMS },
  }),
  spec("formal-footwear", "Formal Footwear", {
    require: {
      departments: HUMAN_FOOTWEAR_DEPARTMENTS,
      subcategories: HUMAN_FOOTWEAR_SUBCATEGORIES,
      textAnyGroups: [HUMAN_FOOTWEAR_TERMS, FORMAL_FOOTWEAR_TERMS],
    },
    exclude: { departments: ["pets"], textAny: FOOTWEAR_FALSE_POSITIVE_TERMS },
  }),
  spec("womens-footwear", "Women's Footwear", {
    require: {
      departments: ["women"],
      subcategories: HUMAN_FOOTWEAR_SUBCATEGORIES,
      textAny: HUMAN_FOOTWEAR_TERMS,
    },
    exclude: { textAny: FOOTWEAR_FALSE_POSITIVE_TERMS },
  }),
  spec("kids-footwear", "Kids Footwear", {
    require: {
      departments: ["kids"],
      subcategories: HUMAN_FOOTWEAR_SUBCATEGORIES,
      textAny: HUMAN_FOOTWEAR_TERMS,
    },
    exclude: { textAny: FOOTWEAR_FALSE_POSITIVE_TERMS },
  }),
  spec("back-to-school", "Back to School", {
    require: { textAnyGroups: [SCHOOL_CONTEXT_TERMS, BACK_TO_SCHOOL_ITEM_TERMS] },
    textAnyGroups: [SCHOOL_CONTEXT_TERMS, BACK_TO_SCHOOL_ITEM_TERMS],
    targets: ["back-to-school"],
    exclude: { textAny: BACK_TO_SCHOOL_FALSE_POSITIVE_TERMS },
  }),
  spec("beauty-makeup-essentials", "Beauty Makeup Essentials", {
    subcategories: ["eye-makeup", "face-makeup", "lip-care-makeup", "makeup-tools", "beauty-tools"],
    targets: ["beauty-makeup-essentials"],
    exclude: { departments: ["pets"], textAny: PET_PRODUCT_TEXT_TERMS },
  }),
  spec("blush-glow", "Blush & Glow", { textAny: ["blush", "cheek tint", "highlighter", "illuminator"], targets: ["blush-glow"] }),
  spec("senior-living-solutions", "Senior Living Solutions", {
    dynamic: "senior-living",
    textAny: SENIOR_LIVING_TERMS,
    exclude: { textAny: ["senior prom", "senior costume", "senior fashion"] },
  }, ["books"]),
  spec("camping-gear", "Camping Gear", { categories: ["camping-essentials"], targets: ["camping-gear"] }),
  spec("candles", "Candles", {
    require: { textAny: CANDLE_TERMS },
    subcategories: ["candles-home-fragrance"],
    targets: ["candles"],
    textAny: CANDLE_TERMS,
  }),
  spec("car-accessories", "Home & Car Accessories", { departments: ["automotive"], categories: ["home-car-accessories"], targets: ["car-accessories"] }),
  spec("caregiver-essentials", "Caregiver Essentials", { dynamic: "caregiver", textAny: ["caregiver", "patient aid", "daily living aid", "medicine organizer"] }),
  spec("cat-supplies", "Cat Supplies", {
    require: { departments: ["pets"], subcategories: ["cat-supplies"], textAny: ["cat", "kitten"] },
    exclude: { textAny: ["false eyelash", "false eyelashes", "cat eye lashes", "cat eye lash", "cat paw lash", "cat claw glove", "cat claw gloves", "cat paw glove", "cat paw gloves", "mittens"] },
  }),
  spec("cleaning-tools", "Cleaning Tools", { subcategories: ["cleaning-tools"], targets: ["cleaning-tools"] }),
  spec("coffee-tea-accessories", "Coffee & Tea Accessories", { subcategories: ["coffee-tea-accessories"], textAny: ["coffee", "tea infuser", "tea set", "teapot"] }),
  spec("daily-living-aids", "Daily Living Aids", {
    require: { textAny: DAILY_LIVING_AID_TERMS },
    subcategories: ["medicine-organizers", "mobility-support", "vision-care"],
    targets: ["daily-living-aids"],
    textAny: DAILY_LIVING_AID_TERMS,
  }),
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
  spec("gifts-for-dad", "Gifts for Dad", { textAnyGroups: [GIFT_INTENT_TERMS, GIFT_RECIPIENT_TERMS.dad] }),
  spec("gifts-for-mom", "Gifts for Mom", { textAnyGroups: [GIFT_INTENT_TERMS, GIFT_RECIPIENT_TERMS.mom] }),
  spec("gifts-for-seniors", "Gifts for Seniors", { dynamic: "gifts-for-seniors" }),
  spec("glam-eye-palettes", "Glam Eye Palettes", { textAny: ["eyeshadow palette", "eye shadow palette", "makeup palette"] }),
  spec("hair-nourishment", "Hair Nourishment", { subcategories: ["hair-care"], textAny: ["hair oil", "hair mask", "hair nourishment", "hair treatment"], targets: ["hair-nourishment"] }),
  spec("hair-wash-essentials", "Hair Wash Essentials", { textAny: ["shampoo", "conditioner", "hair wash", "scalp cleanser"] }),
  spec("holiday-gifts", "Holiday Gifts", { dynamic: "holiday-gifts", textAny: ["christmas gift", "holiday gift", "festive gift"] }),
  spec("home-safety", "Home Safety", {
    require: { textAny: ["home safety", "anti slip", "grab bar", "safety rail", "door alarm"] },
    textAny: ["home safety", "anti slip", "grab bar", "safety rail", "door alarm"],
    exclude: { textAny: HOME_SAFETY_FALSE_POSITIVE_TERMS },
  }),
  spec("housewarming-gifts", "Housewarming Gifts", { dynamic: "housewarming-gifts", textAny: ["housewarming gift", "new home gift"] }),
  spec("iphone-cases", "iPhone Cases", { require: { rules: ["phone-case"], textAny: ["iphone"] } }),
  spec("jeans", "Jeans", { subcategories: ["jeans"], rules: ["jeans"] }),
  spec("jewelry-accessories", "Jewelry & Accessories", { departments: ["jewelry"] }),
  spec("rings", "Rings", {
    require: { departments: ["jewelry"], subcategories: ["rings"] },
    subcategories: ["rings"],
    targets: ["rings"],
  }),
  spec("necklaces", "Necklaces", {
    require: { departments: ["jewelry"], subcategories: ["necklaces-pendants"] },
    subcategories: ["necklaces-pendants"],
    targets: ["necklaces"],
  }),
  spec("bracelets", "Bracelets", {
    require: { departments: ["jewelry"], subcategories: ["bracelets"] },
    subcategories: ["bracelets"],
    targets: ["bracelets"],
  }),
  spec("earrings", "Earrings", {
    require: { departments: ["jewelry"], subcategories: ["earrings"] },
    subcategories: ["earrings"],
    targets: ["earrings"],
  }),
  spec("everyday-jewelry", "Everyday Jewelry", {
    require: { departments: ["jewelry"] },
    departments: ["jewelry"],
    targets: ["everyday-jewelry"],
  }),
  spec("kitchen-gadgets", "Kitchen Gadgets", { subcategories: ["kitchen-gadgets"], targets: ["kitchen-gadgets"] }),
  spec("lips-and-care", "Lip Care", { subcategories: ["lip-care-makeup"], targets: ["lips-and-care"] }),
  spec("luxury-fragrances", "Luxury Fragrances", { subcategories: ["fragrance"], textAny: ["perfume", "fragrance", "cologne", "eau de parfum", "eau de toilette"] }),
  spec("magsafe-gadgets", "MagSafe Gadgets", { textAny: ["magsafe", "mag safe"] }),
  spec("mascara-collection", "Mascara Collection", { textAny: ["mascara"] }),
  spec("massage-tools", "Massage Tools", { subcategories: ["massage-recovery"], targets: ["massage-tools"] }),
  spec("medical-accessories", "Medical Accessories", { subcategories: ["medical-accessories", "medicine-organizers", "vision-care"], textAny: ["medical", "pill box", "pill cutter", "medicine organizer"] }),
  spec("memory-organization", "Memory & Organization", { dynamic: "memory-organization", textAny: ["memory", "reminder", "planner", "goal setting"] }),
  spec("men-t-shirt", "Men's T-Shirts", {
    require: { subcategories: ["t-shirts"], audiences: ["men"] },
    exclude: { textAny: NON_TSHIRT_COLLECTION_EXCLUSIONS },
  }),
  spec("mobility-support", "Mobility Support", { subcategories: ["mobility-support"], targets: ["mobility-support"] }),
  spec("new-arrivals", "New Arrivals", { dynamic: "new-arrivals" }),
  spec("pet-essentials", "Pet Essentials", { departments: ["pets"], targets: ["pet-assocerries"] }, ["pet-assocerries"]),
  spec("pet-feeding", "Pet Feeding", {
    require: { departments: ["pets"], textAny: ["feeding", "feeder", "bowl", "food", "fountain", "water bottle", "water dispenser", "food mat", "food dispenser"] },
    subcategories: ["pet-feeding-accessories"],
  }),
  spec("pet-grooming", "Pet Grooming", {
    require: { departments: ["pets"], textAny: ["grooming", "groomer", "brush", "comb", "nail", "clipper", "trimmer", "shampoo", "conditioner", "detangler", "bathing"] },
  }),
  spec("pet-toys", "Pet Toys", { textAll: ["pet"], textAny: ["toy", "ball", "chew"] }),
  spec("pet-travel", "Pet Travel", {
    require: { departments: ["pets"], textAny: ["travel", "carrier", "trolley", "car seat", "stroller", "harness", "leash", "lead", "pet backpack"] },
    exclude: { textAny: ["lint", "hair remover", "fabric", "sofa", "clothes cleaning", "pet waste bag", "poop bag"] },
  }),
  spec("school-bags", "School Bags", {
    require: {
      subcategories: SCHOOL_BAG_SUBCATEGORIES,
      textAnyGroups: [SCHOOL_CONTEXT_TERMS, SCHOOL_BAG_ITEM_TERMS],
    },
    subcategories: SCHOOL_BAG_SUBCATEGORIES,
    targets: ["school-bags"],
    exclude: { textAny: SCHOOL_BAG_FALSE_POSITIVE_TERMS },
  }),
  spec("lunch-boxes", "Lunch Boxes", {
    require: { textAny: LUNCH_BOX_TERMS },
    textAny: LUNCH_BOX_TERMS,
    targets: ["lunch-boxes"],
    exclude: { textAny: LUNCH_BOX_FALSE_POSITIVE_TERMS },
  }),
  spec("water-bottles", "Water Bottles", {
    require: { textAny: WATER_BOTTLE_TERMS },
    textAny: WATER_BOTTLE_TERMS,
    targets: ["water-bottles"],
    exclude: { textAny: WATER_BOTTLE_FALSE_POSITIVE_TERMS },
  }),
  spec("posture-support", "Posture Support", { textAny: ["posture", "back brace", "posture corrector"], targets: ["posture-support"] }),
  spec("relaxation-products", "Relaxation Products", { subcategories: ["sleep-relaxation", "aromatherapy-essential-oils"], targets: ["relaxation-products"] }),
  spec("repair-shine-serums", "Repair & Shine Serums", {
    require: { subcategories: ["hair-care"], textAny: ["serum", "hair oil", "hair treatment", "hair mask", "scalp", "split end", "split ends", "frizz", "shine", "gloss"] },
  }),
  spec("robe", "Robes", { subcategories: ["robes-sleepwear"], rules: ["robes-sleepwear"] }),
  spec("seasonal-decor", "Seasonal Decor", {
    require: {
      textAnyGroups: [
        ["christmas", "xmas", "halloween", "holiday", "seasonal", "advent", "thanksgiving", "valentine", "easter", "new year", "festive", "winter", "party", "birthday", "mothers day", "father s day"],
        ["decor", "decoration", "ornament", "garland", "wreath", "tree", "light", "lights", "banner", "flag", "tabletop", "centerpiece", "wall hanging", "party backdrop", "hanging", "figurine", "door hanging"],
      ],
    },
    exclude: { textAny: ["calendar", "planner", "lip gloss", "lipstick", "wig", "shirt", "jeans", "watch", "jewelry", "jewellery", "handbag", "backpack", "pajama", "pajamas"] },
  }),
  spec("sleep-essentials", "Sleep Essentials", { subcategories: ["sleep-relaxation"], rules: ["sleep-support-pillows"], targets: ["sleep-essentials"] }),
  spec("staff-picks", "Staff Picks", { dynamic: "staff-picks" }),
  spec("stationery", "Stationery", {
    require: { departments: ["office-school"], subcategories: STATIONERY_SUBCATEGORIES },
    subcategories: STATIONERY_SUBCATEGORIES,
    targets: ["stationery"],
    exclude: { textAny: STATIONERY_FALSE_POSITIVE_TERMS },
  }),
  spec("storage-organization", "Storage & Organization", { subcategories: ["storage-organization", "food-storage-containers", "kitchen-storage"], targets: ["storage-organization"] }),
  spec("t-shirt", "T-Shirts", {
    subcategories: ["t-shirts"],
    rules: ["t-shirts", "mens-graphic-tshirts"],
    exclude: { textAny: NON_TSHIRT_COLLECTION_EXCLUSIONS },
  }),
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
      : entry.handle === "home-decor"
        ? {
            taxonomyTags: [entry.ruleTag],
            exclude: {
              subcategories: ["garden-tools", "gardening-tools", "tools-hardware", "home-repair-tools"],
              rules: ["garden-tools", "tools-hardware", "home-repair-tools"],
              textAny: [
                "pruning", "pruning shears", "pruning tool", "garden trowel", "garden shovel", "hand shovel",
                "garden hoe", "weeding", "garden rake", "weeding rake", "weeding hoe", "grafting",
                "grafting tool", "grafting shears", "shears", "secateur", "gardening tool", "garden tool",
              ],
            },
          }
        : entry.handle === "hats"
          ? {
              require: { textAny: HAT_POSITIVE_TERMS },
              taxonomyTags: [entry.ruleTag],
              targets: [entry.handle, ...entry.legacyHandles],
              exclude: { textAny: HATS_FALSE_POSITIVE_TERMS },
            }
        : entry.handle === "footwear"
          ? {
              require: {
                departments: HUMAN_FOOTWEAR_DEPARTMENTS,
                subcategories: HUMAN_FOOTWEAR_SUBCATEGORIES,
                textAny: HUMAN_FOOTWEAR_TERMS,
              },
              subcategories: HUMAN_FOOTWEAR_SUBCATEGORIES,
              targets: [entry.handle, ...entry.legacyHandles],
              exclude: { departments: ["pets"], textAny: FOOTWEAR_FALSE_POSITIVE_TERMS },
            }
        : entry.handle === "mens-fashion" || entry.handle === "womens-fashion"
          ? {
              taxonomyTags: [entry.ruleTag],
              exclude: { textAny: NON_SHIRT_APPAREL_EXCLUSIONS },
            }
        : entry.handle === "kids-wear"
          ? {
              require: {
                departments: ["kids"],
                audiences: ["kids", "baby"],
                subcategories: [
                  "kids-clothing", "baby-rompers", "kids-sleepwear", "kids-footwear", "footwear", "socks",
                  "water-shoes", "costumes", "t-shirts", "trousers-pants", "hoodies-sweaters", "jumpsuits-rompers",
                  "lingerie-underwear", "robes-sleepwear", "baby-crawling-accessories",
                ],
              },
              exclude: { textAny: ["watch", "watches", "wig", "hair clip", "hair clips", "headband", "headbands", "hair accessory", "hair accessories", "jewelry", "jewellery", "ring", "rings", "necklace", "bracelet"] },
            }
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
  return SEMANTIC_COLLECTION_POLICIES.some((policy) => [
    policy.tag,
    ...(policy.legacyHandles || []),
    ...(MERGED_COLLECTION_TAGS[policy.handle] || []),
  ].some((candidate) => normalizeCollectionHandle(candidate) === normalized));
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

const CONNECTOR_GENDER_CONTEXT = /\b(?:cable|connector|terminal|plug|jack|socket|port|pin|thread(?:ed|s)?|adapter|audio|camera|tripod|mount|bracket|arm|screw|bolt|wire|xh2|usb|aux|hot\s+shoe)\b/i;

function isConnectorGenderPhrase(text, phrase) {
  return ["male", "female"].includes(normalizeCatalogText(phrase)) && CONNECTOR_GENDER_CONTEXT.test(text);
}

function hasDirectAudienceEvidence(product, audience) {
  const text = productText(product);
  const terms = {
    women: ["woman", "women", "womens", "female", "lady", "ladies", "maternity"],
    men: ["man", "men", "mens", "male", "gentleman", "gents"],
    kids: ["baby", "newborn", "infant", "kid", "kids", "child", "children", "toddler", "boy", "boys", "girl", "girls", "teen"],
  }[audience] || [];
  return terms.some((term) => hasPhrase(text, term) && !isConnectorGenderPhrase(text, term));
}

function isPetProductLike(product, knowledge) {
  const department = normalizeCatalogText(knowledge?.departmentId);
  const audience = normalizeCatalogText(knowledge?.audience?.id);
  if (["pet", "pets", "pet supplies"].includes(department) || ["pet", "pets"].includes(audience)) return true;
  const text = productText(product);
  return PET_PRODUCT_TEXT_TERMS.some((term) => hasPhrase(text, term));
}

function isGardenToolLike(product) {
  const text = productText(product);
  return GARDEN_CONTEXT_TERMS.some((term) => hasPhrase(text, term)) &&
    GARDEN_TOOL_TERMS.some((term) => hasPhrase(text, term));
}

function matchesExcludedSignals(exclusion, product, knowledge) {
  if (!exclusion) return false;
  const text = productText(product);
  if ((exclusion.textAny || []).some((phrase) => hasPhrase(text, phrase))) return true;
  if ((exclusion.departments || []).map(normalizeCatalogText).includes(normalizeCatalogText(knowledge?.departmentId))) return true;
  if ((exclusion.categories || []).map(normalizeCatalogText).includes(normalizeCatalogText(knowledge?.categoryId))) return true;
  if ((exclusion.subcategories || []).map(normalizeCatalogText).includes(normalizeCatalogText(knowledge?.subcategoryId))) return true;
  if ((exclusion.rules || []).map(normalizeCatalogText).includes(normalizeCatalogText(knowledge?.classificationRule || knowledge?.ruleId))) return true;
  return false;
}

function audienceScopedCollectionIsSafe(policy, product, knowledge) {
  const expectedAudience = Object.entries(AUDIENCE_SCOPED_COLLECTIONS)
    .find(([, handles]) => handles.has(policy?.handle))?.[0];
  if (!expectedAudience) return true;

  // A product-level override or taxonomy rule may intentionally establish an
  // audience without repeating it in the supplier title. Otherwise require a
  // direct shopper-facing audience phrase. This prevents stale `women` or
  // `men` tags—and connector words such as male/female—from creating fashion
  // collection membership for technical products.
  if (hasDirectAudienceEvidence(product, expectedAudience)) return true;
  if (normalizeCatalogText(knowledge?.audience?.id) !== expectedAudience) return false;
  return Boolean(knowledge?.override?.id || knowledge?.audience?.source === "taxonomy-rule");
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
  if (requirement.textAnyGroups?.length) {
    tests.push(requirement.textAnyGroups.every((group) =>
      Array.isArray(group) && group.some((phrase) => hasPhrase(text, phrase))));
  }
  return tests.length > 0 && tests.every(Boolean);
}

export function productMatchesSemanticCollection(policy, product, knowledge, dynamicAssignments = new Set()) {
  if (!policy || policy.kind !== "semantic") return false;
  const match = policy.match || {};
  if (HUMAN_ONLY_COLLECTION_HANDLES.has(policy.handle) && isPetProductLike(product, knowledge)) return false;
  if (AUDIENCE_SCOPED_COLLECTIONS && !audienceScopedCollectionIsSafe(policy, product, knowledge)) return false;
  if (policy.handle === "home-decor" && isGardenToolLike(product)) return false;
  if (matchesExcludedSignals(match.exclude, product, knowledge)) return false;
  if (match.require && !matchesRequiredSignals(match.require, product, knowledge)) return false;
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
  const anyGroupMatches = (match.textAnyGroups || []).every((group) =>
    Array.isArray(group) && group.some((phrase) => hasPhrase(text, phrase)));
  if (Boolean((match.textAll || []).length || (match.textAny || []).length || (match.textAnyGroups || []).length) &&
    allMatches && anyMatches && anyGroupMatches) return true;

  // `require` is a gate, not an alternative to additional positive evidence.
  // If it is the only positive rule, its successful match is the complete
  // decision; otherwise the collection must also match its explicit signals.
  const hasIndependentPositiveRule = Boolean(
    match.dynamic ||
    match.taxonomyTags?.length ||
    match.targets?.length ||
    match.departments?.length ||
    match.categories?.length ||
    match.subcategories?.length ||
    match.rules?.length ||
    match.audiences?.length ||
    match.textAll?.length ||
    match.textAny?.length ||
    match.textAnyGroups?.length,
  );
  return Boolean(match.require && !hasIndependentPositiveRule);
}

export function buildProductCollectionTags(product, knowledge, dynamicAssignments = new Set()) {
  // Unresolved classifications are routed by the release planner to the
  // explicit classification-review collection. They must not leak into a
  // semantic collection through stale targets or tags.
  if (knowledge?.reviewRequired) return [];

  return [...new Set(SEMANTIC_COLLECTION_POLICIES
    .filter((policy) => productMatchesSemanticCollection(policy, product, knowledge, dynamicAssignments))
    .map((policy) => policy.tag))];
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
    .filter((handle) => !DEFAULT_READ_ONLY_LIVE_COLLECTION_HANDLES.includes(handle))
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
    title: `Future Light Store price policy ${COLLECTION_GOVERNANCE_VERSION}`,
    description: `Controlled price collection for ${policy.title}.`,
    targetType: "PRODUCTS",
    inclusion: { matchType: "ALL", conditions },
  };
}

export function buildSemanticCollectionSource(policy) {
  const ruleTags = semanticCollectionRuleTags(policy);
  return {
    title: `Future Light Store collection policy ${COLLECTION_GOVERNANCE_VERSION}`,
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
