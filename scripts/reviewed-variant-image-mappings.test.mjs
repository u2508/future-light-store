import test from "node:test";
import assert from "node:assert/strict";
import { mergePublishedProductMedia } from "../src/lib/product-variant-image.mjs";
import {
  findReviewedVariantImage,
  REVIEWED_VARIANT_IMAGE_MAPPINGS,
} from "../src/lib/reviewed-variant-image-mappings.mjs";

const productId = "gid://shopify/Product/16323816259665";
const handle =
  "stainless-steel-windproof-clip-towel-rack-drying-rack-hook-windproof-socks-underwear-drying-rack-family-storage-laundry-rack";
const expectedAssignments = [
  ["Square 40 clips", "gid://shopify/MediaImage/73728923205713"],
  ["Square 30 clips", "gid://shopify/MediaImage/73728923238481"],
  ["Square 20 clips", "gid://shopify/MediaImage/73728923271249"],
  ["Round 20 clips", "gid://shopify/MediaImage/73728923304017"],
  ["Arc type 6 clips", "gid://shopify/MediaImage/73728923336785"],
];

function makeReviewedProduct() {
  const media = expectedAssignments.map(([title, id], index) => ({
    id,
    mediaContentType: "IMAGE",
    alt: title,
    image: {
      url: `https://cdn.shopify.com/reviewed/${index}.jpg`,
      altText: title,
    },
  }));
  return {
    product: {
      id: productId,
      handle,
      images: { edges: [] },
      media: { edges: media.map((node) => ({ node })) },
      variants: {
        edges: expectedAssignments.map(([title], index) => ({
          node: {
            id: `gid://shopify/ProductVariant/${index + 1}`,
            title,
            selectedOptions: [{ name: "Style", value: title }],
          },
        })),
      },
    },
    media,
  };
}

test("maps the five reviewed product variant titles to their exact MediaImage GIDs", () => {
  const review = REVIEWED_VARIANT_IMAGE_MAPPINGS.find((entry) => entry.productId === productId);
  assert.ok(review);
  assert.equal(review.handle, handle);
  assert.deepEqual(
    review.assignments.map(({ variantTitle, mediaId }) => [variantTitle, mediaId]),
    expectedAssignments,
  );

  const { product, media } = makeReviewedProduct();
  const merged = mergePublishedProductMedia(product, {
    productId,
    handle,
    images: media.map(({ id, image }) => ({ id, url: image.url, variantIds: [] })),
  });

  assert.deepEqual(
    merged.variants.edges.map(({ node }) => [node.title, node.image?.id, node.imageMappingStatus]),
    expectedAssignments.map(([title, mediaId]) => [title, mediaId, "reviewed"]),
  );
});

test("maps every manually inspected polka-dot claw clip option to its exact Shopify image", () => {
  const productId = "gid://shopify/Product/16322574057553";
  const handle =
    "women-vintage-large-size-hair-claw-clip-polka-dots-print-acrylic-shark-clip-simple-hairpin-elegant-hair-clips-hair-accessories";
  const assignments = [
    ["gid://shopify/ProductVariant/62684196470865", "Black with white polka dots", "gid://shopify/MediaImage/73719787126865", "https://cdn.shopify.com/s/files/1/1065/7008/8529/files/S49d7c21991b54d3fba202885e331cc16L.webp?v=1789811066"],
    ["gid://shopify/ProductVariant/62684196503633", "Ivory with brown polka dots", "gid://shopify/MediaImage/73719787159633", "https://cdn.shopify.com/s/files/1/1065/7008/8529/files/S7094ee0514a94b47acef7414b656b19fC.webp?v=1789811066"],
    ["gid://shopify/ProductVariant/62684196536401", "Ivory with black polka dots", "gid://shopify/MediaImage/73719787192401", "https://cdn.shopify.com/s/files/1/1065/7008/8529/files/Saf049ba39b8646ce9f6e1d5042a48408V.webp?v=1789811066"],
    ["gid://shopify/ProductVariant/62684196569169", "Burgundy with white polka dots", "gid://shopify/MediaImage/73719787225169", "https://cdn.shopify.com/s/files/1/1065/7008/8529/files/S0842bf79b8884bf3b196ee01d1a004e5n.webp?v=1789811066"],
    ["gid://shopify/ProductVariant/62684196601937", "Deep brown with pale pink polka dots", "gid://shopify/MediaImage/73719787257937", "https://cdn.shopify.com/s/files/1/1065/7008/8529/files/S803daa6b325945a483ecc35709c1a6abg.webp?v=1789811066"],
  ];
  const media = assignments.map(([, title, id, url]) => ({
    id,
    mediaContentType: "IMAGE",
    alt: title,
    image: { url, altText: title },
  }));
  const product = {
    id: productId,
    handle,
    options: [{ name: "Color", values: assignments.map(([, title]) => title) }],
    images: { edges: [] },
    media: { edges: media.map((node) => ({ node })) },
    variants: {
      edges: assignments.map(([id, title]) => ({
        node: { id, title, selectedOptions: [{ name: "Color", value: title }] },
      })),
    },
  };
  const merged = mergePublishedProductMedia(product, {
    productId,
    handle,
    images: media.map(({ id, image }) => ({ id, url: image.url, variantIds: [] })),
  });

  assert.deepEqual(
    merged.variants.edges.map(({ node }) => [
      node.selectedOptions[0].value,
      node.image?.id,
      node.image?.url,
      node.imageMappingStatus,
    ]),
    assignments.map(([, title, id, url]) => [title, id, url, "reviewed"]),
  );
});

test("requires the exact reviewed product, handle, variant title, and media ID", () => {
  const { product, media } = makeReviewedProduct();
  const variant = product.variants.edges[0].node;
  const images = media.map(({ id, image }) => ({ id, url: image.url }));

  assert.equal(
    findReviewedVariantImage(product, variant, images).image.id,
    expectedAssignments[0][1],
  );
  assert.equal(
    findReviewedVariantImage({ ...product, id: "gid://shopify/Product/1" }, variant, images).found,
    false,
  );
  assert.equal(
    findReviewedVariantImage({ ...product, handle: "another-product" }, variant, images).found,
    false,
  );
  assert.equal(
    findReviewedVariantImage(product, { ...variant, title: "square 40 clips" }, images).found,
    false,
  );
  assert.equal(findReviewedVariantImage(product, variant, images.slice(1)).image, null);
});

test("unlocks smart-glasses lens variants only against their exact reviewed Shopify media", () => {
  const glassesId = "gid://shopify/Product/16022608117841";
  const glassesHandle =
    "2026-new-smart-bluetooth-sunglasses-glasses-wireless-call-outdoor-sports-headphones-waterproof-smart-glasses-for-men-and-women";
  const assignments = [
    [
      "gid://shopify/ProductVariant/60385364607057",
      "Black frame · Clear lenses",
      "gid://shopify/MediaImage/72062686560337",
      "https://cdn.shopify.com/s/files/1/1065/7008/8529/files/S9aaa134767fd494eadfdc49cfb76306dZ.webp",
    ],
    [
      "gid://shopify/ProductVariant/60385364639825",
      "Black frame · Dark lenses",
      "gid://shopify/MediaImage/72062686593105",
      "https://cdn.shopify.com/s/files/1/1065/7008/8529/files/S7306d1220b2942029ee68c2de275de5fM.webp",
    ],
  ];
  const media = assignments.map(([variantId, title, mediaId, url]) => ({
    id: mediaId,
    mediaContentType: "IMAGE",
    alt: title,
    image: { url, altText: title },
    variantIds: [variantId],
  }));
  const product = {
    id: glassesId,
    handle: glassesHandle,
    options: [{ name: "Color" }],
    images: { edges: [] },
    media: { edges: media.map((node) => ({ node })) },
    variants: {
      edges: assignments.map(([id, title]) => ({
        node: { id, title, selectedOptions: [{ name: "Color", value: title }] },
      })),
    },
  };
  const merged = mergePublishedProductMedia(product, {
    productId: glassesId,
    handle: glassesHandle,
    images: media.map(({ id, image, variantIds }) => ({
      id,
      url: image.url,
      variantIds,
    })),
  });

  assert.deepEqual(
    merged.variants.edges.map(({ node }) => [node.image?.id, node.imageMappingStatus]),
    assignments.map(([, , mediaId]) => [mediaId, "reviewed"]),
  );
  assert.equal(merged.variants.edges[0].node.image.url, assignments[0][3]);
  assert.equal(merged.variants.edges[1].node.image.url, assignments[1][3]);
});

test("maps only the manually reviewed blue smartwatch variant to its cleaned product image", () => {
  const productId = "gid://shopify/Product/16022003613777";
  const handle =
    "2026-new-650nm-laser-therapy-health-smartwatch-men-ecg-blood-pressure-lipid-uric-acid-bluetooth-call-smart-watch-for-android-ios";
  const variantId = "gid://shopify/ProductVariant/60383035195473";
  const mediaId = "gid://shopify/MediaImage/73810414501969";
  const imageUrl =
    "https://cdn.shopify.com/s/files/1/1065/7008/8529/files/vs-store-square-smartwatch-blue-band.png?v=1790570464";
  const product = {
    id: productId,
    handle,
    variants: { edges: [{ node: {
      id: variantId,
      title: "Blue",
      selectedOptions: [{ name: "Band style", value: "Blue" }],
    } }] },
  };
  const images = [{ id: mediaId, url: imageUrl }];

  assert.deepEqual(findReviewedVariantImage(product, product.variants.edges[0].node, images), {
    found: true,
    image: images[0],
  });

  const merged = mergePublishedProductMedia(
    {
      ...product,
      options: [{ name: "Band style", values: ["Blue"] }],
      images: { edges: [{ node: { id: mediaId, url: imageUrl, altText: "Blue smartwatch" } }] },
      media: {
        edges: [{ node: {
          id: mediaId,
          mediaContentType: "IMAGE",
          image: { id: mediaId, url: imageUrl, altText: "Blue smartwatch" },
        } }],
      },
    },
    {
      productId: "16022003613777",
      handle,
      images: [{ id: "70241736327249", url: imageUrl, variantIds: ["60383035195473"] }],
    },
  );
  assert.equal(merged.variants.edges[0].node.image?.url, imageUrl);
  assert.equal(merged.variants.edges[0].node.imageMappingStatus, "reviewed");
  assert.equal(
    findReviewedVariantImage(product, { ...product.variants.edges[0].node, id: "gid://shopify/ProductVariant/other" }, images).found,
    false,
  );
});
