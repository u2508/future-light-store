import { describe, expect, it } from "vitest";

import { assignVariantImages } from "./shopify-variant-image-mapping.mjs";

describe("variant image global assignment", () => {
  it("does not reuse a strong backpack match for distinct variants", () => {
    const variants = [
      { id: 1, title: "Backpack" },
      { id: 2, title: "Lunch box" },
      { id: 3, title: "Pencil case" },
    ];
    const images = [
      { id: "backpack-image", url: "https://cdn.test/backpack.webp", altText: "Backpack" },
      { id: "lunch-image", url: "https://cdn.test/lunch-box.webp", altText: "Lunch box" },
      { id: "pencil-image", url: "https://cdn.test/pencil-case.webp", altText: "Pencil case" },
    ];

    const assignments = assignVariantImages(variants, images, { variants }, null, true);

    expect([0, 1, 2].map((index) => assignments.get(index)?.mediaId)).toEqual([
      "backpack-image",
      "lunch-image",
      "pencil-image",
    ]);
    expect(new Set([...assignments.values()].map((entry) => entry.mediaId)).size).toBe(3);
  });

  it("keeps deterministic title evidence ahead of a conflicting vision mapping", () => {
    const variants = [
      { id: 1, title: "Lunch box" },
      { id: 2, title: "Bottle" },
    ];
    const images = [
      { id: "lunch-image", url: "https://cdn.test/lunch-box.webp", altText: "Lunch box" },
      { id: "bottle-image", url: "https://cdn.test/bottle.webp", altText: "Bottle" },
    ];

    const assignments = assignVariantImages(
      variants,
      images,
      { variants },
      { mappings: [{ variantIndex: 0, imageIndex: 1, confidence: 99, rationale: "conflicting model output" }] },
      true,
    );

    expect(assignments.get(0)?.mediaId).toBe("lunch-image");
    expect(assignments.get(0)?.reason).toBe("multi-signal-match");
  });

  it("does not publish a guess when guessing is disabled and evidence is absent", () => {
    const assignments = assignVariantImages(
      [{ id: 1, title: "One" }, { id: 2, title: "Two" }],
      [
        { id: "image-a", url: "https://cdn.test/a.webp", altText: "product photo" },
        { id: "image-b", url: "https://cdn.test/b.webp", altText: "another photo" },
      ],
      { variants: [] },
      null,
      false,
    );

    expect(assignments.size).toBe(0);
  });
});
