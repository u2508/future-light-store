import test from "node:test";
import assert from "node:assert/strict";
import { resolveShopifyThemeAssetUrl } from "../src/lib/shopify-theme-asset-url.mjs";

test("resolves imported Vite artwork against the Shopify theme CDN base", () => {
  assert.equal(
    resolveShopifyThemeAssetUrl(
      "/assets/travel-outdoor-Ca5XGuIT.jpg",
      "//vs-store-us.myshopify.com/cdn/shop/t/3/assets",
    ),
    "https://vs-store-us.myshopify.com/cdn/shop/t/3/assets/travel-outdoor-Ca5XGuIT.jpg",
  );
});

test("keeps local URLs unchanged when the Shopify theme base is absent", () => {
  assert.equal(
    resolveShopifyThemeAssetUrl("/assets/home-decor.jpg", undefined),
    "/assets/home-decor.jpg",
  );
});

test("does not rewrite Shopify CDN or other remote URLs", () => {
  const remote = "https://cdn.shopify.com/s/files/1/collection.jpg";
  assert.equal(resolveShopifyThemeAssetUrl(remote, "https://store/cdn/shop/t/3/assets/"), remote);
});

test("leaves non-theme local paths and invalid bases safe", () => {
  assert.equal(
    resolveShopifyThemeAssetUrl("/images/logo.svg", "https://store/assets/"),
    "/images/logo.svg",
  );
  assert.equal(resolveShopifyThemeAssetUrl("/assets/image.jpg", "not a URL"), "/assets/image.jpg");
  assert.equal(resolveShopifyThemeAssetUrl(undefined, "https://store/assets/"), undefined);
});
