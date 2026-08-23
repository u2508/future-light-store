const SPECIFICATION_LABELS = new Map([
  ["brand", "brand"],
  ["brand name", "brand_name"],
  ["charger", "charger"],
  ["choice", "choice"],
  ["compatible brand", "compatible_brand"],
  ["compatible device", "compatible_device"],
  ["features", "features"],
  ["has speaker", "has_speaker"],
  ["high concerned chemical", "high_concerned_chemical"],
  ["high concern chemical", "high_concerned_chemical"],
  ["material", "material"],
  ["model", "model"],
  ["model number", "model_number"],
  ["origin", "origin"],
  ["power source", "power_source"],
  ["size", "size"],
  ["type", "type"],
  ["color", "color"],
  ["pattern", "pattern"],
  ["closure type", "closure_type"],
  ["finish", "finish"],
]);

function normalizeSpecificationLabel(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeSpecificationValue(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getProductBodyTextWithBreaks(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|li|h[1-6]|div|tr|td|th)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

export function extractLabeledSpecificationFacts(value) {
  const text = getProductBodyTextWithBreaks(value);
  if (!text) return [];

  const facts = [];
  const seen = new Set();
  for (const line of text.split(/\n+/g)) {
    const match = line.match(/^\s*([^:]{2,64})\s*:\s*(.+?)\s*$/);
    if (!match) continue;
    const sourceLabel = normalizeSpecificationLabel(match[1]);
    const key = SPECIFICATION_LABELS.get(sourceLabel);
    const normalizedValue = normalizeSpecificationValue(match[2]);
    if (!key || !normalizedValue || /^specifications?$/i.test(sourceLabel)) continue;
    const dedupeKey = `${key}:${normalizedValue.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    facts.push({
      key,
      label: sourceLabel
        .split(" ")
        .map((word) => `${word[0]?.toUpperCase() || ""}${word.slice(1)}`)
        .join(" "),
      value: normalizedValue,
      source: "labeled-description",
    });
  }
  return facts;
}

function normalizeProductField(value) {
  return normalizeSpecificationValue(value);
}

export function buildProductSpecifications(product = {}) {
  const body = product.body_html || product.bodyHtml || product.descriptionHtml || "";
  const labeledFacts = extractLabeledSpecificationFacts(body);
  const sourceAttributes = Object.fromEntries(labeledFacts.map((fact) => [fact.key, fact.value]));
  const directEvidenceText = normalizeSpecificationValue([
    product.title,
    product.handle,
    product.product_type || product.productType,
    body,
  ].filter(Boolean).join(" ")).toLowerCase();
  const directEvidenceTerms = [
    ["waterproof", /\bwaterproof\b|water[ -]?resistant/i],
    ["anti_fog", /anti[ -]?fog|fog[ -]?resistant/i],
    ["mobile_phone", /mobile phone|smartphone|iphone|android/i],
    ["tripod", /\btripod\b/i],
    ["camera", /\bcamera\b/i],
    ["wireless", /\bwireless\b|bluetooth|2\.4g/i],
    ["rechargeable", /rechargeable|battery/i],
    ["plastic", /\bplastic\b/i],
    ["silicone", /\bsilicone\b/i],
  ].filter(([, pattern]) => pattern.test(directEvidenceText)).map(([key]) => key);
  const identity = Object.fromEntries(
    [
      ["title", product.title],
      ["handle", product.handle],
      ["product_type", product.product_type || product.productType],
      ["vendor", product.vendor],
    ]
      .map(([key, value]) => [key, normalizeProductField(value)])
      .filter(([, value]) => value),
  );

  return {
    schema_version: "2026-08-22.1",
    source: "supplier_description_and_catalog_fields",
    identity,
    source_attributes: sourceAttributes,
    direct_evidence_terms: directEvidenceTerms,
    evidence: {
      body_present: Boolean(getProductBodyTextWithBreaks(body)),
      labeled_fact_count: labeledFacts.length,
      labels: labeledFacts.map((fact) => fact.key),
    },
  };
}

export { normalizeSpecificationLabel };
