export const PRODUCT_CONTENT_SPECIFICITY_VERSION = "2026-08-05.1";

const GENERIC_TOKENS = new Set([
  "a", "an", "and", "are", "as", "at", "available", "best", "buy", "by", "choice", "compare",
  "daily", "deal", "details", "everyday", "essential", "essentials", "featured", "find", "for", "from",
  "gift", "gifts", "high", "in", "item", "latest", "lifestyle", "new", "of", "on", "online", "option",
  "options", "or", "order", "our", "pick", "popular", "premium", "product", "products", "quality", "salt",
  "sale", "shop", "shopping", "specific", "style", "stylish", "the", "this", "to", "top", "trending",
  "use", "with", "your",
]);

const GENERIC_FILLER_PATTERNS = [
  /\b(?:high|premium|great|best) quality product\b/i,
  /\beveryday (?:product|item|essential)\b/i,
  /\blifestyle ready\b/i,
  /\b(?:shop|order|buy) (?:now|online)\b/i,
  /\bcompare available options\b/i,
  /\bpractical (?:product|item)\b/i,
  /\bperfect (?:choice|gift)\b/i,
  /\bmust[- ]?have\b/i,
  /^product details$/i,
  /^featured product$/i,
];

function decodeEntities(value) {
  return String(value || "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;|&#38;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;|&#60;/gi, "<")
    .replace(/&gt;|&#62;/gi, ">");
}

export function normalizeSpecificityText(value) {
  const flattened = Array.isArray(value) ? value.join(" | ") : value;
  return decodeEntities(flattened)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeSpecificityText(value, { includeGeneric = false } = {}) {
  return normalizeSpecificityText(value)
    .split(" ")
    .filter(Boolean)
    .filter((token) => token.length >= 2 || /\d/.test(token))
    .filter((token) => includeGeneric || !GENERIC_TOKENS.has(token));
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags;
  return String(tags || "").split(/[,;|\n]+/g);
}

function buildPhrases(tokens) {
  const phrases = [];
  for (let size = 4; size >= 2; size -= 1) {
    for (let index = 0; index <= tokens.length - size; index += 1) {
      const phrase = tokens.slice(index, index + size);
      if (phrase.every((token) => GENERIC_TOKENS.has(token))) continue;
      phrases.push(phrase.join(" "));
    }
  }
  return phrases;
}

export function buildProductSpecificityEvidence(product = {}, extraValues = []) {
  const handle = String(product?.handle || "").replace(/[-_]+/g, " ");
  const title = product?.title || product?.name || "";
  const productType = product?.product_type || product?.productType || product?.specificType || "";
  const category =
    product?.shopifyCategory?.fullName ||
    product?.shopifyCategory?.name ||
    product?.category?.fullName ||
    product?.category?.name ||
    "";
  const tags = normalizeTags(product?.tags)
    .filter((tag) => !/^salt:/i.test(String(tag || "")))
    .join(" ");
  const primaryValues = [handle, title, productType, category, ...extraValues];
  const primaryTokens = uniqueValues(primaryValues.flatMap((value) => tokenizeSpecificityText(value)));
  const supportingTokens = uniqueValues([
    ...primaryTokens,
    ...tokenizeSpecificityText(tags),
    ...tokenizeSpecificityText(product?.vendor || ""),
  ]);
  const phraseTokens = uniqueValues([
    ...tokenizeSpecificityText(handle, { includeGeneric: true }),
    ...tokenizeSpecificityText(title, { includeGeneric: true }),
  ]).filter((token) => !/^\d+$/.test(token));
  const identityTokens = uniqueValues([
    ...tokenizeSpecificityText(handle),
    ...tokenizeSpecificityText(title),
  ]);

  return {
    primaryTokens,
    supportingTokens,
    phrases: uniqueValues(buildPhrases(phraseTokens)).sort((left, right) => right.length - left.length),
    identityTokenCount: identityTokens.length,
  };
}

export function assessProductContentSpecificity(
  value,
  product,
  { field = "content", minimumEvidenceMatches = 2, extraEvidence = [], rejectGenericPatterns = false } = {},
) {
  const normalized = normalizeSpecificityText(value);
  const valueTokens = uniqueValues(tokenizeSpecificityText(value));
  const evidence = buildProductSpecificityEvidence(product, extraEvidence);
  const matchedPrimaryTokens = evidence.primaryTokens.filter((token) => valueTokens.includes(token));
  const matchedSupportingTokens = evidence.supportingTokens.filter((token) => valueTokens.includes(token));
  const matchedPhrase = evidence.phrases.find((phrase) => normalized.includes(phrase)) || "";
  const requiredMatches = evidence.primaryTokens.length
    ? evidence.identityTokenCount <= 2
      ? 1
      : Math.min(Math.max(1, minimumEvidenceMatches), evidence.primaryTokens.length)
    : Number.POSITIVE_INFINITY;
  const genericPatterns = GENERIC_FILLER_PATTERNS
    .filter((pattern) => pattern.test(decodeEntities(value)))
    .map((pattern) => pattern.source);
  const issues = [];

  if (!normalized) issues.push("missing-content");
  if (!evidence.primaryTokens.length) issues.push("missing-product-evidence");
  if (
    normalized &&
    !matchedPhrase &&
    matchedPrimaryTokens.length < requiredMatches &&
    matchedSupportingTokens.length < requiredMatches
  ) {
    issues.push("insufficient-product-evidence");
  }
  if (valueTokens.length === 0 && normalized) issues.push("generic-filler-only");
  if (rejectGenericPatterns && genericPatterns.length) issues.push("generic-filler-pattern");

  return {
    field,
    specific: issues.length === 0,
    normalized,
    fingerprint: buildContentFingerprint(value),
    requiredMatches,
    matchedPhrase,
    matchedPrimaryTokens,
    matchedSupportingTokens,
    genericPatterns,
    issues,
  };
}

export function buildContentFingerprint(value) {
  return normalizeSpecificityText(value);
}

export function findCatalogContentCollisions(
  products,
  fields,
  { minimumFingerprintLength = 12 } = {},
) {
  const collisions = [];

  for (const field of fields) {
    const groups = new Map();
    for (const product of products || []) {
      const value = field.getValue(product);
      const fingerprint = buildContentFingerprint(value);
      if (fingerprint.length < minimumFingerprintLength) continue;
      if (!groups.has(fingerprint)) groups.set(fingerprint, []);
      groups.get(fingerprint).push({
        id: product?.id || product?.legacyResourceId || null,
        handle: product?.handle || "",
        title: product?.title || "",
      });
    }

    for (const [fingerprint, members] of groups.entries()) {
      if (members.length < 2) continue;
      collisions.push({ field: field.id, fingerprint, members });
    }
  }

  return collisions;
}

export function hasCatalogContentCollision(collisionIndex, field, value) {
  const fingerprint = buildContentFingerprint(value);
  return Boolean(collisionIndex?.get(field)?.has(fingerprint));
}

export function buildCatalogContentCollisionIndex(products, fields, options) {
  const index = new Map();
  for (const collision of findCatalogContentCollisions(products, fields, options)) {
    if (!index.has(collision.field)) index.set(collision.field, new Set());
    index.get(collision.field).add(collision.fingerprint);
  }
  return index;
}
