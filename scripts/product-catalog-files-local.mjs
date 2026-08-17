#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export async function readProductCatalogPayload(dataDir) {
  const names = (await readdir(dataDir))
    .filter((name) => /^products(?:-\d+)?\.json$/.test(name))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  const products = [];
  for (const name of names) {
    const payload = JSON.parse(await readFile(join(dataDir, name), "utf8"));
    if (Array.isArray(payload)) products.push(...payload);
    else if (Array.isArray(payload?.products)) products.push(...payload.products);
  }
  if (!products.length) throw new Error(`No product catalog shards found in ${dataDir}`);
  return products;
}
