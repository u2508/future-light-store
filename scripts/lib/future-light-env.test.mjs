import test from "node:test";
import assert from "node:assert/strict";

import { futureLightChildEnv, parseFutureLightEnvText } from "./future-light-env.mjs";

test("loads only allowlisted Future Light settings and never parses SALT or unrelated secret keys", () => {
  const parsed = parseFutureLightEnvText(
    [
      "FUTURE_LIGHT_SHOP_DOMAIN=vs-future-store-0jl2t-jxu6tnr3.myshopify.com",
      "FUTURE_LIGHT_SHOPIFY_ADMIN_ACCESS_TOKEN='future-token-value'",
      "OPENAI_API_KEY=seo-key-value",
      "SALT_SHOP_URL=https://must-not-be-used.example",
      "SALT_SHOPIFY_ADMIN_ACCESS_TOKEN=must-not-be-used",
      "FUTURE_LIGHT_META_PAGE_ACCESS_TOKEN=not-for-release",
      "SHOPIFY_ADMIN_ACCESS_TOKEN=ambiguous-token",
    ].join("\n"),
  );

  assert.deepEqual(
    Object.keys(parsed).sort(),
    [
      "FUTURE_LIGHT_SHOP_DOMAIN",
      "FUTURE_LIGHT_SHOPIFY_ADMIN_ACCESS_TOKEN",
      "OPENAI_API_KEY",
    ].sort(),
  );
  assert.equal(parsed.SALT_SHOP_URL, undefined);
  assert.equal(parsed.SALT_SHOPIFY_ADMIN_ACCESS_TOKEN, undefined);
  assert.equal(parsed.FUTURE_LIGHT_META_PAGE_ACCESS_TOKEN, undefined);
  assert.equal(parsed.SHOPIFY_ADMIN_ACCESS_TOKEN, undefined);
});

test("existing process settings win over local-file values", () => {
  const parsed = parseFutureLightEnvText(
    "FUTURE_LIGHT_SHOP_DOMAIN=file.example.myshopify.com\nFUTURE_LIGHT_SEO_GPT_MODEL=gpt-4.1-mini",
    { FUTURE_LIGHT_SHOP_DOMAIN: "vs-future-store-0jl2t-jxu6tnr3.myshopify.com" },
  );

  assert.deepEqual(parsed, { FUTURE_LIGHT_SEO_GPT_MODEL: "gpt-4.1-mini" });
});

test("allows a read-only Shopify task to request a smaller environment allowlist", () => {
  const parsed = parseFutureLightEnvText(
    [
      "FUTURE_LIGHT_SHOP_DOMAIN=vs-future-store-0jl2t-jxu6tnr3.myshopify.com",
      "FUTURE_LIGHT_SHOPIFY_ADMIN_ACCESS_TOKEN=future-token-value",
      "FUTURE_LIGHT_SEO_GPT_MODEL=gpt-4.1-mini",
      "OPENAI_API_KEY=unused-model-key",
    ].join("\n"),
    {},
    new Set(["FUTURE_LIGHT_SHOP_DOMAIN", "FUTURE_LIGHT_SHOPIFY_ADMIN_ACCESS_TOKEN"]),
  );

  assert.deepEqual(
    Object.keys(parsed).sort(),
    ["FUTURE_LIGHT_SHOP_DOMAIN", "FUTURE_LIGHT_SHOPIFY_ADMIN_ACCESS_TOKEN"].sort(),
  );
});

test("child environment is limited to release dependencies", () => {
  const child = futureLightChildEnv({
    PATH: "/usr/bin",
    CI: "1",
    FUTURE_LIGHT_SHOP_DOMAIN: "vs-future-store-0jl2t-jxu6tnr3.myshopify.com",
    FUTURE_LIGHT_SHOPIFY_ADMIN_ACCESS_TOKEN: "future-token",
    OPENAI_API_KEY: "do-not-send-to-shopify-cli",
    SALT_SHOP_URL: "https://must-not-be-forwarded.example",
    SALT_SHOPIFY_ADMIN_ACCESS_TOKEN: "must-not-be-forwarded",
    META_ACCESS_TOKEN: "unrelated-secret",
    SHOPIFY_ADMIN_ACCESS_TOKEN: "ambiguous-token",
  });

  assert.equal(child.PATH, "/usr/bin");
  assert.equal(child.FUTURE_LIGHT_SHOP_DOMAIN, "vs-future-store-0jl2t-jxu6tnr3.myshopify.com");
  assert.equal(child.SALT_SHOP_URL, undefined);
  assert.equal(child.SALT_SHOPIFY_ADMIN_ACCESS_TOKEN, undefined);
  assert.equal(child.META_ACCESS_TOKEN, undefined);
  assert.equal(child.OPENAI_API_KEY, undefined);
  assert.equal(child.SHOPIFY_ADMIN_ACCESS_TOKEN, undefined);
});
