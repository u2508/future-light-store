import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const scriptPath = resolve(projectRoot, "scripts", "shopify-product-metafield-backfill.mjs");
const source = await readFile(scriptPath, "utf8");

function runBlockedApply(args) {
  return spawnSync(process.execPath, [scriptPath, "--apply", ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { PATH: "" },
  });
}

test("apply rejects broad, implicit, duplicated, malformed, and mixed product scopes before env loading", () => {
  const cases = [
    ["--all-active"],
    [],
    ["--product-id", "41,41"],
    ["--product-id", "41", "--product-handle", "example"],
    ["--product-id", "41", "--limit-products", "1"],
    ["--product-id", "0"],
  ];

  for (const args of cases) {
    const result = runBlockedApply(args);
    const output = `${result.stdout || ""}${result.stderr || ""}`;
    assert.equal(result.status, 1, `expected rejection for ${args.join(" ")}; output: ${output}`);
    assert.match(output, /Refusing --apply:/);
    assert.doesNotMatch(output, /Set FUTURE_LIGHT_SHOP_DOMAIN|FUTURE_LIGHT_SHOPIFY_ADMIN_ACCESS_TOKEN/);
  }
});

test("scope gate runs before any environment loading and exact live-ID reconciliation is present", () => {
  const scopeCall = source.indexOf("assertRawApplyScope(process.argv)");
  const envLoad = source.indexOf("await loadFutureLightEnv(");
  assert.ok(scopeCall >= 0 && scopeCall < envLoad);
  assert.match(source, /function assertExactProductApplyScope\(args, products = null\)/);
  assert.match(source, /live product cohort does not exactly match requested IDs/);
  assert.match(source, /assertExactProductApplyScope\(args, selectedProducts\)/);
});

test("taxonomy resolution requires one exact live leaf and has no fuzzy or root fallback", () => {
  assert.match(source, /nodes \{ id name fullName isLeaf \}/);
  const resolverStart = source.indexOf("function resolveTaxonomyPath(");
  const resolverEnd = source.indexOf("\n}\n", resolverStart);
  const resolver = source.slice(resolverStart, resolverEnd);
  assert.match(resolver, /exact\.length !== 1/);
  assert.match(resolver, /exact\[0\]\.isLeaf === true/);
  assert.doesNotMatch(resolver, /score|root|fallback/i);
  assert.match(source, /resolved\.isLeaf !== true/);
  assert.match(source, /response\.product\?\.category\?\.isLeaf !== true/);
});

test("metafield definitions are category-constrained, paginated, and schema-required fields cannot be skipped", () => {
  assert.match(source, /constraintSubtype: \{ key: "category", value: \$categoryValue \}/);
  assert.match(source, /constraintStatus: CONSTRAINED_ONLY/);
  assert.match(source, /Category-constrained metafield definitions are incomplete/);
  assert.match(source, /Category-metafield definition pagination is incomplete/);
  assert.match(source, /Taxonomy attributes for \$\{node\.id\} are incomplete/);
  assert.match(source, /required schema field \$\{fieldKey/);
  assert.match(source, /validateCategoryMetafieldSchemaCoverage\(categoryMetafieldWrites\)/);
  assert.doesNotMatch(source, /Skipped evidence-incomplete category metafield/);
  assert.doesNotMatch(source, /DEFAULT_SOLID_PATTERN_TAXONOMY_VALUE_ID/);
});

test("direct category assignment requires an exact approved product-ID record", () => {
  assert.match(source, /shopifyProductCategoryWriteApproval/);
  assert.match(source, /exact-product-id-set-with-live-leaf-readback/);
  assert.match(source, /live-metaobject-schema-required-fields/);
  assert.match(source, /The checked-in approval explicitly excludes direct Shopify category writes/);
});
