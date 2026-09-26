import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { futureLightChildEnv } from "./future-light-env.mjs";
import { resolveFutureLightShopifyTarget } from "./future-light-shopify-target.mjs";

const FUTURE_LIGHT_DOMAIN = "vs-future-store-0jl2t-jxu6tnr3.myshopify.com";

test("Shopify target accepts only the exact Future Light domain or matching URL", () => {
  assert.deepEqual(resolveFutureLightShopifyTarget({ FUTURE_LIGHT_SHOP_DOMAIN: FUTURE_LIGHT_DOMAIN }), {
    shopDomain: FUTURE_LIGHT_DOMAIN,
  });
  assert.deepEqual(resolveFutureLightShopifyTarget({ FUTURE_LIGHT_SHOP_URL: `https://${FUTURE_LIGHT_DOMAIN}/` }), {
    shopDomain: FUTURE_LIGHT_DOMAIN,
  });
  assert.throws(() => resolveFutureLightShopifyTarget({}), /Set FUTURE_LIGHT_SHOP_DOMAIN/);
  assert.throws(
    () => resolveFutureLightShopifyTarget({ FUTURE_LIGHT_SHOP_DOMAIN: "other-store.myshopify.com" }),
    /restricted to the exact Future Light store/,
  );
  assert.throws(
    () => resolveFutureLightShopifyTarget({
      FUTURE_LIGHT_SHOP_DOMAIN: FUTURE_LIGHT_DOMAIN,
      FUTURE_LIGHT_SHOP_URL: "https://other-store.myshopify.com",
    }),
    /settings do not match/,
  );
  assert.throws(
    () => resolveFutureLightShopifyTarget({ FUTURE_LIGHT_SHOP_URL: `https://${FUTURE_LIGHT_DOMAIN}/admin` }),
    /without credentials or a path/,
  );
});

test("Shopify CLI child environment excludes unapproved parent variables", () => {
  const childEnv = futureLightChildEnv({
    PATH: "/usr/bin",
    FUTURE_LIGHT_SHOP_DOMAIN: FUTURE_LIGHT_DOMAIN,
    FUTURE_LIGHT_SHOPIFY_ADMIN_ACCESS_TOKEN: "fixture-token",
    FUTURE_LIGHT_SHOPIFY_CLI_AGENT_INFO: "fixture-agent",
    UNRELATED_ACCESS_TOKEN: "must-not-forward",
    LEGACY_SHOP_DOMAIN: "must-not-forward",
  });

  assert.equal(childEnv.FUTURE_LIGHT_SHOP_DOMAIN, FUTURE_LIGHT_DOMAIN);
  assert.equal(childEnv.FUTURE_LIGHT_SHOPIFY_ADMIN_ACCESS_TOKEN, "fixture-token");
  assert.equal(childEnv.PATH, "/usr/bin");
  assert.equal(childEnv.UNRELATED_ACCESS_TOKEN, undefined);
  assert.equal(childEnv.LEGACY_SHOP_DOMAIN, undefined);
});

test("metafield setup has no destructive definition or associated-value deletion path", async () => {
  const source = await readFile(new URL("../ensure-shopify-product-metafields.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /metafieldDefinitionDelete|deleteAllAssociatedMetafields/);
});
