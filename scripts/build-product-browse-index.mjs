#!/usr/bin/env node

import { readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readFreshLiveCatalogSnapshot } from "./lib/live-catalog-assertion.mjs";

const dataDir = resolve(process.cwd(), "public", "data");
const outputPattern = /^product-browse-\d{4}\.json$/;
const maxShardBytes = 1 * 1024 * 1024;
const maxShardProducts = 48;

function compactProduct(product) {
  const images = Array.isArray(product?.images) ? product.images : [];
  const firstImage = product?.image || images[0] || null;
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  return {
    id: product?.id ?? null,
    legacyResourceId: product?.legacyResourceId ?? product?.id ?? null,
    handle: product?.handle ?? "",
    title: product?.title ?? "",
    vendor: product?.vendor ?? "",
    product_type: product?.product_type ?? product?.productType ?? "",
    productType: product?.productType ?? product?.product_type ?? "",
    tags: Array.isArray(product?.tags) ? product.tags : [],
    updated_at: product?.updated_at ?? product?.updatedAt ?? "",
    images: firstImage ? [{ src: firstImage.src ?? "", alt: firstImage.alt ?? null }] : [],
    image: firstImage ? { src: firstImage.src ?? "", alt: firstImage.alt ?? null } : null,
    options: Array.isArray(product?.options) ? product.options : [],
    variants: variants.map((variant) => ({
      id: variant?.id ?? null,
      legacyResourceId: variant?.legacyResourceId ?? variant?.id ?? null,
      title: variant?.title ?? "Default Title",
      price: variant?.price ?? "0",
      compare_at_price: variant?.compare_at_price ?? null,
      available: Boolean(variant?.available),
      inventory_quantity: variant?.inventory_quantity ?? null,
    })),
  };
}

function serializeShard(generatedAt, source, total, shardIndex, shardCount, products) {
  return JSON.stringify({ generatedAt, source, total, shardIndex, shardCount, products });
}

async function main() {
  const { products: productsPayload } = await readFreshLiveCatalogSnapshot(dataDir, {
    context: "product browse build catalog",
  });
  const products = Array.isArray(productsPayload?.products) ? productsPayload.products : [];
  const generatedAt = productsPayload.generatedAt;
  const source = productsPayload.source;

  const compactProducts = products
    .map(compactProduct)
    .filter(
      (product) => product.id && product.handle && product.title && product.variants.length > 0,
    );
  const groups = [];
  let group = [];
  let groupBytes = 0;
  for (const product of compactProducts) {
    const productBytes = Buffer.byteLength(JSON.stringify(product));
    if (
      group.length &&
      (groupBytes + productBytes + 1 > maxShardBytes || group.length >= maxShardProducts)
    ) {
      groups.push(group);
      group = [];
      groupBytes = 0;
    }
    group.push(product);
    groupBytes += productBytes + (group.length > 1 ? 1 : 0);
  }
  if (group.length || groups.length === 0) groups.push(group);

  for (const file of (await readdir(dataDir)).filter((file) => outputPattern.test(file))) {
    await rm(resolve(dataDir, file), { force: true });
  }

  const shardCount = groups.length;
  const shards = groups.map((groupProducts, index) => {
    const file = `product-browse-${String(index + 1).padStart(4, "0")}.json`;
    const serialized = serializeShard(
      generatedAt,
      source,
      compactProducts.length,
      index,
      shardCount,
      groupProducts,
    );
    return {
      file,
      path: `/data/${file}`,
      index,
      count: groupProducts.length,
      bytes: Buffer.byteLength(serialized),
      serialized,
    };
  });

  await Promise.all(
    shards.map((shard) => writeFile(resolve(dataDir, shard.file), shard.serialized, "utf8")),
  );
  await writeFile(
    resolve(dataDir, "product-browse.json"),
    JSON.stringify({
      format: "salt-product-browse-shards",
      version: 1,
      generatedAt,
      source,
      total: compactProducts.length,
      shardCount,
      shardMaxBytes: maxShardBytes,
      shardMaxProducts: maxShardProducts,
      shards: shards.map(({ serialized, ...shard }) => shard),
    }),
    "utf8",
  );
  process.stdout.write(
    `Saved ${compactProducts.length} compact browse products across ${shardCount} shards\n`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
