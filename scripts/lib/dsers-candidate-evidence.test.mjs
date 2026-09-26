import test from "node:test";
import assert from "node:assert/strict";
import {
  computeDsersCandidateFingerprint,
  DSERS_EVIDENCE_SCHEMA_VERSION,
  validateDsersEvidenceBundle,
} from "./dsers-candidate-evidence.mjs";

const NOW = "2026-09-24T10:00:00.000Z";
const POLICY = "test-policy-1";
const digest = (character) => character.repeat(64);

function fixture() {
  const candidate = {
    supplierProductId: "supplier-product-1",
    title: "Passive Desk Phone Stand",
    description: "Adjustable non-powered stand.",
    searchFamily: "Safe electronics accessories",
    searchTerm: "phone stand desk",
    collectionLane: "Safe electronics accessories",
    supplierStock: 250,
    supplierCost: 4,
    proposedUsPrice: 35,
    shippingCost: 3,
    currency: "USD",
    shippingDestination: "US",
    shippingMethod: "Tracked parcel",
    supplierListingStatus: "ready",
    supplierErrorCode: "",
    sourceReferences: [
      {
        id: "product-source",
        kind: "product",
        reference: "https://supplier.example/p/1",
        sha256: digest("a"),
        observedAt: NOW,
      },
      {
        id: "supplier-listing-source",
        kind: "supplier-listing",
        reference: "https://supplier.example/p/1#listing-status",
        sha256: digest("9"),
        observedAt: NOW,
        capture: { supplierListingStatus: "ready", supplierErrorCode: "" },
      },
      {
        id: "image-source",
        kind: "image",
        reference: "https://supplier.example/p/1.jpg",
        sha256: digest("b"),
        observedAt: NOW,
      },
      {
        id: "variant-source",
        kind: "variant",
        reference: "https://supplier.example/p/1#black",
        sha256: digest("c"),
        observedAt: NOW,
      },
      {
        id: "inventory-source",
        kind: "inventory",
        reference: "https://supplier.example/p/1#variant-inventory",
        sha256: digest("7"),
        observedAt: NOW,
      },
      {
        id: "commercial-source",
        kind: "commercial",
        reference: "https://supplier.example/p/1#price",
        sha256: digest("d"),
        observedAt: NOW,
      },
      {
        id: "shipping-source",
        kind: "shipping",
        reference: "https://supplier.example/p/1#shipping",
        sha256: digest("e"),
        observedAt: NOW,
      },
      {
        id: "duplicate-source",
        kind: "duplicate",
        reference: "sha256:catalog-search-snapshot",
        sha256: digest("f"),
        observedAt: NOW,
      },
    ],
    images: [{ id: "image-1", sha256: digest("b"), sourceRefId: "image-source" }],
    variants: [
      {
        id: "variant-1",
        sku: "stand-black",
        selectedOptions: [{ name: "Color", value: "Black" }],
        stock: 250,
        inventoryEvidence: { quantity: 250, sourceRefId: "inventory-source" },
        imageIds: ["image-1"],
        sourceRefId: "variant-source",
      },
    ],
  };
  const reviewed = (rationale, sourceRefs, extra = {}) => ({
    decision: "approve",
    rationale,
    sourceRefs,
    reviewedAt: NOW,
    ...extra,
  });
  const bundle = {
    schemaVersion: DSERS_EVIDENCE_SCHEMA_VERSION,
    policyVersion: POLICY,
    candidateFingerprint: computeDsersCandidateFingerprint(candidate, POLICY),
    reviewedAt: NOW,
    reviewer: { id: "reviewer-1", displayName: "Catalog reviewer", role: "human-reviewer" },
    sources: candidate.sourceReferences,
    decisions: {
      supplierListing: reviewed("Supplier listing is currently ready with no supplier error.", ["supplier-listing-source"], {
        supplierListingStatus: candidate.supplierListingStatus,
        supplierErrorCode: candidate.supplierErrorCode,
      }),
      product: reviewed("Verified the complete sellable item.", ["product-source"], {
        productId: candidate.supplierProductId,
        title: candidate.title,
      }),
      images: reviewed("Reviewed every product image.", ["image-source"], {
        items: [
          {
            imageId: "image-1",
            productId: candidate.supplierProductId,
            sha256: digest("b"),
            decision: "approve",
            rationale: "Image clearly matches the desk stand.",
            sourceRefs: ["image-source"],
          },
        ],
      }),
      variants: reviewed("Matched each variant to its image.", ["variant-source", "image-source"], {
        items: [
          {
            variantId: "variant-1",
            decision: "approve",
            imageIds: ["image-1"],
            rationale: "Black option corresponds to the shown stand.",
            sourceRefs: ["variant-source", "image-source"],
          },
        ],
      }),
      inventory: reviewed("Matched the stock count to the exact sellable option.", ["inventory-source"], {
        items: [
          {
            variantId: "variant-1",
            quantity: 250,
            sourceRefId: "inventory-source",
            decision: "approve",
            rationale: "Supplier inventory row identifies the black stand option.",
            sourceRefs: ["inventory-source"],
          },
        ],
      }),
      commercial: reviewed("Verified supplier cost and proposed US price.", ["commercial-source"], {
        supplierCost: 4,
        proposedUsPrice: 35,
        shippingCost: 3,
        currency: "USD",
        costStability: "stable",
      }),
      shipping: reviewed("Verified US delivery service and shipping cost.", ["shipping-source"], {
        destination: "US",
        method: "Tracked parcel",
        shippingCost: 3,
      }),
      duplicate: {
        ...reviewed("Searched both catalogs; no duplicate found.", ["duplicate-source"], {
          decision: "clear",
        }),
        checkedAt: NOW,
        scopes: ["dsers-my-products", "shopify-active-catalog"],
        matchCount: 0,
        matches: [],
      },
    },
  };
  return { candidate, bundle };
}

test("candidate fingerprint is deterministic and binds supplier listing, commercial, image, variant, and inventory facts", () => {
  const { candidate } = fixture();
  const same = {
    ...candidate,
    images: candidate.images.map((item) => ({
      sourceRefId: item.sourceRefId,
      sha256: item.sha256,
      id: item.id,
    })),
  };
  assert.equal(
    computeDsersCandidateFingerprint(candidate, POLICY),
    computeDsersCandidateFingerprint(same, POLICY),
  );
  assert.notEqual(
    computeDsersCandidateFingerprint(candidate, POLICY),
    computeDsersCandidateFingerprint({ ...candidate, supplierCost: 5 }, POLICY),
  );
  assert.notEqual(
    computeDsersCandidateFingerprint(candidate, POLICY),
    computeDsersCandidateFingerprint({ ...candidate, supplierListingStatus: "paused" }, POLICY),
  );
  assert.notEqual(
    computeDsersCandidateFingerprint(candidate, POLICY),
    computeDsersCandidateFingerprint({ ...candidate, supplierErrorCode: "OUT_OF_STOCK" }, POLICY),
  );
  assert.notEqual(
    computeDsersCandidateFingerprint(candidate, POLICY),
    computeDsersCandidateFingerprint(
      {
        ...candidate,
        variants: [{ ...candidate.variants[0], imageIds: [] }],
      },
      POLICY,
    ),
  );
  assert.notEqual(
    computeDsersCandidateFingerprint(candidate, POLICY),
    computeDsersCandidateFingerprint(
      {
        ...candidate,
        variants: candidate.variants.map((variant) => ({
          ...variant,
          inventoryEvidence: { ...variant.inventoryEvidence, quantity: 249 },
        })),
      },
      POLICY,
    ),
  );
});

test("requires exact, fresh source-linked inventory evidence for every sellable option", () => {
  const { candidate, bundle } = fixture();

  const legacySchema = structuredClone(bundle);
  legacySchema.schemaVersion = 1;
  assert.ok(
    validateDsersEvidenceBundle(candidate, legacySchema, {
      now: Date.parse(NOW),
      policyVersion: POLICY,
    }).reasonCodes.includes("unsupported-evidence-schema"),
  );

  const missing = structuredClone(bundle);
  delete missing.decisions.inventory;
  assert.ok(
    validateDsersEvidenceBundle(candidate, missing, {
      now: Date.parse(NOW),
      policyVersion: POLICY,
    }).reasonCodes.includes("missing-inventory-decision"),
  );

  const uncovered = structuredClone(bundle);
  uncovered.decisions.inventory.items = [];
  assert.ok(
    validateDsersEvidenceBundle(candidate, uncovered, {
      now: Date.parse(NOW),
      policyVersion: POLICY,
    }).reasonCodes.includes("inventory-evidence-coverage-incomplete"),
  );

  const wrongQuantity = structuredClone(bundle);
  wrongQuantity.decisions.inventory.items[0].quantity = 249;
  assert.ok(
    validateDsersEvidenceBundle(candidate, wrongQuantity, {
      now: Date.parse(NOW),
      policyVersion: POLICY,
    }).reasonCodes.includes("inventory-quantity-mismatch"),
  );

  const unboundQuantity = structuredClone(candidate);
  unboundQuantity.variants[0].inventoryEvidence.quantity = 249;
  const unboundBundle = structuredClone(bundle);
  unboundBundle.candidateFingerprint = computeDsersCandidateFingerprint(unboundQuantity, POLICY);
  assert.ok(
    validateDsersEvidenceBundle(unboundQuantity, unboundBundle, {
      now: Date.parse(NOW),
      policyVersion: POLICY,
    }).reasonCodes.includes("variant-stock-inventory-evidence-mismatch"),
  );

  const wrongSource = structuredClone(bundle);
  wrongSource.decisions.inventory.items[0].sourceRefId = "variant-source";
  wrongSource.decisions.inventory.items[0].sourceRefs = ["variant-source"];
  assert.ok(
    validateDsersEvidenceBundle(candidate, wrongSource, {
      now: Date.parse(NOW),
      policyVersion: POLICY,
    }).reasonCodes.includes("inventory-source-reference-mismatch"),
  );

  const staleCandidate = structuredClone(candidate);
  staleCandidate.sourceReferences = staleCandidate.sourceReferences.map((source) =>
    source.id === "inventory-source"
      ? { ...source, observedAt: "2026-09-22T00:00:00.000Z" }
      : source,
  );
  const staleBundle = structuredClone(bundle);
  staleBundle.sources = staleCandidate.sourceReferences;
  staleBundle.candidateFingerprint = computeDsersCandidateFingerprint(staleCandidate, POLICY);
  assert.ok(
    validateDsersEvidenceBundle(staleCandidate, staleBundle, {
      now: Date.parse(NOW),
      policyVersion: POLICY,
    }).reasonCodes.includes("stale-source-evidence"),
  );
});

test("requires explicit ready listing status and an explicitly empty supplier error code", () => {
  const { candidate, bundle } = fixture();
  const missingStatus = structuredClone(candidate);
  delete missingStatus.supplierListingStatus;
  const missingStatusBundle = structuredClone(bundle);
  missingStatusBundle.candidateFingerprint = computeDsersCandidateFingerprint(missingStatus, POLICY);
  assert.ok(validateDsersEvidenceBundle(missingStatus, missingStatusBundle, {
    now: Date.parse(NOW), policyVersion: POLICY,
  }).reasonCodes.includes("missing-supplier-listing-status"));

  const missingError = structuredClone(candidate);
  delete missingError.supplierErrorCode;
  const missingErrorBundle = structuredClone(bundle);
  missingErrorBundle.candidateFingerprint = computeDsersCandidateFingerprint(missingError, POLICY);
  assert.ok(validateDsersEvidenceBundle(missingError, missingErrorBundle, {
    now: Date.parse(NOW), policyVersion: POLICY,
  }).reasonCodes.includes("missing-supplier-error-code"));

  const nonReady = structuredClone(candidate);
  nonReady.supplierListingStatus = "paused";
  const nonReadyBundle = structuredClone(bundle);
  nonReadyBundle.candidateFingerprint = computeDsersCandidateFingerprint(nonReady, POLICY);
  assert.ok(validateDsersEvidenceBundle(nonReady, nonReadyBundle, {
    now: Date.parse(NOW), policyVersion: POLICY,
  }).reasonCodes.includes("supplier-listing-not-ready"));

  const supplierError = structuredClone(candidate);
  supplierError.supplierErrorCode = "SUPPLIER_REVIEW_REQUIRED";
  const supplierErrorBundle = structuredClone(bundle);
  supplierErrorBundle.candidateFingerprint = computeDsersCandidateFingerprint(supplierError, POLICY);
  assert.ok(validateDsersEvidenceBundle(supplierError, supplierErrorBundle, {
    now: Date.parse(NOW), policyVersion: POLICY,
  }).reasonCodes.includes("supplier-error-code-present"));
});

test("requires a fresh matching supplier-listing capture and decision", () => {
  const { candidate, bundle } = fixture();

  const missingCapture = structuredClone(bundle);
  missingCapture.decisions.supplierListing.sourceRefs = [];
  assert.ok(validateDsersEvidenceBundle(candidate, missingCapture, {
    now: Date.parse(NOW), policyVersion: POLICY,
  }).reasonCodes.includes("missing-supplier-listing-capture"));

  const missingCaptureSource = structuredClone(bundle);
  missingCaptureSource.sources = missingCaptureSource.sources.filter(
    (source) => source.kind !== "supplier-listing",
  );
  assert.ok(validateDsersEvidenceBundle(candidate, missingCaptureSource, {
    now: Date.parse(NOW), policyVersion: POLICY,
  }).reasonCodes.includes("missing-supplier-listing-capture"));

  const missingDecision = structuredClone(bundle);
  delete missingDecision.decisions.supplierListing;
  assert.ok(validateDsersEvidenceBundle(candidate, missingDecision, {
    now: Date.parse(NOW), policyVersion: POLICY,
  }).reasonCodes.includes("missing-supplier-listing-decision"));

  const mismatchedCapture = structuredClone(bundle);
  mismatchedCapture.sources[1].capture.supplierListingStatus = "paused";
  mismatchedCapture.candidateFingerprint = computeDsersCandidateFingerprint(candidate, POLICY);
  assert.ok(validateDsersEvidenceBundle(candidate, mismatchedCapture, {
    now: Date.parse(NOW), policyVersion: POLICY,
  }).reasonCodes.includes("supplier-listing-capture-candidate-mismatch"));

  const mismatchedDecision = structuredClone(bundle);
  mismatchedDecision.decisions.supplierListing.supplierErrorCode = "TEMP_ERROR";
  assert.ok(validateDsersEvidenceBundle(candidate, mismatchedDecision, {
    now: Date.parse(NOW), policyVersion: POLICY,
  }).reasonCodes.includes("supplier-listing-evidence-candidate-mismatch"));

  const candidateFieldChanged = structuredClone(candidate);
  candidateFieldChanged.supplierListingStatus = "pending";
  assert.ok(validateDsersEvidenceBundle(candidateFieldChanged, bundle, {
    now: Date.parse(NOW), policyVersion: POLICY,
  }).reasonCodes.includes("candidate-fingerprint-mismatch"));

  const staleCapture = structuredClone(bundle);
  staleCapture.sources[1].observedAt = "2026-09-22T00:00:00.000Z";
  assert.ok(validateDsersEvidenceBundle(candidate, staleCapture, {
    now: Date.parse(NOW), policyVersion: POLICY,
  }).reasonCodes.includes("stale-supplier-listing-capture"));

  const staleDecision = structuredClone(bundle);
  staleDecision.decisions.supplierListing.reviewedAt = "2026-09-22T00:00:00.000Z";
  assert.ok(validateDsersEvidenceBundle(candidate, staleDecision, {
    now: Date.parse(NOW), policyVersion: POLICY,
  }).reasonCodes.includes("stale-supplier-listing-decision"));

  const oldSchema = structuredClone(bundle);
  oldSchema.schemaVersion = 2;
  assert.ok(validateDsersEvidenceBundle(candidate, oldSchema, {
    now: Date.parse(NOW), policyVersion: POLICY,
  }).reasonCodes.includes("unsupported-evidence-schema"));
});

test("complete fresh bundle validates, while stale, mismatched and uncovered evidence fails closed", () => {
  const { candidate, bundle } = fixture();
  assert.deepEqual(
    validateDsersEvidenceBundle(candidate, bundle, { now: Date.parse(NOW), policyVersion: POLICY })
      .reasonCodes,
    [],
  );

  const stale = structuredClone(bundle);
  stale.reviewedAt = "2026-09-22T10:00:00.000Z";
  assert.ok(
    validateDsersEvidenceBundle(candidate, stale, {
      now: Date.parse(NOW),
      policyVersion: POLICY,
    }).reasonCodes.includes("stale-or-invalid-review-timestamp"),
  );

  const mismatch = structuredClone(bundle);
  mismatch.candidateFingerprint = "sha256:" + "0".repeat(64);
  assert.ok(
    validateDsersEvidenceBundle(candidate, mismatch, {
      now: Date.parse(NOW),
      policyVersion: POLICY,
    }).reasonCodes.includes("candidate-fingerprint-mismatch"),
  );

  const uncovered = structuredClone(bundle);
  uncovered.decisions.variants.items[0].imageIds = [];
  assert.ok(
    validateDsersEvidenceBundle(candidate, uncovered, {
      now: Date.parse(NOW),
      policyVersion: POLICY,
    }).reasonCodes.includes("variant-image-association-mismatch"),
  );

  assert.ok(
    validateDsersEvidenceBundle(candidate, bundle, {
      now: "not-a-clock",
      policyVersion: POLICY,
    }).reasonCodes.includes("invalid-evidence-validation-time"),
  );

  const decisionWithoutTimestamp = structuredClone(bundle);
  delete decisionWithoutTimestamp.decisions.product.reviewedAt;
  assert.ok(
    validateDsersEvidenceBundle(candidate, decisionWithoutTimestamp, {
      now: Date.parse(NOW),
      policyVersion: POLICY,
    }).reasonCodes.includes("stale-product-decision"),
  );
});
