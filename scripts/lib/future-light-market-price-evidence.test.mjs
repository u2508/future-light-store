import test from "node:test";
import assert from "node:assert/strict";

import {
  assertMarketPriceEvidenceOwnership,
  validateMarketPriceEvidence,
} from "./future-light-market-price-evidence.mjs";

const now = Date.parse("2026-09-25T12:00:00.000Z");
const validEvidence = () => ({
  schemaVersion: 1,
  createdAt: "2026-09-25T11:00:00.000Z",
  storeDomain: "vs-future-store-0jl2t-jxu6tnr3.myshopify.com",
  currencyCode: "USD",
  products: [
    {
      productId: "gid://shopify/Product/100",
      variants: [{ variantId: "gid://shopify/ProductVariant/200", comparables: [] }],
    },
  ],
});

test("binds current price evidence to exact store, currency, product, and variant IDs", () => {
  const result = validateMarketPriceEvidence(validEvidence(), {
    storeDomain: "vs-future-store-0jl2t-jxu6tnr3.myshopify.com",
    currencyCode: "USD",
    now,
  });
  assert.equal(
    result.byVariantId.get("gid://shopify/ProductVariant/200").productId,
    "gid://shopify/Product/100",
  );
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
});

test("rejects evidence for another store or a non-USD store", () => {
  assert.throws(
    () =>
      validateMarketPriceEvidence(
        { ...validEvidence(), storeDomain: "other.myshopify.com" },
        {
          storeDomain: "vs-future-store-0jl2t-jxu6tnr3.myshopify.com",
          currencyCode: "USD",
          now,
        },
      ),
    /store domain/,
  );
  assert.throws(
    () =>
      validateMarketPriceEvidence(validEvidence(), {
        storeDomain: "vs-future-store-0jl2t-jxu6tnr3.myshopify.com",
        currencyCode: "CAD",
        now,
      }),
    /currency/,
  );
});

test("rejects stale, future-dated, or malformed records and duplicate identities", () => {
  assert.throws(
    () =>
      validateMarketPriceEvidence(
        { ...validEvidence(), createdAt: "2026-08-01T00:00:00.000Z" },
        {
          storeDomain: "vs-future-store-0jl2t-jxu6tnr3.myshopify.com",
          currencyCode: "USD",
          now,
        },
      ),
    /older than 30 days/,
  );
  assert.throws(
    () =>
      validateMarketPriceEvidence(
        { ...validEvidence(), createdAt: "2026-09-26T00:00:00.000Z" },
        {
          storeDomain: "vs-future-store-0jl2t-jxu6tnr3.myshopify.com",
          currencyCode: "USD",
          now,
        },
      ),
    /future/,
  );
  const duplicate = validEvidence();
  duplicate.products.push(structuredClone(duplicate.products[0]));
  assert.throws(
    () =>
      validateMarketPriceEvidence(duplicate, {
        storeDomain: "vs-future-store-0jl2t-jxu6tnr3.myshopify.com",
        currencyCode: "USD",
        now,
      }),
    /duplicate product/,
  );
});

test("requires each evidence variant to belong to its declared live product", () => {
  const evidence = validateMarketPriceEvidence(validEvidence(), {
    storeDomain: "vs-future-store-0jl2t-jxu6tnr3.myshopify.com",
    currencyCode: "USD",
    now,
  });
  assert.equal(assertMarketPriceEvidenceOwnership(evidence, [{
    id: "gid://shopify/Product/100",
    variants: { nodes: [{ id: "gid://shopify/ProductVariant/200" }] },
  }]), true);

  assert.throws(() => assertMarketPriceEvidenceOwnership(evidence, [{
    id: "gid://shopify/Product/100",
    variants: { nodes: [{ id: "gid://shopify/ProductVariant/201" }] },
  }]), /stale or maps .* different live Shopify product/);

  assert.throws(() => assertMarketPriceEvidenceOwnership(evidence, [{
    id: "gid://shopify/Product/101",
    variants: { nodes: [{ id: "gid://shopify/ProductVariant/200" }] },
  }]), /stale or maps .* different live Shopify product/);
});
