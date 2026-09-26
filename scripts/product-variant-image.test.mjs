import test from "node:test";
import assert from "node:assert/strict";
import {
  mergePublishedProductMedia,
  selectVariantGalleryIndex,
} from "../src/lib/product-variant-image.mjs";

test("uses an exact variant image when it exists in the product gallery", () => {
  assert.equal(
    selectVariantGalleryIndex(["/product-main.jpg", "/blue-variant.jpg"], "/blue-variant.jpg"),
    1,
  );
});

test("falls back to this product's primary image when a variant has no exact image", () => {
  assert.equal(selectVariantGalleryIndex(["/product-main.jpg", "/other.jpg"], null), 0);
  assert.equal(selectVariantGalleryIndex(["/product-main.jpg", "/other.jpg"], "/unmapped.jpg"), 0);
  assert.equal(selectVariantGalleryIndex([], "/unmapped.jpg"), 0);
});

function walletProduct() {
  const primary = { url: "https://cdn.shopify.com/wallet/main.jpg?v=1", altText: "Wallet" };
  return {
    id: "gid://shopify/Product/42",
    handle: "leather-wallet",
    images: { edges: [{ node: primary }] },
    variants: {
      edges: [
        {
          node: {
            id: "gid://shopify/ProductVariant/501",
            image: primary,
            selectedOptions: [{ name: "Color", value: "Black" }],
          },
        },
        {
          node: {
            id: "gid://shopify/ProductVariant/502",
            image: primary,
            selectedOptions: [{ name: "Color", value: "Dark Brown" }],
          },
        },
      ],
    },
  };
}

test("merges all published images and honors exact Shopify variant IDs", () => {
  const product = walletProduct();
  const merged = mergePublishedProductMedia(product, {
    productId: "42",
    handle: "leather-wallet",
    images: [
      { url: "https://cdn.shopify.com/wallet/main.jpg?v=2", variantIds: [] },
      { url: "https://cdn.shopify.com/wallet/black.jpg", variantIds: ["501"] },
      {
        url: "https://cdn.shopify.com/wallet/dark-brown.jpg",
        variantIds: ["gid://shopify/ProductVariant/502"],
      },
    ],
  });

  assert.equal(merged.images.edges.length, 3);
  assert.match(merged.variants.edges[0].node.image.url, /black\.jpg$/);
  assert.match(merged.variants.edges[1].node.image.url, /dark-brown\.jpg$/);
});

test("infers only a unique, exact color phrase from image metadata", () => {
  const product = walletProduct();
  const merged = mergePublishedProductMedia(product, {
    productId: "42",
    handle: "leather-wallet",
    images: [
      { url: "https://cdn.shopify.com/wallet/main.jpg", altText: "Wallet", variantIds: [] },
      {
        url: "https://cdn.shopify.com/wallet/wallet-dark-brown.jpg",
        altText: "Dark Brown Wallet",
        variantIds: [],
      },
    ],
  });

  assert.match(merged.variants.edges[1].node.image.url, /dark-brown\.jpg$/);
  assert.equal(merged.variants.edges[0].node.image, null);
});

test("does not infer when an option phrase matches multiple images or product identity differs", () => {
  const product = walletProduct();
  const ambiguous = mergePublishedProductMedia(product, {
    productId: "42",
    handle: "leather-wallet",
    images: [
      { url: "https://cdn.shopify.com/wallet/main.jpg", variantIds: [] },
      { url: "https://cdn.shopify.com/wallet/dark-brown-wallet-front.jpg", variantIds: [] },
      { url: "https://cdn.shopify.com/wallet/dark-brown-wallet-inside.jpg", variantIds: [] },
    ],
  });
  assert.equal(ambiguous.variants.edges[1].node.image, null);

  const mismatched = mergePublishedProductMedia(product, {
    productId: "43",
    handle: "leather-wallet",
    images: [{ url: "https://cdn.shopify.com/wallet/not-this-product.jpg", variantIds: ["501"] }],
  });
  assert.equal(mismatched, product);
});
