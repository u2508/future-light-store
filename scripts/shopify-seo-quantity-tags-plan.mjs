#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { buildShopifySeoReleasePlan } from "../src/lib/shopify-seo-release.js";
import {
  managedMinimumQuantityTagFromTags,
  normalizeShopifyTags,
  reconcileManagedMinimumQuantityTags,
} from "../src/lib/shopify-seo-managed-tags.js";
import { readProductCatalogPayload } from "./product-catalog-files.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const dataDir = resolve(rootDir, "public", "data");
const outputPath = resolve(rootDir, "output", "shopify-seo-quantity-tags-plan.json");

async function loadJson(name) {
  return JSON.parse(await readFile(resolve(dataDir, name), "utf8"));
}

const [productsPayload, collectionsPayload, collectionProducts] = await Promise.all([
  readProductCatalogPayload(dataDir),
  loadJson("collections.json"),
  loadJson("collection-products.json"),
]);
const products = Array.isArray(productsPayload?.products) ? productsPayload.products : [];
const snapshot = {
  products,
  collections: Array.isArray(collectionsPayload?.collections) ? collectionsPayload.collections : [],
  collectionProducts,
};
const plan = await buildShopifySeoReleasePlan(snapshot);
const catalogByHandle = new Map(
  products.map((product) => [String(product?.handle || "").trim().toLowerCase(), product]),
);

const entries = plan.products.map((productPlan) => {
  const product = catalogByHandle.get(productPlan.handle) || {};
  const currentTags = normalizeShopifyTags(product.tags);
  const nextTags = reconcileManagedMinimumQuantityTags(currentTags, productPlan.desiredQuantityTag);
  const currentManagedTag = managedMinimumQuantityTagFromTags(currentTags);
  const changed =
    currentTags.map((tag) => tag.toLowerCase()).join("|") !==
    nextTags.map((tag) => tag.toLowerCase()).join("|");
  const effectivePrices = (productPlan.desiredVariantUpdates || [])
    .map((variant) => Number(variant.price))
    .filter((price) => Number.isFinite(price) && price > 0);

  return {
    handle: productPlan.handle,
    productId: productPlan.productId,
    lowestEffectivePrice: effectivePrices.length ? Math.min(...effectivePrices).toFixed(2) : "",
    currentManagedTag,
    desiredManagedTag: productPlan.desiredQuantityTag || "",
    changed,
    nextTags,
  };
});

const changes = entries.filter((entry) => entry.changed);
const manifest = {
  generatedAt: new Date().toISOString(),
  mode: "local-plan-no-shopify-writes",
  policy: {
    priceBasis: "lowest effective variant price",
    under15: "minimum-qty-3",
    exact15: "no managed tag",
    above15AndUnder25: "minimum-qty-2",
    atOrAbove25: "no managed tag",
    merchantTags: "preserved",
  },
  summary: {
    products: entries.length,
    changes: changes.length,
    minimumQty3: entries.filter((entry) => entry.desiredManagedTag === "minimum-qty-3").length,
    minimumQty2: entries.filter((entry) => entry.desiredManagedTag === "minimum-qty-2").length,
    cleanup: changes.filter((entry) => !entry.desiredManagedTag).length,
    unchanged: entries.length - changes.length,
  },
  changes,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(manifest.summary)}\n${outputPath}\n`);
