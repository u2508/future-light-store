const CATEGORY_METAFIELD_NAMESPACE = "shopify";

function normalizeCategoryText(value) {
  return String(value || "")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(value) {
  return normalizeCategoryText(value).replace(/[^a-z0-9]+/g, "");
}

function tokenize(value) {
  return normalizeCategoryText(value).split(" ").filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function supplierSpecificationAttributes(product) {
  const raw = product?.customData?.metafields?.["salt-product.specifications"];
  const candidate = raw?.jsonValue ?? raw?.value;
  let specification = candidate;
  if (typeof specification === "string") {
    try {
      specification = JSON.parse(specification);
    } catch {
      return {};
    }
  }
  if (!specification || typeof specification !== "object" ||
      specification.source !== "supplier_description_and_catalog_fields") {
    return {};
  }
  const attributes = specification.source_attributes;
  return attributes && typeof attributes === "object" && !Array.isArray(attributes) ? attributes : {};
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsEvidence(text, term, { allowVariantSuffix = false } = {}) {
  const sourceTokens = tokenize(text);
  const termTokens = tokenize(term);
  if (!sourceTokens.length || !termTokens.length || termTokens.length > sourceTokens.length) return false;

  for (let offset = 0; offset <= sourceTokens.length - termTokens.length; offset += 1) {
    const matches = termTokens.every((termToken, index) => {
      const sourceToken = sourceTokens[offset + index];
      if (sourceToken === termToken) return true;
      if (!allowVariantSuffix || termTokens.length !== 1) return false;
      return new RegExp(`^${escapeRegExp(termToken)}(?:\\d{2,}|[a-z]+\\d+)$`).test(sourceToken);
    });
    if (matches) return true;
  }
  return false;
}

function sourceEvidence(product) {
  // This is the one approved structured supplement to the live listing text:
  // attributes explicitly extracted from supplier description/catalog data.
  // Generated SEO, taxonomy, tags, and prior category values remain excluded
  // so a bad value cannot reinforce itself on the next repair.
  const supplierAttributes = supplierSpecificationAttributes(product);
  const supplierAttributeText = Object.entries(supplierAttributes)
    .flatMap(([key, value]) => [key, value])
    .filter((value) => value != null && value !== "")
    .join(" ");
  const productText = normalizeCategoryText([
    product?.handle,
    product?.title,
    product?.product_type || product?.productType,
    product?.body_html || product?.bodyHtml || product?.descriptionHtml,
    supplierAttributeText,
  ].filter(Boolean).join(" "));
  const optionText = normalizeCategoryText((Array.isArray(product?.options) ? product.options : [])
    .flatMap((option) => [option?.name, ...(Array.isArray(option?.values) ? option.values : [])])
    .filter(Boolean)
    .join(" "));
  const variantText = normalizeCategoryText((Array.isArray(product?.variants) ? product.variants : [])
    .flatMap((variant) => [
      variant?.title,
      variant?.option1,
      variant?.option2,
      variant?.option3,
      ...(Array.isArray(variant?.selectedOptions)
        ? variant.selectedOptions.flatMap((option) => [option?.name, option?.value])
        : []),
    ])
    .filter(Boolean)
    .join(" "));

  return {
    productText,
    variantText: normalizeCategoryText(`${optionText} ${variantText}`),
    allText: normalizeCategoryText(`${productText} ${optionText} ${variantText}`),
  };
}

function audienceEvidenceText(product) {
  // Connector/terminal gender is not shopper gender. Remove the common
  // technical forms before matching Target gender.
  return sourceEvidence(product).productText
    .replace(/\b(?:male|female)(?:\s+to\s+(?:male|female))+(?:\s+(?:male|female))?\b/g, " ")
    .replace(/\b(?:male|female)(?:\s+\d+)?\s*(?:pin|pins|core|cores|p)\b/g, " ")
    .replace(/\b(?:male|female)\s+(?:connectors?|terminals?|plugs?|jacks?|ports?|threads?|pins?|sockets?|ends?|cables?|wires?|audio|adapters?|heads?)\b/g, " ")
    .replace(/\b(?:connectors?|terminals?|plugs?|jacks?|ports?|threads?|pins?|sockets?|ends?|cables?|wires?|audio|adapters?|heads?)\s+(?:male|female)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const COLOR_ALIASES = Object.freeze({
  beige: ["beige"],
  black: ["black"],
  blue: ["blue"],
  bronze: ["bronze"],
  brown: ["brown"],
  clear: ["clear", "transparent"],
  gold: ["gold", "golden"],
  gray: ["gray", "grey"],
  green: ["green"],
  multicolor: ["multicolor", "multi color", "multicolour", "rainbow", "colorful", "colourful"],
  navy: ["navy"],
  orange: ["orange"],
  pink: ["pink"],
  purple: ["purple", "violet"],
  red: ["red"],
  "rose gold": ["rose gold", "rosegold"],
  silver: ["silver", "silvery"],
  white: ["white"],
  yellow: ["yellow"],
});

const GENDER_ALIASES = Object.freeze({
  female: ["female", "woman", "women", "womens", "lady", "ladies", "girl", "girls"],
  male: ["male", "man", "men", "mens", "boy", "boys"],
  unisex: ["unisex", "gender neutral", "gender-neutral"],
});

const JEWELRY_TYPE_ALIASES = Object.freeze({
  "fine jewelry": ["fine jewelry", "fine jewellery"],
  "imitation jewelry": [
    "imitation jewelry",
    "imitation jewellery",
    "costume jewelry",
    "costume jewellery",
    "fashion jewelry",
    "fashion jewellery",
    "artificial jewelry",
    "artificial jewellery",
  ],
});

const SUPPORTED_JEWELRY_MATERIALS = new Set([
  "gold",
  "silver",
  "rosegold",
  "whitegold",
  "platinum",
  "copper",
  "brass",
  "bronze",
  "iron",
  "metal",
  "alloy",
  "pearls",
  "pearl",
  "acrylic",
  "ceramic",
  "glass",
  "plastic",
  "resin",
  "leather",
  "stainlesssteel",
]);

function attributeKey(attribute) {
  return normalizeKey(attribute?.name);
}

function valueEvidenceTerms(value, key) {
  const normalized = normalizeCategoryText(value);
  if (key === "color" || key === "colorpattern") {
    return unique([normalized, ...(COLOR_ALIASES[normalized] || [])]);
  }
  if (key === "targetgender") {
    return unique([normalized, ...(GENDER_ALIASES[normalized] || [])]);
  }
  if (key === "jewelrytype") {
    return unique([normalized, ...(JEWELRY_TYPE_ALIASES[normalized] || [])]);
  }
  return [normalized];
}

function hasLabeledMaterialEvidence(productText) {
  return /\bmaterials?\s*[:\-]/.test(productText) ||
    /\b(?:made|crafted|constructed)\s+(?:from|of|with)\b/.test(productText) ||
    /\b(?:solid|sterling|gold|silver|rose gold|white gold)\s*[- ]?plated\b/.test(productText);
}

function jewelryMaterialValueIsSupported(value, productText) {
  const valueKey = normalizeKey(value);
  if (!SUPPORTED_JEWELRY_MATERIALS.has(valueKey)) return false;
  if (["gold", "silver", "rosegold", "whitegold", "platinum"].includes(valueKey)) {
    // Bare Gold/Silver in a variant is usually a finish or color, not proof of
    // the jewelry's material. Require a material/plating statement.
    return hasLabeledMaterialEvidence(productText);
  }
  return true;
}

function evidenceSources(product, key) {
  const evidence = sourceEvidence(product);
  if (key === "targetgender") {
    return [{ label: "audience text", text: audienceEvidenceText(product), weight: 96, allowVariantSuffix: false }];
  }
  if (key === "jewelrymaterial") {
    return [{ label: "product text", text: evidence.productText, weight: 96, allowVariantSuffix: false }];
  }
  if (key === "color" || key === "colorpattern") {
    return [
      { label: "product text", text: evidence.productText, weight: 96, allowVariantSuffix: false },
      { label: "variant options", text: evidence.variantText, weight: 88, allowVariantSuffix: true },
    ];
  }
  return [
    { label: "product text", text: evidence.productText, weight: 96, allowVariantSuffix: false },
    { label: "variant options", text: evidence.variantText, weight: 88, allowVariantSuffix: false },
  ];
}

function isGenericChoice(value) {
  return /^(other|none|not applicable|n\/a|unknown)$/i.test(String(value || "").trim());
}

export function buildCategoryEvidenceText(product) {
  return sourceEvidence(product).allText;
}

export function standardTemplateAttributeId(definition) {
  const templateId = String(definition?.standardTemplate?.id || definition?.standardTemplateId || "").match(/(\d+)$/)?.[1];
  const numeric = Number(templateId || 0);
  return numeric >= 10000 ? numeric - 10000 : null;
}

export function categoryMetaobjectType(definition) {
  return `${CATEGORY_METAFIELD_NAMESPACE}--${String(definition?.key || "").trim()}`;
}

export function categoryMetaobjectTaxonomyFieldKey(definition, attributeName) {
  const definitionKey = normalizeKey(definition?.key);
  const name = normalizeKey(attributeName);
  if (definitionKey === "colorpattern") {
    if (name === "color") return "color_taxonomy_reference";
    if (name === "pattern") return "pattern_taxonomy_reference";
  }
  return "taxonomy_reference";
}

export function parseMetafieldReferenceIds(raw) {
  const directReferences = raw?.references?.nodes || raw?.references || raw?.nodes || raw;
  if (Array.isArray(directReferences) && directReferences.length) {
    return unique(directReferences
      .map((entry) => typeof entry === "string" ? entry : entry?.id)
      .filter(Boolean)
      .map(String));
  }
  const value = raw?.jsonValue ?? raw?.value ?? raw;
  let parsed = value;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { parsed = []; }
  }
  if (!Array.isArray(parsed)) parsed = parsed ? [parsed] : [];
  return unique(parsed.map((entry) => typeof entry === "string" ? entry : entry?.id).filter(Boolean).map(String));
}

export function matchTaxonomyAttributeValues(product, attribute) {
  const key = attributeKey(attribute);
  const values = attribute?.values?.nodes || attribute?.values || [];
  const productText = sourceEvidence(product).productText;
  const candidates = [];
  for (const value of values) {
    const name = String(value?.name || value?.label || "").trim();
    if (!name || isGenericChoice(name)) continue;

    if (key === "jewelrymaterial" && !jewelryMaterialValueIsSupported(name, productText)) continue;

    const terms = valueEvidenceTerms(name, key);
    let match = null;
    for (const source of evidenceSources(product, key)) {
      for (const term of terms) {
        if (!containsEvidence(source.text, term, { allowVariantSuffix: source.allowVariantSuffix })) continue;
        const termIsCanonical = normalizeCategoryText(term) === normalizeCategoryText(name);
        const confidence = source.weight + (termIsCanonical ? 0 : -4);
        if (!match || confidence > match.confidence) match = { term, source: source.label, confidence };
      }
    }
    if (!match) continue;
    candidates.push({
      id: String(value?.id || ""),
      name,
      matchedTerm: match.term,
      confidence: match.confidence,
      reason: `${match.source === "product text" || match.source === "audience text" ? "Explicit" : "Variant"} evidence matched ${match.term}`,
      evidenceSource: match.source,
    });
  }
  return candidates.sort((left, right) => right.confidence - left.confidence || left.name.localeCompare(right.name));
}

function selectedCandidates(product, attribute) {
  const key = attributeKey(attribute);
  const candidates = matchTaxonomyAttributeValues(product, attribute);
  if (key === "color") return candidates.filter((candidate) => candidate.confidence >= 84).slice(0, 8);
  if (key === "jewelrymaterial" || key === "targetgender") return candidates.filter((candidate) => candidate.confidence >= 90).slice(0, 4);
  return candidates.filter((candidate) => candidate.confidence >= 90).slice(0, 1);
}

function definitionMatchesAttribute(definition, attribute) {
  const templateAttributeId = standardTemplateAttributeId(definition);
  const attributeId = String(attribute?.id || "").match(/(\d+)$/)?.[1] || "";
  // Shopify standard definitions are tied to one exact taxonomy attribute.
  // Never fall back to fuzzy name matching after a template-id mismatch: for
  // example, the generic clothing Size attribute must not be written through
  // the accessory-size definition, whose taxonomy values are a different set.
  if (templateAttributeId !== null) return String(templateAttributeId) === attributeId;

  const attributeToken = normalizeKey(attribute?.name);
  const definitionName = normalizeKey(definition?.name);
  const definitionKey = normalizeKey(definition?.key);
  return Boolean(attributeToken && (attributeToken === definitionName || attributeToken === definitionKey));
}

function rawCategoryMetafield(product, definition) {
  return product?.customData?.metafields?.[`${CATEGORY_METAFIELD_NAMESPACE}.${definition.key}`] ||
    product?.categoryMetafields?.[`${CATEGORY_METAFIELD_NAMESPACE}.${definition.key}`] || null;
}

function buildClearWrite(product, category, definition, currentReferenceIds) {
  return {
    productId: product.id,
    productGid: product.admin_graphql_api_id || `gid://shopify/Product/${product.id}`,
    handle: product.handle,
    categoryId: category.id,
    attributeId: null,
    attributeName: definition.name || definition.key,
    namespace: CATEGORY_METAFIELD_NAMESPACE,
    key: definition.key,
    type: definition.type?.name || definition.type || "list.metaobject_reference",
    metaobjectDefinitionId: definition.metaobjectDefinitionId || null,
    taxonomyValueId: null,
    taxonomyValueName: null,
    confidence: 100,
    reason: "Cleared unsupported existing category value; no direct product evidence remains",
    metaobjectType: categoryMetaobjectType(definition),
    taxonomyFieldKey: "taxonomy_reference",
    currentReferenceIds,
    action: "clear-invalid",
    clear: true,
    requiresMetaobjectScopes: false,
  };
}

export function buildCategoryMetafieldPlan({ product, category, definitions = [], attributes = [] }) {
  if (!product || !category?.id || !attributes.length) {
    return { productId: product?.id || null, categoryId: category?.id || null, writes: [], skipped: [{ reason: "category attributes unavailable" }] };
  }
  const applicableDefinitions = definitions.filter((definition) => {
    const constraint = String(definition?.constraints?.key || definition?.constraints?.nodes?.[0]?.key || "").toLowerCase();
    return (!constraint || constraint === "category") && definition?.key;
  });
  const writes = [];
  const skipped = [];
  const matchedByAttribute = new Map();
  const definitionByAttribute = new Map();

  for (const attribute of attributes) {
    const definition = applicableDefinitions.find((candidate) => definitionMatchesAttribute(candidate, attribute));
    if (!definition?.key) {
      skipped.push({ attributeId: attribute.id, attributeName: attribute.name, reason: "no category metafield definition" });
      continue;
    }
    const attributeId = String(attribute?.id || attribute?.name || "");
    definitionByAttribute.set(attributeId, definition);
    const candidates = selectedCandidates(product, attribute);
    matchedByAttribute.set(attributeId, candidates);
    if (!candidates.length) {
      skipped.push({
        attributeId: attribute.id,
        attributeName: attribute.name,
        definition: `${definition.namespace || CATEGORY_METAFIELD_NAMESPACE}.${definition.key}`,
        reason: "no direct evidence-backed taxonomy value",
      });
      continue;
    }

    const currentReferenceIds = parseMetafieldReferenceIds(rawCategoryMetafield(product, definition));
    for (const candidate of candidates) {
      writes.push({
        productId: product.id,
        productGid: product.admin_graphql_api_id || `gid://shopify/Product/${product.id}`,
        handle: product.handle,
        categoryId: category.id,
        attributeId: attribute.id,
        attributeName: attribute.name,
        namespace: CATEGORY_METAFIELD_NAMESPACE,
        key: definition.key,
        type: definition.type?.name || definition.type || "list.metaobject_reference",
        metaobjectDefinitionId: definition.metaobjectDefinitionId || null,
        taxonomyValueId: candidate.id,
        taxonomyValueName: candidate.name,
        confidence: candidate.confidence,
        reason: candidate.reason,
        metaobjectType: categoryMetaobjectType(definition),
        taxonomyFieldKey: categoryMetaobjectTaxonomyFieldKey(definition, attribute.name),
        currentReferenceIds,
        action: currentReferenceIds.length ? "verify-or-replace" : "add",
        requiresMetaobjectScopes: true,
      });
    }
  }

  // Shopify's color-pattern object requires a color. A pattern-only match is
  // never enough to create or retain that object.
  for (const [attributeId, candidates] of matchedByAttribute) {
    const attribute = attributes.find((entry) => String(entry?.id || entry?.name || "") === attributeId);
    const definition = definitionByAttribute.get(attributeId);
    if (!attribute || !definition || normalizeKey(definition.key) !== "colorpattern" || normalizeKey(attribute.name) !== "pattern") continue;
    const colorAttribute = attributes.find((entry) => normalizeKey(entry?.name) === "color");
    const colorCandidates = colorAttribute ? matchedByAttribute.get(String(colorAttribute?.id || colorAttribute?.name || "")) || [] : [];
    if (candidates.length && !colorCandidates.length) {
      for (let index = writes.length - 1; index >= 0; index -= 1) {
        if (writes[index].key === definition.key && writes[index].attributeId === attribute.id) writes.splice(index, 1);
      }
      skipped.push({ attributeId: attribute.id, attributeName: attribute.name, definition: `${definition.namespace || CATEGORY_METAFIELD_NAMESPACE}.${definition.key}`, reason: "required color evidence missing for color-pattern" });
    }
  }

  const keysWithWrites = new Set(writes.map((write) => `${write.namespace}.${write.key}`));
  const relevantDefinitions = new Map();
  for (const definition of definitionByAttribute.values()) relevantDefinitions.set(`${definition.namespace || CATEGORY_METAFIELD_NAMESPACE}.${definition.key}`, definition);
  for (const [fieldId, definition] of relevantDefinitions) {
    if (keysWithWrites.has(fieldId)) continue;
    const currentReferenceIds = parseMetafieldReferenceIds(rawCategoryMetafield(product, definition));
    if (currentReferenceIds.length) writes.push(buildClearWrite(product, category, definition, currentReferenceIds));
  }

  return { productId: product.id, categoryId: category.id, writes, skipped };
}

export { CATEGORY_METAFIELD_NAMESPACE };
