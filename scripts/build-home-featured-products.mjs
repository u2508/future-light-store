#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildHomeFeaturedProductsPayload } from "./home-featured-products.mjs";

const dataDir = resolve(process.cwd(), "public", "data");
const productsPath = resolve(dataDir, "product-search.json");
const collectionProductsPath = resolve(dataDir, "collection-products.json");
const homeFeaturedProductsPath = resolve(dataDir, "home-featured-products.json");

async function main() {
  const productsPayload = JSON.parse(await readFile(productsPath, "utf8"));
  const collectionProductsPayload = JSON.parse(await readFile(collectionProductsPath, "utf8"));
  const payload = buildHomeFeaturedProductsPayload(productsPayload, collectionProductsPayload);

  await writeFile(homeFeaturedProductsPath, JSON.stringify(payload));
  process.stdout.write(`Saved ${payload.bestSellerProducts.length + payload.quirkyGiftPicks.length + payload.everydayEssentialProducts.length} collection-backed homepage products to public/data/home-featured-products.json\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
