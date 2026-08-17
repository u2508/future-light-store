import {
  DEFAULT_PRODUCT_SHARD_MAX_BYTES,
  mergeProductShardPayloads,
  splitProductCatalogPayload,
} from "./product-catalog-shards.js";

export const PRODUCT_SEARCH_MANIFEST_FORMAT = "salt-product-search-shards";
export const PRODUCT_SEARCH_MANIFEST_VERSION = 1;
export const DEFAULT_PRODUCT_SEARCH_SHARD_MAX_BYTES = Math.min(
  DEFAULT_PRODUCT_SHARD_MAX_BYTES,
  4.5 * 1024 * 1024,
);

export function isProductSearchManifest(payload) {
  return Boolean(
    payload &&
      Array.isArray(payload.shards) &&
      (payload.format === PRODUCT_SEARCH_MANIFEST_FORMAT || payload.version === PRODUCT_SEARCH_MANIFEST_VERSION),
  );
}

export function splitProductSearchPayload(payload, maxBytes = DEFAULT_PRODUCT_SEARCH_SHARD_MAX_BYTES) {
  const result = splitProductCatalogPayload(
    {
      ...payload,
      source: "/data/product-search.json",
    },
    maxBytes,
  );

  const shards = result.shards.map((shard) => ({ ...shard }));
  const shardFiles = result.manifest.shards.map((shard, index) => ({
    ...shard,
    file: `product-search-${String(index + 1).padStart(4, "0")}.json`,
    path: `/data/product-search-${String(index + 1).padStart(4, "0")}.json`,
  }));

  return {
    manifest: {
      format: PRODUCT_SEARCH_MANIFEST_FORMAT,
      version: PRODUCT_SEARCH_MANIFEST_VERSION,
      generatedAt: payload?.generatedAt || new Date().toISOString(),
      source: payload?.source || "/data/product-search.json",
      total: Number(payload?.total) || 0,
      shardCount: shardFiles.length,
      shardMaxBytes: result.manifest.shardMaxBytes,
      shards: shardFiles,
    },
    shards,
  };
}

export function mergeProductSearchShardPayloads(manifest, shardPayloads) {
  return mergeProductShardPayloads(manifest, shardPayloads);
}
