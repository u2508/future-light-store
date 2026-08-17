import { describe, expect, it } from "vitest";
import {
  buildHomeFeaturedProductsPayload,
  productsFromCollection,
  selectQuirkyGiftPicks,
} from "./home-featured-products.mjs";

function product(id, title, handle, tags, price = "19.99") {
  return {
    id,
    title,
    handle,
    tags,
    images: [{ src: `https://cdn.shopify.com/${handle}.webp` }],
    variants: [{ price, compare_at_price: "29.99" }],
  };
}

describe("home featured products", () => {
  it("selects unique, catalog-backed quirky gift picks", () => {
    const products = [
      product(1, "Glow Lamp", "glow-lamp", ["unique gift"]),
      product(2, "Birthday Candle", "birthday-candle", ["gift"]),
      product(3, "Desktop Fountain", "desktop-fountain", ["home decor"]),
      product(4, "Party Game", "party-game", ["fun novelty"]),
      product(5, "Bottle Opener", "bottle-opener", ["kitchen gadget"]),
      product(6, "Decor Flower Pot", "decor-flower-pot", ["decor"]),
      product(7, "Decor Flower Pot", "decor-flower-pot-duplicate", ["decor"]),
    ];

    const picks = selectQuirkyGiftPicks(products, 12);

    expect(picks).toHaveLength(6);
    expect(new Set(picks.map((pick) => pick.id)).size).toBe(6);
    expect(new Set(picks.map((pick) => pick.title)).size).toBe(6);
    expect(picks.every((pick) => pick.handle && pick.image && pick.price > 0)).toBe(true);
  });

  it("creates a compact payload from the live catalog snapshot", () => {
    const payload = buildHomeFeaturedProductsPayload({
      generatedAt: "2026-07-13T00:00:00.000Z",
      source: "https://example.myshopify.com",
      products: [product(1, "Novelty Gift", "novelty-gift", ["gift novelty"])],
    });

    expect(payload).toMatchObject({
      generatedAt: "2026-07-13T00:00:00.000Z",
      source: "https://example.myshopify.com",
      total: 1,
      bestSellerProducts: [],
      quirkyGiftPicks: [{ id: 1, handle: "novelty-gift", price: 19.99 }],
      everydayEssentialProducts: [],
    });
  });

  it("keeps every homepage rail inside its declared Shopify collection and collection order", () => {
    const products = [
      product(1, "Best Gift", "best-gift", ["gift"]),
      product(2, "Garden Tool", "garden-tool", ["garden tool"]),
      product(3, "Quirky Gift", "quirky-gift", ["unique gift"]),
      product(4, "Not Selected", "not-selected", ["gift"]),
    ];
    const payload = buildHomeFeaturedProductsPayload(
      { generatedAt: "2026-07-17T00:00:00.000Z", source: "shopify", products },
      {
        collections: {
          "appplaza-best-sellers": { productIds: [1] },
          gifts: { productIds: [3, 1] },
          "garden-tools": { productIds: [2] },
        },
      },
    );

    expect(payload.bestSellerProducts.map((entry) => entry.id)).toEqual([1]);
    expect(payload.quirkyGiftPicks.map((entry) => entry.id)).toEqual([3, 1]);
    expect(payload.everydayEssentialProducts.map((entry) => entry.id)).toEqual([2]);
    expect(JSON.stringify(payload)).not.toContain("not-selected");
  });

  it("prefers configured bestseller picks before falling back to the collection order", () => {
    const products = [
      product(1, "Fallback Best Seller", "fallback-best-seller", ["best seller"], "59.99"),
      product(2, "Preferred Perfume", "preferred-perfume", ["best seller"], "79.99"),
      product(3, "Fallback Best Seller 2", "fallback-best-seller-2", ["best seller"], "89.99"),
    ];

    const picked = productsFromCollection(
      products,
      {
        collections: {
          "appplaza-best-sellers": { productIds: [1, 3] },
        },
      },
      "appplaza-best-sellers",
      3,
      [{ titleIncludes: ["preferred perfume"], price: 79.99 }],
    );

    expect(picked.map((entry) => entry.id)).toEqual([2, 1, 3]);
  });
});
