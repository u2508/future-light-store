import { readdir, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  DEFAULT_PRODUCT_SHARD_MAX_BYTES,
  isProductCatalogManifest,
  mergeProductShardPayloads,
  splitProductCatalogPayload,
} from "../src/lib/product-catalog-shards.js";

const PRODUCT_SHARD_FILE_PATTERN = /^products-\d{4}\.json$/;

export async function readProductCatalogPayload(dataDir) {
  const resolvedDataDir = resolve(dataDir);
  const manifestPath = resolve(resolvedDataDir, "products.json");
  const payload = JSON.parse(await readFile(manifestPath, "utf8"));

  if (!isProductCatalogManifest(payload)) {
    if (Array.isArray(payload?.products)) {
      return payload;
    }

    throw new Error(`Product catalog manifest contains no products or shards: ${manifestPath}`);
  }

  const shardEntries = Array.isArray(payload.shards) ? payload.shards : [];
  if (!shardEntries.length) {
    throw new Error(`Product catalog manifest contains no shard entries: ${manifestPath}`);
  }

  const shardPayloads = await Promise.all(
    shardEntries.map(async (entry) => {
      const file = String(entry?.file || entry?.path || "").replace(/^.*\//, "");
      if (!PRODUCT_SHARD_FILE_PATTERN.test(file)) {
        throw new Error(`Invalid product catalog shard filename: ${file}`);
      }

      return JSON.parse(await readFile(resolve(resolvedDataDir, file), "utf8"));
    }),
  );

  const merged = mergeProductShardPayloads(payload, shardPayloads);
  if (!merged.products.length) {
    throw new Error(`Product catalog shards are empty: ${manifestPath}`);
  }

  return merged;
}

export async function writeProductCatalogPayload(
  dataDir,
  payload,
  { maxBytes = Number(process.env.SALT_PRODUCTS_SHARD_MAX_BYTES) || DEFAULT_PRODUCT_SHARD_MAX_BYTES } = {},
) {
  const resolvedDataDir = resolve(dataDir);
  await mkdir(resolvedDataDir, { recursive: true });

  const { manifest, shards } = splitProductCatalogPayload(payload, maxBytes);
  const nextShardFiles = new Set(manifest.shards.map((entry) => entry.file));
  const existingFiles = await readdir(resolvedDataDir);
  const staleShardFiles = existingFiles.filter(
    (file) => PRODUCT_SHARD_FILE_PATTERN.test(file) && !nextShardFiles.has(file),
  );

  await Promise.all(
    shards.map((shard, index) =>
      writeFile(resolve(resolvedDataDir, manifest.shards[index].file), shard.serialized, "utf8"),
    ),
  );

  // Publish the manifest last so readers never discover a new shard list before
  // every referenced file has been written.
  await writeFile(resolve(resolvedDataDir, "products.json"), JSON.stringify(manifest), "utf8");
  await Promise.all(staleShardFiles.map((file) => rm(resolve(resolvedDataDir, file), { force: true })));

  return manifest;
}

export async function readProductCatalogPayloadFromFile(filePath) {
  return readProductCatalogPayload(dirname(resolve(filePath)));
}
