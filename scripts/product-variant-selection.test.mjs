import test from "node:test";
import assert from "node:assert/strict";
import { chooseProductVariantId } from "../src/lib/product-variant-selection.mjs";

const variants = [
  { id: "gid://shopify/ProductVariant/101", availableForSale: true },
  { id: "gid://shopify/ProductVariant/202", availableForSale: true },
  { id: "gid://shopify/ProductVariant/303", availableForSale: false },
];

test("feed variant overrides an already-selected valid default variant", () => {
  assert.equal(
    chooseProductVariantId({
      variants,
      requestedVariant: "202",
      currentId: variants[0].id,
    }),
    variants[1].id,
  );
});

test("feed variant accepts Shopify GID query values and preserves unavailable offers", () => {
  assert.equal(
    chooseProductVariantId({
      variants,
      requestedVariant: variants[2].id,
      currentId: variants[0].id,
    }),
    variants[2].id,
  );
});

test("a shopper's explicit selection is preserved during revalidation", () => {
  assert.equal(
    chooseProductVariantId({
      variants,
      requestedVariant: "101",
      currentId: variants[1].id,
      userSelected: true,
    }),
    variants[1].id,
  );
});

test("invalid feed variant falls back to a valid current or available variant", () => {
  assert.equal(
    chooseProductVariantId({
      variants,
      requestedVariant: "404",
      currentId: variants[1].id,
    }),
    variants[1].id,
  );
  assert.equal(
    chooseProductVariantId({ variants, requestedVariant: "404", currentId: null }),
    variants[0].id,
  );
});
