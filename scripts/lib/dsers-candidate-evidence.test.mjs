import test from "node:test";
import assert from "node:assert/strict";
import {
  computeDsersCandidateFingerprint,
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
    sourceReferences: [
      {
        id: "product-source",
        kind: "product",
        reference: "https://supplier.example/p/1",
        sha256: digest("a"),
        observedAt: NOW,
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
    schemaVersion: 1,
    policyVersion: POLICY,
    candidateFingerprint: computeDsersCandidateFingerprint(candidate, POLICY),
    reviewedAt: NOW,
    reviewer: { id: "reviewer-1", displayName: "Catalog reviewer", role: "human-reviewer" },
    sources: candidate.sourceReferences,
    decisions: {
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

test("candidate fingerprint is deterministic and binds commercial, image, and variant facts", () => {
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
    computeDsersCandidateFingerprint(
      {
        ...candidate,
        variants: [{ ...candidate.variants[0], imageIds: [] }],
      },
      POLICY,
    ),
  );
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
