const SIMPLE_TAG_NAMESPACES = new Set([
  "collection",
  "department",
  "category",
  "type",
  "audience",
  "feature",
  "compatibility",
]);

function normalizeTagText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function simpleCatalogTag(namespace, value) {
  const normalizedNamespace = normalizeTagText(namespace);
  const normalizedValue = normalizeTagText(value);
  if (!normalizedValue) throw new Error("A canonical tag value is required.");
  if (SIMPLE_TAG_NAMESPACES.has(normalizedNamespace)) return normalizedValue;
  if (normalizedNamespace === "classification-rule") return `classification-rule-${normalizedValue}`;
  if (normalizedNamespace === "classification-source") return `classification-source-${normalizedValue}`;
  throw new Error(`Unsupported managed tag namespace: ${namespace}`);
}

export function legacyCatalogTagToSimple(tag) {
  const match = String(tag || "").trim().match(/^salt:([^:]+):(.+)$/i);
  if (!match) return null;
  try {
    return simpleCatalogTag(match[1], match[2]);
  } catch {
    return null;
  }
}

export function isLegacySaltTag(tag) {
  return /^salt:/i.test(String(tag || "").trim());
}

export function isSimpleClassificationTag(tag) {
  const normalized = normalizeTagText(tag);
  return normalized.startsWith("classification-rule-") || normalized.startsWith("classification-source-");
}

export function normalizeCanonicalTagKey(tag) {
  return String(tag || "")
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
