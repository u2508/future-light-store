import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalProductGid,
  isSha256Hex,
  isShopifyGidOfType,
  sameProductGid,
  sha256Hex,
} from "./visual-approval-integrity.mjs";

test("product identity normalization preserves the Shopify resource type", () => {
  assert.equal(canonicalProductGid("123"), "gid://shopify/Product/123");
  assert.equal(canonicalProductGid("gid://shopify/Product/123"), "gid://shopify/Product/123");
  assert.equal(canonicalProductGid("gid://shopify/ProductVariant/123"), null);
  assert.equal(canonicalProductGid("https://example.test/Product/123"), null);
  assert.equal(sameProductGid("123", "gid://shopify/Product/123"), true);
  assert.equal(sameProductGid("gid://shopify/ProductVariant/123", "gid://shopify/Product/123"), false);
});

test("generated media approvals can be pinned to an exact content hash", () => {
  const digest = sha256Hex(Buffer.from("approved pixels"));
  assert.equal(isSha256Hex(digest), true);
  assert.equal(sha256Hex(Buffer.from("different pixels")) === digest, false);
  assert.equal(isSha256Hex("not-a-digest"), false);
  assert.equal(isSha256Hex("a".repeat(64)), true);
});

test("Shopify media GIDs cannot be confused with product or variant GIDs", () => {
  assert.equal(isShopifyGidOfType("gid://shopify/MediaImage/9", "MediaImage"), true);
  assert.equal(isShopifyGidOfType("gid://shopify/ProductVariant/9", "MediaImage"), false);
  assert.equal(isShopifyGidOfType("9", "MediaImage"), false);
});
