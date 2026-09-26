import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertFutureLightDirectWriteDisabled } from "./future-light-direct-write-guard.mjs";

test("unsafe direct bundle-price apply is rejected before reading its input", () => {
  assert.throws(
    () => assertFutureLightDirectWriteDisabled({ runner: "orders-bundle", mode: "apply" }),
    /default bundle multiplier.*No Shopify request or mutation was made/s,
  );
});

test("raw SEO apply is rejected until it consumes the approved manifest", () => {
  assert.throws(
    () => assertFutureLightDirectWriteDisabled({ runner: "seo-release", mode: "apply" }),
    /inferred SEO and quantity-tier prices/,
  );
});

test("GPT SEO apply is rejected before environment loading until its approved-copy manifest is wired", () => {
  assert.throws(
    () => assertFutureLightDirectWriteDisabled({ runner: "gpt-seo", mode: "apply" }),
    /approved-copy manifest.*live preimages/,
  );
});

test("legacy variant cost alignment cannot overwrite prices without the governed market and basket-economics evidence", () => {
  assert.throws(
    () => assertFutureLightDirectWriteDisabled({ runner: "variant-cost-price-alignment", mode: "apply" }),
    /cost groups without approved product-specific market and basket-economics evidence.*No Shopify request or mutation was made/s,
  );
});

test("nominal price rework cannot directly write until market evidence and order-cost allocation are fully governed", () => {
  assert.throws(
    () => assertFutureLightDirectWriteDisabled({ runner: "price-rework", mode: "apply" }),
    /per-order cost allocation, reviewed comparables, and matching approved price manifest.*No Shopify request or mutation was made/s,
  );
});

test("alternate final and curated SEO apply commands cannot bypass the reviewed-copy write gate", () => {
  assert.throws(
    () => assertFutureLightDirectWriteDisabled({ runner: "seo-final-artifact", mode: "apply" }),
    /current, reviewed product-bound copy approval manifest/,
  );
  assert.throws(
    () => assertFutureLightDirectWriteDisabled({ runner: "curated-seo-apply", mode: "apply" }),
    /reviewed copy approval manifest.*exact current product preimage/,
  );
  assert.throws(
    () => assertFutureLightDirectWriteDisabled({ runner: "specificity-repair", mode: "apply" }),
    /hard-coded copy repairs.*current source-bound approval manifest/,
  );
  assert.throws(
    () => assertFutureLightDirectWriteDisabled({ runner: "new-product-seo-pipeline", mode: "apply" }),
    /Google-specific variant metafields.*Shopify-only approved scope/,
  );
  assert.throws(
    () => assertFutureLightDirectWriteDisabled({ runner: "automatic-variant-image-mapping", mode: "apply" }),
    /nearest-image matching.*exact, product-bound visual approval/,
  );
  assert.throws(
    () => assertFutureLightDirectWriteDisabled({ runner: "visual-variant-apply", mode: "apply" }),
    /typed Shopify identities and generated-asset content hashes/,
  );
});

test("diagnostic dry-runs and unrelated runners are unaffected", () => {
  assert.equal(assertFutureLightDirectWriteDisabled({ runner: "orders-bundle", mode: "dry-run" }), true);
  assert.equal(assertFutureLightDirectWriteDisabled({ runner: "seo-release", mode: "dry-run" }), true);
  assert.equal(assertFutureLightDirectWriteDisabled({ runner: "gpt-seo", mode: "dry-run" }), true);
  assert.equal(assertFutureLightDirectWriteDisabled({ runner: "variant-cost-price-alignment", mode: "dry-run" }), true);
  assert.equal(assertFutureLightDirectWriteDisabled({ runner: "price-rework", mode: "dry-run" }), true);
  assert.equal(assertFutureLightDirectWriteDisabled({ runner: "seo-final-artifact", mode: "dry-run" }), true);
  assert.equal(assertFutureLightDirectWriteDisabled({ runner: "curated-seo-apply", mode: "dry-run" }), true);
  assert.equal(assertFutureLightDirectWriteDisabled({ runner: "specificity-repair", mode: "dry-run" }), true);
  assert.equal(assertFutureLightDirectWriteDisabled({ runner: "new-product-seo-pipeline", mode: "dry-run" }), true);
  assert.equal(assertFutureLightDirectWriteDisabled({ runner: "automatic-variant-image-mapping", mode: "dry-run" }), true);
  assert.equal(assertFutureLightDirectWriteDisabled({ runner: "visual-variant-apply", mode: "dry-run" }), true);
  assert.equal(assertFutureLightDirectWriteDisabled({ runner: "inventory-audit", mode: "apply" }), true);
});

test("the raw Shopify CLIs reject apply before credentials, target, or input are needed", () => {
  const scripts = [
    { url: new URL("../../scripts/shopify-orders-bundle-update.mjs", import.meta.url), args: ["--apply"] },
    { url: new URL("../../scripts/shopify-seo-release.mjs", import.meta.url), args: ["--apply"] },
    { url: new URL("../../scripts/shopify-variant-cost-price-alignment.mjs", import.meta.url), args: ["--apply"] },
    {
      url: new URL("../../scripts/shopify-price-rework.mjs", import.meta.url),
      args: ["--apply", "--market-evidence", "missing-market-evidence.json"],
    },
    { url: new URL("../../scripts/future-light-seo-gpt-200.mjs", import.meta.url), args: ["--apply"] },
    { url: new URL("../../scripts/future-light-seo-final-apply.mjs", import.meta.url), args: ["--apply"] },
    { url: new URL("../../scripts/apply-curated-product-seo.mjs", import.meta.url), args: ["--apply"] },
    { url: new URL("../../scripts/future-light-product-specificity-repair.mjs", import.meta.url), args: ["--apply"] },
    { url: new URL("../../scripts/shopify-seo-pipeline.mjs", import.meta.url), args: ["--apply"] },
    { url: new URL("../../scripts/shopify-variant-image-mapping.mjs", import.meta.url), args: ["--apply", "--resume"] },
    { url: new URL("../../scripts/future-light-visual-variant-apply.mjs", import.meta.url), args: [] },
  ];
  for (const script of scripts) {
    const result = spawnSync(process.execPath, [fileURLToPath(script.url), ...script.args], {
      encoding: "utf8",
      env: { PATH: process.env.PATH || "" },
    });
    assert.ok([1, 78].includes(result.status), result.stderr);
    assert.match(result.stderr, /Shopify apply is blocked/);
    assert.match(result.stderr, /No Shopify request or mutation was made/);
  }
});
