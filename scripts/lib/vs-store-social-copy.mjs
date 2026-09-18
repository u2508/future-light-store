const MARKETING_TAGS = new Set([
  "best-sellers",
  "new-arrivals",
  "trending-finds",
  "offers",
  "sale",
  "featured",
  "popular",
  "catalog",
  "electronic-accessories",
  "computer-accessories",
]);

const GENDER_WORDS = /\b(men|mens|men's|women|womens|women's|male|female)\b/i;
const APPAREL_OR_JEWELRY_WORDS =
  /\b(apparel|clothing|shirt|t-shirt|dress|skirt|pants|jeans|shoe|shoes|sandal|handbag|jewelry|jewellery|brooch|earring|necklace|bracelet|ring|fashion)\b/i;
const FUNCTIONAL_TAGS = new Map([
  ["waterproof", "waterproof construction"],
  ["wireless", "wireless use"],
  ["bluetooth", "Bluetooth connectivity"],
  ["rechargeable", "rechargeable power"],
  ["portable", "portable design"],
  ["foldable", "a foldable design"],
  ["adjustable", "adjustable positioning"],
  ["stainless-steel", "stainless-steel construction"],
  ["usb", "USB connectivity"],
  ["microphone", "a built-in microphone"],
  ["led", "LED lighting"],
  ["magnetic", "magnetic attachment"],
  ["shockproof", "shock-resistant protection"],
]);
const USE_WORDS = [
  "camping",
  "travel",
  "fitness",
  "running",
  "outdoor",
  "office",
  "home",
  "kitchen",
  "bathroom",
  "car",
  "desk",
  "gaming",
  "beach",
  "photography",
  "workout",
  "school",
];
const MATERIAL_WORDS = [
  "plastic",
  "metal",
  "aluminum",
  "aluminium",
  "stainless steel",
  "silicone",
  "leather",
  "linen",
  "cotton",
  "wood",
  "glass",
  "acrylic",
  "ceramic",
  "nylon",
  "polyester",
  "alloy",
];
const MEASUREMENT_PATTERN = /\b\d+(?:\.\d+)?\s?(?:mm|cm|m|ml|l|kg|g|oz|inch|in|ft|mah|gb|tb)\b/gi;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsToken(source, token) {
  const normalizedToken = normalizeText(token).toLowerCase();
  if (!normalizedToken) return false;
  return new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(normalizedToken)}(?:$|[^a-z0-9])`, "i").test(
    source,
  );
}

function decodeHtml(value) {
  return normalizeText(value)
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripHtml(value) {
  return decodeHtml(String(value || "").replace(/<[^>]+>/g, " "));
}

function dedupeWords(value) {
  const words = normalizeText(value).split(" ");
  const output = [];
  for (const word of words) {
    if (output.length && output[output.length - 1].toLowerCase() === word.toLowerCase()) continue;
    output.push(word);
  }
  return output.join(" ");
}

function removeUnsupportedGenderWords(value) {
  return normalizeText(value)
    .replace(/\b(?:men|mens|men's|women|womens|women's|female)\b/gi, "")
    .replace(/\s+([,.:;])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function humanizeTitle(value) {
  let title = normalizeText(value)
    .replace(/[|_]+/g, " ")
    .replace(/\b(\d+)\s+(\d+)\s*(mm|cm|ml|mah|gb|tb|oz|inch|in)\b/gi, "$1.$2 $3")
    .replace(/\b(\d+(?:\.\d+)?)(mm|cm|ml|mah|gb|tb|oz|inch|in)\b/gi, "$1 $2")
    .replace(/\bxh2\s*\.?\s*54\s*3p\b/gi, "XH2.54 3-pin")
    .replace(/\baux\b/gi, "AUX")
    .replace(/\bbluetooth\b/gi, "Bluetooth")
    .replace(/\bhdmi[- ]compatible\b/gi, "HDMI-compatible")
    .replace(/\bmale\s+to\s+male\b/gi, "male-to-male")
    .replace(/\bmen\s+s\b/gi, "men's")
    .replace(/\bwomen\s+s\b/gi, "women's");
  return dedupeWords(title);
}

function isApparelOrJewelry(product) {
  const source = [
    product?.title,
    product?.productType,
    product?.product_type,
    ...asArray(product?.tags),
  ].join(" ");
  return APPAREL_OR_JEWELRY_WORDS.test(source);
}

function inferProductType(product) {
  const explicit = normalizeText(product?.productType || product?.product_type);
  if (explicit) return humanizeTitle(explicit).toLowerCase();
  const title = humanizeTitle(product?.title).toLowerCase();
  const rules = [
    [/\b(aux|audio cable|headphone|earbud|speaker|microphone|hdmi)\b/, "audio accessory"],
    [/\b(tripod|monopod)\b/, "tripod stand"],
    [/\b(camera|lens|photography)\b/, "camera accessory"],
    [/\b(backpack|rucksack|bag)\b/, "bag"],
    [/\b(thermos|tumbler|bottle|cup|mug)\b/, "drinkware"],
    [/\b(watch|smartwatch)\b/, "watch"],
    [/\b(phone case|phone holder|mobile holder)\b/, "phone accessory"],
    [/\b(lamp|light|led)\b/, "light"],
    [/\b(toy|puzzle|game)\b/, "toy"],
    [/\b(shirt|dress|jacket|pants|shoe|sandal)\b/, "fashion item"],
  ];
  return rules.find(([pattern]) => pattern.test(title))?.[1] || "everyday accessory";
}

function sourceWords(product) {
  return [
    product?.title,
    product?.productType,
    product?.product_type,
    ...asArray(product?.tags),
    stripHtml(product?.descriptionHtml || product?.body_html),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function extractProductFacts(product) {
  const source = sourceWords(product);
  const apparel = isApparelOrJewelry(product);
  const tags = asArray(product?.tags)
    .map((tag) => normalizeText(tag).toLowerCase())
    .filter(Boolean);
  const features = [];
  for (const [tag, phrase] of FUNCTIONAL_TAGS) {
    if (tags.includes(tag) || containsToken(source, tag)) features.push(phrase);
  }
  const materials = MATERIAL_WORDS.filter((material) => containsToken(source, material));
  const measurements = [
    ...new Set(
      (source.match(MEASUREMENT_PATTERN) || []).map((item) =>
        item.replace(/(\d)(mm|cm|ml|mah|gb|tb|oz|inch|in)\b/i, "$1 $2"),
      ),
    ),
  ];
  const uses = USE_WORDS.filter((word) => containsToken(source, word));
  const gender = apparel ? source.match(GENDER_WORDS)?.[1] || "" : "";
  const variants = asArray(product?.variants?.nodes)
    .map((variant) => normalizeText(variant?.title))
    .filter((title) => title && title.toLowerCase() !== "default title")
    .slice(0, 3);

  return {
    title: apparel
      ? humanizeTitle(product?.title)
      : removeUnsupportedGenderWords(humanizeTitle(product?.title)),
    type: inferProductType(product),
    brand:
      normalizeText(product?.vendor || product?.brand) &&
      !/^vs store$/i.test(normalizeText(product?.vendor || product?.brand))
        ? humanizeTitle(product?.vendor || product?.brand)
        : "",
    features: [...new Set(features)].slice(0, 4),
    materials: [...new Set(materials)].slice(0, 2),
    measurements: measurements.slice(0, 3),
    uses: uses.slice(0, 2),
    gender: gender ? gender.toLowerCase() : "",
    variants,
    apparel,
  };
}

function productLink(config, handle) {
  return `${config.siteUrl}/products/${encodeURIComponent(String(handle || "").trim())}?utm_source=facebook&utm_medium=organic_social&utm_campaign=vs_store_daily_social&utm_content=product`;
}

function collectionLink(config, handle) {
  return `${config.siteUrl}/collections/${encodeURIComponent(String(handle || "").trim())}?utm_source=facebook&utm_medium=organic_social&utm_campaign=vs_store_daily_social&utm_content=collection`;
}

function joinNatural(items) {
  const values = items.filter(Boolean);
  if (values.length <= 1) return values[0] || "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

export function buildProductCaption(product, config, { offer = null } = {}) {
  const facts = extractProductFacts(product);
  const details = [];
  if (facts.features.length) details.push(joinNatural(facts.features));
  if (facts.materials.length) details.push(`a ${joinNatural(facts.materials)} finish`);
  if (facts.measurements.length)
    details.push(`a listed size of ${joinNatural(facts.measurements)}`);
  if (facts.variants.length)
    details.push(`${facts.variants.length} listed option${facts.variants.length === 1 ? "" : "s"}`);
  const detailSentence = details.length
    ? `The listing calls out ${joinNatural(details)}.`
    : `The product page has the available options and specifications so you can compare the details before ordering.`;
  const useSentence = facts.uses.length
    ? ` It is a natural fit for ${joinNatural(facts.uses)} setups.`
    : "";
  const brandSentence = facts.brand ? ` from ${facts.brand}` : "";
  const offerSentence = offer?.code
    ? ` Use code ${offer.code} for ${offer.percent}% off this featured item while the offer is active.`
    : "";
  const caption = [
    `Today’s VS Store spotlight: ${facts.title}.`,
    `This ${facts.type}${brandSentence} is worth a closer look.${useSentence} ${detailSentence}${offerSentence}`,
    `See the photos and available choices here: ${productLink(config, product?.handle)}`,
  ].join("\n\n");
  return validatePostCopy(caption, { product, facts });
}

export function buildCollectionCaption(collection, config, { offer = null } = {}) {
  const title = humanizeTitle(collection?.title || collection?.handle || "VS Store collection");
  const featured = asArray(collection?.products?.nodes)
    .map((product) => humanizeTitle(product?.title))
    .filter(Boolean)
    .slice(0, 2);
  const featuredSentence = featured.length
    ? `You’ll find pieces such as ${joinNatural(featured)} in the mix.`
    : "Browse the collection to see the current selection and available options.";
  const offerSentence = offer?.code
    ? ` Use code ${offer.code} for ${offer.percent}% off eligible items in this collection while the offer is active.`
    : "";
  const caption = [
    `A fresh look at the ${title} collection from VS Store.`,
    `${featuredSentence}${offerSentence}`,
    `Explore it here: ${collectionLink(config, collection?.handle)}`,
  ].join("\n\n");
  return validatePostCopy(caption, { collection });
}

export function buildWelcomeCaption(config, { offer = null } = {}) {
  const offerSentence = offer?.code
    ? ` As a thank-you to the VS Store family, use code ${offer.code} for ${offer.percent}% off storewide while the weekend sale is active.`
    : "";
  return validatePostCopy(
    [
      "A heartfelt thank-you to the VS Store family ✨",
      `We’re glad you’re here. Take a little time to explore useful finds, thoughtful details, and new ideas for everyday moments.${offerSentence}`,
      `Visit the store: ${config.siteUrl}/?utm_source=facebook&utm_medium=organic_social&utm_campaign=vs_store_daily_social&utm_content=welcome-banner`,
    ].join("\n\n"),
    {},
  );
}

export function buildPromotionCaption(config) {
  return validatePostCopy(
    [
      "A little something special is coming to VS Store this Friday ✨",
      "Keep an eye on the weekly sale and discover useful finds, thoughtful details, and fresh ideas for everyday moments.",
      `See the latest offers: ${config.siteUrl}/offers?utm_source=facebook&utm_medium=organic_social&utm_campaign=vs_store_daily_social&utm_content=friday-sale-teaser`,
    ].join("\n\n"),
    {},
  );
}

export function validatePostCopy(caption, { product = null, facts = null } = {}) {
  const value = decodeHtml(caption);
  if (!value || value.length < 80) throw new Error("Social caption is too short to be useful.");
  if (
    /\b(brand name|catalog tag|source specifications|high concerned chemical|use & care|key details|q:|a:)\s*:/i.test(
      value,
    )
  ) {
    throw new Error("Social caption contains raw catalog labels instead of natural copy.");
  }
  if (/&(?:amp|nbsp|quot|apos|lt|gt);/i.test(value)) {
    throw new Error("Social caption contains an undecoded HTML entity.");
  }
  if (
    product &&
    facts &&
    !facts.apparel &&
    /\b(women|womens|women's|female|men|mens|men's)\b/i.test(value)
  ) {
    throw new Error(`Social caption has an unsupported gender claim for ${facts.title}.`);
  }
  const paragraphs = value
    .split(/\n\s*\n/)
    .map(normalizeText)
    .filter(Boolean);
  const normalizedParagraphs = paragraphs.map((paragraph) => paragraph.toLowerCase());
  if (new Set(normalizedParagraphs).size !== normalizedParagraphs.length) {
    throw new Error("Social caption repeats an identical paragraph.");
  }
  return value;
}

export function contentImageUrl(content) {
  if (content?.kind === "product")
    return (
      content.product?.featuredImage?.url ||
      content.product?.image?.src ||
      content.product?.images?.nodes?.[0]?.url ||
      content.product?.images?.[0]?.src ||
      ""
    );
  if (content?.kind === "collection")
    return (
      content.collection?.image?.url ||
      content.collection?.image?.src ||
      content.collection?.products?.nodes?.[0]?.featuredImage?.url ||
      content.collection?.products?.nodes?.[0]?.images?.nodes?.[0]?.url ||
      content.collection?.products?.nodes?.[0]?.images?.[0]?.src ||
      ""
    );
  return "";
}
