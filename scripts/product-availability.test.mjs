import test from "node:test";
import assert from "node:assert/strict";
import {
  getProductAvailability,
  isProductExplicitlyAvailable,
} from "../src/lib/product-availability.mjs";

test("explicit product availability wins even when the sampled option is sold out", () => {
  const product = {
    availableForSale: true,
    variants: { edges: [{ node: { availableForSale: false } }] },
  };
  assert.equal(getProductAvailability(product), "available");
  assert.equal(isProductExplicitlyAvailable(product), true);
});

test("an explicitly available variant can make a product purchasable", () => {
  const product = {
    availableForSale: false,
    variants: { edges: [{ node: { availableForSale: true } }] },
  };
  assert.equal(getProductAvailability(product), "available");
});

test("only explicit sold-out evidence is labelled unavailable", () => {
  assert.equal(
    getProductAvailability({
      availableForSale: false,
      variants: { edges: [{ node: { availableForSale: false } }] },
    }),
    "unavailable",
  );
});

test("missing or partial Shopify availability fails closed as unknown", () => {
  assert.equal(getProductAvailability({}), "unknown");
  assert.equal(
    getProductAvailability({
      variants: { edges: [{ node: { availableForSale: null } }] },
    }),
    "unknown",
  );
  assert.equal(isProductExplicitlyAvailable(undefined), false);
});
