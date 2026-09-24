import test from "node:test";
import assert from "node:assert/strict";
import {
  createFutureLightShopifyTargetHandler,
  FUTURE_LIGHT_RELEASE_SHOP_DOMAIN,
  FUTURE_LIGHT_RELEASE_SHOP_ID,
} from "./future-light-shopify-target-stage.mjs";

const stage = {
  id: "shopify.preflight.target",
  target: "shopify",
  resumeFingerprint: "a".repeat(64),
};
const identity = { shop: { id: FUTURE_LIGHT_RELEASE_SHOP_ID, myshopifyDomain: FUTURE_LIGHT_RELEASE_SHOP_DOMAIN } };

test("creates an exact target receipt only after Shopify returns the expected live shop identity", async () => {
  const calls = [];
  const handler = createFutureLightShopifyTargetHandler({
    client: {
      storeDomain: FUTURE_LIGHT_RELEASE_SHOP_DOMAIN,
      async run(query, variables, options) {
        calls.push({ query, variables, options });
        return identity;
      },
    },
    now: () => "2026-09-24T12:00:00.000Z",
  });
  const result = await handler.run({ stage });
  assert.equal(result.status, "completed");
  assert.equal(result.receipt.shopId, FUTURE_LIGHT_RELEASE_SHOP_ID);
  assert.equal(result.receipt.shopDomain, FUTURE_LIGHT_RELEASE_SHOP_DOMAIN);
  assert.equal(result.receipt.readbackVerified, true);
  assert.equal(result.receipt.stageFingerprint, stage.resumeFingerprint);
  assert.equal(calls.length, 1);
  assert.match(calls[0].query.trim(), /^query\b/);
  assert.doesNotMatch(calls[0].query, /\bmutation\b/i);
});

test("refuses a misconfigured client target before issuing any Admin request", () => {
  let calls = 0;
  assert.throws(() => createFutureLightShopifyTargetHandler({
    client: { storeDomain: "wrong-store.myshopify.com", async run() { calls += 1; } },
  }), /Refused Shopify target/);
  assert.equal(calls, 0);
});

test("refuses a live shop identity mismatch after the read-only query", async () => {
  const handler = createFutureLightShopifyTargetHandler({
    client: {
      storeDomain: FUTURE_LIGHT_RELEASE_SHOP_DOMAIN,
      async run() { return { shop: { id: "gid://shopify/Shop/other", myshopifyDomain: "wrong.myshopify.com" } }; },
    },
  });
  await assert.rejects(handler.run({ stage }), /identity readback does not match/);
});

test("reconcile and network probe are read-only and verify the same identity", async () => {
  const calls = [];
  const handler = createFutureLightShopifyTargetHandler({
    client: {
      storeDomain: FUTURE_LIGHT_RELEASE_SHOP_DOMAIN,
      async run(query, variables, options) { calls.push({ query, options }); return identity; },
    },
  });
  const reconciled = await handler.reconcile({ stage });
  assert.equal(reconciled.status, "completed");
  assert.equal(reconciled.target, "shopify");
  assert.equal(reconciled.stageId, stage.id);
  assert.equal(reconciled.receipt.shopId, FUTURE_LIGHT_RELEASE_SHOP_ID);
  assert.equal(await handler.probe(), true);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ query }) => /^\s*query\b/i.test(query) && !/\bmutation\b/i.test(query)));
});

test("rejects stage descriptor substitution", async () => {
  const handler = createFutureLightShopifyTargetHandler({
    client: { storeDomain: FUTURE_LIGHT_RELEASE_SHOP_DOMAIN, async run() { return identity; } },
  });
  await assert.rejects(handler.run({ stage: { ...stage, id: "shopify.apply.product" } }), /Invalid Shopify target-verification/);
});
