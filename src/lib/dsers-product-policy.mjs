/**
 * Intake policy for products sourced through DSers.
 *
 * A DSers listing is only eligible when it represents a complete,
 * customer-ready product. Replacement-only, repair, spare-part, refurbished,
 * damaged, open-box, and "for parts" listings are never eligible.
 */

const REJECT_PATTERNS = [
  { code: "replacement", pattern: /\breplacement\b|\breplace(?:ment)?\s+for\b/i },
  { code: "repair", pattern: /\brepair(?:s|ed|ing)?\b|\brepair\s+kit\b/i },
  { code: "spare-part", pattern: /\bspare\s+part(?:s)?\b|\bspare\b/i },
  { code: "parts-only", pattern: /\bfor\s+parts\b|\bparts\s+only\b|\bpart\s+only\b/i },
  { code: "refurbished", pattern: /\brefurb(?:ished)?\b|\brenewed\b|\breconditioned\b/i },
  { code: "damaged", pattern: /\bdamaged\b|\bbroken\b|\bdefective\b|\bused\s+condition\b/i },
  { code: "open-box", pattern: /\bopen[- ]?box\b|\bbox\s+damage(?:d)?\b/i },
];

function asText(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(" ");
  if (typeof value === "object") {
    return Object.entries(value).map(([key, nested]) => `${key} ${asText(nested)}`).join(" ");
  }
  return "";
}

function candidateText(candidate = {}) {
  return [
    candidate.title,
    candidate.name,
    candidate.description,
    candidate.sku,
    candidate.productId,
    candidate.supplierProductId,
    candidate.variants,
    candidate.options,
  ]
    .map(asText)
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function inspectDsersProductCandidate(candidate = {}) {
  const text = candidateText(candidate);
  const matches = REJECT_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
    .map(({ code }) => code);

  return {
    allowed: matches.length === 0,
    reasonCodes: matches,
    checkedText: text,
    policy: "complete-customer-ready-product-only",
  };
}

export function isDsersProductAllowed(candidate = {}) {
  return inspectDsersProductCandidate(candidate).allowed;
}

export const DSERS_PRODUCT_POLICY = Object.freeze({
  name: "complete-customer-ready-product-only",
  rejectedSignals: Object.freeze(REJECT_PATTERNS.map(({ code }) => code)),
});
