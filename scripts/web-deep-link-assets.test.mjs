import assert from "node:assert/strict";
import test from "node:test";
import { findInvalidWebDeepLinkAssetReferences } from "./lib/web-deep-link-assets.mjs";

test("accepts root-absolute web assets for direct deep links", () => {
  const html = `
    <script type="module" crossorigin src="/assets/index-a1.js"></script>
    <link rel="modulepreload" href="/assets/route-b2.js">
    <link rel="stylesheet" href="/assets/index-c3.css">
  `;
  assert.deepEqual(findInvalidWebDeepLinkAssetReferences(html), []);
});

test("rejects relative assets that resolve beneath a product or collection URL", () => {
  const html = `
    <script type="module" src="./assets/index-a1.js"></script>
    <link rel="modulepreload" href="assets/route-b2.js">
    <link rel="stylesheet" href="/assets/index-c3.css">
  `;
  assert.deepEqual(
    findInvalidWebDeepLinkAssetReferences(html).map(({ url }) => url),
    ["./assets/index-a1.js", "assets/route-b2.js"],
  );
});
