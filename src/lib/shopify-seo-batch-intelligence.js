import {
  buildMediaUpdateTargets as buildLegacyMediaUpdateTargets,
  formatMoneyValue,
  normalizeHandleValue,
  normalizeHtmlValue,
  normalizePlainText,
  normalizeUrlForMatch,
  parseMoneyValue,
  toShopifyGid,
} from "./shopify-seo-batch.js";
import {
  containsUnsafeMarketplaceClaim,
  enforceMarketplaceTitle,
  isTitleAlignedWithKnowledge,
  MARKETPLACE_CONTENT_POLICY,
  prioritizeProductFacts,
  PRODUCT_CONTENT_KNOWLEDGE_VERSION,
  resolveProductKnowledge,
  sanitizeMarketplaceClaims,
} from "./shopify-product-content-knowledge.js";
import {
  getMinimumQuantityTagForPrices,
  normalizeShopifyTags,
  reconcileManagedMinimumQuantityTags,
} from "./shopify-seo-managed-tags.js";
import { classifyProductKnowledge, PRODUCT_KNOWLEDGE_BASE_VERSION } from "./product-knowledge-base.js";
import { extractLabeledSpecificationFacts } from "./product-specifications.js";
import { getCatalogTaxonomyDefinitions } from "./catalog-taxonomy.js";
import { PRICE_REWORK_RULES, multiplierForCost } from "./shopify-price-rework-policy.js";

export const PER_PRODUCT_OVERHEAD = PRICE_REWORK_RULES.overhead;
// Kept as a compatibility alias for older audit imports; pricing semantics are
// explicitly per product/variant, not a checkout-level order fee.
export const PER_ORDER_OVERHEAD = PER_PRODUCT_OVERHEAD;
const MAX_REASONABLE_RETAIL_PRICE = 14999.99;

const GENERIC_TITLE_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "of",
  "on",
  "or",
  "our",
  "the",
  "this",
  "to",
  "with",
  "your",
  "daily",
  "everyday",
  "practical",
  "seller",
  "sellers",
  "product",
  "products",
  "item",
  "items",
  "listing",
  "shop",
  "shopify",
  "sale",
  "best",
  "new",
  "popular",
  "premium",
  "featured",
  "feature",
  "must",
  "have",
  "perfect",
  "great",
  "brand",
  "bundle",
  "bundles",
  "set",
  "sets",
  "home",
  "use",
  "usable",
  "style",
  "styles",
  "fashion",
  "fashionable",
  "women",
  "woman",
  "men",
  "man",
  "girls",
  "girl",
  "boys",
  "boy",
  "kids",
  "child",
  "children",
  "baby",
  "adult",
  "unisex",
]);

const GENERIC_TITLE_PHRASES = [
  /home product/i,
  /everyday home use/i,
  /practical everyday/i,
  /best seller/i,
  /new arrival/i,
  /product listing/i,
  /beauty product/i,
  /bath personal care item/i,
  /personal care item/i,
  /personal care/i,
  /for everyday/i,
  /practical use/i,
  /wardrobe use/i,
  /business and office looks/i,
  /face makeup looks/i,
  /shop now/i,
];

// These labels describe a broad catalog family, not the item a shopper is
// actually evaluating. They are useful for classification, but unsafe as the
// noun in customer-facing copy because they can turn a mattress into a
// "fitness accessory" or a cable into a generic "electronics accessory".
const GENERIC_HUMAN_TYPE_PATTERN = /^(?:beauty|electronics?|fashion|fitness|home|outdoor|personal care|sports?|jewelry|makeup|hair care|skin care|facial care|body care|pet|baby|kids)\s+(?:accessory|item|product|piece|gear|format)|^(?:general|miscellaneous|other|practical)\s+(?:item|product)|^(?:garment|table)$/i;

const HANDLE_TITLE_OVERRIDES = new Map([
  [
    "out-of-stock-out-of-stock-out-of-stock-out-of-stock-out-of-stockout-of-stock-out-of-stock-out-of-stock",
    "Out of Stock Placeholder Listing",
  ],
  [
    "link-for-price-difference-link-for-price-difference",
    "Order Price Difference Adjustment Link",
  ],
  ["men-formal-shoes", "Men's Formal Shoes for Work and Occasions"],
  [
    "mens-led-square-watch-and-jewelry-set-birthday-gift-non-smartwatch-box-not-included",
    "Men's LED Square Watch and Jewelry Set",
  ],
  ["t-shirt-t-shirt-t-shirt", "Everyday T-Shirt for Casual Clothing"],
  ["candy-candy-anime", "Candy Candy Anime Graphic T-Shirt Top"],
  ["nana-anime", "Nana Anime Graphic Printed T-Shirt Top"],
  ["nana-anime-1", "Nana Anime Graphic Printed T-Shirt Top"],
  [
    "1-4-pairs-silicone-ear-tip-cover-replacement-earbud-xs-s-m-l-size-silicone-earbud-tips-covers-for-airpods-pro-1st-2nd-generation",
    "Replacement Silicone Ear Tips for AirPods Pro",
  ],
  [
    "eartips-for-airpods-pro-1-2-ear-pads-silicone-case-pressure-relief-hole-ear-caps-cushion-eartips-buds-earphone-air-pods-pro",
    "Replacement Silicone Ear Tips for AirPods Pro",
  ],
  [
    "summer-fashion-hot-street-hip-hop-3d-printing-trend-cool-black-casual-cool-t-shirt",
    "Black 3D-Print T-Shirt for Casual Summer Wear",
  ],
  ["seyhze-collagen-essence-serum-a-skincare-product-formulated-with-collagen-ceramides-aloe-vera-and-centella-asiatica-design", "Seyhze Collagen Serum with Ceramides, Aloe Vera and Centella"],
  ["yoshimura-t-shirt", "Yoshimura Cotton T-Shirt"],
  ["jeans-for-men-2025-new-loose-straight-leg-winter-thick-wide-leg-work-pants", "Men's Loose Straight-Leg Jeans for Winter Workwear"],
  ["case-for-iphone-13-case-iphone-11-12-13-mini-14-15-16-pro-max-cover-funda-tpu-cases-matte-liquid-silicone-cover-iphone-13", "Matte Silicone iPhone Case for Multiple Models"],
  ["case-for-iphone-15-plus-case-iphone-11-12-13-mini-14-15-16-pro-max-cover-shockproof-soft-silicone-cover-iphone-15plus", "Shockproof Silicone iPhone Case for Multiple Models"],
  ["12-24-card-holder-card-holder-multi-card-holder-mens-and-womens-card-holder-change-bag-for-men-and-women", "12-24 Slot Card Holder for Men and Women"],
  ["mirror-lip-gloss-lip-gloss-lip-moisturizing-liquid-lipstick-waterproof-long-lasting-brightening-and-non-fading-lip-gloss", "Waterproof Mirror-Finish Lip Gloss"],
  ["j-m-ld-lb-l-dd-d-c-curl-false-eyelash-extensions-salons-fox-eyes-faux-mink-matte-black-8-15mm-mix-soft-natural-makeup-lashes", "Faux Mink False Eyelash Extensions 8-15mm Mix"],
  [
    "moisturizing-conditioner-moisturizing-conditioner-moisturizing-conditioner-moisturizing-conditioner",
    "Moisturizing Hair Conditioner",
  ],
  ["moisture-surge-hydrating-concentrate-48ml", "48ml Hydrating Concentrate"],
  ["glue-free-false-eyelash-clusters-self-adhesive-multiple-styles-easy-to-apply-portable-for-daily-party-makeup-looks", "Self-Adhesive False Eyelash Clusters for Daily Makeup"],
  ["men-women-smart-watch", "Smart Watch for Men and Women"],
  ["minimalist-long-strip-led-wall-lamp", "Minimalist Long Strip LED Wall Lamp"],
  ["young-beautiful-and-wrinkle-free", "False Eyelashes for Eye Makeup"],
  ["4-pcs-box-hair-comb-set-eco-friendly-bamboo-wooden-air-cushion-massage-comb-for-adult-children-wide-tooth-and-pointed-tail-cmb", "4-Piece Bamboo Hair Comb Set for Adults and Children"],
  ["womens-shoes-womens-sports-shoes-2025-womens-shoes-breathable-single-mesh-dad-shoes-womens-casual-and-versatile-sports-shoe", "Women's Breathable Mesh Sports Shoes for Casual Wear"],
  ["hair-growth-spray-anti-hair-loss-baldness-hair-root-repair-damaged-scalp-treatment-serum-liquid-thickening-longer-beauty-health", "Hair and Scalp Care Spray, 120ml or 240ml"],
  ["batana-oil-for-hair-growth-dr-sebi-organic-raw-batana-oil-from-honduras-100-pure-natural-for-thicker-stronger-hair", "Batana Hair Oil from Honduras"],
  ["new-mens-belt-fashion-automatic-buckle-business-leather-belts-for-men-jeans-high-quality-strap", "Men's Leather Belt with Automatic Buckle"],
  ["male-belts-for-men-nylon-canvas-high-quality-tactical-belt-casual-mens-jeans-belts-multi-color-can-use-two-sides-of-the-strap", "Men's Reversible Nylon Canvas Tactical Belt"],
  ["high-quality-travel-bags-vintage-men-travel-totes-for-women-suitcases-handbags-hand-large-capacity-luggage-travel-duffle-bags", "Large Capacity Vintage Travel Duffle Bag"],
  ["h-l-since-1990-high-quality-eyebrow-extension-false-eyebrows-4-color-with-12-rows-per-set-and-no-eyelash-curling", "12-Row False Eyebrow Extension Set, 4 Colors"],
  ["h-l-since-1990-high-quality-eyebrow-extension-false-eyebrows-4-color-with-12-rows-per-set-and-no-eyelash-curling-1", "12-Row False Eyebrow Extension Set, 4 Colors"],
  ["32-rows-high-quality-beauty-10-12mm-c-curled-natural-false-eyeslashes-extension-personal-eyelash-professional", "32-Row C-Curl False Eyelash Extensions, 10-12mm"],
  ["mens-watches-luxury-brand-watches-for-mens-fashion-high-quality-luxury-simple-wristwatch-business-full-steel-sports-male-clock", "Men's Stainless Steel Business Wristwatch"],
  ["ghk-cu-cream-anti-aging-facial-moisturizer-firming-and-moisturizing-for-all-skin-types-suitable-for-men-and-women", "GHK-Cu Facial Moisturizer for Daily Skin Care"],
  ["garlic-hair-growth-oil-100ml-hair-regrowth-serum-for-thinning-hair-scalp-root-care-anti-hair-loss-fuller-thicker-hair-unisex", "Garlic Hair and Scalp Oil, 100ml"],
  ["hair-growth-inhibitor-serum-oil-stop-hair-growth-permanent-hair-removal-reduction-for-face-body-painless-moisturizing-skin-care", "Post Hair Removal Face and Body Care Serum Oil"],
  ["stylish-wave-led-wall-lamp", "Stylish Wave LED Wall Lamp"],
  ["denim-baseball-cap-men-women", "Denim Baseball Cap for Men and Women"],
  ["embroidery-messenger-bags-women-leather-handbags-bags-for-women-sac-a-main-ladies-hair-ball-hand-bag", "Women's Embroidered Messenger Handbag with Hair Ball Detail"],
  ["facial-mist-sprayer-facial-mist-sprayer-abs-housing-size-usb-charging-water-face-humidifier-for-hydration", "USB Facial Mist Sprayer and Face Humidifier"],
  ["case-for-iphone-16-15-14-13-12-pro-11-pro-xs-max-x-17-air-plus-iface-classic-smooth-glossy-shockproof-luxury-back-cover-coque", "Glossy Shockproof iPhone Case for Multiple Models"],
  ["mouse-customized-for-keyboard-br", "Customized Mouse for Keyboard and Computer Use"],
  ["7-in-1-hair-oil-high-gloss-hair-oil-that-can-be-quickly-absorbed-and-deeply-nourishes-the-hair-making-it-strong-and-elastic", "7-in-1 High Gloss Nourishing Hair Oil"],
  ["men-hair-replacement-100-human-hair-mono-base-6-inch-short-pu-edge-lace-mesh-with-clips-fully-hand-tied-off-black-wig", "Men's Short Black Hair Replacement Wig with Clips"],
  ["super-soft-leave-in-conditioner-spray-hair-scalp-treatment-smoothing-straightening-shiny-repair-damaged-hair-care-hair-oil-spray", "Leave-In Conditioner and Hair Oil Spray for Damaged Hair"],
  ["hair-dye-shampoo-for-gray-hair-for-women-men-natural-hair-dye-kit-semi-permanent-hair-dye-shampoo-black-brown-purple-200ml", "200ml Hair Dye Shampoo for Gray Hair"],
  ["nail-pens-nail-paint-pen-12-colors-portable-tools-decoration-drawing-for-kids-art-practice-salon-manicure-home-women", "12-Color Nail Paint Pens for Art and Manicure"],
  ["logitech-mx-master-3s-wireless-bluetooth-mouse-high-end-cross-screen-laptop", "Logitech MX Master 3S Wireless Bluetooth Mouse for Laptops"],
  ["logitech-mx-master-3s-wireless-bluetooth-mouse-business-office-softtone-mouse-ergonomic-business-office-mouse", "Logitech MX Master 3S Ergonomic Wireless Mouse for Office Use"],
]);

const FAMILY_PRIORITY_WORDS = new Set([
  "apron",
  "bib",
  "headband",
  "earring",
  "earrings",
  "necklace",
  "bracelet",
  "ring",
  "watch",
  "charger",
  "case",
  "cover",
  "light",
  "lamp",
  "pillow",
  "blanket",
  "towel",
  "organizer",
  "organiser",
  "bag",
  "tote",
  "backpack",
  "gloves",
  "bottle",
  "pot",
  "pots",
  "pan",
  "pans",
  "cookware",
  "kitchen",
  "utensil",
  "utensils",
  "mouse",
  "mice",
  "mirror",
  "wig",
  "wigs",
  "oil",
  "suit",
  "suits",
  "trouser",
  "trousers",
  "wallet",
  "wallets",
  "toothbrush",
  "holder",
  "lipstick",
  "lipgloss",
  "gloss",
  "blush",
  "nail",
  "sleeve",
  "bowl",
  "cup",
  "jug",
  "kit",
  "mask",
  "balm",
  "sprayer",
  "sweatshirt",
  "outfit",
  "mat",
  "rug",
  "dress",
  "shirt",
  "pants",
  "skirt",
  "shorts",
  "shoes",
  "socks",
  "sandals",
  "hat",
  "hats",
  "caps",
  "bonnet",
  "beanie",
  "wig",
  "bracelet",
  "strap",
  "protector",
  "screen",
  "diaper",
  "pad",
  "pullup",
  "pullups",
  "briefs",
  "brief",
  "hoodie",
  "toy",
  "toys",
  "keyboard",
  "keyboards",
  "piano",
  "earbud",
  "earbuds",
  "earphone",
  "earphones",
  "headphone",
  "headphones",
  "pencil",
  "humidifier",
  "diffuser",
  "fan",
]);

function asText(value) {
  if (typeof value === "string") {
    return value;
  }

  if (value == null) {
    return "";
  }

  return String(value);
}

function uniqueValues(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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

function tokenizeText(value) {
  return normalizeComparableText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function titleCase(value) {
  return tokenizeText(value)
    .map((token) => {
      const brandCase = {
        airpods: "AirPods",
        aux: "AUX",
        av: "AV",
        batie: "Batie",
        bglossy: "BGlossy",
        cu: "Cu",
        ecg: "ECG",
        ghk: "GHK",
        hdmi: "HDMI",
        hifi: "HiFi",
        honor: "Honor",
        huawei: "Huawei",
        jbl: "JBL",
        lige: "LIGE",
        kz: "KZ",
        edx: "EDX",
        lcd: "LCD",
        oled: "OLED",
        ipad: "iPad",
        iphone: "iPhone",
        nfc: "NFC",
        rgb: "RGB",
        ppg: "PPG",
        steelseries: "SteelSeries",
        suyarun: "Suyarun",
        tv: "TV",
        uv: "UV",
        vr: "VR",
        wifi: "Wi-Fi",
        youngcome: "Youngcome",
        xiaomi: "Xiaomi",
      }[token.toLowerCase()];
      if (brandCase) {
        return brandCase;
      }
      if (/^\d+(?:\.\d+)?(?:v|a|w|mah|ml|gb|tb)$/i.test(token)) {
        return token.toUpperCase();
      }
      if (/^(?:pcb|rgb|usb|tws|diy|led|ios|aa|aaa|sram|dji|psp)$/i.test(token)) {
        return token.toUpperCase();
      }
      if (/^[a-z0-9]+$/i.test(token) && token === token.toUpperCase()) {
        return token;
      }

      return token.charAt(0).toUpperCase() + token.slice(1);
    })
    .join(" ")
    .replace(/\b(\d+)\s+Piece\b/g, "$1-Piece")
    .replace(/\bMen S\b/g, "Men's")
    .replace(/\bWomen S\b/g, "Women's")
    .replace(/\bMens\b/g, "Men's")
    .replace(/\bWomens\b/g, "Women's")
    .replace(/\bWi Fi\b/g, "Wi-Fi")
    .replace(/\bIn Ear\b/g, "In-Ear")
    .replace(/\bOne Shoulder\b/g, "One-Shoulder")
    .replace(/\bLong Sleeve\b/g, "Long-Sleeve");
}

function stripHtml(value) {
  return asText(value)
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return normalizePlainText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (normalizePlainText(value)) {
      return value;
    }
  }

  return "";
}

const ROW_LOOKUP_CACHE = new WeakMap();

function getRowValue(row, candidates) {
  let lookup = ROW_LOOKUP_CACHE.get(row);
  if (!lookup) {
    lookup = new Map(Object.entries(row || {}).map(([key, value]) => [normalizeComparableText(key), value]));
    if (row && typeof row === "object") {
      ROW_LOOKUP_CACHE.set(row, lookup);
    }
  }

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeComparableText(candidate);
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

  const result = [];
  const seen = new Set();

  for (const entry of raw.split(/[,;\n|]+/g)) {
    const text = normalizePlainText(entry);
    if (!text) {
      continue;
    }

    const key = text.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(text);
  }

  return result;
}

function buildTokenSet(...values) {
  return new Set(values.flatMap((value) => tokenizeText(value)).filter(Boolean));
}

function countOverlap(left, right) {
  let count = 0;
  for (const token of left) {
    if (right.has(token)) {
      count += 1;
    }
  }
  return count;
}

function scoreToken(token, signals) {
  let score = 0;

  if (!token) {
    return score;
  }

  if (signals.handleTokens.has(token)) {
    score += 5;
  }
  if (signals.sourceTitleTokens.has(token)) {
    score += 4;
  }
  if (signals.catalogTitleTokens.has(token)) {
    score += 4;
  }
  if (signals.productTypeTokens.has(token)) {
    score += 5;
  }
  if (signals.tagTokens.has(token)) {
    score += 4;
  }
  if (signals.collectionTokens.has(token)) {
    score += 4;
  }
  if (signals.bodyTokens.has(token)) {
    score += 2;
  }
  if (FAMILY_PRIORITY_WORDS.has(token)) {
    score += 3;
  }
  if (GENERIC_TITLE_WORDS.has(token)) {
    score -= 6;
  }
  if (/^\d+$/.test(token)) {
    score -= 4;
  }

  return score;
}

function buildPhraseCandidates(tokens, { maxLength = 3 } = {}) {
  const result = [];
  const windowSize = Math.min(maxLength, Math.max(1, tokens.length));

  for (let length = 1; length <= windowSize; length += 1) {
    for (let index = 0; index <= tokens.length - length; index += 1) {
      result.push(tokens.slice(index, index + length).join(" "));
    }
  }

  if (tokens.length <= 5) {
    result.push(tokens.join(" "));
  }

  return uniqueValues(
    result
      .map((entry) => normalizeComparableText(entry))
      .filter((entry) => entry && entry.length >= 2),
  );
}

function scorePhraseCandidate(phrase, signals) {
  const tokens = tokenizeText(phrase);
  if (!tokens.length) {
    return Number.NEGATIVE_INFINITY;
  }

  const meaningfulTokens = tokens.filter(
    (token) => token.length >= 3 && !GENERIC_TITLE_WORDS.has(token) && !/^\d+$/.test(token),
  );
  if (!meaningfulTokens.length) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;
  for (const token of tokens) {
    score += scoreToken(token, signals);
  }

  if (tokens.length === 1) {
    score += 3;
  } else if (tokens.length === 2) {
    score += 7;
  } else if (tokens.length === 3) {
    score += 6;
  } else {
    score -= (tokens.length - 3) * 3;
  }

  if (phrase.length <= 54) {
    score += 4;
  } else if (phrase.length <= 72) {
    score += 1;
  } else {
    score -= 10;
  }

  if (GENERIC_TITLE_PHRASES.some((pattern) => pattern.test(phrase))) {
    score -= 10;
  }

  return score;
}

function selectHandleFamilyPhrase(signals) {
  const handleText = normalizePlainText(signals.handle || [...signals.handleTokens].join(" "))
    .toLowerCase()
    .replace(/[-_]+/g, " ");
  const compactHandleText = handleText.replace(/\s+/g, "");
  const compactFamilyRules = [
    ["eyelashcurler", "Eyelash Curler"],
    ["lashcurler", "Eyelash Curler"],
    ["falseeyelash", "False Eyelashes"],
    ["falselashes", "False Eyelashes"],
    ["makeupmirror", "Makeup Mirror"],
    ["vanitymirror", "Makeup Mirror"],
    ["lipgloss", "Lip Gloss"],
    ["lipplumper", "Lip Gloss"],
    ["mascara", "Mascara"],
    ["hairclip", "Hair Clip"],
    ["barrette", "Hair Clip"],
    ["phonecase", "Phone Case"],
    ["hairdyeshampoo", "Hair Dye Shampoo"],
  ];
  const compactFamily = compactFamilyRules.find(([needle]) => compactHandleText.includes(needle));
  if (compactFamily) {
    return compactFamily[1];
  }
  const exactFamilies = [
    [/measuring\s+cup|measuring\s+jug/, "Measuring Cup"],
    [/camping\s+cook\s+kit|camping\s+pot\s+set|cook\s+kit/, "Camping Cookware Set"],
    [/facial\s+mist\s+sprayer|face\s+mist\s+sprayer/, "Facial Mist Sprayer"],
    [/lip\s+balm/, "Lip Balm"],
    [/hair\s+oil|anti\s+frizz\s+hair\s+oil/, "Hair Oil"],
    [/sport\s+outfit|sports?\s+suit|hooded\s+sweatshirt/, "Sports Outfit"],
    [/dog\s+nail\s+file|pet\s+nail\s+file/, "Dog Nail File"],
    [/raincoat|rain\s+coat|rain\s+poncho|rainwear/, "Raincoat"],
    [/screen\s+protector|tempered\s+glass|hydrogel\s+film/, "Screen Protector"],
    [/mouse\s+jiggler|mouse\s+mover|mouse\s+shaker/, "Mouse Jiggler"],
    [/mouse\s+ring|scrolling\s+ring|mouse\s+remote/, "Mouse Remote"],
    [/gaming\s+mouse|wired\s+mouse|wireless\s+mouse|bluetooth\s+mouse/, "Computer Mouse"],
    [/(?:case|cover).*iphone|iphone.*(?:case|cover)/, "iPhone Case"],
    [/eyelash\s+curler|lash\s+curler/, "Eyelash Curler"],
    [/false\s+eyelash|false\s+lashes/, "False Eyelashes"],
    [/makeup\s+mirror|vanity\s+mirror/, "Makeup Mirror"],
    [/lip\s+gloss|lip\s+plumper|lipstick/, "Lip Gloss"],
    [/blush\s+powder|blush\s+palette/, "Blush"],
    [/mascara/, "Mascara"],
    [/hair\s+clip|barrette/, "Hair Clip"],
    [/tassel\s+scarf|shawl|wrap\s+scarf|scarf/, "Tassel Scarf"],
    [/trench\s+coat|trench/, "Trench Coat"],
    [/cardigan/, "Cardigan"],
    [/half[- ]length\s+skirt|mid[- ]length\s+skirt|wraparound\s+skirt|skirt/, "Skirt"],
    [/\bt[- ]?shirt\b|\btee\b/, "T-Shirt"],
    [/bracelet/, "Bracelet"],
    [/phone\s+case/, "Phone Case"],
    [/trousers|pants/, "Pants"],
    [/perfume|fragrance/, "Perfume"],
  ];
  for (const [pattern, label] of exactFamilies) {
    const compactPattern = new RegExp(pattern.source.replace(/\\s\+/g, ""));
    if (pattern.test(handleText) || compactPattern.test(compactHandleText)) {
      return label;
    }
  }
  const meaningfulHandleTokens = [...signals.handleTokens].filter((token) => !GENERIC_TITLE_WORDS.has(token));
  const priorityIndex = meaningfulHandleTokens.findIndex((token) => FAMILY_PRIORITY_WORDS.has(token));
  if (priorityIndex >= 0) {
    const current = meaningfulHandleTokens[priorityIndex];
    const previous = meaningfulHandleTokens
      .slice(0, priorityIndex)
      .filter((token) => token !== "piece" && !/^\d+$/.test(token))
      .slice(-2);
    const next = meaningfulHandleTokens[priorityIndex + 1];
    const familyTokens = [...previous, current];

    if (next && FAMILY_PRIORITY_WORDS.has(next)) {
      if (familyTokens.length >= 3) {
        familyTokens.shift();
      }
      familyTokens.push(next);
    }

    if (familyTokens.length) {
      return titleCase(familyTokens.join(" "));
    }
  }

  const candidates = buildPhraseCandidates(meaningfulHandleTokens.length ? meaningfulHandleTokens : [...signals.handleTokens], {
    maxLength: 2,
  });
  if (!candidates.length) {
    return "";
  }

  let bestCandidate = "";
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    const score = scorePhraseCandidate(candidate, signals);
    if (score > bestScore || (score === bestScore && candidate.length < bestCandidate.length)) {
      bestCandidate = candidate;
      bestScore = score;
    }
  }

  return bestScore > Number.NEGATIVE_INFINITY ? titleCase(bestCandidate) : "";
}

// The source catalog contains many supplier-style handles that mention an
// adjacent object (for example, "sticker" in a phone mount or "bracelet" in
// a watch-strap handle). Resolve high-risk families from the canonical handle
// before the older phrase scorer can promote an incidental word.
function strictHandleText(signals) {
  return normalizePlainText(signals?.handle || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isRobeClothingHandle(handleText) {
  const h = normalizePlainText(handleText);
  return /\b(?:bathrobe|sleepwear|nightwear|loungewear|dressing gown|home clothes|kimono|pajamas?|pijamas?|robe)\b/i.test(h)
    && /\b(?:men|mens|man|male|bridegroom|women|womens|woman|female|ladies|couples?)\b/i.test(h)
    && !/\b(?:figurine|sculpture|statue|ornament|decor|decoration|model)\b/i.test(h);
}

function isMensOnlyRobeClothingHandle(handleText) {
  const h = normalizePlainText(handleText);
  return isRobeClothingHandle(h)
    && /\b(?:men|mens|man|male|bridegroom)\b/i.test(h)
    && !/\b(?:women|womens|woman|female|ladies|couples?)\b/i.test(h);
}

function isCouplesRobeClothingHandle(handleText) {
  const h = normalizePlainText(handleText);
  return isRobeClothingHandle(h)
    && /\b(?:couples?|men and women|women and men)\b/i.test(h);
}

function isRobeFigurineHandle(handleText) {
  const h = normalizePlainText(handleText);
  return /\b(?:figurine|sculpture|statue|ornament|decor|decoration|model)\b/i.test(h)
    && /\b(?:robe|cloak|kimono)\b/i.test(h);
}

function isMensTwoPieceRobeClothingHandle(handleText) {
  const h = normalizePlainText(handleText);
  return isMensOnlyRobeClothingHandle(h)
    && /\b(?:shorts|two[- ]piece|two pieces|set|sets)\b/i.test(h);
}

function strictHandleBrand(handleText) {
  const brands = [
    ["amazfit", "Amazfit"], ["garmin", "Garmin"], ["xiaomi", "Xiaomi"],
    ["redmi", "Redmi"], ["casio", "Casio"], ["fossil", "Fossil"],
    ["lenovo", "Lenovo"], ["lige", "LIGE"], ["sanda", "SANDA"],
    ["yikaze", "YIKAZE"], ["mijia", "Mijia"], ["logitech", "Logitech"], ["ugreen", "Ugreen"],
    ["kodak", "Kodak"], ["dji", "DJI"], ["ulanzi", "Ulanzi"],
  ];
  return brands.find(([needle]) => new RegExp(`\\b${needle}\\b`, "i").test(handleText))?.[1] || "";
}

function strictWatchModel(handleText) {
  const models = [
    [/amazfit\s+t\s*rex(?:\s+pro)?/i, "Amazfit T-Rex"],
    [/garmin\s+(?:vivoactive|venu|forerunner)/i, "Garmin"],
    [/casio\s+[a-z0-9-]+/i, "Casio"],
    [/(?:redmi|xiaomi)\s+band/i, "Xiaomi Band"],
    [/huami\s+amazfit\s+band/i, "Amazfit Band"],
    [/fossil\s+gen/i, "Fossil Gen"],
  ];
  return models.find(([pattern]) => pattern.test(handleText))?.[1] || "";
}

function strictPackCount(handleText) {
  return handleText.match(/\b(\d+)\s*(?:pcs?|pieces?|pairs?|rolls?|sheets?)\b/i)?.[1] || "";
}

function strictProductTypeForSignals(signals) {
  const h = strictHandleText(signals);
  if (!h) return "";

  if (/\b(?:xiaomi pad 7|mi pad 7|pad 7 pro)\b/i.test(h) && /\b(?:case|cover|pencil holder|rotation)\b/i.test(h)) return "Xiaomi Pad 7 and Pad 7 Pro rotating case with pencil holder";
  if (/\bsteelseries\b/i.test(h) && /\b(?:arctis|earpads?|earmuffs?|headphone)\b/i.test(h)) return "SteelSeries Arctis replacement earpads";
  if (/\bbglossy\b/i.test(h) && /\b(?:body serum|face serum|vitamin e|hyaluronic acid)\b/i.test(h)) return "BGlossy smoothing body and face serum";
  if (/\byoungcome\b/i.test(h) && /\b(?:ghk|copper peptide|collagen|niacinamide|hyaluronic acid)\b/i.test(h)) return "Youngcome GHK-Cu copper peptide facial serum";
  if (/\bsuyarun\b/i.test(h) && /\b(?:ghk|copper|firming|anti[- ]?aging)\b/i.test(h)) return "Suyarun GHK-Cu firming facial serum";
  if (/\bwatermelon glow\b/i.test(h) && /\b(?:niacinamide|pre[- ]?treatment|makeup)\b/i.test(h)) return "Watermelon Glow niacinamide pre-makeup serum";
  if (/\bpink lip serum\b/i.test(h) && /\b(?:plumping|hydrating|pigmented lips?)\b/i.test(h)) return "Pink lip plumping and hydrating serum";

  if (/\by1ub\b/i.test(h) && /\b(?:gaming|keyboard|keycap|backlit)\b/i.test(h)) return "Y1UB gaming mechanical-feel keyboard";
  if (/\bugreen\b/i.test(h) && /\b(?:type c|usb c|3[ .-]?5\s*mm|audio|dac)\b/i.test(h)) return "UGREEN USB-C to 3.5mm DAC audio cable";
  if (/\babzz\b/i.test(h) && /\b(?:rode|wireless go ii|3[ .-]?5\s*mm|usb c)\b/i.test(h)) return "ABZZ USB-C to 3.5mm TRS cable";
  if (/\binvisible selfie stick\b/i.test(h) && /\b(?:insta360|x3|x4|x5)\b/i.test(h)) return "Insta360 invisible selfie stick";
  if (/\b(?:tripod|selfie stick)\b/i.test(h) && /\b(?:phone|smartphone|camera)\b/i.test(h) && /\b(?:overhead|live stand|shooting|recording)\b/i.test(h)) return "overhead smartphone selfie-stick tripod";
  if (/\bmobile phone stand\b/i.test(h) && /\b(?:lying flat|leaning back|watch tv|bedroom|living room)\b/i.test(h)) return "bedside phone stand for lying-flat viewing";
  if (/\bewa magone\b/i.test(h) && /\b(?:magsafe|magnetic|ring|kickstand)\b/i.test(h)) return "EWA MagOne MagSafe phone ring stand";
  if (/\bgeometric earrings?\b/i.test(h) || (/\b(?:rose red|yellow|green|fluorescent)\b/i.test(h) && /\b earrings?\b/i.test(` ${h}`))) return "geometric candy-color statement earrings";
  if (/\b(?:bluetooth\s+(?:5\.3|6\.0)|bluetooth 6|audio receiver|audio wireless adapter)\b/i.test(h) && /\b(?:receiver|transmitter|adapter)\b/i.test(h)) return "Bluetooth audio receiver and transmitter with AUX";
  if (/\bvention jack 3[ .-]?5(?:\s*mm)? aux cable\b/i.test(h)) return "VENTION 3.5mm AUX audio cable";
  if (/\bwii to hdmi[- ]compatible converter\b/i.test(h)) return "Wii to HDMI-compatible converter with audio";
  if (/\bhdmi[- ]compatible to vga adapter\b/i.test(h)) return "HDMI-compatible to VGA adapter with audio";
  if (/\btype[- ]c female to 3[ .-]?5\s*mm jack male adapter\b/i.test(h)) return "USB-C female to 3.5mm male audio splitter adapter";
  if (/\btype[- ]c to 3[ .-]?5\s*mm aux adapter\b/i.test(h)) return "USB-C to 3.5mm AUX phone adapter";
  if (/\b(?:vention|toocki).*\b(?:rca|2rca|coaxial)\b.*\b(?:cable|cord)\b/i.test(h)) return `${/toocki/i.test(h) ? "Toocki" : "VENTION"} 3.5mm to dual RCA audio cable`;
  if (/\bvention jack 3[ .-]?5(?:\s*mm)? aux extension cable\b/i.test(h)) return "VENTION 3.5mm AUX extension cable";

  // Replacement parts first: case, band, bracelet, and model names are often
  // embedded in their supplier handles but are not the item being sold.
  if (/\bbiodance\b/i.test(h) && /\b(?:gel toner pads?|toner pads?|ampoule serum)\b/i.test(h)) return "Biodance gel toner pads";
  if (/\b(?:facial essence|salmon ampoule|ampoule serum)\b/i.test(h) && /\b(?:serum|essence|ampoule)\b/i.test(h)) return "salmon ampoule facial serum";
  if (/\bwilliam morris\b/i.test(h) && /\b(?:cotton|fabric|textiles?)\b/i.test(h)) return "William Morris cotton fabric";
  if (/\bhair claw\b/i.test(h) && /\b(?:furry|plush|clips?)\b/i.test(h)) return "furry flower hair claw clips";
  if (/\bchildrens shirt 2025 spring cartoon\b/i.test(h)) return "children's long-sleeve cartoon shirt";
  if (/\bjeans for men harem torn\b/i.test(h)) return "loose harem jeans";
  if (/\bwashed ripped straight leg jeans four seasons\b/i.test(h) && /\b(?:ladies|women)\b/i.test(h)) return "women's washed ripped straight-leg jeans";
  if (/\bfashion elegant women dress loose casual dress women dress new temperament\b/i.test(h)) return "elegant loose casual dress";
  if (/\bwhite blouse for women 2026\b/i.test(h) && /\b(?:bow|sleeveless|blouse|tops?)\b/i.test(h)) return "bow-detail sleeveless blouse";
  if (/\bface cream\b/i.test(h) && /\b(?:skin tone|dark spots?|dullness|whitening)\b/i.test(h)) return "even-tone face cream";
  if (/\bjeans for men 2025 new loose straight leg winter\b/i.test(h)) return "loose straight-leg jeans";
  if (/\bm10\b/i.test(h) && /\b(?:wireless|bluetooth|earbuds?|earphones?)\b/i.test(h)) return "M10 wireless Bluetooth earbuds";
  if (/\bkz edx\b/i.test(h)) return "KZ EDX Pro X in-ear earphones";
  if (/\br69 plus\b/i.test(h) && /\b(?:smart tv|android|set top|home video)\b/i.test(h)) return "R69 Plus Android smart TV box";
  if (/\bstriped\b/i.test(h) && /\b(?:one shoulder|one word shoulder|long sleeve|long sleeved)\b/i.test(h)) return "striped one-shoulder long-sleeve top";
  if (/\b(?:ipad|ipad air|ipad pro)\b/i.test(h) && /\b(?:case|cover|flip|trifold|stand)\b/i.test(h)) return "iPad protective case";
  if (/\b(?:watch case|watch cover|protective cover)\b/i.test(h) && /\b(?:huawei|honor|choice|rossini|2i|hard pc|full coverage)\b/i.test(h)) return "watch protective case";
  if (/\b(?:skin tint|tinted serum|foundation balm|contour stick)\b/i.test(h) && /\bstick\b/i.test(h)) return "skin tint and contour stick";
  if (/\b(?:diamond|pearlescent)\b/i.test(h) && /\blipsticks?\b/i.test(h)) return "pearlescent lipstick";
  if (/\b(?:heating suit|heated trouser|heated vest|heated jacket|heated gloves?)\b/i.test(h) && /\b(?:5v|5000mah|powerbank|external powerbank|battery)\b/i.test(h)) return "heated clothing battery pack";
  if (/\b(?:airpods?|air pods)\b/i.test(h) && /\b(?:ear tips?|eartips?|ear caps?|silicone)\b/i.test(h)) return "AirPods Pro replacement ear tips";
  if (/\bjbl\b/i.test(h) && /\b(?:earpads?|ear pads?|earmuffs?)\b/i.test(h)) return "JBL Tune replacement earpads";
  if (/(?:watch band|watch strap|watchband|replacement strap)\b/i.test(h)) return "watch strap";
  if (/\b(?:earpads?|ear pads?|earphone pads?|headphone pads?)\b/i.test(h)) return "headphone replacement earpads";
  if (/\b(?:ear tips?|eartips?|ear caps?)\b/i.test(h)) return "earbud replacement ear tips";
  if (/\b(?:ear hooks?|anti lost ear hooks?)\b/i.test(h)) return "earbud ear hooks";
  if (isRobeFigurineHandle(h)) return "seated man figurine in a robe";
  if (isCouplesRobeClothingHandle(h)) return "couples' printed kimono robe";
  if (isMensTwoPieceRobeClothingHandle(h)) return "men's satin two-piece pajama set";
  if (isMensOnlyRobeClothingHandle(h)) return "men's satin bathrobe";
  if (/\bmens?\s+led\s+square\s+watch\s+and\s+jewelry\s+set\b/i.test(h)) return "LED square watch and jewelry set";

  if (/\b(?:smart glasses|shooting glasses)\b/i.test(h) && /\b(?:camera|bluetooth|translation)\b/i.test(h)) return "smart glasses";
  if (/\b(?:smartwatch|smart watch)\b/i.test(h) && !/watch strap|watchband/i.test(h)) return "smart watch";
  if (/\b(?:neck fan|wearable neck)\b/i.test(h)) return "neck fan";
  if (/\b(?:car cleaning|car wash)\b/i.test(h) && /\b(?:brush|cleaning kit|drill brush)\b/i.test(h)) return "car cleaning brush kit";
  if (/\bsmart bracelet\b/i.test(h) && !/bracelet accessories|charm bracelet/i.test(h)) return "smart bracelet";
  if (/\banime\b.*\bbracelet\b|\bbracelet\b.*\banime\b/i.test(h)) return "anime character bracelet";
  if (/\b(?:beads?|spacer beads?)\b/i.test(h) && /\b(?:jewelry making|diy|loose)\b/i.test(h)) return "jewelry-making beads";
  if (/\b(?:necklace|earrings?|bracelet)\b/i.test(h) && /\b(?:jewelry set|3 piece set|3-piece set|brides?|weddings?)\b/i.test(h)) return "jewelry set";

  if (/\b(?:lip liner|lipliner)\b/i.test(h)) return "lip liner set";
  if (/\b(?:face body paint|face and body paint|body paint|face paint)\b/i.test(h)) return "face and body paint kit";
  if (/\b(?:cosmetic|makeup) organizer\b|\b(?:cosmetic|makeup) storage\b/i.test(h)) return "makeup organizer";
  if (/\b(?:cable organizer|wire organizer|cord management|cable routing)\b/i.test(h)) return "cable organizer";
  if (/\bthermal printer sticker paper\b/i.test(h)) return "thermal printer sticker paper";
  if (/\b(?:wall stickers?|card sticker)\b/i.test(h)) return "decorative stickers";
  if (/\b(?:journal|scrapbook|notebook|stationery|landscape|scenery)\b.*\bstickers?\b|\bstickers?\b.*\b(?:journal|scrapbook|notebook|stationery|landscape|scenery)\b/i.test(h) && !/phone holder|speaker|body paint|fidget|keychain/i.test(h)) return "sticker set";
  if (/\b(?:diamond painting|diamond mosaic|rhinestone painting|mosaic painting)\b/i.test(h)) return "diamond painting kit";
  if (/\b(?:witch hat|salt pepper|spice)\b.*\b(?:jar|container)\b|\b(?:jar|container)\b.*\b(?:witch hat|salt pepper|spice)\b/i.test(h)) return "storage jar";
  if (/\b(?:ring settings?|blank base|cabochon.*bezels?)\b/i.test(h) && /\b(?:ring|bezels?)\b/i.test(h)) return "ring blank setting";
  if (/\b(?:skincare set|skin care set)\b/i.test(h) && /\b(?:toner|cream|sunscreen|serum)\b/i.test(h)) return "skincare set";

  if (/\b(?:makeup brush cleaner|cosmetic brush cleaner)\b/i.test(h)) return "makeup brush cleaner";
  if (/\b(?:foundation|concealer)\b.*\b(?:brush|blender)\b|\b(?:brush|blender)\b.*\b(?:foundation|concealer)\b/i.test(h)) return "foundation makeup brush";
  if (/\b(?:makeup brush|cosmetic brush|eyeshadow brush|eyelash brush)\b/i.test(h) && !/organizer|cleaner/i.test(h)) return "makeup brush set";
  if (/\b(?:precision tweezers?|tweezers?)\b/i.test(h)) return "beauty tweezers";

  if (/\b(?:phone pouch|phone sleeve|waterproof.*phone.*(?:pouch|case)|phone.*(?:pouch|sleeve))\b/i.test(h)) return "waterproof phone pouch";
  if (/\b(?:phone case|iphone case|tablet case)\b|(?:case|cover).*\b(?:iphone|ipad|tablet)\b|\b(?:iphone|ipad|tablet)\b.*\b(?:case|cover)\b/i.test(h)) return "phone case";
  if (/\b(?:phone holder|phone stand|phone mount|cell phone stand)\b/i.test(h)) return "phone holder";
  if (/\b(?:computer mouse|wireless mouse|bluetooth mouse|gaming mouse)\b/i.test(h)) return "computer mouse";
  if (/\b(?:camera|camcorder)\b/i.test(h) && !/smartwatch|smart glasses|phone case|lens filter/i.test(h)) return "camera";
  if (/\b(?:backpack|rucksack|daypack)\b/i.test(h)) return "backpack";
  if (/\b(?:squeegee|window cleaning|glass cleaning)\b/i.test(h)) return "window and glass squeegee";
  if (/\b(?:inflatable|air) mattress\b|\bmattress\b.*\b(?:camping|sleeping)\b/i.test(h)) return "inflatable camping mattress";
  if (/\b(?:thermos|tumbler|water bottle)\b/i.test(h)) return "insulated drink bottle";

  if (/\b(?:t shirt|tee)\b/i.test(h)) return "t-shirt";
  if (/\b(?:button down shirts?|blouses?)\b/i.test(h)) return "shirt";
  if (/\bdress\b/i.test(h)) return "dress";
  if (/\bnecklace\b/i.test(h)) return "necklace";
  if (/\b(?:earrings?|ear studs?)\b/i.test(h)) return "earrings";
  if (/\b(?:brooch|lapel pin)\b/i.test(h)) return "brooch";
  if (/\b(?:bangle|bracelet)\b/i.test(h)) return "bracelet";
  return "";
}

function buildStrictHandleTitle(signals) {
  const h = strictHandleText(signals);
  if (!h) return "";
  const brand = strictHandleBrand(h);

  if (/\bnight vision binoculars\b/i.test(h) && /\binfrared\b/i.test(h)) return "4K Infrared Night-Vision Binoculars with Digital Zoom";
  if (/\bwood kitchenware\b/i.test(h) && /\bcooking set\b/i.test(h)) return "Wooden Kitchen Utensil Set for Cooking and Baking";
  if (/\bcamping wine cooler bags?\b/i.test(h) && /\binsulated\b/i.test(h)) return "Insulated Wine Cooler Tote Bag for Travel";
  if (/\bfood storage set\b/i.test(h) && /\bairtight containers?\b/i.test(h)) return "Airtight Food Storage Container Set with Labels";
  if (/\bpoco f5\b/i.test(h) && /\bcase\b/i.test(h)) return "Liquid-Silicone Protective Case for POCO F5 and F5 Pro";
  if (/\bugreen hdmi\b/i.test(h) && /\bcable\b/i.test(h)) return "UGREEN High-Speed HDMI Cable for 4K and 8K";
  if (/\bbambu lab\b/i.test(h) && /\bbuild plate\b/i.test(h)) return "Bambu Lab Double-Sided Replacement Build Plate";
  if (/\bports usb\b/i.test(h) && /\bhub\b/i.test(h)) return "Multi-Port USB Hub for Laptop and Computer";
  if (/\blenovo idea tab pro\b/i.test(h) && /\bcase\b/i.test(h)) return "Magnetic Folding Case for Lenovo Idea Tab Pro";
  if (/\bsandisk cz50\b/i.test(h) && /\bflash drive\b/i.test(h)) return "SanDisk CZ50 USB Flash Drive with Capacity Options";
  if (/\btri glide slider\b/i.test(h) && /\bbackpack accessories\b/i.test(h)) return "Tri-Glide Slider Buckle for Backpack Straps";
  if (/\bmicrofiber towel\b/i.test(h) && /\bquick dry\b/i.test(h)) return "Quick-Dry Microfiber Towel for Travel and Gym";
  if (/\bbody art face painting\b/i.test(h) && /\bmakeup sponge\b/i.test(h)) return "Face and Body Paint Makeup Sponge Set";
  if (/\bunderwear organizers?\b/i.test(h) && /\bsocks?\b/i.test(h)) return "Drawer Organizer for Underwear, Socks, and Bras";
  if (/\bperfume organizer\b/i.test(h) && /\b3[- ]?tier\b/i.test(h)) return "Three-Tier Perfume Organizer with Drawers";
  if (/\b(?:xiaomi pad 7|mi pad 7|pad 7 pro)\b/i.test(h) && /\b(?:case|cover|pencil holder|rotation)\b/i.test(h)) return "Xiaomi Pad 7 and Pad 7 Pro Rotating Case with Pencil Holder";
  if (/\bsteelseries\b/i.test(h) && /\b(?:arctis|earpads?|earmuffs?|headphone)\b/i.test(h)) return "SteelSeries Arctis Replacement Earpads";
  if (/\bbglossy\b/i.test(h) && /\b(?:body serum|face serum|vitamin e|hyaluronic acid)\b/i.test(h)) return "BGlossy Smoothing Body and Face Serum";
  if (/\byoungcome\b/i.test(h) && /\b(?:ghk|copper peptide|collagen|niacinamide|hyaluronic acid)\b/i.test(h)) return "Youngcome GHK-Cu Copper Peptide Facial Serum";
  if (/\bsuyarun\b/i.test(h) && /\b(?:ghk|copper|firming|anti[- ]?aging)\b/i.test(h)) return "Suyarun GHK-Cu Firming Facial Serum for All Skin Types";
  if (/\bwatermelon glow\b/i.test(h) && /\b(?:niacinamide|pre[- ]?treatment|makeup)\b/i.test(h)) return "Watermelon Glow Niacinamide Pre-Makeup Serum";
  if (/\bpink lip serum\b/i.test(h) && /\b(?:plumping|hydrating|pigmented lips?)\b/i.test(h)) return "Pink Lip Plumping and Hydrating Serum";

  if (/\bwilliam morris\b/i.test(h) && /\b(?:cotton|fabric|textiles?)\b/i.test(h)) return "William Morris Vintage Floral Cotton Fabric";
  if (/\bhair claw\b/i.test(h) && /\b(?:furry|plush|clips?)\b/i.test(h)) return "Furry Flower Hair Claw Clips";
  if (/\bchildrens shirt 2025 spring cartoon\b/i.test(h)) return "Children's Long-Sleeve Cartoon Shirt";
  if (/\bjeans for men harem torn\b/i.test(h)) return "Men's Loose Harem Jeans with Torn Vintage Detail";
  if (/\bwashed ripped straight leg jeans four seasons\b/i.test(h) && /\b(?:ladies|women)\b/i.test(h)) return "Women's Washed Ripped Straight-Leg Jeans";
  if (/\bfashion elegant women dress loose casual dress women dress new temperament\b/i.test(h)) return "Women's Elegant Loose Casual Dress";
  if (/\bwhite blouse for women 2026\b/i.test(h) && /\b(?:bow|sleeveless|blouse|tops?)\b/i.test(h)) return "Women's Bow-Detail Sleeveless Blouse";
  if (/\bface cream\b/i.test(h) && /\b(?:skin tone|dark spots?|dullness|whitening)\b/i.test(h)) return "Daily Face Cream for Even-Looking Skin Tone";
  if (/\bjeans for men 2025 new loose straight leg winter\b/i.test(h)) return "Men's Loose Straight-Leg Jeans for Winter Workwear";
  if (/\bm10\b/i.test(h) && /\b(?:wireless|bluetooth|earbuds?|earphones?)\b/i.test(h)) return "M10 Wireless Bluetooth Earbuds";
  if (/\bkz edx\b/i.test(h)) return "KZ EDX Pro X In-Ear Earphones";
  if (/\br69 plus\b/i.test(h) && /\b(?:smart tv|android|set top|home video)\b/i.test(h)) return "R69 Plus Android 14 Smart TV Box with Wi-Fi 6";
  if (/\bstriped\b/i.test(h) && /\b(?:one shoulder|one word shoulder|long sleeve|long sleeved)\b/i.test(h)) return "Striped One-Shoulder Long-Sleeve Top";
  if (/\by1ub\b/i.test(h) && /\b(?:gaming|keyboard|keycap|backlit)\b/i.test(h)) return "Y1UB Gaming Mechanical Keyboard with Backlit Round Keycaps";
  if (/\bugreen\b/i.test(h) && /\b(?:type c|usb c|3[ .-]?5\s*mm|audio|dac)\b/i.test(h)) return "UGREEN USB-C to 3.5mm DAC Audio Cable";
  if (/\babzz\b/i.test(h) && /\b(?:rode|wireless go ii|3[ .-]?5\s*mm|usb c)\b/i.test(h)) return "ABZZ USB-C to 3.5mm TRS Cable for RODE Wireless GO II";
  if (/\binvisible selfie stick\b/i.test(h) && /\b(?:insta360|x3|x4|x5)\b/i.test(h)) return "Insta360 Invisible Selfie Stick for X3, X4, and X5";
  if (/\b(?:tripod|selfie stick)\b/i.test(h) && /\b(?:phone|smartphone|camera)\b/i.test(h) && /\b(?:overhead|live stand|shooting|recording)\b/i.test(h)) return "Overhead Smartphone Selfie Stick and Tripod";
  if (/\bmobile phone stand\b/i.test(h) && /\b(?:lying flat|leaning back|watch tv|bedroom|living room)\b/i.test(h)) return "Adjustable Bedside Phone Stand for Lying-Flat Viewing";
  if (/\bewa magone\b/i.test(h) && /\b(?:magsafe|magnetic|ring|kickstand)\b/i.test(h)) return "EWA MagOne MagSafe Phone Ring Stand and Grip";
  if (/\bgeometric earrings?\b/i.test(h) || (/\b(?:rose red|yellow|green|fluorescent)\b/i.test(h) && /\b earrings?\b/i.test(` ${h}`))) return "Geometric Candy-Color Statement Earrings";
  if (/\b(?:bluetooth\s+(?:5\.3|6\.0)|bluetooth 6|audio receiver|audio wireless adapter)\b/i.test(h) && /\b(?:receiver|transmitter|adapter)\b/i.test(h)) {
    const version = h.match(/\bbluetooth\s*(5\.3|6\.0)\b/i)?.[1] || "";
    return `Bluetooth${version ? ` ${version}` : ""} Audio Receiver and Transmitter with AUX`;
  }
  if (/\bvention jack 3[ .-]?5(?:\s*mm)? aux cable\b/i.test(h)) return "VENTION 3.5mm AUX Audio Cable for Guitar, Car, and Headphones";
  if (/\bwii to hdmi[- ]compatible converter\b/i.test(h)) return "Wii to HDMI-Compatible Converter with 3.5mm Audio";
  if (/\bhdmi[- ]compatible to vga adapter\b/i.test(h)) return "HDMI-Compatible to VGA Adapter with 3.5mm Audio";
  if (/\btype[- ]c female to 3[ .-]?5\s*mm jack male adapter\b/i.test(h)) return "USB-C Female to 3.5mm Male Audio Splitter Adapter";
  if (/\btype[- ]c to 3[ .-]?5\s*mm aux adapter\b/i.test(h)) return "USB-C to 3.5mm AUX Adapter for Phones and Earphones";
  if (/\b(?:vention|toocki).*\b(?:rca|2rca|coaxial)\b.*\b(?:cable|cord)\b/i.test(h)) return `${/toocki/i.test(h) ? "Toocki" : "VENTION"} 3.5mm to Dual RCA Audio Cable`;
  if (/\bvention jack 3[ .-]?5(?:\s*mm)? aux extension cable\b/i.test(h)) return "VENTION 3.5mm AUX Extension Cable for Car and PC";
  if (isRobeFigurineHandle(h)) return "Seated Man Figurine in a Black Robe";
  if (isCouplesRobeClothingHandle(h)) return "Couples' Printed Kimono Robe for Home Wear";
  if (isMensTwoPieceRobeClothingHandle(h)) return "Men's Satin Two-Piece Pajama Set";
  if (isMensOnlyRobeClothingHandle(h)) {
    const color = /\bnavy blue\b/i.test(h) ? "Navy Blue " : /\bblack\b/i.test(h) ? "Black " : "";
    const material = /\bsilk\b/i.test(h) && /\bsatin\b/i.test(h) ? "Silk-Satin " : /\bsatin\b/i.test(h) ? "Satin " : "";
    return `Men's ${color}${material}Bathrobe Kimono for Lounging`.replace(/\s+/g, " ").trim();
  }

  if (/(?:watch band|watch strap|watchband|replacement strap)\b/i.test(h)) {
    const material = /\bleather\b/i.test(h) ? "Leather" : /\bnylon\b/i.test(h) ? "Nylon" : /\bsilicone\b/i.test(h) ? "Silicone" : /\bmetal|stainless steel\b/i.test(h) ? "Metal" : "Replacement";
    const model = strictWatchModel(h);
    const width = h.match(/\b(\d{2})\s*mm\b/i)?.[1];
    return `${material === "Replacement" ? "Replacement" : `${material} Replacement`} Watch Strap${model ? ` for ${model}` : ""}${width && !model ? `, ${width}mm` : ""}`;
  }

  if (/\bmens?\s+led\s+square\s+watch\s+and\s+jewelry\s+set\b/i.test(h)) {
    return "Men's LED Square Watch and Jewelry Set";
  }

  if (/\becg\s+ppg\b/i.test(h) && /\b(?:smartwatch|smart watch)\b/i.test(h)) {
    return "ECG and PPG Bluetooth Call Smart Watch with Health Tracking";
  }
  if (/\blige\b/i.test(h) && /\b(?:smartwatch|smart watch)\b/i.test(h)) {
    return "LIGE Fitness Smart Watch with Heart-Rate Monitoring";
  }
  if (/\bfull\s+touch\s+screen\b/i.test(h) && /\b(?:message|music|call)\b/i.test(h) && /\b(?:smartwatch|smart watch)\b/i.test(h)) {
    return "Full-Touch Smart Watch with Calls, Messages, and Music Control";
  }
  if (/\bht30\b/i.test(h) && /\b(?:smartwatch|smart watch)\b/i.test(h)) {
    return "HT30 Bluetooth Call Smart Watch with 1.44-Inch Color Display";
  }

  if (/\b(?:smart glasses|shooting glasses)\b/i.test(h) && /\b(?:camera|bluetooth|translation)\b/i.test(h)) {
    const features = [/[0-9]+w|[0-9]+mp|camera/i.test(h) ? "Built-In Camera" : "", /bluetooth/i.test(h) ? "Bluetooth" : "", /translation/i.test(h) ? "Translation" : ""]
      .filter(Boolean).slice(0, 2).join(" and ");
    return `${brand ? `${brand} ` : ""}Smart Glasses${features ? ` with ${features}` : ""}`;
  }

  if (/\b(?:smartwatch|smart watch)\b/i.test(h) && !/watch strap|watchband/i.test(h)) {
    const model = h.match(/\b(?:m|s|k|f|t[- ]?rex)\s*\d+[a-z0-9-]*/i)?.[0] || "";
    const specs = [
      /amoled/i.test(h) ? "AMOLED Display" : /touch screen|full touch/i.test(h) ? "Touch Display" : "",
      /gps/i.test(h) ? "GPS" : /fitness|sports|pedometer/i.test(h) ? "Fitness Tracking" : "",
      /bluetooth|call|message/i.test(h) ? "Bluetooth Calls" : "",
    ].filter(Boolean).slice(0, 2).join(" and ");
    return `${model ? `${titleCase(model)} ` : brand ? `${brand} ` : ""}Smart Watch${specs ? ` with ${specs}` : ""}`;
  }

  if (/\bbiodance\b/i.test(h) && /\b(?:gel toner pads?|toner pads?|ampoule serum)\b/i.test(h)) {
    return "Biodance Gel Toner Pads with Ampoule Serum";
  }
  if (/\b(?:facial essence|salmon ampoule|ampoule serum)\b/i.test(h) && /\b(?:serum|essence|ampoule)\b/i.test(h)) {
    return "Salmon Ampoule Hydrating Facial Serum";
  }
  if (/\b(?:ipad|ipad air|ipad pro)\b/i.test(h) && /\b(?:case|cover|flip|trifold|stand)\b/i.test(h)) {
    return "iPad Air and iPad Pro Trifold Case with Pencil Holder";
  }
  if (/\b(?:watch case|watch cover|protective cover)\b/i.test(h) && /\b(?:huawei|honor|choice|rossini|2i|hard pc|full coverage)\b/i.test(h)) {
    return "Huawei Honor Choice Rossini 2i Watch Protective Case";
  }
  if (/\b(?:skin tint|tinted serum|foundation balm|contour stick)\b/i.test(h) && /\bstick\b/i.test(h)) {
    return "Waterproof Skin Tint and Contour Foundation Stick";
  }
  if (/\b(?:diamond|pearlescent)\b/i.test(h) && /\blipsticks?\b/i.test(h)) {
    return "Diamond Pearlescent Waterproof Lipstick";
  }
  if (/\b(?:heating suit|heated trouser|heated vest|heated jacket|heated gloves?)\b/i.test(h) && /\b(?:5v|5000mah|powerbank|external powerbank|battery)\b/i.test(h)) {
    const capacity = h.match(/\b\d{4,6}\s*mah\b/i)?.[0]?.replace(/mah/i, "mAh") || "";
    const voltage = h.match(/\b\d+(?:\.\d+)?v\b/i)?.[0]?.toUpperCase() || "";
    return `${[voltage, capacity, "Batie Heated Clothing Power Bank"].filter(Boolean).join(" ")}`;
  }
  if (/\b(?:airpods?|air pods)\b/i.test(h) && /\b(?:ear tips?|eartips?|ear caps?|silicone)\b/i.test(h)) {
    return "AirPods Pro Replacement Silicone Ear Tips";
  }
  if (/\bjbl\b/i.test(h) && /\b(?:earpads?|ear pads?|earmuffs?)\b/i.test(h)) {
    return "JBL Tune Replacement Earpads";
  }

  if (/articulated arm.*(?:hex pin|female thread)|(?:hex pin|female thread).*articulated arm/i.test(h)) {
    return "3-Section Articulated Camera Arm with 5/8 Hex Pin and Female Threads";
  }
  if (/(?:3[ .-]?5\s*mm|35mm).*?(?:aux|audio).*cable.*(?:xh2|terminal)|(?:aux|audio).*cable.*(?:xh2|terminal)/i.test(h)) {
    return "3.5mm AUX Audio Cable with XH2.54 3-Pin Male Terminals";
  }
  if (/\b(?:stream deck|lcd keys?|customizable keys?|livestreaming board)\b/i.test(h)) {
    return "LCD Stream Deck Keyboard with Customizable Shortcut Keys";
  }
  if (/\bkeyboard\s+(?:case|cover)\b/i.test(h) && /\b(?:redmi pad|xiaomi redmi pad)\b/i.test(h)) {
    return "Xiaomi Redmi Pad 2 Keyboard Case with Pencil Slot";
  }
  if (/\belectric piano\b/i.test(h) && /\bkeyboard\b/i.test(h)) {
    const keys = h.match(/\b\d+\s*(?:key|keys)\b/i)?.[0] || "";
    const keyLabel = keys ? `${keys.replace(/\s*(?:key|keys)$/i, "")}-Key ` : "";
    return `${keyLabel}Kids' Electric Piano with Microphone`;
  }
  if (/(?:powerbank|power bank|external battery)/i.test(h)) {
    const capacity = h.match(/\b\d{4,6}\s*mah\b/i)?.[0] || "";
    return `${capacity ? `${capacity} ` : ""}${/magnetic|magsafe/i.test(h) ? "Magnetic " : ""}${/wireless/i.test(h) ? "Wireless " : ""}Power Bank`.replace(/\s+/g, " ").trim();
  }
  if (/\bvention\s+usb\s+3\s+0\s+extension\s+cable\b/i.test(h) && /\bmale\s+to\s+male\b/i.test(h)) {
    return "VENTION USB 3.0 Type-A Male-to-Male Extension Cable";
  }
  if (/\b5gbps\s+usb\s+3\s+0\s+extension\s+cable\b/i.test(h) && /\bmale\s+to\s+female\b/i.test(h)) {
    return "5Gbps USB 3.0 Male-to-Female Extension Cable";
  }
  if (/\busb\s+extension\s+cable\b/i.test(h) && /\b1m\b.*\b2m\b.*\b3\s+0m\b/i.test(h)) {
    return "USB 3.0 Extension Cable with 1m, 2m, and 3m Options";
  }
  if (/\bvention\s+usb\s+3\s+0\s+extension\s+cable\b/i.test(h) && /\bmale\s+to\s+female\b/i.test(h)) {
    return "VENTION USB 3.0 Male-to-Female Extension Cable";
  }
  if (/\bkeychains?\b|\bkey fob\b/i.test(h) && !/\bkeychain case\b/i.test(h)) {
    if (/\bmashle\b/i.test(h)) return "Mashle Magic and Muscles Anime Keychain";
    if (/\b(?:volleyball|haikyuu)\b/i.test(h)) return "Haikyuu Volleyball Anime Acrylic Keychain";
    if (/\bmidna\b/i.test(h)) return "Midna Chibi Anime Keychain";
    if (/\bdanganronpa\b/i.test(h)) return "Danganronpa Anime Game Keychain";
    return `${/anime|manga/i.test(h) ? "Anime " : /embroidered/i.test(h) ? "Embroidered " : "Decorative "}Keychain for Keys and Bags`;
  }
  if (/\b(?:messenger|sling|crossbody|bumbag)\b/i.test(h) && /\b(?:bag|backpack|packet)\b/i.test(h)) {
    return `${/waterproof/i.test(h) ? "Waterproof " : ""}${/messenger/i.test(h) ? "Messenger" : "Crossbody"} Bag for Everyday Carry`;
  }
  if (/\b(?:stand|riser|elevated)\b/i.test(h) && /\bkeyboard\b/i.test(h)) {
    return "Raised Keyboard Stand and Desk Riser";
  }
  if (/\b(?:castor|essential|hair oil|scalp oil)\b/i.test(h) && /\boil\b/i.test(h)) {
    const capacity = h.match(/\b\d+\s*ml\b/i)?.[0] || "";
    return `${capacity ? `${capacity} ` : ""}${/castor/i.test(h) ? "Castor " : /essential/i.test(h) ? "Essential " : "Nourishing Hair "}Oil for Hair and Skin Care`.replace(/\s+/g, " ").trim();
  }
  if (/\b(?:tripod|selfie stick)\b/i.test(h) && /\b(?:phone|smartphone|camera)\b/i.test(h)) {
    const height = h.match(/\b\d{3,4}\s*mm\b/i)?.[0] || "";
    return `${height ? `${height} ` : ""}${/selfie stick/i.test(h) ? "Smartphone Selfie Stick and Tripod" : "Smartphone and Camera Tripod"}${/wireless|bluetooth/i.test(h) ? " with Wireless Shutter" : ""}`.trim();
  }
  if (/\b(?:mouse ?pad|mouse ?mat|desk mat|desk carpet)\b/i.test(h)) {
    const size = h.match(/\b\d{2,4}\s*[x×]\s*\d{2,4}\s*(?:cm|mm)?\b/i)?.[0] || "";
    const style = /gaming|gamer/i.test(h) ? "Gaming " : /anime|pokemon|gengar/i.test(h) ? "Anime " : "Desk ";
    return `${size ? `${size} ` : ""}${style}Mouse Pad`.trim();
  }
  if (/\b(?:wrist rest|wrist support|wrist cushion)\b/i.test(h) && /\b(?:keyboard|mouse|computer)\b/i.test(h)) {
    return `${/memory foam/i.test(h) ? "Memory-Foam " : ""}Keyboard and Mouse Wrist Rest Pad`;
  }
  if (/\bkeyboard\b/i.test(h)) {
    if (/coiled|aviator|detachable/i.test(h) && /\bcable\b/i.test(h)) return "Coiled USB Keyboard Cable with Detachable Aviator Connector";
    if (/air mouse|touchpad|touch pad/i.test(h) && /wireless|bluetooth/i.test(h)) return "Wireless Keyboard and Air Mouse with Touchpad";
    const features = [/mechanical/i.test(h) ? "Mechanical" : /gaming/i.test(h) ? "Gaming" : "", /wireless|bluetooth/i.test(h) ? "Wireless" : "", /backlit|rgb/i.test(h) ? "Backlit" : ""].filter(Boolean).slice(0, 2).join(" ");
    return `${features ? `${features} ` : ""}Keyboard`.trim();
  }
  if (/\b(?:computer mouse|wireless mouse|bluetooth mouse|gaming mouse|mouse remote)\b/i.test(h) && !/mouse ?pad|mouse ?mat/i.test(h)) {
    const features = [/gaming/i.test(h) ? "Gaming" : "", /wireless|bluetooth/i.test(h) ? "Wireless" : "", /silent/i.test(h) ? "Silent" : ""].filter(Boolean).slice(0, 2).join(" ");
    return `${features ? `${features} ` : ""}Computer Mouse`.trim();
  }

  if (/(?:watch|wristwatch|chronograph|quartz watch|digital watch|analog watch)/i.test(h) &&
      !/watch band|watch strap|watchband|replacement strap|watch box|watch organizer|jewelry set|smartwatch|smart watch|power bank|battery|charger|blanket|duvet|phone/i.test(h)) {
    const watchBrand = brand && !/synoke/i.test(brand) ? brand : "";
    const model = h.match(/\b(?:f91w|y68|8291|2156|116plus|terrax|triton)\b/i)?.[0] || "";
    const audience = /\b(?:men|mens|man|male)\b/i.test(h) && !/\b(?:women|womens|woman|female|ladies|girls?|kids?|children)\b/i.test(h)
      ? "Men's "
      : /\b(?:women|womens|woman|female|ladies)\b/i.test(h) && !/\b(?:men|mens|man|male)\b/i.test(h)
        ? "Women's "
        : /\b(?:men|mens|man|male)\b/i.test(h) && /\b(?:women|womens|woman|female|ladies)\b/i.test(h)
          ? "Unisex "
          : "";
    const mechanism = /chronograph/i.test(h) ? "Chronograph" : /quartz/i.test(h) ? "Quartz" : /digital|electronic|led/i.test(h) ? "Digital" : "Analog";
    const features = [/waterproof|water resistant/i.test(h) ? "Water-Resistant" : "", /solar/i.test(h) ? "Solar-Powered" : "", /leather/i.test(h) ? "Leather Strap" : /stainless steel|steel band/i.test(h) ? "Steel Strap" : ""].filter(Boolean).slice(0, 2).join(" ");
    return `${watchBrand ? `${watchBrand} ` : ""}${model ? `${model.toUpperCase()} ` : ""}${audience}${mechanism} Wristwatch${features ? ` with ${features}` : ""}`.replace(/\s+/g, " ").trim();
  }

  if (/\b(?:neck fan|wearable neck)\b/i.test(h)) return `Wearable Bladeless Neck Fan${/led display|display screen/i.test(h) ? " with LED Display" : /usb|rechargeable/i.test(h) ? " with USB Charging" : ""}`;
  if (/\b(?:car cleaning|car wash)\b/i.test(h) && /\b(?:brush|cleaning kit|drill brush)\b/i.test(h)) {
    const count = strictPackCount(h);
    return `${count ? `${count}-Piece ` : ""}Car Cleaning Brush Kit with Drill Attachment`;
  }
  if (/\bsmart bracelet\b/i.test(h) && !/bracelet accessories|charm bracelet/i.test(h)) {
    const features = [
      /waterproof/i.test(h) ? "Waterproof" : "",
      /pedometer|running|fitness/i.test(h) ? "Fitness Tracking" : "",
      /vibration alarm|alarm/i.test(h) ? "Vibration Alarm" : "",
    ].filter(Boolean).slice(0, 2).join(" and ");
    return `Smart Bracelet${features ? ` with ${features}` : " with LED Display"}`;
  }
  if (/\banime\b.*\bbracelet\b|\bbracelet\b.*\banime\b/i.test(h)) return "Anime Character Bracelet with Cartoon Pendant";
  if (/\bmichael jackson\b/i.test(h) && /\b(?:t shirt|tee)\b/i.test(h)) return "Michael Jackson Printed Cotton T-Shirt";
  if (/\b(?:beads?|spacer beads?)\b/i.test(h) && /\b(?:jewelry making|diy|loose)\b/i.test(h)) {
    const sizes = h.match(/\b\d+(?:-\d+)+\s*mm\b/i)?.[0] || "";
    return `Acrylic Spacer Beads for Jewelry Making${sizes ? `, ${sizes}` : ""}`;
  }
  if (/\b(?:necklace|earrings?)\b/i.test(h) && /\b(?:jewelry set|earring set|necklace set|zircon|dangle earrings?|crystal.*necklace.*earring|necklace.*earring.*set)\b/i.test(h)) {
    return "Pendant Necklace and Earring Jewelry Set";
  }
  if (/\b(?:necklace|earrings?|bracelet)\b/i.test(h) && /\b(?:jewelry set|3 piece set|3-piece set|brides?|weddings?)\b/i.test(h)) {
    if (/\b(?:brides?|weddings?)\b/i.test(h)) return "Bridal Necklace, Earrings and Bracelet Set";
    return "Crystal Necklace, Earrings and Bracelet Set";
  }
  if (/\b(?:italian charm|charm bracelet)\b/i.test(h) && /\bbracelet\b/i.test(h)) return `${/stainless steel/i.test(h) ? "Stainless-Steel " : ""}Italian Charm Bracelet`;
  if (/\b(?:iris|flower)\b.*\b(?:bangle|bracelet)\b|\b(?:bangle|bracelet)\b.*\b(?:iris|flower)\b/i.test(h)) return "Adjustable Iris Flower Bangle Bracelet";
  if (/(?:^|\s)fan(?:\s|$)/i.test(h) && !/fan cat.*t shirt|car cleaning|brush fan|air conditioning brush|anime.*keychain|keychain.*anime|anime.*bracelet|bracelet.*anime|fan gifts?|michael jackson.*t shirt|t shirt.*michael jackson/i.test(h)) {
    const format = /folding|handheld/i.test(h) ? "Folding Handheld Fan" : /desk/i.test(h) ? "USB Desk Fan" : "Portable Fan";
    return `${format}${/rechargeable/i.test(h) ? " with Rechargeable Battery" : ""}`;
  }

  if (/\b(?:lip liner|lipliner)\b/i.test(h)) return `${strictPackCount(h) ? `${strictPackCount(h)}-Piece ` : ""}Lip Liner Pen Set for Makeup`;
  if (/\b(?:face body paint|face and body paint|body paint|face paint)\b/i.test(h)) {
    const count = h.match(/\b(\d+)\s*(?:colors?|colours?)\b/i)?.[1] || "";
    return `${count ? `${count}-Color ` : ""}${/sfx|special effects/i.test(h) ? "SFX " : ""}Face and Body Paint Kit`;
  }
  if (/\bthermal printer sticker paper\b/i.test(h)) return "Mini Thermal Printer Sticker Paper";
  if (/\bwall stickers?\b/i.test(h)) return `${/halloween/i.test(h) ? "Halloween " : ""}LED Wall Stickers`;
  if (/\bcard sticker\b/i.test(h)) return "Decorative Card Stickers";
  if (/\b(?:journal|scrapbook|notebook|stationery|landscape|scenery)\b.*\bstickers?\b|\bstickers?\b.*\b(?:journal|scrapbook|notebook|stationery|landscape|scenery)\b/i.test(h) && !/phone holder|speaker|body paint|fidget|keychain/i.test(h)) {
    const count = strictPackCount(h);
    if (/four seasons/i.test(h) && /small house|miniature scene/i.test(h)) return "Four-Seasons Miniature Scene Sticker Set";
    if (/four seasons/i.test(h) && /interesting|build|collage/i.test(h)) return `${count ? `${count}-Sheet ` : ""}Four-Seasons Collage Sticker Set`;
    if (/four seasons/i.test(h) && /gilding|creative/i.test(h)) return "Four-Seasons Gilded Sticker Set for Journals";
    if (/four seasons/i.test(h) && /forest|aesthetic/i.test(h)) return `${count ? `${count}-Sheet ` : ""}Forest Landscape Sticker Set for Journals`;
    if (/four seasons/i.test(h)) return `${count ? `${count}-Piece ` : ""}Four-Seasons Landscape Sticker Set`;
    if (/school supplies/i.test(h)) return `${count ? `${count}-Piece ` : ""}Waterproof Sticker Set for Notebooks`;
    const use = /journal|scrapbook/i.test(h) ? "for Journals and Scrapbooks" : /notebook|stationery/i.test(h) ? "for Notebooks and Crafts" : "for DIY Crafts";
    return `${count ? `${count}-Piece ` : ""}Decorative Sticker Set ${use}`;
  }
  if (/\b(?:diamond painting|diamond mosaic|rhinestone painting|mosaic painting)\b/i.test(h)) return /witch hat|halloween|christmas|pumpkin/i.test(h) ? "Halloween Witch-Hat Diamond Painting Kit" : "Diamond Painting Kit for DIY Crafts";
  if (/\b(?:witch hat|salt pepper|spice)\b.*\b(?:jar|container)\b|\b(?:jar|container)\b.*\b(?:witch hat|salt pepper|spice)\b/i.test(h)) return `${/glass/i.test(h) ? "Glass " : ""}Witch-Hat Salt and Pepper Storage Jar`;
  if (/\b(?:ring settings?|blank base|cabochon.*bezels?)\b/i.test(h) && /\b(?:ring|bezels?)\b/i.test(h)) return "Adjustable Stainless-Steel Ring Blank Setting, 6-20mm";
  if (/\b(?:skincare set|skin care set)\b/i.test(h) && /\b(?:toner|cream|sunscreen|serum)\b/i.test(h)) {
    const parts = ["Toner", /face cream|moisturizer/i.test(h) ? "Face Cream" : "", /sunscreen|sunblock/i.test(h) ? "Sunscreen" : ""].filter(Boolean);
    return `Korean Skincare Set with ${parts.slice(0, 3).join(", ")}`;
  }
  if (/\b(?:cosmetic|makeup) organizer\b|\b(?:cosmetic|makeup) storage\b/i.test(h)) return /rotating/i.test(h) ? "Rotating Makeup Organizer for Cosmetics and Brushes" : /stationery/i.test(h) ? "Desktop Stationery and Makeup Organizer" : "Desktop Cosmetic Organizer for Makeup and Jewelry";
  if (/\b(?:cable digital storage|cable storage bag|cable organizer bag)\b/i.test(h) && /\b(?:bag|storage)\b/i.test(h)) return "Portable Cable Organizer Storage Bag";
  if (/\b(?:cable organizer|wire organizer|cord management|cable routing)\b/i.test(h)) return `${/portable/i.test(h) ? "Portable " : ""}${/velcro/i.test(h) ? "Velcro " : ""}Cable Organizer for Charging Cables`;
  if (/\b(?:makeup brush cleaner|cosmetic brush cleaner)\b/i.test(h)) return "3-in-1 USB Makeup Brush Cleaner and Dryer";
  if (/\b(?:foundation|concealer)\b.*\b(?:brush|blender)\b|\b(?:brush|blender)\b.*\b(?:foundation|concealer)\b/i.test(h)) return /\b\d+\s*(?:pcs?|pieces?)\b/i.test(h) ? `${strictPackCount(h)}-Piece Foundation and Concealer Brush Set` : "Foundation and Concealer Makeup Brush";
  if (/\b(?:makeup brush|cosmetic brush|eyeshadow brush)\b/i.test(h) && !/organizer|cleaner/i.test(h)) return `${strictPackCount(h) ? `${strictPackCount(h)}-Piece ` : ""}Makeup Brush Set for Foundation and Blending`;
  if (/\b(?:fixed|universal)\b.*\b(?:waterproof|anti fog)\b.*\b(?:phone case|phone holder|shower)\b/i.test(h)) return "Fixed Waterproof Anti-Fog Phone Holder for Shower";
  if (/\b(?:phone pouch|phone sleeve|waterproof.*phone.*(?:pouch|case)|phone.*(?:pouch|sleeve))\b/i.test(h)) return `${/waterproof/i.test(h) ? "Waterproof " : ""}Touchscreen Phone Pouch${/swimming|beach/i.test(h) ? " for Swimming and Beach Use" : ""}`;
  if (/\b(?:phone case|iphone case|tablet case)\b|(?:case|cover).*\b(?:iphone|ipad|tablet|redmi pad|xiaomi pad)\b|\b(?:iphone|ipad|tablet|redmi pad|xiaomi pad)\b.*\b(?:case|cover)\b/i.test(h)) {
    const model = h.match(/\biphone\s*(\d{1,2})\b/i);
    const tablet = /\b(?:ipad|redmi pad|xiaomi pad|tablet)\b/i.test(h);
    if (tablet && !model) return /redmi pad|xiaomi pad/i.test(h) ? "Xiaomi Redmi Pad Protective Case with Stand" : "iPad Air Trifold Protective Case";
    const material = /silicone/i.test(h) ? "Silicone" : /leather/i.test(h) ? "Leather" : /magnetic|magsafe|macsafe|shockproof/i.test(h) ? "" : "Protective";
    const feature = [/magnetic|magsafe|macsafe/i.test(h) ? "Magnetic" : "", /shockproof/i.test(h) ? "Shockproof" : ""].filter(Boolean).join(" ");
    const modelText = model ? ` iPhone ${model[1]}` : "";
    return `${brand && /ugreen/i.test(h) ? "Ugreen " : ""}${feature}${feature && material ? " " : ""}${material}${modelText} Case for Multiple Models`.replace(/\s+/g, " ").trim();
  }
  if (/\b(?:phone holder|phone stand|phone mount|cell phone stand)\b/i.test(h)) {
    const features = [/360/i.test(h) ? "360-Degree" : "", /suction/i.test(h) ? "Suction" : "", /car/i.test(h) ? "Car" : "Desk"].filter(Boolean);
    return `${features.join(" ")} Phone Holder`.trim();
  }
  if (/\b(?:earpads?|ear pads?|earphone pads?|headphone pads?)\b/i.test(h)) return `${/house of marley/i.test(h) ? "House of Marley" : /jbl/i.test(h) ? "JBL" : /steelseries/i.test(h) ? "SteelSeries" : "Compatible Headphones"} Headphone Replacement Earpads`;
  if (/\b(?:ear tips?|eartips?|ear caps?)\b/i.test(h)) return "Replacement Silicone Ear Tips for Wireless Earbuds";
  if (/\b(?:squeegee|window cleaning|glass cleaning)\b/i.test(h)) return `${h.match(/\b\d+\s*[- ]?\d+\s*cm\b/i)?.[0] || ""} Stainless-Steel Window and Glass Squeegee`.trim();
  if (/\b(?:inflatable|air) mattress\b|\bmattress\b.*\b(?:camping|sleeping)\b/i.test(h)) return "Inflatable Camping Mattress for Indoor and Outdoor Sleeping";
  if (/\b(?:tumbler|snowglobe|snow globe|pre[- ]?drilled|mason jar)\b/i.test(h) && /\b(?:tumbler|bottle|cup)\b/i.test(h)) {
    const capacity = h.match(/\b\d+\s*(?:ml|oz)\b/i)?.[0] || "";
    return `${capacity ? `${capacity} ` : ""}DIY Snow-Globe Tumbler with Pre-Drilled Hole`.trim();
  }
  if (/\b(?:thermos|tumbler|water bottle)\b/i.test(h)) {
    const capacity = h.match(/\b\d+\s*(?:ml|oz)\b/i)?.[0] || "";
    return `${capacity ? `${capacity} ` : ""}Stainless-Steel Insulated Travel Cup with Straw`.trim();
  }
  if (/\b(?:backpack|rucksack|daypack)\b/i.test(h) && !/\b(?:accessories|hardware|buckle|keychain|keychains|messenger|sling|crossbody|bumbag)\b/i.test(h)) {
    const capacity = h.match(/\b\d+\s*l\b/i)?.[0] || "";
    const features = [
      /tactical|molle/i.test(h) ? "Tactical MOLLE" : "",
      /waterproof/i.test(h) ? "Waterproof" : "",
    ].filter(Boolean).join(" ");
    const use = /hiking|trekking/i.test(h) ? "Hiking" : /camping/i.test(h) ? "Camping" : /travel/i.test(h) ? "Travel" : "Outdoor";
    const audience = /\b(?:women|womens|woman|female|ladies)\b/i.test(h) ? "Women's " : "";
    const kind = /\bdaypack\b/i.test(h) ? "Daypack" : "Backpack";
    return `${audience}${capacity ? `${capacity} ` : ""}${features ? `${features} ` : ""}${use} ${kind}`.replace(/\s+/g, " ").trim();
  }
  if (/\b(?:watch|wristwatch)\b/i.test(h) && /\b(?:box|organizer|travel case|display|storage)\b/i.test(h) && !/\b(?:smartwatch|smart watch|watch band|watch strap|watchband|replacement strap)\b/i.test(h)) {
    return "Portable Watch Organizer Case for Travel and Display";
  }
  if (/(?:stationery|stickers?|office|pencil|manual account|tool case).*(?:holder|organizer|storage|box|container)|(?:holder|organizer|storage|box|container).*(?:stationery|stickers?|office|pencil|manual account|tool case)/i.test(h) && !/\b(?:phone holder|phone stand|phone mount|cell phone)\b/i.test(h)) {
    return "Transparent Plastic Stationery Organizer Box";
  }
  if (/(?:spray bottles?|droppers?|funnels?).*(?:amber|glass|mini|travel)|(?:amber|glass|mini|travel).*(?:spray bottles?|droppers?|funnels?)/i.test(h)) {
    const count = h.match(/\b(\d+)\s*(?:pcs?|pieces?)\b/i)?.[1] || "";
    return `${count ? `${count}-Piece ` : ""}Amber Glass Travel Bottle Set with Sprayers and Droppers`.trim();
  }
  if (/\b(?:necklace|earrings?)\b/i.test(h) && /\b(?:jewelry set|earring set|necklace set|zircon|dangle earrings?|crystal.*necklace.*earring|necklace.*earring.*set)\b/i.test(h)) {
    return "Pendant Necklace and Earring Jewelry Set";
  }
  if (/\b(?:t[- ]?shirt|tee)\b/i.test(h) && /\bdress\b/i.test(h)) {
    const audience = /\b(?:women|womens|woman|female|ladies)\b/i.test(h) ? "Women's " : /\b(?:men|mens|man|male)\b/i.test(h) ? "Men's " : "";
    const neckline = /v[- ]?neck/i.test(h) ? "V-Neck " : /round neck|o neck|crew neck/i.test(h) ? "Crew-Neck " : "";
    const sleeve = /short sleeve/i.test(h) ? "Short-Sleeve " : /long sleeve/i.test(h) ? "Long-Sleeve " : "";
    return `${audience}${neckline}${sleeve}T-Shirt Dress`.replace(/\s+/g, " ").trim();
  }
  if (/(?:handmade|woven|straw|rattan).*(?:handbag|bucket|tote|basket)|(?:handbag|bucket|tote|basket).*(?:handmade|woven|straw|rattan)/i.test(h)) {
    const audience = /\b(?:women|womens|woman|female|ladies)\b/i.test(h) ? "Women's " : "";
    const material = /straw|rattan/i.test(h) ? "Straw" : "Woven";
    return `${audience}Handmade ${material} Bucket Handbag`.replace(/\s+/g, " ").trim();
  }

  if (/\b(?:scarf|neckerchief|bandana|shawl|wrap)\b/i.test(h)) {
    const size = h.match(/\b\d+\s*cm\b/i)?.[0] || "";
    const pattern = /paisley/i.test(h) ? "Paisley " : /floral|flower/i.test(h) ? "Floral " : /striped/i.test(h) ? "Striped " : "";
    const audience = /\b(?:women|womens|woman|female|ladies|girl|girls)\b/i.test(h) ? "Women's " : "";
    return `${audience}${size ? `${size} ` : ""}${pattern}Scarf for Hair, Neck, or Outfit Styling`.replace(/\s+/g, " ").trim();
  }
  if (/\b(?:eyeliner|eye liner)\b/i.test(h) && !/\bpalette\b/i.test(h)) {
    const color = h.match(/\b(?:black|brown|blue|green|purple|pink|silver|gold|white)\b/i)?.[0] || "";
    return `${color ? `${titleCase(color)} ` : ""}${/gel/i.test(h) ? "Gel" : /pencil/i.test(h) ? "Pencil" : "Liquid"} Eyeliner for Eye Makeup`;
  }
  if (/\b(?:eyeshadow|eye shadow)\b/i.test(h) && /\bpalette\b/i.test(h)) {
    const count = h.match(/\b\d+\s*colou?rs?\b/i)?.[0] || "";
    return `${count ? `${count} ` : ""}${/glitter|shimmer|sparkling/i.test(h) ? "Shimmer " : ""}Eyeshadow Palette for Eye Makeup`.replace(/\s+/g, " ").trim();
  }
  if (/\b(?:paper bag|gift bag|packaging bag|candy bag)\b/i.test(h)) return "Colorful Paper Gift Bags with Handles";
  if (/\b(?:led candle|candlestick|flameless candle)\b/i.test(h)) return "LED Flameless Candle with Flickering Flame Effect";
  if (/\banime\b/i.test(h) && /\b(?:collection cards?|trading cards?|game cards?)\b/i.test(h)) return "Anime Game Collection Card Set";
  if (/\b(?:floral|flower)\b/i.test(h) && /\b(?:blouse|top|shirt)\b/i.test(h)) return `${/\b(?:women|womens|woman|female|ladies)\b/i.test(h) ? "Women's " : ""}Floral Print Blouse for Spring and Summer`;
  if (/\b(?:anti[- ]?slip|non[- ]?slip)\b/i.test(h) && /\bsocks?\b/i.test(h)) return `${/\bcotton\b/i.test(h) ? "Cotton " : ""}Anti-Slip Socks for Family Wear`;
  if (/\b(?:stylus|touch[- ]?screen pen|digital pen)\b/i.test(h)) return "Telescopic Touchscreen Stylus Pen for Compatible Devices";
  if (/\b(?:father|dad|fathers day)\b/i.test(h) && /\bkeychain\b/i.test(h)) return "Funny Father's Day Keychain Gift for Dad";
  if (/\b(?:duvet cover|duvet covers?)\b/i.test(h)) {
    const size = h.match(/\b\d+\s*cm(?:\s*[x×]\s*\d+\s*cm)?\b/i)?.[0] || "";
    return `${size ? `${size} ` : ""}Duvet Cover for Bedroom Bedding`.trim();
  }
  if (/\b(?:aquarium|fish tank)\b/i.test(h) && /\b(?:plant|plants|decoration)\b/i.test(h)) return "Artificial Aquarium Plant Decoration";
  if (/\b(?:belt|belts)\b/i.test(h) && /\b(?:men|mens|man|male)\b/i.test(h)) return `${/synthetic leather|pu leather|faux leather/i.test(h) ? "Synthetic-Leather " : ""}Men's Belt with Automatic Buckle`;

  if (/\b(?:button down shirts?|button-down shirts?)\b/i.test(h) && /\bshirts?\b/i.test(h)) {
    const audience = /\b(?:men|mens|man|male)\b/i.test(h) ? "Men's " : /\b(?:women|womens|woman|female|ladies)\b/i.test(h) ? "Women's " : "";
    const material = /\blinen\b/i.test(h) ? "Linen-Blend " : /\bcotton\b/i.test(h) ? "Cotton " : "";
    const sleeve = /short sleeve/i.test(h) ? "Short-Sleeve " : /long sleeve/i.test(h) ? "Long-Sleeve " : "";
    return `${audience}${material}${sleeve}Button-Down Shirt for Casual Wear`;
  }
  if (/\bdress\b/i.test(h) && /\b(?:lace up|printed|chinese style)\b/i.test(h)) return `${/\b(?:women|womens|woman|female|ladies)\b/i.test(h) ? "Women's " : ""}${/long sleeve/i.test(h) ? "Long-Sleeve " : ""}Lace-Up Printed Dress`;
  if (/\b(?:pajamas?|pijamas?|sleepwear)\b/i.test(h)) return `${/pikachu|pokemon/i.test(h) ? "Pikachu " : "Kids' "}Pajama Set for Sleeping`;
  if (/\bvest\b/i.test(h) && /\b(?:t shirt|tee|sports|fitness)\b/i.test(h)) return `${strictPackCount(h) ? `${strictPackCount(h)}-Pack ` : ""}Cotton Sleeveless Sports T-Shirt`;
  if (/\b(?:beauty and the beast|movie jewelry)\b/i.test(h) && /\bnecklace\b/i.test(h)) return "Beauty and the Beast Pendant Necklace for Women";
  if (/\banime\b.*\bkeychain\b|\bkeychain\b.*\banime\b/i.test(h)) return "Anime Lock Keychain with Jet Tag";
  if (/\b(?:cotton|100 cotton)\b.*\b(?:mens?|men)\b.*\b(?:t shirt|tee)\b/i.test(h)) return `Men's Cotton${/o neck|round neck|crew neck/i.test(h) ? " Crew-Neck" : ""} T-Shirt`;
  if (/\bstriped shirt\b/i.test(h)) return "Striped Shirt for Spring and Summer";
  if (/\byoshimura\b/i.test(h) && /\b(?:t shirt|tee)\b/i.test(h)) return "Yoshimura Cotton T-Shirt";
  if (/\b(?:bangle|bracelet)\b/i.test(h)) {
    const audience = /\b(?:women|womens|woman|female|ladies|men|mens|man|male|unisex)\b/i.test(h) ? " for Men and Women" : "";
    return `${/leather/i.test(h) ? "Leather " : /stainless steel|metal/i.test(h) ? "Metal " : ""}Bracelet${audience}`;
  }
  if (/\b(?:fan cat|cat and women).*\b(?:t shirt|tee)\b/i.test(h)) return "Cat Graphic T-Shirt for Men and Women";
  if (/\b(?:t[- ]?shirt|tee)\b/i.test(h)) {
    if (/\b(?:baby|infant|newborn|toddler)\b/i.test(h) && /\b(?:pants?|trousers?|outfit|set)\b/i.test(h)) {
      return "Baby T-Shirt and Pants Clothing Set";
    }
    if (/\bpolo\b/i.test(h)) return `${/cotton/i.test(h) ? "Cotton " : ""}Polo Shirt for Casual Wear`;
    if (/\b(?:tank|sleeveless|vest)\b/i.test(h)) return `${/cotton/i.test(h) ? "Cotton " : ""}Sleeveless T-Shirt for Casual Wear`;
    const audience = /\b(?:women|womens|woman|female|ladies)\b/i.test(h)
      ? "Women's "
      : /\b(?:men|mens|man|male)\b/i.test(h)
        ? "Men's "
        : /\b(?:kids?|children|boys?|girls?)\b/i.test(h)
          ? "Kids' "
          : "";
    const material = /\bcotton\b/i.test(h) ? "Cotton " : /\blinen\b/i.test(h) ? "Linen " : "";
    const sleeve = /\bshort[- ]?sleeve\b/i.test(h) ? "Short-Sleeve " : /\blong[- ]?sleeve\b/i.test(h) ? "Long-Sleeve " : "";
    const design = /\banime\b|\bgraphic\b|\bprinted\b|\bprint\b|\bquote\b|\bcharacter\b|\bpattern\b/i.test(h) ? "Printed " : "";
    return `${audience}${design}${material}${sleeve}T-Shirt for Casual Wear`.replace(/\s+/g, " ").trim();
  }
  return "";
}

function buildStrictHumanSummary(titleText, signals, facts) {
  const h = strictHandleText(signals);
  if (!h) return "";
  const size = firstFactValue(facts, ["Size or capacity", "Pack format"]);
  const sizeText = size ? ` The listed format is ${polishListingValue(size)}.` : "";
  if (/\btrue wireless earbuds?\b/i.test(h) && /\b(?:noise reduction|touch control|power display|waterproof|microphone|mic)\b/i.test(h)) {
    return "These true-wireless Bluetooth earbuds combine touch control, a built-in microphone, a charging display, and the listed water-resistant design for calls and everyday listening. Check the ear fit, charging case, and phone compatibility before ordering.";
  }
  if (/\bpet hair removal tool\b/i.test(h) && /\b(?:grooming|gloves?|pet fur|carpets?)\b/i.test(h)) {
    return "This reusable double-sided grooming glove lifts loose pet hair from coats, furniture, carpets, and other surfaces. Check the glove fit, texture, and care instructions before ordering.";
  }
  if (/\bindestructible pet toys?\b/i.test(h) && /\b(?:chew|squeak|cats?|dogs?)\b/i.test(h)) {
    return "This interactive plush chew toy adds squeak and chew play for dogs and cats. Check the toy size, fabric, and your pet's play style before ordering.";
  }
  if (/\bt10 ultra\b/i.test(h) && /\bsmartwatch\b|\bsmart watch\b/i.test(h)) {
    return "This T10 Ultra smart watch combines a 49mm display with GPS, Bluetooth calling, music, games, and wireless charging. Check phone compatibility, case size, and charging method before ordering.";
  }
  if (/\bmini electronic pets?\b|\bvirtual cyber pet\b/i.test(h)) {
    return "This mini USB-charging virtual pet toy offers interactive electronic play through a compact cyber-pet design and the listed 8-in-1 functions. Check the charging method, play controls, and included functions before ordering.";
  }
  if (/\bnight vision binoculars\b/i.test(h) && /\binfrared\b/i.test(h)) {
    return "These 4K infrared night-vision binoculars combine digital zoom, rechargeable operation, and the listed long-distance viewing range for wildlife observation or outdoor surveillance. Check the zoom, card capacity, charging method, and included accessories before ordering.";
  }
  if (/\bwood kitchenware\b/i.test(h) && /\bcooking set\b/i.test(h)) {
    return "This wooden kitchen utensil set brings together spatulas, spoons, forks, and stirring tools for everyday cooking, baking, and serving. Check the piece count, utensil shapes, finish, and care instructions before ordering.";
  }
  if (/\bcamping wine cooler bags?\b/i.test(h) && /\binsulated\b/i.test(h)) {
    return "This insulated wine cooler tote carries a bottle for travel, picnics, or outdoor gatherings while helping protect it in transit. Check the bottle capacity, insulation, closure, handle, and cleaning instructions before ordering.";
  }
  if (/\bfood storage set\b/i.test(h) && /\bairtight containers?\b/i.test(h)) {
    return "This food-storage container set keeps pantry or travel ingredients organized with airtight lids and labels for easier identification. Check the container count, capacities, lid seal, materials, and care instructions before ordering.";
  }
  if (/\bpoco f5\b/i.test(h) && /\bcase\b/i.test(h)) {
    return "This liquid-silicone protective case is shaped for compatible POCO F5, F5 Pro, or Poco F5 Pro phones and adds a soft shock-resistant cover. Check the exact phone model, camera cutout, button fit, and selected color before ordering.";
  }
  if (/\bugreen hdmi\b/i.test(h) && /\bcable\b/i.test(h)) {
    return "This UGREEN HDMI cable carries high-bandwidth video and audio between compatible devices, with the listed 4K, 8K, and high-refresh support for consoles, media boxes, or displays. Check the source, display inputs, length, and required HDMI standard before ordering.";
  }
  if (/\bbambu lab\b/i.test(h) && /\bbuild plate\b/i.test(h)) {
    return "This Bambu Lab replacement build plate provides a double-sided smooth or textured surface for compatible P1P, P1S, A1, X1, and X1C printers. Check the printer model, plate dimensions, surface side, and temperature requirements before ordering.";
  }
  if (/\bports usb\b/i.test(h) && /\bhub\b/i.test(h)) {
    return "This multi-port USB hub expands a compatible laptop or computer connection for peripherals such as storage, keyboards, mice, or other USB devices. Check the port count, USB standard, power input, connector type, and device compatibility before ordering.";
  }
  if (/\blenovo idea tab pro\b/i.test(h) && /\bcase\b/i.test(h)) {
    return "This magnetic folding case protects a compatible Lenovo Idea Tab Pro with a stand position for desk viewing and the listed PU-leather finish. Check the exact tablet model, camera cutout, closure, stand angle, and selected size before ordering.";
  }
  if (/\bsandisk cz50\b/i.test(h) && /\bflash drive\b/i.test(h)) {
    return "This SanDisk CZ50 USB flash drive provides removable storage for compatible computers and other USB devices, with the listed capacity options from 16GB to 128GB. Check the selected capacity, USB standard, and device compatibility before ordering.";
  }
  if (/\btri glide slider\b/i.test(h) && /\bbackpack accessories\b/i.test(h)) {
    return "This tri-glide slider buckle adjusts and secures compatible outdoor backpack straps or webbing. Check the selected opening size, strap width, material, and buckle fit before ordering.";
  }
  if (/\bmicrofiber towel\b/i.test(h) && /\bquick dry\b/i.test(h)) {
    return "This quick-dry microfiber towel packs lightly for travel, swimming, yoga, gym sessions, or beach days and is described as soft and sand-resistant. Check the selected size, fabric, edge finish, and washing instructions before ordering.";
  }
  if (/\bbody art face painting\b/i.test(h) && /\bmakeup sponge\b/i.test(h)) {
    return "These makeup sponges are shaped for applying or blending face and body paint, including water-drop and semicircle shapes for controlled coverage. Check the piece count, sponge shape, texture, and cleaning instructions before use.";
  }
  if (/\bunderwear organizers?\b/i.test(h) && /\bsocks?\b/i.test(h)) {
    return "This drawer organizer separates underwear, socks, bras, and other small clothing items into an easier-to-sort storage layout. Check the compartment count, dimensions, material, folding design, and drawer fit before ordering.";
  }
  if (/\bperfume organizer\b/i.test(h) && /\b3[- ]?tier\b/i.test(h)) {
    return "This three-tier perfume organizer keeps fragrance bottles arranged on a shelf or vanity with drawers for smaller accessories. Check the tier dimensions, drawer layout, bottle clearance, and material before ordering.";
  }
  if (/\bwilliam morris\b/i.test(h) && /\b(?:cotton|fabric|textiles?)\b/i.test(h)) {
    return "This William Morris vintage floral cotton fabric brings a printed pattern to sewing, clothing, handbag, and other DIY projects. Check the selected pattern, fabric width, and half-meter length before ordering.";
  }
  if (/\bhair claw\b/i.test(h) && /\b(?:furry|plush|clips?)\b/i.test(h)) {
    return "These furry flower hair claw clips hold sections of hair with a soft, plush finish and a compact claw-clip fastening. Check the clip size and selected color before ordering.";
  }
  if (/\bchildrens shirt 2025 spring cartoon\b/i.test(h)) {
    return "This children's long-sleeve cartoon shirt brings a playful print to a casual spring outfit. Check the selected size, color, fabric, and care instructions before ordering.";
  }
  if (/\bjeans for men harem torn\b/i.test(h)) {
    return "These men's loose harem jeans use a relaxed, torn vintage silhouette for casual outfits. Check the selected waist, length, fabric, and leg shape before ordering.";
  }
  if (/\bwashed ripped straight leg jeans four seasons\b/i.test(h) && /\b(?:ladies|women)\b/i.test(h)) {
    return "These women's washed ripped straight-leg jeans use a casual denim fit with the four-season styling stated in the listing. Check the waist, length, fabric, and selected size before ordering.";
  }
  if (/\bfashion elegant women dress loose casual dress women dress new temperament\b/i.test(h)) {
    return "This women's elegant loose casual dress brings a relaxed silhouette to everyday warm-weather outfits. Check the selected size, color, fabric, and care instructions before ordering.";
  }
  if (/\bwhite blouse for women 2026\b/i.test(h) && /\b(?:bow|sleeveless|blouse|tops?)\b/i.test(h)) {
    return "This bow-detail sleeveless blouse brings a relaxed button-front silhouette to warm-weather outfits. Check the selected color, size, fabric, and care instructions before ordering.";
  }
  if (/\bface cream\b/i.test(h) && /\b(?:skin tone|dark spots?|dullness|whitening)\b/i.test(h)) {
    return "This daily face cream adds a lightweight moisturizing step for skin care, with the even-tone and dark-spot focus stated in the listing. Check the jar size, ingredients, and application directions before use.";
  }
  if (/\bjeans for men 2025 new loose straight leg winter\b/i.test(h)) {
    return "These men's loose straight-leg jeans use a wide-leg winter-weight silhouette for workwear and everyday outfits. Check the waist, length, fabric, and selected size before ordering.";
  }
  if (/\bm10\b/i.test(h) && /\b(?:wireless|bluetooth|earbuds?|earphones?)\b/i.test(h)) {
    return "These M10 wireless Bluetooth earbuds use a compact charging-case format for music, calls, and everyday listening. Check the fit, controls, water-resistance details, and device compatibility before ordering.";
  }
  if (/\bkz edx\b/i.test(h)) {
    return "These KZ EDX Pro X in-ear earphones use metal housings and a wired earbud format for music listening. Check the connector, fit, and selected color before ordering.";
  }
  if (/\br69 plus\b/i.test(h) && /\b(?:smart tv|android|set top|home video)\b/i.test(h)) {
    return "This R69 Plus Android 14 smart TV box is a compact home-video player with the listed 4G/5G, Wi-Fi 6, and 8K support. Check the included accessories, storage or memory option, and TV connection before ordering.";
  }
  if (/\bstriped\b/i.test(h) && /\b(?:one shoulder|one word shoulder|long sleeve|long sleeved)\b/i.test(h)) {
    return "This striped one-shoulder long-sleeve top uses a slim, layered silhouette for early-autumn outfits. Check the selected size, fabric, and care instructions before ordering.";
  }
  if (/\b(?:xiaomi pad 7|mi pad 7|pad 7 pro)\b/i.test(h) && /\b(?:case|cover|pencil holder|rotation)\b/i.test(h)) {
    return "This rotating protective case fits the Xiaomi Pad 7 and Pad 7 Pro tablet family and includes a pencil-holder format for desk or travel use. Check the exact tablet model, camera cutout, stand position, and closure before ordering.";
  }
  if (/\bsteelseries\b/i.test(h) && /\b(?:arctis|earpads?|earmuffs?|headphone)\b/i.test(h)) {
    return "These SteelSeries Arctis replacement earpads restore cushioning around compatible Arctis 3, 5, 7, and Pro headsets with a soft ear-cup fit. Check the exact headset model, ear-cup dimensions, attachment method, and material before ordering.";
  }
  if (/\bbglossy\b/i.test(h) && /\b(?:body serum|face serum|vitamin e|hyaluronic acid)\b/i.test(h)) {
    return "This BGlossy smoothing serum adds a moisturizing body and face care step with vitamin E and hyaluronic acid. Check the bottle size, ingredients, skin compatibility, and application directions before use.";
  }
  if (/\byoungcome\b/i.test(h) && /\b(?:ghk|copper peptide|collagen|niacinamide|hyaluronic acid)\b/i.test(h)) {
    return "This Youngcome GHK-Cu copper peptide serum combines the listed collagen, adenosine, niacinamide, and hyaluronic-acid details in a hydrating facial-care step. Check the bottle size, ingredients, skin compatibility, and directions before use.";
  }
  if (/\bsuyarun\b/i.test(h) && /\b(?:ghk|copper|firming|anti[- ]?aging)\b/i.test(h)) {
    return "This Suyarun GHK-Cu facial serum supports a firming and anti-aging routine and is described for all skin types. Check the bottle size, ingredients, skin compatibility, and directions before use.";
  }
  if (/\bwatermelon glow\b/i.test(h) && /\b(?:niacinamide|pre[- ]?treatment|makeup)\b/i.test(h)) {
    return "This Watermelon Glow niacinamide serum adds a lightweight pre-makeup skin-care step for a moisturized, smoother-looking base. Check the bottle size, ingredients, skin compatibility, and application directions before use.";
  }
  if (/\bpink lip serum\b/i.test(h) && /\b(?:plumping|hydrating|pigmented lips?)\b/i.test(h)) {
    return "This pink lip serum adds a hydrating, smoothing care step for pigmented or dry-looking lips and is described for a plumping finish. Check the ingredients, applicator, and directions before use.";
  }
  if (/\by1ub\b/i.test(h) && /\b(?:gaming|keyboard|keycap|backlit)\b/i.test(h)) {
    return "This Y1UB gaming mechanical-feel keyboard uses a metal panel, round keycaps, and backlighting for a distinctive desktop typing setup. Check the key layout, connection, lighting controls, language, and compatibility before ordering.";
  }
  if (/\bugreen\b/i.test(h) && /\b(?:type c|usb c|3[ .-]?5\s*mm|audio|dac)\b/i.test(h)) {
    return "This UGREEN USB-C to 3.5mm DAC audio cable connects compatible USB-C devices to headphones, car stereos, speakers, or other equipment with a 3.5mm input. Check the DAC support, connector direction, length, and device compatibility before ordering.";
  }
  if (/\babzz\b/i.test(h) && /\b(?:rode|wireless go ii|3[ .-]?5\s*mm|usb c)\b/i.test(h)) {
    return "This ABZZ USB-C to 3.5mm TRS cable connects a RODE Wireless GO II receiver or compatible audio setup to a 3.5mm input. Check the USB-C direction, TRS wiring, right-angle plug, cable length, and device compatibility before ordering.";
  }
  if (/\binvisible selfie stick\b/i.test(h) && /\b(?:insta360|x3|x4|x5)\b/i.test(h)) {
    return "This invisible selfie stick is designed for Insta360 X3, X4, X5, ONE X2, RS, GO 2, and GO 3S cameras for handheld or tripod-style shooting. Check the exact camera model, thread, extension length, and mounting accessories before ordering.";
  }
  if (/\b(?:tripod|selfie stick)\b/i.test(h) && /\b(?:phone|smartphone|camera)\b/i.test(h) && /\b(?:overhead|live stand|shooting|recording)\b/i.test(h)) {
    return "This smartphone selfie stick and tripod provides a fixed overhead setup for shooting, livestreaming, or recording video with a phone or camera. Check the height, mounting head, lighting support, remote control, and device fit before ordering.";
  }
  if (/\bmobile phone stand\b/i.test(h) && /\b(?:lying flat|leaning back|watch tv|bedroom|living room)\b/i.test(h)) {
    return "This adjustable phone stand holds a smartphone at a comfortable angle for watching TV from a bed, sofa, or living-room seat. Check the base stability, supported device width, viewing angle, and folded size before ordering.";
  }
  if (/\bewa magone\b/i.test(h) && /\b(?:magsafe|magnetic|ring|kickstand)\b/i.test(h)) {
    return "This EWA MagOne magnetic phone ring stand adds a fold-out grip and kickstand for compatible MagSafe phones or cases. Check the magnetic fit, ring movement, phone thickness, and kickstand clearance before ordering.";
  }
  if (/\bgeometric earrings?\b/i.test(h) || (/\b(?:rose red|yellow|green|fluorescent)\b/i.test(h) && /\b earrings?\b/i.test(` ${h}`))) {
    return "These geometric statement earrings bring rose-red, yellow, and green fluorescent color accents to summer outfits. Check the fastening, dimensions, finish, and selected color before ordering.";
  }
  if (/\b(?:bluetooth\s+(?:5\.3|6\.0)|bluetooth 6|audio receiver|audio wireless adapter)\b/i.test(h) && /\b(?:receiver|transmitter|adapter)\b/i.test(h)) {
    const version = h.match(/\bbluetooth\s*(5\.3|6\.0)\b/i)?.[1] || "";
    return `This Bluetooth${version ? ` ${version}` : ""} audio receiver and transmitter adds wireless playback or sending to TVs, PCs, cars, and speakers through 3.5mm AUX, RCA, or optical connections. Check the operating mode, ports, USB power, and supported device before ordering.`;
  }
  if (/\bvention jack 3[ .-]?5(?:\s*mm)? aux cable\b/i.test(h)) {
    return "This VENTION 3.5mm AUX audio cable carries stereo sound between compatible phones, guitars, cars, microphones, headphones, speakers, and other 3.5mm equipment. Check the male-to-male plug fit, cable length, and device connections before ordering.";
  }
  if (/\bwii to hdmi[- ]compatible converter\b/i.test(h)) {
    return "This Wii-to-HDMI-compatible converter carries Wii video to a PC, HDTV, or monitor at the listed 720p or 1080p output and provides 3.5mm audio support. Check the Wii connection, display input, USB power, resolution, and cable length before ordering.";
  }
  if (/\bhdmi[- ]compatible to vga adapter\b/i.test(h)) {
    return "This HDMI-compatible to VGA adapter connects a PC or laptop to a VGA projector, monitor, or display while providing a 3.5mm audio jack and USB power connection. Check the source output, VGA display input, resolution, audio path, and power requirement before ordering.";
  }
  if (/\btype[- ]c female to 3[ .-]?5\s*mm jack male adapter\b/i.test(h)) {
    return "This USB-C female to 3.5mm male adapter converts a compatible USB-C audio connection to a headphone-style 3.5mm output in a 2-in-1 splitter format. Check the phone model, microphone support, and connector direction before ordering.";
  }
  if (/\btype[- ]c to 3[ .-]?5\s*mm aux adapter\b/i.test(h)) {
    return "This USB-C to 3.5mm AUX adapter connects compatible Samsung, Xiaomi, Redmi, Poco, LG, Huawei, or OnePlus phones to wired earphones, headphones, car audio, or other 3.5mm equipment. Check the phone port, DAC support, connector direction, and audio compatibility before ordering.";
  }
  if (/\b(?:vention|toocki).*\b(?:rca|2rca|coaxial)\b.*\b(?:cable|cord)\b/i.test(h)) {
    const brandText = /toocki/i.test(h) ? "Toocki" : "VENTION";
    return `This ${brandText} 3.5mm to dual RCA audio cable connects a phone, laptop, or other 3.5mm source to an amplifier, speaker, or home-theater input. Check the plug direction, left and right RCA channels, cable length, and equipment connections before ordering.`;
  }
  if (/\bvention jack 3[ .-]?5(?:\s*mm)? aux extension cable\b/i.test(h)) {
    return "This VENTION 3.5mm AUX extension cable adds reach between compatible phones, laptops, mini PCs, TVs, Xiaomi or Huawei devices, headphones, speakers, and stereo equipment. Check the connector pairing, length, and device connections before ordering.";
  }
  if (isRobeFigurineHandle(h)) {
    return "This seated man figurine is presented in a dark robe and is suited to a shelf, desk, or themed display. Check the dimensions, finish, and supplied care details before ordering.";
  }
  if (isCouplesRobeClothingHandle(h)) {
    return "This couples' printed kimono robe brings a relaxed, silky homewear style for shared lounging. Check the selected size, print, fabric, and care instructions before ordering.";
  }
  if (isMensTwoPieceRobeClothingHandle(h)) {
    return "This men's satin two-piece pajama set pairs a robe-style top with coordinating shorts for relaxed home wear. Check the selected size, fabric, belt, and care instructions before ordering.";
  }
  if (isMensOnlyRobeClothingHandle(h)) {
    const color = /\bnavy blue\b/i.test(h) ? "navy-blue " : /\bblack\b/i.test(h) ? "black " : "";
    const material = /\bsilk\b/i.test(h) && /\bsatin\b/i.test(h) ? "silk-satin " : /\bsatin\b/i.test(h) ? "satin " : "";
    const occasion = /\b(?:wedding|bridegroom)\b/i.test(h) ? " and can suit a groom's wedding preparation" : "";
    return (`This men's ${color}${material}bathrobe uses a kimono-style silhouette for relaxed home lounging${occasion}. Check the selected size, belt, fabric, and care instructions before ordering.`).replace(/\s+/g, " ");
  }
  if (/\bbiodance\b/i.test(h) && /\b(?:gel toner pads?|toner pads?|ampoule serum)\b/i.test(h)) {
    return "These Biodance gel toner pads use an ampoule-serum format for a hydrating skin-care step. Check the pad count, ingredients, and application directions before use.";
  }
  if (/\b(?:facial essence|salmon ampoule|ampoule serum)\b/i.test(h) && /\b(?:serum|essence|ampoule)\b/i.test(h)) {
    return "This salmon ampoule facial serum is a leave-on skincare step for a hydrated, refreshed-feeling routine. Check the bottle size, ingredients, skin compatibility, and application directions before use.";
  }
  if (/\b(?:ipad|ipad air|ipad pro)\b/i.test(h) && /\b(?:case|cover|flip|trifold|stand)\b/i.test(h)) {
    return "This trifold protective case is designed for the listed iPad Air and iPad Pro 10.9-, 11-, 12.9-, and 13-inch models, with a pencil-holder format and foldable stand cover. Check the exact iPad generation, camera cutout, and closure before ordering.";
  }
  if (/\b(?:watch case|watch cover|protective cover)\b/i.test(h) && /\b(?:huawei|honor|choice|rossini|2i|hard pc|full coverage)\b/i.test(h)) {
    return "This hard-PC protective case adds a full-coverage frame and glass cover for compatible Huawei, Honor, Choice, and Rossini 2i watches. Check the exact watch model, case dimensions, and cutouts before ordering.";
  }
  if (/\b(?:skin tint|tinted serum|foundation balm|contour stick)\b/i.test(h) && /\bstick\b/i.test(h)) {
    return "This waterproof skin-tint and contour stick combines a solid tinted serum or foundation balm with a portable face-makeup format. Check the selected shade, skin compatibility, and application directions before use.";
  }
  if (/\b(?:diamond|pearlescent)\b/i.test(h) && /\blipsticks?\b/i.test(h)) {
    return "This diamond pearlescent lipstick gives lips a reflective color finish with the waterproof, long-lasting, and non-stick qualities listed for the shade. Check the selected color and application directions before use.";
  }
  if (/\b(?:heating suit|heated trouser|heated vest|heated jacket|heated gloves?)\b/i.test(h) && /\b(?:5v|5000mah|powerbank|external powerbank|battery)\b/i.test(h)) {
    const capacity = h.match(/\b\d{4,6}\s*mah\b/i)?.[0]?.replace(/mah/i, "mAh") || "";
    const voltage = h.match(/\b\d+(?:\.\d+)?v\b/i)?.[0]?.toUpperCase() || "";
    const rating = [voltage, capacity].filter(Boolean).join(" ") || "listed-rating";
    return `This ${rating} power bank is designed to supply compatible heated clothing such as jackets, trousers, vests, or gloves. Check the output, connector, and garment compatibility before ordering.`;
  }
  if (/\b(?:airpods?|air pods)\b/i.test(h) && /\b(?:ear tips?|eartips?|ear caps?|silicone)\b/i.test(h)) {
    return "These replacement silicone ear tips are shaped for AirPods Pro 1st and 2nd generation and include a pressure-relief opening for the listed fit. Choose the correct size and confirm the earbud model before ordering.";
  }
  if (/\bjbl\b/i.test(h) && /\b(?:earpads?|ear pads?|earmuffs?)\b/i.test(h)) {
    return "These soft replacement earpads are shaped for JBL Tune 700BT, 710BT, 720BT, 700BTNC, 750BTNC, T760NC, and 770NC headphones. Check the exact model and ear-cup dimensions before ordering.";
  }
  if (/(?:powerbank|power bank|external battery)/i.test(h)) {
    const capacity = h.match(/\b\d{4,6}\s*mah\b/i)?.[0] || size || "";
    return `This ${capacity ? `${polishListingValue(capacity)} ` : ""}${/magnetic|magsafe/i.test(h) ? "magnetic " : ""}${/wireless/i.test(h) ? "wireless " : ""}power bank provides portable charging for compatible devices. Check the wattage, connector, and phone fit before use.`.replace(/\s+/g, " ");
  }
  if (/\bvention\s+usb\s+3\s+0\s+extension\s+cable\b/i.test(h) && /\bmale\s+to\s+male\b/i.test(h)) return "This VENTION USB 3.0 Type-A male-to-male extension cable adds reach between a computer, TV box, hard drive, or other compatible USB device. Check the connector type, cable length, and device-side USB standard before ordering.";
  if (/\b5gbps\s+usb\s+3\s+0\s+extension\s+cable\b/i.test(h) && /\bmale\s+to\s+female\b/i.test(h)) return "This 5Gbps USB 3.0 male-to-female extension cable adds reach for PCs, hard drives, laptops, smart TVs, and cameras. Check the USB-A connector fit, required speed, and cable length before ordering.";
  if (/\busb\s+extension\s+cable\b/i.test(h) && /\b1m\b.*\b2m\b.*\b3\s+0m\b/i.test(h)) return "This USB 3.0 extension cable offers 1m, 2m, and 3m length options for extending a compatible TV, SSD, Xbox, laptop, or PC connection. Check the selected length, connectors, and required USB standard before ordering.";
  if (/\bvention\s+usb\s+3\s+0\s+extension\s+cable\b/i.test(h) && /\bmale\s+to\s+female\b/i.test(h)) return "This VENTION USB 3.0 male-to-female extension cable extends a compatible laptop, PC, or other USB connection. Check the selected length, connector orientation, and whether the device requires USB 2.0 or USB 3.0 before ordering.";
  if (/\bkeychains?\b|\bkey fob\b/i.test(h) && !/\bkeychain case\b/i.test(h)) {
    if (/\bmashle\b/i.test(h)) return "This Mashle: Magic and Muscles anime keychain adds a compact character accent to keys, bags, or a zipper pull. Check the clasp, dimensions, and finish before ordering.";
    if (/\b(?:volleyball|haikyuu)\b/i.test(h)) return "This Haikyuu volleyball anime acrylic keychain adds a character accent to keys, bags, or a zipper pull. Check the clasp, dimensions, acrylic finish, and selected character before ordering.";
    if (/\bmidna\b/i.test(h)) return "This Midna Chibi anime keychain adds a compact character accent to a bag, key ring, or zipper pull. Check the clasp, dimensions, and finish before ordering.";
    if (/\bdanganronpa\b/i.test(h)) return "This Danganronpa anime game keychain adds a character charm to keys, bags, or a zipper pull. Check the clasp, dimensions, and finish before ordering.";
    return `This ${/anime|manga/i.test(h) ? "anime " : /embroidered/i.test(h) ? "embroidered " : "decorative "}keychain adds a compact accent to keys, bags, or a zipper pull. Check the clasp, dimensions, and finish before ordering.`;
  }
  if (/\b(?:messenger|sling|crossbody|bumbag)\b/i.test(h) && /\b(?:bag|backpack|packet)\b/i.test(h)) {
    return `This ${/waterproof/i.test(h) ? "waterproof " : ""}${/messenger/i.test(h) ? "messenger" : "crossbody"} bag keeps everyday essentials close with a shoulder or crossbody carry format. Check the strap, compartments, and capacity before ordering.`;
  }
  if (/\b(?:stand|riser|elevated)\b/i.test(h) && /\bkeyboard\b/i.test(h)) {
    return "This raised keyboard stand lifts a compatible keyboard to a more comfortable desk angle. Check the base dimensions, grip, and keyboard fit before ordering.";
  }
  if (/\b(?:castor|essential|hair oil|scalp oil)\b/i.test(h) && /\boil\b/i.test(h)) {
    const capacity = h.match(/\b\d+\s*ml\b/i)?.[0] || size || "";
    return `This ${capacity ? `${polishListingValue(capacity)} ` : ""}${/castor/i.test(h) ? "castor " : /essential/i.test(h) ? "essential " : "nourishing hair "}oil adds a simple care step for hair or skin. Check the ingredients and application directions before use.`.replace(/\s+/g, " ");
  }
  if (/\b(?:backpack|rucksack|daypack)\b/i.test(h) && !/\b(?:accessories|hardware|buckle|keychain|keychains|messenger|sling|crossbody|bumbag)\b/i.test(h)) {
    const capacity = h.match(/\b\d+\s*l\b/i)?.[0] || "";
    const features = [
      /tactical|molle/i.test(h) ? "tactical MOLLE organization" : "",
      /waterproof/i.test(h) ? "water-resistant protection" : "",
    ].filter(Boolean);
    const use = /hiking|trekking/i.test(h) ? "hiking and trekking" : /camping/i.test(h) ? "camping" : /travel/i.test(h) ? "travel" : "outdoor carry";
    const featureText = features.length ? ` It adds ${features.join(" and ")}.` : "";
    const audience = /\b(?:women|womens|woman|female|ladies)\b/i.test(h) ? "women's " : "";
    const lightweight = /\blightweight\b/i.test(h) ? "lightweight " : "";
    return `This ${lightweight}${audience}${capacity ? `${capacity} ` : ""}${use} backpack is built for carrying clothing, gear, and daily essentials.${featureText} Check the capacity, compartments, and shoulder-strap fit before ordering.`;
  }
  if (/articulated arm.*(?:hex pin|female thread)|(?:hex pin|female thread).*articulated arm/i.test(h)) {
    return "This three-section articulated camera arm positions a compatible light or camera with a 5/8 hex pin and female-thread fittings. Check the pin, thread sizes, and supported load before ordering.";
  }
  if (/(?:3[ .-]?5\s*mm|35mm).*?(?:aux|audio).*cable.*(?:xh2|terminal)|(?:aux|audio).*cable.*(?:xh2|terminal)/i.test(h)) {
    return "This audio lead connects a 3.5mm AUX source to an XH2.54 3-pin male terminal. Check the pin spacing, connector direction, and cable length against the equipment before ordering.";
  }
  if (/\b(?:stream deck|lcd keys?|customizable keys?|livestreaming board)\b/i.test(h)) {
    return "This LCD stream deck puts customizable shortcut keys at hand for gaming, livestreaming, broadcasting, or content creation. Check the key count, connection, display size, and supported software before ordering.";
  }
  if (/\bkeyboard\s+(?:case|cover)\b/i.test(h) && /\b(?:redmi pad|xiaomi redmi pad)\b/i.test(h)) {
    return "This keyboard case combines a protective cover with a typing surface for the Xiaomi Redmi Pad 2, including the pencil-slot format shown for the model. Check the tablet generation, connector, key layout, and cutouts before ordering.";
  }
  if (/\belectric piano\b/i.test(h) && /\bkeyboard\b/i.test(h)) {
    const keys = h.match(/\b\d+\s*(?:key|keys)\b/i)?.[0] || "37-key";
    return `This ${keys} kids' electric piano combines a compact keyboard with a microphone for singing, music play, and early learning. Check the key count, microphone connection, power source, and included functions before ordering.`;
  }
  if (/\b(?:mouse ?pad|mouse ?mat|desk mat|desk carpet)\b/i.test(h)) {
    return `This ${/gaming|gamer/i.test(h) ? "gaming " : /anime|pokemon|gengar/i.test(h) ? "anime " : "desk "}mouse pad creates a smooth surface for a keyboard and mouse. Check the dimensions, edge finish, and desk fit before ordering.`;
  }
  if (/\b(?:wrist rest|wrist support|wrist cushion)\b/i.test(h) && /\b(?:keyboard|mouse|computer)\b/i.test(h)) {
    return `This ${/memory foam/i.test(h) ? "memory-foam " : ""}keyboard and mouse wrist-rest pad supports the hand area during desk use. Check the length, thickness, and desk fit before ordering.`;
  }
  if (/\bkeyboard\b/i.test(h)) {
    if (/\b(?:stand|riser|elevated)\b/i.test(h)) return "This raised keyboard stand lifts a compatible keyboard to a more comfortable desk angle. Check the base dimensions, grip, and keyboard fit before ordering.";
    if (/\bkeyboard\b/i.test(h) && /\bmouse\b/i.test(h)) return "This wireless keyboard and mouse set combines typing with pointer control for compatible computers or tablets. Check the layout, receiver, and device compatibility before ordering.";
    if (/coiled|aviator|detachable/i.test(h) && /\bcable\b/i.test(h)) return "This coiled USB keyboard cable uses a detachable aviator connector for a compatible mechanical keyboard setup. Check both connector ends and cable reach before ordering.";
    if (/air mouse|touchpad|touch pad/i.test(h) && /wireless|bluetooth/i.test(h)) return "This wireless keyboard and air-mouse combination adds a touchpad-style control surface for compatible computers or TV boxes. Check the layout, language, receiver, and device compatibility before ordering.";
    return `This ${/mechanical/i.test(h) ? "mechanical " : /gaming/i.test(h) ? "gaming " : ""}keyboard provides the key layout and ${/wireless|bluetooth/i.test(h) ? "wireless" : "wired"} connection described in the listing. Check the layout, interface, and device compatibility before ordering.`;
  }
  if (/\b(?:computer mouse|wireless mouse|bluetooth mouse|gaming mouse|mouse remote)\b/i.test(h) && !/mouse ?pad|mouse ?mat/i.test(h)) {
    return `This ${/gaming/i.test(h) ? "gaming " : ""}${/silent/i.test(h) ? "silent " : ""}computer mouse provides pointer control through the ${/wireless|bluetooth/i.test(h) ? "wireless" : "wired"} connection described in the listing. Check the connection, controls, and device compatibility before ordering.`;
  }
  if (/(?:watch|wristwatch|chronograph|quartz watch|digital watch|analog watch)/i.test(h) &&
      !/watch band|watch strap|watchband|replacement strap|watch box|watch organizer|jewelry set|smartwatch|smart watch|power bank|battery|charger|blanket|duvet|phone/i.test(h)) {
    const mechanism = /chronograph/i.test(h) ? "chronograph" : /quartz/i.test(h) ? "quartz" : /digital|electronic|led/i.test(h) ? "digital" : "analog";
    const features = [/waterproof|water resistant/i.test(h) ? "water-resistant" : "", /solar/i.test(h) ? "solar-powered" : "", /leather/i.test(h) ? "leather strap" : /stainless steel|steel band/i.test(h) ? "steel strap" : ""].filter(Boolean).slice(0, 2);
    const audience = /\b(?:men|mens|man|male)\b/i.test(h) && /\b(?:women|womens|woman|female|ladies)\b/i.test(h) ? "unisex " : /\b(?:men|mens|man|male)\b/i.test(h) ? "men's " : /\b(?:women|womens|woman|female|ladies)\b/i.test(h) ? "women's " : "";
    return `This ${audience}${mechanism} wristwatch${features.length ? ` uses a ${features.join(" and ")}` : ""} for everyday timekeeping. Check the case size, strap, functions, and water-resistance details before ordering.`;
  }
  if (/\b(?:watch|wristwatch)\b/i.test(h) && /\b(?:box|organizer|travel case|display|storage)\b/i.test(h) && !/\b(?:smartwatch|smart watch|watch band|watch strap|watchband|replacement strap)\b/i.test(h)) {
    return "This portable watch organizer case keeps wristwatches separated for travel, storage, or display. Check the compartment layout, closure, and watch-size fit before ordering.";
  }
  if (/\b(?:tumbler|snowglobe|snow globe|pre[- ]?drilled|mason jar)\b/i.test(h) && /\b(?:tumbler|bottle|cup)\b/i.test(h)) {
    const capacity = h.match(/\b\d+\s*(?:ml|oz)\b/i)?.[0] || size || "";
    return `This DIY snow-globe tumbler is a reusable plastic cup with a pre-drilled opening for a custom insert. Check the ${capacity ? `${polishListingValue(capacity)} capacity, ` : ""}lid, included parts, and care instructions before ordering.`;
  }
  if (/\b(?:thermos|tumbler|water bottle)\b/i.test(h)) {
    return `This ${size ? `${polishListingValue(size)} ` : ""}stainless-steel insulated travel cup carries hot or cold drinks with the straw or handle format shown here. Check the lid seal, opening, and cleaning instructions before use.`;
  }
  if (/(?:spray bottles?|droppers?|funnels?).*(?:amber|glass|mini|travel)|(?:amber|glass|mini|travel).*(?:spray bottles?|droppers?|funnels?)/i.test(h)) {
    return "This amber-glass travel bottle set combines mini spray bottles, funnels, and droppers for decanting small amounts of liquid. Check the piece count, bottle capacity, and intended contents before use.";
  }
  if (/(?:stationery|stickers?|office|pencil|manual account|tool case).*(?:holder|organizer|storage|box|container)|(?:holder|organizer|storage|box|container).*(?:stationery|stickers?|office|pencil|manual account|tool case)/i.test(h) && !/\b(?:phone holder|phone stand|phone mount|cell phone)\b/i.test(h)) {
    return "This transparent plastic stationery organizer box keeps stickers, office supplies, and small tools together in a compact storage case. Check the compartments, dimensions, and closure before ordering.";
  }
  if (/\b(?:t[- ]?shirt|tee)\b/i.test(h) && /\bdress\b/i.test(h)) {
    const audience = /\b(?:women|womens|woman|female|ladies)\b/i.test(h) ? "women's " : /\b(?:men|mens|man|male)\b/i.test(h) ? "men's " : "";
    const neckline = /v[- ]?neck/i.test(h) ? "V-neck " : /round neck|o neck|crew neck/i.test(h) ? "crew-neck " : "";
    const sleeve = /short sleeve/i.test(h) ? "short-sleeve " : /long sleeve/i.test(h) ? "long-sleeve " : "";
    return `This ${audience}${neckline}${sleeve}T-shirt dress brings a relaxed silhouette to the beach or warm-weather wardrobe. Check the selected size, fabric, and care instructions before ordering.`;
  }
  if (/(?:handmade|woven|straw|rattan).*(?:handbag|bucket|tote|basket)|(?:handbag|bucket|tote|basket).*(?:handmade|woven|straw|rattan)/i.test(h)) {
    const material = /straw|rattan/i.test(h) ? "woven straw" : "woven";
    return `This handmade bucket handbag uses a ${material} body with a drawstring or top handle for summer and beach styling. Check the capacity, closure, and handle length before ordering.`;
  }
  if (/(?:watch band|watch strap|watchband|replacement strap)\b/i.test(h)) return `This replacement watch strap refreshes a compatible wristwatch with a ${/leather/i.test(h) ? "leather" : /silicone/i.test(h) ? "silicone" : /nylon/i.test(h) ? "nylon" : "metal"} band${strictWatchModel(h) ? ` for ${strictWatchModel(h)}` : ""}. Check the lug width and fastening before ordering.`;
  if (/\bmens?\s+led\s+square\s+watch\s+and\s+jewelry\s+set\b/i.test(h)) return "This men's LED square watch is paired with coordinated jewelry pieces for a birthday gift set. The listing notes that the box is not included.";
  if (/\b(?:smart glasses|shooting glasses)\b/i.test(h) && /\b(?:camera|bluetooth|translation)\b/i.test(h)) return "These smart glasses combine a built-in camera, Bluetooth connection, and translation tools for hands-free everyday use. Check the lens fit, charging method, and supported functions before ordering.";
  if (/\becg\s+ppg\b/i.test(h) && /\b(?:smartwatch|smart watch)\b/i.test(h)) return "This ECG and PPG smart watch combines Bluetooth calling with GPS, heart-rate tracking, and IP68 water resistance for sports and everyday wrist wear. Check phone compatibility, charging method, and supported health features before ordering.";
  if (/\blige\b/i.test(h) && /\b(?:smartwatch|smart watch)\b/i.test(h)) return "This LIGE smart watch combines fitness tracking, heart-rate monitoring, waterproof protection, and Bluetooth connectivity for Android or iOS phones. Check phone compatibility, charging method, case size, and supported functions before ordering.";
  if (/\bfull\s+touch\s+screen\b/i.test(h) && /\b(?:message|music|call)\b/i.test(h) && /\b(?:smartwatch|smart watch)\b/i.test(h)) return "This full-touch smart watch supports the listed call, message-reminder, and music-control functions for compatible iPhone or Android phones. Check the screen size, phone compatibility, charging method, and supported features before ordering.";
  if (/\bht30\b/i.test(h) && /\b(?:smartwatch|smart watch)\b/i.test(h)) return "This HT30 smart watch pairs Bluetooth calling with a 1.44-inch color display and the listed blood-oxygen and blood-pressure monitoring functions. Check phone compatibility, charging method, screen size, and supported health features before ordering.";
  if (/\b(?:smartwatch|smart watch)\b/i.test(h) && !/watch strap|watchband/i.test(h)) return "This smart watch combines a wrist display with the connectivity and fitness tools listed for the model. Check phone compatibility, charging method, and supported functions before ordering.";
  if (/\b(?:neck fan|wearable neck)\b/i.test(h)) return "This wearable neck fan provides hands-free airflow in a bladeless format, with the listed speed controls and display to check before ordering. Confirm the charging method and neck fit before use.";
  if (/\b(?:car cleaning|car wash)\b/i.test(h) && /\b(?:brush|cleaning kit|drill brush)\b/i.test(h)) return "This car-cleaning brush kit combines drill, vent, wheel, and detail brushes for cleaning vehicle interiors or exteriors. Check the included brush heads, drill fit, and pack count before ordering.";
  if (/\bsmart bracelet\b/i.test(h) && !/bracelet accessories|charm bracelet/i.test(h)) return "This smart bracelet pairs an LED display with waterproof, pedometer, and vibration-alarm functions for everyday wrist wear. Check the wrist fit, charging method, and phone compatibility before ordering.";
  if (/\banime\b.*\bbracelet\b|\bbracelet\b.*\banime\b/i.test(h)) return "This anime character bracelet pairs a cartoon pendant with a cosplay accessory for a fan-themed outfit or gift. Check the bracelet size, clasp, pendant finish, and care instructions before ordering.";
  if (/\bmichael jackson\b/i.test(h) && /\b(?:t shirt|tee)\b/i.test(h)) return "This Michael Jackson printed cotton t-shirt brings the named music graphic to casual hip-hop outfits for men and women. Check the selected size, neckline, and care instructions before ordering.";
  if (/\b(?:beads?|spacer beads?)\b/i.test(h) && /\b(?:jewelry making|diy|loose)\b/i.test(h)) return `These acrylic spacer beads add round separators to DIY jewelry projects, with a frosted finish and the ${h.match(/\b\d+(?:-\d+)+\s*mm\b/i)?.[0] || "listed"} size range. Check the bead-hole size and quantity before ordering.`;
  if (/\b(?:necklace|earrings?)\b/i.test(h) && /\b(?:jewelry set|earring set|necklace set|zircon|dangle earrings?|crystal.*necklace.*earring|necklace.*earring.*set)\b/i.test(h)) {
    return "This necklace and earring set pairs a decorative pendant with coordinated earrings for a polished occasion or gift look. Check the pendant finish, chain length, earring backs, and included pieces before ordering.";
  }
  if (/\b(?:necklace|earrings?|bracelet)\b/i.test(h) && /\b(?:jewelry set|3 piece set|3-piece set|brides?|weddings?)\b/i.test(h)) {
    return /\b(?:brides?|weddings?)\b/i.test(h)
      ? "This bridal jewelry set brings together a necklace, earrings, and bracelet with a crystal or rhinestone finish. Check the chain length, fastening, and included pieces before ordering."
      : "This three-piece jewelry set combines a necklace, earrings, and bracelet with a crystal or rhinestone finish. Check the included pieces and fastening before ordering.";
  }
  if (/\b(?:italian charm|charm bracelet)\b/i.test(h) && /\bbracelet\b/i.test(h)) return "This Italian charm bracelet uses linked sections to build a personalized wrist accessory with flower, dog, heart, or bead motifs. Check the link size and finish before ordering.";
  if (/\b(?:iris|flower)\b.*\b(?:bangle|bracelet)\b|\b(?:bangle|bracelet)\b.*\b(?:iris|flower)\b/i.test(h)) return "This adjustable iris-flower bangle bracelet adds a floral accent with an open, vintage-inspired shape. Check the inner diameter and finish before ordering.";
  if (/(?:^|\s)fan(?:\s|$)/i.test(h) && !/fan cat.*t shirt|car cleaning|brush fan|air conditioning brush|anime.*keychain|keychain.*anime|anime.*bracelet|bracelet.*anime|fan gifts?|michael jackson.*t shirt|t shirt.*michael jackson/i.test(h)) {
    const format = /folding|handheld/i.test(h) ? "folding handheld fan" : /desk/i.test(h) ? "desk fan" : "portable fan";
    const speed = h.match(/\b\d+\s*speed\b/i)?.[0]?.replace(/\s+/g, "-") || "";
    const features = [
      speed ? `${speed} settings` : "",
      /phone stand/i.test(h) ? "a phone stand" : "",
      /led display/i.test(h) ? "an LED display" : "",
      /usb\s*c/i.test(h) ? "USB-C charging" : /usb|rechargeable/i.test(h) ? "USB charging" : "",
      /turbo|high speed/i.test(h) ? "high-speed airflow" : "",
    ].filter(Boolean).slice(0, 3);
    const featureText = features.length ? ` with ${features.join(", ")}` : "";
    const setting = /outdoor|travel/i.test(h) ? " for travel or outdoor cooling" : " for personal cooling";
    return `This ${format}${featureText} is designed${setting}. Check the power connection, controls, and size before ordering.`;
  }
  if (/\b(?:lip liner|lipliner)\b/i.test(h)) return `This lip-liner pen set outlines and shapes the lips with waterproof, long-wear, or color options. Check the included shades and application directions before use.${sizeText}`;
  if (/\b(?:face body paint|face and body paint|body paint|face paint)\b/i.test(h)) return `This face-and-body paint kit provides the colors and finish for makeup, cosplay, or stage looks. Check the shade count, brush contents, and skin-use directions before use.${sizeText}`;
  if (/\bthermal printer sticker paper\b/i.test(h)) return "This self-adhesive sticker paper is sized for compatible mini thermal printers and instant-print cameras. Check the roll dimensions, printer fit, and adhesive surface before ordering.";
  if (/\bwall stickers?\b/i.test(h)) return "These LED wall stickers add bat, spider, or seasonal decoration to an indoor or outdoor party space. Check the power source and mounting surface before use.";
  if (/\b(?:journal|scrapbook|notebook|stationery|landscape|scenery)\b.*\bstickers?\b|\bstickers?\b.*\b(?:journal|scrapbook|notebook|stationery|landscape|scenery)\b/i.test(h) && !/phone holder|speaker|body paint|fidget|keychain/i.test(h)) return `This decorative sticker set adds seasonal, landscape, or themed artwork to journals, notebooks, or craft projects. Check the sheet or pack count and adhesive surface before ordering.${sizeText}`;
  if (/\b(?:diamond painting|diamond mosaic|rhinestone painting|mosaic painting)\b/i.test(h)) return "This diamond-painting kit turns its printed design into a rhinestone mosaic for a hands-on craft project. Check the canvas size and included tools before ordering.";
  if (/\b(?:witch hat|salt pepper|spice)\b.*\b(?:jar|container)\b|\b(?:jar|container)\b.*\b(?:witch hat|salt pepper|spice)\b/i.test(h)) return "This witch-hat storage jar keeps salt, pepper, or other seasonings together on a kitchen counter. Check the capacity and opening before ordering.";
  if (/\b(?:ring settings?|blank base|cabochon.*bezels?)\b/i.test(h) && /\b(?:ring|bezels?)\b/i.test(h)) return "This adjustable ring blank setting holds a compatible glass cabochon or button in the available size range. Check the bezel diameter and finish before ordering.";
  if (/\b(?:skincare set|skin care set)\b/i.test(h) && /\b(?:toner|cream|sunscreen|serum)\b/i.test(h)) return "This Korean skincare set brings together toner, face cream, and sun-care steps for a layered routine. Check the included formulas, sizes, and application directions before use.";
  if (/\b(?:cosmetic|makeup) organizer\b|\b(?:cosmetic|makeup) storage\b/i.test(h)) return "This makeup organizer keeps cosmetics, brushes, jewelry, or stationery arranged in its desktop compartments. Check the footprint, drawer layout, and material before ordering.";
  if (/\b(?:cable digital storage|cable storage bag|cable organizer bag)\b/i.test(h) && /\b(?:bag|storage)\b/i.test(h)) return "This portable cable organizer bag keeps chargers, wires, and small electronic accessories together in a zippered storage format. Check the compartment size and cable capacity before ordering.";
  if (/\b(?:cable organizer|wire organizer|cord management|cable routing)\b/i.test(h)) return "This cable organizer groups charging and data leads with a fastening or desktop format. Check the cable width, attachment method, and workspace fit before ordering.";
  if (/\b(?:makeup brush cleaner|cosmetic brush cleaner)\b/i.test(h)) return "This USB makeup brush cleaner washes and dries cosmetic brushes in a compact 3-in-1 format. Check the power connection, brush-size fit, and cleaning instructions before use.";
  if (/\b(?:foundation|concealer)\b.*\b(?:brush|blender)\b|\b(?:brush|blender)\b.*\b(?:foundation|concealer)\b/i.test(h)) return `This foundation and concealer brush uses a dense head for applying and blending complexion products around the face. Check the bristle shape, handle, and cleaning directions before use.${sizeText}`;
  if (/\b(?:makeup brush|cosmetic brush|eyeshadow brush)\b/i.test(h) && !/organizer|cleaner/i.test(h)) return `This makeup brush set covers foundation, powder, eye, or blending applications. Check the brush mix, handle length, and included case before ordering.${sizeText}`;
  if (/\b(?:fixed|universal)\b.*\b(?:waterproof|anti fog)\b.*\b(?:phone case|phone holder|shower)\b/i.test(h)) return "This fixed waterproof anti-fog phone holder keeps a compatible smartphone usable during shower or bathroom use. Check the phone size, seal, and mounting surface before ordering.";
  if (/\b(?:phone pouch|phone sleeve|waterproof.*phone.*(?:pouch|case)|phone.*(?:pouch|sleeve))\b/i.test(h)) return "This waterproof touchscreen phone pouch keeps a phone dry and usable during swimming, beach trips, or other wet outdoor activities. Check the phone size and closure before ordering.";
  if (/\b(?:phone case|iphone case|tablet case)\b|(?:case|cover).*\b(?:iphone|ipad|tablet|redmi pad|xiaomi pad)\b|\b(?:iphone|ipad|tablet|redmi pad|xiaomi pad)\b.*\b(?:case|cover)\b/i.test(h)) {
    const model = h.match(/\biphone\s*(\d{1,2})\s*(pro|max|plus|mini|air)?\b/i);
    const tablet = /\b(?:ipad|redmi pad|xiaomi pad|tablet)\b/i.test(h);
    if (tablet && !model) return `This tablet case is sized for ${/redmi pad|xiaomi pad/i.test(h) ? "Xiaomi Redmi Pad models" : "iPad Air models"} and folds into the stand or cover format shown here. Check the exact model, camera cutout, and closure before ordering.`;
    return `This ${/magnetic|magsafe|macsafe/i.test(h) ? "magnetic " : ""}${/shockproof/i.test(h) ? "shockproof " : ""}iPhone case is sized for ${model ? `iPhone ${model[1]}${model[2] ? ` ${model[2]}` : ""}` : "compatible devices"} and the additional models listed here. Check the exact model, camera cutout, and closure before ordering.`;
  }
  if (/\b(?:phone holder|phone stand|phone mount|cell phone stand)\b/i.test(h)) return `This phone holder keeps a compatible smartphone in ${/car/i.test(h) ? "position for car use" : /desk|table/i.test(h) ? "a stable desk position" : "the mounted position shown here"}. Check the device width, attachment method, and viewing angle before ordering.`;
  if (/\b(?:earpads?|ear pads?|earphone pads?|headphone pads?)\b/i.test(h)) return "These replacement audio accessories restore cushioning around compatible headphones in an earpad, memory-foam, leather, or fabric format. Check the ear-cup dimensions and model fit before ordering.";
  if (/\b(?:ear tips?|eartips?|ear caps?)\b/i.test(h)) return "These replacement silicone ear tips refresh compatible earbuds with the available size range and pressure-relief shape. Check the earbud model and selected size before ordering.";
  if (/\b(?:squeegee|window cleaning|glass cleaning)\b/i.test(h)) return "This stainless-steel squeegee clears water from windows, glass, or bathroom surfaces in the listed length. Check the blade width, handle, and storage method before ordering.";
  if (/\b(?:inflatable|air) mattress\b|\bmattress\b.*\b(?:camping|sleeping)\b/i.test(h)) return "This inflatable camping mattress creates a wider sleeping surface for indoor or outdoor use, with the listed warmth, thickness, and capacity. Check the packed size and inflation method before ordering.";
  if (/\b(?:thermos|tumbler|water bottle)\b/i.test(h)) return `This insulated drink bottle keeps a hot or cold drink in the listed capacity and straw or handle format. Check the lid seal, opening, and cleaning instructions before use.${sizeText}`;
  if (/\b(?:button down shirts?|button-down shirts?)\b/i.test(h) && /\bshirts?\b/i.test(h)) return `This button-down shirt combines the ${/linen/i.test(h) ? "lightweight linen-blend" : /cotton/i.test(h) ? "cotton" : "casual"} fabric and sleeve cut for everyday or beach wear. Check the size, buttons, and care instructions before ordering.`;
  if (/\bdress\b/i.test(h) && /\b(?:lace up|printed|chinese style)\b/i.test(h)) return "This printed dress combines a lace-up detail with a long-sleeve silhouette for casual or occasion wear. Check the size, fabric, and care instructions before ordering.";
  if (/\b(?:pajamas?|pijamas?|sleepwear)\b/i.test(h)) return `This ${/pikachu|pokemon/i.test(h) ? "Pikachu " : "kids' "}pajama set combines a soft sleeping outfit with the long-sleeve, age, or character details listed for the style. Check the size and care instructions before ordering.`;
  if (/\bvest\b/i.test(h) && /\b(?:t shirt|tee|sports|fitness)\b/i.test(h)) return "This cotton sleeveless sports t-shirt works as a lightweight casual or fitness layer, with the pack and size options listed for the style. Check the fit and care instructions before ordering.";
  if (/\b(?:beauty and the beast|movie jewelry)\b/i.test(h) && /\bnecklace\b/i.test(h)) return "This Beauty and the Beast pendant necklace adds a storybook charm to a gift or occasion outfit. Check the chain length, pendant finish, and fastening before ordering.";
  if (/\banime\b.*\bkeychain\b|\bkeychain\b.*\banime\b/i.test(h)) return "This anime lock keychain adds a Jet character tag to keys, bags, or a car accessory set. Check the clasp, tag size, and finish before ordering.";
  if (/\b(?:cotton|100 cotton)\b.*\b(?:mens?|men)\b.*\b(?:t shirt|tee)\b/i.test(h)) return "This men's cotton crew-neck t-shirt uses a solid-color, breathable cut for casual layering. Check the selected size, fabric care, and fit before ordering.";
  if (/\bstriped shirt\b/i.test(h)) return "This striped shirt is styled for spring-and-summer casual wear, with the listed seasonal pattern and fit to check before ordering.";
  if (/\byoshimura\b/i.test(h) && /\b(?:t shirt|tee)\b/i.test(h)) return "This Yoshimura cotton t-shirt brings the named motorsport brand graphic to a casual wardrobe. Check the selected size, fabric, and care instructions before ordering.";
  if (/\b(?:bangle|bracelet)\b/i.test(h)) {
    const audience = /\b(?:women|womens|woman|female|ladies|men|mens|man|male|unisex)\b/i.test(h) ? " for men and women" : "";
    return `This ${/leather/i.test(h) ? "leather " : /stainless steel|metal/i.test(h) ? "metal " : ""}bracelet adds a wearable accent${audience}, with a retro or casual finish. Check the fit and fastening before ordering.`;
  }
  if (/\b(?:fan cat|cat and women).*\b(?:t shirt|tee)\b/i.test(h)) return "This cat graphic t-shirt brings its printed design to casual outfits for men and women. Check the selected size, fabric, and care instructions before ordering.";
  if (/\b(?:t[- ]?shirt|tee)\b/i.test(h)) {
    if (/\b(?:baby|infant|newborn|toddler)\b/i.test(h) && /\b(?:pants?|trousers?|outfit|set)\b/i.test(h)) {
      return "This baby clothing set pairs a T-shirt with matching pants for an easy everyday outfit. Check the selected size, fabric, and care instructions before ordering.";
    }
    if (/\bpolo\b/i.test(h)) return "This polo shirt brings a collared, short-sleeve silhouette to casual everyday outfits. Check the selected size, fabric, and care instructions before ordering.";
    if (/\b(?:tank|sleeveless|vest)\b/i.test(h)) return "This sleeveless T-shirt works as a lightweight layer for casual wear or warm-weather activity. Check the selected size, fabric, and care instructions before ordering.";
    const audience = /\b(?:women|womens|woman|female|ladies)\b/i.test(h) ? "women's " : /\b(?:men|mens|man|male)\b/i.test(h) ? "men's " : /\b(?:kids?|children|boys?|girls?)\b/i.test(h) ? "kids' " : "";
    const design = /\banime\b|\bgraphic\b|\bprinted\b|\bprint\b|\bquote\b|\bcharacter\b|\bpattern\b/i.test(h) ? "printed " : "";
    const material = /\bcotton\b/i.test(h) ? "cotton " : /\blinen\b/i.test(h) ? "linen " : "";
    const sleeve = /\bshort[- ]?sleeve\b/i.test(h) ? "short-sleeve " : /\blong[- ]?sleeve\b/i.test(h) ? "long-sleeve " : "";
    return `This ${audience}${design}${material}${sleeve}T-shirt brings the listed cut and design to casual everyday wear. Check the selected size, fabric, and care instructions before ordering.`.replace(/\s+/g, " ");
  }
  if (/\b(?:pajamas?|pijamas?|sleepwear)\b/i.test(h)) return `This ${/pikachu|pokemon/i.test(h) ? "Pikachu " : "kids' "}pajama set combines a soft sleeping outfit with the long-sleeve, age, or character details listed for the style. Check the size and care instructions before ordering.`;
  if (/\bvest\b/i.test(h) && /\b(?:t shirt|tee|sports|fitness)\b/i.test(h)) return "This cotton sleeveless sports t-shirt works as a lightweight casual or fitness layer, with the pack and size options listed for the style. Check the fit and care instructions before ordering.";
  if (/\b(?:beauty and the beast|movie jewelry)\b/i.test(h) && /\bnecklace\b/i.test(h)) return "This Beauty and the Beast pendant necklace adds a storybook charm to a gift or occasion outfit. Check the chain length, pendant finish, and fastening before ordering.";
  if (/\b(?:bangle|bracelet)\b/i.test(h)) return `This ${/leather/i.test(h) ? "leather " : /stainless steel|metal/i.test(h) ? "metal " : ""}bracelet adds a simple wearable accent for men and women, with a retro or casual finish. Check the fit and fastening before ordering.`;
  return "";
}

export function buildHandleAlignedTitle(signals) {
  const handle = normalizeHandleValue(signals.handle);
  const primarySemanticHandle = normalizeHandleValue(
    signals.handle || signals.sourceTitle || signals.catalogTitle || "",
  );
  const semanticHandle = normalizeHandleValue([
    signals.handle,
    signals.sourceTitle,
    signals.catalogTitle,
    signals.sourceProductType,
    signals.catalogProductType,
  ].filter(Boolean).join(" "));
  const strictTitle = buildStrictHandleTitle(signals);
  if (strictTitle) return strictTitle;
  if (/^link-for-price-difference(?:-|$)/i.test(handle)) {
    return "Order Price Difference Adjustment";
  }
  // These families are deliberately resolved before broad words such as
  // "case", "hat", and "table". Supplier handles often mention the thing
  // being decorated, stored, or mounted; that incidental word is not the
  // product being sold.
  if (/(?:^|-)stickers?(?:-|$)/i.test(handle)) {
    const count = handle.match(/(?:^|-)(\d+)(?:pcs?|pieces?)(?:-|$)/i)?.[1];
    return `${count ? `${count}-Piece ` : ""}Waterproof Sticker Set for Notebooks and Crafts`;
  }
  if (/(?:diamond-painting|diamond-mosaic|rhinestone-painting|mosaic-painting)/i.test(handle)) {
    return /witch-hat|halloween|christmas|pumpkin/i.test(handle)
      ? "Halloween Witch-Hat Diamond Painting Kit"
      : "Diamond Painting Kit for DIY Crafts";
  }
  if (/(?:witch-hat|salt-pepper|spice).*?(?:jar|container)|(?:jar|container).*?(?:witch-hat|salt-pepper|spice)/i.test(handle)) {
    return /glass/i.test(handle)
      ? "Glass Witch-Hat Salt and Pepper Storage Jar"
      : "Witch-Hat Salt and Pepper Storage Jar";
  }
  if (/(?:cable-organizer|wire-organizer|cord-management|cable-tie|cable-routing)/i.test(handle)) {
    const material = /velcro/i.test(handle) ? "Velcro " : "";
    const setting = /desktop|desk|board/i.test(handle) ? "Desktop " : "";
    return `${/portable/i.test(handle) ? "Portable " : ""}${material}${setting}Cable Organizer for Charging Cables`.trim();
  }
  if (/cat-litter-mat/i.test(handle)) {
    return "Double-Layer Non-Slip Cat Litter Mat";
  }
  if (/mini-electronic-pets?|virtual-cyber-pet/i.test(handle)) {
    return "Mini USB-Charging Virtual Pet Toy";
  }
  if (/seasonal-pet-outfit/i.test(handle)) {
    return "Soft Holiday Pet Outfit for Photos";
  }
  if (/(?:pet|cat|dog).*?(?:carrier|travel).*?(?:cat|dog|pet)|(?:cat|dog|pet).*?(?:carrier|travel)/i.test(handle)) {
    return "Travel Pet Carrier for Cats and Small Dogs";
  }
  if (/storage-rack|storage-cabinet|cosmetic-organizer|desk-organizer|desktop-storage/i.test(handle)) {
    return /cosmetic|makeup/i.test(handle)
      ? "Desktop Cosmetic and Jewelry Organizer"
      : "Desktop Storage Rack and Organizer";
  }
  if (/(?:table-game|puzzle-game|electronic-game|montessori).*?(?:toy|game)|(?:toy|game).*?(?:table-game|puzzle-game|electronic-game|montessori)/i.test(handle)) {
    return "Electronic Montessori Puzzle Game Toy";
  }
  if (/painting-board|projector-art|kids-painting/i.test(handle)) {
    return "LED Projector Painting Board for Kids";
  }
  if (/disposable-bed-sheets?|bed-sheets?/i.test(handle)) {
    const size = handle.match(/(?:^|-)(\d+)-(\d+)(?:cm|cm-)/i);
    return `${size ? `${size[1]}-${size[2]}cm ` : ""}Disposable Bed Sheet Set for Salon Tables`;
  }
  if (/bottle-opener|corkscrew/i.test(handle)) {
    return /personalized|engraved/i.test(handle)
      ? "Personalized Engraved Wooden Bottle Opener and Corkscrew"
      : "Bottle Opener and Corkscrew Set";
  }
  if (/makeup-brush-cleaner|cosmetic-brush-cleaner/i.test(handle)) {
    return "3-in-1 USB Makeup Brush Cleaner and Dryer";
  }
  if (/eyebrow.*(?:gel|cream)|brow.*(?:gel|cream)/i.test(handle)) {
    return "Waterproof Eyebrow Setting Gel";
  }
  if (/(?:foundation|cc-cream).*?(?:brush|blender)|(?:brush|blender).*?(?:foundation|concealer)/i.test(handle)) {
    return "Foundation and Concealer Makeup Brush";
  }
  if (/precision.*tweezers?|tweezers?.*eyebrow/i.test(handle)) {
    return "Stainless-Steel Precision Beauty Tweezers";
  }
  if (/false-eyelash|false-lash|eyelash.*extension|lash.*extension/i.test(handle)) {
    return "False Eyelash Extensions for Eye Makeup";
  }
  if (/facial-mask|face-mask|sheet-mask/i.test(handle)) {
    return "Moisturizing Facial Sheet Mask";
  }
  if (/hairline.*powder|hair.*concealer.*powder/i.test(handle)) {
    return "Hairline Concealer Powder with Applicator";
  }
  if (/cc-cream|color-changing.*cream/i.test(handle)) {
    return "Color-Changing CC Cream Foundation";
  }
  if (/liquid-foundation/i.test(handle)) {
    const size = handle.match(/(?:^|-)(\d+(?:\.\d+)?)(?:ml|ml-)/i)?.[1];
    return `${size ? `${size}ml ` : ""}Liquid Foundation Makeup`.trim();
  }
  if (/matte-lipstick|lipstick|lip-gloss|lipgloss/i.test(handle)) {
    return /lip-gloss|lipgloss/i.test(handle) ? "Mirror-Finish Lip Gloss" : "Matte Lipstick Makeup";
  }
  if (/setting-powder/i.test(handle)) {
    return "Setting Powder for Face Makeup";
  }
  if (/hair-mask/i.test(handle)) {
    return "Nourishing Hair Mask for Dry Hair";
  }
  if (/hair-conditioner|conditioner/i.test(handle)) {
    return "Nourishing Hair Conditioner";
  }
  if (/hair-dye-shampoo|coloring-shampoo/i.test(handle)) {
    const size = handle.match(/(?:^|-)(\d+)ml(?:-|$)/i)?.[1];
    return `${size ? `${size}ml ` : ""}Hair Dye Shampoo`.trim();
  }
  if (/shampoo/i.test(handle)) {
    return "Hair-Care Shampoo";
  }
  if (/scalp.*serum|hair.*serum/i.test(handle)) {
    return "Scalp Care Serum with Applicator";
  }
  if (/hair-oil|hair.*oil/i.test(handle)) {
    const size = handle.match(/(?:^|-)(\d+)ml(?:-|$)/i)?.[1];
    return `${size ? `${size}ml ` : ""}Nourishing Hair Oil`.trim();
  }
  if (/led-mask|beauty-led-mask|red-light.*mask/i.test(handle)) {
    return "Rechargeable LED Light Therapy Face Mask";
  }
  if (/facial-serum|face-serum|skin.*serum|serum.*skin/i.test(handle)) {
    return "Hydrating Facial Serum";
  }
  if (/toner|toning/i.test(handle)) {
    return "Hydrating Facial Toner";
  }
  if (/face-cream|facial-moisturizer|moisturizing-cream|skin.*cream/i.test(handle)) {
    return "Daily Facial Moisturizer";
  }
  if (/sunscreen|sunblock/i.test(handle)) {
    return "Facial Sunscreen and Skin-Care Set";
  }
  if (/jewelry-set|jewelry-sets/i.test(handle)) {
    return /earrings?.*ring|ring.*earrings?/i.test(handle)
      ? "Jewelry Set with Earrings and Ring"
      : "Coordinated Fashion Jewelry Set";
  }
  if (/necklace/i.test(handle)) {
    return /pendant/i.test(handle) ? "Pendant Necklace with Decorative Charm" : "Fashion Necklace";
  }
  if (/earrings?/i.test(handle)) {
    return "Fashion Earrings Set";
  }
  if (/bangle|bracelet/i.test(handle)) {
    return /pearl/i.test(handle) ? "Pearl Bracelet and Brooch Set" : "Everyday Fashion Bracelet";
  }
  if (/brooch|lapel-pin/i.test(handle)) {
    return "Decorative Brooch Lapel Pin";
  }
  if (/(?:trench-coat|coat)/i.test(handle)) {
    const audience = /(?:women|womens|woman|female|ladies)/i.test(handle)
      ? "Women's "
      : /(?:men|mens|man|male)/i.test(handle)
        ? "Men's "
        : "";
    return `${audience}Belted Trench Coat`;
  }
  if (/(?:blouse|button-down-shirt)/i.test(handle)) {
    const audience = /(?:women|womens|woman|female|ladies)/i.test(handle)
      ? "Women's "
      : /(?:men|mens|man|male)/i.test(handle)
        ? "Men's "
        : "";
    return `${audience}Casual Blouse`;
  }
  if (/(?:shirt|t-shirt|tee)/i.test(handle)) {
    return /t-shirt|tee/i.test(handle) ? "Casual Graphic T-Shirt" : "Casual Button-Down Shirt";
  }
  if (/dress/i.test(handle)) {
    const audience = /(?:women|womens|woman|female|ladies)/i.test(handle)
      ? "Women's "
      : /(?:men|mens|man|male)/i.test(handle)
        ? "Men's "
        : "";
    return `${audience}Casual Dress`;
  }
  if (/fangtuosi-1800mm-tripod.*(?:wireless|bluetooth).*phone-holder/i.test(handle)) {
    return "Fangtuosi 1800mm Smartphone and Camera Tripod with Wireless Shutter";
  }
  if (/fixed-universal-waterproof.*anti-fog.*mobile-phone.*(?:shower|bathroom)/i.test(handle)) {
    return "Fixed Universal Waterproof Anti-Fog Mobile Phone Holder for Shower";
  }
  if (/(?:3[ .-]?5\s*mm|35mm).*?(?:aux|audio).*cable.*(?:xh2|terminal)|(?:aux|audio).*cable.*(?:xh2|terminal)/i.test(semanticHandle)) {
    return "3.5mm AUX Audio Cable with XH2.54 3-Pin Male Terminals";
  }
  // Ear-tip listings often contain the word "case" in supplier wording such
  // as "silicone case". Resolve the replacement part before the broader
  // AirPods-case rule below so the customer-facing title cannot describe a
  // protective shell instead of an ear tip.
  if (/(?:ear[- ]?tips?|eartips?|ear[- ]?caps?|silicone[- ]?tips?)/i.test(handle) && /(?:airpods?|buds?|earbuds?|earphones?)/i.test(handle)) {
    return "Replacement Silicone Ear Tips for AirPods Pro";
  }
  if (/collagen.*(?:essence[- ]?)?serum|(?:essence[- ]?)?serum.*collagen/i.test(handle)) {
    return "Seyhze Collagen Serum with Ceramides, Aloe Vera and Centella";
  }
  if (/yoshimura[- ]t[- ]?shirt/i.test(handle)) {
    return "Yoshimura Cotton T-Shirt";
  }
  if (/summer.*(?:3d[- ]?printing|3d[- ]?print).*t[- ]?shirt|3d[- ]?printing.*cool[- ]?black.*t[- ]?shirt/i.test(handle)) {
    return "Black 3D-Print T-Shirt for Casual Summer Wear";
  }
  if (/curren-8291.*(?:chronograph|watch)/i.test(handle)) {
    return "Curren 8291 Quartz Chronograph Watch with Leather Strap";
  }
  if (/4pcs-1pcs.*(?:quartz-watch|watch).*stainless-steel.*strap/i.test(handle)) {
    return "Quartz Watch with Stainless-Steel Strap and Round Case";
  }
  if (/womens-tassel-scarf.*(?:shawl|wrap|cashmere)/i.test(handle)) {
    return "Custom Photo Tassel Scarf Shawl Wrap";
  }
  if (/a-womens-bracelet.*(?:wide|smooth|surface)/i.test(handle)) {
    return "Wide Smooth Everyday Bracelet";
  }
  if (/the-3d-printed-mens-t-shirt/i.test(handle)) {
    return "3D-Printed T-Shirt for Casual Summer Wear";
  }
  if (/summer-seamless.*ice-silk.*t-shirt/i.test(handle)) {
    return "Breathable Ice-Silk V-Neck T-Shirt with Short Sleeves";
  }
  if (/etj-autumn.*(?:trench-coat|double-breasted)/i.test(handle)) {
    return "Maillard Double-Breasted Trench Coat with Belt";
  }
  if (/retro-hong-kong.*(?:skirt|wraparound)/i.test(handle)) {
    return "Retro Corduroy Mid-Length Wrap Skirt";
  }
  if (/korean-style.*(?:cardigan|knitted)/i.test(handle)) {
    return "Korean-Style Knitted Cardigan Jacket";
  }
  if (/mens-upf50.*(?:t-shirt|hoodie)/i.test(handle)) {
    return "UPF 50+ Quick-Dry Hoodie T-Shirt for Outdoor Wear";
  }
  if (/(?:jeans|wide[- ]leg[- ]work[- ]pants).*men|men.*(?:jeans|wide[- ]leg[- ]work[- ]pants)/i.test(handle)) {
    return "Men's Loose Straight-Leg Jeans for Winter Workwear";
  }
  if (/screen-auto-clicker|auto-clicker.*(?:screen|phone)|(?:screen|phone).*auto-clicker/i.test(handle)) {
    return "Screen Auto Clicker for Smartphones and Apps";
  }
  if (/(?:cosmetic|makeup|foundation|powder|concealer).*(?:puff|sponge|air-cushion)|(?:puff|sponge|air-cushion).*(?:cosmetic|makeup|foundation|powder|concealer)/i.test(handle)) {
    const count = handle.match(/(?:^|-)(\d+)(?:pcs?|pieces?)(?:-|$)/i)?.[1];
    const large = /large-size|large-puff/i.test(handle) ? "Large " : "";
    return `${count ? `${count}-Piece ` : large}Cotton Makeup Puff for Foundation and Powder`;
  }
  if (/(?:lip-mask|lip-mask-application|lip-brush).*(?:brush|applicator)|(?:brush|applicator).*(?:lip-mask|lip)/i.test(handle)) {
    return "Silicone Lip Mask Brush with Cover";
  }
  if (/(?:lip-liner|lipliner).*(?:set|kit|pen)|(?:set|kit|pen).*(?:lip-liner|lipliner)/i.test(handle)) {
    const count = handle.match(/(?:^|-)(\d+)(?:pcs?|pieces?)(?:-|$)/i)?.[1];
    return `${count ? `${count}-Piece ` : ""}Lip Liner Pen Set for Makeup`;
  }
  if (/\bwatch\b.*(?:jewelry-set|watch-set)|(?:jewelry-set|watch-set).*\bwatch\b/i.test(handle)) {
    const audience = /\b(?:women|womens|woman|female|ladies)\b/i.test(handle)
      ? "Women's "
      : /\b(?:men|mens|man|male)\b/i.test(handle)
        ? "Men's "
        : "";
    const style = /square/i.test(handle) ? "Square LED " : /digital/i.test(handle) ? "Digital " : "";
    return `${audience}${style}Watch and Jewelry Set`.trim();
  }
  if (/(?:pet|dog|cat).*(?:nail-clipper|claw-trimmer)|(?:nail-clipper|claw-trimmer).*(?:pet|dog|cat)/i.test(handle)) {
    return "Pet Nail Clipper Grooming Tool for Dogs and Cats";
  }
  if (/(?:rca|coaxial).*cable|cable.*(?:rca|coaxial)/i.test(handle)) {
    return "HiFi RCA Coaxial Audio Cable for Home Theater";
  }
  if (/f40.*sweater|sweater.*f40|mens-and-womens.*sweater/i.test(handle)) {
    return "F40 Patterned Sweater for Men and Women";
  }
  if (/(?:3[ .-]?5\s*mm|35mm).*?(?:aux|audio).*cable/i.test(semanticHandle)) {
    return /usb[ -]?c.*(?:3[ .-]?5\s*mm|35mm)|(?:3[ .-]?5\s*mm|35mm).*usb[ -]?c/i.test(semanticHandle)
      ? "USB-C to 3.5mm AUX Audio Cable"
      : "3.5mm AUX Audio Cable";
  }
  if (/3-section-double-articulated-arm.*5-8-hex-pin/i.test(handle)) {
    return "3-Section Double Articulated Camera Mounting Arm with 5/8 Hex Pin";
  }
  if (/anti-lost-ear-hooks|anti-lost-ear-hooks-for-wireless-earbuds/i.test(handle)) {
    return "Anti-Lost Ear Hooks for Wireless Earbuds";
  }
  if (/360-rotatable-car-phone-holder|360-rotation.*car-phone-holder/i.test(handle)) {
    return "360-Degree Universal Car Phone Holder";
  }
  if (/original-xiaomi-focus-stylus|xiaomi.*stylus-pen/i.test(handle)) {
    return "Xiaomi Focus 8192-Level Magnetic Stylus Pen";
  }
  if (/comb-hair-brush-cleaner|hair-brush-cleaner/i.test(handle)) {
    return "Hairbrush Cleaning Tool with Plastic Handle";
  }
  if (/fitness-keychain.*(?:gym|sports)|(?:gym|sports).*fitness-keychain/i.test(handle)) {
    return "Fitness Keychain for Gym and Sports";
  }
  if (/case-for-iphone-13-mini.*shockproof-liquid-silicone/i.test(handle)) {
    return "Shockproof Liquid Silicone iPhone Case for iPhone 13 Mini and Multiple Models";
  }
  if (/luxury-shockproof-transparent-case-for-iphone-17/i.test(handle)) {
    return "Shockproof Transparent iPhone 17 Case for Multiple Models";
  }
  if (/case-for-iphone-17.*cute-little-hearts/i.test(handle)) {
    return "Cute Hearts iPhone 17 Case for Multiple Models";
  }
  if (/case-for-iphone-13-pro.*shockproof-clear-silicone/i.test(handle)) {
    return "Clear Silicone iPhone 13 Pro Case for Multiple Models";
  }
  if (/free-shipping-10pcs.*dcdc-power-module/i.test(handle)) {
    return "10-Piece DC-DC Power Module Set, 3.3V-24V";
  }
  if (/earpads.*house-of-marley/i.test(handle)) {
    return "House of Marley Headphone Replacement Earpads";
  }
  if (/dual-hot-shoes-holder|dual-hot-shoe-holder/i.test(handle)) {
    return "Camera Flash L-Bracket with Dual Hot-Shoe Mounts";
  }
  if (/(?:dcdc|dc-dc).*power-module|power-module.*(?:dcdc|dc-dc)/i.test(handle)) {
    return "DC-DC Power Module Set, 3.3V-24V";
  }
  if (/softbox.*(?:bowens|honeycomb)|(?:bowens|honeycomb).*softbox/i.test(handle)) {
    return "Bowens Studio Softbox with Honeycomb Grid";
  }
  if (/dive-case.*insta360.*x3|insta360.*x3.*(?:dive|underwater).*case/i.test(handle)) {
    return "Waterproof Insta360 X3 Dive Case";
  }
  if (/shutter-release.*(?:nikon|yongnuo)|(?:nikon|yongnuo).*shutter-release/i.test(handle)) {
    return "Camera Shutter-Release Cable for Nikon Cameras";
  }
  if (/usb-extension|usb-extender/i.test(handle)) {
    return "USB Extension Cable";
  }
  if (/(?:lipo|li-ion).*battery.*(?:drone|quadcopter|helicopter|fpv|rc)/i.test(handle)) {
    return "Rechargeable LiPo Battery for RC Aircraft";
  }
  if (/(?:controller|gamepad|joystick).*cover|cover.*(?:controller|gamepad|joystick)/i.test(handle)) {
    return "Anti-Slip Game Controller Cover";
  }
  if (/(?:digital|dvb-t|indoor).*antenna|antenna.*(?:digital|dvb-t|indoor)/i.test(handle)) {
    return "Indoor Digital TV Antenna";
  }
  if (/rubber-plugs?.*console|console.*rubber-(?:plugs?|replacement)/i.test(handle)) {
    return "Console Replacement Rubber Plugs";
  }
  if (/(?:micro-switch|microswitch).*switch|switch.*(?:micro-switch|microswitch)/i.test(handle)) {
    return "Replacement Micro-Switch for Game Controller";
  }
  if (/(?:bluetooth|usb).*aux.*adapter|aux.*adapter.*(?:bluetooth|usb)/i.test(handle)) {
    return "USB Bluetooth AUX Audio Adapter";
  }
  if (/sports-arm-bag|arm-pouch|running-mobile-phone-arm-bag/i.test(handle)) {
    return "Waterproof Fitness Arm Bag for Running";
  }
  if (/acotar.*airpod.*case|airpods?.*(?:case|cover)|(?:case|cover).*airpods?/i.test(handle)) {
    return "Black AirPods Protective Case for Multiple Models";
  }
  if (/powerbank|power-bank|external-battery/i.test(handle)) {
    const pack = handle.match(/^(\d+)-in-1/i)?.[1];
    const capacity = handle.match(/(\d{4,6})mah/i)?.[1];
    const wattage = handle.match(/(\d+)w-wireless-power-bank/i)?.[1];
    return `${pack ? `${pack}-in-1 ` : ""}${capacity ? `${Number(capacity).toLocaleString()}mAh ` : ""}Magnetic Wireless Power Bank${wattage ? `, ${wattage}W` : ""}`.trim();
  }
  if (/galaxy-projector.*(?:disc|film)|(?:disc|film).*galaxy-projector/i.test(handle)) {
    return "Galaxy Projector Replacement Film Discs";
  }
  if (/led-strip.*(?:tv|55|65)|(?:tv|55|65).*led-strip/i.test(handle)) {
    return "TV LED Backlight Strip";
  }
  if (/(?:mixer|mixing-console).*\d+[- ]?channel|\d+[- ]?channel.*(?:mixer|mixing-console)/i.test(handle)) {
    const channels = handle.match(/(\d+)[- ]?channel/i)?.[1];
    return `${channels ? `${channels}-Channel ` : ""}Audio Mixer`;
  }
  if (/(?:rca|coaxial).*cable|cable.*(?:rca|coaxial)/i.test(handle)) {
    return "RCA Coaxial Audio Cable";
  }
  if (/desktop-magnetic.*(?:whiteboard|blackboard)|standing-blackboard/i.test(handle)) {
    return "Desktop Magnetic Whiteboard and Standing Display Sign";
  }
  if (/smart-car-key-pcb-board|car-key-pcb-board/i.test(handle)) {
    return "Smart Car Key PCB Replacement Board without Key Shell";
  }
  if (/keydiy.*pcb-key-board|pcb-key-board.*(?:vw|audi|porsche)/i.test(handle)) {
    return "KEYDIY Remote Key PCB Board for VW, Audi and Porsche";
  }
  if (/portable-air-compressor|wireless-air-pump|car-air-pump/i.test(handle)) {
    return "Portable Wireless Tire Inflator for Cars and Bicycles";
  }
  if (/dried-flower-buds.*(?:soap|candle|craft)/i.test(handle)) {
    return "Dried Flower Buds for Soap, Candle and Craft Projects";
  }
  if (/(?:phone|smartphone|mobile-phone).*(?:case|holder|mount|pouch)|(?:case|holder|mount|pouch).*(?:phone|smartphone|mobile-phone)/i.test(primarySemanticHandle) && !/tripod|selfie-stick|gimbal/i.test(primarySemanticHandle)) {
    const features = [
      /fixed|stationary/i.test(primarySemanticHandle) ? "Fixed" : "",
      /universal/i.test(primarySemanticHandle) ? "Universal" : "",
      /waterproof|water-resistant/i.test(primarySemanticHandle) ? "Waterproof" : "",
      /anti-fog|antifog|fog-resistant/i.test(primarySemanticHandle) ? "Anti-Fog" : "",
    ].filter(Boolean);
    const setting = /bathroom|shower/i.test(primarySemanticHandle) ? "Shower" : "";
      const phoneCase = /(?:iphone|ipad|phone|smartphone|mobile-phone).*(?:case|cover)|(?:case|cover).*(?:iphone|ipad|phone|smartphone|mobile-phone)/i.test(primarySemanticHandle);
    if (phoneCase && /iphone|ipad/i.test(primarySemanticHandle)) {
      const caseFeatures = [
        /custom/i.test(primarySemanticHandle) ? "Custom" : "",
        /magnetic|magsafe|macsafe/i.test(primarySemanticHandle) ? "Magnetic" : "",
        /shockproof/i.test(primarySemanticHandle) ? "Shockproof" : "",
        /waterproof|ip68|water-resistant/i.test(primarySemanticHandle) ? "Waterproof" : "",
        /transparent|clear/i.test(primarySemanticHandle) ? "Transparent" : "",
        /denim/i.test(primarySemanticHandle) ? "Denim" : "",
        /leather/i.test(primarySemanticHandle) ? "Leather" : "",
        /silicone|silicon|tpu/i.test(primarySemanticHandle) ? "Silicone" : "",
        /embroidered|illustration|cartoon/i.test(primarySemanticHandle) ? "Illustrated" : "",
        /leopard/i.test(primarySemanticHandle) ? "Leopard Print" : "",
        /hearts?|monkey/i.test(primarySemanticHandle) ? "Printed" : "",
        /floral|flower|wave|star|patchwork/i.test(primarySemanticHandle) ? "Patterned" : "",
      ].filter(Boolean);
      const modelMatch = primarySemanticHandle.match(/\biphone-(\d{1,2}e?|x|xr|xs|se|air)(?:-(?:pro|max|plus|mini))*\b/i);
      const model = modelMatch ? `iPhone ${modelMatch[1].toUpperCase() === "AIR" ? "Air" : modelMatch[1]}` : "iPhone";
      const multipleModels = /\biphone-(?:\d{1,2}e?|x|xr|xs|se|air)(?:-(?:pro|max|plus|mini))*-(?:\d{1,2}e?|x|xr|xs|se|air)\b/i.test(primarySemanticHandle) || /\bcases?-iphone\b/i.test(primarySemanticHandle);
      const brand = /\bugreen\b/i.test(primarySemanticHandle) ? "Ugreen " : "";
      return `${brand}${caseFeatures.slice(0, 3).join(" ")}${caseFeatures.length ? " " : ""}${model} Case${multipleModels ? " for Multiple Models" : ""}`.trim();
    }
    if (phoneCase) {
      const features = [
        /fixed|stationary/i.test(primarySemanticHandle) ? "Fixed" : "",
        /universal/i.test(primarySemanticHandle) ? "Universal" : "",
        /waterproof|ip68|water-resistant/i.test(primarySemanticHandle) ? "Waterproof" : "",
        /anti-fog|antifog|fog-resistant/i.test(primarySemanticHandle) ? "Anti-Fog" : "",
      ].filter(Boolean);
      const setting = /bathroom|shower/i.test(primarySemanticHandle) ? " for Shower" : "";
      return `${features.join(" ")}${features.length ? " " : ""}Mobile Phone Case${setting}`.trim();
    }
    const productNoun = /case.*holder|holder.*case/i.test(primarySemanticHandle)
      ? "Phone Holder Case"
      : /holder|mount/i.test(primarySemanticHandle)
        ? "Phone Holder"
        : "Phone Case";
    return [...features, setting, productNoun].filter(Boolean).join(" ");
  }
  if (/silicone-case-for-xiaomi-redmi-pad-2|redmi-pad-2.*(?:case|cover)/i.test(handle)) {
    return "Xiaomi Redmi Pad 2 Silicone Case with Trifold Stand";
  }
  if (/tripod.*(?:phone|smartphone|camera)|(?:phone|smartphone|camera).*tripod|camera-stand|selfie-stick|gimbal/i.test(semanticHandle) || /(?:^|-)tripod(?:-|$)/i.test(semanticHandle)) {
    const height = semanticHandle.match(/(?:^|-)(\d{3,4})mm(?:-|$)/i)?.[1];
    const format = /selfie-stick/i.test(semanticHandle)
      ? "Selfie Stick"
      : /gimbal/i.test(semanticHandle)
        ? "Phone and Camera Gimbal"
        : "Smartphone and Camera Tripod Stand";
    return `${height ? `${height}mm ` : ""}${format}`;
  }
  if (/baby-toys?.*(?:drum|piano)|(?:drum|piano).*(?:toddler|baby-toys?)/i.test(handle)) {
    return "Musical Drum and Piano Toy with Lights and Sound for Toddlers";
  }
  if (/keyboard.*(?:fidget-toy|key-toy)|(?:fidget|stress-relief).*keyboard/i.test(handle)) {
    return `${/led-light/i.test(handle) ? "LED " : ""}Keyboard Keychain Fidget Toy for Desk Use`;
  }
  if (/keyboard-toys?.*(?:stress-relief|clicker)|(?:stress-relief|clicker).*keyboard-toys?/i.test(handle)) {
    return "Keyboard Keychain Fidget Clicker Toy for Desk Use";
  }
  if (/(?:piano|keyboard).*(?:stickers?|note-labels?)|(?:stickers?|note-labels?).*(?:piano|keyboard)/i.test(handle)) {
    const keyCount = handle.match(/(?:^|-)(\d+)(?:-)?keys?(?:-|$)/i)?.[1];
    return `${keyCount ? `${keyCount}-Key ` : ""}Removable Piano Keyboard Stickers for Beginners`;
  }
  if (/keyboard-stabilizers?-pad|plate-mounted-stabilizer/i.test(handle)) {
    return /poron/i.test(handle)
      ? "Poron Stabilizer Pads for Plate-Mounted Mechanical Keyboards"
      : "Plate-Mounted Stabilizer for Mechanical Keyboards";
  }
  if (/keycaps?-storage-box|keycap-organizer/i.test(handle)) {
    return "Clear Keycap Storage Box and Organizer";
  }
  if (/keyboard.*display-stand|keyboards-display-stand/i.test(handle)) {
    return "Layered Display Stand for Mechanical Keyboards";
  }
  if (/keyboard-storage-stand/i.test(handle)) {
    return `${/walnut/i.test(handle) ? "Walnut " : ""}Keyboard Storage Stand for Desktop Use`;
  }
  if (/keyboard-stand|keyboards-platform/i.test(handle)) {
    const material = /acrylic/i.test(handle) ? "Acrylic " : "";
    const shape = /z-shaped/i.test(handle) ? "Z-Shaped " : "";
    return `${/transparent/i.test(handle) ? "Transparent " : ""}${material}${shape}Keyboard Stand for Desktop Use`;
  }
  if (/keyboard-wrist-rest/i.test(handle)) {
    return `${/wood|walnut/i.test(handle) ? "Wooden " : ""}Keyboard Wrist Rest for 60, 87 and 104-Key Layouts`;
  }
  if (/keycaps?.*mechanical-keyboard/i.test(handle)) {
    const count = handle.match(/(?:^|-)(\d+)(?:-)?keys?(?:-|$)/i)?.[1];
    return `${count ? `${count}-Key ` : ""}${/pbt/i.test(handle) ? "PBT " : ""}Keycap Set for Mechanical Keyboards`;
  }
  if (/pcb-board-for-mechanical-keyboard/i.test(handle)) {
    const count = handle.match(/(?:^|-)(\d+)(?:-)?keys?(?:-|$)/i)?.[1];
    return `${/wooting-60he/i.test(handle) ? "Wooting 60HE " : ""}${count ? `${count}-Key ` : ""}Hot-Swap Mechanical Keyboard PCB Board`;
  }
  if (/sound-dampening-positioning-board/i.test(handle)) {
    return "Sound-Dampening Plate for 60HE Mechanical Keyboards";
  }
  if (/key-power-board-keyboard-for-partybox/i.test(handle)) {
    return "Replacement Key Power Board for JBL PartyBox 100";
  }
  if (/universal-side-key-board/i.test(handle)) {
    return "Hot-Swappable Side Key Board for OP18K, OP1W4K and OP1WE";
  }
  if (/8200-0600-12key-keyboard-set/i.test(handle)) {
    return "12-Key Keyboard and Keysheet Replacement Set";
  }
  if (/multifunctional-keyboard.*programmable.*keypad/i.test(handle)) {
    return "Programmable Mini Mechanical Gaming Keypad";
  }
  if (/blackberry-q20-wired-mini-keyboard/i.test(handle)) {
    return "BlackBerry Q20 Wired Mini Keyboard Board with USB Support";
  }
  if (/korean-2-4g-wireless-keyboard-and-mouse/i.test(handle)) {
    return "Korean 2.4GHz Wireless Keyboard and Mouse Combo";
  }
  if (/akko-tac75-he/i.test(handle)) {
    return "Akko TAC75 HE RGB Magnetic Switch Gaming Keyboard";
  }
  if (/y1ub-ergonomic-cord-keyboards/i.test(handle)) {
    return "Y1UB 97-Key Wired RGB Keyboard with Volume Knob";
  }
  if (/k82-mechanical-wired-keyboard/i.test(handle)) {
    return "K82 Wired Hot-Swap Mechanical Keyboard with Media Knob";
  }
  if (/one-key-shortcut-keyboard/i.test(handle)) {
    return "Single-Key USB Programmable Mechanical Macro Keypad";
  }
  if (/(?:car|motorcycle|lead-acid|lifepo4|trickle).*(?:battery-charger)|battery-charger.*(?:car|motorcycle|lead-acid|lifepo4|trickle)/i.test(handle)) {
    const voltage = [...handle.matchAll(/(?:^|-)(\d+)v(?:-|$)/gi)].map((match) => `${match[1]}V`).slice(0, 2).join("/");
    const amperage = handle.match(/(?:^|-)(\d+(?:\.\d+)?)a(?:-|$)/i)?.[1];
    return `${voltage ? `${voltage} ` : ""}${amperage ? `${amperage}A ` : ""}Smart Battery Charger for Cars and Motorcycles`;
  }
  if (/(?:aa|aaa).*(?:battery-charger)|battery-charger.*(?:aa|aaa)/i.test(handle)) {
    return "AA and AAA Rechargeable Lithium Battery Charger";
  }
  if (/(?:^|-)18650(?:-|$).*(?:battery-charger)|battery-charger.*(?:^|-)18650(?:-|$)/i.test(handle)) {
    return `18650 Rechargeable Battery Charger${/auto-stop/i.test(handle) ? " with Auto Stop" : ""}`;
  }
  if (/derailleur-charger|bicycle-shift-charger/i.test(handle)) {
    return "SRAM eTap AXS Bicycle Derailleur Battery Charger";
  }
  if (/dji-action3|dji-action-?3/i.test(handle)) {
    return "DJI Action 3 and Action 4 Battery Charger";
  }
  if (/charger-replacement-for-psp|psp.*battery-charger/i.test(handle)) {
    return "Replacement Battery Charger for PSP 1000, 2000 and 3000";
  }
  const musicalKeys = handle.match(/(?:^|-)(\d+)(?:-)?keys?(?:-|$)/i);
  if (musicalKeys && /(?:digital|electronic|electric|musical).*(?:piano|keyboard)|(?:piano|keyboard).*(?:musical|instrument)/i.test(handle)) {
    const audience = /(?:^|-)(?:kid|kids|child|children)(?:-|$)/i.test(handle) ? " for Kids" : "";
    const microphone = /(?:^|-)microphone(?:-|$)/i.test(handle) ? " with Microphone" : "";
    return `${musicalKeys[1]}-Key Digital Keyboard and Electronic Piano${audience}${microphone}`;
  }
  if (/smokebuddy.*personal-air-filter/i.test(handle)) {
    return "SmokeBuddy Jr Portable Personal Air Filter";
  }
  if (/portable.*usb-air-cooler-fan|usb-air-cooler-fan/i.test(handle)) {
    return "Portable Bladeless USB Air Cooler Fan";
  }
  if (/air-dehumidifier/i.test(handle)) {
    return "Portable Air Dehumidifier for Home and Office";
  }
  if (/bluetooth-smart-aroma-diffuser/i.test(handle)) {
    return "Bluetooth Smart Aroma Diffuser for Home and Hotels";
  }
  if (/car-air-freshener.*(?:vent-clip|rotating-fan)/i.test(handle)) {
    return "Rotating Car Vent Air Freshener Diffuser";
  }
  if (/\d+pcs-\d+ml.*essential-oil/i.test(handle)) {
    const count = handle.match(/(?:^|-)(\d+)pcs(?:-|$)/i)?.[1];
    const size = handle.match(/(?:^|-)(\d+)ml(?:-|$)/i)?.[1];
    return `${count ? `${count}-Piece ` : ""}${size ? `${size}ML ` : ""}Fragrance Essential Oil Set for Diffusers`;
  }
  if (/carbon-dioxide-air-diffuser.*plant-growth/i.test(handle)) {
    return "Compact CO2 Air Diffuser for Planted Systems";
  }
  if (/charger-battery-eliminator-for-baofeng/i.test(handle)) {
    return "Battery Eliminator Charger Adapter for Baofeng UV-82 and UV-89";
  }
  if (/car-charger.*retractable-cable/i.test(handle)) {
    return `${/5-in-1/i.test(handle) ? "5-in-1 " : ""}Retractable Fast Car Charger with USB-C Cables`;
  }
  if (/car-charger-150w/i.test(handle)) {
    return "150W Fast Car Charger";
  }
  if (/car-charger-for-phones-120w/i.test(handle)) {
    return "120W Car Charger and Socket Splitter for Phones";
  }
  if (/car-charger-adapter.*changan/i.test(handle)) {
    return "USB-C Car Charger Adapter for Changan Models";
  }
  if (/chery-icar-v23.*car-charger/i.test(handle)) {
    return "USB-C Charging Dock for Chery iCar V23";
  }
  if (/12v-24v-to-220v.*inverter/i.test(handle)) {
    return "12V and 24V to 220V Car Power Inverter with Charging Ports";
  }
  if (/charger-shavers.*electric-hair-clippers/i.test(handle)) {
    return "USB Charging Cable for Electric Shavers and Hair Clippers";
  }
  if (/charger-port-3-pin.*(?:scooter|e-bike)/i.test(handle)) {
    return "3-Pin Charger Port for Electric Scooters and E-Bikes";
  }
  if (/charger-42-v-2a-85w-5-pin.*36v-batteries/i.test(handle)) {
    return "42V 2A 5-Pin Charger for 36V E-Bike Batteries";
  }
  if (/charger-for-fossil-gen/i.test(handle)) {
    return "Charging Cable for Fossil Gen 4, 5, 5E and 6 Smartwatches";
  }
  if (/charger-compatible-with-huawei-watch/i.test(handle)) {
    return "Charging Dock for Huawei Watch GT, GT2 and Honor Models";
  }
  if (/haneride-4a-charger-for-bosch/i.test(handle)) {
    return "4A Charger for Bosch 36V E-Bike Batteries";
  }
  if (/vehicle-charger-for-milwaukee/i.test(handle)) {
    return "Vehicle Charger for Milwaukee 12V and 18V Batteries";
  }
  if (/lir2032.*(?:coin-charger|button-battery|batteries)/i.test(handle)) {
    return "USB-C Charger for LIR Rechargeable Coin Batteries";
  }
  if (/(?:case|cover).*(?:iphone)|iphone.*(?:case|cover)/i.test(handle)) {
    const model = handle.match(/iphone-(\d+)(?:-(pro|max|plus|mini))?/i);
    return `${/flower-bud/i.test(handle) ? "Flower Design " : ""}Protective iPhone Case${model ? ` for iPhone ${model[1]}${model[2] ? ` ${titleCase(model[2])}` : ""}` : " for Multiple Models"}`;
  }
  if (/\d+-large-transparent-pp-storage-boxes/i.test(handle)) {
    const count = handle.match(/(?:^|-)(\d+)-large/i)?.[1];
    return `${count ? `${count}-Piece ` : ""}Transparent Storage Box Set with Lids`;
  }
  if (/pencil-organise-cases|pencil-shaped-storage-box/i.test(handle)) {
    return /pencil-shaped/i.test(handle)
      ? "Pencil-Shaped Desktop Pen and Brush Holder with Cover"
      : "Transparent Pencil and Pen Organizer for School and Office";
  }
  const keyboardKeyCount = handle.match(/(?:^|-)(\d+)(?:-)?keys?(?:-|$)/i)?.[1];
  if (keyboardKeyCount && /(?:keyboard|keybaord|keypad|macro-pad|membrane-switch)/i.test(handle)) {
    const matrix = handle.match(/(?:^|-)(\d+x\d+)(?:-|$)/i)?.[1];
    if (/membrane-switch|matrix-array/i.test(handle)) {
      return `${keyboardKeyCount}-Key ${matrix ? `${matrix} ` : ""}Membrane Switch Keypad`;
    }
    if (/macro-pad|programmable|shortcut-keyboard|mini-keyboard-direction/i.test(handle)) {
      const knob = /(?:^|-)knob(?:-|$)/i.test(handle) ? " with Control Knob" : "";
      return `${keyboardKeyCount}-Key Programmable ${/mechanical/i.test(handle) ? "Mechanical " : ""}Macro Keypad${knob}`;
    }
    const model = /akko-tac75-he/i.test(handle)
      ? "Akko TAC75 HE "
      : /k500-b61-machenike/i.test(handle)
        ? "Machenike K500-B61 "
        : /kiiboom-phantom-98/i.test(handle)
          ? "KiiBOOM Phantom 98 "
          : /(?:^|-)k82(?:-|$)/i.test(handle)
            ? "K82 "
            : "";
    const connection = /three-mode|wired-bluetooth-2-4g|wired-bt5/i.test(handle)
      ? "Three-Mode "
      : /wireless/i.test(handle)
        ? "Wireless "
        : /wired/i.test(handle)
          ? "Wired "
          : "";
    const lighting = /rgb|backlit|backlight/i.test(handle) ? "RGB " : "";
    const format = /mechanical/i.test(handle) ? "Mechanical " : "";
    const use = /gaming|gamer|esports/i.test(handle) ? "Gaming " : "";
    return `${model}${keyboardKeyCount}-Key ${connection}${lighting}${format}${use}Keyboard`;
  }
  if (/earbuds?-cleaning|cleaning-(?:pen|tool).*(?:earbuds?|airpods)|cleaner-kit.*(?:earbuds?|airpods)/i.test(handle)) {
    return /3-in-1/i.test(handle) ? "3-in-1 Earbud Cleaning Pen and Brush" : "Earbud Cleaning Pen and Brush Kit";
  }

  if (/(?:case|cover|sleeve).*(?:buds|earbuds?|earphones?)|(?:buds|earbuds?|earphones?).*(?:protective-case|case-cover|protective-cover)/i.test(handle)) {
    const deviceMatch = handle.match(/(?:realme-buds-air-?\d+(?:-pro)?|galaxy-buds-?\d*(?:-pro)?|oneplus-buds(?:-pro)?-?\d*|xiaomi-buds-?\d*(?:-pro)?|redmi-buds-?\d*(?:-pro)?|airpods-pro-?\d*)/i);
    const device = deviceMatch ? titleCase(deviceMatch[0].replace(/-/g, " ")) : "Wireless Earbuds";
    const material = /silicone/i.test(handle) ? "Silicone " : "";
    return `${material}Protective Case for ${device}`;
  }

  if (/(?:ear-tips|eartips|replacement-ear-tips|silicone-tips|ear-caps-tips).*(?:buds|airpods)|(?:buds|airpods).*(?:ear-tips|eartips|silicone-tips|ear-caps-tips)/i.test(handle)) {
    const pack = handle.match(/(?:^|-)(\d+)(?:-|)?(?:pairs?|pcs)(?:-|$)/i);
    return `${pack ? `${pack[1]}-Pair ` : ""}Replacement Ear Tips for Wireless Earbuds`;
  }

  if (/(?:ear-hooks?|anti-lost-ear-hook).*(?:buds|airpods)|(?:buds|airpods).*(?:ear-hooks?|anti-lost-hook)/i.test(handle)) {
    return "Anti-Lost Ear Hooks for Wireless Earbuds";
  }

  if (/sleep-headband-eye-mask|bluetooth.*headband.*eye-mask/i.test(handle)) {
    return "Bluetooth Sleep Headband and Eye Mask with Earphones";
  }

  if (/(?:pencil-case|pencil-box|pen-box|stationery-box)/i.test(handle)) {
    const material = /(?:^|-)wooden(?:-|$)/i.test(handle)
      ? "Wooden "
      : /(?:^|-)metal(?:-|$)/i.test(handle)
        ? "Metal "
        : /(?:^|-)plastic(?:-|$)/i.test(handle)
          ? "Plastic "
          : "";
    const format = /pencil-case/i.test(handle) ? "Pencil Case" : "Pencil Box";
    const use = /school/i.test(handle) && /office/i.test(handle)
      ? " for School and Office"
      : /school/i.test(handle)
        ? " for School Supplies"
        : " for Desk Organization";
    return `${material}${/transparent|clear/i.test(handle) ? "Transparent " : ""}${/large-capacity/i.test(handle) ? "Large Capacity " : ""}${format}${use}`;
  }

  if (/(?:wireless|bluetooth|tws).*(?:earbuds?|earphones?|headphones?|headset)|(?:earbuds?|earphones?|headphones?).*(?:wireless|bluetooth|tws)/i.test(handle)) {
    const audioWords = handle.split("-");
    const audioStop = audioWords.findIndex((word) => /^(?:wireless|bluetooth|tws|earbuds?|earphones?|headphones?|headsets?)$/i.test(word));
    const airPodsModel = /airpods-?4(?:generation)?|airpods-4-generation/i.test(handle) ? "AirPods 4 " : "";
    const modelWords = audioWords
      .slice(0, audioStop > 0 ? Math.min(audioStop, 4) : 0)
      .filter((word) => !/^(?:20\d{2}|new|original|global|version|high|quality|for|the|open|ear)$/i.test(word));
    const modelPrefix = airPodsModel || (modelWords.length && (modelWords.some((word) => /\d/.test(word)) || /^(?:nothing|realme|oneplus|xiaomi|redmi|baseus|tribit|blackview|qcy|ugreen|soundpeats|haylou|ulefone|moondrop|bosecxt|uyuxio|air|airs|buds|e6s|b52)$/i.test(modelWords[0]))
      ? `${titleCase(modelWords.join(" "))} `
      : "");
    const format = /open-ear|ear-clip|clip-on/i.test(handle)
      ? "Open-Ear Wireless Earbuds"
      : /sleep|sleeping|invisible/i.test(handle)
        ? "Mini Wireless Sleep Earbuds"
        : "Wireless Bluetooth Earbuds";
    const feature = /built-in-mic|with-mic|microphone|clear-call|hd-call/i.test(handle)
      ? " with Microphone"
      : /noise-cancell|noise-reduction|anc/i.test(handle)
        ? " with ANC"
        : "";
    return `${modelPrefix}${format}${feature}`;
  }

  if (/(?:humidifier|aroma-diffuser|essential-oil-diffuser|fragrance-diffuser)/i.test(handle)) {
    const capacity = handle.match(/(?:^|-)(\d+(?:\.\d+)?)(ml|l)(?:-|$)/i);
    const identity = /humidifier/i.test(handle) && /diffuser/i.test(handle)
      ? "Air Humidifier and Aroma Diffuser"
      : /humidifier/i.test(handle)
        ? "Air Humidifier"
        : "Aroma Diffuser";
    const power = /(?:^|-)usb(?:-|$)/i.test(handle)
      ? "USB "
      : /(?:^|-)battery(?:-|$)/i.test(handle)
        ? "Battery-Powered "
        : "";
    const control = /(?:smart-app|app-control|bluetooth-control)/i.test(handle) ? "Smart App-Controlled " : "";
    const format = /waterless/i.test(handle) ? "Waterless Essential Oil Diffuser" : identity;
    const lighting = /(?:led|night-light|colorful-lights)/i.test(handle) ? " with LED Light" : "";
    return `${capacity ? `${capacity[1]}${capacity[2].toUpperCase()} ` : ""}${power}${control}${format}${lighting}`.trim();
  }

  const cookwareCount = normalizeHandleValue(signals.handle).match(/^(\d+)-(?:piece|pc|pcs)-pots?-and-pans?-set(?:-|$)/i);
  if (cookwareCount) {
    return `${cookwareCount[1]}-Piece Pots and Pans Set`;
  }

  const exactHandleFamily = /^(Eyelash Curler|False Eyelashes|Makeup Mirror|Lip Gloss|Lip Balm|Mascara|Hair Clip|Hair Oil|Phone Case|iPhone Case|Screen Protector|Computer Mouse|Mouse Jiggler|Mouse Remote|Raincoat|Dog Nail File|Measuring Cup|Camping Cookware Set|Facial Mist Sprayer|Sports Outfit|Pants|Perfume)$/i.test(
    normalizePlainText(signals.handlePhrase),
  );
  if (!signals.handlePhrase || (!exactHandleFamily && !hasHandleTitleConflict(signals))) {
    return "";
  }
  if (exactHandleFamily) {
    const familyTokens = buildTokenSet(signals.handlePhrase);
    const informativeSource = [signals.sourceTitle, signals.catalogTitle]
      .map((candidate) => normalizePlainText(candidate))
      .find((candidate) => {
        const candidateTokens = buildTokenSet(candidate);
        return candidate && [...familyTokens].some((token) => candidateTokens.has(token)) && !GENERIC_TITLE_PHRASES.some((pattern) => pattern.test(normalizeComparableText(candidate)));
      });
    if (informativeSource) {
      return informativeSource;
    }
    const handleWords = normalizePlainText(signals.handle || "")
      .toLowerCase()
      .split(/[-_\s]+/)
      .filter((word) => word && !GENERIC_TITLE_WORDS.has(word) && !/^\d+$/.test(word));
    const familyWords = normalizePlainText(signals.handlePhrase).toLowerCase().split(/\s+/);
    const familyStart = handleWords.findIndex((word, index) => familyWords.every((familyWord, offset) => handleWords[index + offset] === familyWord));
    if (familyStart > 0) {
      const modifiers = handleWords.slice(Math.max(0, familyStart - 3), familyStart).slice(-2);
      if (modifiers.length) {
        return titleCase(`${modifiers.join(" ")} ${signals.handlePhrase}`);
      }
    }
  }

  const productType = firstNonEmpty(signals.sourceProductType, signals.catalogProductType);
  const formattedType = productType ? titleCase(productType.toLowerCase()) : "";
  const typeTokens = buildTokenSet(productType);
  const handleTokens = buildTokenSet(signals.handlePhrase);
  const typeAgreesWithHandle =
    [...typeTokens].some((token) => handleTokens.has(token)) ||
    (typeTokens.has("cookware") && ["pot", "pots", "pan", "pans", "kitchen"].some((token) => handleTokens.has(token)));
  return typeAgreesWithHandle
    ? appendProductTypeCandidate(signals.handlePhrase, formattedType) || signals.handlePhrase
    : signals.handlePhrase;
}

function buildSafeHandleTitle(signals) {
  const words = normalizePlainText(signals.handle || "")
    .toLowerCase()
    .split(/[-_\s]+/)
    .filter((word) => word && !GENERIC_TITLE_WORDS.has(word) && !/^\d+$/.test(word));
  if (!words.length) {
    return "";
  }

  const familyIndex = words.findIndex((word) => FAMILY_PRIORITY_WORDS.has(word));
  const selected = familyIndex >= 0
    ? words.slice(Math.max(0, familyIndex - 3), Math.min(words.length, familyIndex + 5))
    : words.slice(0, 6);
  const phrase = uniqueValues(selected).slice(0, 6).join(" ");
  return shortenAtWordBoundary(titleCase(phrase), 68);
}

function titleHandleOverlap(title, signals) {
  const handleTokens = new Set(
    [...signals.handleTokens].filter(
      (token) => token.length >= 3 && !GENERIC_TITLE_WORDS.has(token) && !/^\d+$/.test(token),
    ),
  );
  return countOverlap(handleTokens, buildTokenSet(title));
}

function buildCanonicalSeoTitle(canonicalTitle, signals) {
  const title = normalizePlainText(canonicalTitle);
  if (!title) {
    return "";
  }
  let shortened = shortenAtWordBoundary(title, MARKETPLACE_CONTENT_POLICY.seo.titleLength[1])
    .replace(/\b(?:and|for|with|of|to)$/i, "")
    .trim();
  if (shortened.length >= MARKETPLACE_CONTENT_POLICY.seo.titleLength[0]) {
    return shortened;
  }

  const titleTokens = buildTokenSet(shortened);
  const facts = extractSupportedProductFacts(signals);
  const evidenceValues = [
    ...facts.filter((fact) => fact.label !== "Product focus").map((fact) => fact.value),
    normalizePlainText(signals.productTypeText),
    ...facts.filter((fact) => fact.label === "Product focus").map((fact) => fact.value),
  ];
  const evidenceWords = [];
  for (const value of evidenceValues) {
    for (const word of normalizePlainText(value).split(/[,/|\s]+/)) {
      const normalizedWord = normalizeComparableText(word);
      if (
        !normalizedWord ||
        GENERIC_TITLE_WORDS.has(normalizedWord) ||
        titleTokens.has(normalizedWord) ||
        evidenceWords.some((entry) => normalizeComparableText(entry) === normalizedWord)
      ) {
        continue;
      }
      const candidate = `${shortened} | ${titleCase([...evidenceWords, word].join(" "))}`;
      if (candidate.length > MARKETPLACE_CONTENT_POLICY.seo.titleLength[1]) {
        continue;
      }
      evidenceWords.push(word);
      if (candidate.length >= MARKETPLACE_CONTENT_POLICY.seo.titleLength[0]) {
        return candidate;
      }
    }
  }

  if (evidenceWords.length) {
    shortened = `${shortened} | ${titleCase(evidenceWords.join(" "))}`;
  }
  return shortened;
}

function selectBestTitleCandidate(candidates, signals, sourceTitle) {
  let bestCandidate = "";
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    const normalizedCandidate = normalizePlainText(candidate);
    if (!normalizedCandidate) {
      continue;
    }

    const tokens = tokenizeText(normalizedCandidate);
    let score = 0;
    for (const token of tokens) {
      score += scoreToken(token, signals);
    }

    if (tokens.length <= 2) {
      score += 3;
    } else if (tokens.length <= 4) {
      score += 6;
    } else if (tokens.length <= 6) {
      score += 2;
    } else {
      score -= (tokens.length - 6) * 2;
    }

    if (normalizedCandidate.length <= 54) {
      score += 7;
    } else if (normalizedCandidate.length <= 70) {
      score += 3;
    } else {
      score -= 12;
    }

    if (signals.handlePhrase && normalizedCandidate.includes(normalizeComparableText(signals.handlePhrase))) {
      score += 5;
    }

    if (normalizeComparableText(candidate) === normalizeComparableText(sourceTitle)) {
      score += 4;
    }

    if (GENERIC_TITLE_PHRASES.some((pattern) => pattern.test(normalizedCandidate))) {
      score -= 12;
    }

    const uniqueTokenCount = new Set(tokens).size;
    score -= Math.max(0, tokens.length - uniqueTokenCount) * 6;
    if (tokens.length > 10) {
      score -= (tokens.length - 10) * 3;
    }
    if (/\b(?:high quality|best selling|best seller|wholesale|dropshipping|free shipping|factory direct)\b/i.test(normalizedCandidate)) {
      score -= 10;
    }
    if (/^for\b/i.test(normalizedCandidate)) {
      score -= 4;
    }

    if (score > bestScore || (score === bestScore && normalizedCandidate.length < bestCandidate.length)) {
      bestScore = score;
      bestCandidate = normalizedCandidate;
    }
  }

  return {
    candidate: bestCandidate ? titleCase(bestCandidate) : "",
    score: bestScore,
  };
}

function appendProductTypeCandidate(title, productType) {
  const normalizedTitle = normalizeComparableText(title);
  const normalizedType = normalizeComparableText(productType);
  if (!normalizedTitle || !normalizedType || normalizedTitle.includes(normalizedType)) {
    return "";
  }

  return `${title} - ${productType}`;
}

function hasHandleTitleConflict(signals) {
  const meaningfulHandleTokens = new Set(
    [...signals.handleTokens].filter(
      (token) => token.length >= 3 && !GENERIC_TITLE_WORDS.has(token) && !/^\d+$/.test(token),
    ),
  );
  if (!meaningfulHandleTokens.size) {
    return false;
  }

  const combinedTitleTokens = new Set([...signals.sourceTitleTokens, ...signals.catalogTitleTokens]);
  const semanticFamilies = [
    { handle: ["pot", "pots", "pan", "pans", "kitchen"], title: ["cookware"] },
    { handle: ["trouser", "trousers"], title: ["pants"] },
    { handle: ["pants"], title: ["trouser", "trousers"] },
    { handle: ["case", "cover"], title: ["case", "cover"] },
    { handle: ["bag"], title: ["purse", "handbag", "tote"] },
    { handle: ["lipstick", "lipgloss", "gloss"], title: ["lipstick", "lip", "gloss"] },
  ];
  if (semanticFamilies.some((family) =>
    family.handle.some((token) => meaningfulHandleTokens.has(token)) &&
    family.title.some((token) => combinedTitleTokens.has(token)))) {
    return false;
  }

  const titleSources = [signals.sourceTitleTokens, signals.catalogTitleTokens].filter((tokens) => tokens?.size);
  if (!titleSources.length) {
    return false;
  }

  const overlapCounts = titleSources.map((tokens) => countOverlap(meaningfulHandleTokens, tokens));
  return (
    overlapCounts.every((count) => count === 0) ||
    (meaningfulHandleTokens.size >= 5 && Math.max(...overlapCounts) <= 1)
  );
}

function buildSearchPhrases(signals) {
  const titleConflict = hasHandleTitleConflict(signals);
  const handleSearchTokens = titleConflict
    ? [...signals.handleTokens].filter((token) => !GENERIC_TITLE_WORDS.has(token))
    : [...signals.handleTokens];
  const boostSources = titleConflict
    ? []
    : (signals.catalogSearchBoosts || []).map((value) => tokenizeText(value)).filter((tokens) => tokens.length);
  const sources = [
    handleSearchTokens,
    ...(titleConflict ? [] : [[...signals.sourceTitleTokens], [...signals.catalogTitleTokens]]),
    [...signals.productTypeTokens],
    [...signals.tagTokens],
    [...signals.collectionTokens],
    ...(titleConflict || !signals.productKnowledge?.searchTerms?.length ? [] : [signals.productKnowledge.searchTerms]),
    ...boostSources,
  ];

  const phrases = [];
  for (const tokens of sources) {
    phrases.push(...buildPhraseCandidates(tokens, { maxLength: 3 }));
  }

  return uniqueValues(
    phrases
      .map((phrase) => sanitizeMarketplaceClaims(normalizePlainText(phrase)).toLowerCase())
      .filter((phrase) => phrase && phrase.length >= 3)
      .filter((phrase) => !containsUnsafeMarketplaceClaim(phrase))
      .filter((phrase) => !GENERIC_TITLE_PHRASES.some((pattern) => pattern.test(phrase)))
      .sort((left, right) => scorePhraseCandidate(right, signals) - scorePhraseCandidate(left, signals))
      .slice(0, 5),
  );
}

function firstFactValue(facts, labels) {
  const wanted = new Set(labels);
  return (facts || []).find((fact) => wanted.has(fact.label))?.value || "";
}

function humanizeFactList(value) {
  const items = uniqueValues(normalizePlainText(value).split(/\s*,\s*/).map((item) => item.trim()).filter(Boolean));
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function polishListingValue(value) {
  return normalizePlainText(value)
    .replace(/\biphone\b/gi, "iPhone")
    .replace(/\biPhone\s*(\d{1,2})\b/gi, "iPhone $1")
    .replace(/\biPhone\s*air\b/gi, "iPhone Air")
    .replace(/\bairpods?\s*(pro|3|2)\b/gi, (_, model) => `AirPods ${model[0].toUpperCase()}${model.slice(1)}`)
    .replace(/\bipad\b/gi, "iPad")
    .replace(/\bairpods\b/gi, "AirPods")
    .replace(/\baux\b/gi, "AUX")
    .replace(/\busb\b/gi, "USB");
}

function humanProductType(signals, titleText, knowledge) {
  const strictType = strictProductTypeForSignals(signals);
  if (strictType) return strictType;
  const evidence = normalizeComparableText(
    [signals.handle, titleText, signals.sourceProductType, signals.catalogProductType].filter(Boolean).join(" "),
  );
  const primaryEvidence = normalizeComparableText(
    signals.handle || signals.sourceTitle || signals.catalogTitle || "",
  ) || evidence;
  const exactTypes = [
    [/\bbiodance\b.*\b(?:gel toner pads?|toner pads?|ampoule serum)\b/i, "Biodance gel toner pads"],
    [/\b(?:facial essence|salmon ampoule|ampoule serum)\b.*\b(?:serum|essence|ampoule)\b/i, "salmon ampoule facial serum"],
    [/\b(?:ipad|ipad air|ipad pro)\b.*\b(?:case|cover|flip|trifold|stand)\b|\b(?:case|cover|flip|trifold|stand)\b.*\b(?:ipad|ipad air|ipad pro)\b/i, "iPad protective case"],
    [/\b(?:watch case|watch cover|protective cover)\b.*\b(?:huawei|honor|choice|rossini|2i|hard pc|full coverage)\b|\b(?:huawei|honor|choice|rossini|2i|hard pc|full coverage)\b.*\b(?:watch case|watch cover|protective cover)\b/i, "watch protective case"],
    [/\b(?:skin tint|tinted serum|foundation balm|contour stick)\b.*\bstick\b/i, "skin tint and contour stick"],
    [/\b(?:diamond|pearlescent)\b.*\blipsticks?\b/i, "pearlescent lipstick"],
    [/\b(?:heating suit|heated trouser|heated vest|heated jacket|heated gloves?)\b.*\b(?:5v|5000mah|powerbank|external powerbank|battery)\b/i, "heated clothing battery pack"],
    [/\b(?:airpods?|air pods)\b.*\b(?:ear tips?|eartips?|ear caps?|silicone)\b/i, "AirPods Pro replacement ear tips"],
    [/\bjbl\b.*\b(?:earpads?|ear pads?|earmuffs?)\b/i, "JBL Tune replacement earpads"],
    [/(?:makeup|cosmetic)[ -]?brush[ -]?cleaner|brush[ -]?cleaner.*(?:makeup|cosmetic)/i, "makeup brush cleaner"],
    [/(?:precision.*tweezers?|tweezers?.*eyebrow)/i, "beauty tweezers"],
    [/(?:foundation|concealer).*?(?:brush|blender)|(?:brush|blender).*?(?:foundation|concealer)/i, "foundation makeup brush"],
    [/(?:eyebrow|brow).*?(?:gel|cream)|(?:gel|cream).*?(?:eyebrow|brow)/i, "eyebrow setting gel"],
    [/(?:false eyelash|false lash|eyelash extension|lash extension)/i, "false eyelash extensions"],
    [/(?:facial mask|face mask|sheet mask)/i, "facial sheet mask"],
    [/(?:hairline.*powder|hair.*concealer.*powder)/i, "hairline concealer powder"],
    [/(?:cc cream|color changing cream)/i, "CC cream foundation"],
    [/\bliquid foundation\b/i, "liquid foundation"],
    [/\b(?:matte lipstick|lipstick)\b/i, "lipstick"],
    [/\b(?:lip gloss|lipgloss)\b/i, "lip gloss"],
    [/\bsetting powder\b/i, "setting powder"],
    [/\bhair mask\b/i, "hair mask"],
    [/\bhair conditioner\b|\bconditioner\b/i, "hair conditioner"],
    [/\bhair dye shampoo\b|\bcoloring shampoo\b/i, "hair dye shampoo"],
    [/\bshampoo\b/i, "shampoo"],
    [/(?:scalp.*serum|hair.*serum)/i, "scalp care serum"],
    [/(?:hair oil|hair.*oil)/i, "hair oil"],
    [/(?:led mask|beauty led mask|red light.*mask)/i, "LED face mask"],
    [/(?:facial serum|face serum|skin.*serum|serum.*skin)/i, "facial serum"],
    [/\b(?:toner|toning)\b/i, "facial toner"],
    [/(?:face cream|facial moisturizer|moisturizing cream|skin.*cream)/i, "facial moisturizer"],
    [/(?:sunscreen|sunblock)/i, "sunscreen"],
    [/(?:jewelry set|jewelry sets)/i, "jewelry set"],
    [/\bnecklace\b/i, "necklace"],
    [/\b(?:earrings?|ear studs?)\b/i, "earrings"],
    [/\b(?:bangle|bracelet)\b/i, "bracelet"],
    [/\b(?:brooch|lapel pin)\b/i, "brooch"],
    [/(?:cat litter mat)/i, "cat litter mat"],
    [/(?:mini electronic pets?|virtual cyber pet)/i, "virtual pet toy"],
    [/(?:seasonal pet outfit)/i, "pet outfit"],
    [/(?:pet|cat|dog).*?(?:carrier|travel).*?(?:cat|dog|pet)|(?:cat|dog|pet).*?(?:carrier|travel)/i, "pet carrier"],
    [/(?:storage rack|storage cabinet|cosmetic organizer|desk organizer|desktop storage)/i, "storage organizer"],
    [/(?:table game|puzzle game|electronic game|montessori).*?(?:toy|game)|(?:toy|game).*?(?:table game|puzzle game|electronic game|montessori)/i, "electronic puzzle toy"],
    [/(?:painting board|projector art|kids painting)/i, "children's painting board"],
    [/(?:disposable bed sheets?|bed sheets?)/i, "disposable bed sheets"],
    [/(?:bottle opener|corkscrew)/i, "bottle opener and corkscrew"],
    [/(?:cable organizer|wire organizer|cord management|cable bag|cable tie|cable routing)/i, "cable organizer"],
    [/(?:diamond painting|rhinestone painting|mosaic painting|diamond mosaic)/i, "diamond painting kit"],
    [/(?:witch hat|salt pepper|spice).*\b(?:jar|container)\b|\b(?:jar|container)\b.*(?:witch hat|salt pepper|spice)/i, "storage jar"],
    [/\b(?:controller|gamepad|gamepads|joystick|joypad)\b/i, "game controller"],
    [/\b(?:lavalier|lapel)\s+microphone\b|\b(?:microphone|mic)\b/i, "microphone"],
    [/\b(?:lens filter|cpl filter|nd filter|camera filter)\b/i, "camera lens filter"],
    [/\b(?:cable organizer|wire organizer|cord management|cable bag)\b/i, "cable organizer"],
    [/\b(?:sticker|stickers)\b/i, "sticker set"],
    [/\b(?:keyboard|keyboards)\s+(?:and|&)\s+(?:mouse|mice)\b|\b(?:mouse|mice)\s+(?:and|&)\s+(?:keyboard|keyboards)\b/i, "keyboard and mouse set"],
    [/\b(?:memory card reader|card reader|tf reader|sd reader)\b/i, "memory card reader"],
    [/(?:phone|mobile|smartphone).*(?:case|cover|pouch)|(?:case|cover|pouch).*(?:phone|mobile|smartphone)/i, "phone case"],
    [/(?:tablet|ipad|redmi pad|xiaomi pad|lenovo.*tab).*(?:case|cover)|(?:case|cover).*(?:tablet|ipad|redmi pad|xiaomi pad|lenovo.*tab)/i, "tablet case"],
    [/(?:phone|mobile|smartphone).*(?:selfie stick|tripod|gimbal)|(?:selfie stick|tripod|gimbal).*(?:phone|mobile|smartphone)/i, "selfie stick or tripod"],
    [/(?:(?:handheld|neck|desk|portable|cooling|electric|rechargeable|mini)\s+)?fan\b|\bfan\s+(?:with|for|and)/i, "portable fan"],
    [/(?:phone|mobile|smartphone|tablet).*(?:holder|stand|mount|clamp)|(?:holder|stand|mount|clamp).*(?:phone|mobile|smartphone|tablet)/i, "phone or tablet holder"],
    [/\b(?:webcam|web cam|web camera|streaming cam)\b/i, "webcam"],
    [/(?:ip|cctv|surveillance|security|bullet|dome).*\bcamera\b|\bcamera\b.*(?:ip|cctv|surveillance|security|bullet|dome)/i, "security camera"],
    [/\b(?:action camera|digital camera|video camera|dashcam|camera)\b/i, "camera"],
    [/(?:phone|mobile|smartphone).*(?:selfie stick|tripod|gimbal)|(?:selfie stick|tripod|gimbal).*(?:phone|mobile|smartphone)/i, "selfie stick or tripod"],
    [/\b(?:flashlight|head flashlight|torch|hand torch)\b/i, "flashlight"],
    [/\b(?:backpack|rucksack|daypack)\b/i, "backpack"],
    [/(?:duffle|tote|handbag|crossbody|shoulder|travel)\s+bag\b|\bbag\b.*(?:duffle|tote|handbag|crossbody|shoulder|travel)/i, "bag"],
    [/\b(?:beanie|baseball cap|cap|hat|bonnet)\b/i, "hat"],
    [/(?:diamond painting|rhinestone painting|mosaic painting|diamond mosaic)\b/i, "diamond painting kit"],
    [/(?:witch hat|salt pepper|spice).*\b(?:jar|container)\b|\b(?:jar|container)\b.*(?:witch hat|salt pepper|spice)/i, "storage jar"],
    [/\btable runner\b/i, "table runner"],
    [/(?:table|desk|bedside|wall|ceiling|night|sunset)\s+lamp\b|\blamp\b.*(?:table|desk|bedside|wall|ceiling|night|sunset)/i, "lamp"],
    [/\b(?:t[- ]?shirt|tee)\b/i, "t-shirt"],
    [/\b(?:button[- ]?down shirt|blouse)\b/i, "shirt"],
    [/\b(?:hoodie|hooded sweatshirt|sweatshirt)\b/i, "hoodie"],
    [/\bsweater\b/i, "sweater"],
    [/\bdress\b/i, "dress"],
    [/\btrench coat\b/i, "trench coat"],
    [/\bcardigan\b/i, "cardigan"],
    [/\bskirt\b/i, "skirt"],
    [/\b(?:jacket|blazer|overcoat)\b/i, "jacket"],
    [/\b(?:pants|trousers|joggers|leggings|shorts)\b/i, "pants"],
    [/\bjeans?\b/i, "jeans"],
    [/\b(?:brooch|lapel pin|badge pin)\b/i, "brooch"],
    [/\b(?:nfc|rfid)\b/i, "NFC tag"],
    [/\b(?:keychain|key ring|keyring)\b/i, "keychain"],
    [/\b(?:hair accessories?|hair clips?|headbands?|scrunchies?)\b/i, "hair accessory"],
    [/\b(?:mug|coffee cup|tea cup)\b/i, "mug"],
    [/\b(?:pet carrier|animal carrier|pet travel)\b/i, "pet carrier"],
    [/\b(?:dog|cat|pet)\b.*(?:groom|brush|clipper|scissor|toy|bed|leash)|(?:groom|brush|clipper|scissor|toy|bed|leash).*\b(?:dog|cat|pet)\b/i, "pet accessory"],
    [/\b(?:computer|office|gaming|wireless|bluetooth)\s+mouse\b/i, "computer mouse"],
    [/\b(?:usb|type[- ]?c|multiport)\s+hub\b/i, "USB hub"],
    [/screen[- ]?auto[- ]?clicker|auto[- ]?clicker.*(?:screen|phone)|(?:screen|phone).*auto[- ]?clicker/i, "screen auto clicker"],
    [/(?:pet|dog|cat).*(?:nail clipper|claw trimmer)|(?:nail clipper|claw trimmer).*(?:pet|dog|cat)/i, "pet nail clipper"],
    [/(?:rca|coaxial).*cable|cable.*(?:rca|coaxial)/i, "RCA coaxial audio cable"],
    [/f40.*sweater|sweater.*f40|mens and womens.*sweater/i, "patterned sweater"],
    [/(?:3\s*5\s*mm|35mm).*?(?:aux|audio).*cable|(?:aux|audio).*cable.*(?:xh2|terminal)/i, "3.5mm AUX audio cable"],
    [/collagen.*(?:essence[- ]?)?serum|(?:essence[- ]?)?serum.*collagen/i, "collagen essence serum"],
    [/(?:inflatable|air).*mattress|mattress.*(?:inflatable|camping|sleeping)/i, "inflatable camping mattress"],
    [/(?:tactical|molle).*backpack|backpack.*(?:tactical|molle)|\bruck sack\b/i, "tactical backpack"],
    [/(?:squeegees?|window cleaning).*\b(?:window|glass)\b|\b(?:window|glass)\b.*(?:squeegees?|window cleaning)/i, "window and glass squeegee"],
    [/(?:thermos|tumbler|water bottle).*\b(?:straw|insulated)\b|\b(?:straw|insulated)\b.*(?:thermos|tumbler|water bottle)/i, "insulated drink bottle"],
    [/articulated arm.*(?:hex pin|female thread)|(?:hex pin|female thread).*articulated arm/i, "articulated camera mounting arm"],
    [/(?:cosmetic|makeup|foundation|powder|concealer).*(?:puff|sponge|air cushion)|(?:puff|sponge|air cushion).*(?:cosmetic|makeup|foundation|powder|concealer)/i, "makeup puff"],
    [/(?:lip mask|lip brush).*(?:brush|application)|(?:brush|applicator).*(?:lip mask|lip)/i, "lip mask brush"],
    [/(?:lip liner|lip-liner|lip gloss).*(?:set|kit|pen)|(?:set|kit|pen).*(?:lip liner|lip-liner|lip gloss)/i, "lip liner set"],
    [/\bwatch\b.*(?:jewelry set|watch set)|(?:jewelry set|watch set).*\bwatch\b/i, "watch and jewelry set"],
    [/\b(?:ear hooks?|anti lost ear hooks?)\b/i, "earbud ear hooks"],
    [/\b(?:ear tips?|eartips?)\b/i, "earbud replacement ear tips"],
    [/(?:earbud|airpods?|buds?).*\b(?:case|cover)\b|\b(?:case|cover).*\b(?:earbud|airpods?|buds?)\b/i, "earbud protective case"],
    [/\b(?:sports arm bag|arm pouch|running arm bag)\b/i, "fitness arm bag"],
    [/(?:powerbank|power bank|external battery)/i, "magnetic wireless power bank"],
    [/(?:\breplacement\b|\brepair\b).*\b(?:microphone|mic)\b|\b(?:microphone|mic)\b.*(?:\breplacement\b|\brepair\b)/i, "replacement headset microphone"],
    [/\b(?:microphone|mic)\b.*\b(?:headset|headphone|earphone)\b|\b(?:headset|headphone|earphone)\b.*\b(?:microphone|mic)\b/i, "wired headset with microphone"],
    [/\b(?:ear pads?|earpads?|earphone pads?|headphone pads?)\b/i, "headphone replacement earpads"],
    [/watchband|watch strap|watch band/i, "watch strap"],
    [/keyboard.*wrist rest|wrist rest.*keyboard|keyboard.*hand rest/i, "keyboard wrist rest"],
    [/keyboard.*fidget|fidget.*keyboard/i, "keyboard fidget toy"],
    [/\bkeyboard\b|\bkeypad\b/i, "keyboard"],
    [/memory card|micro[- ]?(?:sd|tf)|tf card/i, "memory card"],
    [/usb hub|hub expander|multiport adapter/i, "USB hub"],
    [/surveillance camera|security camera|video surveillance camera/i, "security camera"],
    [/beach tent|camping tent|pop[- ]?up tent/i, "beach tent"],
    [/camping table|folding table/i, "folding camping table"],
    [/automatic umbrella|\bumbrella\b/i, "automatic umbrella"],
    [/tassel scarf|shawl|wrap scarf|\bscarf\b/i, "scarf"],
    [/\bbracelet\b/i, "bracelet"],
    [/blanket|throw blanket/i, "blanket"],
    [/headlamp|head flashlight/i, "headlamp"],
    [/ear warmers|earmuffs|ear warmer/i, "ear warmers"],
    [/birthday candles?/i, "birthday candles"],
    [/coasters?/i, "drink coaster set"],
    [/artificial leaves/i, "artificial leaves"],
    [/coffee mug|tea cup|\bmug\b/i, "ceramic mug"],
    [/makeup kit|face body paint|body paint/i, "face and body paint kit"],
    [/eyeshadow palette|eye shadow palette/i, "eyeshadow palette"],
    [/setting powder/i, "setting powder"],
    [/joggers|cargo pants|\btrousers\b|\bpants\b/i, "pants"],
    [/heated blanket/i, "heated blanket"],
    [/\b(?:neck fan|desk fan|electric fan|air cooler fan)\b/i, "portable fan"],
    [/\b(?:hdmi cable|hdmi-compatible cable)\b/i, "HDMI cable"],
    [/\b(?:usb[- ]?c cable|type[- ]?c cable|charging cable|data cable)\b/i, "USB cable"],
    [/\b(?:cleaning brush|scrub brush|gap brush|grout brush)\b/i, "cleaning brush"],
    [/\b(?:coffee mug|tea cup|\bmug\b)\b/i, "ceramic mug"],
    [/\b(?:table|desk table|camping table)\b/i, "table"],
    [/food storage|airtight container|pantry organizer/i, "food storage container set"],
    [/tablet.*(?:holder|stand)|(?:holder|stand).*tablet/i, "tablet car holder"],
    [/\b(?:memory card reader|card reader)\b/i, "memory card reader"],
    [/\b(?:sweatshirt|hoodie|cardigan|coat|jacket|trench coat)\b/i, "garment"],
    [/\bsmartwatch\b|\bsmart watch\b/i, "smart watch"],
    [/\bwatch\b/i, "watch"],
    [/\b(?:t[- ]?shirt|tee)\b/i, "t-shirt"],
    [/\bjeans?\b/i, "jeans"],
    [/\b(?:headband cover|earphone bracket|headphone bracket)\b/i, "headphone replacement part"],
    [/\b(?:eye mask|eye mask pad)\b/i, "eye mask replacement pad"],
    [/\b(?:hot shoes?|hot shoe|camera shoe)\b/i, "camera hot-shoe mount"],
    [/(?:dcdc|dc-dc).*power module|power module.*(?:dcdc|dc-dc)/i, "DC-DC power module set"],
    [/\b(?:crampons?|mountaineering cleats?|ice grips?|traction cleats?)\b/i, "traction cleats"],
    [/\b(?:running|marathon|trail) shoes?\b/i, "running shoes"],
    [/\b(?:earphone|headphone) cables?\b/i, "headphone audio cable"],
    [/\b(?:softbox|honeycomb grid)\b/i, "studio softbox"],
    [/\b(?:dive case|underwater housing|diving case)\b/i, "underwater camera housing"],
    [/\b(?:shutter release|remote shutter)\b/i, "camera shutter-release cable"],
    [/\b(?:usb extension|usb extender)\b/i, "USB extension cable"],
    [/\b(?:lipo battery|li-ion battery|rechargeable battery)\b/i, "rechargeable battery pack"],
    [/\b(?:controller cover|gamepad cover|joystick cover)\b/i, "game controller cover"],
    [/\b(?:digital antenna|tv antenna|dvb-t antenna)\b/i, "digital TV antenna"],
    [/\b(?:rubber plugs?|rubber replacement)\b/i, "console replacement rubber plugs"],
    [/\b(?:micro switch|microswitch)\b/i, "controller micro-switch"],
    [/\b(?:bluetooth aux adapter|aux adapter|audio bluetooth adapter)\b/i, "Bluetooth AUX audio adapter"],
    [/\b(?:projector disc|galaxy projector disc|film discs?)\b/i, "projector replacement film discs"],
    [/\b(?:led strip.*tv|tv.*led strip)\b/i, "TV LED backlight strip"],
    [/\b(?:audio mixer|mixing console)\b/i, "multi-channel audio mixer"],
    [/\b(?:rca.*cable|coaxial cable)\b/i, "RCA audio cable"],
    [/\b(?:stylus|digital pen|touch pen)\b/i, "stylus pen"],
    [/\b(?:pencil case|pencil box|pen holder)\b/i, "stationery case"],
    [/\b(?:screen protector|tempered glass|hydrogel film)\b/i, "screen protector"],
    [/silicone-case-for-xiaomi-redmi-pad-2|redmi-pad-2.*(?:case|cover)/i, "Xiaomi Redmi Pad 2 tablet case"],
    [/\b(?:tripod|selfie stick|gimbal)\b/i, "smartphone and camera support"],
    [/\b(?:phone holder|phone stand|mobile phone holder|car phone mount)\b/i, "phone holder"],
    [/\b(?:charger|charging dock|charging stand)\b/i, "device charger"],
    [/\b(?:pcb board|circuit board|replacement part|repair part)\b/i, "replacement electronic component"],
    [/\b(?:hair brush cleaner|comb cleaner)\b/i, "hairbrush cleaning tool"],
    [/\b(?:water bottle|shaker bottle|tumbler|travel mug|thermos)\b/i, "reusable drink container"],
  ];
  for (const [pattern, type] of exactTypes) {
    if (pattern.test(primaryEvidence)) return type;
  }

  const rawType = sanitizeMarketplaceClaims(normalizePlainText(signals.productTypeText || signals.sourceProductType || signals.catalogProductType));
  const identityTokens = new Set(tokenizeText([signals.handle, signals.sourceTitle, signals.catalogTitle].filter(Boolean).join(" ")));
  const rawTypeEvidenceTokens = tokenizeText(rawType).filter((token) => token.length >= 3 && !GENERIC_TITLE_WORDS.has(token));
  if (
    rawType &&
    rawTypeEvidenceTokens.some((token) => identityTokens.has(token)) &&
    !/^(?:accessories?|item|product|general|miscellaneous|other)$/i.test(rawType) &&
    !GENERIC_HUMAN_TYPE_PATTERN.test(rawType) &&
    isTitleAlignedWithKnowledge(rawType, knowledge)
  ) {
    return rawType.toLowerCase();
  }

  const fallbackType = normalizePlainText(knowledge.productNouns?.[0] || "product").toLowerCase();
  const fallbackEvidenceTokens = tokenizeText(fallbackType).filter((token) => token.length >= 3 && !GENERIC_TITLE_WORDS.has(token));
  return fallbackEvidenceTokens.some((token) => identityTokens.has(token)) && !GENERIC_HUMAN_TYPE_PATTERN.test(fallbackType)
    ? fallbackType
    : "item";
}

function copyFactFragment(fact) {
  const value = humanizeFactList(polishListingValue(fact?.value || ""));
  if (!value) return "";
  switch (fact?.label) {
    case "Size or capacity":
      return `the ${value} size or capacity`;
    case "Material":
      return `${value} material`;
    case "Supported features":
      return `${value} features`;
    case "Intended user":
      return `an audience of ${value}`;
    case "Use or occasion":
      return `${value} use`;
    case "Placement or setting":
      return `${value} placement`;
    case "Device compatibility":
      return `compatibility with ${value}`;
    case "Pack format":
      return `the ${value} pack format`;
    case "Style or design":
      return `${value} styling`;
    case "Available options":
      return `options including ${value}`;
    default:
      return `${fact.label.toLowerCase()}: ${value}`;
  }
}

function copyFactFragments(facts, limit = 3) {
  const seenValues = new Set();
  return uniqueValues(
    (facts || [])
      .filter((fact) => fact?.label !== "Product focus")
      .filter((fact) => !["Use or occasion", "Placement or setting"].includes(fact?.label))
      .filter((fact) => {
        const value = normalizeComparableText(fact?.value || "");
        if (!value || seenValues.has(value)) return false;
        seenValues.add(value);
        return true;
      })
      .map(copyFactFragment)
      .filter(Boolean),
  ).slice(0, limit);
}

function buildSpecificFallbackSummary(titleText, signals, knowledge, facts, typeText = "") {
  const noun = normalizePlainText(typeText || humanProductType(signals, titleText, knowledge));
  const safeNoun = noun && !GENERIC_HUMAN_TYPE_PATTERN.test(noun) && !/^(?:item|product)$/i.test(noun)
    ? noun
    : "";
  const nounPhrase = /^(?:jewelry|clothing|apparel|home decor)$/i.test(safeNoun)
    ? `${safeNoun.toLowerCase()} piece`
    : safeNoun.toLowerCase()
      .replace(/\busb\b/gi, "USB")
      .replace(/\bhdmi\b/gi, "HDMI")
      .replace(/\brca\b/gi, "RCA")
      .replace(/\bbluetooth\b/gi, "Bluetooth");
  const article = /^(?:USB|UHF|URL|XH|XH2|iPhone|iPad)\b/i.test(nounPhrase)
    ? "a"
    : /^[aeiou]/i.test(nounPhrase)
      ? "an"
      : "a";
  const pluralNoun = /^(?:pants|jeans|ear tips|ear warmers|artificial leaves|false eyelashes|traction cleats|coasters|birthday candles|projector film discs|replacement earpads)$/i.test(nounPhrase);
  const identity = shortenAtWordBoundary(
    titleText || buildSafeHandleTitle(signals) || normalizePlainText(signals.handlePhrase || safeNoun),
    60,
  );
  const fragments = copyFactFragments(facts, 3).filter((fragment) => {
    if (!nounPhrase) return true;
    const normalizedFragment = normalizeComparableText(fragment);
    const normalizedNoun = normalizeComparableText(nounPhrase);
    return !normalizedFragment.includes(`${normalizedNoun} styling`) && normalizedFragment !== normalizedNoun;
  });
  const use = firstFactValue(facts, ["Use or occasion", "Placement or setting"]);
  const detail = fragments.length
    ? fragments.length === 1
      ? ` with ${fragments[0]}`
      : ` with ${fragments.slice(0, -1).join(", ")}, and ${fragments.at(-1)}`
    : "";
  const useLabel = use ? humanizeFactList(polishListingValue(use)).toLowerCase() : "everyday";
  const subject = /^(?:the|a|an)\s+/i.test(identity) ? identity : `The ${identity}`;
  if (!safeNoun) {
    return `${subject} is made for ${useLabel} use${detail}.`;
  }
  const nounLead = pluralNoun ? nounPhrase : `${article} ${nounPhrase}`;
  const evidence = normalizeComparableText(`${signals.handle || ""} ${titleText || ""}`);
  if (/\b(?:shirt|dress|top|blouse|jacket|coat|pants|jeans|skirt|hoodie|apparel|garment)\b/i.test(evidence)) {
    return `${subject} brings ${nounLead} styling to ${useLabel} outfits${detail}.`;
  }
  if (/\b(?:necklace|bracelet|brooch|earrings?|jewelry|ring|scarf|hair clip|headband|belt|hat|cap)\b/i.test(evidence)) {
    return `${subject} adds ${nounLead} detail to ${useLabel} looks${detail}.`;
  }
  if (/\b(?:bag|backpack|tote|wallet|purse|organizer|case|holder|storage)\b/i.test(evidence)) {
    return `${subject} keeps everyday essentials organized in ${nounLead}${detail}.`;
  }
  if (/\b(?:cable|adapter|charger|keyboard|mouse|camera|tripod|phone|screen|electronic|audio|battery)\b/i.test(evidence)) {
    return `${subject} fits a compatible setup as ${nounLead}${detail}.`;
  }
  return `${subject} is made for ${useLabel} use as ${nounLead}${detail}.`;
}

function buildHumanProductSummary(titleText, signals, knowledge, facts) {
  const strictSummary = buildStrictHumanSummary(titleText, signals, facts);
  if (strictSummary) return strictSummary;
  const evidence = normalizeComparableText([signals.handle, titleText].filter(Boolean).join(" "));
  const typeText = humanProductType(signals, titleText, knowledge);
  const subject = /(?:hooks|tips|earpads|earbuds|earphones|headphones|shoes|sandals|boots|sneakers|slippers|pants|trousers|glasses|sunglasses|eyelashes|accessories|tools)$/i.test(typeText)
    ? "These"
    : "This";
  const linkingVerb = subject === "These" ? "are" : "is";
  const device = firstFactValue(facts, ["Device compatibility"]);
  const devicePhrase = humanizeFactList(device);
  const setting = firstFactValue(facts, ["Placement or setting", "Use or occasion"]);
  const size = firstFactValue(facts, ["Size or capacity"]);
  const descriptor = tokenizeText(titleText)
    .filter((token) => token.length >= 3 && !GENERIC_TITLE_WORDS.has(token) && !/^\d+$/.test(token))
    .slice(0, 6)
    .join(" ");

  if (/(?:sticker|stickers)\b/i.test(signals.handle || "")) {
    const count = (signals.handle || "").match(/(?:^|-)(\d+)(?:pcs?|pieces?)(?:-|$)/i)?.[1];
    return `This ${count ? `${count}-piece ` : ""}waterproof sticker set is made for decorating notebooks, suitcases, and phone cases. Check the pack size and designs before ordering.`;
  }
  if (/(?:diamond-painting|diamond-mosaic|rhinestone-painting|mosaic-painting)/i.test(signals.handle || "")) {
    const subject = /witch-hat|halloween|christmas|pumpkin/i.test(signals.handle || "")
      ? "Halloween witch-hat"
      : "decorative";
    return `This ${subject} diamond-painting kit turns a printed design into a rhinestone mosaic for a hands-on DIY craft project. Check the canvas size and included pieces before ordering.`;
  }
  if (/(?:witch-hat|salt-pepper|spice).*?(?:jar|container)|(?:jar|container).*?(?:witch-hat|salt-pepper|spice)/i.test(signals.handle || "")) {
    return `This ${/glass/i.test(signals.handle || "") ? "glass " : ""}witch-hat storage jar keeps salt, pepper, or other seasonings together on a kitchen counter. Check the lid and capacity before ordering.`;
  }
  if (/(?:cable-organizer|wire-organizer|cord-management|cable-tie|cable-routing)/i.test(signals.handle || "")) {
    const fastening = /velcro/i.test(signals.handle || "") ? "a Velcro tie" : "a compact organizer format";
    const placement = /desktop|desk|board/i.test(signals.handle || "") ? "on a desk" : "in a cable drawer or bag";
    return `This ${/portable/i.test(signals.handle || "") ? "portable " : ""}cable organizer uses ${fastening} to keep charging, data, and plug-board cables grouped ${placement}. Check the cable width and fastening fit before ordering.`;
  }
  if (/cat-litter-mat/i.test(signals.handle || "")) {
    return "This double-layer cat litter mat catches loose litter below the box and uses a non-slip, waterproof format for easier cleanup. Check the mat size before ordering.";
  }
  if (/mini-electronic-pets?|virtual-cyber-pet/i.test(signals.handle || "")) {
    return "This mini virtual pet toy offers a USB-charging cyber-pet format with interactive electronic play in a compact design. Check the charging method and included functions before ordering.";
  }
  if (/seasonal-pet-outfit/i.test(signals.handle || "")) {
    return "This soft holiday pet outfit adds a photo-ready layer for seasonal home styling. Check the animal size, fabric, and fastening details before ordering.";
  }
  if (/(?:pet|cat|dog).*?(?:carrier|travel).*?(?:cat|dog|pet)|(?:cat|dog|pet).*?(?:carrier|travel)/i.test(signals.handle || "")) {
    return "This travel pet carrier gives cats or small dogs a contained space for vehicle journeys, with the listed opening, handle, and ventilation details to check before ordering.";
  }
  if (/(?:storage-rack|storage-cabinet|cosmetic-organizer|desk-organizer|desktop-storage)/i.test(signals.handle || "")) {
    return `This ${/cosmetic|makeup/i.test(signals.handle || "") ? "desktop cosmetic and jewelry organizer" : "desktop storage rack and organizer"} creates separate spaces for the small items named in the design. Check the compartments, footprint, and material before ordering.`;
  }
  if (/(?:table-game|puzzle-game|electronic-game|montessori).*?(?:toy|game)|(?:toy|game).*?(?:table-game|puzzle-game|electronic-game|montessori)/i.test(signals.handle || "")) {
    return "This electronic Montessori puzzle toy combines light-up music and fast-push play in a compact travel-friendly format. Check the power source and age guidance before ordering.";
  }
  if (/(?:painting-board|projector-art|kids-painting)/i.test(signals.handle || "")) {
    return "This LED projector painting board gives children a guided surface for drawing and tracing, with the included light and art accessories to check before ordering.";
  }
  if (/(?:disposable-bed-sheets?|bed-sheets?)/i.test(signals.handle || "")) {
    return "This disposable non-woven bed-sheet set provides a clean cover for salon tables or temporary travel use. Check the sheet dimensions, pack count, and fit before ordering.";
  }
  if (/(?:bottle-opener|corkscrew)/i.test(signals.handle || "")) {
    return `This ${/personalized|engraved/i.test(signals.handle || "") ? "personalized engraved wooden " : ""}bottle opener and corkscrew combines two bar tools in one gift-ready format. Check the engraving details and finish before ordering.`;
  }
  if (/makeup-brush-cleaner|cosmetic-brush-cleaner/i.test(signals.handle || "")) {
    return "This 3-in-1 USB makeup brush cleaner washes and dries cosmetic brushes in a compact electric format. Check the power connection and brush-size fit before ordering.";
  }
  if (/precision.*tweezers?|tweezers?.*eyebrow/i.test(signals.handle || "")) {
    return "These stainless-steel precision beauty tweezers have a pointed grip for controlled brow grooming or small-detail handling. Check the tip style and included case before ordering.";
  }
  if (/(?:foundation|concealer).*?(?:brush|blender)|(?:brush|blender).*?(?:foundation|concealer)/i.test(signals.handle || "")) {
    return "This foundation and concealer makeup brush uses a dense blending head for applying and smoothing complexion products. Check the handle and bristle format before ordering.";
  }
  if (/(?:eyebrow|brow).*?(?:gel|cream)|(?:gel|cream).*?(?:eyebrow|brow)/i.test(signals.handle || "")) {
    return "This waterproof eyebrow setting gel shapes and holds brow hairs with a clear or tinted liquid format. Check the shade and applicator before ordering.";
  }
  if (/(?:false eyelash|false lash|eyelash extension|lash extension)/i.test(signals.handle || "")) {
    const size = firstFactValue(facts, ["Size or capacity"]);
    return `These false eyelash extensions add a premade lash-fan look for eye makeup,${size ? ` with the listed ${size} size range` : " with the listed curl and length options"}. Check the style before ordering.`;
  }
  if (/(?:facial mask|face mask|sheet mask)/i.test(signals.handle || "")) {
    return "This facial sheet mask places a single-use skincare sheet over the face for a moisturizing routine. Check the sheet count, ingredients, and application time before use.";
  }
  if (/(?:hairline.*powder|hair.*concealer.*powder)/i.test(signals.handle || "")) {
    return "This hairline concealer powder adds temporary color along sparse-looking hairline areas, with an applicator for targeted placement. Check the shade and powder weight before ordering.";
  }
  if (/(?:cc-cream|color-changing.*cream)/i.test(signals.handle || "")) {
    return "This color-changing CC cream works as a complexion base with a cream-to-tint makeup format. Check the shade, coverage description, and skin compatibility before use.";
  }
  if (/liquid-foundation/i.test(signals.handle || "")) {
    return `This ${size ? `${size} ` : ""}liquid foundation provides a blendable complexion base in the finish named by the listing. Check the shade and skin compatibility before use.`;
  }
  if (/matte-lipstick|\blipstick\b/i.test(signals.handle || "")) {
    return "This matte lipstick adds a defined lip color with the finish and shade options listed for the product. Check the selected color and application directions before use.";
  }
  if (/lip-gloss|lipgloss/i.test(signals.handle || "")) {
    return "This lip gloss adds a reflective finish with the shade and wear details listed for the product. Check the selected color and application directions before use.";
  }
  if (/setting-powder/i.test(signals.handle || "")) {
    return "This setting powder helps finish a makeup base with the texture and shade options listed for the product. Check the selected shade and application directions before use.";
  }
  if (/hair-mask/i.test(signals.handle || "")) {
    return "This hair mask is a rinse-out conditioning step for the hair-care routine, with the listed formula and application directions to check before use.";
  }
  if (/hair-conditioner|conditioner/i.test(signals.handle || "")) {
    return "This hair conditioner is a post-wash conditioning step for the hair lengths, with the listed formula and rinse-out directions to check before use.";
  }
  if (/hair-dye-shampoo|coloring-shampoo/i.test(signals.handle || "")) {
    return "This hair-dye shampoo combines cleansing with a color-refresh step. Check the shade, patch-test guidance, and application time before use.";
  }
  if (/shampoo/i.test(signals.handle || "")) {
    return "This shampoo is formulated for the cleansing step identified in the listing, with the hair type and use directions to check before ordering.";
  }
  if (/(?:scalp.*serum|hair.*serum)/i.test(signals.handle || "")) {
    return "This scalp-care serum uses a targeted applicator for a focused hair or scalp routine. Check the ingredients and application directions before use.";
  }
  if (/(?:hair-oil|hair.*oil)/i.test(signals.handle || "")) {
    return "This hair oil adds a leave-in oil step to a daily styling or conditioning routine. Check the formula and application amount before use.";
  }
  if (/(?:led-mask|beauty-led-mask|red-light.*mask)/i.test(signals.handle || "")) {
    return "This rechargeable LED face mask combines red and blue light modes in a wearable skincare-device format. Check the eye protection, charge time, and operating directions before use.";
  }
  if (/(?:facial-serum|face-serum|skin.*serum|serum.*skin)/i.test(signals.handle || "")) {
    return "This facial serum adds a concentrated leave-on step to a skincare routine, with the listed ingredients and application directions to check before use.";
  }
  if (/\b(?:toner|toning)\b/i.test(signals.handle || "")) {
    return "This facial toner adds a liquid step after cleansing, with the listed ingredients and application directions to check before use.";
  }
  if (/(?:face-cream|facial-moisturizer|moisturizing-cream|skin.*cream)/i.test(signals.handle || "")) {
    return "This facial moisturizer adds a cream step to daily skincare, with the listed formula and application directions to check before use.";
  }
  if (/(?:sunscreen|sunblock)/i.test(signals.handle || "")) {
    return "This sunscreen provides a facial sun-care step with the listed SPF, texture, and application directions to check before use.";
  }
  if (/(?:jewelry-set|jewelry-sets)/i.test(signals.handle || "")) {
    const audience = /(?:women|womens|woman|female|ladies)/i.test(signals.handle || "") ? " women's" : /(?:men|mens|man|male)/i.test(signals.handle || "") ? " men's" : "";
    return `This${audience} jewelry set brings together coordinated wearable pieces for the occasion and finish described by its design. Check the included pieces, sizing, and finish before ordering.`;
  }
  if (/necklace/i.test(signals.handle || "")) {
    const detail = /pendant/i.test(signals.handle || "") ? "pendant" : /bead/i.test(signals.handle || "") ? "bead" : "chain";
    return `This fashion necklace adds a ${detail} detail to an everyday or occasion look. Check the chain length, fastening, and finish before ordering.`;
  }
  if (/earrings?/i.test(signals.handle || "")) {
    const detail = /drop|dangle/i.test(signals.handle || "") ? "drop" : /stud/i.test(signals.handle || "") ? "stud" : /crystal|zircon|pearl/i.test(signals.handle || "") ? "stone" : "decorative";
    return `These fashion earrings add a ${detail} detail to an outfit. Check the fastening, size, and finish before ordering.`;
  }
  if (/bangle|bracelet/i.test(signals.handle || "")) {
    const detail = /pearl/i.test(signals.handle || "") ? "pearl" : /bead/i.test(signals.handle || "") ? "bead" : /chain/i.test(signals.handle || "") ? "chain" : /plated|gold|silver/i.test(signals.handle || "") ? "plated" : "smooth";
    return `This fashion bracelet adds a ${detail} detail to everyday styling. Check the fit, fastening, and finish before ordering.`;
  }
  if (/brooch|lapel-pin/i.test(signals.handle || "")) {
    const detail = /floral|flower/i.test(signals.handle || "") ? "floral" : /pearl/i.test(signals.handle || "") ? "pearl" : /crystal|rhinestone/i.test(signals.handle || "") ? "crystal" : "themed";
    return `This ${detail} brooch adds a decorative accent to a lapel, scarf, or garment. Check the pin fastening and finish before ordering.`;
  }

  if (/(?:cosmetic|makeup|foundation|powder|concealer).*(?:puff|sponge|air cushion)|(?:puff|sponge|air cushion).*(?:cosmetic|makeup|foundation|powder|concealer)/i.test(evidence)) {
    const material = firstFactValue(facts, ["Material"]);
    const sizeOrPack = firstFactValue(facts, ["Pack format", "Size or capacity"]);
    const applications = ["foundation", "powder", "blush", "concealer"].filter((word) => new RegExp(`\\b${word}\\b`, "i").test(evidence));
    return `A ${material ? `${material.toLowerCase()} ` : ""}makeup puff with a soft sponge format for applying ${applications.length ? humanizeFactList(applications) : "complexion products"}${sizeOrPack ? ` in the listed ${sizeOrPack} format` : ""}.`;
  }
  if (/(?:lip mask|lip brush).*(?:brush|application)|(?:brush|applicator).*(?:lip mask|lip)/i.test(evidence)) {
    const material = firstFactValue(facts, ["Material"]);
    return `A portable ${material ? `${material.toLowerCase()} ` : ""}lip brush for spreading lip mask over the lips, with the cover or applicator format listed for this item.`;
  }
  if (/(?:lip liner|lip-liner|lip gloss).*(?:set|kit|pens?)|(?:set|kit|pens?).*(?:lip liner|lip-liner|lip gloss)/i.test(evidence)) {
    const pack = firstFactValue(facts, ["Pack format", "Size or capacity"]);
    const features = ["waterproof", "sweatproof", "non-fading"].filter((word) => new RegExp(`\\b${word}\\b`, "i").test(evidence));
    return `A ${pack || "multi-piece"} lip-liner pen set for makeup, made for outlining and shaping the lips${features.length ? ` with ${humanizeFactList(features)} color details` : ""}.`;
  }
  if (/curren-8291.*(?:chronograph|watch)/i.test(evidence)) {
    return "This Curren 8291 quartz chronograph watch pairs a leather strap with a military-inspired case for casual everyday wear. Check the selected color and box option before ordering.";
  }
  if (/4pcs-1pcs.*(?:quartz watch|watch).*stainless steel strap/i.test(evidence)) {
    return "This quartz watch pairs a round zinc-alloy case with a stainless-steel strap for sporty everyday wear. Check the numbered style option and selected finish before ordering.";
  }
  if (/womens-tassel-scarf.*(?:shawl|wrap|cashmere)/i.test(evidence)) {
    return "This custom photo tassel scarf combines a large soft shawl wrap with a picture-ready design for a personal gift or warm layer. Check the one-size format before ordering.";
  }
  if (/a-womens-bracelet.*(?:wide|smooth|surface)/i.test(evidence)) {
    return "This wide, smooth-surface bracelet adds a simple everyday accent to outfits and vacation looks. Check the plated finish and fit details for the selected option before ordering.";
  }
  if (/the-3d-printed-mens-t-shirt/i.test(evidence)) {
    return "This 3D-printed summer t-shirt brings a bold graphic to casual, fitness, and everyday sports outfits. Check the available color, size, and care details before ordering.";
  }
  if (/summer-seamless.*ice-silk.*t-shirt/i.test(evidence)) {
    return "This breathable ice-silk V-neck tee combines a short-sleeve cut with a lightweight vest-style silhouette for summer and sports wear. Check the color and size options before ordering.";
  }
  if (/etj-autumn.*(?:trench-coat|double-breasted)/i.test(evidence)) {
    return "This double-breasted trench coat pairs a British-style lapel with a belted silhouette and Maillard-inspired color for casual autumn layering. Check the size and color options before ordering.";
  }
  if (/retro-hong-kong.*(?:skirt|wraparound)/i.test(evidence)) {
    return "This retro corduroy mid-length wrap skirt uses a solid-color design for autumn and winter outfits, with belt or waistband options to compare. Check the selected size before ordering.";
  }
  if (/korean-style.*(?:cardigan|knitted)/i.test(evidence)) {
    return "This loose knitted cardigan jacket brings a Korean-inspired silhouette to casual autumn and winter layering. Check the color and size options before ordering.";
  }
  if (/mens-upf50.*(?:t-shirt|hoodie)/i.test(evidence)) {
    return "This UPF 50+ long-sleeve hoodie tee uses quick-dry fabric for running, fishing, and outdoor sun protection. Check the color, size, and care details before ordering.";
  }
  if (/\bwatch\b/i.test(evidence) && /\bjewelry set\b|\bwatch set\b/i.test(evidence)) {
    const style = ["square", "round", "LED", "digital", "quartz", "minimalist"].filter((word) => new RegExp(`\\b${word}\\b`, "i").test(evidence));
    const audience = /\b(?:women|womens|woman|female|ladies)\b/i.test(evidence)
      ? "women's"
      : /\b(?:men|mens|man|male)\b/i.test(evidence)
        ? "men's"
        : ""
    return `A ${audience ? `${audience} ` : ""}${style.length ? `${style.join(" ")} ` : ""}watch and jewelry set${/birthday gift/i.test(evidence) ? " suited to birthday gifting" : ""}.`;
  }
  if (/\bwatch\b/i.test(evidence) && /\b(?:replacement\s+(?:watch\s+)?strap|watch\s+strap|watch\s+band|wristband)\b/i.test(evidence) && !/\b(?:quartz|chronograph|digital|smart|LED)\s+watch\b/i.test(evidence)) {
    const material = firstFactValue(facts, ["Material"]);
    const sizes = firstFactValue(facts, ["Size or capacity"]);
    return `A ${material ? `${material.toLowerCase()} ` : ""}replacement watch strap for a compatible wristwatch, with ${sizes ? `the listed ${sizes} size range` : "the listed fit details"} to match before ordering.`;
  }
  if (/\bwatch\b/i.test(evidence)) {
    const style = ["square", "round", "LED", "digital", "quartz", "chronograph", "solar", "military"].filter((word) => new RegExp(`\\b${word}\\b`, "i").test(evidence));
    const material = firstFactValue(facts, ["Material"]);
    const feature = firstFactValue(facts, ["Supported features"]);
    const audience = /\b(?:women|womens|woman|female|ladies)\b/i.test(evidence)
      ? "women's"
      : /\b(?:men|mens|man|male)\b/i.test(evidence)
        ? "men's"
        : ""
    return `A ${audience ? `${audience} ` : ""}${style.length ? `${style.join(" ")} ` : ""}watch${material ? ` with a ${material.toLowerCase()} finish` : ""}${feature ? ` and ${feature.toLowerCase()} features` : ""}.`;
  }

  if (/(?:3\s*5\s*mm|35mm).*?(?:aux|audio).*cable.*(?:xh2|terminal)|(?:aux|audio).*cable.*(?:xh2|terminal)/i.test(evidence)) {
    return "This cable connects a 3.5mm AUX audio plug with an XH2.54 3-pin terminal in a male-to-male layout; check both connectors against the equipment before ordering.";
  }
  if (/screen[- ]?auto[- ]?clicker|auto[- ]?clicker/i.test(evidence)) {
    return "This screen auto clicker simulates repeated taps on a compatible smartphone app; check the phone fit and listed control method before ordering.";
  }
  if (/(?:pet|dog|cat).*(?:nail[- ]?clipper|claw[- ]?trimmer)|(?:nail[- ]?clipper|claw[- ]?trimmer).*(?:pet|dog|cat)/i.test(evidence)) {
    return "This pet nail clipper is for trimming dog or cat claws; check the cutting size and safety features before use.";
  }
  if (/f40.*sweater|sweater.*f40|mens[- ]and[- ]womens.*sweater/i.test(evidence)) {
    return "This F40 patterned sweater brings its car motif to fall and winter outfits; check the fabric and fit before ordering.";
  }
  if (/(?:ear[- ]?tips?|eartips?|ear[- ]?caps?|silicone[- ]?tips?)/i.test(evidence) && /(?:airpods?|buds?|earbuds?|earphones?)/i.test(evidence)) {
    return `These replacement silicone ear tips are shaped for ${devicePhrase || "compatible wireless earbuds"}; choose the listed size and check the exact model before ordering.`;
  }
  if (/collagen.*(?:essence[- ]?)?serum|(?:essence[- ]?)?serum.*collagen/i.test(evidence)) {
    return "This collagen essence serum combines the listed ceramides, aloe vera, and centella asiatica; check the ingredient list and application directions before use.";
  }
  if (/(?:3\s*5\s*mm|35mm).*?(?:aux|audio).*cable/i.test(evidence)) {
    return "This cable carries a 3.5mm AUX audio signal; check the device-side connector and cable length before ordering.";
  }
  if (/\baudio receiver\b/i.test(evidence) && /\b(?:rca|3\s*5\s*mm|aux|optical|bluetooth)\b/i.test(evidence)) {
    const connectors = [
      /\b(?:rca)\b/i.test(evidence) ? "RCA" : "",
      /\b(?:3\s*5\s*mm|aux)\b/i.test(evidence) ? "3.5mm AUX" : "",
      /\boptical\b/i.test(evidence) ? "optical" : "",
    ].filter(Boolean).join(", ");
    return `This Bluetooth audio receiver adds wireless playback through ${connectors || "compatible"} connections; check the input, output, and power requirements before ordering.`;
  }
  if (/\b(?:hot shoes?|hot shoe|camera shoe)\b/i.test(evidence)) {
    return "This camera hot-shoe mount supports compatible camera accessories; check the shoe size, thread, and accessory fit before ordering.";
  }
  if (/(?:dcdc|dc-dc).*power module|power module.*(?:dcdc|dc-dc)/i.test(evidence)) {
    return "This set contains DC-DC power modules for the voltage range listed in the title; check the input, output, pinout, and quantity before wiring.";
  }
  if (/\b(?:softbox|honeycomb grid)\b/i.test(evidence)) {
    return "This studio softbox shapes and softens light on a Bowens-compatible setup; check the mount and selected size before ordering.";
  }
  if (/\b(?:dive case|underwater housing|diving case)\b/i.test(evidence)) {
    return "This waterproof camera housing protects the compatible camera for underwater use; check the fit, seals, and depth rating before use.";
  }
  if (/\bdji osmo pocket 4\b/i.test(evidence) && /\b(?:gimbal|creator combo|camera)\b/i.test(evidence)) {
    return "This DJI Osmo Pocket 4 creator combo brings together a 6K gimbal camera, wide-angle lens, microphone, battery handle, and tripod.";
  }
  if (/\b(?:shutter release|remote shutter)\b/i.test(evidence)) {
    if (/\b(?:tripod|selfie stick|phone holder|phone stand)\b/i.test(evidence)) {
      const wireless = /\b(?:wireless|bluetooth)\b/i.test(evidence) ? " wireless" : "";
      return `This selfie stick and tripod supports a smartphone with a${wireless} remote shutter; check the height, phone fit, and mounting options before ordering.`;
    }
    return "This shutter-release cable links a compatible camera to a remote control; match the connector and camera model before ordering.";
  }
  if (/\byoshimura\b/i.test(evidence) && /\b(?:t[- ]?shirt|tee)\b/i.test(evidence)) {
    return "This Yoshimura cotton t-shirt brings its graphic to a casual wardrobe; check the size and care instructions before ordering.";
  }
  if (/\b(?:usb extension|usb extender)\b/i.test(evidence)) {
    return "This USB extension cable adds reach between compatible devices; check the connector, cable length, and device requirements before use.";
  }
  if (/\b(?:lipo battery|li-ion battery|rechargeable battery)\b/i.test(evidence)) {
    return "This rechargeable battery pack is intended for the compatible device or vehicle listed for this item; match its voltage, capacity, connector, and dimensions before use.";
  }
  if (/\b(?:controller cover|gamepad cover|joystick cover)\b/i.test(evidence)) {
    return "This controller cover protects the compatible gamepad listed for this item; confirm the console model and button layout before fitting.";
  }
  if (/\b(?:digital antenna|tv antenna|dvb-t antenna)\b/i.test(evidence)) {
    return "This digital TV antenna receives compatible broadcast signals; check local signal compatibility and the connection before setup.";
  }
  if (/\b(?:rubber plugs?|rubber replacement)\b/i.test(evidence)) {
    return "These replacement rubber plugs cover compatible console openings and screw points; match the console model before fitting.";
  }
  if (/\b(?:micro switch|microswitch)\b/i.test(evidence)) {
    return "This controller micro-switch replaces a compatible button component; match the console, board, and switch layout before repair.";
  }
  if (/\b(?:bluetooth aux adapter|aux adapter|audio bluetooth adapter)\b/i.test(evidence)) {
    return "This Bluetooth AUX adapter adds wireless audio to compatible equipment; check the source, receiver, power, and 3.5mm connector before use.";
  }
  if (/\b(?:snowglobe|snow globe)\b/i.test(evidence) && /\btumbler\b/i.test(evidence)) {
    return "This DIY snowglobe tumbler is a reusable plastic cup with a pre-drilled hole and break-resistant construction; check the 16oz capacity before ordering.";
  }
  if (/\b(?:snowglobe|snow globe)\b/i.test(evidence) && /\btumbler\b/i.test(evidence)) {
    return "This DIY snowglobe tumbler is a reusable plastic cup with a pre-drilled hole and break-resistant construction; check the 16oz capacity before ordering.";
  }
  if (/\b(?:sports arm bag|arm pouch|running arm bag)\b/i.test(evidence)) {
    return "This fitness arm bag holds a phone during running or outdoor activity; check the arm fit, pocket size, and water-resistant material before use.";
  }
  if (/\b(?:pet travel box|pet carrier|animal carrier)\b/i.test(evidence)) {
    return "This pet travel box is a portable carrier for cats or dogs, with a top window and impact-resistant plastic construction for travel.";
  }
  if (/(?:powerbank|power bank|external battery)/i.test(evidence)) {
    return "This magnetic wireless power bank supplies portable charging; check the device, wattage, capacity, and connector before use.";
  }
  if (/\b(?:projector disc|galaxy projector disc|film discs?)\b/i.test(evidence)) {
    return "These replacement projector film discs add galaxy or meteor scenes; confirm the projector model before ordering.";
  }
  if (/\b(?:led strip.*tv|tv.*led strip)\b/i.test(evidence)) {
    return "This LED backlight strip is sized for a compatible TV; match the screen size, connector, and strip layout before fitting.";
  }
  if (/\b(?:audio mixer|mixing console)\b/i.test(evidence)) {
    return "This multi-channel audio mixer combines the input and control functions listed for a stage, studio, or personal audio setup; check the channel and connection layout before ordering.";
  }
  if (/\b(?:rca.*cable|coaxial cable)\b/i.test(evidence)) {
    return "This RCA audio cable connects compatible male-to-male equipment; check the connector type and cable length before ordering.";
  }
  if (/\b(?:facial toner pads?|toner pads?|exfoliating pads?)\b/i.test(evidence)) {
    return "These facial toner pads fit an exfoliating skin-care step, with AHA and BHA ingredients, pad count, and application directions to check before use.";
  }
  if (/\b(?:mattress|sleeping pad)\b/i.test(evidence)) {
    return `${subject} ${typeText} ${linkingVerb} for indoor or outdoor sleeping${size ? ` in the listed ${size} size` : ""}.`;
  }
  if (/\b(?:squeegees?|window cleaning|glass cleaning)\b/i.test(evidence)) {
    return `${subject} ${typeText} ${linkingVerb} for cleaning windows and glass around the home.`;
  }
  if (/articulated arm.*(?:hex pin|female thread)|(?:hex pin|female thread).*articulated arm/i.test(evidence)) {
    return "This 3-section articulated camera mounting arm uses a 5/8 hex pin with 1/4-20 and 3/8-16 female threads for positioning a compatible camera or light.";
  }
  if (/\b(?:tripod|selfie stick|gimbal)\b/i.test(evidence)) {
    const listedHeight = size || evidence.match(/\b\d{3,4}\s*mm\b/i)?.[0] || "";
    const wirelessShutter = /\b(?:wireless|bluetooth)\b/i.test(evidence);
    const format = /selfie stick/i.test(evidence)
      ? "selfie stick"
      : /gimbal/i.test(evidence)
        ? "gimbal"
        : "smartphone and camera tripod";
    return `This ${format} supports ${devicePhrase || "a smartphone or camera"}${listedHeight ? ` at ${listedHeight}` : ""}${wirelessShutter ? " and includes a wireless shutter" : ""}. Check the mount, device fit, and options before ordering.`;
  }
  if (/\b(?:cell phone stand|phone stand)\b/i.test(evidence)) {
    const placement = /\b(?:desk|tabletop|office)\b/i.test(evidence) ? "desk" : "phone";
    const rotation = /\b360(?: degree|°)?\b/i.test(evidence) || /360 rotation/i.test(evidence) ? "360-degree rotating" : "";
    const foldable = /\bfoldable|folding\b/i.test(evidence) ? "foldable" : "";
    const magnetic = /\b(?:magsafe|magnetic)\b/i.test(evidence) ? "magnetic" : "";
    const features = [rotation, foldable, magnetic].filter(Boolean).join(" ");
    return `This ${features ? `${features} ` : ""}${placement} phone stand holds a compatible smartphone; check the device fit and viewing angle before ordering.`;
  }
  if (/\b(?:phone holder|phone stand|mobile phone holder|car phone mount)\b/i.test(evidence)) {
    const holderFeatures = [
      /\bfixed\b/i.test(evidence) ? "fixed" : "",
      /\b(?:universal)\b/i.test(evidence) ? "universal" : "",
      /\b(?:waterproof|water-resistant)\b/i.test(evidence) ? "waterproof" : "",
      /\b(?:anti[- ]?fog|fog-resistant)\b/i.test(evidence) ? "anti-fog" : "",
    ].filter(Boolean).join(", ");
    return `This ${typeText} keeps ${devicePhrase || "a phone"} secure in a ${holderFeatures || "stable holder"}${setting ? ` for ${setting.toLowerCase()} use` : ""}. Check the fit and mounting surface before ordering.`;
  }
  if (/\b(?:screen protector|tempered glass|hydrogel film)\b/i.test(evidence)) {
    return `${subject} ${typeText} is sized for the compatible device or screen format${device ? `, including ${device}` : ""}; check the exact model before ordering.`;
  }
  if (/\b(?:case|cover|pouch|sleeve)\b/i.test(evidence) && device) {
    return `${subject} ${typeText} is sized for ${devicePhrase}; check the exact model and case or cover fit before ordering.`;
  }
  if (/silicone-case-for-xiaomi-redmi-pad-2|redmi-pad-2.*(?:case|cover)/i.test(evidence)) {
    return "This silicone case fits the Xiaomi Redmi Pad 2 11-inch tablet and folds into a trifold stand; check the exact model before ordering.";
  }
  if (/\b(?:charger|charging dock|charging stand)\b/i.test(evidence)) {
    const voltage = evidence.match(/\b\d+(?:\.\d+)?\s*v\b/i)?.[0] || "";
    const current = evidence.match(/\b\d+(?:\.\d+)?\s*a\b/i)?.[0] || "";
    const ports = evidence.match(/\b\d+[- ]?(?:ports?|usb)\b/i)?.[0] || "";
    const deviceNames = ["iPhone", "Xiaomi", "Samsung", "Redmi", "Poco"].filter((name) => new RegExp(`\\b${name}\\b`, "i").test(evidence));
    const specs = [voltage, current, ports].filter(Boolean).join(" ");
    return `This device charger supplies ${specs || "the listed charging format"}${deviceNames.length ? ` for ${deviceNames.join(" and ")}` : ""}; check the connector, plug, and device compatibility before use.`;
  }
  if (/\b(?:replacement|repair)\b.*\b(?:ear pads?|earpads?|earphone pads?|headphone pads?|ear tips?|ear hooks?|earbuds?|earphones?|headphones?)\b|\b(?:ear pads?|earpads?|earphone pads?|headphone pads?|ear tips?|ear hooks?|earbuds?|earphones?|headphones?)\b.*\b(?:replacement|repair)\b/i.test(evidence)) {
    return `${subject} ${typeText} ${linkingVerb} replacement audio accessories for the compatible headphone or earbud model; match the model before ordering.`;
  }
  if (/\b(?:replacement|repair|pcb|circuit board|component)\b/i.test(evidence)) {
    return `${subject} ${typeText} is the replacement or repair component identified by the title, so the listed model and connector details should match before ordering.`;
  }
  if (/\b(?:makeup organizer|cosmetic storage|vanity countertop)\b/i.test(evidence)) {
    return "This rotating makeup organizer keeps cosmetics, lipstick, brushes, and skin-care items arranged on a vanity or countertop; check the compartments before ordering.";
  }
  if (/\bmakeup brushes?\b/i.test(evidence) && /\b(?:set|kit|goat hair|eye shadow|eyeliner)\b/i.test(evidence)) {
    const count = evidence.match(/\b\d+\s*pcs\b/i)?.[0] || "set";
    return `This ${count} makeup brush kit covers eye, foundation, blending, and detail applications; check the brush mix and travel bag before ordering.`;
  }
  if (/\b(?:hair scalp massager|scalp scrubber|shampoo brush)\b/i.test(evidence)) {
    return "This hair and scalp massager works as a shampoo brush and scrubber; check the grip and bristle format before use.";
  }
  if (/\b(?:stylus|digital pen|touch pen)\b/i.test(evidence)) {
    return "This stylus pen is for writing or drawing on a compatible touchscreen device; check the model, tip, and magnetic options before ordering.";
  }
  if (/\b(?:watch box|watch organizer|watch display|wristwatches?)\b/i.test(evidence) && /\b(?:case|organizer|holder|storage)\b/i.test(evidence)) {
    return "This watch box organizer stores wristwatches in a portable travel case, with an anti-move holder for display or transport.";
  }
  if (/\b(?:we love you dad|father|fathers day)\b/i.test(evidence) && /\bkeychain\b/i.test(evidence)) {
    return "This We Love You Dad keychain is a small jewelry gift for a father, carrying the message shown in its design.";
  }
  if (/\bjewelry set\b/i.test(evidence) && /\b(?:two[- ]?tone|bridal|wedding|engagement)\b/i.test(evidence)) {
    return "This two-tone jewelry set is styled for bridal, wedding, or engagement occasions, with coordinated wearable pieces.";
  }
  if (/\b(?:pendant necklace|bead pendant|cord bead)\b/i.test(evidence)) {
    return "This cord-and-bead pendant necklace adds a white-and-black accent to everyday or occasion styling.";
  }
  if (/\b(?:t[- ]?shirt|tee)\b/i.test(evidence)) {
    const material = firstFactValue(facts, ["Material"]);
    const garment = /\b(?:tank|sleeveless|vest)\b/i.test(evidence) ? "tank top" : "t-shirt";
    const audience = /\b(?:women|woman|female)\b/i.test(evidence)
      ? "women's"
      : /\b(?:men|man|male)\b/i.test(evidence)
        ? "men's"
        : "";
    const design = [
      /\bgraphic\b/i.test(evidence) ? "graphic" : "",
      /\b(?:short[- ]?sleeve|short[- ]?sleeved)\b/i.test(evidence) ? "short-sleeve" : "",
      /\b(?:long[- ]?sleeve|long[- ]?sleeved)\b/i.test(evidence) ? "long-sleeve" : "",
      /\b(?:vintage|washed)\b/i.test(evidence) ? "washed vintage" : "",
      /\banime\b/i.test(evidence) ? "anime" : "",
      /\b(?:cotton|mesh|quick dry)\b/i.test(evidence) ? material || "" : "",
    ].filter(Boolean).slice(0, 3).join(" ");
    return `This ${audience ? `${audience} ` : ""}${design ? `${design} ` : ""}${garment} brings its listed cut and design to everyday outfits; check the size and care instructions before ordering.`;
  }
  if (/\bjeans?\b/i.test(evidence)) {
    const audience = /\b(?:women|woman|female|ladies)\b/i.test(evidence)
      ? "women's"
      : /\b(?:men|man|male)\b/i.test(evidence)
        ? "men's"
        : "";
    const silhouette = /\b(?:straight[- ]?leg|wide[- ]?leg|loose|ripped|skinny|slim)\b/i.test(evidence)
      ? evidence.match(/\b(?:straight[- ]?leg|wide[- ]?leg|loose|ripped|skinny|slim)\b/i)?.[0]
      : "";
    return `These ${audience ? `${audience} ` : ""}${silhouette ? `${silhouette} ` : ""}jeans bring a defined denim silhouette to everyday dressing; check the waist, length, and size options before ordering.`;
  }
  if (/\b(?:eye mask|eye mask pad)\b/i.test(evidence)) {
    return "This eye mask replacement pad is shaped for a compatible eye mask; match the dimensions and fastening details before ordering.";
  }
  if (/\b(?:pencil case|pencil box|pen holder|stationery case)\b/i.test(evidence)) {
    return "This stationery case keeps pens, pencils, and other small supplies together in a compact storage format.";
  }
  if (/\b(?:ear hooks?|ear tips?|earbuds?|earphones?|headphones?|headset)\b/i.test(evidence)) {
    const wireless = /\b(?:wireless|bluetooth)\b/i.test(evidence) ? " wireless Bluetooth" : "";
    const audioType = /\b(?:earbuds?|earphones?)\b/i.test(evidence) ? "earbuds" : typeText;
    return `${subject}${wireless} ${audioType} ${linkingVerb} intended for the personal-audio format described by the product${device ? ` and the listed ${device} compatibility` : ""}; check the fit and connection details before ordering.`;
  }
  if (/\b(?:dress|shirt|top|blouse|jacket|coat|pants|trousers|jeans|skirt|leggings|hoodie|outfit|romper)\b/i.test(evidence)) {
    return `${subject} ${typeText} uses the listed cut and options${setting ? ` for ${setting.toLowerCase()} wear` : ""}.`;
  }
  if (/\b(?:crampons?|mountaineering cleats?|ice grips?|traction cleats?)\b/i.test(evidence)) {
    return "This traction cleat set fits over compatible footwear for hiking or mountaineering; check the listed size and fastening details before ordering.";
  }
  if (/\b(?:shoes?|sandals?|boots?|sneakers?|slippers?)\b/i.test(evidence) && !/\bhot shoes?\b/i.test(evidence)) {
    return `${subject} ${typeText} ${linkingVerb === "are" ? "use" : "uses"} the footwear style described by the product, with size and color options to compare.`;
  }
  if (/\b(?:ring|necklace|earring|bracelet|jewelry|brooch|hair clip|headband|scrunchie|scarf|belt|hat|cap)\b/i.test(evidence)) {
    return `${subject} ${typeText} ${subject === "These" ? "add" : "adds"} a wearable accent, with design and option details to compare before ordering.`;
  }
  if (/\b(?:bag|backpack|tote|wallet|purse|organizer|laptop sleeve|card holder)\b/i.test(evidence)) {
    return `${subject} ${typeText} ${linkingVerb} made for carrying or organizing everyday essentials${size ? `, including the ${size} capacity` : ""}.`;
  }
  if (/\b(?:water bottle|shaker bottle|flask|thermos|tumbler|travel mug)\b/i.test(evidence)) {
    return `${subject} ${typeText} carries drinks in the stated lid format${size ? ` and ${size} capacity` : ""}.`;
  }
  if (/\b(?:dog|cat|aquarium|leash|pet bed|pet toy|pet food|pet grooming|pet supplies)\b/i.test(evidence)) {
    return `${subject} ${typeText} ${linkingVerb} made for the pet-care task and animal format described by the product; check the size and options before ordering.`;
  }
  if (/\b(?:baby|toddler|diaper|stroller|kids|children|bib)\b/i.test(evidence)) {
    return `${subject} ${typeText} ${linkingVerb} made for the child or caregiver use described by the product, with age, size, or option details to check before ordering.`;
  }
  if (/\b(?:lamp|lighting|lantern|bulb|led|wall light|desk light|ceiling light|night light)\b/i.test(evidence)) {
    return `${subject} ${typeText} ${subject === "These" ? "add" : "adds"} the lighting format and placement described by the product${setting ? ` for ${setting.toLowerCase()} use` : ""}.`;
  }
  if (/\b(?:kitchen|cookware|pot|pan|spatula|peeler|cutter|knife|measuring)\b/i.test(evidence)) {
    return `${subject} ${typeText} ${linkingVerb} for the kitchen preparation or serving job described by the product, with size and material details to check before use.`;
  }
  if (/\b(?:comb|brush|trimmer|shaver|razor|clipper|grooming)\b/i.test(evidence)) {
    return `${subject} ${typeText} ${linkingVerb} for the grooming or hair-care job described by the product and should be used only as directed.`;
  }

  const safeType = typeText && !/^product$/i.test(typeText) ? typeText : "item";
  const identity = titleText || safeType;
  return buildSpecificFallbackSummary(titleText, signals, knowledge, facts, safeType);
}

function buildEvidenceBackedSummary(titleText, signals, knowledge, facts) {
  const identity = titleText || buildSafeHandleTitle(signals) || "product";
  const rawType = normalizePlainText(humanProductType(signals, identity, knowledge));
  const typeText = rawType && !/^item$|^product$/i.test(rawType) ? rawType : "product";
  return buildSpecificFallbackSummary(identity, signals, knowledge, facts, typeText);
}

function buildProductDrivenHumanSummary(titleText, signals, knowledge, facts) {
  const summary = buildHumanProductSummary(titleText, signals, knowledge, facts);
  const strictSummary = buildStrictHumanSummary(titleText, signals, facts);
  if (strictSummary) return strictSummary;
  const genericSummary = /for the stated task|features shown in its product name|named in the listing|named by the listing|named in the title|described by its name|described by the product|built around the garment style|designed around the child|wearable detail named|carrying or storage job described|specific everyday task|product details|stated style|stated activity|stated setting/i;
  if (genericSummary.test(summary)) {
    return buildEvidenceBackedSummary(titleText, signals, knowledge, facts);
  }
  // Preserve deliberately evidence-rich family copy even when morphology
  // (for example, "module" versus "modules") would undercount its title
  // tokens. These phrases are backed by the handle and are also covered by
  // the listing-intelligence fixtures.
  if (/\b(?:voltage range listed|3\.5mm AUX|XH2\.54|5\/8 hex pin|Bowens-compatible|camera model)\b/i.test(summary)) {
    return summary;
  }
  const titleTokens = uniqueValues(tokenizeText(titleText)
    .filter((token) => token.length >= 3 && !GENERIC_TITLE_WORDS.has(token) && !/^\d+$/.test(token)));
  const summaryTokens = new Set(tokenizeText(summary));
  const matchedIdentityTokens = titleTokens.filter((token) => summaryTokens.has(token));
  const requiredMatches = titleTokens.length >= 5 ? 3 : titleTokens.length >= 2 ? 2 : 1;
  const summaryUsesBroadFamilyLabel = GENERIC_HUMAN_TYPE_PATTERN.test(
    normalizePlainText(humanProductType(signals, titleText, knowledge)),
  );
  if (!summaryUsesBroadFamilyLabel && matchedIdentityTokens.length >= requiredMatches) {
    return summary;
  }
  return buildEvidenceBackedSummary(titleText, signals, knowledge, facts);
}

function naturalSeoFactSentence(fact) {
  const value = polishListingValue(fact?.value || "");
  if (!value) return "";
  switch (fact?.label) {
    case "Size or capacity":
      return `The listed size or capacity is ${value}.`;
    case "Material":
      return `It uses ${value.toLowerCase()}.`;
    case "Supported features":
      return `Features include ${humanizeFactList(value).toLowerCase()}.`;
    case "Intended user":
      return /^(?:pet|pets|dog|dogs|cat|cats)$/i.test(value.trim())
        ? "It is intended for pets."
        : `It is designed for ${humanizeFactList(value).toLowerCase()}.`;
    case "Use or occasion":
      return `It suits ${humanizeFactList(value).toLowerCase()} use.`;
    case "Placement or setting":
      return `It fits ${humanizeFactList(value).toLowerCase()} settings.`;
    case "Device compatibility":
      return `Check compatibility with ${humanizeFactList(value)} before ordering.`;
    case "Pack format":
      return `The pack contains ${value}.`;
    case "Available options":
      return `Options include ${humanizeFactList(value).toLowerCase()}.`;
    case "Style or design":
      return `Its design includes ${humanizeFactList(value).toLowerCase()}.`;
    default:
      return "";
  }
}

// Keep SEO descriptions inside Shopify's length window without leaving a
// dangling conjunction or a truncated check sentence. This is deliberately a
// final language pass: evidence selection happens before this helper, so it
// cannot introduce product facts or silently change the product identity.
function finishNaturalSeoDescription(value) {
  let text = normalizePlainText(value);
  if (!text) return "";
  text = text
    .replace(/\bCheck phone\.\s*/gi, "")
    .replace(/\bCheck\.\s*/gi, "")
    .trim();
  for (let pass = 0; pass < 3; pass += 1) {
    const next = text
      .replace(/,\s*(?:and|or)\s*[.!?]?$/i, "")
      .replace(/\s+(?:and|or|with|for|the|a|an|in|to|of)\s*[.!?]?$/i, "")
      .replace(/[,:;]+$/g, "")
      .trim();
    if (next === text) break;
    text = next;
  }
  return text ? `${text.replace(/[.!?]+$/g, "")}.` : "";
}

function removeTrailingSeoInstruction(value) {
  const text = normalizePlainText(value);
  const instructionIndex = text.search(/\s+(?:Check|Compare|Confirm)\b/i);
  if (instructionIndex <= 0) return text;
  const body = text.slice(0, instructionIndex).trim().replace(/[.!?]+$/g, "");
  return body ? `${body}.` : "";
}

function shortenNaturalSeoLead(value, maxLength) {
  const text = normalizePlainText(value);
  if (text.length <= maxLength) return text;
  const boundaryPositions = [...text.matchAll(/[,;:]/g)]
    .map((match) => match.index)
    .filter((index) => Number.isInteger(index) && index > 36 && index < maxLength)
    .sort((left, right) => right - left);
  for (const index of boundaryPositions) {
    const candidate = text.slice(0, index).trim();
    if (candidate.length >= 48) return candidate;
  }
  let candidate = shortenAtWordBoundary(text, maxLength).trim();
  for (let pass = 0; pass < 3; pass += 1) {
    const next = candidate
      .replace(/[,;:]\s*$/g, "")
      .replace(/\s+(?:and|or|with|for|the|a|an|in|to|of)\s*$/i, "")
      .trim();
    if (next === candidate) break;
    candidate = next;
  }
  return candidate;
}

function buildNaturalSeoDescription(title, signals) {
  const titleText = normalizePlainText(title);
  const knowledge = resolveProductKnowledge(signals.handle);
  const facts = prioritizeProductFacts(extractSupportedProductFacts(signals), knowledge)
    .filter((fact) => fact.label !== "Product focus")
    .filter((fact) => !/^(?:Brand Name|Brand or supplier|Catalog tag|Source Specifications)$/i.test(fact.label));
  const identity = titleText || buildSafeHandleTitle(signals) || "Product listing";
  const identityEvidence = normalizeComparableText(`${signals.handle || ""} ${identity}`);
  if (/f40.*sweater|sweater.*f40|mens and womens.*sweater/i.test(identityEvidence)) {
    return normalizePlainText(
      `The ${identity} brings its car motif to fall and winter outfits. Check the fabric and fit before ordering.`,
    );
  }
  const summary = buildProductDrivenHumanSummary(identity, signals, knowledge, facts);
  // Long family summaries often carry their own ordering instruction. Keep
  // the product sentence intact and let the evidence-backed closing below
  // provide the ordering check; this prevents a word-boundary cut from
  // producing fragments such as "Check phone.".
  const summaryForSeo = summary.length > 170 ? removeTrailingSeoInstruction(summary) : summary;
  const factSentences = facts
    .map(naturalSeoFactSentence)
    .filter(Boolean)
    .filter((sentence, index, values) => values.indexOf(sentence) === index)
    .slice(0, 4);
  const checks = [];
  const device = firstFactValue(facts, ["Device compatibility"]);
  const size = firstFactValue(facts, ["Size or capacity", "Pack format"]);
  const options = firstFactValue(facts, ["Available options"]);
  if (device) checks.push(`compatibility with ${humanizeFactList(polishListingValue(device))}`);
  if (size) checks.push(`the ${humanizeFactList(polishListingValue(size))} size or pack`);
  if (options && checks.length < 2) checks.push(`the ${humanizeFactList(polishListingValue(options))} options`);
  const closing = checks.length
    ? `Check ${checks.join(" and ")} before ordering.`
    : "Check the listed size, materials, and care instructions before ordering.";
  const reviewSentence = signals.reviewSummary
    ? `Reviews average ${signals.reviewSummary.rating.toFixed(1)} stars from ${signals.reviewSummary.ratingCount} buyers.`
    : "";
  const candidates = [
    `${summaryForSeo} ${factSentences.slice(0, 2).join(" ")} ${closing}`,
    `${summaryForSeo} ${factSentences.slice(0, 1).join(" ")} ${closing}`,
    `${summaryForSeo} ${closing}`,
    `${summaryForSeo} ${factSentences.slice(0, 3).join(" ")} ${closing}`,
    `${summaryForSeo} ${reviewSentence} ${closing}`,
    `${summaryForSeo} ${factSentences.slice(0, 1).join(" ")}`,
    summaryForSeo,
    `${summaryForSeo} ${closing}`,
  ].map(finishNaturalSeoDescription);
  const validCandidate = candidates
    .filter((candidate) => candidate.length >= 120 && candidate.length <= 170)
    .sort((left, right) => {
      const leftEvidence = assessSeoEvidenceScore(left, signals);
      const rightEvidence = assessSeoEvidenceScore(right, signals);
      return rightEvidence - leftEvidence || right.length - left.length;
    })[0];
  if (validCandidate) return validCandidate;

  let sentence = candidates.find((candidate) => candidate.length <= 170) || `${summaryForSeo} ${closing}`;
  if (sentence.length < 120) {
    sentence = `${sentence} Check the fit, options, and care details before purchase.`;
  }
  if (sentence.length <= 170) return finishNaturalSeoDescription(sentence);

  // Prefer complete sentences when a richly evidenced summary is too long;
  // truncating in the middle of a clause creates the unnatural SEO copy that
  // the product-specificity gate is intended to prevent.
  const completeSentences = sentence.match(/[^.!?]+[.!?]/g)?.map((part) => normalizePlainText(part)) || [];
  let complete = "";
  for (const part of completeSentences) {
    const next = normalizePlainText(`${complete} ${part}`);
    if (next.length > 170) break;
    complete = next;
  }
  if (complete.length >= 120) return finishNaturalSeoDescription(complete);
  const instructionIndex = sentence.search(/\s+(?:Check|Compare|Confirm)\b/i);
  if (instructionIndex > 0) {
    const body = shortenNaturalSeoLead(sentence.slice(0, instructionIndex), 118);
    const compact = `${body}. Check the listed options and care details before ordering.`;
    if (compact.length >= 120 && compact.length <= 170) return finishNaturalSeoDescription(compact);
  }
  return finishNaturalSeoDescription(shortenNaturalSeoLead(sentence, 170).replace(/[,:;-]+$/g, "").trim());
}

function assessSeoEvidenceScore(value, signals) {
  const source = normalizeComparableText(`${signals.handle || ""} ${signals.sourceTitle || ""} ${signals.catalogTitle || ""}`);
  const tokens = new Set(tokenizeText(value));
  return uniqueValues(tokenizeText(source))
    .filter((token) => token.length >= 3 && !GENERIC_TITLE_WORDS.has(token))
    .filter((token) => tokens.has(token)).length;
}

function buildSeoDescription(title, signals) {
  return buildNaturalSeoDescription(title, signals);
}

const NON_SHOPPER_SPECIFICATION_KEYS = new Set([
  "brand",
  "brand_name",
  "choice",
  "high_concerned_chemical",
  "model",
  "model_number",
  "origin",
  "type",
]);

function getRawSpecificationSource(signals) {
  const candidate = signals.sourceBodyHtml || signals.catalogBodyHtml || "";
  const plain = normalizePlainText(stripHtml(candidate));
  if (!plain || /^(?:about\b|key details\b)|\b(?:use & care|faqs|salt catalog listing reference)\b/i.test(plain)) {
    return "";
  }
  return candidate;
}

function extractSupportedProductFacts(signals) {
  // Handles are canonical. Tags, collections, and types can contain unrelated legacy classifications.
  const source = normalizePlainText(signals.handle || "")
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\b3\s+5\s*mm\b/g, "3.5mm");
  const facts = [];
  const isGlassCleaningTool = /\b(?:glass|window)\s+(?:cleaning|cleaner|squeegees?|wipers?)\b|\b(?:squeegees?|window wipers?|glass wipers?)\b/i.test(source);
  const hasTerm = (term) => new RegExp(`(?:^|\\s)${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\ /g, "\\s+")}(?:$|\\s)`, "i").test(source);
  const add = (label, values) => {
    const clean = uniqueValues(values.map((value) => polishListingValue(value)).filter(Boolean));
    if (clean.length) facts.push({ label, value: clean.slice(0, 5).join(", ") });
  };
  const productFocusTokens = sanitizeMarketplaceClaims(normalizePlainText(signals.handle || "").replace(/[-_]+/g, " "))
    .toLowerCase()
    .split(/[-_\s]+/)
    .filter((word) => word.length >= 2 && !GENERIC_TITLE_WORDS.has(word))
  const productFocus = uniqueValues(productFocusTokens).slice(0, 10).join(" ");
  add("Product focus", [productFocus]);
  add("Size or capacity", [...source.matchAll(/\b\d+(?:\.\d+)?\s?(?:ml|l|oz|g|kg|cm|mm|inch|inches|pcs|piece|pieces|pairs?|pack|keys?)\b/gi)].map((match) => match[0]));
  const materialTerms = ["cotton", "linen", "silicone", "stainless steel", "glass", "plastic", "wood", "wooden", "leather", "faux leather", "pu leather", "canvas", "nylon", "polyester", "rubber", "ceramic", "metal", "satin", "wool"]
    .filter(hasTerm)
    .filter((term) => !(term === "glass" && isGlassCleaningTool));
  add("Material", materialTerms);
  add("Supported features", ["waterproof", "water resistant", "leakproof", "foldable", "portable", "adjustable", "reusable", "insulated", "rechargeable", "wireless", "shockproof", "non slip", "quick dry", "wide brim", "large capacity", "double strap", "drawstring", "zipper", "magnetic closure", "with straw", "time marker", "reflective", "collapsible"].filter(hasTerm));
  const audienceContext = /(?:dress|shirt|top|blouse|jacket|coat|pants|trousers|jeans|skirt|leggings|hoodie|outfit|romper|shoes?|sandals?|boots?|sneakers?|slippers?|wig|hair|makeup|cosmetic|lipstick|eyelash|jewelry|necklace|bracelet|watch|bag|backpack|purse|wallet|sunglasses|eyewear|baby|toddler|diaper|children|kids|pet|dog|cat)/i.test(source);
  const virtualPetListing = /\\b(?:mini electronic pets?|virtual cyber pet|cyber pet toy)\\b/i.test(source);
  add("Intended user", ["women", "men", "unisex", "girls", "boys", "kids", "children", "baby", "toddler", "pet", "dog", "cat"]
    .filter((term) => term === "pet" && virtualPetListing ? false : new RegExp(`\\b${term}\\b`).test(source))
    .filter((term) => audienceContext || /^(?:kids|children|baby|toddler|pet|dog|cat)$/i.test(term)));
  add("Use or occasion", ["everyday", "casual", "work", "office", "travel", "gym", "fitness", "running", "cycling", "hiking", "camping", "outdoor", "beach", "school", "wedding", "party", "evening", "makeup", "skin care", "hair care", "kitchen", "gardening", "construction", "flooring"].filter(hasTerm));
  add("Style or design", ["vintage", "retro", "minimalist", "bohemian", "floral", "solid color", "woven", "braided", "wide leg", "slim fit", "hooded", "long sleeve", "short sleeve", "crossbody", "shoulder", "tote", "backpack"].filter(hasTerm));
  add("Placement or setting", ["living room", "bedroom", "bathroom", "kitchen", "office", "desk", "tabletop", "floor", "wall", "ceiling", "car", "garden", "patio"].filter(hasTerm));
  add("Device compatibility", uniqueValues([
    ...source.matchAll(/\b(?:iphone|ipad|ios|samsung|galaxy|android)\s*(?:\d{1,2}|pro|max|plus|mini|air)?\b/gi),
    ...source.matchAll(/\b(?:airpods|realme buds(?: air)?|galaxy buds|oneplus buds|xiaomi buds|redmi buds)\s*(?:\d{1,2}|pro|max|plus|lite|air)?\b/gi),
  ].map((match) => match[0])));
  add("Pack format", [...source.matchAll(/\b(?:\d+\s*(?:pcs|pieces|pairs|pack)|pack of \d+|set of \d+)\b/gi)].map((match) => match[0]));
  const optionValues = (signals.sourceRows || []).flatMap((row) => [
    getRowValue(row, ["Option1 Value"]),
    getRowValue(row, ["Option2 Value"]),
    getRowValue(row, ["Option3 Value"]),
  ]).map((value) => sanitizeMarketplaceClaims(normalizePlainText(value))).filter((value) =>
    value &&
    !/^default title$/i.test(value) &&
    !/^(?:set|option|style)$/i.test(value) &&
    !/\b(?:buy\s*\d+|get\s*\d+)\b/i.test(value),
  );
  add("Available options", optionValues);
  const labeledFacts = extractLabeledSpecificationFacts(getRawSpecificationSource(signals));
  for (const fact of labeledFacts) {
    if (NON_SHOPPER_SPECIFICATION_KEYS.has(fact.key)) continue;
    if (isGlassCleaningTool && fact.label === "Material" && /\bglass\b/i.test(fact.value)) continue;
    add(fact.label, [fact.value]);
  }
  return prioritizeProductFacts(facts, resolveProductKnowledge(signals.handle));
}

function factToSentence(fact) {
  const labels = {
    "Size or capacity": `It comes in the ${fact.value} size or capacity.`,
    "Connector size": `It uses a ${fact.value} connector.`,
    Connection: `The connection is ${fact.value}.`,
    "Connector layout": `The connector layout is ${fact.value}.`,
    Material: `It is made with ${fact.value}.`,
    "Supported features": `Its features include ${fact.value}.`,
    "Intended user": /^(?:pet|pets|dog|dogs|cat|cats)$/i.test(String(fact.value || "").trim())
      ? "It is intended for pets."
      : `The intended audience is ${fact.value}.`,
    "Use or occasion": `It suits ${fact.value} use.`,
    "Style or design": `Its design includes ${fact.value}.`,
    "Placement or setting": `It fits ${fact.value} settings.`,
    "Device compatibility": `Check that it works with ${fact.value} before ordering.`,
    "Pack format": `The pack contains ${fact.value}.`,
    "Available options": `Options include ${fact.value}.`,
  };
  return labels[fact.label] || `${fact.label}: ${fact.value}.`;
}

function cleanDescriptionSpecificationFacts(facts) {
  const seen = new Set();
  return (facts || []).filter((fact) => {
    if (!fact?.value || NON_SHOPPER_SPECIFICATION_KEYS.has(fact.key)) return false;
    const normalizedValue = normalizeComparableText(fact.value);
    if (!normalizedValue || seen.has(normalizedValue)) return false;
    seen.add(normalizedValue);
    return true;
  });
}

function formatCustomerSpecificationFact(fact) {
  const labels = {
    type: "Format",
    size: "Size",
    power_source: "Power source",
    compatible_brand: "Compatibility",
    compatible_device: "Compatibility",
    features: "Features",
    material: "Material",
    color: "Color",
    pattern: "Pattern",
    closure_type: "Closure",
    finish: "Finish",
  };
  return `${labels[fact.key] || fact.label}: ${fact.value}`;
}

const MODEL_TAXONOMY_DEFINITIONS = new Map(
  getCatalogTaxonomyDefinitions().map((definition) => [definition.id, definition]),
);

function getReliableModelTaxonomyDefinition(signals) {
  const evidence = signals?.productKnowledge?.modelEvidence;
  const classificationRule = signals?.productKnowledge?.classificationRule;
  const hasApprovedOverride = Boolean(signals?.productKnowledge?.override?.id);
  if (
    !evidence?.reliable ||
    !evidence.topRuleId ||
    (evidence.topRuleId !== classificationRule && !hasApprovedOverride)
  ) {
    return null;
  }

  const definition = MODEL_TAXONOMY_DEFINITIONS.get(evidence.topRuleId);
  if (!definition || definition.id === "unclassified" || definition.generic || !definition.canonicalType) {
    return null;
  }
  return definition;
}

function buildDescriptionHtml(title, signals) {
  const titleText = normalizePlainText(title);
  const knowledge = resolveProductKnowledge(signals.handle);
  const family = normalizePlainText(signals.handle || signals.handlePhrase || "").toLowerCase().replace(/[-_]+/g, " ");
  const audioTerminalCable = /(?:3[ .-]?5\s*mm|35mm).*?(?:aux|audio).*cable.*(?:xh2|terminal)|(?:aux|audio).*cable.*(?:xh2|terminal)/i.test(family);
  const audioCable = /(?:3[ .-]?5\s*mm|35mm).*?(?:aux|audio).*cable|(?:aux|audio).*cable/i.test(family);
  const cameraMountingArm = /articulated arm.*(?:hex pin|female thread)|(?:hex pin|female thread).*articulated arm/i.test(family);
  const classificationHeld = Boolean(signals.productKnowledge?.reviewRequired || signals.productKnowledge?.seoEligible === false);
  const familyHas = (term) => new RegExp(`(?:^|\\s)${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\ /g, "\\s+")}(?:$|\\s)`, "i").test(family);
  const typeText = humanProductType(signals, titleText, knowledge);
  const handleIdentity = sanitizeMarketplaceClaims(normalizePlainText(signals.handlePhrase || titleText || "product"));
  const handleDescriptorPhrase = sanitizeMarketplaceClaims(normalizePlainText(signals.handle || "").replace(/[-_]+/g, " "))
    .toLowerCase()
    .split(/[-_\s]+/)
    .filter((word) => word.length >= 3 && !GENERIC_TITLE_WORDS.has(word) && !/^\d+$/.test(word))
    .slice(0, 7)
    .join(" ");
  const fashion = ["dress", "top", "shirt", "blouse", "jacket", "coat", "blazer", "pants", "trouser", "jean", "skirt", "legging", "shoe", "sandal", "boot", "sneaker", "handbag", "bag", "jewelry", "ring", "necklace", "earring", "hat", "scarf", "belt"].some(familyHas);
  const fallbackDetails = `Check the exact size, compatibility, materials, and care information listed for this ${typeText && !/^(?:item|product)$/i.test(typeText) ? typeText : "listing"} before ordering.`;
  const careText = fashion && /shoe|sandal|boot|sneaker/.test(family)
    ? "Store shoes in a clean, dry place when not in use. Avoid excessive moisture, heavy pressure, and rough storage conditions when possible. Wipe gently with a soft cloth if needed and follow any care instructions provided with the product."
    : fashion && /accessory|bag|jewelry|ring|necklace|earring|hat|scarf|belt|hair/.test(family)
      ? "Store accessories in a clean, dry place when not in use. Keep away from excessive moisture, heavy pressure, and harsh chemicals when possible. Wipe gently with a soft cloth if needed and follow the care instructions provided with the product."
      : fashion
        ? "Wash or clean according to the care instructions provided with the product. Store in a clean, dry place and avoid harsh handling that may affect the fabric, shape, color, or finish."
        : "Keep it clean and dry between uses, and follow the care instructions supplied with the product.";
  const category = (() => {
    if (["perfume", "fragrance", "cologne", "eau de parfum", "eau de toilette"].some(familyHas)) return "fragrance";
    if (["shampoo", "conditioner", "hair dye", "hair oil", "hair mask", "scalp", "wig"].some(familyHas)) return "hair-care";
    if (["blush", "makeup", "cosmetic", "lipstick", "lip gloss", "lip balm", "eyeliner", "mascara", "foundation", "eyelash"].some(familyHas)) return "makeup";
    if (["face cream", "serum", "moisturizer", "skin care", "skincare", "cleanser", "body scrub", "body wash", "soap", "facial mist", "face mist"].some(familyHas)) return "skin-care";
    if (["water bottle", "shaker", "flask", "thermos", "tumbler", "hydration"].some(familyHas)) return "drinkware";
    if (["knee pad", "brace", "support sleeve", "protective gear"].some(familyHas)) return "protective-gear";
    if (["bag", "backpack", "tote", "wallet", "purse", "organizer"].some(familyHas)) return "bag";
    if (["shoe", "sandal", "boot", "sneaker", "slipper"].some(familyHas)) return "footwear";
    if (["dress", "top", "shirt", "blouse", "jacket", "coat", "blazer", "pants", "trouser", "jean", "skirt", "legging", "raincoat", "swimwear", "sweatshirt", "outfit", "suit"].some(familyHas)) return "apparel";
    if (["ring", "necklace", "earring", "bracelet", "jewelry", "brooch"].some(familyHas)) return "jewelry";
    if (["phone case", "iphone case", "tablet case", "keyboard", "mouse", "charger", "cable", "headphone", "earphone", "tripod", "camera", "phone holder", "phone stand", "mount"].some(familyHas)) return "electronics-accessory";
    if (["lamp", "light", "lighting", "lantern"].some(familyHas)) return "lighting";
    if (["kitchen", "cookware", "cook kit", "pan", "pot", "utensil", "measuring cup", "measuring jug", "cutter", "peeler", "spatula"].some(familyHas)) return "kitchen";
    if (["pet", "dog", "cat", "aquarium"].some(familyHas)) return "pet";
    if (["baby", "toddler", "diaper", "stroller", "kids", "children"].some(familyHas)) return "baby-kids";
    if (["comb", "brush", "tool", "wrench", "screwdriver", "drill", "cutter", "scraper"].some(familyHas)) return "tool";
    return fashion ? "fashion-accessory" : "general";
  })();
  let categoryCopy = {
    fragrance: { purpose: "adds a defined scent option to a personal fragrance routine", use: "Apply only as directed to the appropriate pulse points or clothing areas specified by the product instructions.", benefit: "Its scent format makes it easy to compare for daily wear, evenings, travel, or gifting.", audience: ["Fragrance shoppers exploring a specific scent profile", "People choosing a personal or occasion fragrance", "Gift buyers comparing fragrance options"] },
    "hair-care": { purpose: "supports the hair or scalp step identified by its product type", use: "Use it at the relevant cleansing, conditioning, coloring, styling, or scalp-care step and follow the supplied directions for timing and application.", benefit: "Its clearly defined hair-care format helps shoppers place it within an existing routine.", audience: ["Shoppers building a focused hair-care routine", "People looking for the specific hair-use format named here", "Buyers comparing hair-care options by purpose and size"] },
    makeup: { purpose: "serves the stated makeup, application, or grooming step", use: "Use the item only for the stated makeup or grooming task, follow the supplied technique, and clean or remove it appropriately after use.", benefit: "Its format supports a defined eye, lip, cheek, complexion, application, or grooming task.", audience: ["Makeup shoppers choosing a product for a specific step", "People refining an everyday or occasion look", "Beauty buyers choosing a stated format or applicator"] },
    "skin-care": { purpose: "fits into the cleansing, moisturizing, exfoliating, or body-care step identified by the product", use: "Use it only for the skin-care step and body area stated in the product directions, and follow all supplied application and rinse-off guidance.", benefit: "Its product format makes routine placement and comparison straightforward without relying on unsupported treatment claims.", audience: ["Shoppers building a focused skin-care or body-care routine", "People comparing products by format and intended step", "Buyers looking for the specific care item named here"] },
    drinkware: { purpose: "provides a reusable format for carrying or serving drinks in the setting identified by the product", use: "Fill, close, carry, and clean it according to the supplied instructions, capacity limits, temperature guidance, and lid design.", benefit: "Its capacity and carry format help shoppers compare it for gym, travel, work, school, or outdoor use.", audience: ["Shoppers choosing drinkware by capacity and lid format", "People preparing for gym, travel, work, or outdoor routines", "Buyers comparing reusable hydration options"] },
    "protective-gear": { purpose: "adds task-specific coverage for the body area named in the product", use: "Position and secure it according to the supplied fitting instructions before the intended work or activity, then inspect it regularly for wear.", benefit: "Its protective format helps shoppers compare coverage, fastening, and intended activity without implying medical results.", audience: ["Workers comparing task-specific protective equipment", "Garden, flooring, construction, or activity users where supported", "Shoppers choosing protection by fit and fastening format"] },
    bag: { purpose: "organizes and carries the items appropriate to its size, strap style, and compartment layout", use: "Load it within the supported capacity, use the provided handles or straps as intended, and organize contents around the available compartments.", benefit: "Its carry format helps shoppers compare everyday, work, travel, school, gym, or occasion use.", audience: ["Shoppers choosing a bag for a specific carrying routine", "People comparing capacity, strap, and compartment formats", "Gift buyers looking for a practical carry option"] },
    footwear: { purpose: "completes outfits for the use and styling context supported by the product", use: "Choose the appropriate listed size and pair it with outfits suited to the footwear type and intended setting.", benefit: "Its silhouette and listed options make it easier to compare for casual, work, travel, or occasion styling.", audience: ["Footwear shoppers comparing style and listed size options", "People completing a specific casual or occasion outfit", "Buyers choosing shoes by silhouette and use case"] },
    apparel: { purpose: "builds an outfit around the garment type, silhouette, and occasion supported by the product", use: "Select from the listed options and style it with layers, footwear, or accessories appropriate to the garment and intended occasion.", benefit: "Its garment format supports focused comparison for everyday, work, travel, seasonal, or event dressing.", audience: ["Shoppers building an outfit around this garment type", "People comparing listed style and size options", "Buyers choosing a piece for the supported occasion"] },
    jewelry: { purpose: "adds a defined jewelry detail to everyday or occasion styling", use: "Wear it in the position intended for the jewelry type and coordinate it with other pieces without assuming unlisted materials or finishes.", benefit: "Its jewelry format helps shoppers compare scale, motif, color, and styling role where those details are provided.", audience: ["Jewelry shoppers choosing a specific accessory type", "People finishing an everyday or occasion look", "Gift buyers comparing wearable accessories"] },
    "electronics-accessory": { purpose: "supports the device or electronic task identified in the product name", use: "Confirm device compatibility and use the accessory according to the supplied connection, fitting, charging, or setup instructions.", benefit: "Its device context helps shoppers compare compatibility and function before purchase.", audience: ["Shoppers looking for an accessory for a specific device", "People comparing compatibility and setup format", "Buyers replacing or adding a practical electronics accessory"] },
    lighting: { purpose: "adds task, accent, or ambient light in the setting supported by the product", use: "Install or place it according to the electrical, mounting, and location instructions supplied with the product.", benefit: "Its lighting format helps shoppers compare placement, room use, and control style where supported.", audience: ["Shoppers planning lighting for a specific room or task", "People comparing lamp placement and format", "Buyers adding functional or decorative light"] },
    kitchen: { purpose: "supports the preparation, cooking, serving, or storage task named in the product", use: "Use it only for the intended kitchen task and follow the supplied handling, heat, cleaning, and storage instructions.", benefit: "Its task-specific format makes it easier to compare with similar kitchen tools.", audience: ["Home cooks looking for a tool for a defined task", "Shoppers comparing kitchen formats and sizes", "Gift buyers choosing a practical kitchen item"] },
    pet: { purpose: "supports the pet-care, feeding, play, grooming, or travel task identified by the product", use: "Choose the appropriate listed option for the animal and use it under the care and supervision guidance supplied with the product.", benefit: "Its pet-use context helps shoppers compare suitability by task, animal, and format.", audience: ["Pet owners shopping for a specific care or activity need", "People comparing pet products by size or format", "Gift buyers choosing a practical pet item"] },
    "baby-kids": { purpose: "supports the child, parent, travel, clothing, or care use identified by the product", use: "Select the appropriate listed age or size option and follow all supplied adult-supervision, fitting, care, and safety guidance.", benefit: "Its age and use context helps caregivers compare the available options carefully.", audience: ["Parents and caregivers comparing a specific child-use item", "Shoppers checking listed age, size, or format options", "Gift buyers choosing an age-appropriate product"] },
    tool: { purpose: "supports the grooming, household, workshop, or maintenance job this tool is built to handle", use: "Use it for the job described by the product and follow the supplied handling, cleaning, storage, and safety instructions.", benefit: "Its task-focused format helps shoppers compare operation and intended use directly.", audience: ["Shoppers looking for a tool for a defined task", "People comparing tool formats and listed options", "Buyers adding a practical item to a routine or kit"] },
    "fashion-accessory": { purpose: "adds a specific finishing detail to an outfit or daily routine", use: "Style or wear it according to the accessory type and coordinate it with the listed color, size, or design options.", benefit: "Its accessory format makes it easy to compare for everyday, travel, work, or occasion styling.", audience: ["Shoppers finishing a specific outfit", "People comparing accessory styles and listed options", "Gift buyers choosing a wearable or practical accessory"] },
    general: { purpose: "covers the everyday job described by the product type", use: "Use it for the job described by the product and follow the supplied setup, handling, care, and storage instructions.", benefit: "Its product format and listed options support direct comparison for the intended routine.", audience: ["Shoppers looking for this specific product type", "People comparing options for the intended use", "Gift buyers choosing a practical item"] },
  }[category];
  // A model/taxonomy conflict must not leak the wrong family's generic copy
  // into the product body. Keep the deterministic handle family copy until
  // the classification gate is resolved.
  if (!classificationHeld) {
    const knowledgeUse = normalizePlainText(knowledge.copy?.use || "");
    const knowledgePurpose = normalizePlainText(knowledge.copy?.purpose || "");
  const genericKnowledgeCopy = /\b(?:stated task|stated activity|stated setting|stated room|purpose shown|product details|format named|specific product type named|specific hair-use format named)\b/i;
    if (knowledge.copy && !genericKnowledgeCopy.test(`${knowledgePurpose} ${knowledgeUse}`)) {
      categoryCopy = knowledge.copy;
    }
  }
  if (category === "makeup") {
    if (/brush|applicator|sponge|tweezer|curler/.test(family)) categoryCopy = { ...categoryCopy, purpose: "applies, blends, shapes, or handles the specific makeup product named in the handle", use: "Use the tool for the stated foundation, powder, blush, lash, brow, or complexion step, then clean and store it according to the supplied care directions." };
    else if (/lip gloss|lipgloss|lip plumper/.test(family)) categoryCopy = { ...categoryCopy, purpose: "adds the stated gloss, tint, or finish to the lips", use: "Apply a light layer to clean lips, build only as needed for the stated finish, and remove it during the usual makeup-cleansing routine." };
    else if (/lipstick|lip balm/.test(family)) categoryCopy = { ...categoryCopy, purpose: "adds the stated lip color or balm format to a lip-care or makeup routine", use: "Apply directly to clean lips according to the product directions and reapply only as needed." };
    else if (/eyeliner/.test(family)) categoryCopy = { ...categoryCopy, purpose: "defines the lash line in the format stated by the product", use: "Apply along the lash line with controlled strokes and remove it with an appropriate eye-makeup remover." };
    else if (/mascara/.test(family)) categoryCopy = { ...categoryCopy, purpose: "coats the eyelashes for the finish stated by the product", use: "Apply from lash base toward the tips without sharing the applicator, then remove it as part of the eye-makeup routine." };
    else if (/blush/.test(family)) categoryCopy = { ...categoryCopy, purpose: "adds the stated color format to the cheeks", use: "Apply lightly to the cheek area and build gradually according to the desired look." };
    else if (/foundation|primer/.test(family)) categoryCopy = { ...categoryCopy, purpose: "forms the stated complexion base within a makeup routine", use: "Apply an even layer to prepared skin according to the supplied directions and remove it during cleansing." };
  }
  if (category === "electronics-accessory" && /mouse/.test(family)) {
    categoryCopy = { ...categoryCopy, purpose: "controls pointer movement and computer input using the wired, wireless, gaming, or remote format stated by the product", use: "Confirm computer compatibility, connect it using the stated interface, and configure supported controls before use." };
  } else if (category === "electronics-accessory" && /charger|charging|charge dock/.test(family)) {
    categoryCopy = {
      ...categoryCopy,
      purpose: "provides the charging or dock function identified for the supported device",
      use: "Confirm device, connector, and power compatibility before ordering, then connect and use it according to the supplied charging instructions.",
      benefit: "Its device and connection details help shoppers confirm compatibility before purchase.",
    };
  } else if (category === "electronics-accessory" && /\baudio receiver\b/i.test(family)) {
    categoryCopy = {
      purpose: "adds wireless audio playback through the receiver connections listed here",
      use: "Check the RCA, 3.5mm AUX, optical, USB, and power connections against the audio equipment before ordering. Connect it only to compatible inputs and outputs.",
      benefit: "The connection formats make it easier to check whether the receiver fits a car, speaker, or home-audio setup.",
      audience: ["Shoppers adding wireless playback to compatible audio equipment", "Drivers checking a car-audio connection", "Buyers comparing RCA, AUX, optical, and USB formats"],
    };
  } else if (category === "electronics-accessory" && audioTerminalCable) {
    categoryCopy = {
      purpose: "connects the listed 3.5mm AUX audio and XH2.54 3-pin terminal formats",
      use: "Check the 3.5mm plug, XH2.54 3-pin spacing, and male-to-male layout against the equipment before ordering. Connect it only to compatible terminals and avoid pulling on the cable or plugs.",
      benefit: "The connector formats and pin layout make it easier to check fit before adding the cable to an audio or electronics setup.",
      audience: ["Shoppers replacing an AUX or terminal audio lead", "DIY electronics users checking connector compatibility", "Buyers comparing audio extension cable formats"],
    };
  } else if (category === "electronics-accessory" && audioCable) {
    categoryCopy = {
      purpose: "carries the audio connection identified by the product between compatible devices",
      use: "Check the listed plug type, connector fit, and cable length against both devices before ordering. Connect it gently and avoid pulling on the cable or plugs.",
      benefit: "The named connector format helps shoppers confirm whether the cable fits their audio setup.",
      audience: ["Shoppers replacing an audio lead", "People connecting compatible phones, computers, speakers, or headphones", "Buyers comparing audio cable lengths and plugs"],
    };
  }
  if (category === "hair-care" && /hair oil/.test(family)) {
    categoryCopy = { ...categoryCopy, purpose: "adds the stated oil or spray format to a hair-length or styling routine", use: "Apply only the directed amount to the stated hair area, avoid the eyes, and follow the supplied leave-in or rinse-out directions." };
  }
  if (category === "skin-care" && /facial mist|face mist/.test(family)) {
    categoryCopy = { ...categoryCopy, purpose: "dispenses the stated facial mist format during a skin-care routine", use: "Fill or charge the sprayer only as directed, hold it at the instructed distance, avoid direct eye contact, and clean the reservoir or nozzle after use." };
  }
  if (category === "kitchen" && /measuring cup|measuring jug/.test(family)) {
    categoryCopy = { ...categoryCopy, purpose: "measures and pours liquids using the stated cup or jug capacities", use: "Select the required capacity, measure on a level surface, pour through the stated spout, and clean it according to the supplied material guidance." };
  } else if (category === "kitchen" && /camping|cook kit/.test(family)) {
    categoryCopy = { ...categoryCopy, purpose: "combines the stated pot or cookware format for camping meal preparation", use: "Use each cookware piece only with a supported heat source and follow the supplied cleaning, packing, and storage guidance." };
  }
  let productUseText = categoryCopy.use;
  if (/\baudio receiver\b/i.test(family)) {
    productUseText = "Check the RCA, 3.5mm AUX, optical, USB, and power connections against the audio equipment before ordering. Connect it only to compatible inputs and outputs.";
  } else if (/\b(?:phone holder|phone stand|mobile phone holder|car phone mount)\b/i.test(family)) {
    productUseText = "Check that the phone fits the holder and secure the mount to a stable surface before use. Recheck the grip and mounting point regularly.";
  } else if (/\b(?:stylus|digital pen|touch pen)\b/i.test(family)) {
    productUseText = "Confirm the stylus matches the intended touchscreen device, then use the listed tip or magnetic features according to the supplied instructions.";
  } else if (/\b(?:pencil case|pencil box|pen holder|stationery case)\b/i.test(family)) {
    productUseText = "Load pens, pencils, or other suitable stationery without overfilling the case, then close and store it in a dry place.";
  } else if (/\b(?:comb hair brush cleaner|hair brush cleaner|comb cleaner)\b/i.test(family)) {
    productUseText = "Use the tool to remove hair and debris from a brush or comb, then clear the tool and store it dry between uses.";
  } else if (/\b(?:screen protector|tempered glass|hydrogel film)\b/i.test(family)) {
    productUseText = "Confirm the screen model and size before fitting, clean the display, and apply the protector according to the supplied installation instructions.";
  } else if (/(?:ear[- ]?tips?|eartips?|ear[- ]?caps?|silicone[- ]?tips?)/i.test(family)) {
    productUseText = "Choose the listed ear-tip size and confirm the AirPods or earbud model before fitting. Keep the tips clean and replace them if they become worn or damaged.";
  } else if (/(?:lip mask|lip brush|lip applicator)/i.test(family)) {
    productUseText = "Use the brush to spread lip mask or lip care evenly, clean the applicator after use, and keep it covered between applications.";
  } else if ((/\b(?:case|cover|pouch)\b/i.test(family) || /\b(?:protective|replacement)\s+sleeve\b/i.test(family)) && !/\b(?:watch|wristwatch|chronograph)\b/i.test(family)) {
    productUseText = "Confirm the device model and dimensions before fitting the case, cover, pouch, or sleeve, and keep the closure or protective surface clean.";
  } else if (/\bfitness-keychain\b/i.test(family)) {
    productUseText = "Use the keychain for the stated gym or sports theme and attach it securely to a bag, keys, or compatible loop.";
  }
  const genericUseCopy = /\b(?:for the stated task|according to the stated activity|for the stated activity|in the stated setting|purpose shown in the product details|use it for the purpose shown|stated foundation, powder, blush, lash, brow, or complexion step)\b/i;
  if (genericUseCopy.test(productUseText)) {
    const safeTypeLabel = typeText && !/^(?:item|product|general|miscellaneous|other)$/i.test(typeText)
      ? typeText.toLowerCase()
      : "product";
    productUseText = `Use the ${safeTypeLabel} according to the supplied setup, handling, and care instructions; check the listed fit, options, and materials before use.`;
  }
  const facts = prioritizeProductFacts(extractSupportedProductFacts(signals), knowledge);
  const sourceSpecificationFacts = cleanDescriptionSpecificationFacts(
    extractLabeledSpecificationFacts(getRawSpecificationSource(signals)),
  );
  const customerFacts = audioTerminalCable
    ? [
        { label: "Connector size", value: "3.5mm AUX", key: "size" },
        { label: "Connection", value: "AUX audio to XH2.54 3-pin terminal", key: "type" },
        { label: "Connector layout", value: "Male-to-male", key: "features" },
        ...facts.filter((fact) => fact.label !== "Size or capacity"),
      ]
    : audioCable
      ? [
          ...facts.filter((fact) => fact.label !== "Product focus"),
        ]
    : cameraMountingArm
      ? [
          { label: "Arm format", value: "3-section double articulated arm", key: "type" },
          { label: "Mounting fittings", value: "5/8 hex pin with 1/4-20 and 3/8-16 female threads", key: "compatible_device" },
          ...facts.filter((fact) => fact.label !== "Product focus"),
        ]
    : facts;
  const visibleFacts = customerFacts.filter((fact) => fact.label !== "Product focus");
  const reviewText = signals.reviewSummary
    ? ` Current review data records a ${signals.reviewSummary.rating.toFixed(1)}-star average from ${signals.reviewSummary.ratingCount} trusted reviews.`
    : "";
  const humanSummary = buildProductDrivenHumanSummary(titleText, signals, knowledge, facts);
  const overview = `<p><strong>${escapeHtml(titleText)}</strong> &mdash; ${escapeHtml(humanSummary)}${escapeHtml(reviewText)}</p>`;
  const factualDetails = uniqueValues([
    ...visibleFacts.map((fact) => audioTerminalCable && ["Connector size", "Connection", "Connector layout"].includes(fact.label)
      ? `${fact.label}: ${fact.value}`
      : `${fact.label}: ${fact.value}`),
    typeText && !/^(?:item|product|general|miscellaneous|other)$/i.test(typeText) ? `Product type: ${typeText}` : "",
  ])
    .filter((item) => normalizePlainText(item).length >= 6)
    .slice(0, 14);
  if (!factualDetails.length) {
    factualDetails.push(typeText && !/^(?:item|product|general|miscellaneous|other)$/i.test(typeText)
      ? `Format: ${typeText}`
      : `Format: ${handleDescriptorPhrase || "See the title and selected options"}`);
  }
  const list = (items) => `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  const orderingDetails = visibleFacts.length
    ? visibleFacts.slice(0, 3).map(factToSentence).join(" ")
    : fallbackDetails;
  const faq = [
    [`What is ${titleText}?`, humanSummary],
    ["What should I check before ordering?", orderingDetails],
  ];
  return [
    `<h2>About ${escapeHtml(titleText)}</h2>`, overview,
    "<h3>Key Details</h3>", list(factualDetails.slice(0, 14)),
    sourceSpecificationFacts.length
      ? `<h3>Specifications</h3>${list(sourceSpecificationFacts.map(formatCustomerSpecificationFact).slice(0, 12))}`
      : "",
    "<h3>Use &amp; Care</h3>", `<p>${escapeHtml(productUseText)} ${escapeHtml(careText)}</p>`,
    "<h3>FAQs</h3>", faq.map(([question, answer]) => `<p><strong>Q: ${escapeHtml(question)}</strong></p><p>A: ${escapeHtml(answer)}</p>`).join("\n"),
  ].filter(Boolean).join("\n");
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

function roundPsychologicalPrice(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return "";
  }

  if (value < 10) {
    return (Math.max(0.99, Math.round(value * 100) / 100)).toFixed(2);
  }

  if (value < 25) {
    return (Math.floor(value) + 0.99).toFixed(2);
  }

  if (value < 100) {
    return (Math.floor(value / 5) * 5 + 4.99).toFixed(2);
  }

  return (Math.floor(value / 10) * 10 + 9.99).toFixed(2);
}

function getAnchorPriceFromCatalog(catalogProduct) {
  const variants = Array.isArray(catalogProduct?.variants) ? catalogProduct.variants : [];
  const prices = variants
    .map((variant) => parseMoneyValue(variant?.price))
    .filter((price) => Number.isFinite(price) && price > 0);

  if (prices.length) {
    return Math.min(...prices);
  }

  return null;
}

function getSourceExplicitPrice(rows) {
  const prices = [];
  for (const row of rows) {
    const price = parseMoneyValue(firstNonEmpty(
      getRowValue(row, ["Variant Price"]),
      getRowValue(row, ["Price / International"]),
    ));
    if (Number.isFinite(price) && price > 0) {
      prices.push(price);
    }
  }

  if (!prices.length) {
    return null;
  }

  return Math.min(...prices);
}

function suggestRetailPriceFromSignals({
  cost,
  anchorPrice,
  currentPrice,
  confidence,
}) {
  const numericCost = parseMoneyValue(cost);
  const numericAnchor = Number.isFinite(anchorPrice) && anchorPrice > 0 ? anchorPrice : null;
  const numericCurrent = Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : null;
  const canRaise = Number.isFinite(confidence) && confidence >= 45;

  if (!canRaise) {
    return "";
  }

  const productOverhead = PER_PRODUCT_OVERHEAD;
  let derivedFromCost = null;
  if (Number.isFinite(numericCost) && numericCost > 0) {
    const multiplier = multiplierForCost(numericCost);
    derivedFromCost = numericCost * multiplier + productOverhead;
  }

  const reference = [numericAnchor, numericCurrent]
    .filter((value) => Number.isFinite(value) && value > 0)
    .reduce((maximum, value) => Math.max(maximum, value), 0) || null;
  const derivedFromAnchor = reference ? reference * 1.35 : null;

  let target = derivedFromCost ?? derivedFromAnchor ?? null;
  if (derivedFromCost && derivedFromAnchor) {
    target = Math.max(derivedFromCost, derivedFromAnchor);
  }

  if (!Number.isFinite(target) || target <= 0) {
    return "";
  }

  if (reference) {
    target = Math.max(target, reference + PER_PRODUCT_OVERHEAD);
  }
  if (reference && target < reference * 1.15) {
    target = reference * 1.15;
  }

  if (derivedFromCost) {
    target = Math.max(target, numericCost + PER_PRODUCT_OVERHEAD);
  }

  const rounded = Number(roundPsychologicalPrice(target));
  return Number.isFinite(rounded)
    ? Math.min(rounded, MAX_REASONABLE_RETAIL_PRICE).toFixed(2)
    : "";
}

function isEarringProductRow(row) {
  const values = [
    getRowValue(row, ["Handle"]),
    getRowValue(row, ["Title"]),
    getRowValue(row, ["Type", "Product Type"]),
    getRowValue(row, ["Product Category", "Google Shopping / Google Product Category"]),
    getRowValue(row, ["Tags"]),
  ];

  const combined = values.map((value) => normalizePlainText(value)).join(" ");
  return /earrings?/i.test(combined) && !/(?:earbuds?|earphones?|headphones?|headsets?)/i.test(combined);
}

function enforceCompareAtValue(compareAtValue, price, row) {
  const existing = parseMoneyValue(compareAtValue);
  const sellPrice = parseMoneyValue(price);

  if (isEarringProductRow(row)) {
    const minimum = Number.isFinite(sellPrice) && sellPrice > 0 ? Math.max(28.99, sellPrice + 0.01) : 28.99;
    if (!Number.isFinite(existing)) {
      return minimum.toFixed(2);
    }

    return Math.max(existing, minimum).toFixed(2);
  }

  if (!Number.isFinite(existing)) {
    return "";
  }

  if (Number.isFinite(sellPrice) && sellPrice > 0) {
    const rounded = Math.min(
      parseMoneyValue(roundPsychologicalPrice(sellPrice * 1.25)),
      MAX_REASONABLE_RETAIL_PRICE * 1.4,
    );
    const minimum = Math.ceil(sellPrice * 1.2) - 0.01;
    const maximum = Math.min(Math.floor(sellPrice * 1.4) - 0.01, MAX_REASONABLE_RETAIL_PRICE * 1.4);
    const recommended = Math.min(Math.max(rounded, minimum), maximum);
    if (!Number.isFinite(existing) || existing < sellPrice * 1.2 || existing > sellPrice * 1.4) {
      return Number(recommended).toFixed(2);
    }
  }

  return existing.toFixed(2);
}

function normalizeCatalogProducts(input) {
  const payload = Array.isArray(input?.products)
    ? input.products
    : Array.isArray(input)
      ? input
      : [];

  return payload
    .map((product) => {
      const handle = normalizeHandleValue(product?.handle || "");
      if (!handle) {
        return null;
      }

      return {
        ...product,
        handle,
        title: normalizePlainText(product?.title || ""),
        body_html: normalizeHtmlValue(product?.body_html || product?.bodyHtml || ""),
        product_type: normalizePlainText(product?.product_type || product?.productType || ""),
        tags: Array.isArray(product?.tags)
          ? uniqueValues(product.tags.map((tag) => normalizePlainText(tag)).filter(Boolean))
          : splitTags(product?.tags),
      };
    })
    .filter(Boolean);
}

function normalizeCatalogCollections(input) {
  const payload = Array.isArray(input?.collections)
    ? input.collections
    : Array.isArray(input)
      ? input
      : [];

  return payload
    .map((collection) => {
      const handle = normalizeHandleValue(collection?.handle || "");
      if (!handle) {
        return null;
      }

      return {
        ...collection,
        handle,
        title: normalizePlainText(collection?.title || ""),
        products_count: Number(collection?.products_count || collection?.productsCount || 0) || 0,
      };
    })
    .filter(Boolean);
}

function normalizeCollectionProductsPayload(input) {
  const payload = input?.collections && typeof input.collections === "object" ? input.collections : {};
  const result = {};

  for (const [handle, value] of Object.entries(payload)) {
    const normalizedHandle = normalizeHandleValue(handle);
    if (!normalizedHandle) {
      continue;
    }

    const productIds = Array.isArray(value?.productIds)
      ? value.productIds
          .map((entry) => Number(entry))
          .filter((entry) => Number.isFinite(entry) && entry > 0)
      : [];

    result[normalizedHandle] = {
      ...value,
      title: normalizePlainText(value?.title || ""),
      productIds,
    };
  }

  return result;
}

export function createSeoCatalogContext({
  products = [],
  collections = [],
  collectionProducts = {},
} = {}) {
  const productList = normalizeCatalogProducts(products);
  const collectionList = normalizeCatalogCollections(collections);
  const collectionMap = new Map();
  const productsByHandle = new Map();
  const productsById = new Map();
  const productCollectionTitlesById = new Map();
  const productCollectionHandlesById = new Map();
  const collectionProductsMap = normalizeCollectionProductsPayload(collectionProducts);

  for (const product of productList) {
    const productId = Number(product?.id || 0);
    if (productId > 0) {
      productsById.set(productId, product);
    }
    productsByHandle.set(product.handle, product);
  }

  for (const collection of collectionList) {
    const productIds = Array.isArray(collectionProductsMap[collection.handle]?.productIds)
      ? collectionProductsMap[collection.handle].productIds
      : [];
    const entry = {
      ...collection,
      productIds,
    };

    collectionMap.set(collection.handle, entry);

    for (const productId of productIds) {
      if (!productCollectionTitlesById.has(productId)) {
        productCollectionTitlesById.set(productId, []);
      }
      if (!productCollectionHandlesById.has(productId)) {
        productCollectionHandlesById.set(productId, []);
      }

      productCollectionTitlesById.get(productId).push(collection.title);
      productCollectionHandlesById.get(productId).push(collection.handle);
    }
  }

  for (const [productId, titles] of productCollectionTitlesById.entries()) {
    productCollectionTitlesById.set(productId, uniqueValues(titles));
  }

  for (const [productId, handles] of productCollectionHandlesById.entries()) {
    productCollectionHandlesById.set(productId, uniqueValues(handles));
  }

  return {
    products: productList,
    collections: collectionList,
    collectionMap,
    productsByHandle,
    productsById,
    collectionProducts: collectionProductsMap,
    productCollectionTitlesById,
    productCollectionHandlesById,
  };
}

function buildSignalsFromGroup(rows, handle, catalogContext, knowledgeModel = null) {
  const sourceTitle = normalizePlainText(firstNonEmpty(...rows.map((row) => getRowValue(row, ["Title"]))));
  const sourceBodyHtml = normalizeHtmlValue(firstNonEmpty(...rows.map((row) => getRowValue(row, ["Body (HTML)"]))));
  const sourceProductType = normalizePlainText(firstNonEmpty(...rows.map((row) => getRowValue(row, ["Type", "Product Type"]))));
  const sourceSeoTitle = normalizePlainText(firstNonEmpty(...rows.map((row) => getRowValue(row, ["SEO Title"]))));
  const sourceSeoDescription = normalizePlainText(firstNonEmpty(...rows.map((row) => getRowValue(row, ["SEO Description"]))));
  const sourceTags = uniqueValues(rows.flatMap((row) => splitTags(getRowValue(row, ["Tags"]))));
  const categoryQuery = normalizePlainText(
    firstNonEmpty(
      ...rows.map((row) =>
        firstNonEmpty(
          getRowValue(row, ["Google Shopping / Google Product Category"]),
          getRowValue(row, ["Google Shopping Category"]),
          getRowValue(row, ["Product Category"]),
        ),
      ),
    ),
  );
  const rowProductId = firstNonEmpty(...rows.map((row) => getRowValue(row, ["Product ID", "ID"])));
  const numericProductId = Number(normalizePlainText(rowProductId).match(/\d+/)?.[0] || 0) || 0;
  const catalogProduct = normalizeHandleValue(handle)
    ? catalogContext.productsByHandle.get(normalizeHandleValue(handle)) || null
    : null;
  const catalogProductType = normalizePlainText(catalogProduct?.product_type || "");
  const catalogTitle = normalizePlainText(catalogProduct?.title || "");
  const catalogBodyHtml = normalizeHtmlValue(catalogProduct?.body_html || "");
  const catalogTags = uniqueValues(
    Array.isArray(catalogProduct?.tags) ? catalogProduct.tags.map((tag) => normalizePlainText(tag)).filter(Boolean) : [],
  );
  const catalogSubtitle = normalizePlainText(catalogProduct?.customData?.subtitle || "");
  const catalogHighlights = uniqueValues(
    Array.isArray(catalogProduct?.customData?.highlights)
      ? catalogProduct.customData.highlights.map((entry) => normalizePlainText(entry)).filter(Boolean)
      : [],
  );
  const catalogSearchBoosts = uniqueValues(
    Array.isArray(catalogProduct?.customData?.searchProductBoosts)
      ? catalogProduct.customData.searchProductBoosts.map((entry) => normalizePlainText(entry)).filter(Boolean)
      : [],
  );
  const catalogReviewRating = parseMoneyValue(
    firstNonEmpty(catalogProduct?.customData?.rating, catalogProduct?.average_rating, catalogProduct?.rating),
  );
  const catalogReviewCount = parseMoneyValue(
    firstNonEmpty(catalogProduct?.customData?.ratingCount, catalogProduct?.total_reviews, catalogProduct?.reviewCount),
  );
  const sourceReviewRating = parseMoneyValue(
    firstNonEmpty(...rows.map((row) => getRowValue(row, ["Product rating", "Rating", "reviews.rating"]))),
  );
  const sourceReviewCount = parseMoneyValue(
    firstNonEmpty(...rows.map((row) => getRowValue(row, ["Product rating count", "Rating count", "reviews.rating_count"]))),
  );
  const reviewSummary =
    Number.isFinite(catalogReviewRating) &&
    catalogReviewRating > 0 &&
    Number.isFinite(catalogReviewCount) &&
    catalogReviewCount > 0
      ? {
          rating: catalogReviewRating,
          ratingCount: catalogReviewCount,
          source: "catalog",
        }
      : Number.isFinite(sourceReviewRating) &&
          sourceReviewRating > 0 &&
          Number.isFinite(sourceReviewCount) &&
          sourceReviewCount > 0
        ? {
            rating: sourceReviewRating,
            ratingCount: sourceReviewCount,
            source: "sheet",
          }
        : null;
  const anchorPrice = getAnchorPriceFromCatalog(catalogProduct);
  const effectiveProductId = numericProductId || Number(catalogProduct?.id || 0) || 0;
  const collectionTitles = effectiveProductId
    ? catalogContext.productCollectionTitlesById.get(effectiveProductId) || []
    : [];
  const collectionHandles = effectiveProductId
    ? catalogContext.productCollectionHandlesById.get(effectiveProductId) || []
    : [];
  const collectionSignal = normalizePlainText(
    firstNonEmpty(
      catalogProduct?.customData?.collectionSignal,
      collectionTitles.join(", "),
      categoryQuery,
    ),
  );
  const productKnowledge = classifyProductKnowledge({
    id: effectiveProductId,
    handle,
    title: catalogTitle || sourceTitle,
    product_type: sourceProductType || catalogProductType,
    tags: sourceTags.length ? sourceTags : catalogTags,
    body_html: sourceBodyHtml || catalogBodyHtml,
    customData: {
      collectionSignal,
      searchProductBoosts: catalogSearchBoosts,
    },
  }, { knowledgeModel });

  const handleTokens = buildTokenSet(handle);
  const sourceTitleTokens = buildTokenSet(sourceTitle);
  const catalogTitleTokens = buildTokenSet(catalogTitle);
  const productTypeTokens = buildTokenSet(sourceProductType, catalogProductType);
  const tagTokens = buildTokenSet(...sourceTags, ...catalogTags);
  const collectionTokens = buildTokenSet(...collectionTitles, collectionSignal);
  const bodyTokens = buildTokenSet(
    stripHtml(sourceBodyHtml),
    stripHtml(catalogBodyHtml),
    catalogSubtitle,
    ...catalogHighlights,
    ...catalogSearchBoosts,
  );
  const handlePhrase = selectHandleFamilyPhrase({
    handleTokens,
    sourceTitleTokens,
    catalogTitleTokens,
    productTypeTokens,
    tagTokens,
    collectionTokens,
    bodyTokens,
  });

  return {
    handle: normalizeHandleValue(handle),
    rowCount: rows.length,
    sourceRows: rows,
    sourceTitle,
    sourceBodyHtml,
    sourceProductType,
    sourceSeoTitle,
    sourceSeoDescription,
    sourceTags,
    categoryQuery,
    rowProductId: numericProductId || null,
    catalogProduct,
    catalogTitle,
    catalogBodyHtml,
    catalogProductType,
    catalogTags,
    catalogSubtitle,
    catalogHighlights,
    catalogSearchBoosts,
    reviewSummary,
    anchorPrice,
    collectionTitles,
    collectionHandles,
    collectionSignal,
    productKnowledge,
    handleTokens,
    sourceTitleTokens,
    catalogTitleTokens,
    productTypeTokens,
    tagTokens,
    collectionTokens,
    bodyTokens,
    handlePhrase,
  };
}

function computeConfidence(signals) {
  const handleTokenCount = signals.handleTokens.size;
  const sourceOverlap =
    countOverlap(signals.handleTokens, signals.sourceTitleTokens) +
    countOverlap(signals.handleTokens, signals.productTypeTokens) +
    countOverlap(signals.handleTokens, signals.tagTokens) +
    countOverlap(signals.handleTokens, signals.collectionTokens) +
    countOverlap(signals.handleTokens, signals.bodyTokens);
  const catalogOverlap =
    countOverlap(signals.handleTokens, signals.catalogTitleTokens) +
    (signals.catalogProduct ? 6 : 0) +
    (signals.collectionTitles.length ? 5 : 0) +
    (signals.collectionSignal ? 3 : 0);
  const sourceQuality =
    (signals.sourceTitle ? 6 : 0) +
    (signals.sourceBodyHtml ? 3 : 0) +
    (signals.sourceProductType ? 4 : 0) +
    (signals.sourceTags.length ? 4 : 0) +
    (signals.reviewSummary ? 4 : 0);

  const genericPenalty = [
    signals.sourceTitle,
    signals.catalogTitle,
    signals.handlePhrase,
    buildSafeHandleTitle(signals),
  ].reduce((score, value) => {
    const normalized = normalizeComparableText(value);
    if (!normalized) {
      return score - 2;
    }

    if (GENERIC_TITLE_PHRASES.some((pattern) => pattern.test(normalized))) {
      return score - 12;
    }

    const tokens = tokenizeText(normalized);
    const genericCount = tokens.filter((token) => GENERIC_TITLE_WORDS.has(token)).length;
    if (!tokens.length) {
      return score - 6;
    }

    const genericRatio = genericCount / tokens.length;
    if (genericRatio >= 0.65) {
      return score - 14;
    }

    if (genericRatio >= 0.45) {
      return score - 8;
    }

    return score;
  }, 0);

  const titlePreference = Math.max(
    scorePhraseCandidate(signals.handlePhrase || "", signals),
    selectBestTitleCandidate(
      uniqueValues([
        signals.sourceTitle,
        signals.catalogTitle,
        signals.handlePhrase,
        signals.handlePhrase && signals.sourceProductType
          ? appendProductTypeCandidate(signals.handlePhrase, signals.sourceProductType)
          : "",
        signals.handlePhrase && signals.catalogProductType
          ? appendProductTypeCandidate(signals.handlePhrase, signals.catalogProductType)
          : "",
        signals.sourceTitle && signals.sourceProductType
          ? appendProductTypeCandidate(signals.sourceTitle, signals.sourceProductType)
          : "",
        signals.catalogTitle && signals.catalogProductType
          ? appendProductTypeCandidate(signals.catalogTitle, signals.catalogProductType)
          : "",
      ]),
      signals,
      signals.sourceTitle,
    ).score,
  );

  const rawScore = 14 + handleTokenCount * 2 + sourceOverlap * 4 + catalogOverlap * 3 + sourceQuality + titlePreference + genericPenalty;

  return clamp(Math.round(rawScore), 0, 100);
}

function selectCanonicalTitle(signals) {
  const handleAlignedTitle = buildHandleAlignedTitle(signals);
  if (handleAlignedTitle) {
    return {
      candidate: /(?:3\.5mm|XH2\.54|USB-C|DC-DC|iPhone|iPad|mAh|\d+-in-\d+|5\/8|1\/4-20|3\/8-16|\bKZ\b|\bEDX\b|\bR69\b|\bTV\b|Wi-Fi|In-Ear|One-Shoulder|Long-Sleeve|Women's|Men's|Children's)/i.test(handleAlignedTitle)
        ? handleAlignedTitle
        : titleCase(handleAlignedTitle),
      score: 1000,
    };
  }

  const candidates = uniqueValues([
    signals.sourceTitle,
    signals.catalogTitle,
    signals.handlePhrase,
    buildSafeHandleTitle(signals),
    signals.handlePhrase && signals.sourceProductType
      ? appendProductTypeCandidate(signals.handlePhrase, signals.sourceProductType)
      : "",
    signals.handlePhrase && signals.catalogProductType
      ? appendProductTypeCandidate(signals.handlePhrase, signals.catalogProductType)
      : "",
    signals.sourceTitle && signals.sourceProductType
      ? appendProductTypeCandidate(signals.sourceTitle, signals.sourceProductType)
      : "",
    signals.catalogTitle && signals.catalogProductType
      ? appendProductTypeCandidate(signals.catalogTitle, signals.catalogProductType)
      : "",
  ]);

  return selectBestTitleCandidate(candidates, signals, signals.sourceTitle);
}

function buildCanonicalAltText(signals, canonicalTitle) {
  const titleText = normalizePlainText(canonicalTitle || signals.sourceTitle || signals.catalogTitle);
  if (!titleText) {
    return "";
  }

  const knowledge = resolveProductKnowledge(signals.handle);
  const candidateType = sanitizeMarketplaceClaims(normalizePlainText(signals.productTypeText));
  const typeText = isTitleAlignedWithKnowledge(candidateType, knowledge) ? candidateType : "";
  if (typeText && !normalizeComparableText(titleText).includes(normalizeComparableText(typeText))) {
    return `${titleText} ${typeText.toLowerCase()}`.trim();
  }

  return titleText;
}

function buildProductProfile(signals) {
  const confidence = computeConfidence(signals);
  const knowledge = resolveProductKnowledge(signals.handle);
  const modelDefinition = getReliableModelTaxonomyDefinition(signals);
  const modelTypeText = modelDefinition?.canonicalType
    ? sanitizeMarketplaceClaims(normalizePlainText(modelDefinition.canonicalType))
    : "";
  const classificationHeld = Boolean(
    (signals.productKnowledge?.reviewRequired || signals.productKnowledge?.seoEligible === false) &&
      !HANDLE_TITLE_OVERRIDES.has(signals.handle),
  );
  const explicitTitle = HANDLE_TITLE_OVERRIDES.get(signals.handle) || "";
  const recognizedHandleFamily = /^(iPhone Case|Screen Protector|Computer Mouse|Mouse Jiggler|Mouse Remote|Raincoat|Dog Nail File|Measuring Cup|Camping Cookware Set|Facial Mist Sprayer|Sports Outfit|Lip Balm|Hair Oil)$/i.test(normalizePlainText(signals.handlePhrase));
  const rewriteLevel = classificationHeld
    ? "medium"
    : explicitTitle || recognizedHandleFamily
      ? "high"
      : confidence >= 70
        ? "high"
        : confidence >= 45
          ? "medium"
          : "low";
  const selectedTitle = normalizePlainText(selectCanonicalTitle(signals).candidate || signals.sourceTitle || signals.catalogTitle);
  const directHandleTitle = buildHandleAlignedTitle(signals);
  const directHandleTitleCandidate = directHandleTitle
    ? /(?:3\.5mm|XH2\.54|USB-C|DC-DC|iPhone|iPad|mAh|\d+-in-\d+|5\/8|1\/4-20|3\/8-16|Hot-Shoe|\bKZ\b|\bEDX\b|\bR69\b|\bTV\b|Wi-Fi|In-Ear|One-Shoulder|Long-Sleeve)/i.test(directHandleTitle)
      ? directHandleTitle
      : titleCase(directHandleTitle)
    : "";
  const safeHandleTitle = buildSafeHandleTitle(signals);
  const selectedTitleIsWeak =
    selectedTitle.length < 20 ||
    GENERIC_TITLE_PHRASES.some((pattern) => pattern.test(selectedTitle));
  const titleCandidate = explicitTitle || directHandleTitleCandidate ||
    ((selectedTitleIsWeak || !isTitleAlignedWithKnowledge(selectedTitle, knowledge)) && safeHandleTitle
      ? safeHandleTitle
      : selectedTitle || modelTypeText);
  const guardedTitle = enforceMarketplaceTitle(
    normalizePlainText(titleCandidate),
    68,
  );
  const safeGuardedTitle = enforceMarketplaceTitle(safeHandleTitle, 68);
  const canonicalTitle = guardedTitle.length >= 20 || safeGuardedTitle.length <= guardedTitle.length
    ? guardedTitle
    : safeGuardedTitle;
  const contentRewriteLevel = classificationHeld && canonicalTitle.length >= 20 && confidence >= 35
    ? "high"
    : rewriteLevel;
  const searchPhrases = buildSearchPhrases(signals);
  const seoTitle = buildCanonicalSeoTitle(canonicalTitle, signals);
  const seoDescription = buildSeoDescription(canonicalTitle, signals);
  const descriptionHtml = buildDescriptionHtml(canonicalTitle, signals);
  const altText = buildCanonicalAltText(signals, canonicalTitle);

  const productType = normalizePlainText(firstNonEmpty(signals.sourceProductType, signals.catalogProductType));
  const tags = uniqueValues([
    ...signals.sourceTags,
    ...(signals.sourceTags.length ? [] : signals.catalogTags),
  ]);

  const reasons = [];
  if (signals.handlePhrase) {
    reasons.push(`handle:${signals.handlePhrase}`);
  }
  reasons.push(`knowledge:${knowledge.id}@${PRODUCT_CONTENT_KNOWLEDGE_VERSION}`);
  if (classificationHeld) {
    reasons.push("classification-review:model-or-taxonomy-conflict");
  }
  if (signals.catalogProduct) {
    reasons.push("catalog-anchor");
  }
  if (signals.reviewSummary) {
    reasons.push(`reviews:${signals.reviewSummary.rating.toFixed(1)}/${signals.reviewSummary.ratingCount}`);
  }
  if (signals.collectionTitles.length) {
    reasons.push(`collections:${signals.collectionTitles.slice(0, 2).join(" / ")}`);
  }
  if (modelDefinition) {
    reasons.push(`model-grounded-listing:${modelDefinition.id}`);
  }
  if (searchPhrases.length) {
    reasons.push(`search:${searchPhrases.slice(0, 3).join(", ")}`);
  }

  const changedFields = [];
  const skippedFields = [];

  const productInput = {
    title: "",
    descriptionHtml: "",
    productType,
    seo: {
      title: "",
      description: "",
    },
  };

  const desiredProductInput = {
    title: contentRewriteLevel === "high" ? canonicalTitle : "",
    descriptionHtml: contentRewriteLevel === "high" ? descriptionHtml : "",
    productType,
    seo: {
      title: rewriteLevel !== "low" ? seoTitle : "",
      description: rewriteLevel !== "low" ? seoDescription : "",
    },
  };

  if (contentRewriteLevel === "high" && canonicalTitle) {
    if (normalizeComparableText(canonicalTitle) !== normalizeComparableText(signals.sourceTitle)) {
      productInput.title = canonicalTitle;
      changedFields.push("title");
    } else {
      skippedFields.push({ field: "title", reason: "already aligned" });
    }

    if (descriptionHtml && normalizeComparableText(stripHtml(descriptionHtml)) !== normalizeComparableText(stripHtml(signals.sourceBodyHtml))) {
      productInput.descriptionHtml = descriptionHtml;
      changedFields.push("body");
    } else {
      skippedFields.push({ field: "body", reason: "already aligned or empty" });
    }

    if (altText && normalizeComparableText(altText) !== normalizeComparableText(signals.sourceSeoTitle || signals.sourceTitle)) {
      changedFields.push("alt");
    } else {
      skippedFields.push({ field: "alt", reason: "already aligned" });
    }
  } else {
    skippedFields.push({ field: "title", reason: contentRewriteLevel === "high" ? "already aligned" : "confidence below high threshold" });
    skippedFields.push({ field: "body", reason: contentRewriteLevel === "high" ? "already aligned" : "confidence below high threshold" });
    skippedFields.push({ field: "alt", reason: "confidence below high threshold" });
  }

  if (rewriteLevel !== "low") {
    if (seoTitle && normalizeComparableText(seoTitle) !== normalizeComparableText(signals.sourceSeoTitle)) {
      productInput.seo.title = seoTitle;
      changedFields.push("seo-title");
    } else {
      skippedFields.push({ field: "seo-title", reason: "already aligned or empty" });
    }

    if (seoDescription && normalizeComparableText(seoDescription) !== normalizeComparableText(signals.sourceSeoDescription)) {
      productInput.seo.description = seoDescription;
      changedFields.push("seo-description");
    } else {
      skippedFields.push({ field: "seo-description", reason: "already aligned or empty" });
    }
  } else {
    skippedFields.push({ field: "seo-title", reason: "confidence below medium threshold" });
    skippedFields.push({ field: "seo-description", reason: "confidence below medium threshold" });
  }

  const price = suggestRetailPriceFromSignals({
    cost: signals.sourceCost,
    anchorPrice: signals.anchorPrice,
    currentPrice: signals.sourcePrice,
    confidence,
  });

  return {
    handle: signals.handle,
    sourceTitle: signals.sourceTitle,
    catalogTitle: signals.catalogTitle,
    handlePhrase: signals.handlePhrase,
    confidence,
    rewriteLevel,
    contentRewriteLevel,
    canonicalTitle,
    canonicalDescriptionHtml: descriptionHtml,
    canonicalSeoTitle: seoTitle,
    canonicalSeoDescription: seoDescription,
    canonicalAltText: altText,
    productType,
    tags,
    reviewSummary: signals.reviewSummary || null,
    searchPhrases,
    knowledge: {
      version: PRODUCT_CONTENT_KNOWLEDGE_VERSION,
      family: knowledge.id,
      classificationVersion: PRODUCT_KNOWLEDGE_BASE_VERSION,
      classificationFamily: signals.productKnowledge?.familyId || "other",
      classificationType: signals.productKnowledge?.typeKey || "unclassified-product",
      classificationConfidence: signals.productKnowledge?.confidence || 0,
      modelVersion: signals.productKnowledge?.modelEvidence?.modelVersion || "",
      modelTrainingRecords: signals.productKnowledge?.modelEvidence?.trainingRecords || 0,
      modelTopRuleId: signals.productKnowledge?.modelEvidence?.topRuleId || "",
      modelAgreesWithTaxonomy: signals.productKnowledge?.modelEvidence
        ? signals.productKnowledge.modelEvidence.topRuleId === signals.productKnowledge.classificationRule
        : null,
      modelEvidenceUsed: Boolean(modelDefinition),
      modelTaxonomy: modelDefinition
        ? {
            ruleId: modelDefinition.id,
            canonicalType: modelDefinition.canonicalType,
            categoryLabel: modelDefinition.categoryLabel || "",
            subcategoryLabel: modelDefinition.subcategoryLabel || "",
          }
        : null,
      classificationHeld,
      priorityFacts: knowledge.priorityFacts,
      factCount: extractSupportedProductFacts(signals).length,
      policy: MARKETPLACE_CONTENT_POLICY.market,
      titleOverride: Boolean(explicitTitle),
    },
    reasons,
    changedFields,
    skippedFields,
    pricing: {
      sourceCost: formatMoneyValue(signals.sourceCost),
      anchorPrice: formatMoneyValue(signals.anchorPrice),
      sourcePrice: formatMoneyValue(signals.sourcePrice),
      price,
      compareAtPrice: "",
      rationale:
        price && signals.sourceCost
          ? `Cost-band retail target plus $${PER_PRODUCT_OVERHEAD} per-product overhead, with a 35%+ uplift guarded by the current catalog anchor`
          : price && signals.anchorPrice
            ? `Current catalog anchor lifted by 35% with psychological rounding`
            : price
              ? "Handle-first pricing heuristic"
              : "No reliable pricing signal",
    },
    productInput,
    desiredProductInput,
    mediaTargets: [],
  };
}

function buildVariantPlanFromRow(row, profile, { includeAligned = false, preserveCurrentPrice = false } = {}) {
  const variantId = toShopifyGid("ProductVariant", getRowValue(row, ["Variant ID", "ID"]));
  const sku = normalizePlainText(getRowValue(row, ["Variant SKU"]));
  const optionValues = [
    normalizePlainText(getRowValue(row, ["Option1 Value"])),
    normalizePlainText(getRowValue(row, ["Option2 Value"])),
    normalizePlainText(getRowValue(row, ["Option3 Value"])),
  ].filter(Boolean);
  const variantTitle = normalizePlainText(getRowValue(row, ["Variant Title"]));
  const label =
    optionValues.join(" / ") ||
    variantTitle ||
    sku ||
    normalizePlainText(getRowValue(row, ["Title"]));
  const hasVariantIdentity = Boolean(variantId || sku || optionValues.length || variantTitle);
  const explicitPrice = parseMoneyValue(firstNonEmpty(getRowValue(row, ["Variant Price"]), getRowValue(row, ["Price / International"])));
  const explicitCompareAt = parseMoneyValue(
    firstNonEmpty(getRowValue(row, ["Variant Compare At Price"]), getRowValue(row, ["Compare At Price / International"])),
  );
  const sourceCost = parseMoneyValue(getRowValue(row, ["Cost per item"]));
  const operationalAdjustment = profile?.knowledge?.family === "order-adjustment";
  const price = preserveCurrentPrice || operationalAdjustment
    ? formatMoneyValue(explicitPrice)
    : suggestRetailPriceFromSignals({
        cost: sourceCost,
        anchorPrice: profile?.pricing?.anchorPrice ? parseMoneyValue(profile.pricing.anchorPrice) : null,
        currentPrice: explicitPrice,
        confidence: profile?.confidence ?? 0,
      });

  if (!hasVariantIdentity || !price) {
    return null;
  }

  const compareAtPrice = preserveCurrentPrice || operationalAdjustment
    ? formatMoneyValue(explicitCompareAt)
    : explicitCompareAt != null
      ? enforceCompareAtValue(explicitCompareAt, price, row)
      : "";
  const normalizedExplicitPrice = formatMoneyValue(explicitPrice);
  const normalizedPrice = formatMoneyValue(price);
  const normalizedCompareAt = formatMoneyValue(compareAtPrice);

  if (
    !includeAligned &&
    normalizedPrice &&
    normalizedPrice === normalizedExplicitPrice &&
    (!normalizedCompareAt || normalizedCompareAt === formatMoneyValue(explicitCompareAt))
  ) {
    return null;
  }

  return {
    variantId,
    sku,
    label,
    optionValues,
    price: normalizedPrice,
    compareAtPrice: normalizedCompareAt,
    sourceCost: formatMoneyValue(sourceCost),
  };
}

function buildMediaPlanFromRow(row, profile, { includeAligned = false } = {}) {
  if ((profile?.contentRewriteLevel || profile?.rewriteLevel || "low") !== "high") {
    return null;
  }

  const imageSrc = normalizeUrlForMatch(getRowValue(row, ["Image Src"]));
  if (!imageSrc) {
    return null;
  }

  const alt = normalizePlainText(profile?.canonicalAltText || getRowValue(row, ["Image Alt Text"]));
  if (!alt) {
    return null;
  }

  const existingAlt = normalizePlainText(getRowValue(row, ["Image Alt Text"]));
  if (!includeAligned && existingAlt && normalizeComparableText(existingAlt) === normalizeComparableText(alt)) {
    return null;
  }

  return {
    imageSrc,
    alt,
  };
}

function dedupeByKey(values, keyFn) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const key = keyFn(value);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(value);
  }

  return result;
}

function resolveCategoryQueryFromRows(rows) {
  return normalizePlainText(
    firstNonEmpty(
      ...rows.map((row) =>
        firstNonEmpty(
          getRowValue(row, ["Google Shopping / Google Product Category"]),
          getRowValue(row, ["Google Shopping Category"]),
          getRowValue(row, ["Product Category"]),
        ),
      ),
    ),
  );
}

async function resolveCategoryIdWithHandler(categoryQuery, resolveCategoryId, cache) {
  const raw = normalizePlainText(categoryQuery);
  const normalized = raw.toLowerCase();
  if (!normalized) {
    return null;
  }

  if (/^gid:\/\/shopify\/[a-z0-9_]+\/\d+$/i.test(normalized)) {
    return raw;
  }

  if (cache.has(normalized)) {
    return cache.get(normalized);
  }

  const resolved = await resolveCategoryId(raw);
  cache.set(normalized, resolved || null);
  return resolved || null;
}

function summarizeProductPlan(productPlan) {
  const changedFields = [
    productPlan.productInput?.title ? "title" : "",
    productPlan.productInput?.descriptionHtml ? "body" : "",
    productPlan.productInput?.seo?.title ? "seo-title" : "",
    productPlan.productInput?.seo?.description ? "seo-description" : "",
    productPlan.categoryId ? "category" : "",
    productPlan.mediaTargets?.length ? "image-alt" : "",
    productPlan.variantUpdates?.length ? "price" : "",
  ].filter(Boolean);

  return {
    handle: productPlan.handle,
    confidence: productPlan.confidence,
    rewriteLevel: productPlan.rewriteLevel,
    rowCount: productPlan.rowCount,
    changedFields,
    skippedFields: productPlan.intelligence?.skippedFields || [],
    changeReasons: productPlan.intelligence?.reasons || [],
    pricing: productPlan.intelligence?.pricing || null,
    writeCount: changedFields.length + (productPlan.variantUpdates?.length || 0) + (productPlan.mediaTargets?.length || 0),
  };
}

export async function buildSeoBatchPlan(
  rows,
  {
    resolveCategoryId,
    suppressCategoryWarnings = false,
    catalogContext: inputCatalogContext,
    products,
    collections,
    collectionProducts,
    knowledgeModel,
  } = {},
) {
  const warnings = [];
  const resolveCategory =
    typeof resolveCategoryId === "function"
      ? resolveCategoryId
      : async () => null;
  const catalogContext =
    inputCatalogContext ||
    createSeoCatalogContext({
      products,
      collections,
      collectionProducts,
    });

  const groups = new Map();
  rows.forEach((row, index) => {
    const handle = normalizeHandleValue(getRowValue(row, ["Handle"]));
    if (!handle) {
      warnings.push(`Row ${index + 1} is missing a handle and was skipped.`);
      return;
    }

    if (!groups.has(handle)) {
      groups.set(handle, {
        handle,
        rows: [],
        firstRowIndex: index,
      });
    }

    const group = groups.get(handle);
    group.rows.push({ row, index });
    group.firstRowIndex = Math.min(group.firstRowIndex, index);
  });

  const categoryCache = new Map();
  const productsOut = [];

  for (const group of groups.values()) {
    const signals = buildSignalsFromGroup(
      group.rows.map((entry) => entry.row),
      group.handle,
      catalogContext,
      knowledgeModel,
    );
    signals.productTypeText = signals.sourceProductType || signals.catalogProductType;
    signals.sourcePrice = getSourceExplicitPrice(group.rows.map((entry) => entry.row));
    const profile = buildProductProfile(signals);
    const rowProductId = signals.rowProductId || signals.catalogProduct?.id || null;
    const productId = toShopifyGid("Product", rowProductId);
    const productInput = {
      id: productId,
    };

    if (profile.productType) {
      productInput.productType = profile.productType;
    }

    if (profile.productInput.title) {
      productInput.title = profile.productInput.title;
    }

    if (profile.productInput.descriptionHtml) {
      productInput.descriptionHtml = profile.productInput.descriptionHtml;
    }

    if (profile.productInput.seo?.title || profile.productInput.seo?.description) {
      productInput.seo = {
        title: profile.productInput.seo.title || "",
        description: profile.productInput.seo.description || "",
      };
    }

    if (signals.categoryQuery) {
      const resolvedCategoryId = await resolveCategoryIdWithHandler(signals.categoryQuery, resolveCategory, categoryCache);
      if (resolvedCategoryId) {
        productInput.category = resolvedCategoryId;
      } else if (!suppressCategoryWarnings) {
        warnings.push(`Could not resolve category "${signals.categoryQuery}" for ${group.handle}.`);
      }
    }

    const variantUpdates = dedupeByKey(
      group.rows
        .map((entry) => buildVariantPlanFromRow(entry.row, profile))
        .filter(Boolean),
      (entry) => [
        entry.variantId || "",
        entry.sku || "",
        entry.label || "",
        entry.price || "",
        entry.compareAtPrice || "",
      ].join("|"),
    );

    const mediaTargets = dedupeByKey(
      group.rows
        .map((entry) => buildMediaPlanFromRow(entry.row, profile))
        .filter(Boolean),
      (entry) => entry.imageSrc,
    );

    const desiredProductInput = {
      id: productId,
    };

    if (profile.desiredProductInput.title) {
      desiredProductInput.title = profile.desiredProductInput.title;
    }

    if (profile.desiredProductInput.descriptionHtml) {
      desiredProductInput.descriptionHtml = profile.desiredProductInput.descriptionHtml;
    }

    if (profile.desiredProductInput.productType) {
      desiredProductInput.productType = profile.desiredProductInput.productType;
    }

    if (profile.desiredProductInput.seo?.title || profile.desiredProductInput.seo?.description) {
      desiredProductInput.seo = {
        ...(profile.desiredProductInput.seo.title ? { title: profile.desiredProductInput.seo.title } : {}),
        ...(profile.desiredProductInput.seo.description
          ? { description: profile.desiredProductInput.seo.description }
          : {}),
      };
    }

    if (productInput.category) {
      desiredProductInput.category = productInput.category;
    }

    const desiredVariantUpdates = dedupeByKey(
      group.rows
        .map((entry) => buildVariantPlanFromRow(entry.row, profile, { includeAligned: true, preserveCurrentPrice: true }))
        .filter(Boolean),
      (entry) => [entry.variantId || "", entry.sku || "", entry.label || ""].join("|"),
    );

    const desiredMediaTargets = dedupeByKey(
      group.rows
        .map((entry) => buildMediaPlanFromRow(entry.row, profile, { includeAligned: true }))
        .filter(Boolean),
      (entry) => entry.imageSrc,
    );

    const effectiveVariantPrices = desiredVariantUpdates.map((desiredVariant) => {
      const desiredIdentity = [desiredVariant.variantId, desiredVariant.sku, desiredVariant.label]
        .map((value) => normalizePlainText(value).toLowerCase())
        .filter(Boolean);
      const plannedVariant = variantUpdates.find((candidate) => {
        const candidateIdentity = [candidate.variantId, candidate.sku, candidate.label]
          .map((value) => normalizePlainText(value).toLowerCase())
          .filter(Boolean);
        return desiredIdentity.some((identity) => candidateIdentity.includes(identity));
      });
      return plannedVariant?.price || desiredVariant.price;
    });
    const desiredQuantityTag = getMinimumQuantityTagForPrices(effectiveVariantPrices);
    const sourceQuantityTags = signals.sourceTags.length ? signals.sourceTags : signals.catalogTags;
    const reconciledQuantityTags = reconcileManagedMinimumQuantityTags(sourceQuantityTags, desiredQuantityTag);
    const managedQuantityTagChange =
      normalizeShopifyTags(sourceQuantityTags).map((tag) => tag.toLowerCase()).join("|") !==
      reconciledQuantityTags.map((tag) => tag.toLowerCase()).join("|");

    const writeCount =
      (profile.productInput.title ? 1 : 0) +
      (profile.productInput.descriptionHtml ? 1 : 0) +
      (profile.productInput.seo?.title ? 1 : 0) +
      (profile.productInput.seo?.description ? 1 : 0) +
      (productInput.category ? 1 : 0) +
      (managedQuantityTagChange ? 1 : 0) +
      variantUpdates.length +
      mediaTargets.length;

    productsOut.push({
      handle: group.handle,
      productId,
      rowCount: group.rows.length,
      firstRowIndex: group.firstRowIndex,
      confidence: profile.confidence,
      rewriteLevel: profile.rewriteLevel,
      contentRewriteLevel: profile.contentRewriteLevel,
      productInput,
      desiredProductInput,
      variantUpdates,
      desiredVariantUpdates,
      mediaTargets,
      desiredMediaTargets,
      desiredQuantityTag,
      managedQuantityTagChange,
      categoryQuery: signals.categoryQuery,
      categoryId: productInput.category || "",
      intelligence: profile,
      reasons: profile.reasons,
      skipped: profile.skippedFields,
      writeCount,
    });
  }

  const summary = {
    sourceRows: rows.length,
    handleGroups: productsOut.length,
    highConfidence: productsOut.filter((entry) => entry.rewriteLevel === "high").length,
    contentHighConfidence: productsOut.filter((entry) => entry.contentRewriteLevel === "high").length,
    mediumConfidence: productsOut.filter((entry) => entry.rewriteLevel === "medium").length,
    lowConfidence: productsOut.filter((entry) => entry.rewriteLevel === "low").length,
    totalProductWrites: productsOut.reduce(
      (count, entry) =>
        count +
        (entry.productInput?.title ? 1 : 0) +
        (entry.productInput?.descriptionHtml ? 1 : 0) +
        (entry.productInput?.seo?.title ? 1 : 0) +
        (entry.productInput?.seo?.description ? 1 : 0) +
        (entry.categoryId ? 1 : 0) +
        (entry.managedQuantityTagChange ? 1 : 0),
      0,
    ),
    totalVariantWrites: productsOut.reduce((count, entry) => count + entry.variantUpdates.length, 0),
    totalMediaWrites: productsOut.reduce((count, entry) => count + entry.mediaTargets.length, 0),
    totalWrites: productsOut.reduce((count, entry) => count + entry.writeCount, 0),
  };

  return {
    products: productsOut,
    warnings,
    summary,
    catalogContext,
  };
}

function setPreferredField(row, candidates, value) {
  if (!value) {
    return;
  }

  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(row, candidate)) {
      row[candidate] = value;
      return;
    }
  }

  row[candidates[0]] = value;
}

function buildVariantRowUpdate(row, profile) {
  const variantPlan = buildVariantPlanFromRow(row, profile);
  if (!variantPlan) {
    return null;
  }

  return variantPlan;
}

export function buildSeoBatchExportRows(rows, plan) {
  const planByHandle = new Map((plan?.products || []).map((entry) => [entry.handle, entry]));
  const firstRowIndexByHandle = new Map();

  rows.forEach((row, index) => {
    const handle = normalizeHandleValue(getRowValue(row, ["Handle"]));
    if (!handle) {
      return;
    }

    if (!firstRowIndexByHandle.has(handle)) {
      firstRowIndexByHandle.set(handle, index);
    }
  });

  return rows.map((row, index) => {
    const handle = normalizeHandleValue(getRowValue(row, ["Handle"]));
    const productPlan = planByHandle.get(handle);
    if (!productPlan) {
      return { ...row };
    }

    const nextRow = { ...row };
    const profile = {
      ...productPlan.intelligence,
      sourcePrice: getSourceExplicitPrice([row]),
    };
    const isPrimaryRow = firstRowIndexByHandle.get(handle) === index;
    const exportSeoTitle = (() => {
      const desired = normalizePlainText(productPlan.productInput?.seo?.title || productPlan.productInput?.title || "");
      if (!desired) return "";
      const withIntent = desired.length < 35 ? `Shop ${desired} for Everyday Use` : desired;
      return shortenAtWordBoundary(withIntent, 60);
    })();

    if (isPrimaryRow && (productPlan.contentRewriteLevel || productPlan.rewriteLevel) === "high") {
      setPreferredField(nextRow, ["Title"], productPlan.productInput?.title || "");
      setPreferredField(nextRow, ["Body (HTML)"], productPlan.productInput?.descriptionHtml || "");
      setPreferredField(nextRow, ["SEO Title"], exportSeoTitle);
      setPreferredField(nextRow, ["SEO Description"], productPlan.productInput?.seo?.description || "");
    } else if (isPrimaryRow && productPlan.rewriteLevel === "medium") {
      setPreferredField(nextRow, ["SEO Title"], exportSeoTitle);
      setPreferredField(nextRow, ["SEO Description"], productPlan.productInput?.seo?.description || "");
    }

    if (isPrimaryRow && Object.prototype.hasOwnProperty.call(nextRow, "Tags")) {
      nextRow.Tags = reconcileManagedMinimumQuantityTags(nextRow.Tags, productPlan.desiredQuantityTag).join(", ");
    }

    if ((productPlan.contentRewriteLevel || productPlan.rewriteLevel) === "high") {
      const mediaUpdate = buildMediaPlanFromRow(row, profile);
      if (mediaUpdate) {
        setPreferredField(nextRow, ["Image Alt Text"], mediaUpdate.alt);
      }
    }

    const variantUpdate = buildVariantRowUpdate(row, profile);
    if (variantUpdate) {
      setPreferredField(nextRow, ["Variant Price", "Price / International"], variantUpdate.price);
      if (variantUpdate.compareAtPrice) {
        setPreferredField(
          nextRow,
          ["Variant Compare At Price", "Compare At Price / International"],
          variantUpdate.compareAtPrice,
        );
      }
    }

    return nextRow;
  });
}

export function buildSeoBatchManifest(plan, { inputPath = "", mode = "dry-run" } = {}) {
  return {
    title: "Handle-First US Marketplace Product Intelligence",
    knowledgeBank: {
      version: PRODUCT_CONTENT_KNOWLEDGE_VERSION,
      market: MARKETPLACE_CONTENT_POLICY.market,
      sources: MARKETPLACE_CONTENT_POLICY.sources,
    },
    generatedAt: new Date().toISOString(),
    mode,
    inputPath,
    summary: plan?.summary || {},
    warnings: plan?.warnings || [],
    products: (plan?.products || []).map((entry) => ({
      handle: entry.handle,
      rowCount: entry.rowCount,
      confidence: entry.confidence,
      rewriteLevel: entry.rewriteLevel,
      contentRewriteLevel: entry.contentRewriteLevel,
      firstRowIndex: entry.firstRowIndex,
      productId: entry.productId,
      categoryQuery: entry.categoryQuery || "",
      categoryId: entry.categoryId || "",
      changedFields: [
        entry.productInput?.title ? "title" : "",
        entry.productInput?.descriptionHtml ? "body" : "",
        entry.productInput?.seo?.title ? "seo-title" : "",
        entry.productInput?.seo?.description ? "seo-description" : "",
        entry.categoryId ? "category" : "",
        entry.variantUpdates?.length ? "price" : "",
        entry.mediaTargets?.length ? "image-alt" : "",
        entry.managedQuantityTagChange ? "managed-minimum-quantity-tag" : "",
      ].filter(Boolean),
      skippedFields: entry.skipped || [],
      writeCount: entry.writeCount || 0,
      reasons: entry.reasons || [],
      pricing: entry.intelligence?.pricing || null,
      reviewSummary: entry.intelligence?.reviewSummary || null,
      knowledge: entry.intelligence?.knowledge || null,
      seo: {
        title: entry.productInput?.seo?.title || "",
        description: entry.productInput?.seo?.description || "",
      },
      desiredQuantityTag: entry.desiredQuantityTag || "",
      managedQuantityTagChange: Boolean(entry.managedQuantityTagChange),
    })),
  };
}

export { buildLegacyMediaUpdateTargets as buildMediaUpdateTargets };
