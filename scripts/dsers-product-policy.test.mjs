import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  DSERS_FAMILY_STORE_POLICY,
  inspectDsersProductCandidate,
} from "../src/lib/dsers-product-policy.mjs";
import {
  computeDsersCandidateFingerprint,
  DSERS_EVIDENCE_SCHEMA_VERSION,
} from "./lib/dsers-candidate-evidence.mjs";

const NOW_CLOCK_MS = Date.now();
const REVIEWED_AT = new Date(NOW_CLOCK_MS - 1_000).toISOString();
const NOW = Date.parse(REVIEWED_AT);
const STALE_AT = new Date(NOW - 25 * 60 * 60 * 1_000).toISOString();
const FUTURE_AT = new Date(NOW + 60 * 1_000).toISOString();
const POLICY_VERSION = DSERS_FAMILY_STORE_POLICY.policyVersion;
const HASHES = {
  product: "a".repeat(64),
  imagePrimary: "b".repeat(64),
  imageSage: "c".repeat(64),
  imageSand: "d".repeat(64),
  variantSage: "e".repeat(64),
  variantSand: "f".repeat(64),
  inventorySage: "7".repeat(64),
  inventorySand: "8".repeat(64),
  commercial: "1".repeat(64),
  shipping: "2".repeat(64),
  duplicate: "3".repeat(64),
};

function sources() {
  return [
    {
      id: "src-product",
      kind: "product",
      reference: "https://supplier.example/products/bib-123",
      sha256: HASHES.product,
      observedAt: REVIEWED_AT,
    },
    {
      id: "src-supplier-listing",
      kind: "supplier-listing",
      reference: "https://supplier.example/products/bib-123#listing-status",
      sha256: "9".repeat(64),
      observedAt: REVIEWED_AT,
      capture: { supplierListingStatus: "ready", supplierErrorCode: "" },
    },
    {
      id: "src-image-primary",
      kind: "image",
      reference: "https://supplier.example/images/bib-primary.jpg",
      sha256: HASHES.imagePrimary,
      observedAt: REVIEWED_AT,
    },
    {
      id: "src-image-sage",
      kind: "image",
      reference: "https://supplier.example/images/bib-sage.jpg",
      sha256: HASHES.imageSage,
      observedAt: REVIEWED_AT,
    },
    {
      id: "src-image-sand",
      kind: "image",
      reference: "https://supplier.example/images/bib-sand.jpg",
      sha256: HASHES.imageSand,
      observedAt: REVIEWED_AT,
    },
    {
      id: "src-variant-sage",
      kind: "variant",
      reference: "https://supplier.example/products/bib-123#sage",
      sha256: HASHES.variantSage,
      observedAt: REVIEWED_AT,
    },
    {
      id: "src-variant-sand",
      kind: "variant",
      reference: "https://supplier.example/products/bib-123#sand",
      sha256: HASHES.variantSand,
      observedAt: REVIEWED_AT,
    },
    {
      id: "src-inventory-sage",
      kind: "inventory",
      reference: "https://supplier.example/products/bib-123#inventory-sage",
      sha256: HASHES.inventorySage,
      observedAt: REVIEWED_AT,
    },
    {
      id: "src-inventory-sand",
      kind: "inventory",
      reference: "https://supplier.example/products/bib-123#inventory-sand",
      sha256: HASHES.inventorySand,
      observedAt: REVIEWED_AT,
    },
    {
      id: "src-commercial",
      kind: "commercial",
      reference: "https://supplier.example/products/bib-123#price",
      sha256: HASHES.commercial,
      observedAt: REVIEWED_AT,
    },
    {
      id: "src-shipping",
      kind: "shipping",
      reference: "https://supplier.example/products/bib-123#shipping-us",
      sha256: HASHES.shipping,
      observedAt: REVIEWED_AT,
    },
    {
      id: "src-duplicate",
      kind: "duplicate",
      reference: "sha256:duplicate-audit-20260924",
      sha256: HASHES.duplicate,
      observedAt: REVIEWED_AT,
    },
  ];
}

function approved(rationale, sourceRefs, extra = {}) {
  return { decision: "approve", rationale, sourceRefs, reviewedAt: REVIEWED_AT, ...extra };
}

function evidenceFor(candidate, overrides = {}) {
  const identity = candidate.supplierProductId || candidate.productId || candidate.id;
  const decisions = {
    supplierListing: approved("Supplier listing is ready with no supplier error.", ["src-supplier-listing"], {
      supplierListingStatus: candidate.supplierListingStatus,
      supplierErrorCode: candidate.supplierErrorCode,
    }),
    product: approved("Verified product identity and complete retail item.", ["src-product"], {
      productId: identity,
      title: candidate.title,
    }),
    images: approved(
      "Reviewed every image for product fidelity and presentation.",
      ["src-image-primary", "src-image-sage", "src-image-sand"],
      {
        items: candidate.images.map((image) => ({
          imageId: image.id,
          productId: identity,
          sha256: image.sha256,
          decision: "approve",
          rationale: "Image visibly matches the represented bib and color.",
          sourceRefs: [image.sourceRefId],
        })),
      },
    ),
    variants: approved(
      "Matched each sellable option to its corresponding image.",
      ["src-variant-sage", "src-variant-sand", "src-image-sage", "src-image-sand"],
      {
        items: candidate.variants.map((variant) => ({
          variantId: variant.id,
          decision: "approve",
          imageIds: [...variant.imageIds],
          rationale: "Option name and image association agree with source evidence.",
          sourceRefs: [
            variant.sourceRefId,
            ...variant.imageIds
              .map((imageId) => candidate.images.find((image) => image.id === imageId)?.sourceRefId)
              .filter(Boolean),
          ],
        })),
      },
    ),
    inventory: approved(
      "Verified a current supplier quantity for every exact option.",
      ["src-inventory-sage", "src-inventory-sand"],
      {
        items: candidate.variants.map((variant) => ({
          variantId: variant.id,
          quantity: variant.inventoryEvidence?.quantity,
          sourceRefId: variant.inventoryEvidence?.sourceRefId,
          decision: "approve",
          rationale: "The supplier stock row is explicitly tied to this option.",
          sourceRefs: [variant.inventoryEvidence?.sourceRefId],
        })),
      },
    ),
    commercial: approved(
      "Checked current supplier cost and proposed US selling price.",
      ["src-commercial"],
      {
        supplierCost: candidate.supplierCost,
        proposedUsPrice: candidate.proposedUsPrice,
        shippingCost: candidate.shippingCost,
        currency: "USD",
        costStability: "stable",
      },
    ),
    shipping: approved("Verified a current shipping route and cost to the US.", ["src-shipping"], {
      destination: "US",
      method: "Tracked standard parcel",
      shippingCost: candidate.shippingCost,
    }),
    duplicate: {
      ...approved(
        "Searched both product catalogs; no matching candidate was found.",
        ["src-duplicate"],
        {
          decision: "clear",
        },
      ),
      checkedAt: REVIEWED_AT,
      scopes: ["dsers-my-products", "shopify-active-catalog"],
      matchCount: 0,
      matches: [],
    },
    ...overrides,
  };
  return {
    schemaVersion: DSERS_EVIDENCE_SCHEMA_VERSION,
    policyVersion: POLICY_VERSION,
    candidateFingerprint: computeDsersCandidateFingerprint(candidate, POLICY_VERSION),
    reviewedAt: REVIEWED_AT,
    reviewer: { id: "reviewer-17", displayName: "Catalog reviewer", role: "human-reviewer" },
    sources: candidate.sourceReferences,
    decisions,
  };
}

function eligibleCandidate(overrides = {}) {
  const candidate = {
    title: "Silicone Baby Feeding Bib with Food Catcher",
    description: "A reusable feeding bib with a catch pocket for mealtime cleanup.",
    searchFamily: "Baby care & wear",
    searchTerm: "baby feeding bib silicone",
    collectionLane: "Baby care & baby wear",
    supplierProductId: "supplier-bib-123",
    supplierListingStatus: "ready",
    supplierErrorCode: "",
    supplierStock: 420,
    supplierCost: 3,
    proposedUsPrice: 35,
    shippingCost: 2,
    currency: "USD",
    costStable: true,
    shippingEvidence: true,
    shippingDestination: "US",
    shippingMethod: "Tracked standard parcel",
    imageCount: 3,
    sourceReferences: sources(),
    images: [
      { id: "image-primary", sha256: HASHES.imagePrimary, sourceRefId: "src-image-primary" },
      { id: "image-sage", sha256: HASHES.imageSage, sourceRefId: "src-image-sage" },
      { id: "image-sand", sha256: HASHES.imageSand, sourceRefId: "src-image-sand" },
    ],
    imagesUsable: true,
    primaryImageMatchesProduct: true,
    supplierWatermarkDominates: false,
    chinaFocusedSceneDominates: false,
    variantMappingClear: true,
    variantNamesShopperReadable: true,
    variantImagesVisible: true,
    variants: [
      {
        id: "variant-sage",
        name: "Sage Green",
        selectedOptions: [{ name: "Color", value: "Sage Green" }],
        stock: 420,
        inventoryEvidence: { quantity: 420, sourceRefId: "src-inventory-sage" },
        imageIds: ["image-sage"],
        sourceRefId: "src-variant-sage",
      },
      {
        id: "variant-sand",
        name: "Sand",
        selectedOptions: [{ name: "Color", value: "Sand" }],
        stock: 300,
        inventoryEvidence: { quantity: 300, sourceRefId: "src-inventory-sand" },
        imageIds: ["image-sand"],
        sourceRefId: "src-variant-sand",
      },
    ],
    duplicateCheckComplete: true,
    isDuplicate: false,
    isNearDuplicate: false,
    meaningfulDifferentiation: false,
    supplierCopyAccurate: true,
    certificationEvidence: true,
    containsLicensedCharacter: false,
    licensingEvidence: true,
    ageAndSafetyEvidence: true,
    qualificationScores: {
      evidenceQuality: 26,
      storeFit: 17,
      commercialFit: 16,
      variantClarity: 12,
      contentReadiness: 13,
    },
    ...overrides,
  };
  if (!Object.hasOwn(overrides, "evidenceBundle"))
    candidate.evidenceBundle = evidenceFor(candidate);
  return candidate;
}

function inspect(candidate, options = {}) {
  return inspectDsersProductCandidate(candidate, { now: NOW, ...options });
}

test("allows a fully evidenced candidate and preserves policy scoring and pricing assumptions", () => {
  const result = inspect(eligibleCandidate());
  assert.equal(result.allowed, true, result.reasonCodes.join(", "));
  assert.deepEqual(result.reasonCodes, []);
  assert.equal(result.stock, 300);
  assert.equal(result.qualificationScore, 84);
  assert.equal(result.qualificationMaximum, 100);
  assert.equal(result.storeOverheadUsd, 16);
  assert.equal(result.paidAcquisitionCostUsdPerOrder, 13);
  assert.equal(result.evidenceValid, true);
  assert.equal(result.supplierListingDisposition, "ready");
  assert.match(result.candidateFingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.evidenceFreshnessHours, 24);
});

test("holds missing listing facts and rejects non-ready or supplier-error candidates", () => {
  const missingStatus = eligibleCandidate();
  delete missingStatus.supplierListingStatus;
  missingStatus.evidenceBundle = evidenceFor(missingStatus);
  const held = inspect(missingStatus);
  assert.equal(held.allowed, false);
  assert.equal(held.supplierListingDisposition, "hold");
  assert.ok(held.reasonCodes.includes("missing-supplier-listing-status"));

  const missingErrorCode = eligibleCandidate();
  delete missingErrorCode.supplierErrorCode;
  missingErrorCode.evidenceBundle = evidenceFor(missingErrorCode);
  const missingError = inspect(missingErrorCode);
  assert.equal(missingError.supplierListingDisposition, "hold");
  assert.ok(missingError.reasonCodes.includes("missing-supplier-error-code"));

  const notReady = eligibleCandidate({ supplierListingStatus: "paused" });
  const rejectedStatus = inspect(notReady);
  assert.equal(rejectedStatus.supplierListingDisposition, "reject");
  assert.ok(rejectedStatus.reasonCodes.includes("supplier-listing-not-ready"));

  const supplierError = eligibleCandidate({ supplierErrorCode: "OUT_OF_STOCK" });
  const rejectedError = inspect(supplierError);
  assert.equal(rejectedError.supplierListingDisposition, "reject");
  assert.ok(rejectedError.reasonCodes.includes("supplier-error-code-present"));
});

test("keeps source-policy family lanes and all seven batch-capacity ceilings", () => {
  const laneIds = new Set(DSERS_FAMILY_STORE_POLICY.collectionLanes.map((lane) => lane.id));
  assert.equal(DSERS_FAMILY_STORE_POLICY.searchFamilies.length, 10);
  assert.ok(DSERS_FAMILY_STORE_POLICY.searchFamilies.every((family) => laneIds.has(family.laneId)));
  assert.deepEqual(
    DSERS_FAMILY_STORE_POLICY.batches.map((batch) => batch.ceiling),
    [100, 100, 100, 100, 100, 100, 79],
  );
  for (const batch of DSERS_FAMILY_STORE_POLICY.batches) {
    assert.equal(
      batch.laneAllocations.reduce((sum, allocation) => sum + allocation.slots, 0),
      batch.ceiling,
      `batch ${batch.id} lane allocation must equal its source ceiling`,
    );
  }
  assert.equal(
    DSERS_FAMILY_STORE_POLICY.batches.reduce((sum, batch) => sum + batch.ceiling, 0),
    679,
  );
});

test("a set of true boolean declarations without structured evidence cannot pass", () => {
  const candidate = eligibleCandidate();
  delete candidate.evidenceBundle;
  const result = inspect(candidate);
  assert.equal(result.allowed, false);
  assert.ok(result.reasonCodes.includes("missing-structured-evidence-bundle"));

  const booleansOnly = inspect({
    title: "Silicone Baby Feeding Bib",
    supplierStock: 420,
    imagesUsable: true,
    primaryImageMatchesProduct: true,
    variantMappingClear: true,
    duplicateCheckComplete: true,
    costStable: true,
    shippingEvidence: true,
    supplierCopyAccurate: true,
  });
  assert.equal(booleansOnly.allowed, false);
});

test("hard exclusions cannot be overridden by a complete evidence bundle or perfect score", () => {
  const result = inspect(
    eligibleCandidate({
      title: "Portable Charger Power Bank with Lithium Battery",
      qualificationScores: {
        evidenceQuality: 30,
        storeFit: 20,
        commercialFit: 20,
        variantClarity: 15,
        contentReadiness: 15,
      },
    }),
  );
  assert.equal(result.qualificationScore, 100);
  assert.equal(result.allowed, false);
  assert.ok(result.reasonCodes.includes("battery"));
  assert.ok(result.reasonCodes.includes("portable-charger"));
});

test("keeps replacement, repair, spare, refurbished, damaged and open-box exclusions", () => {
  const cases = [
    ["Replacement Screen Repair Kit for Tablet", ["replacement", "repair"]],
    ["Watch with Spare Part", ["spare-part"]],
    ["Refurbished Smart Watch", ["refurbished"]],
    ["Damaged Smart Watch", ["damaged"]],
    ["Open-box Smart Watch", ["open-box"]],
    ["Smart Watch", []],
  ];
  for (const [title, expected] of cases) {
    const result = inspect(eligibleCandidate({ title }));
    for (const code of expected) assert.ok(result.reasonCodes.includes(code), `${title}: ${code}`);
  }
});

test("retains medical, ingestible, treatment, adult, weapon and counterfeit exclusions", () => {
  const cases = [
    ["Diagnostic blood pressure monitor", "medical-or-diagnostic"],
    ["Herbal dietary supplement", "supplement-or-ingestible"],
    ["Skin cream guaranteed to cure acne", "treatment-or-guaranteed-outcome"],
    ["Adult sexual wellness product", "adult-erotic"],
    ["Tactical knife", "weapon"],
    ["Counterfeit designer wallet", "counterfeit"],
  ];
  for (const [title, code] of cases) {
    const result = inspect(eligibleCandidate({ title }));
    assert.ok(result.reasonCodes.includes(code), `${title}: expected ${code}`);
  }
});

test("requires stock evidence and applies the minimum conservatively across variants", () => {
  const missing = inspect(
    eligibleCandidate({
      supplierStock: undefined,
      variants: eligibleCandidate().variants.map((variant) => ({
        ...variant,
        stock: undefined,
        inventoryEvidence: undefined,
      })),
    }),
  );
  assert.ok(missing.reasonCodes.includes("missing-stock-evidence"));
  const low = inspect(eligibleCandidate({
    variants: eligibleCandidate().variants.map((variant, index) => index === 1
      ? { ...variant, stock: 199, inventoryEvidence: { ...variant.inventoryEvidence, quantity: 199 } }
      : variant),
  }));
  assert.ok(low.reasonCodes.includes("stock-below-minimum"));
  assert.equal(DSERS_FAMILY_STORE_POLICY.minimumStock, 200);
  const hiddenLow = inspect(
    eligibleCandidate({
      variants: [
        {
          id: "variant-sage",
          name: "Sage",
          stock: 300,
          inventoryEvidence: { quantity: 300, sourceRefId: "src-inventory-sage" },
          imageIds: ["image-sage"],
          sourceRefId: "src-variant-sage",
        },
        {
          id: "variant-sand",
          name: "Sand",
          stock: 199,
          inventoryEvidence: { quantity: 199, sourceRefId: "src-inventory-sand" },
          imageIds: ["image-sand"],
          sourceRefId: "src-variant-sand",
        },
      ],
    }),
  );
  assert.equal(hiddenLow.stock, 199);
  assert.ok(hiddenLow.reasonCodes.includes("stock-below-minimum"));
});

test("requires current, explicit US shipping and commercial facts with positive contribution", () => {
  const destination = inspect(eligibleCandidate({ shippingDestination: "CA" }));
  assert.ok(destination.reasonCodes.includes("missing-us-shipping-destination-evidence"));
  assert.ok(destination.reasonCodes.includes("shipping-evidence-candidate-mismatch"));

  const missing = inspect(
    eligibleCandidate({ supplierCost: undefined, proposedUsPrice: undefined }),
  );
  assert.ok(missing.reasonCodes.includes("missing-cost-evidence"));
  assert.ok(missing.reasonCodes.includes("missing-us-price-evidence"));

  const loss = inspect(eligibleCandidate({ proposedUsPrice: 20 }));
  assert.ok(loss.reasonCodes.includes("non-positive-contribution-after-fixed-costs"));
  const acquisitionBoundary = inspect(eligibleCandidate({ proposedUsPrice: 34 }));
  assert.ok(
    acquisitionBoundary.reasonCodes.includes("non-positive-contribution-after-fixed-costs"),
  );
});

test("requires exact policy family, search term, and lane alignment", () => {
  assert.ok(
    inspect(eligibleCandidate({ searchFamily: "Women fashion" })).reasonCodes.includes(
      "search-family-lane-mismatch",
    ),
  );
  assert.ok(
    inspect(eligibleCandidate({ searchTerm: "baby sock" })).reasonCodes.includes(
      "search-term-not-in-policy",
    ),
  );
});

test("rejects missing, stale, future-dated and policy-mismatched evidence", () => {
  const missing = eligibleCandidate({ evidenceBundle: undefined });
  assert.ok(inspect(missing).reasonCodes.includes("missing-structured-evidence-bundle"));

  const stale = eligibleCandidate();
  stale.evidenceBundle.reviewedAt = STALE_AT;
  stale.evidenceBundle.sources = stale.evidenceBundle.sources.map((source) => ({
    ...source,
    observedAt: STALE_AT,
  }));
  assert.ok(inspect(stale).reasonCodes.includes("stale-or-invalid-review-timestamp"));

  const staleSource = eligibleCandidate();
  staleSource.sourceReferences = staleSource.sourceReferences.map((source) => ({
    ...source,
    observedAt: STALE_AT,
  }));
  staleSource.evidenceBundle.sources = staleSource.sourceReferences;
  staleSource.evidenceBundle.candidateFingerprint = computeDsersCandidateFingerprint(
    staleSource,
    POLICY_VERSION,
  );
  assert.ok(inspect(staleSource).reasonCodes.includes("stale-source-evidence"));

  const future = eligibleCandidate();
  future.evidenceBundle.reviewedAt = FUTURE_AT;
  assert.ok(inspect(future).reasonCodes.includes("stale-or-invalid-review-timestamp"));

  const changedPolicy = eligibleCandidate();
  changedPolicy.evidenceBundle.policyVersion = "old-policy";
  assert.ok(inspect(changedPolicy).reasonCodes.includes("evidence-policy-version-mismatch"));
});

test("binds evidence to stable identity, reviewer, exact source references and candidate facts", () => {
  const noReviewer = eligibleCandidate();
  noReviewer.evidenceBundle.reviewer = null;
  assert.ok(inspect(noReviewer).reasonCodes.includes("missing-reviewer-identity"));

  const sourceMismatch = eligibleCandidate();
  sourceMismatch.evidenceBundle.sources = structuredClone(sourceMismatch.evidenceBundle.sources);
  sourceMismatch.evidenceBundle.sources[0] = {
    ...sourceMismatch.evidenceBundle.sources[0],
    sha256: "9".repeat(64),
  };
  assert.ok(inspect(sourceMismatch).reasonCodes.includes("source-reference-mismatch"));

  const changedTitle = eligibleCandidate();
  changedTitle.title = "Different product title";
  assert.ok(inspect(changedTitle).reasonCodes.includes("candidate-fingerprint-mismatch"));
  assert.ok(inspect(changedTitle).reasonCodes.includes("product-evidence-candidate-mismatch"));

  const noIdentity = eligibleCandidate({ supplierProductId: "" });
  assert.ok(inspect(noIdentity).reasonCodes.includes("missing-stable-candidate-identity"));

  const wrongProduct = eligibleCandidate();
  wrongProduct.evidenceBundle.decisions.product.productId = "another-product";
  assert.ok(inspect(wrongProduct).reasonCodes.includes("product-evidence-candidate-mismatch"));
});

test("evidence fingerprint is stable under object-key order but changes with decision-relevant facts", () => {
  const candidate = eligibleCandidate();
  const reversed = {
    ...candidate,
    title: undefined,
    name: candidate.title,
    images: candidate.images.map((image) => ({
      sourceRefId: image.sourceRefId,
      sha256: image.sha256,
      id: image.id,
    })),
  };
  assert.equal(
    computeDsersCandidateFingerprint(candidate, POLICY_VERSION),
    computeDsersCandidateFingerprint(reversed, POLICY_VERSION),
  );
  assert.notEqual(
    computeDsersCandidateFingerprint(candidate, POLICY_VERSION),
    computeDsersCandidateFingerprint({ ...candidate, proposedUsPrice: 36 }, POLICY_VERSION),
  );
  assert.notEqual(
    computeDsersCandidateFingerprint(candidate, POLICY_VERSION),
    computeDsersCandidateFingerprint(
      {
        ...candidate,
        images: candidate.images.map((image, index) =>
          index === 1 ? { ...image, sha256: "8".repeat(64) } : image,
        ),
      },
      POLICY_VERSION,
    ),
  );
});

test("requires one reviewed image decision and a hash-matched product association for every image", () => {
  const missing = eligibleCandidate();
  missing.evidenceBundle.decisions.images.items.pop();
  assert.ok(inspect(missing).reasonCodes.includes("image-evidence-coverage-incomplete"));

  const wrongHash = eligibleCandidate();
  wrongHash.evidenceBundle.decisions.images.items[1].sha256 = "9".repeat(64);
  assert.ok(inspect(wrongHash).reasonCodes.includes("image-hash-mismatch"));

  const wrongProduct = eligibleCandidate();
  wrongProduct.evidenceBundle.decisions.images.items[0].productId = "unrelated-product";
  assert.ok(inspect(wrongProduct).reasonCodes.includes("image-product-association-mismatch"));

  const wrongSource = eligibleCandidate();
  const primaryImageSource = wrongSource.sourceReferences.find((source) => source.id === "src-image-primary");
  Object.assign(primaryImageSource, { kind: "product" });
  wrongSource.evidenceBundle = evidenceFor(wrongSource);
  assert.ok(inspect(wrongSource).reasonCodes.includes("invalid-image-source-association"));

  const duplicateImageId = eligibleCandidate({
    images: [
      { id: "same", sha256: HASHES.imagePrimary, sourceRefId: "src-image-primary" },
      { id: "same", sha256: HASHES.imageSage, sourceRefId: "src-image-sage" },
    ],
  });
  assert.ok(inspect(duplicateImageId).reasonCodes.includes("incomplete-candidate-images"));
});

test("requires exact per-variant coverage and the reviewed variant-to-image association", () => {
  const missing = eligibleCandidate();
  missing.evidenceBundle.decisions.variants.items.pop();
  assert.ok(inspect(missing).reasonCodes.includes("variant-evidence-coverage-incomplete"));

  const mismatch = eligibleCandidate();
  mismatch.evidenceBundle.decisions.variants.items[0].imageIds = ["image-sand"];
  assert.ok(inspect(mismatch).reasonCodes.includes("variant-image-association-mismatch"));

  const noImages = eligibleCandidate({
    variants: [
      {
        id: "variant-sage",
        name: "Sage Green",
        stock: 420,
        imageIds: [],
        sourceRefId: "src-variant-sage",
      },
    ],
  });
  assert.ok(inspect(noImages).reasonCodes.includes("variant-image-association-incomplete"));

  const badVariantSource = eligibleCandidate();
  badVariantSource.evidenceBundle.decisions.variants.items[0].sourceRefs = [
    "src-product",
    "src-image-sage",
  ];
  assert.ok(
    inspect(badVariantSource).reasonCodes.includes("missing-variant-association-source-reference"),
  );
});

test("requires explicit commercial, shipping, and duplicate decisions rather than booleans", () => {
  const commercial = eligibleCandidate();
  commercial.evidenceBundle.decisions.commercial.supplierCost = 99;
  assert.ok(inspect(commercial).reasonCodes.includes("commercial-evidence-candidate-mismatch"));

  const shipping = eligibleCandidate();
  shipping.evidenceBundle.decisions.shipping.destination = "CA";
  assert.ok(inspect(shipping).reasonCodes.includes("shipping-evidence-candidate-mismatch"));

  const duplicate = eligibleCandidate();
  duplicate.evidenceBundle.decisions.duplicate.scopes = ["dsers-my-products"];
  assert.ok(inspect(duplicate).reasonCodes.includes("duplicate-check-incomplete-or-matched"));

  const matched = eligibleCandidate();
  matched.evidenceBundle.decisions.duplicate.matchCount = 1;
  matched.evidenceBundle.decisions.duplicate.matches = ["supplier-bib-123"];
  assert.ok(inspect(matched).reasonCodes.includes("duplicate-check-incomplete-or-matched"));

  const missingDecision = eligibleCandidate();
  delete missingDecision.evidenceBundle.decisions.shipping;
  assert.ok(inspect(missingDecision).reasonCodes.includes("missing-shipping-decision"));

  const wrongDecision = eligibleCandidate();
  wrongDecision.evidenceBundle.decisions.commercial.decision = "clear";
  assert.ok(inspect(wrongDecision).reasonCodes.includes("unapproved-commercial-decision"));
});

test("retains readable-variant, image, duplicate, copy and supplier-risk checks", () => {
  const result = inspect(
    eligibleCandidate({
      primaryImageMatchesProduct: false,
      variantMappingClear: false,
      duplicateCheckComplete: false,
      supplierCopyAccurate: false,
      variants: [
        {
          ...eligibleCandidate().variants[0],
          name: "TK-0000007129",
          selectedOptions: [{ name: "Color", value: "TK-0000007129" }],
        },
        eligibleCandidate().variants[1],
      ],
    }),
  );
  assert.ok(result.reasonCodes.includes("primary-image-mismatch"));
  assert.ok(result.reasonCodes.includes("unclear-variant-image-mapping"));
  assert.ok(result.reasonCodes.includes("duplicate-check-failed"));
  assert.ok(result.reasonCodes.includes("misleading-supplier-copy"));
  assert.ok(result.reasonCodes.includes("code-only-variant-option"));
});

test("requires licensing evidence for flagged characters and certification evidence for chargers", () => {
  const licensed = inspect(
    eligibleCandidate({ containsLicensedCharacter: true, licensingEvidence: false }),
  );
  assert.ok(licensed.reasonCodes.includes("unlicensed-character-product"));
  const charger = inspect(
    eligibleCandidate({ title: "USB Wall Charger", certificationEvidence: false }),
  );
  assert.ok(charger.reasonCodes.includes("charger-certification-unclear"));
});

test("rejects incomplete or invalid qualification scores without inventing a pass threshold", () => {
  const missing = inspect(eligibleCandidate({ qualificationScores: {} }));
  assert.equal(missing.qualificationScore, null);
  assert.equal(missing.qualificationScoreComplete, false);
  assert.equal(missing.qualificationPassThreshold, null);
  assert.ok(missing.reasonCodes.includes("missing-score-evidenceQuality"));

  const invalid = inspect(
    eligibleCandidate({
      qualificationScores: { ...eligibleCandidate().qualificationScores, evidenceQuality: 31 },
    }),
  );
  assert.ok(invalid.reasonCodes.includes("invalid-score-evidenceQuality"));
});

test("CLI keeps boolean flags fail-closed and accepts structured candidate JSON or file", async () => {
  const script = fileURLToPath(new URL("./validate-dsers-product-candidate.mjs", import.meta.url));
  const booleansOnly = spawnSync(
    process.execPath,
    [
      script,
      "--title",
      "Silicone Baby Bib",
      "--stock",
      "420",
      "--images-usable",
      "true",
      "--primary-image-matches",
      "true",
      "--variant-mapping-clear",
      "true",
      "--duplicate-check-complete",
      "true",
      "--supplier-listing-status",
      "ready",
      "--supplier-error-code",
      "",
    ],
    { encoding: "utf8" },
  );
  assert.equal(booleansOnly.status, 1);
  assert.match(booleansOnly.stdout, /missing-structured-evidence-bundle/);
  const explicitListingFlags = JSON.parse(booleansOnly.stdout);
  assert.equal(explicitListingFlags.supplierListingDisposition, "hold");
  assert.ok(!explicitListingFlags.reasonCodes.includes("missing-supplier-listing-status"));
  assert.ok(!explicitListingFlags.reasonCodes.includes("missing-supplier-error-code"));

  const missingStatusFlags = spawnSync(
    process.execPath,
    [script, "--supplier-error-code", ""],
    { encoding: "utf8" },
  );
  assert.equal(missingStatusFlags.status, 1);
  assert.match(missingStatusFlags.stdout, /missing-supplier-listing-status/);
  assert.equal(JSON.parse(missingStatusFlags.stdout).supplierListingDisposition, "hold");

  const explicitStatusOnly = spawnSync(
    process.execPath,
    [script, "--supplier-listing-status", "ready"],
    { encoding: "utf8" },
  );
  assert.equal(explicitStatusOnly.status, 1);
  assert.match(explicitStatusOnly.stdout, /missing-supplier-error-code/);

  const nonReadyFlags = spawnSync(
    process.execPath,
    [script, "--supplier-listing-status", "pending", "--supplier-error-code", ""],
    { encoding: "utf8" },
  );
  assert.equal(nonReadyFlags.status, 1);
  assert.match(nonReadyFlags.stdout, /supplier-listing-not-ready/);

  const badJson = spawnSync(process.execPath, [script, "--candidate-json", "{broken"], {
    encoding: "utf8",
  });
  assert.equal(badJson.status, 2);
  assert.match(badJson.stderr, /valid JSON/);

  const candidate = eligibleCandidate();
  const structuredJson = spawnSync(
    process.execPath,
    [
      script,
      "--candidate-json",
      JSON.stringify({ candidate, evidenceBundle: candidate.evidenceBundle }),
    ],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );
  assert.equal(structuredJson.status, 0, structuredJson.stdout + structuredJson.stderr);
  assert.equal(JSON.parse(structuredJson.stdout).allowed, true);

  const directory = await mkdtemp(join(tmpdir(), "future-light-dsers-candidate-"));
  try {
    const candidateFile = join(directory, "candidate.json");
    await writeFile(candidateFile, JSON.stringify({ candidate, evidenceBundle: candidate.evidenceBundle }), "utf8");
    const structuredFile = spawnSync(process.execPath, [script, "--candidate-file", candidateFile], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    assert.equal(structuredFile.status, 0, structuredFile.stdout + structuredFile.stderr);
    assert.equal(JSON.parse(structuredFile.stdout).allowed, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
