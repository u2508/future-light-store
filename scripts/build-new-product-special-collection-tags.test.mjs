import test from "node:test";
import assert from "node:assert/strict";

import { buildSpecialCollectionAssignments } from "./build-new-product-special-collection-tags.mjs";

test("keeps cosplay-themed beauty products out of Anime Collectables", () => {
  const assignments = buildSpecialCollectionAssignments([
    {
      handle: "face-and-body-makeup-cosplay-palette",
      title: "Face and Body Makeup Palette for Cosplay Looks",
      product_type: "makeup palette",
    },
  ]);

  assert.deepEqual(assignments, []);
});

test("keeps explicit anime collectible merchandise eligible", () => {
  const assignments = buildSpecialCollectionAssignments([
    {
      handle: "naruto-pvc-anime-figure",
      title: "Naruto PVC Anime Figure Collectible",
      product_type: "collectible figure",
    },
  ]);

  assert.deepEqual(assignments[0]?.matchedCollections, ["anime-collectables"]);
});
