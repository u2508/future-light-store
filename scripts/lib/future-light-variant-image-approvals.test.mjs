import assert from "node:assert/strict";
import test from "node:test";

import {
  createVariantImageAssignment,
  validateVariantImageAssignments,
} from "./future-light-variant-image-approvals.mjs";

function queue({ currentMediaIds = ["gid://shopify/MediaImage/12"] } = {}) {
  return {
    queueFingerprint: "a".repeat(64),
    variantEntries: [
      {
        productId: "gid://shopify/Product/10",
        handle: "travel-bag",
        media: [
          { id: "gid://shopify/MediaImage/12", url: "https://cdn.example.test/navy.jpg" },
          { id: "gid://shopify/MediaImage/13", url: "https://cdn.example.test/black.jpg" },
        ],
        variants: [
          {
            variantId: "gid://shopify/ProductVariant/20",
            title: "Navy",
            selectedOptions: [{ name: "Color", value: "Navy" }],
            expectedCurrentMediaIds: currentMediaIds,
          },
        ],
      },
    ],
  };
}

function validDecision(source = queue()) {
  return createVariantImageAssignment(source, {
    product: { productId: "gid://shopify/Product/10", handle: "travel-bag" },
    variant: { variantId: "gid://shopify/ProductVariant/20" },
    mediaId: "gid://shopify/MediaImage/13",
    reviewNote:
      "The navy textile and hardware match the selected Navy option; the black candidate is visibly a different color.",
  });
}

test("creates a product-bound mapping with exact variant options and live preimage", () => {
  const source = queue();
  const decision = validDecision(source);

  assert.equal(decision.productId, source.variantEntries[0].productId);
  assert.equal(decision.variantId, source.variantEntries[0].variants[0].variantId);
  assert.equal(decision.mediaId, "gid://shopify/MediaImage/13");
  assert.deepEqual(decision.expectedCurrentMediaIds, ["gid://shopify/MediaImage/12"]);
  assert.equal(validateVariantImageAssignments(source, [decision]).length, 0);
});

test("refuses a candidate outside the exact product gallery", () => {
  const source = queue();
  assert.throws(
    () =>
      createVariantImageAssignment(source, {
        product: { productId: "gid://shopify/Product/10", handle: "travel-bag" },
        variant: { variantId: "gid://shopify/ProductVariant/20" },
        mediaId: "gid://shopify/MediaImage/999",
        reviewNote:
          "This image shows the correct product and selected color, compared with the complete gallery.",
      }),
    /not part of this exact Shopify product gallery/,
  );
});

test("invalidates a visually reviewed assignment when the current media preimage changes", () => {
  const source = queue();
  const decision = validDecision(source);
  source.variantEntries[0].variants[0].expectedCurrentMediaIds = [];

  assert.ok(
    validateVariantImageAssignments(source, [decision]).some((failure) =>
      failure.includes("exact preimage was not recorded"),
    ),
  );
});

test("requires one decision per variant and rejects duplicate or stale decisions", () => {
  const source = queue();
  const decision = validDecision(source);
  const failures = validateVariantImageAssignments(source, [
    decision,
    { ...decision },
    { ...decision, variantId: "gid://shopify/ProductVariant/999" },
  ]);

  assert.ok(failures.some((failure) => failure.includes("duplicate reviewed image mappings")));
  assert.ok(failures.some((failure) => failure.includes("unknown or stale Shopify variant")));
  assert.ok(
    validateVariantImageAssignments(source, []).some((failure) =>
      failure.includes("missing reviewed image mapping"),
    ),
  );
});

test("records no-image decisions only for variants that have no current association", () => {
  const source = queue({ currentMediaIds: [] });
  const decision = createVariantImageAssignment(source, {
    product: { productId: "gid://shopify/Product/10", handle: "travel-bag" },
    variant: { variantId: "gid://shopify/ProductVariant/20" },
    mediaId: null,
    reviewNote:
      "This size-only variant shares the product's gallery and currently has no separate image association.",
  });
  assert.equal(decision.decision, "approved-no-image-required");
  assert.equal(validateVariantImageAssignments(source, [decision]).length, 0);

  const mappedSource = queue();
  assert.throws(
    () =>
      createVariantImageAssignment(mappedSource, {
        product: { productId: "gid://shopify/Product/10", handle: "travel-bag" },
        variant: { variantId: "gid://shopify/ProductVariant/20" },
        mediaId: null,
        reviewNote:
          "This image decision is rejected because a current mapping would otherwise be silently removed.",
      }),
    /currently has an image association/,
  );
});
