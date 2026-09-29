import { assertEquals } from "jsr:@std/assert@1";
import { extractShopifyProductVariantMedia } from "../_shared/shopify-product-variant-media.ts";

const normalizeImageUrl = (value: unknown) =>
  typeof value === "string" ? value.replace(/^https:/, "https:").split("?")[0] : "";
const numericId = (value: unknown) =>
  String(value ?? "")
    .split("/")
    .pop()
    ?.match(/^\d+$/)?.[0] ?? "";

Deno.test(
  "associates the variant that owns featured_image when nested variant_ids are absent",
  () => {
    const images = extractShopifyProductVariantMedia(
      {
        images: ["https://cdn.shopify.com/products/main.jpg?v=1"],
        variants: [
          {
            id: "gid://shopify/ProductVariant/42",
            featured_image: {
              id: "gid://shopify/MediaImage/10",
              src: "https://cdn.shopify.com/products/blue.jpg?v=2",
              alt: "Blue version",
            },
          },
        ],
      },
      normalizeImageUrl,
      numericId,
    );

    assertEquals(images.length, 2);
    assertEquals(images[1], {
      id: "10",
      url: "https://cdn.shopify.com/products/blue.jpg",
      altText: "Blue version",
      variantIds: ["42"],
    });
  },
);

Deno.test("merges shared image ownership and deduplicates numeric and Shopify GID ids", () => {
  const images = extractShopifyProductVariantMedia(
    {
      images: [
        {
          id: 10,
          src: "https://cdn.shopify.com/products/shared.jpg?v=1",
          alt: "Shared photo",
          variant_ids: [42],
        },
      ],
      variants: [
        {
          id: 42,
          featured_image: {
            id: 10,
            src: "https://cdn.shopify.com/products/shared.jpg?v=2",
            variant_ids: ["gid://shopify/ProductVariant/42", 43],
          },
        },
        {
          id: "gid://shopify/ProductVariant/43",
          featured_image: {
            id: 10,
            src: "https://cdn.shopify.com/products/shared.jpg?v=3",
            variant_ids: [42],
          },
        },
      ],
    },
    normalizeImageUrl,
    numericId,
  );

  assertEquals(images, [
    {
      id: "10",
      url: "https://cdn.shopify.com/products/shared.jpg",
      altText: "Shared photo",
      variantIds: ["42", "43"],
    },
  ]);
});

Deno.test("accepts object-form image entries and ignores variants without featured images", () => {
  const images = extractShopifyProductVariantMedia(
    {
      images: [{ id: 8, url: "https://cdn.shopify.com/products/front.jpg", alt: "Front" }],
      variants: [{ id: 77, featured_image: null }],
    },
    normalizeImageUrl,
    numericId,
  );

  assertEquals(images, [
    {
      id: "8",
      url: "https://cdn.shopify.com/products/front.jpg",
      altText: "Front",
      variantIds: [],
    },
  ]);
});
