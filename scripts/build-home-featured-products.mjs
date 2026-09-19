#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildHomeFeaturedProductsPayload } from "./home-featured-products.mjs";
import { readFreshLiveCatalogSnapshot } from "./lib/live-catalog-assertion.mjs";

const dataDir = resolve(process.cwd(), "public", "data");
const productsPath = resolve(dataDir, "product-search.json");
const collectionProductsPath = resolve(dataDir, "collection-products.json");
const homeFeaturedProductsPath = resolve(dataDir, "home-featured-products.json");

async function main() {
  const [{ products: liveProducts }, productsPayload, collectionProductsPayload] = await Promise.all([
    readFreshLiveCatalogSnapshot(dataDir, { context: "homepage featured build catalog" }),
    readFile(productsPath, "utf8").then(JSON.parse),
    readFile(collectionProductsPath, "utf8").then(JSON.parse),
  ]);
  if (productsPayload?.generatedAt !== liveProducts?.generatedAt) {
    throw new Error("Product search artifact does not match the fresh live Shopify catalog; rebuild it first.");
  }
  const payload = buildHomeFeaturedProductsPayload(productsPayload, collectionProductsPayload);

  await writeFile(homeFeaturedProductsPath, JSON.stringify(payload));
  process.stdout.write(`Saved ${payload.bestSellerProducts.length + payload.quirkyGiftPicks.length + payload.everydayEssentialProducts.length} collection-backed homepage products to public/data/home-featured-products.json\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
