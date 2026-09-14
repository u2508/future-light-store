import test from "node:test";
import assert from "node:assert/strict";
import {
  SHOP,
  assertShop,
  assertLiveTargets,
  assetPath,
  fingerprint,
  jpegSize,
} from "./lib/collection-banner-manifest.mjs";

const before = { url: "https://cdn.shopify.com/old.jpg", altText: "Old" };
const target = {
  id: "gid://shopify/Collection/1",
  handle: "new-arrivals",
  beforeImage: before,
  sha256: "abc",
  file: "src/assets/collection-artwork/new-arrivals.jpg",
};
const manifest = () => ({
  shop: SHOP,
  targets: [structuredClone(target)],
  excluded: [{ id: "gid://shopify/Collection/2", handle: "classification-review" }],
});
const live = () => ({
  shop: SHOP,
  collections: {
    nodes: [
      { id: target.id, handle: target.handle, image: before },
      { id: "gid://shopify/Collection/2", handle: "classification-review", image: null },
    ],
    pageInfo: { hasNextPage: false },
  },
});

test("requires exact permanent store identity", () => {
  assert.doesNotThrow(() => assertShop(SHOP));
  assert.throws(() => assertShop({ ...SHOP, id: "gid://shopify/Shop/999" }));
  assert.throws(() => assertShop({ ...SHOP, myshopifyDomain: "another.myshopify.com" }));
});
test("refuses path traversal and unrelated asset paths", () => {
  assert.equal(assetPath("/workspace", target.file), "/workspace/" + target.file);
  for (const path of [
    "/etc/passwd",
    "src/assets/collection-artwork/../secret.jpg",
    "src/assets/collection-artwork/nested/file.jpg",
  ])
    assert.throws(() => assetPath("/workspace", path));
});
test("fingerprint binds images, previous state and exact target IDs", () => {
  const a = manifest();
  const original = fingerprint(a);
  a.targets[0].sha256 = "changed";
  assert.notEqual(fingerprint(a), original);
  a.targets[0].sha256 = "abc";
  a.targets[0].beforeImage = null;
  assert.notEqual(fingerprint(a), original);
  a.targets[0].beforeImage = before;
  a.targets[0].id = "different";
  assert.notEqual(fingerprint(a), original);
});
test("complete unchanged inventory passes", () =>
  assert.doesNotThrow(() => assertLiveTargets(manifest(), live())));
test("partial, added, removed and renamed collections stop rollout", () => {
  const partial = live();
  partial.collections.pageInfo.hasNextPage = true;
  const added = live();
  added.collections.nodes.push({ id: "extra", handle: "extra" });
  const removed = live();
  removed.collections.nodes.pop();
  const renamed = live();
  renamed.collections.nodes[0].handle = "changed";
  for (const value of [partial, added, removed, renamed])
    assert.throws(() => assertLiveTargets(manifest(), value));
});
test("merchant image changes cannot be overwritten silently", () => {
  const value = live();
  value.collections.nodes[0].image = {
    url: "https://cdn.shopify.com/merchant.jpg",
    altText: "New",
  };
  assert.throws(() => assertLiveTargets(manifest(), value));
});
test("resume accepts only the exact saved after-image", () => {
  const value = live();
  const afterImage = { url: "https://cdn.shopify.com/reviewed.jpg", altText: "Reviewed" };
  value.collections.nodes[0].image = afterImage;
  const state = { items: { [target.id]: { afterImage } } };
  assert.doesNotThrow(() => assertLiveTargets(manifest(), value, state));
  value.collections.nodes[0].image = before;
  assert.throws(() => assertLiveTargets(manifest(), value, state));
});
test("JPEG dimension reader rejects malformed input", () => {
  assert.throws(() => jpegSize(Buffer.from("not a jpeg")));
  assert.throws(() => jpegSize(Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0xff, 0xff, 0, 0, 0, 0, 0])));
  const data = Buffer.alloc(23);
  data.set([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 4, 0, 6, 0]);
  assert.deepEqual(jpegSize(data), { width: 1536, height: 1024 });
});
