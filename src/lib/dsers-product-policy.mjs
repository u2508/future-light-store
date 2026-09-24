import DSERS_FAMILY_STORE_POLICY from "../../config/dsers-family-store-search-policy.json" with { type: "json" };
import { validateDsersEvidenceBundle } from "../../scripts/lib/dsers-candidate-evidence.mjs";

const REJECT_PATTERNS = [
  { code: "replacement", pattern: /\breplacement\b|\breplace(?:ment)?\s+for\b/i },
  { code: "repair", pattern: /\brepair(?:s|ed|ing)?\b|\brepair\s+kit\b/i },
  { code: "spare-part", pattern: /\bspare\s+part(?:s)?\b|\bspare\b/i },
  { code: "parts-only", pattern: /\bfor\s+parts\b|\bparts\s+only\b|\bpart\s+only\b/i },
  { code: "refurbished", pattern: /\brefurb(?:ished)?\b|\brenewed\b|\breconditioned\b/i },
  { code: "damaged", pattern: /\bdamaged\b|\bbroken\b|\bdefective\b|\bused\s+condition\b/i },
  { code: "open-box", pattern: /\bopen[- ]?box\b|\bbox\s+damage(?:d)?\b/i },
  { code: "battery", pattern: /\bbatter(?:y|ies)\b|\blithium[- ]?(?:ion|polymer)\b|\b(?:li[- ]?ion|li[- ]?po)\b|\brechargeable\s+cell\b/i },
  { code: "portable-charger", pattern: /\bpower\s*bank\b|\bportable\s+charger\b|\bpower\s+station\b/i },
  { code: "logic-board", pattern: /\blogic\s+board\b|\bmotherboard\b|\bmainboard\b|\b(?:pcb|pcba)\b|\bcircuit\s+board\b/i },
  { code: "medical-or-diagnostic", pattern: /\bmedical\s+device\b|\bdiagnos(?:e|is|tic)\b|\bblood\s+pressure\s+(?:monitor|measurement)\b/i },
  { code: "supplement-or-ingestible", pattern: /\bsupplement\b|\bingestible\b|\bdietary\s+product\b|\bmedication\b|\bmedicine\b/i },
  { code: "treatment-or-guaranteed-outcome", pattern: /\b(?:treat|cure|heal|therapy|therapeutic)\w*\b|\bguaranteed?\s+(?:results?|outcomes?|improvement)\b/i },
  { code: "adult-erotic", pattern: /\badult\s+(?:toy|product|only)\b|\berotic\b|\bsex\s+toy\b|\bvibrator\b|\bsexual\s+wellness\b|\bfetish\b/i },
  { code: "weapon", pattern: /\b(?:weapon|firearm|rifle|handgun|tactical\s+knife|combat\s+knife|sword)\b/i },
  { code: "counterfeit", pattern: /\bcounterfeit\b|\bknock[- ]?off\b|\bfake\s+(?:brand|logo|designer)\b/i },
];

const SCORE_DIMENSIONS = DSERS_FAMILY_STORE_POLICY.qualificationScore.dimensions;
const FAMILY_BY_NAME = new Map(DSERS_FAMILY_STORE_POLICY.searchFamilies.map((family) => [family.name, family]));
const LANE_BY_ID = new Map(DSERS_FAMILY_STORE_POLICY.collectionLanes.map((lane) => [lane.id, lane]));
const CODE_ONLY_OPTION_RE = /^(?:[a-z]{1,8}[-_ ]?\d{4,}|\d{6,}|[a-z0-9]{2,}[-_][a-z0-9]{4,})$/i;

function asText(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(" ");
  if (typeof value === "object") return Object.entries(value).map(([key, nested]) => `${key} ${asText(nested)}`).join(" ");
  return "";
}

function normalized(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function candidateText(candidate = {}) {
  return [candidate.title, candidate.name, candidate.handle, candidate.description, candidate.sku,
    candidate.productId, candidate.supplierProductId, candidate.tags, candidate.variants,
    candidate.options, candidate.images, candidate.media]
    .map(asText).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function numeric(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\s*-?\d+(?:\.\d+)?\s*$/.test(value)) return Number(value);
  return null;
}

function stockEvidence(candidate = {}) {
  const direct = [candidate.supplierStock, candidate.stock, candidate.inventory, candidate.inventoryCount,
    candidate.totalStock, candidate.availableStock].map(numeric).filter((value) => value != null);
  const variants = Array.isArray(candidate.variants) ? candidate.variants : [];
  const objectVariants = variants.filter((variant) => typeof variant === "object" && variant != null);
  const variantStockValues = objectVariants.map((variant) => {
    return [variant.supplierStock, variant.stock, variant.inventory, variant.inventoryCount, variant.availableStock]
      .map(numeric).filter((value) => value != null);
  });
  // A product-level total cannot conceal an understocked option. If variant
  // records are supplied, every option must carry inventory evidence and the
  // lowest conflicting value is the conservative result.
  if (variantStockValues.some((values) => values.length === 0)) return null;
  const allStockValues = [...direct, ...variantStockValues.flat()];
  return allStockValues.length ? Math.min(...allStockValues) : null;
}

function parseQualificationScores(candidate = {}) {
  const input = candidate.qualificationScores || {};
  const scores = {};
  const issues = [];
  for (const dimension of SCORE_DIMENSIONS) {
    const value = numeric(input[dimension.id]);
    if (value == null) {
      issues.push(`missing-score-${dimension.id}`);
      continue;
    }
    if (!Number.isInteger(value) || value < 0 || value > dimension.max) {
      issues.push(`invalid-score-${dimension.id}`);
      continue;
    }
    scores[dimension.id] = value;
  }
  return {
    complete: issues.length === 0,
    scores,
    total: issues.length === 0 ? Object.values(scores).reduce((sum, value) => sum + value, 0) : null,
    maximum: SCORE_DIMENSIONS.reduce((sum, dimension) => sum + dimension.max, 0),
    issues,
  };
}

function readableVariantValues(candidate = {}) {
  const variants = Array.isArray(candidate.variants) ? candidate.variants : [];
  return variants.flatMap((variant) => {
    if (typeof variant === "string" || typeof variant === "number") return [String(variant)];
    if (variant && typeof variant === "object") {
      const options = Array.isArray(variant.selectedOptions) ? variant.selectedOptions.map((option) => option?.value) : [];
      return [variant.name, variant.title, variant.optionValue, ...options].filter(Boolean).map(String);
    }
    return [];
  });
}

function evidenceIssues(candidate, reasons) {
  const cost = numeric(candidate.supplierCost ?? candidate.cost);
  const price = numeric(candidate.proposedUsPrice ?? candidate.usPrice ?? candidate.price);
  const shipping = numeric(candidate.shippingCost);

  if (cost == null || cost <= 0) reasons.push("missing-cost-evidence");
  if (candidate.costStable !== true) reasons.push(candidate.costStable === false ? "unstable-cost-evidence" : "missing-cost-stability-evidence");
  if (price == null || price <= 0) reasons.push("missing-us-price-evidence");
  if (shipping == null || shipping < 0) reasons.push("missing-shipping-cost-evidence");
  if (candidate.shippingEvidence !== true) reasons.push("missing-shipping-signal-evidence");
  if (String(candidate.shippingDestination || "").trim().toUpperCase() !== "US") {
    reasons.push("missing-us-shipping-destination-evidence");
  }
  if (cost != null && price != null && shipping != null) {
    const contribution = price - cost - shipping
      - DSERS_FAMILY_STORE_POLICY.pricingAssumptions.storeOverheadUsd
      - DSERS_FAMILY_STORE_POLICY.pricingAssumptions.paidAcquisitionCostUsdPerOrder;
    if (contribution <= 0) reasons.push("non-positive-contribution-after-fixed-costs");
  }

  const images = Array.isArray(candidate.images) ? candidate.images : [];
  const imageCount = numeric(candidate.imageCount) ?? images.length;
  if (imageCount <= 0) reasons.push("missing-images");
  if (candidate.imagesUsable !== true) reasons.push(candidate.imagesUsable === false ? "unusable-images" : "missing-image-usability-evidence");
  if (candidate.primaryImageMatchesProduct !== true) reasons.push(candidate.primaryImageMatchesProduct === false ? "primary-image-mismatch" : "missing-primary-image-identity-evidence");
  if (candidate.supplierWatermarkDominates === true) reasons.push("supplier-watermark-dominates-image");
  if (candidate.chinaFocusedSceneDominates === true) reasons.push("supplier-country-scene-dominates-image");
  if (candidate.variantMappingClear !== true) reasons.push(candidate.variantMappingClear === false ? "unclear-variant-image-mapping" : "missing-variant-image-mapping-evidence");

  const family = FAMILY_BY_NAME.get(String(candidate.searchFamily || ""));
  if (!family) {
    reasons.push("unknown-search-family");
  } else {
    const lane = LANE_BY_ID.get(family.laneId);
    if (candidate.collectionLane !== lane?.name) reasons.push("search-family-lane-mismatch");
    const requestedTerm = normalized(candidate.searchTerm);
    if (!requestedTerm || !family.terms.some((term) => normalized(term) === requestedTerm)) reasons.push("search-term-not-in-policy");
  }

  if (candidate.duplicateCheckComplete !== true) reasons.push(candidate.duplicateCheckComplete === false ? "duplicate-check-failed" : "missing-duplicate-check-evidence");
  if (candidate.isDuplicate === true) reasons.push("duplicate-product");
  if (candidate.isNearDuplicate === true && candidate.meaningfulDifferentiation !== true) reasons.push("undifferentiated-near-duplicate");
  if (candidate.supplierCopyAccurate !== true) reasons.push(candidate.supplierCopyAccurate === false ? "misleading-supplier-copy" : "missing-supplier-copy-review");

  const variantValues = readableVariantValues(candidate);
  if (variantValues.some((value) => CODE_ONLY_OPTION_RE.test(normalized(value)))) reasons.push("code-only-variant-option");
  if (variantValues.length && candidate.variantNamesShopperReadable !== true) {
    reasons.push(candidate.variantNamesShopperReadable === false ? "unreadable-variant-names" : "missing-variant-name-review");
  }
  if (Array.isArray(candidate.variants) && candidate.variants.length > 0 && candidate.variantImagesVisible !== true) {
    reasons.push(candidate.variantImagesVisible === false ? "variant-images-not-visible" : "missing-variant-image-visibility-evidence");
  }

  const text = candidateText(candidate);
  if (/\b(?:charger|wall adapter)\b/i.test(text) && candidate.certificationEvidence !== true) {
    reasons.push(candidate.certificationEvidence === false ? "charger-certification-unclear" : "missing-charger-certification-evidence");
  }
  if (candidate.containsLicensedCharacter === true && candidate.licensingEvidence !== true) {
    reasons.push(candidate.licensingEvidence === false ? "unlicensed-character-product" : "missing-character-licensing-evidence");
  }
  if (family?.name === "Baby care & wear" && candidate.ageAndSafetyEvidence !== true) {
    reasons.push(candidate.ageAndSafetyEvidence === false ? "unclear-age-or-safety-evidence" : "missing-age-or-safety-evidence");
  }
}

export function inspectDsersProductCandidate(candidate = {}, evidenceOptions = {}) {
  const text = candidateText(candidate);
  const reasons = REJECT_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ code }) => code);
  const stock = stockEvidence(candidate);
  if (stock == null) reasons.push("missing-stock-evidence");
  else if (stock < DSERS_FAMILY_STORE_POLICY.minimumStock) reasons.push("stock-below-minimum");

  evidenceIssues(candidate, reasons);
  const evidence = validateDsersEvidenceBundle(candidate, candidate.evidenceBundle, {
    ...evidenceOptions,
    policyVersion: DSERS_FAMILY_STORE_POLICY.policyVersion,
  });
  reasons.push(...evidence.reasonCodes);
  const qualification = parseQualificationScores(candidate);
  reasons.push(...qualification.issues);

  const reasonCodes = [...new Set(reasons)];
  return {
    allowed: reasonCodes.length === 0,
    reasonCodes,
    checkedText: text,
    stock,
    minimumStock: DSERS_FAMILY_STORE_POLICY.minimumStock,
    qualificationScore: qualification.total,
    qualificationMaximum: qualification.maximum,
    qualificationScores: qualification.scores,
    qualificationScoreComplete: qualification.complete,
    qualificationPassThreshold: DSERS_FAMILY_STORE_POLICY.qualificationScore.minimumPassingTotal,
    candidateFingerprint: evidence.candidateFingerprint,
    evidenceValid: evidence.valid,
    evidenceReviewedAt: evidence.reviewedAt,
    evidenceReviewerId: evidence.reviewerId,
    evidenceFreshnessHours: 24,
    storeOverheadUsd: DSERS_FAMILY_STORE_POLICY.pricingAssumptions.storeOverheadUsd,
    paidAcquisitionCostUsdPerOrder: DSERS_FAMILY_STORE_POLICY.pricingAssumptions.paidAcquisitionCostUsdPerOrder,
    policyVersion: DSERS_FAMILY_STORE_POLICY.policyVersion,
    policy: "family-store-evidence-gated-intake",
  };
}

export function isDsersProductAllowed(candidate = {}) {
  return inspectDsersProductCandidate(candidate).allowed;
}

export { DSERS_FAMILY_STORE_POLICY };

export const DSERS_PRODUCT_POLICY = Object.freeze({
  name: "family-store-evidence-gated-intake",
  version: DSERS_FAMILY_STORE_POLICY.policyVersion,
  minimumStock: DSERS_FAMILY_STORE_POLICY.minimumStock,
  rejectedSignals: Object.freeze(REJECT_PATTERNS.map(({ code }) => code)),
  hardExclusions: DSERS_FAMILY_STORE_POLICY.hardExclusions,
  scoreDimensions: SCORE_DIMENSIONS,
  minimumPassingTotal: DSERS_FAMILY_STORE_POLICY.qualificationScore.minimumPassingTotal,
});
