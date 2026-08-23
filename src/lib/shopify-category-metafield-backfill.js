const CATEGORY_METAFIELD_NAMESPACE = "shopify";

function normalizeCategoryText(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function evidenceText(product) {
  const customMetafieldText = Object.values(product?.customData?.metafields || {})
    .flatMap((entry) => [entry?.value, entry?.jsonValue, ...(entry?.references || []).map((reference) => reference?.title)])
    .filter(Boolean);
  return normalizeCategoryText([
    product?.handle,
    product?.title,
    product?.product_type || product?.productType,
    product?.vendor,
    ...(Array.isArray(product?.tags) ? product.tags : []),
    product?.body_html || product?.bodyHtml || product?.descriptionHtml,
    ...(Array.isArray(product?.collections) ? product.collections.map((entry) => entry?.title || entry) : []),
    ...customMetafieldText,
  ].join(" "));
}

export function buildCategoryEvidenceText(product) {
  return evidenceText(product);
}

function normalizeKey(value) {
  return normalizeCategoryText(value).replace(/[^a-z0-9]+/g, "");
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
  if (Array.isArray(directReferences)) {
    return [...new Set(directReferences.map((entry) => typeof entry === "string" ? entry : entry?.id).filter(Boolean).map(String))];
  }
  const value = raw?.jsonValue ?? raw?.value ?? raw;
  let parsed = value;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { parsed = []; }
  }
  if (!Array.isArray(parsed)) parsed = parsed ? [parsed] : [];
  return [...new Set(parsed.map((entry) => typeof entry === "string" ? entry : entry?.id).filter(Boolean).map(String))];
}

const VALUE_SYNONYMS = [
  ["smartphone", ["smartphone", "mobile phone", "iphone", "android", "cell phone"]],
  ["tablet", ["tablet", "ipad"]],
  ["clear", ["clear", "transparent"]],
  ["plastic", ["plastic", "abs plastic"]],
  ["silicone", ["silicone"]],
  ["metal", ["metal", "aluminum", "aluminium", "steel"]],
  ["waterproof", ["waterproof", "water resistant", "water-resistant"]],
  ["anti-fog", ["anti-fog", "antifog", "fog resistant", "fog-resistant"]],
  ["fixed", ["fixed", "stationary"]],
  ["usb", ["usb", "type-c", "type c", "5v"]],
  ["battery", ["battery", "rechargeable"]],
  ["wireless", ["wireless", "bluetooth", "2.4g"]],
];

function valueEvidenceTerms(value) {
  const normalized = normalizeCategoryText(value);
  const synonyms = VALUE_SYNONYMS.find(([key]) => normalized === key || normalized.includes(key))?.[1] || [];
  return [...new Set([normalized, ...synonyms].filter(Boolean))];
}

function containsEvidence(text, term) {
  const normalizedTerm = normalizeCategoryText(term);
  if (!normalizedTerm) return false;
  return normalizedTerm.split(" ").every((part) => text.includes(part)) &&
    (text.includes(normalizedTerm) || normalizedTerm.split(" ").length > 1);
}

function isGenericChoice(value) {
  return /^(other|none|not applicable|n\/a|unknown)$/i.test(String(value || "").trim());
}

export function matchTaxonomyAttributeValues(product, attribute) {
  const text = evidenceText(product);
  const values = attribute?.values?.nodes || attribute?.values || [];
  const candidates = [];
  for (const value of values) {
    const name = String(value?.name || value?.label || "").trim();
    if (!name || isGenericChoice(name)) continue;
    const matchedTerm = valueEvidenceTerms(name).find((term) => containsEvidence(text, term));
    if (!matchedTerm) continue;
    const directLabelEvidence = new RegExp(`(?:^|\\s)${name.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}(?:\\s|$)`, "i").test(text);
    candidates.push({
      id: String(value?.id || ""),
      name,
      matchedTerm,
      confidence: directLabelEvidence ? 96 : matchedTerm === name.toLowerCase() ? 90 : 82,
      reason: `Evidence matched ${matchedTerm}`,
    });
  }
  return candidates.sort((left, right) => right.confidence - left.confidence).slice(0, 3);
}

function definitionMatchesAttribute(definition, attribute) {
  const templateAttributeId = standardTemplateAttributeId(definition);
  if (templateAttributeId && String(templateAttributeId) === String(attribute?.id || "").match(/(\d+)$/)?.[1]) return true;
  const definitionTokens = normalizeKey(`${definition?.key || ""} ${definition?.name || ""}`);
  const attributeToken = normalizeKey(attribute?.name);
  return Boolean(attributeToken && definitionTokens.includes(attributeToken));
}

function rawCategoryMetafield(product, definition) {
  return product?.customData?.metafields?.[`${CATEGORY_METAFIELD_NAMESPACE}.${definition.key}`] ||
    product?.categoryMetafields?.[`${CATEGORY_METAFIELD_NAMESPACE}.${definition.key}`] || null;
}

export function buildCategoryMetafieldPlan({ product, category, definitions = [], attributes = [] }) {
  if (!product || !category?.id || !attributes.length) {
    return { productId: product?.id || null, categoryId: category?.id || null, writes: [], skipped: [{ reason: "category attributes unavailable" }] };
  }
  const applicableDefinitions = definitions.filter((definition) => {
    const constraint = String(definition?.constraints?.key || definition?.constraints?.nodes?.[0]?.key || "").toLowerCase();
    return !constraint || constraint === "category";
  });
  const writes = [];
  const skipped = [];
  for (const attribute of attributes) {
    const definition = applicableDefinitions.find((candidate) => definitionMatchesAttribute(candidate, attribute));
    if (!definition?.key) {
      skipped.push({ attributeId: attribute.id, attributeName: attribute.name, reason: "no category metafield definition" });
      continue;
    }
    const candidate = matchTaxonomyAttributeValues(product, attribute)[0];
    if (!candidate?.id) {
      skipped.push({ attributeId: attribute.id, attributeName: attribute.name, definition: `${definition.namespace}.${definition.key}`, reason: "no direct evidence-backed taxonomy value" });
      continue;
    }
    const current = rawCategoryMetafield(product, definition);
    const currentReferenceIds = parseMetafieldReferenceIds(current);
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
  return { productId: product.id, categoryId: category.id, writes, skipped };
}

export { CATEGORY_METAFIELD_NAMESPACE };
