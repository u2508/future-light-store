import { describe, expect, it } from "vitest";
import { buildProductSearchPayload } from "./product-search-index.mjs";

describe("buildProductSearchPayload", () => {
  it("keeps the fields needed for search while dropping the full catalog payload", () => {
    const payload = buildProductSearchPayload({
      generatedAt: "2026-07-13T00:00:00.000Z",
      source: "https://example.myshopify.com",
      products: [
        {
          id: 42,
          title: "Garden Tool Set",
          handle: "garden-tool-set",
          body_html: "<p>A durable tool set for every garden.</p>",
          vendor: "SALT",
          product_type: "Garden",
          tags: ["garden", "tools"],
          created_at: "2026-01-01T00:00:00.000Z",
          published_at: "2026-01-02T00:00:00.000Z",
          updated_at: "2026-01-03T00:00:00.000Z",
          variants: [
            { id: 2, title: "Large", price: "24.99", compare_at_price: "29.99", available: true },
            { id: 1, title: "Small", price: "14.99", compare_at_price: null, available: true },
          ],
          images: [
            { id: 9, src: "https://cdn.shopify.com/garden.jpg", alt: "Garden tools", variant_ids: [1, 2] },
            { id: 10, src: "https://cdn.shopify.com/extra.jpg", alt: "Extra" },
          ],
          customData: { searchProductBoosts: ["outdoor essentials"] },
        },
      ],
    });

    expect(payload.total).toBe(1);
    expect(payload.products[0]).toMatchObject({
      id: 42,
      handle: "garden-tool-set",
      body_html: "A durable tool set for every garden.",
      variants: [{ id: 1, price: "14.99" }],
      images: [{ id: 9, src: "https://cdn.shopify.com/garden.jpg", alt: "Garden tools" }],
      customData: { searchProductBoosts: ["outdoor essentials"] },
    });
    expect(payload.products[0].images).toHaveLength(1);
    expect(payload.products[0].variants).toHaveLength(1);
    expect(payload.products[0].images[0]).not.toHaveProperty("variant_ids");
    expect(payload.products[0].knowledge).toMatchObject({
      familyId: "travel-outdoor",
      leafType: "garden",
    });
    expect(payload.products[0].knowledge.searchTerms).toContain("garden");
  });
});
