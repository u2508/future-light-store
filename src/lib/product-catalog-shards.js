export const PRODUCT_CATALOG_MANIFEST_FORMAT = "salt-product-catalog-shards";
export const PRODUCT_CATALOG_MANIFEST_VERSION = 1;
export const DEFAULT_PRODUCT_SHARD_MAX_BYTES = 45 * 1024 * 1024;
export const HARD_MAX_PRODUCT_SHARD_BYTES = 90 * 1024 * 1024;

function serializeShard(payload, products, shardIndex = 0, shardCount = 1) {
  return JSON.stringify({
    generatedAt: payload?.generatedAt || new Date().toISOString(),
    source: payload?.source || "/data/products.json",
    total: Number(payload?.total) || products.length,
    shardIndex,
    shardCount,
    products,
  });
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

export function isProductCatalogManifest(payload) {
  return Boolean(
    payload &&
      Array.isArray(payload.shards) &&
      (payload.format === PRODUCT_CATALOG_MANIFEST_FORMAT || payload.version === PRODUCT_CATALOG_MANIFEST_VERSION),
  );
}

export function splitProductCatalogPayload(payload, maxBytes = DEFAULT_PRODUCT_SHARD_MAX_BYTES) {
  const products = Array.isArray(payload?.products) ? payload.products : [];
  const safeMaxBytes = Math.min(
    HARD_MAX_PRODUCT_SHARD_BYTES,
    Math.max(1024, Number(maxBytes) || DEFAULT_PRODUCT_SHARD_MAX_BYTES),
  );
  const productGroups = [];
  let currentGroup = [];
  // Reserve the largest possible shard-index/count metadata while packing.
  // The final shard count is unknown until grouping is complete, so using the
  // default one-item metadata can put a boundary shard over the byte limit.
  const metadataUpperBound = products.length + 1;
  const emptyShard = serializeShard(payload, [], metadataUpperBound, metadataUpperBound);
  const shardBaseBytes = byteLength(emptyShard) - byteLength("[]");
  let currentBytes = shardBaseBytes;

  for (const product of products) {
    const serializedProduct = JSON.stringify(product) ?? "null";
    const candidateBytes =
      currentBytes + byteLength(serializedProduct) + (currentGroup.length ? byteLength(",") : 0);

    if (currentGroup.length && candidateBytes > safeMaxBytes) {
      productGroups.push(currentGroup);
      currentGroup = [product];
      currentBytes = shardBaseBytes + byteLength(serializedProduct);
      continue;
    }

    if (!currentGroup.length && candidateBytes > safeMaxBytes) {
      throw new Error(`Product ${product?.id || product?.handle || "record"} exceeds the ${safeMaxBytes}-byte shard limit`);
    }

    currentGroup.push(product);
    currentBytes = candidateBytes;
  }

  if (currentGroup.length || !productGroups.length) {
    productGroups.push(currentGroup);
  }

  const shardCount = productGroups.length;
  const shards = productGroups.map((group, shardIndex) => {
    const serialized = serializeShard(payload, group, shardIndex, shardCount);
    const bytes = byteLength(serialized);

    if (bytes > safeMaxBytes) {
      throw new Error(`Product shard ${shardIndex + 1} exceeds the ${safeMaxBytes}-byte shard limit`);
    }

    return {
      index: shardIndex,
      products: group,
      serialized,
      bytes,
    };
  });

  const files = shards.map((shard, index) => {
    const file = `products-${String(index + 1).padStart(4, "0")}.json`;
    return {
      file,
      path: `/data/${file}`,
      index,
      count: shard.products.length,
      bytes: shard.bytes,
    };
  });

  return {
    manifest: {
      format: PRODUCT_CATALOG_MANIFEST_FORMAT,
      version: PRODUCT_CATALOG_MANIFEST_VERSION,
      generatedAt: payload?.generatedAt || new Date().toISOString(),
      source: payload?.source || "/data/products.json",
      total: products.length,
      shardCount,
      shardMaxBytes: safeMaxBytes,
      shards: files,
    },
    shards,
  };
}

export function mergeProductShardPayloads(manifest, shardPayloads) {
  const orderedPayloads = [...(Array.isArray(shardPayloads) ? shardPayloads : [])].sort(
    (left, right) => Number(left?.shardIndex || 0) - Number(right?.shardIndex || 0),
  );
  const products = orderedPayloads.flatMap((payload) => (Array.isArray(payload?.products) ? payload.products : []));

  return {
    generatedAt: manifest?.generatedAt || orderedPayloads[0]?.generatedAt || new Date().toISOString(),
    source: manifest?.source || orderedPayloads[0]?.source || "/data/products.json",
    total: Number(manifest?.total) || products.length,
    products,
  };
}
