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

export const PER_ORDER_OVERHEAD = 16;
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
const GENERIC_HUMAN_TYPE_PATTERN = /^(?:beauty|electronics?|fashion|fitness|home|outdoor|personal care|sports?)\s+(?:accessory|item|product|gear)|^(?:general|miscellaneous|other|practical)\s+(?:item|product)$/i;

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
  ["t-shirt-t-shirt-t-shirt", "Everyday T-Shirt for Casual Clothing"],
  ["candy-candy-anime", "Candy Candy Anime Graphic T-Shirt Top"],
  ["nana-anime", "Nana Anime Graphic Printed T-Shirt Top"],
  ["nana-anime-1", "Nana Anime Graphic Printed T-Shirt Top"],
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
        hdmi: "HDMI",
        ipad: "iPad",
        iphone: "iPhone",
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
    .join(" ");
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

export function buildHandleAlignedTitle(signals) {
  const handle = normalizeHandleValue(signals.handle);
  const semanticHandle = normalizeHandleValue([
    signals.handle,
    signals.sourceTitle,
    signals.catalogTitle,
    signals.sourceProductType,
    signals.catalogProductType,
  ].filter(Boolean).join(" "));
  if (/^link-for-price-difference(?:-|$)/i.test(handle)) {
    return "Order Price Difference Adjustment";
  }
  if (/(?:3[ .-]?5\s*mm|35mm).*?(?:aux|audio).*cable.*(?:xh2|terminal)|(?:aux|audio).*cable.*(?:xh2|terminal)/i.test(semanticHandle)) {
    return "3.5mm AUX Audio Cable with XH2.54 3-Pin Male Terminals";
  }
  if (/screen-auto-clicker|auto-clicker.*(?:screen|phone)|(?:screen|phone).*auto-clicker/i.test(handle)) {
    return "Screen Auto Clicker for Smartphones and Apps";
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
  if (/(?:phone|smartphone|mobile-phone).*(?:case|holder|mount|pouch)|(?:case|holder|mount|pouch).*(?:phone|smartphone|mobile-phone)/i.test(semanticHandle) && !/tripod|selfie-stick|gimbal/i.test(semanticHandle)) {
    const features = [
      /fixed|stationary/i.test(semanticHandle) ? "Fixed" : "",
      /universal/i.test(semanticHandle) ? "Universal" : "",
      /waterproof|water-resistant/i.test(semanticHandle) ? "Waterproof" : "",
      /anti-fog|antifog|fog-resistant/i.test(semanticHandle) ? "Anti-Fog" : "",
    ].filter(Boolean);
    const setting = /bathroom|shower/i.test(semanticHandle) ? "Shower" : "";
    const phoneCase = /(?:iphone|ipad|phone|smartphone|mobile-phone).*(?:case|cover)|(?:case|cover).*(?:iphone|ipad|phone|smartphone|mobile-phone)/i.test(semanticHandle);
    if (phoneCase) {
      const caseFeatures = [
        /custom/i.test(semanticHandle) ? "Custom" : "",
        /magnetic|magsafe|macsafe/i.test(semanticHandle) ? "Magnetic" : "",
        /shockproof/i.test(semanticHandle) ? "Shockproof" : "",
        /waterproof|ip68|water-resistant/i.test(semanticHandle) ? "Waterproof" : "",
        /transparent|clear/i.test(semanticHandle) ? "Transparent" : "",
        /denim/i.test(semanticHandle) ? "Denim" : "",
        /leather/i.test(semanticHandle) ? "Leather" : "",
        /silicone|silicon|tpu/i.test(semanticHandle) ? "Silicone" : "",
        /embroidered|illustration|cartoon/i.test(semanticHandle) ? "Illustrated" : "",
        /leopard/i.test(semanticHandle) ? "Leopard Print" : "",
        /hearts?|monkey/i.test(semanticHandle) ? "Printed" : "",
        /floral|flower|wave|star|patchwork/i.test(semanticHandle) ? "Patterned" : "",
      ].filter(Boolean);
      const modelMatch = semanticHandle.match(/\biphone-(\d{1,2}e?|x|xr|xs|se|air)(?:-(?:pro|max|plus|mini))*\b/i);
      const model = modelMatch ? `iPhone ${modelMatch[1].toUpperCase() === "AIR" ? "Air" : modelMatch[1]}` : "iPhone";
      const multipleModels = /\biphone-(?:\d{1,2}e?|x|xr|xs|se|air)(?:-(?:pro|max|plus|mini))*-(?:\d{1,2}e?|x|xr|xs|se|air)\b/i.test(semanticHandle) || /\bcases?-iphone\b/i.test(semanticHandle);
      const brand = /\bugreen\b/i.test(semanticHandle) ? "Ugreen " : "";
      return `${brand}${caseFeatures.slice(0, 3).join(" ")}${caseFeatures.length ? " " : ""}${model} Case${multipleModels ? " for Multiple Models" : ""}`.trim();
    }
    const productNoun = /case.*holder|holder.*case/i.test(semanticHandle)
      ? "Phone Holder Case"
      : /holder|mount/i.test(semanticHandle)
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
  const evidence = normalizeComparableText(
    [signals.handle, titleText, signals.sourceProductType, signals.catalogProductType].filter(Boolean).join(" "),
  );
  const exactTypes = [
    [/screen[- ]?auto[- ]?clicker|auto[- ]?clicker.*(?:screen|phone)|(?:screen|phone).*auto[- ]?clicker/i, "screen auto clicker"],
    [/(?:pet|dog|cat).*(?:nail clipper|claw trimmer)|(?:nail clipper|claw trimmer).*(?:pet|dog|cat)/i, "pet nail clipper"],
    [/(?:rca|coaxial).*cable|cable.*(?:rca|coaxial)/i, "RCA coaxial audio cable"],
    [/f40.*sweater|sweater.*f40|mens and womens.*sweater/i, "patterned sweater"],
    [/(?:3\s*5\s*mm|35mm).*?(?:aux|audio).*cable|(?:aux|audio).*cable.*(?:xh2|terminal)/i, "3.5mm AUX audio cable"],
    [/(?:inflatable|air).*mattress|mattress.*(?:inflatable|camping|sleeping)/i, "inflatable camping mattress"],
    [/(?:tactical|molle).*backpack|backpack.*(?:tactical|molle)|\bruck sack\b/i, "tactical backpack"],
    [/(?:squeegees?|window cleaning).*\b(?:window|glass)\b|\b(?:window|glass)\b.*(?:squeegees?|window cleaning)/i, "window and glass squeegee"],
    [/(?:thermos|tumbler|water bottle).*\b(?:straw|insulated)\b|\b(?:straw|insulated)\b.*(?:thermos|tumbler|water bottle)/i, "insulated drink bottle"],
    [/articulated arm.*(?:hex pin|female thread)|(?:hex pin|female thread).*articulated arm/i, "articulated camera mounting arm"],
    [/\b(?:ear hooks?|anti lost ear hooks?)\b/i, "earbud ear hooks"],
    [/\b(?:ear tips?|eartips?)\b/i, "earbud replacement ear tips"],
    [/(?:earbud|airpods?|buds?).*\b(?:case|cover)\b|\b(?:case|cover).*\b(?:earbud|airpods?|buds?)\b/i, "earbud protective case"],
    [/\b(?:sports arm bag|arm pouch|running arm bag)\b/i, "fitness arm bag"],
    [/(?:powerbank|power bank|external battery)/i, "magnetic wireless power bank"],
    [/(?:\breplacement\b|\brepair\b).*\b(?:microphone|mic)\b|\b(?:microphone|mic)\b.*(?:\breplacement\b|\brepair\b)/i, "replacement headset microphone"],
    [/\b(?:microphone|mic)\b.*\b(?:headset|headphone|earphone)\b|\b(?:headset|headphone|earphone)\b.*\b(?:microphone|mic)\b/i, "wired headset with microphone"],
    [/\b(?:ear pads?|earpads?|earphone pads?|headphone pads?)\b/i, "headphone replacement earpads"],
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
    if (pattern.test(evidence)) return type;
  }

  const rawType = sanitizeMarketplaceClaims(normalizePlainText(signals.productTypeText || signals.sourceProductType || signals.catalogProductType));
  if (
    rawType &&
    !/^(?:accessories?|item|product|general|miscellaneous|other)$/i.test(rawType) &&
    !GENERIC_HUMAN_TYPE_PATTERN.test(rawType) &&
    isTitleAlignedWithKnowledge(rawType, knowledge)
  ) {
    return rawType.toLowerCase();
  }

  const fallbackType = normalizePlainText(knowledge.productNouns?.[0] || "product").toLowerCase();
  return GENERIC_HUMAN_TYPE_PATTERN.test(fallbackType) ? "item" : fallbackType;
}

function buildHumanProductSummary(titleText, signals, knowledge, facts) {
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

  if (/(?:3\s*5\s*mm|35mm).*?(?:aux|audio).*cable.*(?:xh2|terminal)|(?:aux|audio).*cable.*(?:xh2|terminal)/i.test(evidence)) {
    return "This cable connects a 3.5mm AUX audio plug with an XH2.54 3-pin terminal in the male-to-male layout named by the listing.";
  }
  if (/screen[- ]?auto[- ]?clicker|auto[- ]?clicker/i.test(evidence)) {
    return "This screen auto clicker simulates repeated taps on a compatible smartphone app; check the phone fit and listed control method before ordering.";
  }
  if (/(?:pet|dog|cat).*(?:nail[- ]?clipper|claw[- ]?trimmer)|(?:nail[- ]?clipper|claw[- ]?trimmer).*(?:pet|dog|cat)/i.test(evidence)) {
    return "This pet nail clipper is for trimming dog or cat claws; check the cutting size and safety features before use.";
  }
  if (/f40.*sweater|sweater.*f40|mens[- ]and[- ]womens.*sweater/i.test(evidence)) {
    return "This F40 patterned sweater uses the car motif named in the listing for fall and winter wear; check the listed fabric and fit before ordering.";
  }
  if (/(?:3\s*5\s*mm|35mm).*?(?:aux|audio).*cable/i.test(evidence)) {
    return "This cable carries the 3.5mm AUX audio connection named in the listing; check the device-side connector and cable length before ordering.";
  }
  if (/\b(?:hot shoes?|hot shoe|camera shoe)\b/i.test(evidence)) {
    return "This camera hot-shoe mount holds the compatible accessory format named in the title; check the shoe size and thread details before ordering.";
  }
  if (/(?:dcdc|dc-dc).*power module|power module.*(?:dcdc|dc-dc)/i.test(evidence)) {
    return "This set contains DC-DC power modules for the voltage range listed in the title; check the input, output, pinout, and quantity before wiring.";
  }
  if (/\b(?:softbox|honeycomb grid)\b/i.test(evidence)) {
    return "This studio softbox shapes and softens light for the Bowens-compatible setup named in the listing; check the mount and selected size before ordering.";
  }
  if (/\b(?:dive case|underwater housing|diving case)\b/i.test(evidence)) {
    return "This waterproof camera housing is made for the camera model and underwater use named in the listing; check the fit, seals, and listed depth rating before use.";
  }
  if (/\b(?:shutter release|remote shutter)\b/i.test(evidence)) {
    return "This shutter-release cable connects the camera and remote-control formats named in the listing; match the connector and camera model before ordering.";
  }
  if (/\b(?:usb extension|usb extender)\b/i.test(evidence)) {
    return "This USB extension cable adds reach between the plug and socket formats named in the listing; check the connector, cable length, and device requirements before use.";
  }
  if (/\b(?:lipo battery|li-ion battery|rechargeable battery)\b/i.test(evidence)) {
    return "This rechargeable battery pack is listed for the device or vehicle format named in the title; match the voltage, capacity, connector, and dimensions before use.";
  }
  if (/\b(?:controller cover|gamepad cover|joystick cover)\b/i.test(evidence)) {
    return "This controller cover is shaped for the gamepad format named in the listing; confirm the console model and button layout before fitting.";
  }
  if (/\b(?:digital antenna|tv antenna|dvb-t antenna)\b/i.test(evidence)) {
    return "This digital TV antenna is for receiving the broadcast format named in the listing; check local signal compatibility and the connection before setup.";
  }
  if (/\b(?:rubber plugs?|rubber replacement)\b/i.test(evidence)) {
    return "These replacement rubber plugs cover the console openings and screw points named in the listing; match the console model before fitting.";
  }
  if (/\b(?:micro switch|microswitch)\b/i.test(evidence)) {
    return "This controller micro-switch is a replacement button component for the console or joystick format named in the listing; match the board and switch layout before repair.";
  }
  if (/\b(?:bluetooth aux adapter|aux adapter|audio bluetooth adapter)\b/i.test(evidence)) {
    return "This Bluetooth AUX adapter adds the wireless audio connection named in the listing; check the source, receiver, power, and 3.5mm connector before use.";
  }
  if (/\b(?:sports arm bag|arm pouch|running arm bag)\b/i.test(evidence)) {
    return "This fitness arm bag holds a phone during running or outdoor activity; check the arm fit, pocket size, and water-resistant material before use.";
  }
  if (/(?:powerbank|power bank|external battery)/i.test(evidence)) {
    return "This magnetic wireless power bank is designed for the charging formats named in the listing; check the device, wattage, capacity, and connector before use.";
  }
  if (/\b(?:projector disc|galaxy projector disc|film discs?)\b/i.test(evidence)) {
    return "These replacement projector film discs add the galaxy or meteor scenes named in the listing; confirm the projector model before ordering.";
  }
  if (/\b(?:led strip.*tv|tv.*led strip)\b/i.test(evidence)) {
    return "This LED backlight strip is sized for the TV model range named in the listing; match the screen size, connector, and strip layout before fitting.";
  }
  if (/\b(?:audio mixer|mixing console)\b/i.test(evidence)) {
    return "This multi-channel audio mixer combines the input and control functions listed for a stage, studio, or personal audio setup; check the channel and connection layout before ordering.";
  }
  if (/\b(?:rca.*cable|coaxial cable)\b/i.test(evidence)) {
    return "This RCA audio cable connects the male-to-male equipment formats named in the listing; check the connector type and cable length before ordering.";
  }
  if (/\b(?:facial toner pads?|toner pads?|exfoliating pads?)\b/i.test(evidence)) {
    return "These facial toner pads fit the exfoliating step in a skin-care routine, with the listed AHA and BHA ingredients, pad count, and application directions to check before use.";
  }
  if (/\b(?:mattress|sleeping pad)\b/i.test(evidence)) {
    return `${subject} ${typeText} ${linkingVerb} for the indoor or outdoor sleeping use named in the title${size ? ` and the listed ${size} size` : ""}.`;
  }
  if (/\b(?:squeegees?|window cleaning|glass cleaning)\b/i.test(evidence)) {
    return `${subject} ${typeText} ${linkingVerb} for cleaning windows and glass in the household settings named in the title.`;
  }
  if (/articulated arm.*(?:hex pin|female thread)|(?:hex pin|female thread).*articulated arm/i.test(evidence)) {
    return "This articulated arm positions a compatible camera, light, or studio accessory using the 5/8 hex pin and threaded fittings listed in the title.";
  }
  if (/\b(?:tripod|selfie stick|gimbal)\b/i.test(evidence)) {
    return `${subject} ${typeText} is for supporting ${devicePhrase || "a smartphone or camera"}${setting ? ` in ${setting.toLowerCase()}` : ""}.`;
  }
  if (/\b(?:phone holder|phone stand|mobile phone holder|car phone mount)\b/i.test(evidence)) {
    return `${subject} ${typeText} keeps ${devicePhrase || "a phone"} in the holder format named by the listing${setting ? ` for ${setting.toLowerCase()} use` : ""}.`;
  }
  if (/\b(?:screen protector|tempered glass|hydrogel film)\b/i.test(evidence)) {
    return `${subject} ${typeText} is sized for the device or screen format named in the title${device ? `, including ${device}` : ""}.`;
  }
  if (/\b(?:case|cover|pouch|sleeve)\b/i.test(evidence) && device) {
    return `${subject} ${typeText} is sized for ${devicePhrase}; check the exact model and case or cover fit before ordering.`;
  }
  if (/silicone-case-for-xiaomi-redmi-pad-2|redmi-pad-2.*(?:case|cover)/i.test(evidence)) {
    return "This silicone case is sized for the Xiaomi Redmi Pad 2 11-inch tablet and folds into the trifold stand format named in the listing; check the exact model before ordering.";
  }
  if (/\b(?:charger|charging dock|charging stand)\b/i.test(evidence)) {
    return `${subject} ${typeText} is for charging the battery or device format named in the listing; confirm voltage, connector, and compatibility before use.`;
  }
  if (/\b(?:replacement|repair)\b.*\b(?:ear pads?|earpads?|earphone pads?|headphone pads?|ear tips?|ear hooks?|earbuds?|earphones?|headphones?)\b|\b(?:ear pads?|earpads?|earphone pads?|headphone pads?|ear tips?|ear hooks?|earbuds?|earphones?|headphones?)\b.*\b(?:replacement|repair)\b/i.test(evidence)) {
    return `${subject} ${typeText} ${linkingVerb} replacement audio accessories for the headphone or earbud format named in the title; match the model before ordering.`;
  }
  if (/\b(?:replacement|repair|pcb|circuit board|component)\b/i.test(evidence)) {
    return `${subject} ${typeText} is the replacement or repair component identified by the title, so the listed model and connector details should match before ordering.`;
  }
  if (/\b(?:stylus|digital pen|touch pen)\b/i.test(evidence)) {
    return "This stylus pen is for writing or drawing on a compatible touchscreen device; check the listed model and options before ordering.";
  }
  if (/\b(?:eye mask|eye mask pad)\b/i.test(evidence)) {
    return "This eye mask replacement pad is shaped for the eye-mask format named in the title; match the dimensions and fastening details before ordering.";
  }
  if (/\b(?:pencil case|pencil box|pen holder|stationery case)\b/i.test(evidence)) {
    return "This stationery case keeps pens, pencils, and other small supplies together in the storage format named by the listing.";
  }
  if (/\b(?:ear hooks?|ear tips?|earbuds?|earphones?|headphones?|headset)\b/i.test(evidence)) {
    return `${subject} ${typeText} ${linkingVerb} intended for the personal-audio format named in the title${device ? ` and the listed ${device} compatibility` : ""}.`;
  }
  if (/\b(?:dress|shirt|top|blouse|jacket|coat|pants|trousers|jeans|skirt|leggings|hoodie|outfit|romper)\b/i.test(evidence)) {
    return `${subject} ${typeText} is built around the garment style and options named in the title${setting ? ` for ${setting.toLowerCase()} wear` : ""}.`;
  }
  if (/\b(?:crampons?|mountaineering cleats?|ice grips?|traction cleats?)\b/i.test(evidence)) {
    return "This traction cleat set fits over compatible footwear for hiking or mountaineering; check the listed size and fastening details before ordering.";
  }
  if (/\b(?:shoes?|sandals?|boots?|sneakers?|slippers?)\b/i.test(evidence) && !/\bhot shoes?\b/i.test(evidence)) {
    return `${subject} ${typeText} ${linkingVerb === "are" ? "follow" : "follows"} the footwear style named in the title, with the listed size and color options available for comparison.`;
  }
  if (/\b(?:ring|necklace|earring|bracelet|jewelry|brooch|hair clip|headband|scrunchie|scarf|belt|hat|cap)\b/i.test(evidence)) {
    return `${subject} ${typeText} ${subject === "These" ? "add" : "adds"} the wearable detail named in the title, with the listed design and option details helping you choose the right finish.`;
  }
  if (/\b(?:bag|backpack|tote|wallet|purse|organizer|laptop sleeve|card holder)\b/i.test(evidence)) {
    return `${subject} ${typeText} ${linkingVerb} designed around the carrying or storage format named in the title${size ? `, including the listed ${size} capacity` : ""}.`;
  }
  if (/\b(?:water bottle|shaker bottle|flask|thermos|tumbler|travel mug)\b/i.test(evidence)) {
    return `${subject} ${typeText} is for carrying drinks in the capacity and lid format named in the listing${size ? `, including ${size}` : ""}.`;
  }
  if (/\b(?:dog|cat|aquarium|leash|pet bed|pet toy|pet food|pet grooming|pet supplies)\b/i.test(evidence)) {
    return `${subject} ${typeText} is for the pet-care task and animal format named in the title, so check the listed size and options before ordering.`;
  }
  if (/\b(?:baby|toddler|diaper|stroller|kids|children|bib)\b/i.test(evidence)) {
    return `${subject} ${typeText} is designed around the child or caregiver use named in the title, with the listed age, size, or option details to check before ordering.`;
  }
  if (/\b(?:lamp|lighting|lantern|bulb|led|wall light|desk light|ceiling light|night light)\b/i.test(evidence)) {
    return `${subject} ${typeText} ${subject === "These" ? "add" : "adds"} the lighting format and placement named in the title${setting ? ` for ${setting.toLowerCase()} use` : ""}.`;
  }
  if (/\b(?:kitchen|cookware|pot|pan|spatula|peeler|cutter|knife|measuring)\b/i.test(evidence)) {
    return `${subject} ${typeText} ${linkingVerb} for the kitchen preparation or serving task named in the title, with the listed size and material details to check before use.`;
  }
  if (/\b(?:comb|brush|trimmer|shaver|razor|clipper|grooming)\b/i.test(evidence)) {
    return `${subject} ${typeText} ${linkingVerb} for the grooming or hair-care task named in the title and should be used only as directed for that task.`;
  }

  const safeType = typeText && !/^product$/i.test(typeText) ? typeText : "item";
  const identity = titleText || safeType;
  const detailFacts = (facts || [])
    .filter((fact) => fact?.label && fact.label !== "Product focus" && fact?.value)
    .slice(0, 3)
    .map((fact) => `${fact.label.toLowerCase()}: ${fact.value}`)
    .join("; ");
  const article = /^[aeiou]/i.test(safeType) ? "an" : "a";
  return `The ${identity} is listed as ${article} ${safeType}.${detailFacts ? ` Listed details include ${detailFacts}.` : " Check the listed fit, size, connection, and care details before ordering."}`;
}

function buildEvidenceBackedSummary(titleText, signals, knowledge, facts) {
  const identity = titleText || buildSafeHandleTitle(signals) || "product";
  const rawType = normalizePlainText(humanProductType(signals, identity, knowledge));
  const typeText = rawType && !/^item$|^product$/i.test(rawType) ? rawType : "product";
  const article = /^[aeiou]/i.test(typeText) ? "an" : "a";
  const detailFacts = (facts || [])
    .filter((fact) => fact?.label && fact.label !== "Product focus" && fact?.value)
    .slice(0, 3)
    .map((fact) => `${fact.label.toLowerCase()}: ${fact.value}`)
    .join("; ");
  return `The ${identity} is listed as ${article} ${typeText}.${detailFacts ? ` Listed details include ${detailFacts}.` : " Check the listed specifications and compatibility details before ordering."}`;
}

function buildProductDrivenHumanSummary(titleText, signals, knowledge, facts) {
  const summary = buildHumanProductSummary(titleText, signals, knowledge, facts);
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
  const requiredMatches = titleTokens.length >= 2 ? 2 : 1;
  const summaryUsesBroadFamilyLabel = GENERIC_HUMAN_TYPE_PATTERN.test(
    normalizePlainText(humanProductType(signals, titleText, knowledge)),
  );
  if (!summaryUsesBroadFamilyLabel && matchedIdentityTokens.length >= requiredMatches) {
    return summary;
  }
  return buildEvidenceBackedSummary(titleText, signals, knowledge, facts);
}

function buildSeoDescription(title, signals, searchPhrases) {
  const titleText = normalizePlainText(title);
  const knowledge = resolveProductKnowledge(signals.handle);
  const facts = prioritizeProductFacts(extractSupportedProductFacts(signals), knowledge)
    .filter((fact) => fact.label !== "Product focus");
  const identity = titleText || buildSafeHandleTitle(signals) || "Product listing";
  const identityEvidence = normalizeComparableText(`${signals.handle || ""} ${identity}`);
  if (/f40.*sweater|sweater.*f40|mens and womens.*sweater/i.test(identityEvidence)) {
    return normalizePlainText(
      `The ${identity} uses the car motif named in the listing for fall and winter wear. Check the listed fabric and fit before ordering.`,
    );
  }
  const rawType = normalizePlainText(humanProductType(signals, identity, knowledge));
  const typeText = rawType && rawType !== "item" && !GENERIC_HUMAN_TYPE_PATTERN.test(rawType)
    ? rawType
    : "";
  const article = /^[aeiou]/i.test(typeText) ? "an" : "a";
  const useValue = humanizeFactList(firstFactValue(facts, ["Use or occasion", "Placement or setting"]));
  const fact = facts.find((entry) => [
    "Device compatibility",
    "Size or capacity",
    "Material",
    "Supported features",
    "Available options",
    "Pack format",
  ].includes(entry.label));
  const factValue = fact ? shortenAtWordBoundary(fact.value, 34) : "";
  const factClause = fact
    ? fact.label === "Device compatibility"
      ? `${factValue} compatibility`
      : fact.label === "Size or capacity"
        ? `${factValue} capacity`
        : fact.label === "Material"
          ? `${factValue} material`
          : fact.label === "Supported features"
            ? `${factValue} features`
            : fact.label === "Pack format"
              ? `${factValue} pack`
              : "available options"
    : "options";
  const useSentence = useValue
    ? `It is listed for ${useValue.toLowerCase()} use.`
    : "It follows the product format named in the listing.";
  const detailSentence = `Check the listed ${factClause} before ordering.`;
  const reviewSentence = signals.reviewSummary
    ? `Reviews average ${signals.reviewSummary.rating.toFixed(1)} stars from ${signals.reviewSummary.ratingCount} buyers.`
    : "";
  const lead = typeText
    ? `The ${identity} is ${article} ${typeText}.`
    : `The ${identity} is the product format named in the listing.`;
  const fallback = buildEvidenceBackedSummary(identity, signals, knowledge, facts);
  const candidates = [
    `${lead} ${useSentence} ${detailSentence} ${reviewSentence}`,
    `${lead} ${detailSentence} ${useSentence}`,
    `${lead} ${detailSentence}`,
    `${lead} ${useSentence}`,
    `${lead} ${detailSentence} Review the listed specifications before ordering.`,
    `${fallback} ${useSentence} ${detailSentence}`,
    `${fallback} Review the listed specifications and available options before ordering.`,
  ].map((candidate) => normalizePlainText(candidate));
  const validCandidate = candidates
    .filter((candidate) => candidate.length >= 120 && candidate.length <= 170)
    .sort((left, right) => right.length - left.length)[0];
  if (validCandidate) return validCandidate;

  let sentence = candidates.find((candidate) => candidate.length <= 170) || fallback;
  if (sentence.length < 120) {
    sentence = `${sentence} Review fit, setup, and available options before ordering.`;
  }
  return shortenAtWordBoundary(sentence, 170).replace(/[,:;-]+$/g, "").trim().replace(/[.!?]?$/, ".");
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
  add("Intended user", ["women", "men", "unisex", "girls", "boys", "kids", "children", "baby", "toddler", "pet", "dog", "cat"]
    .filter((term) => new RegExp(`\\b${term}\\b`).test(source))
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
    "Size or capacity": `Available size or capacity: ${fact.value}.`,
    "Connector size": `Connector size: ${fact.value}.`,
    Connection: `Connection format: ${fact.value}.`,
    "Connector layout": `Connector layout: ${fact.value}.`,
    Material: `Identified material: ${fact.value}.`,
    "Supported features": `Functional details include ${fact.value}.`,
    "Intended user": `Intended for ${fact.value}.`,
    "Use or occasion": `Relevant for ${fact.value}.`,
    "Style or design": `Design direction: ${fact.value}.`,
    "Placement or setting": `Suitable setting: ${fact.value}.`,
    "Device compatibility": `Device compatibility includes ${fact.value}.`,
    "Pack format": `Pack format: ${fact.value}.`,
    "Available options": `Available choices include ${fact.value}.`,
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
  const audioCable = /(?:3[ .-]?5\s*mm|35mm).*?(?:aux|audio).*cable|(?:aux|audio).*cable.*(?:xh2|terminal)/i.test(family);
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
  const fallbackDetails = "Check the exact size, compatibility, materials, and care information listed for this item before ordering.";
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
    tool: { purpose: "supports the specific grooming, household, workshop, or maintenance task named in the product", use: "Use it only for its stated task and follow the supplied handling, cleaning, storage, and safety instructions.", benefit: "Its task-focused format helps shoppers compare operation and intended use directly.", audience: ["Shoppers looking for a tool for a defined task", "People comparing tool formats and listed options", "Buyers adding a practical item to a routine or kit"] },
    "fashion-accessory": { purpose: "adds a specific finishing detail to an outfit or daily routine", use: "Style or wear it according to the accessory type and coordinate it with the listed color, size, or design options.", benefit: "Its accessory format makes it easy to compare for everyday, travel, work, or occasion styling.", audience: ["Shoppers finishing a specific outfit", "People comparing accessory styles and listed options", "Gift buyers choosing a wearable or practical accessory"] },
    general: { purpose: "serves the specific everyday task identified by the product name", use: "Use it only for the stated purpose and follow the supplied setup, handling, care, and storage instructions.", benefit: "Its product format and listed options support direct comparison for the intended routine.", audience: ["Shoppers looking for this specific product type", "People comparing options for the stated task", "Gift buyers choosing a practical item"] },
  }[category];
  // A model/taxonomy conflict must not leak the wrong family's generic copy
  // into the product body. Keep the deterministic handle family copy until
  // the classification gate is resolved.
  if (!classificationHeld) {
    categoryCopy = knowledge.copy || categoryCopy;
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
  } else if (category === "electronics-accessory" && audioCable) {
    categoryCopy = {
      purpose: "connects the 3.5mm AUX audio and XH2.54 3-pin terminal formats named by the product",
      use: "Check the 3.5mm plug, XH2.54 3-pin spacing, and male-to-male layout against the equipment before ordering. Connect it only to compatible terminals and avoid pulling on the cable or plugs.",
      benefit: "The connector formats and pin layout make it easier to check fit before adding the cable to an audio or electronics setup.",
      audience: ["Shoppers replacing an AUX or terminal audio lead", "DIY electronics users checking connector compatibility", "Buyers comparing audio extension cable formats"],
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
  if (/\b(?:phone holder|phone stand|mobile phone holder|car phone mount)\b/i.test(family)) {
    productUseText = "Check that the phone fits the holder and secure the mount to a stable surface before use. Recheck the grip and mounting point regularly.";
  } else if (/\b(?:stylus|digital pen|touch pen)\b/i.test(family)) {
    productUseText = "Confirm the stylus matches the intended touchscreen device, then use the listed tip or magnetic features according to the supplied instructions.";
  } else if (/\b(?:pencil case|pencil box|pen holder|stationery case)\b/i.test(family)) {
    productUseText = "Load pens, pencils, or other suitable stationery without overfilling the case, then close and store it in a dry place.";
  } else if (/\b(?:comb hair brush cleaner|hair brush cleaner|comb cleaner)\b/i.test(family)) {
    productUseText = "Use the tool to remove hair and debris from a brush or comb, then clear the tool and store it dry between uses.";
  } else if (/\b(?:screen protector|tempered glass|hydrogel film)\b/i.test(family)) {
    productUseText = "Confirm the screen model and size before fitting, clean the display, and apply the protector according to the supplied installation instructions.";
  } else if (/\b(?:case|cover|pouch|sleeve)\b/i.test(family)) {
    productUseText = "Confirm the device model and dimensions before fitting the case, cover, pouch, or sleeve, and keep the closure or protective surface clean.";
  } else if (/\bfitness-keychain\b/i.test(family)) {
    productUseText = "Use the keychain for the stated gym or sports theme and attach it securely to a bag, keys, or compatible loop.";
  }
  const facts = prioritizeProductFacts(extractSupportedProductFacts(signals), knowledge);
  const sourceSpecificationFacts = cleanDescriptionSpecificationFacts(
    extractLabeledSpecificationFacts(getRawSpecificationSource(signals)),
  );
  const customerFacts = audioCable
    ? [
        { label: "Connector size", value: "3.5mm AUX", key: "size" },
        { label: "Connection", value: "AUX audio to XH2.54 3-pin terminal", key: "type" },
        { label: "Connector layout", value: "Male-to-male", key: "features" },
        ...facts.filter((fact) => fact.label !== "Size or capacity"),
      ]
    : cameraMountingArm
      ? [
          { label: "Arm format", value: "3-section double articulated arm", key: "type" },
          { label: "Mounting fittings", value: "5/8 hex pin with 1/4-20 and 3/8-16 female threads", key: "compatible_device" },
          ...facts.filter((fact) => fact.label !== "Product focus"),
        ]
    : facts;
  const productFocusFact = customerFacts.find((fact) => fact.label === "Product focus");
  const visibleFacts = customerFacts.length > 1 ? customerFacts.filter((fact) => fact.label !== "Product focus") : customerFacts;
  const focus = productFocusFact?.value || handleDescriptorPhrase || handleIdentity.toLowerCase();
  const reviewText = signals.reviewSummary
    ? ` Current review data records a ${signals.reviewSummary.rating.toFixed(1)}-star average from ${signals.reviewSummary.ratingCount} trusted reviews.`
    : "";
  const evidenceSummary = uniqueValues([
    ...sourceSpecificationFacts.slice(0, 4).map(formatCustomerSpecificationFact),
  ]).slice(0, 5).join("; ");
  const humanSummary = buildProductDrivenHumanSummary(titleText, signals, knowledge, facts);
  const overview = `<p><strong>${escapeHtml(titleText)}</strong> &mdash; ${escapeHtml(humanSummary)} ${evidenceSummary ? `The listing also notes ${escapeHtml(evidenceSummary)}.` : ""}${escapeHtml(reviewText)}</p>`;
  const factualDetails = uniqueValues([
    ...visibleFacts.map((fact) => audioCable && ["Connector size", "Connection", "Connector layout"].includes(fact.label)
      ? `${fact.label}: ${fact.value}`
      : `${fact.label}: ${fact.value}`),
    typeText ? `Product type: ${typeText}` : "",
  ])
    .filter((item) => normalizePlainText(item).length >= 6)
    .slice(0, 14);
  if (!factualDetails.length) {
    factualDetails.push(`Product focus: ${focus}`);
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

  const campaignCost = PER_ORDER_OVERHEAD;
  let derivedFromCost = null;
  if (Number.isFinite(numericCost) && numericCost > 0) {
    const multiplier = numericCost < 5 ? 4.2 : numericCost < 15 ? 3.25 : numericCost < 30 ? 2.75 : numericCost < 50 ? 2.35 : 1.95;
    derivedFromCost = Math.max(numericCost + campaignCost, numericCost * multiplier);
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
    target = Math.max(target, reference + PER_ORDER_OVERHEAD);
  }
  if (reference && target < reference * 1.15) {
    target = reference * 1.15;
  }

  if (derivedFromCost) {
    target = Math.max(target, numericCost + PER_ORDER_OVERHEAD);
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
      candidate: /(?:3\.5mm|XH2\.54|USB-C|DC-DC|iPhone|iPad|mAh|\d+-in-\d+|5\/8|1\/4-20|3\/8-16)/i.test(handleAlignedTitle)
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
    ? /(?:3\.5mm|XH2\.54|USB-C|DC-DC|iPhone|iPad|mAh|\d+-in-\d+|5\/8|1\/4-20|3\/8-16|Hot-Shoe)/i.test(directHandleTitle)
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
  const seoDescription = buildSeoDescription(canonicalTitle, signals, searchPhrases);
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
          ? `Cost ${formatMoneyValue(signals.sourceCost)} plus $${PER_ORDER_OVERHEAD} per-order overhead, with a 35%+ uplift guarded by the current catalog anchor`
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
