import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeJudgeMeRuntimeConfig,
  parseShopifyProductNumericId,
} from "../src/lib/judgeme-config.js";

test("accepts only explicit HTTPS widget loader configuration", () => {
  assert.deepEqual(
    normalizeJudgeMeRuntimeConfig({
      widgetScriptUrl: "https://cdn.judge.me/widget/v1/judgeme.js?shop=explicit",
      shopReviewsCount: "12",
    }),
    {
      widgetScriptUrl: "https://cdn.judge.me/widget/v1/judgeme.js?shop=explicit",
      shopReviewsCount: 12,
    },
  );
  assert.equal(
    normalizeJudgeMeRuntimeConfig({ widgetScriptUrl: "http://reviews.example.test/widget.js" }),
    null,
  );
  assert.equal(
    normalizeJudgeMeRuntimeConfig({
      widgetScriptUrl: "https://user:pass@reviews.example.test/widget.js",
    }),
    null,
  );
  assert.equal(
    normalizeJudgeMeRuntimeConfig({
      widgetScriptUrl: "https://reviews.example.test/widget.js",
    }),
    null,
  );
  assert.equal(normalizeJudgeMeRuntimeConfig({ widgetScriptUrl: "/widget.js" }), null);
});

test("defaults the optional shop review count without inventing review data", () => {
  assert.deepEqual(
    normalizeJudgeMeRuntimeConfig({ widgetScriptUrl: "https://cdn.judge.me/widget/v1/judgeme.js" }),
    {
      widgetScriptUrl: "https://cdn.judge.me/widget/v1/judgeme.js",
      shopReviewsCount: 0,
    },
  );
  assert.equal(
    normalizeJudgeMeRuntimeConfig({
      widgetScriptUrl: "https://cdn.judge.me/widget/v1/judgeme.js",
      shopReviewsCount: -1,
    }),
    null,
  );
  assert.equal(
    normalizeJudgeMeRuntimeConfig({
      widgetScriptUrl: "https://cdn.judge.me/widget/v1/judgeme.js",
      shopReviewsCount: "not-a-count",
    }),
    null,
  );
});

test("uses only a canonical Shopify Product GID for widget product IDs", () => {
  assert.equal(parseShopifyProductNumericId("gid://shopify/Product/123456"), "123456");
  assert.equal(parseShopifyProductNumericId("gid://shopify/ProductVariant/123456"), null);
  assert.equal(parseShopifyProductNumericId("123456"), null);
});
