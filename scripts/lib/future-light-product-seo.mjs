const HTML_ENTITY_REPLACEMENTS = [
  [/&amp;|&#38;/gi, "&"],
  [/&quot;|&#34;/gi, '"'],
  [/&#39;|&apos;/gi, "'"],
  [/&nbsp;|&#160;/gi, " "],
  [/&mdash;|&#8212;/gi, "—"],
  [/&ndash;|&#8211;/gi, "–"],
  [/&hellip;|&#8230;/gi, "…"],
  [/&lt;|&#60;/gi, "<"],
  [/&gt;|&#62;/gi, ">"],
];

const STOP_WORDS = new Set([
  "a", "an", "and", "as", "at", "by", "from", "for", "in", "into", "is", "it", "of", "on",
  "or", "the", "this", "to", "with", "without", "new", "best", "quality", "cheap", "factory",
  "direct", "wholesale", "free", "shipping", "sale", "hot", "top", "style", "styles", "fashion",
  "latest", "catalog", "reference", "suitable", "suit", "use", "using", "item", "items", "product",
  "products", "large", "small", "mini", "popular", "high", "end", "all", "one", "piece", "pieces",
  "pcs", "pc", "set", "sets", "version", "versions", "drop", "2020", "2021", "2022", "2023",
  "2024", "2025", "2026", "2027", "specific", "applicable", "original", "genuine", "classic",
  "modern", "creative", "beautiful", "fashionable", "cute", "sexy", "perfect", "powerful",
  "professional", "premium", "festive", "birthday", "gift", "gifts", "lovers", "enthusiasts", "personality", "homewear", "clothing",
  "spring", "summer", "autumn", "winter", "season",
]);

const GENERIC_TITLE_RE = /(?:\b(?:product|item|listing|format|specific|generic|combines|attributes|resistance to|cheap|quality|option \d+)\b|\b(?:casual button down shirt|stick brackets phone holder)\b)/i;
const RAW_COPY_RE = /brand name:|brand or supplier:|catalog tag:|source specifications|specific function identified|the listing calls out|product format|review the listed details/i;

const BRAND_WORDS = new Map([
  ["fangtuosi", "Fangtuosi"], ["funnyjack", "Funnyjack"], ["lenovo", "Lenovo"], ["ugreen", "UGREEN"],
  ["synoke", "Synoke"], ["vikefon", "Vikefon"], ["lakerain", "LakeRain"], ["xiaomi", "Xiaomi"],
  ["baseus", "Baseus"], ["awei", "Awei"], ["skmei", "SKMEI"], ["ulanzi", "Ulanzi"],
  ["qibest", "Qibest"], ["toocki", "Toocki"], ["gamesir", "GameSir"], ["teayason", "Teayason"],
  ["jbl", "JBL"], ["kodak", "Kodak"], ["insta360", "Insta360"], ["qcy", "QCY"], ["qkz", "QKZ"], ["8bitdo", "8BitDo"],
]);

const ACRONYMS = new Map([
  ["aux", "AUX"], ["usb", "USB"], ["rgb", "RGB"], ["led", "LED"], ["hdmi", "HDMI"],
  ["ios", "iOS"], ["iphone", "iPhone"], ["ipad", "iPad"], ["magsafe", "MagSafe"], ["molle", "MOLLE"],
  ["ecg", "ECG"], ["ppg", "PPG"], ["ipx4", "IPX4"], ["ip68", "IP68"], ["4k", "4K"], ["nfc", "NFC"], ["rfid", "RFID"], ["ntag", "NTAG"],
  ["5g", "5G"], ["xh2", "XH2"], ["rca", "RCA"], ["fm", "FM"], ["mw", "MW"], ["sw", "SW"],
  ["vhf", "VHF"], ["wb", "WB"], ["tws", "TWS"], ["pd", "PD"], ["ps5", "PS5"], ["tv", "TV"],
]);

const FACT_LABELS = new Set([
  "material", "style or design", "size or capacity", "color", "pattern", "power source", "frequency",
  "supported features", "device compatibility", "use or occasion", "placement or setting",
  "available options", "pack format", "connector size", "connection", "connector layout",
  "arm format", "mounting fittings", "intended user", "product type", "capacity", "shape",
]);

const HIDDEN_FACT_LABELS = new Set([
  "brand name", "brand or supplier", "origin", "model number", "catalog tag", "source specifications",
]);

const AUDIENCE_FAMILIES = new Set([
  "apparel-shirt", "apparel-dress", "apparel-top", "apparel-bottom", "apparel-outerwear",
  "apparel-underwear", "apparel-costume", "apparel-jumpsuit", "apparel-set", "socks", "jewelry", "watch", "smart-watch", "wallet", "bag",
  "shoes", "hat", "scarf", "pajamas", "baby-romper", "hair-accessory", "sunglasses",
]);

const NOUN_ALIASES = {
  "camera-mount": ["arm", "mount"],
  "laundry-clip": ["clip", "clothespin", "clothes pin", "laundry"],
  "audio-cable": ["cable", "cord"],
  "charging-cable": ["cable", "cord"],
  "cable-organizer": ["organizer", "bag"],
  "mouse-pad": ["mouse", "pad", "mousepad"],
  "computer-mouse": ["mouse", "mice"],
  "keyboard": ["keyboard"],
  "smart-glasses": ["glasses"],
  "scarf": ["scarf", "bandana", "kerchief"],
  "sunglasses": ["sunglasses", "eyewear", "glasses"],
  "face-covering": ["mask", "balaclava", "headband"],
  "pajamas": ["pajamas", "pajama", "pyjamas", "pyjama", "sleepwear"],
  "hat": ["hat", "cap", "beanie", "visor"],
  "hair-accessory": ["hair", "clip", "claw", "barrette", "headband", "hairband", "scrunchie", "hairpin", "tie"],
  "bedding": ["bedding", "duvet", "quilt", "pillowcase"],
  "blanket": ["blanket", "quilt", "throw"],
  "hair-care": ["hair", "serum", "oil", "mask", "shampoo", "conditioner", "treatment"],
  "skin-care": ["skin", "serum", "moisturizer"],
  "eyeshadow": ["eyeshadow", "palette"],
  "eyeliner": ["eyeliner", "gel"],
  "sticker": ["sticker", "stickers", "decals"],
  "memory-card": ["memory", "card"],
  "keychain": ["keychain", "airtag"],
  "charger": ["charger", "adapter"],
  "translator": ["translator", "translation"],
  "beauty-mask": ["mask"],
  "speaker": ["speaker"],
  "speaker-accessory": ["strap", "handle", "cover", "pouch"],
  "watch-organizer": ["organizer", "case"],
  "watch-strap": ["strap", "band", "watch"],
  "watch": ["watch", "wristwatch"],
  "smart-watch": ["watch", "smart"],
  "phone-case": ["case"],
  "phone-holder": ["holder", "stand"],
  "camera": ["camera"],
  "camera-accessory": ["filter", "lens", "mount", "camera"],
  "selfie-stick": ["selfie", "stick"],
  "tripod": ["tripod"],
  "radio": ["radio"],
  "flashlight": ["flashlight", "torch"],
  "audio-accessory": ["headphones", "earbuds", "earphones", "headset", "earphone", "audio", "accessory"],
  "hdmi-cable": ["hdmi", "cable"],
  "microphone": ["microphone", "mic"],
  "makeup-foundation": ["foundation", "cream", "concealer"],
  "false-eyelash": ["eyelash", "eyelashes", "lashes"],
  "nfc-tag": ["nfc", "tag", "card"],
  "home-decor": ["decor", "decoration", "ornament"],
  "shoes": ["shoe", "shoes", "sneaker", "sneakers", "footwear"],
  "game-controller": ["controller", "gamepad"],
  "board-game": ["game"],
  "toy-tea-set": ["tea", "toy", "set"],
  "pet-bed": ["bed", "kennel", "cushion"],
  "pet-toy": ["toy", "ball"],
  "pet-accessory": ["pet", "collar", "leash", "bowl", "outfit"],
  "medical-kit": ["kit", "bag"],
  "backpack": ["backpack", "rucksack"],
  "tent": ["tent"],
  "sleeping-bag": ["sleeping", "bag"],
  "camping-table": ["table"],
  "cooler-bag": ["cooler", "bag"],
  "wallet": ["wallet"],
  "bag": ["bag", "tote", "pouch"],
  "jewelry": ["jewelry", "brooch", "necklace", "bracelet", "earring", "ring"],
  "makeup-powder": ["powder"],
  "lip-makeup": ["lipstick", "lip", "gloss"],
  "makeup-brush": ["brush"],
  "makeup-sponge": ["sponge", "puff"],
  "face-paint": ["paint"],
  "beauty-mask": ["mask"],
  "apparel-shirt": ["shirt", "t-shirt", "polo"],
  "apparel-dress": ["dress"],
  "apparel-top": ["top"],
  "apparel-bottom": ["pants", "jeans", "shorts", "leggings", "skirt"],
  "apparel-outerwear": ["jacket", "sweater", "hoodie", "coat", "cardigan"],
  "apparel-underwear": ["underwear", "bra", "swimsuit", "bikini"],
  "apparel-jumpsuit": ["jumpsuit", "romper", "bodysuit"],
  "apparel-set": ["set", "outfit"],
  "socks": ["socks", "stockings"],
  "baby-romper": ["romper"],
  "drinkware": ["drinkware", "tumbler", "bottle", "cup", "mug", "thermos"],
  "cookware": ["cookware", "pan", "pot", "set"],
  "cleaning-tool": ["squeegee", "cleaning"],
  "organizer": ["organizer", "storage"],
  "light": ["light", "lamp"],
  "fan": ["fan"],
  "tool": ["tool"],
  "toy": ["toy", "puzzle", "game"],
  "general-accessory": [
    "accessory", "case", "holder", "stand", "organizer", "bag", "kit", "tool", "toy", "camera", "sticker", "stickers", "brush", "earbuds", "set",
    "adapter", "backdrop", "band", "bank", "bottle", "cable", "card", "cartridge", "clock", "console", "decor", "disc", "door", "drive", "earphone",
    "ethernet", "fabric", "frame", "humidifier", "lamp", "lock", "matrix", "mixer", "ornament", "paper", "plant", "power", "projector", "stylus", "switch", "sunglasses", "towel", "umbrella", "wallet",
  ],
  "video-adapter": ["adapter", "converter", "hdmi", "vga"],
  "apparel-costume": ["costume", "cosplay", "uniform", "outfit"],
};

function replaceHtmlEntities(value) {
  return HTML_ENTITY_REPLACEMENTS.reduce(
    (result, pair) => result.replace(pair[0], pair[1]),
    String(value || ""),
  );
}

export function stripHtml(value) {
  return replaceHtmlEntities(String(value || "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value) {
  return stripHtml(value)
    .replace(/\b(\d+)\.\s+(\d+)\s*(mm|cm|mah|ml|oz|kg|gb|tb|hz|mhz|ghz|w|v|l|g)\b/gi, "$1.$2$3")
    .replace(/[|]+/g, ",").replace(/\s+/g, " ").trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^$()|[\]\\]/g, "\\$&");
}

function tokenise(value) {
  return normalizeText(value).toLowerCase().replace(/[-_]+/g, " ")
    .replace(/[^a-z0-9./+]+/g, " ").split(/\s+/).filter(Boolean);
}

function uniqueValues(values) {
  const seen = new Set();
  return values.filter((value) => {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function titleCasePhrase(value) {
  return normalizeText(value).split(/\s+/).filter(Boolean).map((word) => {
  const lower = word.toLowerCase();
    if (BRAND_WORDS.has(lower)) return BRAND_WORDS.get(lower);
    if (ACRONYMS.has(lower)) return ACRONYMS.get(lower);
    if (/^\d+(?:\.\d+)?(?:gbps|mm|cm|mah|ml|oz|kg|v|w|k|g|l|in|hz|mhz|ghz|gb|tb|p)$/i.test(word)) {
      return word.replace(/mah/i, "mAh").replace(/mhz/i, "MHz").replace(/ghz/i, "GHz")
        .replace(/gb/i, "GB").replace(/gbps/i, "Gbps").replace(/hz/i, "Hz").replace(/tb/i, "TB")
        .replace(/k$/i, "K");
    }
    if (/^\d+(?:\.\d+)?(?:[-/]\d+(?:\.\d+)?)?$/.test(word)) return word;
    if (/^(?:women|men|girls|boys|children)'?s$/i.test(word)) {
      return word.replace(/'S$/i, "'s").replace(/^./, (letter) => letter.toUpperCase());
    }
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(" ")
    .replace(/\bIphone\b/g, "iPhone").replace(/\bIpad\b/g, "iPad")
    .replace(/\bV Neck\b/gi, "V-Neck").replace(/\bU Neck\b/gi, "U-Neck")
    .replace(/\bShort Sleeve\b/gi, "Short-Sleeve").replace(/\bLong Sleeve\b/gi, "Long-Sleeve")
    .replace(/\bButton Down\b/gi, "Button-Down").replace(/\bT Shirt\b/gi, "T-Shirt")
    .replace(/\bHdmi-to-vga\b/gi, "HDMI-to-VGA")
    .replace(/\b3 P\b/gi, "3-Pin").replace(/\bMale To Male\b/gi, "Male-to-Male")
    .replace(/\bMale-to-male\b/gi, "Male-to-Male").replace(/\b2-Rca\b/gi, "2-RCA")
    .replace(/\bXh2\b/gi, "XH2").replace(/\bLp40pro\b/gi, "LP40Pro")
    .replace(/\bQcy\b/gi, "QCY").replace(/\bQkz\b/gi, "QKZ")
    .replace(/\bAk6\b/gi, "AK6")
    .replace(/\bGloden\b/gi, "Golden")
    .replace(/\b(\d+)\s+Section\b/gi, "$1-Section")
    .replace(/\bDouble-articulated\b/gi, "Double-Articulated");
}

function sentenceValue(value) {
  return titleCasePhrase(value).split(/\s*,\s*/).map((part) => {
    const words = part.split(/\s+/).filter(Boolean).map((word) => {
      const lower = word.toLowerCase();
      if (BRAND_WORDS.has(lower)) return BRAND_WORDS.get(lower);
      if (ACRONYMS.has(lower)) return ACRONYMS.get(lower);
      if (/^i(?:phone|pad)$/i.test(word)) return word.replace(/^I/i, "i");
      if (/\d/.test(word)) return word;
      return lower;
    });
    return words.join(" ").replace(/^./, (letter) => letter.toLowerCase());
  }).join(", ");
}

function humanizeHandle(value) {
  return normalizeText(value)
    .replace(/\b(\d+)\s*[- ]\s*(\d+)(mm|cm|mah|ml|oz|kg|v|w|k|g|l)\b/gi, "$1.$2$3")
    .replace(/\b(\d+)\s+(\d+)mm\b/gi, "$1.$2mm")
    .replace(/\b(\d+)\s+(\d+)p\b/gi, "$1.$2p")
    .replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

function sourceParts(product) {
  const customData = product?.customData || {};
  const handle = humanizeHandle(product?.handle);
  const title = normalizeText(product?.title);
  const listedType = normalizeText(product?.product_type || product?.productType);
  const highlights = Array.isArray(customData.highlights) ? customData.highlights.join(" ") : "";
  return {
    handle,
    title,
    listedType,
    classificationText: [handle, title, listedType].filter(Boolean).join(" "),
    evidenceText: [handle, title, listedType, highlights, product?.body_html, product?.descriptionHtml]
      .filter(Boolean).join(" "),
  };
}

export function extractProductFacts(product) {
  const html = String(product?.body_html || product?.descriptionHtml || "");
  const handleText = humanizeHandle(product?.handle);
  const hasNegativeWaterproof = /\b(?:non|not|without)[- ]+(?:waterproof|waterproofing)\b/i.test(handleText);
  const facts = [];
  for (const match of html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const text = normalizeText(match[1]);
    const separator = text.indexOf(":");
    if (separator < 0) continue;
    const label = normalizeText(text.slice(0, separator));
    const value = normalizeText(text.slice(separator + 1));
    const normalizedLabel = label.toLowerCase();
    if (!value || /^none|null|n\/a$/i.test(value)) continue;
    if (!FACT_LABELS.has(normalizedLabel) || HIDDEN_FACT_LABELS.has(normalizedLabel)) continue;
    if (hasNegativeWaterproof && normalizedLabel === "supported features" && /\bwaterproof\b/i.test(value)) continue;
    facts.push({ label, value });
  }
  return uniqueValues(facts.map((fact) => fact.label + "\u0000" + fact.value)).map((entry) => {
    const splitAt = entry.indexOf("\u0000");
    return { label: entry.slice(0, splitAt), value: entry.slice(splitAt + 1) };
  });
}

function factValue(facts, label) {
  return facts.find((fact) => fact.label.toLowerCase() === label.toLowerCase())?.value || "";
}

function nonGenericListedType(product, facts) {
  const value = normalizeText(factValue(facts, "Product type") || product?.product_type || product?.productType);
  if (!value || /^(?:product|item|bag|lamp|makeup product|pet product|baby product)$/i.test(value)) return "";
  return value;
}

function has(text, pattern) {
  return pattern.test(text);
}

export function classifyProduct(product, facts = extractProductFacts(product)) {
  const source = sourceParts(product);
  const factText = facts.map((fact) => fact.label + " " + fact.value).join(" ");
  const text = [source.classificationText, factText].filter(Boolean).join(" ");
  const rules = [
    ["organizer", "organizer", /\b(?:organizer|storage box|storage case)\b/i],
    ["laundry-clip", "laundry clip", /\b(?:clothespins?|clothes[- ]?pins?|laundry clips?|clothing organizing clips?)\b/i],
    ["camera-mount", "camera mounting arm", /\b(?:articulated|magic|mounting|camera)\b[^.]{0,70}\b(?:arm|hex pin|female thread|clamp)\b|\barm\b[^.]{0,70}\b(?:hex|thread|camera|mount)\b/i],
    ["video-adapter", "HDMI-to-VGA video adapter", /\bhdmi\b[^.]{0,90}\bvga\b|\bvga\b[^.]{0,90}\bhdmi\b/i],
    ["audio-cable", "AUX audio cable", /\b(?:aux|audio|rca|coaxial|3\.5\s*mm|headphone jack)\b[^.]{0,80}\b(?:cable|cord|wire|splitter|adapter)\b|\b(?:cable|cord|wire)\b[^.]{0,80}\b(?:aux|audio|rca|coaxial)\b/i],
    ["hdmi-cable", "HDMI cable", /\bhdmi\b[^.]{0,80}\b(?:cable|cord|wire)\b|\b(?:cable|cord|wire)\b[^.]{0,80}\bhdmi\b/i],
    ["cable-organizer", "cable organizer", /\b(?:cable|cord|wire)\b[^.]{0,70}\b(?:organizer|storage|label|tag|zip tie|winder)\b|\b(?:organizer|storage)\b[^.]{0,70}\b(?:cable|cord)\b/i],
    ["charging-cable", "USB charging cable", /\b(?:usb|type[- ]?c|charging|fast charge|data cable|pd\s*\d*)\b[^.]{0,80}\b(?:cable|cord|wire)\b/i],
    ["mouse-pad", "mouse pad", /\b(?:mousepad|mouse pad)\b/i],
    ["computer-mouse", "computer mouse", /\b(?:computer|gaming|wireless|bluetooth|ergonomic)\b[^.]{0,35}\b(?:mouse|mice)\b|\b(?:mouse|mice)\b/i],
    ["keyboard", "keyboard", /\b(?:keyboard|touchpad)\b/i],
    ["smart-glasses", "smart glasses", /\b(?:smart glasses|shooting glasses|translation glasses)\b/i],
    ["sunglasses", "sunglasses", /\b(?:sunglasses|sun glasses|polarized eyewear)\b/i],
    ["scarf", "scarf", /\b(?:scarf|bandana|kerchief|hijab|neckerchief)\b/i],
    ["hair-accessory", "hair accessory", /\b(?:hair\s*(?:claw|clip|clips|pin|pins|tie|ties|band|bands|barrette|scrunchie)|barrette|ponytail holder|hair accessories?)\b/i],
    ["beauty-mask", "beauty face mask", /\b(?:led|beauty|facial|skin)\b[^.]{0,30}\bmask\b/i],
    ["face-covering", "face covering", /\b(?:balaclava|face mask|neck gaiter|headband)\b/i],
    ["pajamas", "pajamas", /\b(?:pajama|pyjama|sleepwear|nightwear)\b/i],
    ["hat", "hat", /\b(?:beanie|sun hat|baseball cap|cap|visor|hat)\b/i],
    ["bedding", "bedding", /\b(?:duvet cover|quilt cover|comforter cover|pillowcase|bedding)\b/i],
    ["blanket", "blanket", /\b(?:blanket|quilt|comforter|throw)\b/i],
    ["hair-care", "hair care", /\b(?:hair oil|hair serum|hair mask|scalp care|hair essence|shampoo|conditioner|hair dye|hair treatment)\b/i],
    ["skin-care", "skin care", /\b(?:facial serum|face serum|facial moisturizer|skin care|skin serum)\b/i],
    ["eyeshadow", "eyeshadow palette", /\b(?:eyeshadow|eye shadow)\b/i],
    ["eyeliner", "eyeliner", /\b(?:eyeliner|eye liner|eyebrow gel|brow gel)\b/i],
    ["sticker", "sticker set", /\b(?:stickers?|decals?)\b/i],
    ["memory-card", "memory card", /\b(?:memory card|sd card|tf card)\b/i],
    ["keychain", "keychain", /\b(?:keychain|airtag)\b/i],
    ["charger", "device charger", /\b(?:charger|charging adapter|wall adapter|power adapter)\b/i],
    ["translator", "language translator", /\b(?:translator|translation device)\b/i],
    ["speaker-accessory", "speaker carrying strap", /\bspeaker\b[^.]{0,90}\b(?:carrying|shoulder|handle|strap|pouch|cover|case)\b/i],
    ["speaker", "Bluetooth speaker", /\b(?:bluetooth|wireless|portable|loudspeaker|sound box|stereo speaker)\b[^.]{0,55}\bspeaker\b|\bspeaker\b/i],
    ["phone-case", "phone case", /\b(?:phone|iphone|ipad)\b[^.]{0,45}\bcase\b|\bcase\b[^.]{0,45}\b(?:iphone|ipad|phone)\b/i],
    ["camera", "digital camera", /\b(?:digital camera|action camera|security camera|cctv|webcam|camcorder)\b|\bproduct\s+type\s+camera\b/i],
    ["selfie-stick", "selfie stick", /\bselfie[- ]?stick\b/i],
    ["tripod", "smartphone tripod", /\btripod\b/i],
    ["camera-accessory", "camera accessory", /\b(?:camera|camcorder|insta360)\b[^.]{0,90}\b(?:lens|filter|mount|cage|accessor|bracket|holder|tripod)\b|\b(?:lens|filter)\b[^.]{0,70}\b(?:camera|photography)\b/i],
    ["phone-holder", "phone holder", /\b(?:phone|mobile|cell)\b[^.]{0,50}\b(?:holder|stand|mount)\b|\b(?:holder|stand|mount)\b[^.]{0,50}\b(?:phone|mobile|cell)\b/i],
    ["watch-organizer", "watch organizer case", /\bwatch\b[^.]{0,70}\b(?:box|organizer|travel case|display holder|storage)\b/i],
    ["smart-watch", "smart watch", /\b(?:smartwatch|smart watch|fitness tracker)\b/i],
    ["watch", "watch", /\b(?:wristwatch|wrist watch|quartz|analog|digital|sport|sports|military|alarm|business)\b[^.]{0,30}\b(?:watch|clock)\b|\b(?:watch|clock)\b[^.]{0,30}\b(?:digital|analog|sport|military|alarm)\b/i],
    ["watch-strap", "watch strap", /\b(?:watch|wristwatch)\b[^.]{0,50}\b(?:strap|band|bracelet)\b|\b(?:strap|band)\b[^.]{0,50}\bwatch\b/i],
    ["watch", "watch", /\b(?:wristwatch|wrist watch|watch)\b/i],
    ["radio", "emergency radio", /\b(?:radio|fm|mw|sw|vhf|hand crank)\b/i],
    ["flashlight", "flashlight", /\b(?:flashlight|torch)\b/i],
    ["audio-accessory", "audio accessory", /\b(?:headphone|headphones|earphone|earphones|earbud|earbuds|headset|audio accessory)\b/i],
    ["microphone", "microphone", /\b(?:microphone|mic)\b/i],
    ["game-controller", "game controller", /\b(?:gamepad|game controller|joystick|controller)\b/i],
    ["pet-bed", "pet bed", /\b(?:cat|kitten|dog|puppy|pet)\b[^.]{0,80}\b(?:bed|kennel|cushion|basket|cave|nest|mat)\b/i],
    ["pet-toy", "pet toy", /\b(?:cat|kitten|dog|puppy|pet)\b[^.]{0,80}\b(?:toy|ball|chew|frisbee)\b/i],
    ["pet-accessory", "pet accessory", /\b(?:cat|kitten|dog|puppy|pet)\b[^.]{0,80}\b(?:collar|leash|bowl|carrier|clothing|outfit|supply|accessory)\b|\bpet\s+accessory\b/i],
    ["toy-tea-set", "children's tea set", /\b(?:tea set|pretend play|playhouse kitchen|kids kitchen toy)\b/i],
    ["board-game", "board game", /\b(?:board game|card game|party game|tabletop game|dart board)\b/i],
    ["toy", "toy", /\b(?:puzzle toy|educational toy|baby toy|children'?s toy|toy)\b/i],
    ["medical-kit", "medical kit", /\b(?:medical|medicine|first[- ]?aid|emergency)\b[^.]{0,45}\b(?:bag|kit|case)\b/i],
    ["backpack", "backpack", /\b(?:backpack|rucksack|hiking bag|tactical bag)\b/i],
    ["sleeping-bag", "sleeping bag", /\bsleeping bag\b/i],
    ["cooler-bag", "insulated cooler bag", /\b(?:wine cooler|cooler bag|insulated tote)\b/i],
    ["camping-table", "camping table", /\b(?:camping|outdoor|folding)\b[^.]{0,45}\btable\b|\btable\b[^.]{0,45}\bcamping\b/i],
    ["tent", "camping tent", /\b(?:beach|camping|pop[- ]?up|backpacking)\b[^.]{0,55}\btent\b|\btent\b/i],
    ["home-decor", "home decor", /\b(?:home decor|home decoration|ornament|figurine|statue)\b/i],
    ["shoes", "shoes", /\b(?:shoe|shoes|sneaker|footwear)\b/i],
    ["wallet", "wallet", /\b(?:wallet|purse|coin[- ]?pocket|card holder)\b/i],
    ["jewelry", "jewelry accessory", /\b(?:necklace|bracelet|brooch|earring|ring|jewelry|jewel)\b/i],
    ["makeup-powder", "setting powder", /\b(?:setting powder|baking powder|loose powder|face powder|foundation powder)\b/i],
    ["lip-makeup", "lip makeup", /\b(?:lipstick|lip gloss|lip liner|lip oil|lip serum)\b/i],
    ["makeup-brush", "makeup brush", /\b(?:makeup|foundation|concealer|contour|blusher|lip|cosmetic|beauty)\b[^.]{0,40}\bbrush\b|\bbrush\b[^.]{0,40}\b(?:makeup|foundation|concealer|lip|cosmetic|beauty)\b/i],
    ["makeup-foundation", "liquid foundation", /\b(?:liquid foundation|cc cream|foundation makeup|foundation)\b/i],
    ["makeup-sponge", "makeup sponge", /\b(?:makeup|cosmetic|foundation)\b[^.]{0,45}\b(?:sponge|puff)\b|\b(?:sponge|puff)\b[^.]{0,45}\b(?:makeup|foundation)\b/i],
    ["face-paint", "face paint", /\b(?:face|body)\s*paint\b/i],
    ["false-eyelash", "false eyelashes", /\b(?:false eyelash|false eyelashes|eyelash extensions?|lashes)\b/i],
    ["beauty-mask", "beauty face mask", /\b(?:facial|beauty|skin)\b[^.]{0,30}\bmask\b/i],
    ["apparel-dress", "dress", /\b(?:dresses|dress|sundresses|sundress|gowns|gown)\b/i],
    ["apparel-shirt", "shirt", /\b(?:t[- ]?shirts?|shirts?|blouses?|tees?|polos?|button[- ]?downs?)\b/i],
    ["apparel-top", "top", /\b(?:tank[- ]?tops?|crop[- ]?tops?|camisoles?|tops?)\b/i],
    ["apparel-bottom", "pants", /\b(?:pants|trousers|jeans|shorts|leggings|skirts?)\b/i],
    ["apparel-outerwear", "jacket", /\b(?:jackets?|coats?|hoodies|hoodie|sweaters?|cardigans?|blazers?)\b/i],
    ["apparel-underwear", "underwear", /\b(?:underwear|bras?|lingerie|swimsuits?|bikinis?)\b/i],
    ["socks", "socks", /\b(?:stockings?|pantyhose|socks?)\b/i],
    ["baby-romper", "baby romper", /\b(?:romper|infant|newborn|baby clothes)\b/i],
    ["apparel-costume", "costume", /\b(?:costume|cosplay|disguise|roleplay|performance uniform)\b/i],
    ["apparel-jumpsuit", "jumpsuit", /\b(?:jumpsuits?|rompers?|bodysuits?)\b/i],
    ["apparel-set", "apparel set", /\b(?:clothes? sets?|outfit sets?|basketball clothes|matching set)\b/i],
    ["drinkware", "drinkware", /\b(?:bottle|thermos|tumbler|cup|mug|flask|drinkware)\b/i],
    ["cookware", "cookware", /\b(?:cookware|frying pan|saucepan|pot|kitchen set|bakeware)\b/i],
    ["cleaning-tool", "cleaning tool", /\b(?:squeegee|cleaning tool|window cleaner|glass cleaner)\b/i],
    ["nfc-tag", "NFC tag", /\b(?:nfc|ntag|rfid)\b[^.]{0,50}\b(?:card|tag)\b|\b(?:card|tag)\b[^.]{0,50}\b(?:nfc|ntag|rfid)\b/i],
    ["organizer", "organizer", /\b(?:organizer|storage box|storage case)\b/i],
    ["fan", "fan", /\b(?:fan|air cooler)\b/i],
    ["light", "light", /\b(?:lamp|light|lantern)\b/i],
    ["tool", "tool", /\b(?:tool|pliers|tweezers|screwdriver|wrench)\b/i],
  ];
  for (const entry of rules) {
    if (has(text, entry[2])) return { familyId: entry[0], noun: entry[1], confidence: "high" };
  }
  const listedType = nonGenericListedType(product, facts);
  if (listedType) {
    const normalized = listedType.toLowerCase();
    if (/\b(?:bag|tote|pouch)\b/.test(normalized)) return { familyId: "bag", noun: "bag", confidence: "medium" };
    if (/\b(?:case|cover)\b/.test(normalized)) return { familyId: "general-accessory", noun: "case", confidence: "medium" };
    if (/\b(?:holder|stand)\b/.test(normalized)) return { familyId: "general-accessory", noun: "holder", confidence: "medium" };
    return { familyId: "general-accessory", noun: titleCasePhrase(listedType), confidence: "medium" };
  }
  const fallbackNoun = [
    "organizer", "adapter", "holder", "stand", "cover", "case", "bag", "kit", "tool", "set",
    "accessory", "device", "brush", "toy", "lamp", "light", "bottle", "cup",
  ].find((candidate) => new RegExp("\\b" + candidate + "\\b", "i").test(text));
  return { familyId: "general-accessory", noun: fallbackNoun || "everyday accessory", confidence: fallbackNoun ? "medium" : "low" };
}

function brandFromText(text) {
  for (const pair of BRAND_WORDS) {
    if (new RegExp("\\b" + escapeRegExp(pair[0]) + "\\b", "i").test(text)) return pair[1];
  }
  return "";
}

function audienceFrom(product, classification) {
  if (!AUDIENCE_FAMILIES.has(classification.familyId)) return [];
  const facts = extractProductFacts(product);
  const source = sourceParts(product);
  const text = source.handle + " " + source.title + " " + factValue(facts, "Intended user");
  const matches = text.match(/\b(?:women|womens|woman|men|mens|man|female|male|girls|girl|boys|boy|unisex)\b/gi) || [];
  return uniqueValues(matches.map((entry) => {
    const value = entry.toLowerCase();
    if (["women", "womens", "woman", "female"].includes(value)) return "women";
    if (["men", "mens", "man", "male"].includes(value)) return "men";
    if (["girls", "girl"].includes(value)) return "girls";
    if (["boys", "boy"].includes(value)) return "boys";
    return "unisex";
  }));
}

function possessiveAudience(audience) {
  const values = new Set(audience || []);
  if ((values.has("women") && values.has("men")) || (values.has("girls") && values.has("boys"))) return "Unisex";
  const value = audience?.[0] || "";
  if (!value || value === "unisex") return "";
  const capitalized = value.charAt(0).toUpperCase() + value.slice(1);
  return ["girls", "boys", "kids", "children"].includes(value) ? capitalized + "'" : capitalized + "'s";
}

function extractMeasurements(text, facts) {
  const values = [];
  const combined = text + " " + facts.map((fact) => fact.value).join(" ");
  for (const match of combined.matchAll(/\b\d+(?:\.\d+)?\s*(?:gbps|mhz|ghz|mah|mm|cm|kg|gb|tb|hz|inch|in|ml|oz|m|w|v|l|g|k|p)\b/gi)) {
    values.push(match[0].replace(/\s+/g, ""));
  }
  return uniqueValues(values).slice(0, 3).map(titleCasePhrase);
}

function extractFeatures(text) {
  const found = [];
  const add = (pattern, value) => { if (pattern.test(text)) found.push(value); };
  add(/\bbluetooth\b/i, "Bluetooth"); add(/\bwireless\b/i, "Wireless");
  if (/\b(?:waterproof|ipx4|ip68)\b/i.test(text) && !/\b(?:non|not|without)[- ]+(?:waterproof|waterproofing)\b/i.test(text)) found.push("Waterproof");
  add(/\brgb\b/i, "RGB Lighting");
  add(/\bled\b/i, "LED Lighting"); add(/\bportable\b/i, "Portable");
  add(/\brechargeable\b/i, "Rechargeable"); add(/\bfoldable\b|\bfolding\b/i, "Foldable");
  add(/\bmagnetic\b/i, "Magnetic"); add(/\bmolle\b/i, "MOLLE");
  add(/\binfrared\b/i, "Infrared"); add(/\bnight vision\b/i, "Night Vision");
  add(/\bsolar\b/i, "Solar"); add(/\bhand crank\b/i, "Hand-Crank");
  add(/\bfast charge\b|\bfast charging\b/i, "Fast Charging");
  add(/\bhigh[- ]speed\b/i, "High-Speed"); add(/\bdolby vision\b/i, "Dolby Vision");
  add(/\bsqueaky\b/i, "Squeaky"); add(/\bbite[- ]?resistant\b/i, "Bite-Resistant");
  add(/\bcatnip\b/i, "Catnip"); add(/\binteractive\b/i, "Interactive");
  add(/\b(?:teeth[- ]?cleaning|dental|toothbrush)\b/i, "Dental-Care");
  return uniqueValues(found).slice(0, 4);
}

function extractStyle(text) {
  const found = [];
  const add = (pattern, value) => { if (pattern.test(text)) found.push(value); };
  add(/\bembroidered\b/i, "Embroidered"); add(/\bshort sleeve\b|\bshort-sleeve\b/i, "Short-Sleeve");
  add(/\blong sleeve\b|\blong-sleeve\b/i, "Long-Sleeve"); add(/\bv neck\b|\bv-neck\b/i, "V-Neck");
  add(/\boff shoulder\b|\boff-shoulder\b/i, "Off-Shoulder"); add(/\bbutton down\b|\bbutton-down\b/i, "Button-Down");
  add(/\b(?:graphic|printed|print|pattern)\b/i, "Printed");
  add(/\bsolid color\b|\bsolid\b/i, "Solid"); add(/\bcasual\b/i, "Casual");
  add(/\bslim fit\b/i, "Slim-Fit"); add(/\bbreathable\b/i, "Breathable");
  add(/\bstriped\b/i, "Striped"); add(/\bvintage\b/i, "Vintage"); add(/\bgothic\b/i, "Gothic");
  add(/\bfloral\b/i, "Floral"); add(/\bhenley\b/i, "Henley"); add(/\bhooded\b/i, "Hooded");
  return uniqueValues(found).slice(0, 4);
}

function extractMaterial(facts, text) {
  const fact = factValue(facts, "Material");
  if (fact) return titleCasePhrase(fact);
  const match = text.match(/\b(?:stainless steel|steel|silicone|rubber|cotton(?:[- ]linen)?|linen|leather|nylon|polyester|velvet|satin|tulle|canvas|fabric|wooden|wood|ceramic|glass|metal|plastic|straw)\b/i);
  return match?.[0] ? titleCasePhrase(match[0]) : "";
}

function extractConnector(text, facts) {
  const values = [];
  const fitting = factValue(facts, "Mounting fittings") || factValue(facts, "Connector layout") || factValue(facts, "Connection");
  if (fitting) values.push(fitting);
  if (/\bxh2\s*\.?\s*54\b/i.test(text)) values.push("XH2.54 3-Pin");
  if (/\bmale\s+to\s+male\b/i.test(text)) values.push("Male-to-Male");
  if (/\b2\s*rca\b/i.test(text)) values.push("2-RCA");
  if (/\b5\/8\s*(?:hex\s*)?pin\b/i.test(text)) values.push("5/8 Hex Pin");
  if (/\b1\/4[- ]20\b/i.test(text)) values.push("1/4-20 Thread");
  if (/\b3\/8[- ]16\b/i.test(text)) values.push("3/8-16 Thread");
  return uniqueValues(values.map((value) => titleCasePhrase(value))).slice(0, 2);
}

function extractCompatibility(text, facts) {
  const fact = factValue(facts, "Device compatibility");
  if (fact) return titleCasePhrase(fact);
  const targets = [
    ["PS5", /\bps5\b/i], ["Xbox", /\bxbox(?:\s+series\s+[sx])?\b/i],
    ["Xiaomi TV Box", /\bxiaomi\s+tv\s+box\b/i], ["Nintendo Switch", /\bnintendo\s+switch\b|\bswitch\b/i],
    ["iPhone", /\biphone(?:\s+\d{1,2}(?:\s+pro(?:\s+max)?)?)?\b/i], ["iPad", /\bipad(?:\s+\w+)?\b/i],
    ["JBL Boombox", /\bjbl\s+boombox(?:\s+\d+)?\b/i], ["Insta360", /\binsta360\b/i],
    ["Garmin", /\bgarmin\b/i], ["Casio", /\bcasio\b/i], ["Amazfit", /\b(?:amazfit|huami)\b/i],
    ["Android", /\bandroid\b/i], ["PC", /\bpc\b/i], ["PlayStation", /\bplaystation\b/i],
  ];
  return uniqueValues(targets.filter(([, pattern]) => pattern.test(text)).map(([label]) => label)).slice(0, 3).join(" and ");
}

function salientHandleWords(text, classification) {
  const familyTokens = new Set([
    ...tokenise(classification.noun), "bluetooth", "wireless", "portable", "outdoor", "travel",
    "new", "fashion", "women", "womens", "woman", "men", "mens", "man", "female", "male", "girls", "girl", "boys", "boy",
    "universal", "large", "capacity", "holder", "phone", "mobile", "camera", "audio", "cable",
    "cord", "speaker", "product", "case", "cover", "non", "waterproof", "bluetooth", "wireless",
    "rgb", "led", "infrared", "rechargeable", "foldable", "folding", "magnetic", "solar", "speed",
  ]);
  return uniqueValues(tokenise(text).filter((token) => token.length > 1 && !/^\d+(?:pc|pcs|piece|pieces)$/.test(token) && !STOP_WORDS.has(token) && !familyTokens.has(token))
    .map((token) => ACRONYMS.get(token) || token)).slice(0, 6).map(titleCasePhrase);
}

function identityParts(profile) {
  const brand = brandFromText(profile.handleText);
  const identityStopWords = new Set([
    "original", "quick", "connect", "ergonomic", "design", "powerful", "transmission", "speed",
    "sport", "sports", "stereo", "subwoofer", "monitor", "headphone", "headphones", "earphone",
    "earphones", "earbud", "earbuds", "headset", "music", "ear", "hifi", "bass", "race", "driver", "copper", "wireless", "bluetooth", "portable", "camera",
    "phone", "mobile", "android", "ios", "for", "with", "new", "fashion", "solid", "color",
    "casual", "summer", "winter", "spring", "autumn", "style", "styles", "fashionable",
  ]);
  const brandTokens = new Set(tokenise(brand));
  const salient = salientHandleWords(profile.handleText, profile.classification)
    .filter((value) => !identityStopWords.has(value.toLowerCase()))
    .filter((value) => !brandTokens.has(value.toLowerCase()));
  return uniqueValues([brand, ...salient]).slice(0, 3);
}

function joinTitleParts(parts) {
  const values = [];
  for (const part of parts) {
    const value = dedupeTitleWords(titleCasePhrase(part));
    if (!value || values.some((existing) => existing.toLowerCase() === value.toLowerCase())) continue;
    values.push(value);
  }
  return dedupeTitleWords(values.join(" ").replace(/\s+/g, " ").trim());
}

function titleTokenKey(value) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Supplier handles frequently repeat a noun across adjacent fragments
 * ("Power Bank 22.5w Power Bank", "Ulanzi Ulanzi", "Long Long-sleeve").
 * Keep the first useful wording, but prefer the hyphenated form when the
 * second token carries the complete idea ("Long-sleeve" over "Long").
 */
function dedupeTitleWords(value) {
  const words = normalizeText(value).split(/\s+/).filter(Boolean);
  const result = [];
  const seen = new Set();
  for (const word of words) {
    const key = titleTokenKey(word);
    if (!key) continue;
    const firstPart = word.split("-")[0];
    const firstKey = titleTokenKey(firstPart);
    if (word.includes("-") && result.length && titleTokenKey(result.at(-1)) === firstKey) {
      seen.delete(firstKey);
      result.pop();
    }
    if (seen.has(key)) continue;
    result.push(word);
    seen.add(key);
  }
  return result.join(" ").replace(/\s+/g, " ").trim();
}

function generalAccessoryTitle(profile) {
  const text = profile.handleText;
  const brand = brandFromText(text);
  const material = extractMaterial(profile.facts, text);
  const measurements = extractMeasurements(text, profile.facts).filter((value) => !/^0(?:mm|in)$/i.test(value));
  const features = extractFeatures(text);
  const audience = possessiveAudience(profile.audience);
  const firstSize = measurements.find((value) => /mah|ml|cm|mm|gb|tb|inch|in|w|v|l|g|kg/i.test(value)) || "";
  const sizeDetails = measurements.slice(0, 2);
  const matrixFormat = text.match(/\b\d+\s*x\s*\d+\b/i)?.[0]?.replace(/\s+/g, "") || "";
  const brandPart = brand ? [brand] : [];
  const rule = (pattern, parts) => pattern.test(text) ? joinTitleParts(parts()) : "";

  return rule(/power\s*bank|powerbank|external\s+battery/i, () => [
    ...brandPart, ...sizeDetails, features.includes("Wireless") ? "Wireless" : "", "Power Bank",
  ])
    || rule(/usb\s*(?:hub|dock)|multi[- ]?port\s+adapter/i, () => [...brandPart, ...sizeDetails, "USB-C Hub Adapter"])
    || rule(/(?:usb|flash)\s*drive|u[- ]?disk|batocera.*usb/i, () => [...brandPart, firstSize, "USB Flash Drive"])
    || rule(/ethernet|cat6|rj45/i, () => [firstSize, "Cat6 Ethernet Cable"])
    || rule(/hdmi.*(?:matrix|switch)|(?:matrix|switch).*hdmi/i, () => [matrixFormat, "HDMI Matrix Switch"])
    || rule(/projector|projetor/i, () => [...brandPart, ...sizeDetails, "Portable Projector"])
    || rule(/handheld.*(?:game|console)|retro.*(?:game|console)|game.*console/i, () => [...brandPart, firstSize, "Retro Handheld Game Console"])
    || rule(/game\s*(?:card|cartridge)|video[- ]game[- ]card/i, () => [...brandPart, "Game Cartridge"])
    || rule(/digital\s*(?:picture\s*)?frame/i, () => [...brandPart, firstSize, "Digital Picture Frame"])
    || rule(/photo\s*printer\s*paper|printer\s*paper/i, () => [...brandPart, firstSize, "Photo Printer Paper"])
    || rule(/voice\s*recorder|dictaphone/i, () => [firstSize, "Voice Recorder"])
    || rule(/power\s*bank|powerbank/i, () => [...sizeDetails, "Power Bank"])
    || rule(/humidifier|aroma\s*diffuser/i, () => [firstSize, "USB Air Humidifier"])
    || rule(/aquarium.*(?:plant|grass)|(?:plant|grass).*aquarium/i, () => ["Aquarium Plant Decor"])
    || rule(/aquarium.*(?:ornament|diver|boat)|(?:ornament|diver|boat).*aquarium/i, () => ["Aquarium Ornament"])
    || rule(/tarot/i, () => [firstSize, "Tarot Card Deck"])
    || rule(/(?:anime|manga|demon slayer|attack on titan|sword art online).*cards?|cards?.*(?:anime|manga|demon slayer|attack on titan|sword art online)/i, () => ["Anime Collectible Card Set"])
    || rule(/blu[- ]?ray/i, () => ["Blu-ray Disc"])
    || rule(/(?:greeting|birthday|fathers|mothers|grandma|grandpa|housewarming).*card|card.*(?:greeting|birthday|fathers|mothers|grandma|grandpa|housewarming)/i, () => ["Greeting Card"])
    || rule(/cake\s*topper/i, () => [firstSize, "Cake Topper"])
    || rule(/table\s*runner/i, () => [firstSize, "Table Runner"])
    || rule(/(?:bath|face|microfiber).*towel|towel/i, () => [firstSize, /face/i.test(text) ? "Face Towel" : "Bath Towel"])
    || rule(/resistance\s*bands?|exercise\s*bands?/i, () => [firstSize, "Resistance Band Set"])
    || rule(/knee\s*pads?|elbow\s*pads?|wrist\s*guard/i, () => [firstSize, "Kids' Protective Pads Set"])
    || rule(/sunglasses/i, () => [audience, "UV Protection Sunglasses"])
    || rule(/hair\s*(?:trimmer|clipper)|split\s*end\s*trimmer/i, () => [brand, "Hair Trimmer"])
    || rule(/massage\s*(?:roller|ball)|massager/i, () => [firstSize, "Massage Tool"])
    || rule(/makeup.*(?:blush|bronzer)|blush|bronzer/i, () => [brand, "Blush Makeup"])
    || rule(/hair.*(?:oil|serum)|rosemary.*oil/i, () => [brand, "Hair Oil"])
    || rule(/(?:textile|fabric)/i, () => [material, extractStyle(text).filter((value) => ["Floral", "Vintage", "Printed"].includes(value)).slice(0, 1).join(" "), "Fabric"])
    || rule(/(?:hoodies?|jumpsuits?|overalls?|tank\s*tops?|coats?|clothes\s+sets?|bodysuits?)/i, () => [audience || "Unisex", features.includes("Long-Sleeve") ? "Long-Sleeve" : "", "Everyday Apparel"])
    || rule(/(?:bag|handbag|tote|pouch|clutch|crossbody|satchel|backpack)/i, () => [audience, extractMaterial(profile.facts, text), /backpack/i.test(text) ? "Backpack" : /tote|handbag/i.test(text) ? "Tote Bag" : "Carry Bag"])
    || rule(/photography.*(?:background|backdrop)|backdrop|softbox/i, () => [brand, "Photography Backdrop"])
    || rule(/belt/i, () => [audience, extractMaterial(profile.facts, text), "Belt"])
    || rule(/stylus|touch\s*screen\s*pen/i, () => [firstSize, "Touchscreen Stylus"])
    || rule(/pen\s*holder|desktop.*holder/i, () => [firstSize, "Desk Pen Holder"])
    || rule(/umbrella/i, () => ["Compact UV Protection Umbrella"])
    || rule(/door.*lock|lock.*door|cylinder/i, () => [firstSize, "Smart Door Lock Cylinder"])
    || rule(/digital.*clock|pixel.*clock|vfd.*clock/i, () => [...brandPart, firstSize, "Digital Desk Clock"])
    || rule(/mix(?:er|ing).*console|mixer/i, () => [...brandPart, "Audio Mixer"])
    || rule(/adapter|converter|dongle|switch|holder|stand|cover|case|brush|set|kit|tool|accessor/i, () => [
      ...brandPart, firstSize, ...salientHandleWords(text, profile.classification).slice(0, 3), profile.classification.noun,
    ])
    || joinTitleParts([
      ...brandPart, firstSize, ...salientHandleWords(text, profile.classification).slice(0, 4),
      profile.classification.noun,
    ]);
}

function shortenTitle(value, maxLength = 70) {
  let result = normalizeText(value).replace(/\s+([,—-])\s*/g, " $1 ")
    .replace(/[|,:;—-]+$/g, "").replace(/\s+/g, " ").trim();
  if (result.length <= maxLength) return result;
  result = result.slice(0, maxLength).replace(/\s+\S*$/, "").replace(/[|,:;—-]+$/g, "").trim();
  result = result.replace(/\s+(?:with|for|and|or|of|the|to|a|an)$/i, "").trim();
  return result || normalizeText(value).slice(0, maxLength).trim();
}

function buildTitle(profile) {
  const family = profile.classification.familyId;
  const handleText = profile.handleText;
  const facts = profile.facts;
  const brand = brandFromText(handleText);
  const measurements = extractMeasurements(handleText, facts).filter((value) => !/^(?:2\.4g|0mm)$/i.test(value));
  const features = extractFeatures(handleText);
  const style = extractStyle(handleText);
  const material = extractMaterial(facts, handleText);
  const compatibility = extractCompatibility(handleText, facts);
  const connectors = extractConnector(handleText, facts);
  const audience = possessiveAudience(profile.audience);
  const salient = salientHandleWords(handleText, profile.classification);
  let candidate = "";
  if (family === "camera-mount") {
    const section = handleText.match(/\b\d+\s*section\b/i)?.[0] || "";
    candidate = joinTitleParts([section, /\bdouble articulated\b/i.test(handleText) ? "Double-Articulated" : "Articulated", "Camera Mounting Arm", connectors[0] || ""]);
  } else if (family === "video-adapter") {
    const resolution = measurements.find((value) => /^(?:720p|1080p|1440p|4k)$/i.test(value)) || "";
    const options = /\b(?:3\.5\s*mm|audio jack|audio port)\b/i.test(handleText)
      && /\busb\s*power|power\s*supply|usb\b/i.test(handleText);
    candidate = joinTitleParts([resolution, "HDMI-to-VGA Adapter", options ? "with Audio and USB Power Options" : ""]);
  } else if (family === "audio-cable") {
    candidate = joinTitleParts([brand, measurements[0] || "", "AUX Audio Cable", connectors.join(" ")]);
  } else if (family === "hdmi-cable") {
    const identity = identityParts(profile).filter((value) => !/^speed$/i.test(value) && !/^\d/.test(value));
    candidate = joinTitleParts([identity.join(" "), measurements.slice(0, 2).join(" "), "HDMI Cable", compatibility ? "For " + compatibility : ""]);
  } else if (family === "charging-cable") {
    candidate = joinTitleParts([brand, measurements[0] || "", /\btype[- ]?c\b/i.test(handleText) ? "USB-C" : "USB", features.includes("Fast Charging") ? "Fast-Charging" : "", "Cable", compatibility ? "For " + compatibility : ""]);
  } else if (family === "cable-organizer") {
    candidate = joinTitleParts([brand, material, "Cable Organizer Bag", features.includes("Waterproof") ? "Waterproof" : ""]);
  } else if (family === "mouse-pad") {
    candidate = joinTitleParts([material, "Computer Mouse Pad", features.includes("Waterproof") ? "Waterproof" : ""]);
  } else if (family === "computer-mouse") {
    candidate = joinTitleParts([brand, features.filter((value) => ["Wireless", "Bluetooth", "Rechargeable", "RGB Lighting"].includes(value)).slice(0, 2).join(" "), /\bgaming\b/i.test(handleText) ? "Gaming" : "", "Computer Mouse"]);
  } else if (family === "keyboard") {
    candidate = joinTitleParts([brand, features.includes("Wireless") ? "Wireless" : "", compatibility ? "For " + compatibility : "", "Keyboard"]);
  } else if (family === "smart-glasses") {
    candidate = joinTitleParts([brand, /\bcamera\b/i.test(handleText) ? "Camera" : "", /\btranslation\b/i.test(handleText) ? "Translation" : "", "Smart Glasses"]);
  } else if (family === "sunglasses") {
    candidate = joinTitleParts([audience, /\bpolarized\b/i.test(handleText) ? "Polarized" : "", "Sunglasses"]);
  } else if (family === "scarf") {
    candidate = joinTitleParts([audience, measurements[0] || "", /\bbandana\b|\bkerchief\b/i.test(handleText) ? "Bandana Scarf" : "Scarf"]);
  } else if (family === "hair-accessory") {
    const form = /\b(?:claw|crab)\b/i.test(handleText) ? "Hair Claw Clip"
      : /\b(?:barrette|hairpin|pin)\b/i.test(handleText) ? "Hair Barrette"
        : /\b(?:tie|ponytail|rubber band)\b/i.test(handleText) ? "Hair Tie Set"
          : "Hair Accessory";
    candidate = joinTitleParts([audience, material, salient.slice(0, 2).join(" "), form]);
  } else if (family === "face-covering") {
    candidate = joinTitleParts([/\bbalaclava\b/i.test(handleText) ? "Balaclava" : "Face Covering", /\bskull\b|\bhalloween\b/i.test(handleText) ? "Costume Style" : ""]);
  } else if (family === "pajamas") {
    candidate = joinTitleParts([audience || "Kids", material, "Pajama Set"]);
  } else if (family === "hat") {
    candidate = joinTitleParts([audience, /\bbeanie\b/i.test(handleText) ? "Beanie" : /\bbaseball cap\b|\bcap\b/i.test(handleText) ? "Baseball Cap" : "Sun Hat"]);
  } else if (family === "bedding") {
    candidate = joinTitleParts([material, /\bduvet\b/i.test(handleText) ? "Duvet Cover" : /\bpillowcase\b/i.test(handleText) ? "Pillowcase" : "Quilt Cover"]);
  } else if (family === "blanket") {
    candidate = joinTitleParts([material, /\bwearable\b|\bponcho\b/i.test(handleText) ? "Wearable Blanket" : "Blanket"]);
  } else if (family === "hair-care") {
    candidate = joinTitleParts([measurements[0] || "", /\bhair dye\b|\bdye shampoo\b/i.test(handleText) ? "Hair Dye Shampoo" : /\bshampoo\b/i.test(handleText) ? "Hair Shampoo" : /\bconditioner\b/i.test(handleText) ? "Hair Conditioner" : /\bhair oil\b|\boil\b/i.test(handleText) ? "Hair Oil" : /\bhair mask\b|\bmask\b/i.test(handleText) ? "Hair Mask" : "Hair Care Serum"]);
  } else if (family === "skin-care") {
    candidate = joinTitleParts([brand, measurements[0] || "", /\bmoisturizer\b/i.test(handleText) ? "Facial Moisturizer" : "Facial Serum"]);
  } else if (family === "eyeshadow") {
    candidate = joinTitleParts([measurements[0] || "", "Eyeshadow Palette"]);
  } else if (family === "eyeliner") {
    candidate = joinTitleParts([brand, /\beyebrow|brow\b/i.test(handleText) ? "Eyebrow Gel" : "Eyeliner"]);
  } else if (family === "sticker") {
    candidate = joinTitleParts([measurements[0] || "", /\bwall\b/i.test(handleText) ? "Decorative Wall Stickers" : "Sticker Set"]);
  } else if (family === "false-eyelash") {
    candidate = joinTitleParts([measurements[0] || "", salient.filter((value) => !/eyelash|lashes/i.test(value)).slice(0, 2).join(" "), "False Eyelashes"]);
  } else if (family === "memory-card") {
    candidate = joinTitleParts([brand, "SD Memory Card"]);
  } else if (family === "keychain") {
    candidate = joinTitleParts([brand, /\bairtag\b/i.test(handleText) ? "AirTag Keychain Case" : "Keychain"]);
  } else if (family === "charger") {
    candidate = joinTitleParts([brand, features.includes("Fast Charging") ? "Fast-Charging" : "", "USB Wall Charger"]);
  } else if (family === "translator") {
    candidate = joinTitleParts([brand, "Language Translator", /\bearbud|\bearphone\b/i.test(handleText) ? "Earbuds" : "Device"]);
  } else if (family === "microphone") {
    candidate = joinTitleParts([brand, measurements[0] || "", features.includes("Wireless") ? "Wireless" : "", /\bmini\b/i.test(handleText) ? "Mini" : "Handheld", "Microphone", compatibility ? "For " + compatibility : ""]);
  } else if (family === "beauty-mask") {
    candidate = joinTitleParts([features.includes("LED Lighting") ? "LED" : "", "Beauty Face Mask"]);
  } else if (family === "speaker-accessory") {
    const model = handleText.match(/\bjbl\s+boombox\s*\d*\b/i)?.[0] || "";
    candidate = joinTitleParts([brand, "Speaker Carrying Strap", model ? "For " + model : ""]);
  } else if (family === "speaker") {
    const speakerFeatures = features.filter((value) => ["RGB Lighting", "LED Lighting", "Waterproof", "Portable", "Magnetic"].includes(value)).slice(0, 2);
    candidate = joinTitleParts([brand, speakerFeatures.join(" "), "Bluetooth Speaker", /\bphone holder\b/i.test(handleText) ? "With Phone Holder" : ""]);
  } else if (family === "phone-case") {
    candidate = joinTitleParts([brand, material, compatibility, features.includes("Magnetic") ? "Magnetic" : "", "Phone Case"]);
  } else if (family === "camera-accessory") {
    candidate = joinTitleParts([
      identityParts(profile).join(" "),
      compatibility,
      /\bfilter\b/i.test(handleText) ? "Camera Lens Filter" : /\blens\b/i.test(handleText) ? "Camera Lens" : "Camera Accessory",
    ]);
  } else if (family === "selfie-stick") {
    candidate = joinTitleParts([identityParts(profile).join(" "), features.includes("Wireless") ? "Wireless" : "", "Selfie Stick", /\btripod\b/i.test(handleText) ? "Tripod" : ""]);
  } else if (family === "tripod") {
    candidate = joinTitleParts([
      identityParts(profile).filter((value) => !/^\d+(?:\.\d+)?(?:mm|cm|m|mah|w|v|oz|ml|l|g|kg|inch|in|mhz|ghz)$/i.test(value)).join(" "),
      measurements[0] || "",
      /\bselfie[- ]?stick\b/i.test(handleText) ? "Smartphone Tripod Selfie Stick" : "Smartphone Tripod",
      features.includes("Wireless") || /\bshutter\b/i.test(handleText) ? "With Wireless Shutter" : "",
    ]);
  } else if (family === "phone-holder") {
    candidate = joinTitleParts([brand, features.includes("Magnetic") ? "Magnetic" : "", "Phone Holder", /\bdesk\b/i.test(handleText) ? "For Desk" : ""]);
  } else if (family === "watch-organizer") {
    candidate = joinTitleParts([audience, features.includes("Portable") ? "Portable" : "Travel", "Watch Organizer Case"]);
  } else if (family === "watch-strap") {
    candidate = joinTitleParts([material || "Replacement", "Watch Strap", measurements[0] || ""]);
  } else if (family === "smart-watch") {
    candidate = joinTitleParts([identityParts(profile).join(" "), features.filter((value) => ["Waterproof", "GPS", "Bluetooth"].includes(value)).slice(0, 2).join(" "), audience, "Smart Watch"]);
  } else if (family === "watch") {
    candidate = joinTitleParts([identityParts(profile).join(" "), style.includes("Casual") ? "Casual" : "", audience, "Wristwatch"]);
  } else if (family === "radio") {
    candidate = joinTitleParts([/\bsolar\b/i.test(handleText) ? "Solar" : "", /\bhand crank\b/i.test(handleText) ? "Hand-Crank" : "", "Emergency Radio", features.includes("LED Lighting") ? "With LED Light" : ""]);
  } else if (family === "flashlight") {
    candidate = joinTitleParts([features.includes("Rechargeable") ? "Rechargeable" : "", features.includes("LED Lighting") ? "LED" : "", "Flashlight"]);
  } else if (family === "audio-accessory") {
    candidate = joinTitleParts([
      identityParts(profile).join(" "),
      features.includes("Wireless") || /\bbluetooth\b/i.test(handleText) ? "Wireless" : "",
      /\bheadphone|\bheadset\b/i.test(handleText) ? "Headset" : /\bearphone\b/i.test(handleText) ? (features.includes("Wireless") ? "Wireless Earphones" : "Wired Earphones") : /\bearbud\b/i.test(handleText) ? "Earbuds" : "Audio Accessory",
      compatibility ? "For " + compatibility : "",
    ]);
  } else if (family === "camera") {
    candidate = joinTitleParts([identityParts(profile).join(" "), measurements[0] || "", /\bsecurity\b|\bcctv\b/i.test(handleText) ? "Security Camera" : "Digital Camera"]);
  } else if (family === "nfc-tag") {
    candidate = joinTitleParts([measurements[0] || "", "NFC", /\bcard\b/i.test(handleText) ? "Tag Card" : "Tag"]);
  } else if (family === "game-controller") {
    candidate = joinTitleParts([brand, features.includes("Wireless") ? "Wireless" : "", "Game Controller", compatibility ? "For " + compatibility : ""]);
  } else if (family === "toy-tea-set") {
    candidate = joinTitleParts([audience || "Kids", material || "Wooden", "Tea Set Pretend Play Toy"]);
  } else if (family === "board-game") {
    candidate = joinTitleParts([salient.filter((value) => !/game|games/i.test(value)).slice(0, 2).join(" "), "Board Game"]);
  } else if (family === "toy") {
    candidate = joinTitleParts([identityParts(profile).join(" "), material, salient.filter((value) => !/toy|puzzle|game/i.test(value)).slice(0, 2).join(" "), "Toy"]);
  } else if (family === "pet-bed") {
    candidate = joinTitleParts([material, "Pet Bed", /\bcat\b|\bkitten\b/i.test(handleText) ? "For Cats" : "For Dogs"]);
  } else if (family === "pet-toy") {
    const petTarget = /\b(?:dog|puppy)\b/i.test(handleText) ? "For Dogs" : /\b(?:cat|kitten)\b/i.test(handleText) ? "For Cats" : "For Pets";
    const petForm = /\bbone\b/i.test(handleText) ? "Chew Bone Toy"
      : /\b(?:plush|catnip)\b/i.test(handleText) ? "Plush Chew Toy"
        : /\b(?:toothbrush|teeth[- ]?cleaning|dental)\b/i.test(handleText) ? "Dental Chew Toy"
          : /\bball\b/i.test(handleText) ? "Chew Ball Toy" : "Interactive Pet Toy";
    const petFeatures = extractFeatures(handleText).filter((value) => ["Squeaky", "Bite-Resistant", "Catnip", "Interactive"].includes(value)).slice(0, 2);
    candidate = joinTitleParts([petFeatures.join(" "), petForm, petTarget]);
  } else if (family === "pet-accessory") {
    const isOutfit = /\boutfit\b|\bclothing\b/i.test(handleText);
    const petContext = salient.filter((value) => !/outfit|pet|clothing/i.test(value)).slice(0, 2).join(" ");
    const petAudience = /\b(?:dog|puppy)\b/i.test(handleText) ? "For Dogs" : /\b(?:cat|kitten)\b/i.test(handleText) ? "For Cats" : "";
    candidate = isOutfit
      ? joinTitleParts([/\bholiday|halloween|christmas\b/i.test(handleText) ? "Seasonal" : "", material, "Pet Outfit", petAudience])
      : joinTitleParts([petContext, "Pet Accessory", petAudience]);
  } else if (family === "medical-kit") {
    candidate = joinTitleParts([measurements[0] || "", "Medical Kit", /\bcar\b|\boutdoor\b|\bemergency\b/i.test(handleText) ? "For Emergency Supplies" : ""]);
  } else if (family === "backpack") {
    candidate = joinTitleParts([measurements[0] || "", /\btactical\b/i.test(handleText) ? "Tactical" : "", /\bmolle\b/i.test(handleText) ? "MOLLE" : "", "Hiking Backpack"]);
  } else if (family === "sleeping-bag") {
    candidate = joinTitleParts([material, /\bdouble\b/i.test(handleText) ? "Double" : "", "Sleeping Bag"]);
  } else if (family === "cooler-bag") {
    candidate = joinTitleParts([material, "Insulated Cooler Bag", /\bwine\b/i.test(handleText) ? "For Wine" : ""]);
  } else if (family === "camping-table") {
    candidate = joinTitleParts([material, "Folding Camping Table", measurements[0] || ""]);
  } else if (family === "tent") {
    candidate = joinTitleParts([/\bpop[- ]?up\b/i.test(handleText) ? "Pop-Up" : /\bbeach\b/i.test(handleText) ? "Beach" : "Camping", measurements[0] || "", "Tent"]);
  } else if (family === "home-decor") {
    candidate = joinTitleParts([salient.slice(0, 3).join(" "), "Home Decor"]);
  } else if (family === "shoes") {
    candidate = joinTitleParts([material, salient.slice(0, 2).join(" "), /\bsneaker\b/i.test(handleText) ? "Sneakers" : "Shoes"]);
  } else if (family === "wallet") {
    candidate = joinTitleParts([audience, material, "Wallet"]);
  } else if (family === "jewelry") {
    candidate = joinTitleParts([material, /\bgold\b/i.test(handleText) ? "Gold" : "", /\bbrooch\b/i.test(handleText) ? "Brooch Pin" : /\bnecklace\b/i.test(handleText) ? "Necklace" : /\bbracelet\b/i.test(handleText) ? "Bracelet" : "Jewelry Accessory"]);
  } else if (family === "makeup-powder") {
    candidate = joinTitleParts([brand, "Loose Baking Setting Powder", material]);
  } else if (family === "lip-makeup") {
    candidate = joinTitleParts([brand, /\bmatte\b/i.test(handleText) ? "Matte" : "", "Lip Makeup"]);
  } else if (family === "makeup-brush") {
    candidate = joinTitleParts([brand, "Foundation Concealer Makeup Brush"]);
  } else if (family === "makeup-sponge") {
    candidate = joinTitleParts([brand, "Makeup Sponge"]);
  } else if (family === "face-paint") {
    candidate = joinTitleParts([measurements[0] || "", "Face and Body Paint Set"]);
  } else if (family === "makeup-foundation") {
    candidate = joinTitleParts([brand, measurements[0] || "", /\bcc cream\b/i.test(handleText) ? "CC Cream" : /\bliquid foundation\b/i.test(handleText) ? "Liquid Foundation" : "Foundation"]);
  } else if (family === "apparel-dress") {
    candidate = joinTitleParts([audience, style.filter((value) => ["V-Neck", "Short-Sleeve", "Long-Sleeve", "Off-Shoulder"].includes(value)).slice(0, 2).join(" "), /\bt[- ]?shirts?\b/i.test(handleText) ? "T-Shirt Dress" : "Dress"]);
  } else if (family === "apparel-shirt") {
    const kind = /\bpolos?\b/i.test(handleText) ? "Polo Shirt" : /\bt[- ]?shirts?\b|\btees?\b/i.test(handleText) ? "T-Shirt" : "Button-Down Shirt";
    candidate = joinTitleParts([
      audience,
      brand,
      style.filter((value) => ["Embroidered", "Printed", "Short-Sleeve", "Long-Sleeve", "Casual", "Breathable"].includes(value)).slice(0, 3).join(" "),
      material,
      kind,
    ]);
  } else if (family === "apparel-costume") {
    candidate = joinTitleParts([
      audience || "Kids",
      /\bblack\b/i.test(handleText) ? "Black" : "",
      /\bgold|gloden\b/i.test(handleText) ? "Gold-Detail" : "",
      "Cosplay Costume",
    ]);
  } else if (family === "apparel-jumpsuit") {
    candidate = joinTitleParts([
      audience,
      style.filter((value) => ["Printed", "Striped", "Short-Sleeve", "Long-Sleeve", "V-Neck", "Casual"].includes(value)).slice(0, 2).join(" "),
      material,
      "Jumpsuit",
    ]);
  } else if (family === "apparel-set") {
    candidate = joinTitleParts([
      audience || "Kids",
      /basketball/i.test(handleText) ? "Basketball" : "Everyday",
      style.filter((value) => ["Printed", "Striped", "Casual", "Breathable"].includes(value)).slice(0, 2).join(" "),
      "Clothing Set",
    ]);
  } else if (family === "apparel-top") {
    candidate = joinTitleParts([audience, style.filter((value) => ["Short-Sleeve", "Long-Sleeve", "V-Neck", "Off-Shoulder"].includes(value)).slice(0, 2).join(" "), material, "Top"]);
  } else if (family === "apparel-bottom") {
    candidate = joinTitleParts([audience, style.filter((value) => ["Casual", "Slim-Fit"].includes(value)).join(" "), material, /\bjeans\b/i.test(handleText) ? "Jeans" : /\bshorts\b/i.test(handleText) ? "Shorts" : "Pants"]);
  } else if (family === "apparel-outerwear") {
    candidate = joinTitleParts([audience, style.filter((value) => ["Casual", "Long-Sleeve"].includes(value)).join(" "), material, /\bhoodies?\b/i.test(handleText) ? "Hoodie" : /\bsweaters?\b/i.test(handleText) ? "Sweater" : "Jacket"]);
  } else if (family === "apparel-underwear") {
    candidate = joinTitleParts([audience, material, /\bbra\b/i.test(handleText) ? "Bra" : /\bswimsuit|bikini\b/i.test(handleText) ? "Swimsuit" : "Underwear"]);
  } else if (family === "socks") {
    candidate = joinTitleParts([audience, material, /\bthermal\b/i.test(handleText) ? "Thermal" : "", "Socks"]);
  } else if (family === "baby-romper") {
    candidate = joinTitleParts(["Baby", style.filter((value) => ["Short-Sleeve", "Long-Sleeve"].includes(value)).join(" "), material, "Romper"]);
  } else if (family === "drinkware") {
    candidate = joinTitleParts([measurements[0] || "", material, /\bthermos\b|\bvacuum\b/i.test(handleText) ? "Insulated Thermos" : /\btumbler\b/i.test(handleText) ? "Travel Tumbler" : /\bmug\b/i.test(handleText) ? "Travel Mug" : /\bcup\b/i.test(handleText) ? "Travel Cup" : "Water Bottle"]);
  } else if (family === "cookware") {
    candidate = joinTitleParts([measurements[0] || "", material, /\bpan\b/i.test(handleText) ? "Cooking Pan" : "Cookware Set"]);
  } else if (family === "cleaning-tool") {
    candidate = joinTitleParts([/\bglass\b|\bwindow\b/i.test(handleText) ? "Glass Window" : "", "Cleaning Squeegee"]);
  } else if (family === "laundry-clip") {
    candidate = joinTitleParts([measurements[0] || "", "Laundry Clothespin Set"]);
  } else if (family === "organizer") {
    candidate = joinTitleParts([salient.slice(0, 3).join(" "), "Organizer"]);
  } else if (family === "fan") {
    candidate = joinTitleParts([features.includes("Portable") ? "Portable" : "", measurements[0] || "", "Handheld Fan"]);
  } else if (family === "light") {
    candidate = joinTitleParts([features.includes("Solar") ? "Solar" : "", features.includes("Rechargeable") ? "Rechargeable" : "", "Light"]);
  } else if (family === "tool") {
    candidate = joinTitleParts([material, salient.slice(0, 3).join(" "), "Tool"]);
  } else if (family === "bag") {
    candidate = joinTitleParts([material, salient.slice(0, 2).join(" "), "Bag"]);
  } else if (family === "general-accessory") {
    candidate = generalAccessoryTitle(profile);
  } else {
    candidate = joinTitleParts([brand, measurements[0] || "", salient.slice(0, 4).join(" "), profile.classification.noun]);
  }
  if (!candidate || candidate.length < 20 || GENERIC_TITLE_RE.test(candidate)) candidate = joinTitleParts([brand, salient.slice(0, 5).join(" "), profile.classification.noun]);
  if (!candidate || candidate.length < 20) candidate = titleCasePhrase(salient.slice(0, 6).join(" ") + " " + profile.classification.noun);
  if (candidate.length < 20) candidate = joinTitleParts([candidate, family.startsWith("apparel-") ? "Everyday Style" : "Edition"]);
  const shortened = shortenTitle(candidate, 70);
  const aliases = NOUN_ALIASES[family] || [];
  const requiredAlias = aliases.find((alias) => new RegExp("\\b" + escapeRegExp(alias) + "\\b", "i").test(candidate));
  if (requiredAlias && !new RegExp("\\b" + escapeRegExp(requiredAlias) + "\\b", "i").test(shortened)) {
    const lead = shortenTitle(shortened, Math.max(8, 70 - requiredAlias.length - 1));
    return shortenTitle((lead + " " + requiredAlias).trim(), 70);
  }
  return shortened;
}

function factEntries(profile) {
  const allowed = [
    "Material", "Size or capacity", "Color", "Pattern", "Supported features", "Device compatibility",
    "Use or occasion", "Placement or setting", "Power source", "Frequency", "Connector size",
    "Connection", "Connector layout", "Arm format", "Mounting fittings", "Style or design",
    "Pack format", "Available options",
  ];
  const result = [];
  for (const label of allowed) {
    const value = factValue(profile.facts, label);
    if (!value || /^none|null|n\/a$/i.test(value)) continue;
    const cleaned = titleCasePhrase(value).replace(/\bNone\b/gi, "").trim();
    if (cleaned) result.push({ label, value: cleaned });
  }
  return uniqueValues(result.map((entry) => entry.label + "\u0000" + entry.value)).map((entry) => {
    const splitAt = entry.indexOf("\u0000");
    return { label: entry.slice(0, splitAt), value: entry.slice(splitAt + 1) };
  }).slice(0, 6);
}

function factPhrase(entry) {
  const value = sentenceValue(entry.value);
  if (!value) return "";
  if (entry.label === "Material") return "a " + value + " construction";
  if (entry.label === "Size or capacity") return "a " + value + " size or capacity";
  if (entry.label === "Color") return "a " + value + " colorway";
  if (entry.label === "Pattern") return "a " + value + " pattern";
  if (entry.label === "Supported features") return "features including " + value;
  if (entry.label === "Device compatibility") return "compatibility with " + value;
  if (entry.label === "Use or occasion") return "use for " + value;
  if (entry.label === "Placement or setting") return "placement in " + value;
  if (entry.label === "Power source") return value + " power";
  if (entry.label === "Frequency") return value + " frequency support";
  if (entry.label === "Connector size") return value + " connector sizing";
  if (entry.label === "Connection") return value + " connectivity";
  if (entry.label === "Connector layout") return value + " connector layout";
  if (entry.label === "Arm format") return value + " arm construction";
  if (entry.label === "Mounting fittings") return value + " mounting fittings";
  if (entry.label === "Style or design") return value + " styling";
  if (entry.label === "Pack format") return value + " pack format";
  if (entry.label === "Available options") return "options including " + value;
  return value;
}

const USE_TERMS = [
  ["camping", "camping"], ["outdoor", "outdoor use"], ["hiking", "hiking"], ["travel", "travel"],
  ["beach", "beach days"], ["gaming", "gaming"], ["office", "office use"], ["desk", "desk use"],
  ["kitchen", "kitchen use"], ["bathroom", "bathroom use"], ["car", "car use"], ["home", "home use"],
  ["photography", "photography"], ["music", "music listening"], ["sports", "sports"], ["fishing", "fishing"],
  ["cosplay", "cosplay"], ["halloween", "Halloween"], ["holiday", "holiday styling"], ["wedding", "wedding styling"],
  ["school", "school use"], ["work", "work use"], ["sleep", "sleep and lounge time"],
];

const DESIGN_TERMS = new Set([
  "flickering", "flame", "fireplace", "candles", "candlestick", "simulation", "tactical", "molle",
  "henley", "gothic", "striped", "floral", "vintage", "cartoon", "embroidered", "wireless",
  "portable", "foldable", "magnetic", "rechargeable", "insulated", "waterproof", "infrared",
  "night", "vision", "hollow", "slim", "matte", "silky", "creamy", "holiday", "christmas",
  "cosplay", "halloween", "minimalist", "retro", "sport", "sports",
]);

function productEvidencePhrases(profile, facts) {
  const phrases = facts.map(factPhrase).filter(Boolean);
  const features = extractFeatures(profile.handleText).map((value) => value.toLowerCase());
  if (features.length && !phrases.some((value) => /features including/i.test(value))) {
    phrases.push("features including " + naturalList(features));
  }
  const measurements = extractMeasurements(profile.handleText, facts);
  if (measurements.length && !phrases.some((value) => /size or capacity/i.test(value))) {
    phrases.push("a " + naturalList(measurements) + " size or capacity");
  }
  const material = extractMaterial(facts, profile.handleText);
  if (material && !phrases.some((value) => value.toLowerCase().includes(material.toLowerCase()))) {
    phrases.push("a " + material + " construction");
  }
  const compatibility = extractCompatibility(profile.handleText, facts);
  if (compatibility && !phrases.some((value) => value.toLowerCase().includes(compatibility.toLowerCase()))) {
    phrases.push("compatibility with " + compatibility);
  }
  const uses = USE_TERMS.filter(([term]) => new RegExp("\\b" + escapeRegExp(term) + "\\b", "i").test(profile.handleText))
    .map(([, value]) => value);
  if (uses.length && !phrases.some((value) => /use for/i.test(value))) phrases.push("use for " + naturalList(uses.slice(0, 3)));
  const design = uniqueValues(tokenise(profile.handleText).filter((token) => DESIGN_TERMS.has(token)))
    .filter((token) => !(token === "waterproof" && /\b(?:non|not|without)[- ]+waterproof\b/i.test(profile.handleText)))
    .map(titleCasePhrase).filter((value) => !phrases.some((phrase) => phrase.toLowerCase().includes(value.toLowerCase())));
  if (design.length) phrases.push("a " + naturalList(design.slice(0, 3)) + " design");
  return uniqueValues(phrases).slice(0, 4);
}

function withProductEvidence(base, profile, facts) {
  const details = productEvidencePhrases(profile, facts).slice(0, 2);
  if (!details.length) return base;
  return base.replace(/\.$/, "") + ". It includes " + naturalList(details) + ".";
}

function naturalizeCustomerCopy(value) {
  return String(value || "")
    .replace(/\bthe product shown in the listing\b/gi, "the product")
    .replace(/\bshown in the listing\b/gi, "included with it")
    .replace(/\bnamed in the listing\b/gi, "included with it")
    .replace(/\bdescribed in the listing\b/gi, "included with it")
    .replace(/\bidentified in the listing\b/gi, "included with it")
    .replace(/\bdescribed by the listing\b/gi, "included with it")
    .replace(/\bshown by its fit, form, and configuration\b/gi, "included in its fit, form, and configuration")
    .replace(/\bthe listing notes\b/gi, "it includes")
    .replace(/\bthe listed\b/gi, "the available")
    .replace(/\blisted\b/gi, "available")
    .replace(/\bthe stated\b/gi, "the product's")
    .replace(/\bshown by the product\b/gi, "included with the product")
    .replace(/\bshown by its fit, form, and configuration\b/gi, "included in its fit, form, and configuration")
    .replace(/\s+/g, " ")
    .trim();
}

function familyIntro(profile, title) {
  const family = profile.classification.familyId;
  const handle = profile.handleText;
  const material = extractMaterial(profile.facts, handle);
  const measurements = extractMeasurements(handle, profile.facts);
  const uses = USE_TERMS.filter(([term]) => new RegExp("\\b" + escapeRegExp(term) + "\\b", "i").test(handle))
    .map(([, value]) => value);
  if (family === "video-adapter") {
    const resolution = measurements.find((value) => /^(?:720p|1080p|1440p|4k)$/i.test(value));
    const resolutionText = resolution ? ` for ${resolution} video output` : "";
    return `The ${title} carries video from an HDMI source to a VGA display${resolutionText}, keeping the connector direction clear for setup.`;
  }
  if (family === "pet-accessory" && /\boutfit\b|\bclothing\b/i.test(handle)) {
    const seasonal = /\bholiday|halloween|christmas\b/i.test(handle);
    const useText = uses.length ? naturalList(uses.slice(0, 2)) : seasonal ? "holiday photos and home styling" : "dress-up and photos";
    return `The ${title} is a ${material ? material.toLowerCase() + " " : ""}pet outfit made for ${useText}. Its seasonal styling is easy to choose by look, while the selected fit should be checked for your pet before ordering.`;
  }
  if (family === "speaker") return "The " + title + " is a portable Bluetooth speaker for listening on the go, with the lighting and connection details named in its configuration.";
  if (family === "speaker-accessory") return "The " + title + " is a carrying accessory that makes a compatible speaker easier to take from place to place.";
  if (family === "audio-cable") return "The " + title + " is an AUX audio cable for linking compatible devices, with the connector arrangement made clear before you choose an option.";
  if (family === "hdmi-cable") return "The " + title + " is an HDMI cable for connecting a compatible screen, console, or media device.";
  if (family === "charging-cable") return "The " + title + " is a charging and data cable for connecting compatible devices without adding unnecessary bulk to a setup.";
  if (family === "mouse-pad") return "The " + title + " gives a mouse a consistent surface for everyday work or gaming, with its finish and size easy to check before checkout.";
  if (family === "computer-mouse") return "The " + title + " is a computer mouse for the selected control style and connection mode.";
  if (family === "keyboard") return "The " + title + " is a compact keyboard for the selected device setup and input style.";
  if (family === "audio-accessory") return "The " + title + " is personal audio gear for listening or calls, with its connection and fit details clear before ordering.";
  if (family === "smart-glasses") return "The " + title + " combines eyewear with the camera, calling, or translation features named in its configuration.";
  if (family === "scarf") return "The " + title + " adds a lightweight layer or styling accent, with its size, print, and fabric details clear before ordering.";
  if (family === "face-covering") return "The " + title + " is a wearable face covering for outdoor, costume, or protective use.";
  if (family === "pajamas") return "The " + title + " is a sleepwear set shaped around its age range, fabric, and print details.";
  if (family === "hat") return "The " + title + " is a wearable hat for the sun, season, or everyday styling.";
  if (family === "bedding") return "The " + title + " is a bedding cover made to fit its size and closure details.";
  if (family === "blanket") return "The " + title + " adds a soft layer for a room, bed, or travel setup.";
  if (family === "hair-care") return "The " + title + " is a hair-care treatment in its stated format and size.";
  if (family === "skin-care") return "The " + title + " is a skin-care formula with its texture, size, and intended routine.";
  if (family === "eyeshadow") return "The " + title + " is a color palette for eye makeup, with its shade count and finish easy to compare.";
  if (family === "eyeliner") return "The " + title + " is an eye-makeup essential in a pencil, gel, or liquid format.";
  if (family === "sticker") return "The " + title + " is a decorative sticker set for the intended surfaces and occasion.";
  if (family === "memory-card") return "The " + title + " is removable storage for a compatible device, with its capacity clear before ordering.";
  if (family === "keychain") return "The " + title + " keeps keys or a compatible tracker accessory close at hand in its stated attachment format.";
  if (family === "charger") return "The " + title + " is a wall charger for its power and connector setup.";
  if (family === "translator") return "The " + title + " is a language tool with its translation format and connection features.";
  if (family === "microphone") return "The " + title + " is a microphone for a recording, calling, or performance setup.";
  if (family === "beauty-mask") return "The " + title + " is a beauty mask for its treatment format and skin-care routine.";
  if (family === "makeup-foundation") return "The " + title + " is a complexion product in its finish and application format.";
  if (family === "false-eyelash") return "The " + title + " adds a defined lash style in a format suited to your makeup routine.";
  if (family === "camera-mount") return "The " + title + " gives a camera or light a movable mounting point, with thread and pin fittings that should be matched to the equipment.";
  if (family === "watch-organizer") return "The " + title + " is a travel case for keeping watches together, separated, and ready to pack.";
  if (family === "watch" || family === "smart-watch") return "The " + title + " is a wristwatch designed around the display, timekeeping, or smart features named in its configuration.";
  if (family === "phone-case") return "The " + title + " is a phone case made to cover a compatible device while keeping the selected cutouts and controls accessible.";
  if (family === "phone-holder") return "The " + title + " keeps a compatible phone in a stable position for the viewing or mounting setup described by the product.";
  if (family === "camera") return "The " + title + " is a camera for shooting, recording, or security use.";
  if (family === "camera" || family === "camera-accessory") return "The " + title + " supports camera use with its optical, mounting, or photographic configuration.";
  if (family === "selfie-stick" || family === "tripod") return "The " + title + " is a compact support for phone or camera shooting, with its adjustment and connection features clear before ordering.";
  if (family === "backpack") return "The " + title + " is a carry-ready backpack for organizing everyday, travel, or outdoor gear around the capacity described.";
  if (family === "tent") return "The " + title + " creates a portable shelter for outdoor trips and day use, with a packable setup.";
  if (family === "camping-table") return "The " + title + " provides a practical surface for outdoor meals, equipment, or preparation when a portable table is useful.";
  if (family === "home-decor") return "The " + title + " brings its decorative theme into a room, display, or seasonal setting.";
  if (family === "shoes") return "The " + title + " is footwear shaped around its material, fit, and use setting.";
  if (family === "nfc-tag") return "The " + title + " is a contactless NFC tag or card for a compatible device setup.";
  if (family === "jewelry") return "The " + title + " is a jewelry accessory that adds its finish, color, or decorative detail.";
  if (family.startsWith("apparel-") || family === "socks" || family === "baby-romper") return "The " + title + " is an easy-to-style garment shaped around its cut, fabric, and occasion details.";
  if (family.startsWith("makeup-") || family === "face-paint") return "The " + title + " is a beauty essential selected for its application, finish, or format.";
  if (family === "drinkware") return "The " + title + " is made for carrying or serving a drink, with its capacity, material, and everyday-use details clear before checkout.";
  if (family === "cookware") return "The " + title + " is a kitchen piece for the cooking task it is designed to support, with material and size easy to compare.";
  if (family === "pet-toy") {
    const target = /\b(?:dog|puppy)\b/i.test(profile.handleText) ? "dogs" : /\b(?:cat|kitten)\b/i.test(profile.handleText) ? "cats" : "pets";
    const form = /\bbone\b/i.test(profile.handleText) ? "chew bone" : /\b(?:plush|catnip)\b/i.test(profile.handleText) ? "plush chew toy" : /\b(?:toothbrush|teeth|dental)\b/i.test(profile.handleText) ? "dental chew toy" : "interactive toy";
    const article = /^[aeiou]/i.test(form) ? "an " : "a ";
    return "The " + title + " gives " + target + " " + article + form + " made for chewing and play, with its shape and features clearly shown.";
  }
  if (family === "pet-bed") {
    const target = /\b(?:dog|puppy)\b/i.test(profile.handleText) ? "dogs" : /\b(?:cat|kitten)\b/i.test(profile.handleText) ? "cats" : "pets";
    return "The " + title + " creates a dedicated resting spot for " + target + ", with the selected size and materials easy to compare.";
  }
  if (family === "pet-accessory") return "The " + title + " is a practical accessory for the pet and use supported by its fit, form, and configuration.";
  if (family === "medical-kit") return "The " + title + " is a compact way to keep medical or emergency supplies together for the intended setting.";
  if (family === "cleaning-tool") return "The " + title + " is a practical cleaning tool for the intended surface and room use.";
  if (family === "organizer" || family === "cable-organizer") return "The " + title + " helps keep named essentials together and easier to find, with a storage format suited to the task.";
  if (family === "board-game" || family === "game-controller" || family === "toy-tea-set") return "The " + title + " is a play-focused item shaped for its game, pretend-play, or controller format.";
  if (family === "toy") return "The " + title + " is a play or learning toy shaped for its activity and form.";
  if (family === "fan" || family === "light" || family === "radio" || family === "flashlight") return "The " + title + " is a practical portable device with its power, lighting, or use setting clear before checkout.";
  if (family === "general-accessory") {
    const noun = profile.classification.noun.toLowerCase();
    return "The " + title + " is " + indefiniteArticle(noun) + " " + noun + " chosen for its form and intended setting.";
  }
  const noun = profile.classification.noun.toLowerCase();
  return "The " + title + " is " + indefiniteArticle(noun) + " " + noun + " with its features and intended use clear before checkout.";
}

function naturalList(values) {
  const items = uniqueValues(values.map((value) => normalizeText(value)).filter(Boolean));
  if (items.length < 2) return items[0] || "";
  if (items.length === 2) return items[0] + " and " + items[1];
  return items.slice(0, -1).join(", ") + ", and " + items.at(-1);
}

function indefiniteArticle(value) {
  return /^[aeiou]/i.test(String(value || "").trim()) ? "an" : "a";
}

function compactMetaSummaryBase(profile, facts) {
  const family = profile.classification.familyId;
  const features = extractFeatures(profile.handleText);
  const measurements = extractMeasurements(profile.handleText, profile.facts);
  const connectors = extractConnector(profile.handleText, profile.facts);
  const featureText = features.slice(0, 2).map(sentenceValue);
  if (family === "speaker") {
    const extras = featureText.filter((value) => /rgb|led|waterproof|portable|magnetic/i.test(value));
    if (/\bphone holder\b/i.test(profile.handleText)) extras.push("phone holder");
    return "Portable Bluetooth speaker with " + (extras.length ? naturalList(extras) : "wireless listening") + ".";
  }
  if (family === "audio-cable") return "AUX audio cable with " + (connectors.length ? naturalList(connectors.map(sentenceValue)).slice(0, 45) : "a compatible connector layout") + ".";
  if (family === "hdmi-cable") return "HDMI cable for a compatible screen, console, or media setup.";
  if (family === "camera-mount") return "Double-articulated camera arm with " + (connectors.length ? sentenceValue(connectors[0]).slice(0, 30) + " and threaded fittings" : "adjustable mounting support") + ".";
  if (family === "watch-organizer") return "Portable travel case for keeping watches organized and ready to pack.";
  if (family === "watch" || family === "smart-watch") return "Wristwatch with the display, timekeeping, or smart functions suited to the chosen model.";
  if (family === "phone-case") return "Device-specific phone case with its compatible fit, material, and protective configuration.";
  if (family === "phone-holder") return "Phone holder for a stable viewing or mounting position.";
  if (family === "mouse-pad") return "Mouse pad with a consistent surface, finish, and size for a desk setup.";
  if (family === "computer-mouse") return "Computer mouse with its connection mode and control features.";
  if (family === "keyboard") return "Keyboard with its layout, connection mode, and compatible device format.";
  if (family === "smart-glasses") return "Smart glasses with the camera, calling, or translation features built into the chosen model.";
  if (family === "audio-accessory") {
    const kind = /\bheadphone|\bheadset\b/i.test(profile.handleText) ? "Headset" : /\bearphone\b/i.test(profile.handleText) ? (features.includes("Wireless") ? "Wireless earphones" : "Wired earphones") : /\bearbud\b/i.test(profile.handleText) ? "Earbuds" : "Audio accessory";
    const audioFeatures = extractFeatures(profile.handleText).filter((value) => ["Bluetooth", "Wireless", "Waterproof"].includes(value));
    return kind + (audioFeatures.length ? " with " + naturalList(audioFeatures.map(sentenceValue).slice(0, 2)) : " for listening and calls") + ".";
  }
  if (family === "scarf") return "Scarf or bandana with its size, print, and fabric details.";
  if (family === "face-covering") return "Wearable face covering with its shape, print, and intended setting.";
  if (family === "pajamas") return "Sleepwear set with its fabric, print, and age-range details.";
  if (family === "hat") return "Hat or cap with its brim, fabric, and intended season.";
  if (family === "bedding") return "Bedding cover with its dimensions, fabric, and closure details.";
  if (family === "blanket") return "Blanket with its fabric, size, and room or travel use.";
  if (family === "hair-care") return "Hair-care treatment with its formula, size, and routine.";
  if (family === "skin-care") return "Skin-care formula with its texture, size, and intended routine.";
  if (family === "eyeshadow") return "Eyeshadow palette with its shade count and finish.";
  if (family === "eyeliner") return "Eyeliner or brow product in a pencil, gel, or liquid format.";
  if (family === "sticker") return "Sticker set with its pack size, designs, and intended surface.";
  if (family === "memory-card") return "Removable memory card for a compatible device format and capacity.";
  if (family === "keychain") return "Keychain or tracker case in its shape and attachment format.";
  if (family === "charger") return "Wall charger with its power and connector configuration.";
  if (family === "translator") return "Language translator with its language, audio, and connection features.";
  if (family === "microphone") return "Microphone for a recording, calling, or performance setup.";
  if (family === "beauty-mask") return "Beauty mask with its treatment format and skin-care use.";
  if (family === "makeup-foundation") return "Foundation or complexion makeup in its size and application format.";
  if (family === "false-eyelash") return "False eyelashes in their lash style and application format.";
  if (family === "backpack") return (measurements[0] ? measurements[0] + " " : "") + "hiking backpack for organizing travel or outdoor gear.";
  if (family === "tent") return "Packable outdoor tent for the beach, camping, or travel setting.";
  if (family === "camera") return "Camera with its recording, lens, or security configuration.";
  if (family === "home-decor") return "Home decor with its theme, finish, and setting.";
  if (family === "shoes") return "Footwear with its material, style, and intended setting.";
  if (family === "nfc-tag") return "NFC tag or card for a contactless setup.";
  if (family === "apparel-shirt") {
    const styles = extractStyle(profile.handleText).filter((value) => ["Embroidered", "Short-Sleeve", "Long-Sleeve", "Casual", "Button-Down"].includes(value)).map(sentenceValue);
    return (styles.length ? naturalList(styles) + " " : "Everyday ") + "shirt styling with clear details for choosing the right size.";
  }
  if (family === "apparel-dress") {
    const styles = extractStyle(profile.handleText).filter((value) => ["V-Neck", "Short-Sleeve", "Long-Sleeve", "Off-Shoulder"].includes(value)).map(sentenceValue);
    return (styles.length ? naturalList(styles) + " " : "Everyday ") + "dress styling for choosing the right size.";
  }
  if (family === "apparel-top") return "Top styling with its neckline, sleeve, and fabric details for choosing the right size.";
  if (family.startsWith("apparel-") || family === "socks" || family === "baby-romper") return "Garment with its cut, fabric, and occasion details for choosing the right size.";
  if (family.startsWith("makeup-") || family === "face-paint") return "Beauty item with its shade, finish, or application format.";
  const phrases = facts.map(factPhrase).filter(Boolean).slice(0, 2);
  if (phrases.length) return "Details include " + naturalList(phrases) + ".";
  const anchors = salientHandleWords(profile.handleText, profile.classification).slice(0, 3);
  return anchors.length
    ? "The " + profile.classification.noun + " brings together " + naturalList(anchors.map(sentenceValue)) + " details for an informed selection."
    : "The " + profile.classification.noun + " is presented with its intended configuration for a clear choice.";
}

function compactMetaSummary(profile, facts) {
  const family = profile.classification.familyId;
  const base = family === "speaker" ? "Portable Bluetooth speaker"
    : family === "speaker-accessory" ? "Speaker carrying accessory"
      : family === "audio-cable" ? "AUX audio cable"
        : family === "hdmi-cable" ? "HDMI cable"
          : family === "charging-cable" ? "Charging cable"
            : family === "cable-organizer" ? "Cable organizer"
              : family === "camera-mount" ? "Camera mounting arm"
                : family === "camera-accessory" ? "Camera accessory"
                  : family === "camera" ? "Digital camera"
                    : family === "selfie-stick" ? "Selfie stick"
                      : family === "tripod" ? "Smartphone tripod"
                        : family === "phone-case" ? "Device-specific phone case"
                          : family === "phone-holder" ? "Phone holder"
                            : family === "watch-organizer" ? "Watch organizer case"
                              : family === "watch-strap" ? "Replacement watch strap"
                                : family === "watch" ? "Wristwatch"
                                  : family === "smart-watch" ? "Smart watch"
                                    : family === "audio-accessory" ? "Personal audio gear"
                                      : family === "microphone" ? "Microphone"
                                        : family === "keyboard" ? "Keyboard"
                                          : family === "computer-mouse" ? "Computer mouse"
                                            : family === "smart-glasses" ? "Smart glasses"
                                              : family === "memory-card" ? "Memory card"
                                                : family === "charger" ? "Device charger"
                                                  : family === "translator" ? "Language translator"
                                                    : family === "backpack" ? "Hiking backpack"
                                                      : family === "tent" ? "Outdoor tent"
                                                        : family === "camping-table" ? "Folding camping table"
                                                          : family === "drinkware" ? "Drinkware"
                                                            : family === "cookware" ? "Cookware"
                                                              : family === "cleaning-tool" ? "Cleaning tool"
                                                                : family === "home-decor" ? "Home decor"
                                                                  : family === "shoes" ? "Footwear"
                                                                    : family === "nfc-tag" ? "NFC tag"
                                                                      : family === "pet-bed" ? "Pet bed"
                                                                        : family === "pet-toy" ? "Pet toy"
                                                                          : family === "pet-accessory" ? "Pet accessory"
                                                                            : family === "medical-kit" ? "Medical kit"
                                                                              : family.startsWith("makeup-") || family === "face-paint" || family === "beauty-mask" ? "Beauty essential"
                                                                                : family.startsWith("apparel-") || family === "socks" || family === "baby-romper" ? "Everyday garment"
                                                                                  : family === "pajamas" ? "Sleepwear"
                                                                                    : family === "scarf" ? "Scarf"
                                                                                      : family === "hat" ? "Hat"
                                                                                        : family === "blanket" ? "Blanket"
                                                                                          : family === "bedding" ? "Bedding cover"
                                                                                            : family === "hair-care" ? "Hair-care product"
                                                                                              : family === "skin-care" ? "Skin-care product"
                                                                                                : family === "eyeshadow" ? "Eyeshadow palette"
                                                                                                  : family === "eyeliner" ? "Eye makeup"
                                                                                                    : family === "sticker" ? "Sticker set"
                                                                                                      : family === "keychain" ? "Keychain"
                                                                                                        : family === "game-controller" ? "Game controller"
                                                                                                          : family === "board-game" || family === "toy-tea-set" || family === "toy" ? "Play item"
                                                                                                            : family === "fan" ? "Portable fan"
                                                                                                              : family === "light" ? "Decorative light"
                                                                                                                : family === "radio" ? "Emergency radio"
                                                                                                                  : family === "flashlight" ? "Flashlight"
                                                                                                                    : family === "organizer" ? "Organizer"
                                                                                                                      : family === "wallet" ? "Wallet"
                                                                                                                        : family === "bag" ? "Bag"
                                                                                                                          : profile.classification.noun;
  const details = productEvidencePhrases(profile, facts);
  const detail = details[0] || "";
  let clause = "";
  if (/^features including /i.test(detail)) clause = " with " + detail.replace(/^features including /i, "") + " features";
  else if (/^use for /i.test(detail)) clause = " for " + detail.replace(/^use for /i, "").replace(/\s+use$/i, "");
  else if (/^compatibility with /i.test(detail)) clause = " for " + detail.replace(/^compatibility with /i, "") + " compatibility";
  else if (detail) clause = " with " + detail;
  const summary = normalizeText(base + clause).replace(/\s+/g, " ");
  return summary.length <= 88 ? summary + "." : base + ".";
}

function practicalCheck(profile) {
  const family = profile.classification.familyId;
  if (family === "video-adapter") return "Match the HDMI source, VGA display, and whether you need audio or USB power before ordering.";
  if (family === "audio-cable" || family === "hdmi-cable" || family === "charging-cable" || family === "camera-mount" || family === "camera-accessory") return "Match the connector, thread, device, and clearance to your setup before ordering.";
  if (family === "speaker" || family === "phone-case" || family === "phone-holder" || family === "tripod" || family === "selfie-stick" || family === "watch" || family === "smart-watch") return "Choose the device-compatible size, color, or configuration that fits your setup before checkout.";
  if (family === "computer-mouse" || family === "keyboard" || family === "smart-glasses" || family === "translator" || family === "charger" || family === "memory-card" || family === "microphone" || family === "nfc-tag") return "Match the connection type and supported device to your setup before checkout.";
  if (family === "mouse-pad" || family === "scarf" || family === "hat" || family === "bedding" || family === "blanket") return "Compare the dimensions, material, color, and care needs with how you plan to use it.";
  if (family.startsWith("apparel-") || family === "socks" || family === "baby-romper") return "Use the size chart and compare the selected color with the way you plan to wear it.";
  if (family.startsWith("makeup-") || family === "face-paint" || family === "beauty-mask" || family === "hair-care" || family === "skin-care") return "Choose the shade, size, and application format that suit your routine before checkout.";
  if (family.startsWith("pet-")) return "Choose the correct size and intended pet use, then follow the care or handling guidance supplied with the item.";
  if (family === "drinkware" || family === "cookware" || family === "shoes" || family === "home-decor") return "Compare the capacity, material, and care needs with the way you plan to use it.";
  if (family === "backpack" || family === "tent" || family === "camping-table" || family === "medical-kit") return "Compare the packed size, capacity, and intended setting with your plans before ordering.";
  return "Compare the dimensions, material, and configuration with your intended setup before checkout.";
}

function clipMetaSentence(value, maxLength) {
  const sentence = normalizeText(value);
  if (sentence.length <= maxLength) return sentence;
  if (maxLength < 12) return "";
  return sentence.slice(0, maxLength - 3).replace(/\s+\S*$/, "").replace(/[,:;—-]+$/, "").trim() + "...";
}

function fitMetaDescription(candidates, title) {
  const sentences = candidates.map((value) => normalizeText(value)).filter(Boolean);
  let result = sentences[0] || "Shop " + title + " at VS Store.";
  for (const sentence of sentences.slice(1)) {
    if (result.length >= 120) break;
    const next = result + " " + sentence;
    if (next.length <= 158) result = next;
  }
  if (result.length < 120) {
    const fallbacks = [
      "Match the fit and configuration to your setup before checkout.",
      "Confirm the selected format and compatibility before ordering.",
      "Check the dimensions and construction against your intended use before checkout.",
    ];
    for (const fallback of fallbacks) {
      const next = result + " " + fallback;
      if (next.length <= 158) {
        result = next;
        if (result.length >= 120) break;
      }
    }
  }
  return result.slice(0, 158).trim();
}

function customerFactLines(profile, facts) {
  const handle = profile.handleText;
  const lines = [];
  const features = extractFeatures(handle);
  const measurements = extractMeasurements(handle, facts);
  const material = extractMaterial(facts, handle);
  const compatibility = extractCompatibility(handle, facts);
  const connectors = extractConnector(handle, facts);
  const uses = USE_TERMS.filter(([term]) => new RegExp("\\b" + escapeRegExp(term) + "\\b", "i").test(handle))
    .map(([, value]) => value);

  if (compatibility) lines.push({ label: "Compatibility", value: compatibility });
  if (connectors.length) lines.push({ label: "Connection", value: naturalList(connectors) });
  if (measurements.length) {
    lines.push({
      label: profile.classification.familyId === "video-adapter" ? "Resolution and connector size" : "Size",
      value: naturalList(measurements),
    });
  }
  if (material) lines.push({ label: "Material", value: material });
  if (features.length) lines.push({ label: "Features", value: naturalList(features) });
  if (uses.length) lines.push({ label: "Best for", value: naturalList(uses.slice(0, 3)) });

  for (const fact of facts) {
    const label = normalizeText(fact.label);
    const value = normalizeText(fact.value);
    if (!value || HIDDEN_FACT_LABELS.has(label.toLowerCase())) continue;
    if (lines.some((line) => line.value.toLowerCase() === value.toLowerCase())) continue;
    if (["Product focus", "Available options"].includes(label)) continue;
    lines.push({ label, value: sentenceValue(value) });
  }
  return uniqueValues(lines.map((line) => `${line.label}\u0000${line.value}`))
    .map((entry) => {
      const splitAt = entry.indexOf("\u0000");
      return { label: entry.slice(0, splitAt), value: entry.slice(splitAt + 1) };
    })
    .slice(0, 6);
}

function productDetailSentence(profile, facts) {
  if (profile.classification.familyId === "video-adapter") {
    return "Choose the connector configuration that matches your display; selected versions add a 3.5 mm audio port and USB power lead.";
  }
  if (profile.classification.familyId === "pet-accessory" && /\boutfit\b|\bclothing\b/i.test(profile.handleText)) {
    return "Choose the style and size that suit your pet, then use it for supervised seasonal dress-up and photos.";
  }
  const factLines = customerFactLines(profile, facts);
  const details = factLines.map((line) => {
    const value = sentenceValue(line.value);
    if (!value) return "";
    if (line.label === "Compatibility") return value + " compatibility";
    if (line.label === "Connection") return value + " connectivity";
    if (line.label === "Size") return "available in " + value;
    if (line.label === "Material") return "a " + value + " build";
    if (line.label === "Features") return value + " features";
    if (line.label === "Best for") return "a fit for " + value;
    return value + " " + line.label.toLowerCase();
  }).filter(Boolean).slice(0, 4);
  if (!details.length) {
    const anchors = salientHandleWords(profile.handleText, profile.classification).slice(0, 3);
    return anchors.length
      ? "It brings together " + naturalList(anchors.map(sentenceValue)) + " details, so the product's purpose is clear before checkout."
      : "Its form and intended use are clear before checkout.";
  }
  return "In practice, it brings together " + naturalList(details) + ".";
}

function familySalesCopy(profile, title, facts) {
  // Start from the family-specific shopping explanation, then add only facts
  // recovered from this product. This keeps the copy readable without
  // inventing benefits or falling back to supplier boilerplate.
  const intro = familyIntro(profile, title);
  return naturalizeCustomerCopy([intro, productDetailSentence(profile, facts)].join(" "));
}

function customerMetaSummary(profile, title, facts) {
  const text = naturalizeCustomerCopy(familySalesCopy(profile, title, facts))
    .replace(/\s+/g, " ")
    .replace(/\.(?=\s|$)/g, ".")
    .trim();
  const sentences = text.match(/[^.!?]+[.!?]/g)?.map((part) => normalizeText(part)) || [text];
  return sentences.slice(0, 2).join(" ");
}

function specificMetaSentence(profile, title, facts) {
  const family = profile.classification.familyId;
  const handle = profile.handleText;
  const features = extractFeatures(handle).slice(0, 3).map(sentenceValue);
  const measurements = extractMeasurements(handle, facts).slice(0, 2).map(sentenceValue);
  const material = extractMaterial(facts, handle);
  const compatibility = extractCompatibility(handle, facts);
  const style = extractStyle(handle).filter((value) => !/casual/i.test(value)).slice(0, 2).map(sentenceValue);
  const uses = USE_TERMS.filter(([term]) => new RegExp("\\b" + escapeRegExp(term) + "\\b", "i").test(handle))
    .map(([, value]) => value).slice(0, 2);
  const focus = salientHandleWords(handle, profile.classification).slice(0, 3).map(sentenceValue);
  const featureFallbacks = {
    "phone-case": "a slim protective profile",
    "keychain": "a compact attachment format",
    "watch": "a clean timekeeping design",
    "smart-watch": "everyday smart functions",
    "speaker": "portable listening features",
    "audio-accessory": "everyday listening features",
    "organizer": "a practical storage format",
    "general-accessory": "a practical everyday design",
  };
  const featureText = features.length
    ? naturalList(features).toLowerCase()
    : featureFallbacks[family] || "a practical configuration";
  const sizeText = measurements.length ? naturalList(measurements).toLowerCase() : "the available size";
  const useText = uses.length ? naturalList(uses).toLowerCase() : "its intended setting";
  const focusText = focus.length ? naturalList(focus).toLowerCase() : "the product's configuration";

  if (family === "video-adapter") {
    const resolution = measurements.find((value) => /^(?:720p|1080p|1440p|4k)$/i.test(value));
    const resolutionText = resolution ? ` for ${resolution} video` : "";
    return `A compact HDMI-to-VGA adapter${resolutionText} with audio and USB power options.`;
  }
  if (family === "pet-accessory" && /\boutfit\b|\bclothing\b/i.test(handle)) {
    return "A soft fabric pet outfit for seasonal photos, with a fit to check before ordering.";
  }
  if (family === "pet-toy") {
    const target = /\b(?:dog|puppy)\b/i.test(handle) ? "dogs" : /\b(?:cat|kitten)\b/i.test(handle) ? "cats" : "pets";
    return `A chew-and-play toy for ${target}, with ${featureText} suited to supervised play.`;
  }
  if (family === "pet-bed") {
    const target = /\b(?:dog|puppy)\b/i.test(handle) ? "dogs" : /\b(?:cat|kitten)\b/i.test(handle) ? "cats" : "pets";
    return `A dedicated resting spot for ${target}, with ${sizeText} and ${material ? material.toLowerCase() + " construction" : "a comfortable form"}.`;
  }
  if (family === "keychain") {
    const activityWords = focus.filter((value) => !uses.some((use) => new RegExp(`\\b${escapeRegExp(use)}\\b`, "i").test(value)));
    const activity = activityWords.length ? naturalList(activityWords).toLowerCase() : "everyday carry";
    return `A ${activity} keychain for ${useText} bags and bottles.`;
  }
  if (family === "phone-case") return `Made for ${compatibility || "compatible phones"}, with ${material ? material.toLowerCase() + " construction and " : ""}${featureText.toLowerCase()}.`;
  if (family === "audio-cable" || family === "hdmi-cable" || family === "charging-cable") {
    return `A connector-specific cable for ${compatibility || "a compatible setup"}, with ${featureText.toLowerCase()} and a connection layout chosen for compatible devices.`;
  }
  if (family === "camera-mount" || family === "camera-accessory" || family === "tripod" || family === "selfie-stick") {
    return `A camera support piece for ${useText}, with ${featureText.toLowerCase()} and a mounting or connection format to match your equipment.`;
  }
  if (family === "organizer" || family === "cable-organizer" || family === "watch-organizer") {
    return `A storage solution centered on ${focusText}, sized and configured for the organization task named by the product.`;
  }
  if (family === "apparel-shirt" || family === "apparel-dress" || family === "apparel-top" || family === "apparel-bottom" || family.startsWith("apparel-")) {
    return `An easy-to-style garment with ${style.length ? naturalList(style).toLowerCase() : "a considered cut and fabric"}, made for ${useText}.`;
  }
  if (family.startsWith("makeup-") || family === "beauty-mask" || family === "face-paint" || family === "hair-care" || family === "skin-care") {
    return `A beauty essential with ${featureText.toLowerCase()} and an application format suited to ${useText}.`;
  }
  if (family === "drinkware" || family === "cookware") {
    return `A ${family === "drinkware" ? "drinkware piece" : "kitchen piece"} with ${material ? material.toLowerCase() + " construction and " : ""}${sizeText}, shaped for ${useText}.`;
  }
  if (family === "backpack" || family === "tent" || family === "camping-table" || family === "medical-kit") {
    return `Built for ${useText}, with ${sizeText} and ${featureText.toLowerCase()} to match the product's stated outdoor or travel format.`;
  }
  const noun = profile.classification.noun.toLowerCase();
  const details = uniqueValues([
    focus.length ? focusText : "",
    features.length ? featureText : "",
    material ? material.toLowerCase() + " construction" : "",
  ]);
  const detailText = details.length ? naturalList(details) : "a considered everyday design";
  const context = useText !== "its intended setting" ? ` for ${useText}` : "";
  return `${indefiniteArticle(noun)} ${noun} with ${detailText}${context}.`;
}

function buildCustomerMetaDescription(title, profile, facts, check) {
  const prefix = `Shop ${title} at VS Store.`;
  let result = prefix;
  const candidates = [
    naturalizeCustomerCopy(specificMetaSentence(profile, title, facts)),
    naturalizeCustomerCopy(customerMetaSummary(profile, title, facts)),
    check,
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (result.length >= 120) break;
    const remaining = 158 - result.length - 1;
    if (remaining < 18) break;
    const addition = clipMetaSentence(candidate, remaining);
    if (addition) result += " " + addition;
  }
  if (result.length < 120) {
    for (const filler of [
      `Match the ${profile.classification.noun} format to your intended setup before checkout.`,
      `Confirm the selected ${profile.classification.noun} option before ordering.`,
    ]) {
      const remaining = 158 - result.length - 1;
      if (remaining < 8) break;
      const addition = clipMetaSentence(filler, remaining);
      if (addition) result += " " + addition;
      if (result.length >= 120) break;
    }
  }
  return result.slice(0, 158).trim().replace(/[,:;—-]+$/, "").replace(/[.!?]?$/, ".");
}

function customerDetailsMarkup(facts) {
  if (!facts.length) return "";
  return "<ul>" + facts.map((fact) => `<li><strong>${escapeHtml(fact.label)}:</strong> ${escapeHtml(fact.value)}</li>`).join("") + "</ul>";
}

function evidenceTokens(product, title, facts) {
  const evidence = new Set(tokenise(sourceParts(product).evidenceText));
  const handleTokens = tokenise(product?.handle)
    .filter((token) => evidence.has(token) && token.length >= 3 && !STOP_WORDS.has(token));
  return uniqueValues(handleTokens.concat(tokenise(title).filter((token) => evidence.has(token)), facts.flatMap((entry) => tokenise(entry.value)))).slice(0, 40);
}

export function buildProductSeoCopy(product) {
  const facts = extractProductFacts(product);
  const classification = classifyProduct(product, facts);
  const audience = audienceFrom(product, classification);
  const profile = { product, facts, classification, audience, handleText: sourceParts(product).handle };
  const title = buildTitle(profile);
  const summarizedFacts = customerFactLines(profile, factEntries(profile));
  const intro = familySalesCopy(profile, title, summarizedFacts);
  const check = practicalCheck(profile);
  const detailSentence = customerMetaSummary(profile, title, summarizedFacts);
  const seoDescription = buildCustomerMetaDescription(title, profile, summarizedFacts, check);
  const factMarkup = customerDetailsMarkup(summarizedFacts);
  const descriptionHtml = [
    "<h2>About " + escapeHtml(title) + "</h2>",
    "<p>" + escapeHtml(intro) + "</p>",
    factMarkup
      ? "<h3>At a glance</h3>" + factMarkup
      : "<h3>At a glance</h3><p><strong>Product type:</strong> " + escapeHtml(classification.noun) + "</p>",
    "<h3>Before you order</h3>",
    "<p>" + escapeHtml(check) + "</p>",
    "<h3>FAQs</h3>",
    "<p><strong>Q: What should I check before ordering?</strong></p>",
    "<p>A: " + escapeHtml(check) + "</p>",
  ].filter(Boolean).join("\n");
  return {
    title: shortenTitle(title), seoTitle: shortenTitle(title), seoDescription, descriptionHtml,
    noun: classification.noun, classification, audience, facts: summarizedFacts,
    evidenceTokens: evidenceTokens(product, title, summarizedFacts),
  };
}

export function buildProductSeoRecord(product, prior = null) {
  const copy = buildProductSeoCopy(product);
  const productId = product?.legacyResourceId ?? product?.id ?? prior?.productId ?? "";
  const handle = normalizeText(product?.handle || prior?.handle || "");
  const sourceTitle = normalizeText(product?.title || prior?.sourceTitle || "");
  return {
    id: productId,
    productId: productId ? "gid://shopify/Product/" + (String(productId).match(/\d+$/)?.[0] || productId) : "",
    handle, sourceTitle, title: copy.title, seoTitle: copy.seoTitle, seoDescription: copy.seoDescription,
    descriptionHtml: copy.descriptionHtml, productType: copy.noun,
    classification: {
      familyId: copy.classification.familyId, confidence: copy.classification.confidence,
      audience: copy.audience, source: "handle-title-and-verified-listing-facts",
    },
    evidence: {
      factCount: copy.facts.length, facts: copy.facts, tokens: copy.evidenceTokens,
      source: "verified-catalog-title-handle-description-and-listing-facts",
    },
  };
}

function uniqueMarker(record, attempt = 1) {
  const titleTokens = new Set(tokenise(record.title));
  const candidate = (record.evidence?.tokens || [])
    .map((value) => normalizeText(value))
    .filter((value) => value.length >= 3 && !STOP_WORDS.has(value.toLowerCase()))
    .filter((value) => !/^(?:male|female|men|mens|man|women|womens|woman|boy|boys|girl|girls)$/i.test(value))
    .find((value) => !titleTokens.has(value.toLowerCase()));
  if (candidate) return titleCasePhrase(candidate) + (attempt > 1 ? " " + attempt : "");
  return "Style " + Math.max(1, attempt);
}

function requiredTitleAlias(record, text) {
  const aliases = NOUN_ALIASES[record.classification?.familyId] || [];
  const fallbackAliases = record.classification?.familyId === "general-accessory" ? tokenise(record.productType || "") : [];
  return [...aliases, ...fallbackAliases].find((alias) => new RegExp("\\b" + escapeRegExp(alias) + "\\b", "i").test(text)) || "";
}

function titleWithUniqueMarker(record, baseTitle, attempt = 1) {
  const marker = uniqueMarker(record, attempt);
  const suffix = " - " + marker;
  const maxBaseLength = 70 - suffix.length;
  const requiredAlias = requiredTitleAlias(record, baseTitle);
  let base = shortenTitle(baseTitle, maxBaseLength);
  if (requiredAlias && !requiredTitleAlias(record, base)) {
    const withoutAlias = baseTitle.replace(new RegExp("\\b" + escapeRegExp(requiredAlias) + "\\b", "i"), "").trim();
    const lead = shortenTitle(withoutAlias, Math.max(8, maxBaseLength - requiredAlias.length - 1));
    base = (lead + " " + requiredAlias).trim();
  }
  base = shortenTitle(base, maxBaseLength);
  return (base + suffix).trim();
}

function descriptionWithUniqueMarker(record, baseDescription, attempt = 1) {
  const suffix = " (" + uniqueMarker(record, attempt) + ")";
  const maxBaseLength = 158 - suffix.length;
  let base = normalizeText(baseDescription);
  if (base.length > maxBaseLength) {
    base = base.slice(0, Math.max(0, maxBaseLength - 3))
      .replace(/\s+\S*$/, "")
      .replace(/[,:;—-]+$/, "")
      .trim() + "...";
  }
  return (base + suffix).slice(0, 158).trim();
}

function contentKey(value) {
  return stripHtml(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function syncDescriptionTitle(record) {
  const descriptionHtml = String(record.descriptionHtml || "");
  const heading = descriptionHtml.match(/<h2>\s*About\s+([\s\S]*?)<\/h2>/i);
  if (!heading?.[1]) return;
  const oldTitle = heading[1].trim();
  const newTitle = escapeHtml(record.title);
  if (!oldTitle || oldTitle === newTitle) return;
  record.descriptionHtml = descriptionHtml.replaceAll(oldTitle, newTitle);
}

function retitleRecord(record, title) {
  const oldTitle = record.title;
  record.title = title;
  record.seoTitle = title;
  const updatedDescription = record.seoDescription.replaceAll(oldTitle, title);
  const prefix = `Shop ${title} at VS Store.`;
  const body = updatedDescription.replace(/^Shop\s+.*?\s+at VS Store\.\s*/i, "").trim();
  const remaining = Math.max(0, 158 - prefix.length - 1);
  const clippedBody = body ? clipMetaSentence(body, remaining) : "";
  record.seoDescription = clippedBody ? `${prefix} ${clippedBody}` : prefix;
  if (record.seoDescription.length < 120) {
    for (const filler of [
      `Match the ${record.productType || record.classification?.noun || "product"} format to your setup before checkout.`,
      `Confirm the selected ${record.productType || record.classification?.noun || "product"} configuration before ordering.`,
    ]) {
      const remaining = 158 - record.seoDescription.length - 1;
      if (remaining < 8) break;
      const words = filler.split(/\s+/);
      let addition = "";
      for (const word of words) {
        const candidate = `${addition} ${word}`.trim();
        if (candidate.length > remaining) break;
        addition = candidate;
      }
      if (addition) record.seoDescription += ` ${addition}`;
      if (record.seoDescription.length >= 120) break;
    }
    record.seoDescription = record.seoDescription.replace(/[.!?]?$/, ".");
  }
  record.descriptionHtml = record.descriptionHtml.replaceAll(oldTitle, title);
  syncDescriptionTitle(record);
}

export function ensureDistinctProductSeo(records) {
  const usedTitles = new Set();
  const usedDescriptions = new Set();
  const usedDescriptionHtml = new Set();
  for (const record of [...records].sort((left, right) =>
    (left.handle + ":" + (left.id || left.productId)).localeCompare(right.handle + ":" + (right.id || right.productId)),
  )) {
    let title = record.title;
    let guard = 1;
    while (usedTitles.has(title.toLowerCase()) && guard < 100) {
      title = titleWithUniqueMarker(record, record.title, guard);
      guard += 1;
    }
    if (usedTitles.has(title.toLowerCase())) {
      title = titleWithUniqueMarker(record, "Product " + guard, guard);
    }
    if (title !== record.title) retitleRecord(record, title);
    // The description template is built before title collision resolution.
    // Keep every live HTML description anchored to the final product title so
    // sibling listings cannot retain an identical base-title body.
    syncDescriptionTitle(record);
    if (usedDescriptions.has(record.seoDescription.toLowerCase())) {
      let descriptionAttempt = 1;
      let candidate = descriptionWithUniqueMarker(record, record.seoDescription, descriptionAttempt);
      while (usedDescriptions.has(candidate.toLowerCase()) && descriptionAttempt < 100) {
        descriptionAttempt += 1;
        candidate = descriptionWithUniqueMarker(record, record.seoDescription, descriptionAttempt);
      }
      record.seoDescription = candidate;
    }
    let descriptionHtmlKey = contentKey(record.descriptionHtml);
    if (descriptionHtmlKey && usedDescriptionHtml.has(descriptionHtmlKey)) {
      let htmlAttempt = 1;
      let candidate = `${record.descriptionHtml}\n<p>Selected edition: ${escapeHtml(uniqueMarker(record, htmlAttempt))}.</p>`;
      while (usedDescriptionHtml.has(contentKey(candidate)) && htmlAttempt < 100) {
        htmlAttempt += 1;
        candidate = `${record.descriptionHtml}\n<p>Selected edition: ${escapeHtml(uniqueMarker(record, htmlAttempt))}.</p>`;
      }
      record.descriptionHtml = candidate;
      descriptionHtmlKey = contentKey(candidate);
    }
    usedTitles.add(record.title.toLowerCase());
    usedDescriptions.add(record.seoDescription.toLowerCase());
    if (descriptionHtmlKey) usedDescriptionHtml.add(descriptionHtmlKey);
  }
  return records;
}

function requiredNounPresent(record, text) {
  const aliases = NOUN_ALIASES[record.classification?.familyId] || [];
  const fallbackAliases = record.classification?.familyId === "general-accessory" ? tokenise(record.productType || "") : [];
  return [...aliases, ...fallbackAliases].some((alias) => new RegExp("\\b" + escapeRegExp(alias) + "\\b", "i").test(text));
}

function nonApparelGenderLeak(record, text) {
  if (AUDIENCE_FAMILIES.has(record.classification?.familyId)) return false;
  const withoutConnectorLabels = String(text || "").replace(
    /\b(?:female|male)(?:-to-(?:female|male)|\s+(?:thread|connector|plug|port|end|fitting)s?)\b/gi,
    "",
  ).replace(/\b(?:\d+(?:[./-]\d+)?\s*)+(?:female|male)\b/gi, "");
  return /\b(?:women|womens|woman|men|mens|man|female|male|girls|girl|boys|boy)\b/i.test(withoutConnectorLabels);
}

export function auditProductSeoRecords(records) {
  const titles = new Map();
  const descriptions = new Map();
  const descriptionHtml = new Map();
  const issues = [];
  for (const record of records) {
    const titleKey = record.title.toLowerCase();
    const descriptionKey = record.seoDescription.toLowerCase();
    const descriptionHtmlKey = contentKey(record.descriptionHtml);
    titles.set(titleKey, (titles.get(titleKey) || 0) + 1);
    descriptions.set(descriptionKey, (descriptions.get(descriptionKey) || 0) + 1);
    if (descriptionHtmlKey) descriptionHtml.set(descriptionHtmlKey, (descriptionHtml.get(descriptionHtmlKey) || 0) + 1);
    const allCopy = record.title + "\n" + record.seoDescription + "\n" + stripHtml(record.descriptionHtml);
    if (record.title.length < 20 || record.title.length > 70) issues.push(record.handle + ":title-length");
    if (record.seoDescription.length < 120 || record.seoDescription.length > 160) issues.push(record.handle + ":seo-description-length");
    if (GENERIC_TITLE_RE.test(record.title) || RAW_COPY_RE.test(allCopy)) issues.push(record.handle + ":generic-or-raw-copy");
    if (!requiredNounPresent(record, record.title)) issues.push(record.handle + ":title-category-mismatch");
    if (!requiredNounPresent(record, record.seoDescription + " " + record.descriptionHtml)) issues.push(record.handle + ":description-category-mismatch");
    if (nonApparelGenderLeak(record, allCopy)) issues.push(record.handle + ":non-apparel-gender-leak");
    if (!record.evidence?.tokens?.length) issues.push(record.handle + ":no-evidence");
  }
  return {
    total: records.length,
    duplicateTitles: [...titles.values()].filter((count) => count > 1).length,
    duplicateDescriptions: [...descriptions.values()].filter((count) => count > 1).length,
    duplicateDescriptionHtml: [...descriptionHtml.values()].filter((count) => count > 1).length,
    issues,
  };
}
