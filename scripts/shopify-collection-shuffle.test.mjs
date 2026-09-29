import test from "node:test";
import assert from "node:assert/strict";
import {
  COLLECTION_SHUFFLE_EXCLUDED_HANDLES,
  shouldShuffleCollection,
} from "../src/lib/shopify-collection-shuffle.js";

test("daily shuffle preserves merchandising collections' intentional order", () => {
  assert.equal(shouldShuffleCollection("new-arrivals"), false);
  assert.equal(shouldShuffleCollection("best-sellers"), false);
  assert.equal(shouldShuffleCollection("all-products"), false);
  assert.deepEqual([...COLLECTION_SHUFFLE_EXCLUDED_HANDLES].sort(), [
    "all-products",
    "best-sellers",
    "new-arrivals",
  ]);
});

test("ordinary category collections remain eligible for deterministic shuffle", () => {
  assert.equal(shouldShuffleCollection("jewelry-accessories"), true);
  assert.equal(shouldShuffleCollection("  PET-GROOMING  "), true);
});
