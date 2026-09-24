import test from "node:test";
import assert from "node:assert/strict";

import { buildFeedXml } from "./marketing-google-feed-preview.mjs";

test("builds escaped Merchant Center XML from live-shaped product data", () => {
  const xml = buildFeedXml([
    {
      id: "gid://shopify/Product/123",
      title: "Desk & Lamp",
      handle: "desk-lamp",
      descriptionHtml: "<p>Bright <strong>desk</strong> light</p>",
      vendor: "VS Store",
      onlineStoreUrl: "https://vs-store-us.myshopify.com/products/desk-lamp",
      featuredImage: { url: "https://cdn.example.test/lamp.jpg" },
      variants: {
        nodes: [
          {
            id: "gid://shopify/ProductVariant/456",
            title: "Black",
            price: "29.99",
            inventoryQuantity: 4,
          },
        ],
      },
    },
  ]);

  assert.match(xml, /<g:id>456<\/g:id>/);
  assert.match(xml, /Desk &amp; Lamp — Black/);
  assert.match(xml, /<g:availability>in stock<\/g:availability>/);
  assert.match(xml, /<g:price>29\.99 USD<\/g:price>/);
  assert.match(xml, /Bright desk light/);
});

test("refuses unknown inventory instead of advertising stale availability", () => {
  assert.throws(
    () =>
      buildFeedXml([
        {
          id: "gid://shopify/Product/123",
          title: "Unknown stock",
          descriptionHtml: "Description",
          vendor: "VS Store",
          onlineStoreUrl: "https://example.test/p/unknown-stock",
          featuredImage: { url: "https://cdn.example.test/unknown.jpg" },
          variants: {
            nodes: [
              {
                id: "gid://shopify/ProductVariant/456",
                title: "Default Title",
                price: "29.99",
                inventoryQuantity: null,
              },
            ],
          },
        },
      ]),
    /inventory is unknown/,
  );
});
