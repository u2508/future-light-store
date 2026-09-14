import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";

export const SHOP = {
  id: "gid://shopify/Shop/106570088529",
  myshopifyDomain: "vs-future-store-0jl2t-jxu6tnr3.myshopify.com",
};
export const INTERNAL = ["classification-review", "classification-fallback"];
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const imageKey = (image) =>
  JSON.stringify(image ? { url: image.url, altText: image.altText ?? null } : null);
export function fingerprint(manifest) {
  return hash(
    JSON.stringify({ shop: manifest.shop, excluded: manifest.excluded, targets: manifest.targets }),
  );
}
export function assertShop(shop) {
  if (shop?.id !== SHOP.id || shop?.myshopifyDomain !== SHOP.myshopifyDomain)
    throw new Error("Unexpected Shopify store; stopped before mutation.");
}
export function jpegSize(buffer) {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) throw new Error("Expected a JPEG file");
  let i = 2;
  while (i + 8 < buffer.length) {
    if (buffer[i++] !== 0xff) throw new Error("Malformed JPEG marker");
    let marker = buffer[i++];
    while (marker === 0xff) marker = buffer[i++];
    if (marker === 0xd9 || marker === 0xda) break;
    const length = buffer.readUInt16BE(i);
    if (length < 2 || i + length > buffer.length) throw new Error("Truncated JPEG");
    if ([0xc0, 0xc1, 0xc2].includes(marker))
      return { width: buffer.readUInt16BE(i + 5), height: buffer.readUInt16BE(i + 3) };
    i += length;
  }
  throw new Error("JPEG dimensions not found");
}
export function assetPath(root, file) {
  const dir = resolve(root, "src/assets/collection-artwork");
  const path = resolve(root, file);
  if (
    !path.startsWith(dir + sep) ||
    relative(dir, path).includes(sep) ||
    !/^[a-z0-9-]+\.jpg$/.test(relative(dir, path))
  )
    throw new Error("Artwork path is outside the approved directory");
  return path;
}
export async function validateFiles(root, manifest) {
  assertShop(manifest.shop);
  if (fingerprint(manifest) !== manifest.fingerprint)
    throw new Error("Manifest fingerprint mismatch");
  const ids = new Set(),
    handles = new Set(),
    hashes = new Set();
  for (const target of manifest.targets) {
    if (
      ids.has(target.id) ||
      handles.has(target.handle) ||
      hashes.has(target.sha256) ||
      INTERNAL.includes(target.handle)
    )
      throw new Error("Duplicate or internal artwork target");
    ids.add(target.id);
    handles.add(target.handle);
    hashes.add(target.sha256);
    const file = await readFile(assetPath(root, target.file));
    const dimensions = jpegSize(file);
    if (
      hash(file) !== target.sha256 ||
      file.length !== target.bytes ||
      dimensions.width !== 1536 ||
      dimensions.height !== 1024
    )
      throw new Error(`Artwork changed or invalid: ${target.handle}`);
  }
}
export function assertLiveTargets(manifest, live, state = { items: {} }) {
  assertShop(live.shop);
  if (live.collections.pageInfo.hasNextPage) throw new Error("Incomplete live inventory");
  const expected = [...manifest.targets, ...manifest.excluded];
  const current = live.collections.nodes;
  if (
    current.length !== expected.length ||
    expected.some((e) => !current.some((c) => c.id === e.id && c.handle === e.handle))
  )
    throw new Error("Collection inventory changed; review a fresh manifest");
  for (const row of manifest.targets) {
    const now = current.find((c) => c.id === row.id);
    const entry = state.items[row.id];
    const expectedImage = entry?.afterImage || row.beforeImage;
    if (imageKey(now.image) !== imageKey(expectedImage))
      throw new Error(`Image changed outside this rollout: ${row.handle}`);
  }
}
export async function prepareManifest(root) {
  const raw = JSON.parse(
    await readFile(resolve(root, "output/banner-live-inventory.json"), "utf8"),
  );
  const inventory = raw.data ?? raw;
  assertShop(inventory.shop);
  if (inventory.collections.pageInfo.hasNextPage) throw new Error("Incomplete inventory snapshot");
  const generation = JSON.parse(
    await readFile(resolve(root, "docs/collection-artwork-generation.json"), "utf8"),
  );
  const receipts = new Map(generation.receipts.map((r) => [r.handle, r]));
  const receiptDir = resolve(root, "output/collection-artwork-receipts");
  for (const file of await readdir(receiptDir).catch((e) => {
    if (e.code === "ENOENT") return [];
    throw e;
  })) {
    if (file.endsWith(".json")) {
      const r = JSON.parse(await readFile(resolve(receiptDir, file), "utf8"));
      receipts.set(r.handle, r);
    }
  }
  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    shop: SHOP,
    excluded: [],
    targets: [],
  };
  for (const c of inventory.collections.nodes) {
    if (INTERNAL.includes(c.handle)) {
      manifest.excluded.push({
        id: c.id,
        handle: c.handle,
        reason: "Internal classification queue; not customer-facing",
      });
      continue;
    }
    const receipt = receipts.get(c.handle);
    if (!receipt?.prompt || !receipt.source)
      throw new Error(`Missing generation receipt: ${c.handle}`);
    const file = `src/assets/collection-artwork/${c.handle}.jpg`;
    const bytes = await readFile(assetPath(root, file));
    manifest.targets.push({
      id: c.id,
      handle: c.handle,
      title: c.title,
      productCount: c.productsCount.count,
      beforeImage: c.image,
      file,
      sha256: hash(bytes),
      bytes: bytes.length,
      ...jpegSize(bytes),
      altText: `${c.title} — VS Store collection artwork`,
    });
  }
  manifest.fingerprint = fingerprint(manifest);
  await validateFiles(root, manifest);
  return {
    manifest,
    generation: { shop: SHOP, receipts: manifest.targets.map((t) => receipts.get(t.handle)) },
  };
}
