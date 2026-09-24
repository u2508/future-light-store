import { createHash } from "node:crypto";

export const DSERS_EVIDENCE_SCHEMA_VERSION = 1;
export const DSERS_EVIDENCE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const REQUIRED_DUPLICATE_SCOPES = ["dsers-my-products", "shopify-active-catalog"];
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const SHA256_RE = /^(?:sha256:)?[a-f\d]{64}$/i;

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\s*-?\d+(?:\.\d+)?\s*$/.test(value)) return Number(value);
  return null;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function identityFor(candidate = {}) {
  return (
    asString(candidate.supplierProductId) || asString(candidate.productId) || asString(candidate.id)
  );
}

function sourceProjection(source = {}) {
  return {
    id: asString(source.id),
    kind: asString(source.kind).toLowerCase(),
    reference: asString(source.reference),
    sha256: asString(source.sha256)
      .toLowerCase()
      .replace(/^sha256:/, ""),
    observedAt: asString(source.observedAt),
  };
}

function imageProjection(image = {}) {
  return {
    id: asString(image.id),
    sha256: asString(image.sha256)
      .toLowerCase()
      .replace(/^sha256:/, ""),
    sourceRefId: asString(image.sourceRefId),
    productId: asString(image.productId),
  };
}

function variantProjection(variant = {}) {
  return {
    id: asString(variant.id),
    sku: asString(variant.sku),
    selectedOptions: Array.isArray(variant.selectedOptions)
      ? variant.selectedOptions.map((option) => ({
          name: asString(option?.name),
          value: asString(option?.value),
        }))
      : [],
    optionValues: Array.isArray(variant.optionValues) ? variant.optionValues.map(asString) : [],
    stock: asFiniteNumber(variant.supplierStock ?? variant.stock ?? variant.inventory),
    imageIds: Array.isArray(variant.imageIds) ? variant.imageIds.map(asString) : [],
    sourceRefId: asString(variant.sourceRefId),
  };
}

function fingerprintPayload(candidate = {}, policyVersion = "") {
  const sources = Array.isArray(candidate.sourceReferences) ? candidate.sourceReferences : [];
  const images = Array.isArray(candidate.images) ? candidate.images : [];
  const variants = Array.isArray(candidate.variants) ? candidate.variants : [];
  return {
    schemaVersion: DSERS_EVIDENCE_SCHEMA_VERSION,
    policyVersion: asString(policyVersion),
    identity: {
      supplierProductId: asString(candidate.supplierProductId),
      productId: asString(candidate.productId),
      id: asString(candidate.id),
      sku: asString(candidate.sku),
    },
    listing: {
      title: asString(candidate.title ?? candidate.name),
      description: asString(candidate.description),
      searchFamily: asString(candidate.searchFamily),
      searchTerm: asString(candidate.searchTerm),
      collectionLane: asString(candidate.collectionLane),
    },
    stock: asFiniteNumber(candidate.supplierStock ?? candidate.stock ?? candidate.inventory),
    commercial: {
      supplierCost: asFiniteNumber(candidate.supplierCost ?? candidate.cost),
      proposedUsPrice: asFiniteNumber(
        candidate.proposedUsPrice ?? candidate.usPrice ?? candidate.price,
      ),
      shippingCost: asFiniteNumber(candidate.shippingCost),
      currency: asString(candidate.currency || "USD").toUpperCase(),
    },
    shipping: {
      destination: asString(candidate.shippingDestination).toUpperCase(),
      method: asString(candidate.shippingMethod),
    },
    sourceReferences: sources.map(sourceProjection).sort((a, b) => a.id.localeCompare(b.id)),
    images: images.map(imageProjection),
    variants: variants.map(variantProjection).sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export function computeDsersCandidateFingerprint(candidate, policyVersion) {
  const payload = fingerprintPayload(candidate, policyVersion);
  return `sha256:${createHash("sha256").update(canonicalJson(payload)).digest("hex")}`;
}

function parseTimestamp(value) {
  if (typeof value !== "string" || !ISO_TIMESTAMP_RE.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function decisionBase(decision, code, expectedDecision, now, maxAgeMs, reasons) {
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
    reasons.push(`missing-${code}-decision`);
    return false;
  }
  if (decision.decision !== expectedDecision) {
    reasons.push(`unapproved-${code}-decision`);
  }
  if (asString(decision.rationale).length < 12) reasons.push(`incomplete-${code}-rationale`);
  const sourceRefs = decision.sourceRefs;
  if (
    !Array.isArray(sourceRefs) ||
    sourceRefs.length === 0 ||
    sourceRefs.some((id) => typeof id !== "string" || !id.trim())
  ) {
    reasons.push(`missing-${code}-source-references`);
  }
  const reviewed = parseTimestamp(decision.reviewedAt);
  if (reviewed == null || reviewed > now || now - reviewed > maxAgeMs) {
    reasons.push(`stale-${code}-decision`);
  }
  return true;
}

function validateSourceRefs(decision, code, sourcesById, expectedKinds, reasons) {
  if (!Array.isArray(decision?.sourceRefs)) return [];
  const resolved = [];
  for (const id of decision.sourceRefs) {
    const source = sourcesById.get(id);
    if (!source) {
      reasons.push(`unknown-${code}-source-reference`);
      continue;
    }
    if (!expectedKinds.includes(source.kind)) reasons.push(`wrong-${code}-source-kind`);
    resolved.push(source);
  }
  return resolved;
}

function validateDecision(
  decision,
  code,
  expectedDecision,
  sourcesById,
  expectedKinds,
  now,
  maxAgeMs,
  reasons,
) {
  decisionBase(decision, code, expectedDecision, now, maxAgeMs, reasons);
  return validateSourceRefs(decision, code, sourcesById, expectedKinds, reasons);
}

function sameSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  const a = [...new Set(left.map(String))].sort();
  const b = [...new Set(right.map(String))].sort();
  return (
    a.length === left.length &&
    b.length === right.length &&
    a.length === b.length &&
    a.every((value, index) => value === b[index])
  );
}

function validateImageAndVariantCoverage(
  candidate,
  decisions,
  identity,
  sourcesById,
  now,
  maxAgeMs,
  reasons,
) {
  const images = Array.isArray(candidate.images) ? candidate.images : [];
  const variants = Array.isArray(candidate.variants) ? candidate.variants : [];
  const imageDecision = decisions?.images;
  const variantDecision = decisions?.variants;

  validateDecision(
    imageDecision,
    "image",
    "approve",
    sourcesById,
    ["image"],
    now,
    maxAgeMs,
    reasons,
  );
  validateDecision(
    variantDecision,
    "variant",
    "approve",
    sourcesById,
    ["variant", "image"],
    now,
    maxAgeMs,
    reasons,
  );

  const imageIds = images.map((image) => asString(image?.id));
  if (
    images.length === 0 ||
    imageIds.some((id) => !id) ||
    new Set(imageIds).size !== imageIds.length
  ) {
    reasons.push("incomplete-candidate-images");
  }
  const expectedImageCount = asFiniteNumber(candidate.imageCount);
  if (expectedImageCount != null && expectedImageCount !== images.length) {
    reasons.push("candidate-image-count-mismatch");
  }

  const imageItems = Array.isArray(imageDecision?.items) ? imageDecision.items : [];
  const imageItemIds = imageItems.map((item) => asString(item?.imageId));
  if (!sameSet(imageIds, imageItemIds)) reasons.push("image-evidence-coverage-incomplete");
  if (new Set(imageItemIds).size !== imageItemIds.length)
    reasons.push("duplicate-image-evidence-item");
  const approvedImages = new Set();
  const imageSourcesByImageId = new Map();
  for (const image of images) {
    const id = asString(image?.id);
    const sourceId = asString(image?.sourceRefId);
    const source = sourcesById.get(sourceId);
    const digest = asString(image?.sha256)
      .toLowerCase()
      .replace(/^sha256:/, "");
    if (
      !sourceId ||
      !source ||
      source.kind !== "image" ||
      !SHA256_RE.test(digest) ||
      source.sha256 !== digest
    ) {
      reasons.push("invalid-image-source-association");
    }
    const item = imageItems.find((entry) => asString(entry?.imageId) === id);
    if (!item) continue;
    if (item.decision !== "approve") reasons.push("unapproved-image-decision");
    if (item.productId !== identity) reasons.push("image-product-association-mismatch");
    if (
      asString(item.sha256)
        .toLowerCase()
        .replace(/^sha256:/, "") !== digest
    ) {
      reasons.push("image-hash-mismatch");
    }
    if (asString(item.rationale).length < 12) reasons.push("incomplete-image-rationale");
    if (!Array.isArray(item.sourceRefs) || !item.sourceRefs.includes(sourceId)) {
      reasons.push("missing-image-item-source-reference");
    }
    validateSourceRefs(item, "image-item", sourcesById, ["image"], reasons);
    if (item.decision === "approve" && item.productId === identity && source)
      approvedImages.add(id);
    imageSourcesByImageId.set(id, sourceId);
  }

  const variantIds = variants.map((variant) => asString(variant?.id));
  const variantItems = Array.isArray(variantDecision?.items) ? variantDecision.items : [];
  const variantItemIds = variantItems.map((item) => asString(item?.variantId));
  if (
    variants.length === 0 ||
    variantIds.some((id) => !id) ||
    new Set(variantIds).size !== variantIds.length
  ) {
    reasons.push("incomplete-candidate-variants");
  }
  if (!sameSet(variantIds, variantItemIds)) reasons.push("variant-evidence-coverage-incomplete");
  if (new Set(variantItemIds).size !== variantItemIds.length)
    reasons.push("duplicate-variant-evidence-item");

  for (const variant of variants) {
    const id = asString(variant?.id);
    const item = variantItems.find((entry) => asString(entry?.variantId) === id);
    const variantSourceId = asString(variant?.sourceRefId);
    const variantSource = sourcesById.get(variantSourceId);
    const associatedImageIds = Array.isArray(variant?.imageIds)
      ? variant.imageIds.map(asString)
      : [];
    if (!variantSource || variantSource.kind !== "variant" || !variantSourceId) {
      reasons.push("invalid-variant-source-association");
    }
    if (
      associatedImageIds.length === 0 ||
      associatedImageIds.some((imageId) => !imageIds.includes(imageId))
    ) {
      reasons.push("variant-image-association-incomplete");
    }
    if (!item) continue;
    if (item.decision !== "approve") reasons.push("unapproved-variant-decision");
    if (!sameSet(associatedImageIds, item.imageIds))
      reasons.push("variant-image-association-mismatch");
    if (asString(item.rationale).length < 12) reasons.push("incomplete-variant-rationale");
    const expectedRefs = [
      variantSourceId,
      ...associatedImageIds.map((imageId) => imageSourcesByImageId.get(imageId)).filter(Boolean),
    ];
    if (
      !Array.isArray(item.sourceRefs) ||
      expectedRefs.some((ref) => !item.sourceRefs.includes(ref))
    ) {
      reasons.push("missing-variant-association-source-reference");
    }
    validateSourceRefs(item, "variant-item", sourcesById, ["variant", "image"], reasons);
    if (
      item.decision === "approve" &&
      sameSet(associatedImageIds, item.imageIds) &&
      associatedImageIds.length > 0 &&
      associatedImageIds.every((imageId) => approvedImages.has(imageId)) &&
      variantSource
    ) {
      // The exact association is covered; no boolean flag can substitute for it.
    } else {
      reasons.push("unverified-variant-image-association");
    }
  }
}

export function validateDsersEvidenceBundle(
  candidate,
  bundle,
  { now = Date.now(), maxAgeMs = DSERS_EVIDENCE_MAX_AGE_MS, policyVersion = "" } = {},
) {
  const reasons = [];
  const nowMs = typeof now === "number" ? now : Date.parse(now);
  const ageLimit = Number.isFinite(maxAgeMs) && maxAgeMs > 0 ? maxAgeMs : DSERS_EVIDENCE_MAX_AGE_MS;

  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    return {
      valid: false,
      reasonCodes: ["missing-structured-evidence-bundle"],
      candidateFingerprint: computeDsersCandidateFingerprint(candidate, policyVersion),
    };
  }
  if (!Number.isFinite(nowMs)) reasons.push("invalid-evidence-validation-time");
  if (bundle.schemaVersion !== DSERS_EVIDENCE_SCHEMA_VERSION)
    reasons.push("unsupported-evidence-schema");
  if (bundle.policyVersion !== policyVersion || !policyVersion)
    reasons.push("evidence-policy-version-mismatch");

  const identity = identityFor(candidate);
  if (!identity) reasons.push("missing-stable-candidate-identity");

  const reviewedAt = parseTimestamp(bundle.reviewedAt);
  if (reviewedAt == null || reviewedAt > nowMs || nowMs - reviewedAt > ageLimit) {
    reasons.push("stale-or-invalid-review-timestamp");
  }
  const reviewer = bundle.reviewer;
  if (
    !reviewer ||
    typeof reviewer !== "object" ||
    !asString(reviewer.id) ||
    !asString(reviewer.displayName) ||
    !asString(reviewer.role)
  ) {
    reasons.push("missing-reviewer-identity");
  }

  const candidateSources = Array.isArray(candidate?.sourceReferences)
    ? candidate.sourceReferences
    : [];
  const evidenceSources = Array.isArray(bundle.sources) ? bundle.sources : [];
  if (candidateSources.length === 0 || evidenceSources.length === 0) {
    reasons.push("missing-source-references");
  }
  const validSourceIds = new Set();
  for (const source of evidenceSources) {
    const id = asString(source?.id);
    const kind = asString(source?.kind).toLowerCase();
    const reference = asString(source?.reference);
    const digest = asString(source?.sha256)
      .toLowerCase()
      .replace(/^sha256:/, "");
    const observedAt = parseTimestamp(source?.observedAt);
    if (!id || !kind || !reference || !SHA256_RE.test(digest) || observedAt == null) {
      reasons.push("invalid-source-reference");
      continue;
    }
    if (
      observedAt > nowMs ||
      (reviewedAt != null && observedAt > reviewedAt) ||
      nowMs - observedAt > ageLimit
    ) {
      reasons.push("stale-source-evidence");
    }
    if (validSourceIds.has(id)) reasons.push("duplicate-source-reference-id");
    validSourceIds.add(id);
  }
  if (
    candidateSources.length &&
    evidenceSources.length &&
    canonicalJson(
      candidateSources.map(sourceProjection).sort((a, b) => a.id.localeCompare(b.id)),
    ) !==
      canonicalJson(evidenceSources.map(sourceProjection).sort((a, b) => a.id.localeCompare(b.id)))
  ) {
    reasons.push("source-reference-mismatch");
  }
  const sourcesById = new Map(
    evidenceSources
      .filter((source) => asString(source?.id))
      .map((source) => [asString(source.id), sourceProjection(source)]),
  );

  const expectedFingerprint = computeDsersCandidateFingerprint(candidate, policyVersion);
  if (bundle.candidateFingerprint !== expectedFingerprint)
    reasons.push("candidate-fingerprint-mismatch");

  const decisions = bundle.decisions;
  const productDecision = decisions?.product;
  const productSources = validateDecision(
    productDecision,
    "product",
    "approve",
    sourcesById,
    ["product", "supplier-listing"],
    nowMs,
    ageLimit,
    reasons,
  );
  if (
    productDecision?.productId !== identity ||
    productDecision?.title !== asString(candidate?.title ?? candidate?.name)
  ) {
    reasons.push("product-evidence-candidate-mismatch");
  }
  if (!productSources.length) reasons.push("missing-product-source-evidence");

  const commercial = decisions?.commercial;
  const commercialSources = validateDecision(
    commercial,
    "commercial",
    "approve",
    sourcesById,
    ["commercial"],
    nowMs,
    ageLimit,
    reasons,
  );
  const expectedCost = asFiniteNumber(candidate?.supplierCost ?? candidate?.cost);
  const expectedPrice = asFiniteNumber(
    candidate?.proposedUsPrice ?? candidate?.usPrice ?? candidate?.price,
  );
  const expectedShippingCost = asFiniteNumber(candidate?.shippingCost);
  if (
    commercial?.currency !== "USD" ||
    asFiniteNumber(commercial?.supplierCost) !== expectedCost ||
    asFiniteNumber(commercial?.proposedUsPrice) !== expectedPrice ||
    asFiniteNumber(commercial?.shippingCost) !== expectedShippingCost ||
    commercial?.costStability !== "stable"
  ) {
    reasons.push("commercial-evidence-candidate-mismatch");
  }
  if (!commercialSources.length) reasons.push("missing-commercial-source-evidence");

  const shipping = decisions?.shipping;
  const shippingSources = validateDecision(
    shipping,
    "shipping",
    "approve",
    sourcesById,
    ["shipping"],
    nowMs,
    ageLimit,
    reasons,
  );
  if (
    shipping?.destination !== "US" ||
    shipping?.destination !== asString(candidate?.shippingDestination).toUpperCase() ||
    !asString(shipping?.method) ||
    asFiniteNumber(shipping?.shippingCost) !== expectedShippingCost
  ) {
    reasons.push("shipping-evidence-candidate-mismatch");
  }
  if (!shippingSources.length) reasons.push("missing-shipping-source-evidence");

  const duplicate = decisions?.duplicate;
  const duplicateSources = validateDecision(
    duplicate,
    "duplicate",
    "clear",
    sourcesById,
    ["duplicate"],
    nowMs,
    ageLimit,
    reasons,
  );
  const duplicateCheckTime = parseTimestamp(duplicate?.checkedAt);
  if (
    duplicateCheckTime == null ||
    duplicateCheckTime > nowMs ||
    (reviewedAt != null && duplicateCheckTime > reviewedAt) ||
    nowMs - duplicateCheckTime > ageLimit
  ) {
    reasons.push("stale-or-invalid-duplicate-check");
  }
  if (
    !REQUIRED_DUPLICATE_SCOPES.every(
      (scope) => Array.isArray(duplicate?.scopes) && duplicate.scopes.includes(scope),
    ) ||
    duplicate?.matchCount !== 0 ||
    !Array.isArray(duplicate?.matches) ||
    duplicate.matches.length !== 0
  ) {
    reasons.push("duplicate-check-incomplete-or-matched");
  }
  if (!duplicateSources.length) reasons.push("missing-duplicate-source-evidence");

  validateImageAndVariantCoverage(
    candidate || {},
    decisions,
    identity,
    sourcesById,
    nowMs,
    ageLimit,
    reasons,
  );

  const reasonCodes = [...new Set(reasons)];
  return {
    valid: reasonCodes.length === 0,
    reasonCodes,
    candidateFingerprint: expectedFingerprint,
    reviewedAt: bundle.reviewedAt ?? null,
    reviewerId: reviewer?.id ?? null,
  };
}
