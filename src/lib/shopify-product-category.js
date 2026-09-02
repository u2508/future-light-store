import { normalizePlainText } from "./shopify-seo-batch.js";
import { classifyCatalogTaxonomy } from "./catalog-taxonomy.js";

const CATEGORY_RULES = [
  [/out[-\s]of[-\s]stock[-\s]placeholder[-\s]listing|out[-\s]of[-\s]stock(?:[-\s]out[-\s]of[-\s]stock){2,}/i, "pa", "Product Add-Ons"],
  [/(?:order|price)\s+(?:price\s+)?difference|order adjustment/i, "pa", "Product Add-Ons"],
  [/(?:wireless|bluetooth|open[ -]?ear|in[ -]?ear).{0,35}(?:earbuds?|earphones?|headphones?)|(?:earbuds?|earphones?|headphones?).{0,35}(?:wireless|bluetooth|case|cover)/i, "el", "Electronics"],
  [/(?:earbuds?|earphones?|headsets?|airpods?|eartips?|ear tips?|galaxy buds|realme buds)/i, "el", "Electronics"],
  [/(?:pen|pencil|crayon).{0,25}(?:case|box|pouch|organizer)|(?:case|box|pouch|organizer).{0,25}(?:pen|pencil|crayon)/i, "os-3-16", "Pen & Pencil Cases"],
  [/(?:storage boxes?|organizers?).{0,80}(?:office supplies|pencils?|crayons?|crafts?)/i, "os", "Office Supplies"],
  [/(?:digital|electronic|electric).{0,25}(?:piano|musical keyboard)|(?:piano|musical keyboard).{0,25}(?:digital|electronic|electric)/i, "ae", "Arts & Entertainment"],
  [/(?:pieces?|pcs|set|refill).{0,45}(?:essential|fragrance|aromatherapy)\s+oils?\b|(?:essential|fragrance|aromatherapy)\s+oils?.{0,45}(?:set|refill)/i, "hb-3-21", "Essential Oils"],
  [/(?:essential oil|aroma|fragrance)\s+diffuser|diffuser.{0,30}(?:essential oil|aroma|fragrance)/i, "hb-3-21-3", "Essential Oil Diffusers"],
  [/(?:essential|fragrance|aromatherapy)\s+oils?\b/i, "hb-3-21", "Essential Oils"],
  [/(?:jewelry|jewellery).{0,20}(?:box|case|holder|organizer)/i, "hb-2-3-1", "Jewelry Boxes"],
  [/(?:whiteboard|blackboard|display board|standing sign|billboard)/i, "os", "Office Supplies"],
  [/(?:dried flowers?|craft (?:material|supplies)|soap.{0,20}candle.{0,20}craft)/i, "ae", "Arts & Entertainment"],
  [/(?:humidifier|dehumidifier|air purifier|air filter|aroma diffuser|air diffuser)/i, "hg", "Home & Garden"],
  [/(?:co2|carbon dioxide).{0,25}(?:diffuser|plant)|(?:diffuser|plant).{0,25}(?:co2|carbon dioxide)/i, "hg", "Home & Garden"],
  [/(?:tire|tyre).{0,25}(?:inflator|air pump)|(?:inflator|air pump).{0,25}(?:tire|tyre|car|vehicle|bicycle)/i, "vp", "Vehicles & Parts"],
  [/(?:car|vehicle|automotive).{0,25}(?:key|remote).{0,25}(?:pcb|board)|(?:key|remote).{0,25}(?:pcb|board).{0,25}(?:car|vehicle|automotive)/i, "vp", "Vehicles & Parts"],
  [/(?:car|vehicle).{0,25}(?:air freshener|perfume diffuser)|(?:air freshener|perfume diffuser).{0,25}(?:car|vehicle)/i, "vp", "Vehicles & Parts"],
  [/(?:portable|usb|desktop).{0,20}(?:fan|air cooler)/i, "hg", "Home & Garden"],
  [/(?:watch|smartwatch).{0,25}(?:charger|charging|dock)|(?:charger|charging|dock).{0,25}(?:watch|smartwatch)/i, "el", "Electronics"],
  [/(?:phone|iphone|ipad|smartphone|tablet|radio|baofeng).{0,35}(?:case|cover|charger|charging|adapter)|(?:case|cover|charger|charging|adapter).{0,35}(?:phone|iphone|ipad|smartphone|tablet|radio|baofeng)/i, "el", "Electronics"],
  [/(?:e-?bike|electric bicycle).{0,35}(?:battery )?charger|(?:battery )?charger.{0,35}(?:e-?bike|electric bicycle)/i, "el-7-15-2-4", "General Purpose Battery Chargers"],
  [/(?:usb\s*(?:2\.0|3\.0|3\.2)?\s*)?(?:flash drive|pen drive|pendrive|memory stick|u disk)/i, "el-7-9-14-8", "USB Flash Drives"],
  [/(?:mouse feet|mouse skates)/i, "el-7-9-11-4-3", "Mouse Skates"],
  [/(?:mouse\s*pad|mousepad|gaming desk mat)/i, "el-7-8-8", "Mouse Pads"],
  [/(?:car|truck|motorcycle|automotive|vehicle|boat).{0,35}battery charger|battery charger.{0,35}(?:car|truck|motorcycle|automotive|vehicle|boat)/i, "vp-1-5-7-3", "Vehicle Battery Chargers"],
  [/(?:power tool|electric drill|electric wrench|angle grinder).{0,35}charger|charger.{0,35}(?:power tool|electric drill|electric wrench|angle grinder)/i, "ha-14-17", "Power Tool Chargers"],
  [/(?:electric shaver|electric razor|hair clipper).{0,35}charger|charger.{0,35}(?:electric shaver|electric razor|hair clipper)/i, "hb-3-14-3-3", "Electric Razor Chargers & Cables"],
  [/(?:e-?scooter|electric scooter).{0,35}(?:battery )?charger|charger.{0,35}(?:e-?scooter|electric scooter)/i, "sg-4-15-3-1-1", "E-Scooter Battery Chargers"],
  [/wireless charger|wireless charging/i, "el-7-15-5-2", "Wireless Chargers"],
  [/(?:phone )?car charger|car phone charger/i, "el-7-15-5-4", "Car Chargers"],
  [/(?:wall charger|travel charger|charger plug|charging adapter|power adapter)/i, "el-7-15-5", "Power Adapters & Chargers"],
  [/(?:battery charger|rechargeable batteries? charger|charging station for batteries)/i, "el-7-15-2-4", "General Purpose Battery Chargers"],
  [/(?:computer|gaming|mechanical|wired|wireless|programmable|macro|membrane).{0,35}(?:keyboard|keypad|keycaps?|stabilizers?)|(?:keyboard|keypad|keycaps?|stabilizers?).{0,35}(?:computer|gaming|mechanical|wired|wireless|programmable|macro|membrane|stand|storage|cover|pcb|board)/i, "el", "Electronics"],
  [/(?:key\s*boards?|keybaords?)/i, "el", "Electronics"],
  [/(?:charger|charging adapter|charging port)/i, "el", "Electronics"],
  [/(?:protein|gym|fitness).{0,25}shaker|shaker bottle/i, "sg-2-29", "Shaker Bottles"],
  [/(?:salt.{0,12}pepper|pepper.{0,12}salt|spice|seasoning).{0,25}shaker/i, "hg-11-10-3-4", "Shaker Sets"],
  [/(?:sports|gym|fitness).{0,25}water bottle|water bottle.{0,25}(?:sports|gym|fitness)/i, "sg-1-13-20", "Sports Water Bottles"],
  [/water bottle/i, "hg-11-3-11", "Water Bottles"],
  [/(?:sex toys?|erotic games?|bdsm)/i, "ma-1-4", "Sex Toys & Erotic Games"],
  [/(?:\b(?:dog|puppy)\b.{0,30}\btoys?\b|\btoys?\b.{0,30}\b(?:dog|puppy)\b)/i, "ap-2-3-7", "Dog Toys"],
  [/(?:\b(?:cat|kitten)\b.{0,30}\btoys?\b|\btoys?\b.{0,30}\b(?:cat|kitten)\b)/i, "ap-2-2-5", "Cat Toys"],
  [/(?:board games?|tic tac toe|five in a row|chess|tabletop games?)/i, "tg-2-5", "Board Games"],
  [/(?:card games?|playing cards?)/i, "tg-2-7", "Card Games"],
  [/(?:jigsaw puzzle|wooden puzzle|peg(?:ged)? puzzle|puzzle board)/i, "tg-4-12", "Wooden & Pegged Puzzles"],
  [/\bpuzzles?\b/i, "tg-4", "Puzzles"],
  [/(?:pretend play|role play toy|play kitchen|kitchen play|doctor kit|tea set toy)/i, "tg-5-16", "Pretend Play"],
  [/(?:sensory toys?|fidget toys?|stress toys?)/i, "tg-5-29", "Sensory Toys"],
  [/(?:bath toys?|baby bath toy)/i, "tg-5-5", "Bath Toys"],
  [/(?:educational toys?|learning toys?|montessori toys?|science experiment toys?)/i, "tg-5-9", "Educational Toys"],
  [/(?:sports toys?|throwing games?|toss and catch|outdoor games?)/i, "tg-5-23", "Sports Toys"],
  [/(?:baby|newborn|infant).{0,35}(?:health|grooming|nail care|care kit)|(?:health|grooming|nail care|care kit).{0,35}(?:baby|newborn|infant)/i, "bt-3-1", "Baby Health & Grooming Kits"],
  [/(?:baby safety|child safety|baby mirror|child monitor|spout cover|corner guards?)/i, "bt-4", "Baby Safety"],
  [/(?:baby bathing|baby bath|shampoo cup|bath brush)/i, "bt-1", "Baby Bathing"],
  [/(?:coloring books?|coloring pads?)/i, "tg-5-2-2", "Coloring Books & Pads"],
  [/(?:\bencyclopedia\b|\bbooks?\b(?!\s*(?:bag|backpack|case|cover|sleeve|stand|holder)))/i, "me-1", "Books"],
  [/(?:baby|toddler|kids?|children).{0,30}(?:athletic shoes|sneakers|sports shoes|running shoes)/i, "aa-8-11-4", "Baby & Children's Athletic Shoes"],
  [/(?:baby|toddler|kids?|children).{0,30}(?:shoes|sandals|slippers|boots)|(?:shoes|sandals|slippers|boots).{0,30}(?:baby|toddler|kids?|children)/i, "aa-8-11", "Baby & Children's Shoes"],
  [/(?:baby|toddler|kids?|children).{0,30}(?:socks|tights)|(?:socks|tights).{0,30}(?:baby|toddler|kids?|children)/i, "aa-1-25-7", "Baby & Children's Socks & Tights"],
  [/(?:toe socks)/i, "aa-1-18-11", "Toe Socks"],
  [/(?:ankle socks|low cut socks|no show socks)/i, "aa-1-18-1", "Ankle Socks"],
  [/\bsocks?\b/i, "aa-1-18", "Socks"],
  [/(?:baby|toddler|kids?|children).{0,30}(?:t-?shirts?|shirts?)/i, "aa-1-25-9-6", "Baby & Children's Shirts"],
  [/(?:baby|toddler|kids?|children|girls?|boys?).{0,45}(?:clothing|clothes|outfits?|costumes?|uniforms?|underwear|vests?|blazers?|dresses?|pants|trousers|shorts|skirts?|jackets?|coats?|hoodies?|sweaters?|pajamas?|swimwear)/i, "aa-1-25", "Baby & Children's Clothing"],
  [/\bt-?shirts?\b/i, "aa-1-13-8", "T-Shirts"],
  [/\bshirts?\b/i, "aa-1-13-7", "Shirts"],
  [/(?:athletic shoes|sneakers|sports shoes|running shoes)/i, "aa-8-1", "Athletic Shoes"],
  [/\b(?:shoes|sandals|slippers|boots)\b/i, "aa-8", "Shoes"],
  [/(?:\b(?:hat|hats|cap|caps|beanie|visor|fedora)\b|bucket hat|sun hat)/i, "aa-2-17", "Hats"],
  [/\btoys?\b/i, "tg-5", "Toys"],
];

const richCategoryCache = new WeakMap();

function buildProductEvidenceText(product) {
  const tags = Array.isArray(product?.tags) ? product.tags.join(" ") : product?.tags || "";
  return normalizePlainText([
    product?.handle,
    product?.title,
    product?.product_type || product?.productType,
    tags,
  ].join(" ")).replace(/[-_]+/g, " ");
}

// Supplier titles sometimes contain enough concrete product evidence for a
// Shopify path even when the broader catalog classifier remains conservative.
// Keep these fallbacks narrow and return paths, not guessed IDs: the backfill
// resolves every path against Shopify before applying it.
const DETERMINISTIC_CATEGORY_RULES = Object.freeze([
  {
    id: "pet-grooming-tools",
    pattern: /(?:pet|dog|cat|puppy|kitten).{0,80}(?:brush|slicker|deshedding|dematting|hair removal)|(?:brush|slicker|deshedding|dematting).{0,80}(?:pet|dog|cat|puppy|kitten)/i,
    fullName: "Animals & Pet Supplies > Pet Supplies > Pet Grooming Supplies",
  },
  {
    id: "massage-recovery-tools",
    pattern: /\b(?:massage|massager|muscle relief|relax tool)\b/i,
    fullName: "Health & Beauty > Health Care",
  },
  {
    id: "party-decoration-supplies",
    pattern: /(?:cake topper|cake toppers|party decoration|retirement sash|retired sash|birthday sash|photo prop|party supplies)/i,
    fullName: "Arts & Entertainment > Party & Celebration > Party Supplies",
  },
  {
    id: "greeting-cards",
    pattern: /(?:greeting card|birthday card|holiday card|father'?s day card|christmas card|custom greeting cards?)/i,
    fullName: "Arts & Entertainment > Party & Celebration > Greeting Cards",
  },
  {
    id: "tableware-gift-sets",
    pattern: /(?:wine glass|whiskey glass|drinkware|tableware).{0,45}(?:set|gift)|(?:set|gift).{0,45}(?:wine glass|whiskey glass|drinkware|tableware)/i,
    fullName: "Home & Garden > Kitchen & Dining > Tableware",
  },
  {
    id: "specific-decorative-gift-items",
    pattern: /(?:acrylic plaque|acrylic sign|refrigerator magnet|decoration magnet|wall hanging decor|crochet penguin|sunflower.*flower)/i,
    fullName: "Home & Garden > Decor",
  },
  {
    id: "specific-fishing-lures",
    pattern: /\bfishing lure\b/i,
    fullName: "Sporting Goods > Outdoor Recreation > Fishing",
  },
  {
    id: "gift-giving",
    pattern: /\b(?:gift|gifts|present|presents|keepsake)\b.{0,70}\b(?:dad|dads|father|mom|mother|grandma|grandmother|grandpa|grandfather|teacher|husband|wife|boyfriend|girlfriend|him|her)\b|\b(?:dad|dads|father|mom|mother|grandma|grandmother|grandpa|grandfather|teacher|husband|wife|boyfriend|girlfriend)\b.{0,70}\b(?:gift|gifts|present|presents|keepsake)\b/i,
    fullName: "Arts & Entertainment > Party & Celebration > Gift Giving",
  },
  {
    id: "decorative-gift-items",
    pattern: /(?:acrylic plaque|acrylic sign|keepsake|wall hanging decor|home decor|desk decor|refrigerator magnet|decoration magnet|sunflower.*flower|crochet penguin)/i,
    fullName: "Home & Garden > Decor",
  },
  {
    id: "fishing-lures",
    pattern: /\bfishing lure\b/i,
    fullName: "Sporting Goods > Outdoor Recreation > Fishing",
  },
  {
    id: "electronic-pets-and-novelty-toys",
    pattern: /(?:electronic pets?|virtual cyber pet|prank gift|practical joke)/i,
    fullName: "Toys & Games > Toys",
  },
  {
    id: "hair-care-tools-and-treatments",
    pattern: /(?:split ends?|hair end(?:s)? trimmer|hair cutting machine|hair ampoule|hair gloss|hair color conditioning)/i,
    fullName: "Health & Beauty > Personal Care > Hair Care",
  },
  {
    id: "home-thermometers-and-hygrometers",
    pattern: /(?:digital thermometer|hygrometer|humidity temperature|temperature gauge)/i,
    fullName: "Home & Garden > Household Appliances",
  },
  {
    id: "brooches-and-pins",
    pattern: /\b(?:brooch(?:es)?|lapel pin|decorative pin)\b/i,
    fullName: "Apparel & Accessories > Clothing Accessories > Brooches",
  },
  {
    id: "skin-care-products",
    pattern: /(?:facial? moisturizing cream|face cream|face balm|facial care|skin care|silicone mask cover|face sculpting mask)/i,
    fullName: "Health & Beauty > Personal Care > Cosmetics > Skin Care",
  },
  {
    id: "sleep-masks-and-relaxation",
    pattern: /(?:sleeping mask|sleep mask|eye blindfold|eye cover).{0,45}(?:travel|sleep|lunch break|blockout)|(?:travel|sleep|lunch break|blockout).{0,45}(?:sleeping mask|sleep mask|eye blindfold|eye cover)/i,
    fullName: "Health & Beauty > Health Care",
  },
  {
    id: "sleep-pillows",
    pattern: /(?:sleeping pillow|sleep pillow|hotel pillow|pillows? for sleeping|lying pillow)/i,
    fullName: "Home & Garden > Linens & Bedding > Pillows",
  },
  {
    id: "kitchen-storage-organization",
    pattern: /(?:kitchen|refrigerator|fridge|under sink|countertop).{0,70}(?:organizer|storage|rack|shelf|shelves|drawer|hooks?)|(?:organizer|storage|rack|shelf|shelves|drawer|hooks?).{0,70}(?:kitchen|refrigerator|fridge|under sink|countertop)/i,
    fullName: "Home & Garden > Kitchen & Dining > Kitchen Storage & Organization",
  },
  {
    id: "kitchen-tools-and-utensils",
    pattern: /(?:rice washing|rice rinsing|garlic.{0,20}(?:crusher|press)|vegetable fruit crusher|drain mat|drain basket|kitchen washing gadget|kitchen helper gadget)/i,
    fullName: "Home & Garden > Kitchen & Dining > Kitchen Tools & Utensils",
  },
  {
    id: "food-storage-containers",
    pattern: /(?:food storage|storage container).{0,70}(?:grain|flour|rice|nut|airtight|sealed)|(?:grain|flour|rice|nut|airtight|sealed).{0,70}(?:food storage|storage container)/i,
    fullName: "Home & Garden > Kitchen & Dining > Food Storage",
  },
  {
    id: "bathroom-shelves-and-caddies",
    pattern: /(?:bathroom shelves?|shower towel caddy|shampoo.*storage).{0,70}(?:organizer|rack|holder|caddy)|(?:organizer|rack|holder|caddy).{0,70}(?:bathroom shelves?|shower towel caddy|shampoo.*storage)/i,
    fullName: "Home & Garden > Bathroom Accessories",
  },
  {
    id: "household-storage-organization",
    pattern: /(?:storage box|storage boxes|storage rack|storage shelves|storage holders|storage organizer|trolley storage|home organization)/i,
    fullName: "Home & Garden > Household Supplies > Storage & Organization",
  },
  {
    id: "electronic-component-storage",
    pattern: /(?:electronic components?|small screw accessories|tool classification grid)/i,
    fullName: "Electronics > Electronics Accessories",
  },
  {
    id: "smart-door-locks",
    pattern: /(?:smart door lock|door cylinder|door lock|password locks?|keyless entry|fingerprint lock)/i,
    fullName: "Hardware > Building Materials > Door Hardware > Locks",
  },
  {
    id: "security-alarm-systems",
    pattern: /^(?!.*\b(?:bike|bicycle|motorcycle|car|vehicle)\b)(?:.*\b(?:door|window|home security|anti theft|anti-theft|PIR|motion detector|alarm system|security system|security alarm|siren|sensor|detector)\b.*)$/i,
    fullName: "Hardware > Security > Security Systems",
  },
  {
    id: "vehicle-security-alarms",
    pattern: /(?:bike|bicycle|motorcycle|car).{0,55}(?:alarm|anti theft|security system)|(?:alarm|anti theft|security system).{0,55}(?:bike|bicycle|motorcycle|car)/i,
    fullName: "Vehicles & Parts > Vehicle Parts & Accessories",
  },
  {
    id: "home-security-lighting",
    pattern: /(?:tv simulator|security light).{0,70}(?:flashing|led|timer|dusk|anti theft)|(?:flashing|led|timer|dusk|anti theft).{0,70}(?:tv simulator|security light)/i,
    fullName: "Home & Garden > Lighting",
  },
  {
    id: "landline-telephones",
    pattern: /(?:land[- ]line phone|home telephone|large button phone|telephone for seniors)/i,
    fullName: "Electronics > Communications > Telephones",
  },
  {
    id: "decorative-lighting",
    pattern: /(?:lighting painting|luminous lighting|bedside.*lighting|three color dimming)/i,
    fullName: "Home & Garden > Lighting",
  },
  {
    id: "bedside-storage-organizers",
    pattern: /(?:bedside organizer|bedside storage|hanging basket bed|bunk.*organizer|dormitory.*rack)/i,
    fullName: "Home & Garden > Household Supplies > Storage & Organization",
  },
  {
    id: "reading-glasses-and-vision-aids",
    pattern: /(?:reading glasses?|magnifying glass|magnifying glasses?|handheld magnifier|phone screen magnifier)/i,
    fullName: "Health & Beauty > Health Care",
  },
  {
    id: "shirts-and-tank-tops",
    pattern: /(?:tank tops?|sleeveless vest|crew[- ]neck tank|undershirt)/i,
    fullName: "Apparel & Accessories > Clothing > Shirts & Tops",
  },
  {
    id: "sweaters-and-cardigans",
    pattern: /(?:sweater|cardigan|pullover|sweatshirt)/i,
    fullName: "Apparel & Accessories > Clothing > Outerwear",
  },
]);

function inferDeterministicFallbackCategory(product) {
  const evidence = buildProductEvidenceText(product);
  if (!evidence) return null;
  const match = DETERMINISTIC_CATEGORY_RULES.find((rule) => rule.pattern.test(evidence));
  if (!match) return null;
  return {
    id: "",
    name: match.fullName.split(/\s*>\s*/).at(-1) || match.fullName,
    fullName: match.fullName,
    confidence: "high",
    reason: `Evidence-backed fallback ${match.id} resolved to ${match.fullName}`,
    ruleId: match.id,
  };
}

export function inferShopifyTaxonomyCategory(product) {
  const evidence = buildProductEvidenceText(product);
  if (!evidence) {
    return null;
  }

  for (const [pattern, suffix, name] of CATEGORY_RULES) {
    if (pattern.test(evidence)) {
      return {
        id: `gid://shopify/TaxonomyCategory/${suffix}`,
        name,
        confidence: "high",
        reason: `Explicit product-family match for ${name}`,
      };
    }
  }

  return null;
}

// The checked-in rule table supplies stable IDs for the narrow, legacy rules.
// The full taxonomy supplies deterministic category paths; the backfill script
// resolves those paths against Shopify before writing a category ID.
export function inferDeterministicShopifyTaxonomyCategory(product) {
  const explicit = inferShopifyTaxonomyCategory(product);
  if (explicit) return explicit;
  if (!product || typeof product !== "object") return null;

  const deterministicFallback = inferDeterministicFallbackCategory(product);
  if (deterministicFallback) return deterministicFallback;

  const cached = richCategoryCache.get(product);
  if (cached !== undefined) return cached;

  const classification = classifyCatalogTaxonomy(product);
  const fullName = normalizePlainText(classification?.shopifyCategory || "");
  // A category can be deterministic even when the broader SEO taxonomy asks
  // for review because it has only one evidence lane. Accept that narrow case
  // when the title/handle directly names the product family and the score is
  // strong; keep all ambiguity and cross-family conflicts blocked.
  const reviewReasons = new Set(classification?.reviewReasons || []);
  const categoryEvidenceIsStrong = Boolean(
    fullName &&
    classification?.confidence >= 72 &&
    classification?.evidence?.directFields?.some((field) => field === "title" || field === "handle") &&
    [...reviewReasons].every((reason) => reason === "single-evidence-lane"),
  );
  const result = (!fullName || (classification?.reviewRequired && !categoryEvidenceIsStrong))
    ? null
    : {
        id: "",
        name: fullName.split(/\s*>\s*/).at(-1) || fullName,
        fullName,
        confidence: classification.confidence >= 90 ? "high" : "medium",
        reason: `Deterministic taxonomy rule ${classification.ruleId} resolved to ${fullName}`,
        ruleId: classification.ruleId,
      };
  richCategoryCache.set(product, result);
  return result;
}

const DISCLOSURE_PATTERNS = [
  ["shopify--disclosure-us-cpsc-choking_balloons", /choking hazard[\s\S]{0,120}balloon|balloon[\s\S]{0,120}choking hazard/i],
  ["shopify--disclosure-us-cpsc-choking_marbles", /choking hazard[\s\S]{0,120}marbles?|marbles?[\s\S]{0,120}choking hazard/i],
  ["shopify--disclosure-us-cpsc-choking_small_balls", /choking hazard[\s\S]{0,120}small balls?|small balls?[\s\S]{0,120}choking hazard/i],
  ["shopify--disclosure-us-cpsc-choking_small_parts", /choking hazard|small parts|not for children under (?:3|three)/i],
  ["shopify--disclosure-us-ca-prop65-cancer_reproductive", /prop(?:osition)?\s*65[\s\S]{0,160}(?:cancer[\s\S]{0,80}reproductive|reproductive[\s\S]{0,80}cancer)/i],
  ["shopify--disclosure-us-ca-prop65-cancer", /prop(?:osition)?\s*65[\s\S]{0,160}cancer/i],
  ["shopify--disclosure-us-ca-prop65-reproductive", /prop(?:osition)?\s*65[\s\S]{0,160}reproductive/i],
];

export function inferApprovedDisclosureReferences(product, options = []) {
  const approvedByType = new Map(
    (Array.isArray(options) ? options : [])
      .filter((option) => option?.id && option?.type)
      .map((option) => [option.type, option.id]),
  );
  if (!approvedByType.size) {
    return [];
  }

  const evidence = normalizePlainText([
    product?.handle,
    product?.title,
    product?.body_html || product?.bodyHtml,
    Array.isArray(product?.tags) ? product.tags.join(" ") : product?.tags,
  ].join(" "));

  for (const [type, pattern] of DISCLOSURE_PATTERNS) {
    if (pattern.test(evidence) && approvedByType.has(type)) {
      return [approvedByType.get(type)];
    }
  }

  return [];
}

export { CATEGORY_RULES };
