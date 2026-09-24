#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dirname, "..");
const baselinePath = resolve(rootDir, "output", ".shopify-metafield-live-catalog.json");
const variantPagesPath = resolve(rootDir, "output", ".shopify-variant-google-catalog-pages.jsonl");
const statePath = resolve(rootDir, "output", "shopify-variant-google-metafield-state.json");

const normalizeHandle = (value) => String(value || "").trim().toLowerCase();

const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
const baselineProducts = Array.isArray(baseline?.products) ? baseline.products : [];
if (!baselineProducts.length) throw new Error("Baseline catalog has no products.");

const baselineHandles = new Set(baselineProducts.map((product) => normalizeHandle(product?.handle)).filter(Boolean));
const variantLines = (await readFile(variantPagesPath, "utf8")).split(/\r?\n/).filter(Boolean);
const processedVariantIds = new Set();
const matchedHandles = new Set();
let variantCount = 0;

for (const line of variantLines) {
  const page = JSON.parse(line);
  for (const variant of Array.isArray(page?.nodes) ? page.nodes : []) {
    const handle = normalizeHandle(variant?.product?.handle);
    if (!handle || !baselineHandles.has(handle) || !variant?.id) continue;
    processedVariantIds.add(String(variant.id));
    matchedHandles.add(handle);
    variantCount += 1;
  }
}

const missingHandles = [...baselineHandles].filter((handle) => !matchedHandles.has(handle));
if (missingHandles.length) {
  process.stdout.write(`Baseline readback omitted ${missingHandles.length} handle(s) that are no longer present in the live variant cache; they remain outside the new-product cohort.\n`);
}

const now = new Date().toISOString();
const state = {
  version: 1,
  storeDomain: process.env.SALT_SHOP_URL ? new URL(process.env.SALT_SHOP_URL).hostname : "vs-future-store-0jl2t-jxu6tnr3.myshopify.com",
  establishedAt: now,
  updatedAt: now,
  baselineSource: ".shopify-metafield-live-catalog.json",
  baselineProductCount: baselineProducts.length,
  baselineHandleCount: baselineHandles.size,
  baselineVariantCount: variantCount,
  baselineMissingHandleCount: missingHandles.length,
  selectionMethod: "read-only-baseline-handle-boundary",
  processedVariantIds: [...processedVariantIds].sort(),
};

await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
process.stdout.write(`Prepared read-only new-product metafield baseline: ${baselineProducts.length} products, ${variantCount} variants, ${processedVariantIds.size} unique variant IDs.\n`);
