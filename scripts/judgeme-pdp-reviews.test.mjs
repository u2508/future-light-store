import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const component = await readFile(
  new URL("../src/components/vs/JudgeMeReviews.tsx", import.meta.url),
  "utf8",
);
const productRoute = await readFile(
  new URL("../src/routes/products.$handle.tsx", import.meta.url),
  "utf8",
);

test("headless reviews use React-owned Judge.me platform-independent markup", () => {
  assert.match(component, /className="jdgm-widget jdgm-review-widget jdgm-outside-widget"/);
  assert.match(component, /data-id=\{numericProductId\}/);
  assert.match(component, /data-product-title=\{productTitle\}/);
  assert.match(component, /data-shop-reviews-count=\{runtimeConfig\?\.shopReviewsCount\}/);
  assert.match(component, /normalizeJudgeMeRuntimeConfig\(window\.__VS_STORE_JUDGEME__\)/);
  assert.match(component, /script\[data-vs-store-judgeme-loader='true'\]/);
  assert.match(component, /document\.head\.appendChild\(script\)/);

  // The headless PDP must not discover or adopt the theme's Liquid staging node.
  assert.doesNotMatch(component, /judgeme_product_reviews|MutationObserver|originalParent/);
});

test("loader is reused and tab revisits preserve the mounted widget", () => {
  assert.match(
    component,
    /judgeMeLoader\?\.src === widgetScriptUrl\) return judgeMeLoader\.promise/,
  );
  assert.match(component, /script\.dataset\["vsStoreJudgemeLoader"\] = "true"/);
  assert.match(component, /loaderReady\.current = true/);
  assert.match(productRoute, /<TabsContent value="reviews" forceMount>/);
  assert.match(productRoute, /active=\{activeTab === "reviews"\}/);
  assert.match(
    productRoute,
    /tabSelection\.productId === product\.id \? tabSelection\.value : "details"/,
  );
  assert.match(productRoute, /value=\{activeTab\}/);
  assert.match(productRoute, /onValueChange=\{\(value\) => setTabSelection/);

  const cleanup = component.match(/return \(\) => \{\s*mounted = false;\s*\};/);
  assert.ok(cleanup, "the effect cleanup should only suppress stale React state updates");
  assert.doesNotMatch(cleanup[0], /remove\(|replaceChild|appendChild/);
});
