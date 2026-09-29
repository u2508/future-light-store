import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const builderSource = await readFile(new URL("./build-shopify-theme.mjs", import.meta.url), "utf8");

test("Shopify layout boots through the stable loader for the current content-addressed entry", () => {
  assert.match(
    builderSource,
    /<link rel="modulepreload" href="\{\{ 'salt-app\.js' \| asset_url \| split: '\?' \| first \}\}" fetchpriority="high">/,
  );
  assert.match(
    builderSource,
    /<script type="module" src="\{\{ 'salt-app\.js' \| asset_url \}\}"><\/script>/,
  );
  assert.doesNotMatch(builderSource, /routeAssets\.entry/);
  assert.match(
    builderSource,
    /import\(new URL\(\$\{JSON\.stringify\(themeEntryJs\)\}, base\)\.href\)/,
  );
});
