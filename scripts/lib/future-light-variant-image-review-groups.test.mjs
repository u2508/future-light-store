import test from "node:test";
import assert from "node:assert/strict";

import {
  buildVariantImageReviewGroups,
  findVariantImageMappingConflicts,
  findVariantImageReviewGroup,
} from "./future-light-variant-image-review-groups.mjs";
import {
  createVariantImageAssignment,
  validateVariantImageAssignments,
} from "./future-light-variant-image-approvals.mjs";

function variant(id, color, size, mediaIds = []) {
  return {
    variantId: `gid://shopify/ProductVariant/${id}`,
    selectedOptions: [
      { name: "Color", value: color },
      { name: "Size", value: size },
    ],
    expectedCurrentMediaIds: mediaIds,
  };
}

test("groups size variants only when appearance values and current media evidence match", () => {
  const entry = {
    variants: [
      variant(1, "Navy", "Small", ["gid://shopify/MediaImage/10"]),
      variant(2, "Navy", "Large", ["gid://shopify/MediaImage/10"]),
      variant(3, "Gray", "Small", ["gid://shopify/MediaImage/11"]),
    ],
  };

  const groups = buildVariantImageReviewGroups(entry);
  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups[0].variants.map((item) => item.variantId),
    ["gid://shopify/ProductVariant/1", "gid://shopify/ProductVariant/2"],
  );
  assert.deepEqual(groups[0].visualOptionValues, [{ name: "color", value: "Navy" }]);
  assert.deepEqual(findVariantImageReviewGroup(entry, "gid://shopify/ProductVariant/2"), groups[0]);

  const queueEntry = {
    ...entry,
    variants: groups[0].variants,
    productId: "gid://shopify/Product/50",
    handle: "navy-bag",
    media: [{ id: "gid://shopify/MediaImage/20", url: "https://cdn.shopify.com/navy.jpg" }],
  };
  const queue = {
    queueFingerprint: "f".repeat(64),
    variantEntries: [queueEntry],
  };
  const assignments = groups[0].variants.map((item) =>
    createVariantImageAssignment(queue, {
      product: { productId: queueEntry.productId, handle: queueEntry.handle },
      variant: { variantId: item.variantId },
      mediaId: "gid://shopify/MediaImage/20",
      reviewNote:
        "Visually compared this navy option with the numbered gallery; both listed sizes are the same product appearance.",
    }),
  );
  assert.deepEqual(validateVariantImageAssignments(queue, assignments), []);
  assert.deepEqual(
    assignments.map((assignment) => assignment.expectedCurrentMediaIds),
    [["gid://shopify/MediaImage/10"], ["gid://shopify/MediaImage/10"]],
  );
});

test("splits equal appearance values when current Shopify image evidence conflicts", () => {
  const groups = buildVariantImageReviewGroups({
    variants: [
      variant(1, "Black", "Small", ["gid://shopify/MediaImage/10"]),
      variant(2, "Black", "Large", ["gid://shopify/MediaImage/11"]),
    ],
  });

  assert.equal(groups.length, 2);
  assert.ok(groups.every((group) => group.variants.length === 1));
});

test("never groups variants if the product has no appearance option or evidence is incomplete", () => {
  const noAppearance = buildVariantImageReviewGroups({
    variants: [
      {
        variantId: "v1",
        selectedOptions: [{ name: "Size", value: "Small" }],
        expectedCurrentMediaIds: [],
      },
      {
        variantId: "v2",
        selectedOptions: [{ name: "Size", value: "Large" }],
        expectedCurrentMediaIds: [],
      },
    ],
  });
  const incomplete = buildVariantImageReviewGroups({
    variants: [
      variant(3, "Black", "Small"),
      {
        variantId: "v4",
        selectedOptions: [{ name: "Size", value: "Large" }],
        expectedCurrentMediaIds: [],
      },
    ],
  });

  assert.equal(noAppearance.length, 2);
  assert.equal(incomplete.length, 2);
  assert.ok(noAppearance.every((group) => group.reviewBasis.startsWith("variant-specific")));
});

test("keeps distinct color and pattern combinations separate and preserves exact values", () => {
  const groups = buildVariantImageReviewGroups({
    variants: [
      {
        variantId: "v1",
        selectedOptions: [
          { name: "Color", value: "Blue" },
          { name: "Pattern", value: "Floral" },
          { name: "Size", value: "S" },
        ],
        expectedCurrentMediaIds: [],
      },
      {
        variantId: "v2",
        selectedOptions: [
          { name: "Color", value: "Blue" },
          { name: "Pattern", value: "Stripe" },
          { name: "Size", value: "S" },
        ],
        expectedCurrentMediaIds: [],
      },
    ],
  });

  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].visualOptionValues, [
    { name: "color", value: "Blue" },
    { name: "pattern", value: "Floral" },
  ]);
});

test("treats Band Color as visual evidence but keeps Band Width out of image grouping", () => {
  const entry = {
    variants: [
      {
        variantId: "v1",
        selectedOptions: [
          { name: "Band Color", value: "Black Silver" },
          { name: "Band Width", value: "18mm" },
        ],
        expectedCurrentMediaIds: ["gid://shopify/MediaImage/10"],
      },
      {
        variantId: "v2",
        selectedOptions: [
          { name: "Band Color", value: "Black Silver" },
          { name: "Band Width", value: "20mm" },
        ],
        expectedCurrentMediaIds: ["gid://shopify/MediaImage/10"],
      },
      {
        variantId: "v3",
        selectedOptions: [
          { name: "Band Color", value: "Brown Silver" },
          { name: "Band Width", value: "18mm" },
        ],
        expectedCurrentMediaIds: ["gid://shopify/MediaImage/11"],
      },
    ],
  };

  const groups = buildVariantImageReviewGroups(entry);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].visualOptionValues, [{ name: "band color", value: "Black Silver" }]);
  assert.deepEqual(
    groups[0].variants.map((item) => item.variantId),
    ["v1", "v2"],
  );
  assert.deepEqual(
    findVariantImageMappingConflicts({
      variants: [
        {
          ...entry.variants[0],
          currentMedia: [{ id: "gid://shopify/MediaImage/10" }],
        },
        {
          ...entry.variants[1],
          currentMedia: [{ id: "gid://shopify/MediaImage/12" }],
        },
      ],
    }),
    ["band color: black silver currently points to 2 different media assets"],
  );
});

test("does not call logistics or customization option values image-mapping conflicts", () => {
  const conflicts = findVariantImageMappingConflicts({
    variants: [
      {
        selectedOptions: [
          { name: "Color", value: "black fluorescent" },
          { name: "Is Customized", value: "Yes" },
          { name: "Ships From", value: "China Mainland" },
        ],
        currentMedia: [{ id: "gid://shopify/MediaImage/1" }],
      },
      {
        selectedOptions: [
          { name: "Color", value: "black fluorescent" },
          { name: "Is Customized", value: "Yes" },
          { name: "Ships From", value: "China Mainland" },
        ],
        currentMedia: [{ id: "gid://shopify/MediaImage/2" }],
      },
    ],
  });

  assert.deepEqual(conflicts, [
    "color: black fluorescent currently points to 2 different media assets",
  ]);
});
