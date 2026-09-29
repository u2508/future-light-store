import test from "node:test";
import assert from "node:assert/strict";
import {
  getProductGalleryImages,
  mergePublishedProductMedia,
  selectGalleryImageForDisplay,
  selectVariantGalleryIndex,
} from "../src/lib/product-variant-image.mjs";
import { REVIEWED_VARIANT_IMAGE_MAPPINGS } from "../src/lib/reviewed-variant-image-mappings.mjs";
import { hasImageBearingOption } from "../src/lib/product-variant-selection.mjs";

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

test("matches the same Shopify CDN image across protocol and resize query differences", () => {
  assert.equal(
    selectVariantGalleryIndex(
      [
        "https://cdn.shopify.com/s/files/1/1234/files/main.jpg?v=1",
        "https://cdn.shopify.com/s/files/1/1234/files/blue.jpg?width=1200&v=2",
      ],
      "//cdn.shopify.com/s/files/1/1234/files/blue.jpg?width=300&v=2#preview",
    ),
    1,
  );
});

test("shows a product-gallery preview while an exact variant photo is held", () => {
  const primary = { url: "/product-main.jpg" };
  const unverified = { url: "/unverified-variant.jpg" };
  assert.equal(selectGalleryImageForDisplay([primary, unverified], 0), primary);
});

test("uses another working gallery image when the preferred image failed", () => {
  const failed = { url: "/broken.jpg" };
  const available = { url: "/available.jpg" };
  assert.equal(
    selectGalleryImageForDisplay([failed, available], 0, new Set([failed.url])),
    available,
  );
  assert.equal(selectGalleryImageForDisplay([failed], 0, new Set([failed.url])), null);
});

test("keeps canonical MediaImage IDs when duplicate legacy and variant images share a URL", () => {
  const url = "https://cdn.shopify.com/files/watch-band-finish.webp?v=2";
  const product = {
    images: { edges: [{ node: { id: "gid://shopify/ProductImage/100", url } }] },
    media: {
      edges: [
        {
          node: {
            id: "gid://shopify/MediaImage/200",
            mediaContentType: "IMAGE",
            image: { id: "gid://shopify/ImageSource/200", url },
          },
        },
      ],
    },
  };
  const gallery = getProductGalleryImages(product, [
    { image: { id: "gid://shopify/ProductImage/100", url } },
  ]);

  assert.equal(gallery.length, 1);
  assert.equal(gallery[0].id, "gid://shopify/MediaImage/200");
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

test("does not infer a variant mapping from a filename or alt-text color phrase", () => {
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

  assert.equal(merged.variants.edges[1].node.image, null);
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

test("fails closed when Shopify reports conflicting image associations for one variant", () => {
  const product = walletProduct();
  product.variants.edges[0].node.image = {
    url: "https://cdn.shopify.com/wallet/stale-source-image.jpg",
  };
  const merged = mergePublishedProductMedia(product, {
    productId: "42",
    handle: "leather-wallet",
    images: [
      {
        url: "https://cdn.shopify.com/wallet/black-front.jpg",
        variantIds: ["501"],
      },
      {
        url: "https://cdn.shopify.com/wallet/black-inside.jpg?width=1200",
        variantIds: ["gid://shopify/ProductVariant/501"],
      },
    ],
  });

  assert.equal(merged.variants.edges[0].node.image, null);
});

test("does not fall back to an unverified Storefront image after published mapping readback", () => {
  const product = walletProduct();
  product.variants.edges[0].node.image = {
    url: "https://cdn.shopify.com/wallet/unverified-black.jpg",
  };
  const merged = mergePublishedProductMedia(product, {
    productId: "42",
    handle: "leather-wallet",
    images: [
      { url: "https://cdn.shopify.com/wallet/main.jpg", variantIds: [] },
      { url: "https://cdn.shopify.com/wallet/unverified-black.jpg", variantIds: [] },
    ],
  });

  assert.equal(merged.variants.edges[0].node.image, null);
});

test("uses the manually reviewed duffel images instead of Shopify's wrong variant links", () => {
  const productId = "gid://shopify/Product/16022022750289";
  const handle =
    "women-men-nylon-travel-duffel-bag-carry-on-luggage-bag-men-tote-large-capacity-weekender-gym-sport-holdall-overnight-bag-pouches";
  const url = (file) => `https://cdn.shopify.com/files/${file}.webp?v=1788683330`;
  const product = {
    id: productId,
    handle,
    images: { edges: [{ node: { url: url("primary") } }] },
    media: {
      edges: [
        {
          node: {
            id: "gid://shopify/MediaImage/72058621460561",
            mediaContentType: "IMAGE",
            image: { url: url("navy-image-7"), altText: "Navy duffel" },
          },
        },
        {
          node: {
            id: "gid://shopify/MediaImage/72058621526097",
            mediaContentType: "IMAGE",
            image: { url: url("black-exterior-image-9"), altText: "Black duffel" },
          },
        },
      ],
    },
    variants: {
      edges: [
        {
          node: {
            id: "gid://shopify/ProductVariant/60383152996433",
            selectedOptions: [{ name: "Color", value: "Navy" }],
            image: { url: url("wrong-gray-image-1") },
          },
        },
        {
          node: {
            id: "gid://shopify/ProductVariant/60383153029201",
            selectedOptions: [{ name: "Color", value: "Gray" }],
            image: { url: url("gray-image-2") },
          },
        },
        {
          node: {
            id: "gid://shopify/ProductVariant/60383153061969",
            selectedOptions: [{ name: "Color", value: "Black" }],
            image: { url: url("black-interior-image-3") },
          },
        },
      ],
    },
  };
  const publishedMedia = {
    productId,
    handle,
    images: [
      { id: "72058621263953", url: url("wrong-gray-image-1"), variantIds: ["60383152996433"] },
      { id: "72058621296721", url: url("gray-image-2"), variantIds: ["60383153029201"] },
      { id: "72058621329489", url: url("black-interior-image-3"), variantIds: ["60383153061969"] },
      { id: null, url: url("navy-image-7"), variantIds: [] },
      { id: null, url: url("black-exterior-image-9"), variantIds: [] },
    ],
  };

  const merged = mergePublishedProductMedia(product, publishedMedia);
  const variants = merged.variants.edges.map((edge) => edge.node);
  assert.match(variants[0].image.url, /navy-image-7/);
  assert.match(variants[1].image.url, /gray-image-2/);
  assert.match(variants[2].image.url, /black-exterior-image-9/);
  assert.equal(
    selectVariantGalleryIndex(
      merged.images.edges.map((edge) => edge.node.url),
      variants[0].image.url,
    ),
    1,
  );
});

test("visually reviewed wallet colors resolve when public JSON and Storefront use different image IDs", () => {
  const productId = "gid://shopify/Product/16322589392977";
  const handle =
    "mens-wallet-made-of-pu-wax-oil-skin-purse-for-men-coin-purse-short-male-card-holder-wallets-zipper-around-money-coin-purse-1";
  const galleryIds = [
    "70148525097041",
    "70148525097042",
    "70148525097043",
    "70148525097044",
    "70148525097045",
    "70148525097046",
    "70148525293649",
    "70148525326417",
  ];
  const reviewedUrls = REVIEWED_VARIANT_IMAGE_MAPPINGS.find(
    (entry) => entry.productId === productId,
  ).assignments;
  const galleryUrls = [
    reviewedUrls.find((assignment) => assignment.selectedOptions[0].value === "Light Brown")
      .imageUrl,
    "https://cdn.shopify.com/wallet/gallery-2.webp",
    "https://cdn.shopify.com/wallet/gallery-3.webp",
    "https://cdn.shopify.com/wallet/gallery-4.webp",
    "https://cdn.shopify.com/wallet/gallery-5.webp",
    "https://cdn.shopify.com/wallet/gallery-6.webp",
    reviewedUrls.find((assignment) => assignment.selectedOptions[0].value === "Black").imageUrl,
    reviewedUrls.find((assignment) => assignment.selectedOptions[0].value === "Dark Brown")
      .imageUrl,
  ];
  const media = galleryIds.map((id, index) => ({
    id: `gid://shopify/MediaImage/${id}`,
    mediaContentType: "IMAGE",
    image: { url: galleryUrls[index] },
  }));
  const product = {
    id: productId,
    handle,
    options: [{ name: "Color", values: ["Black", "Dark Brown", "Light Brown"] }],
    media: { edges: media.map((node) => ({ node })) },
    variants: {
      edges: [
        {
          node: {
            id: "gid://shopify/ProductVariant/62684224127057",
            selectedOptions: [{ name: "Color", value: "Black" }],
          },
        },
        {
          node: {
            id: "gid://shopify/ProductVariant/62684224159825",
            selectedOptions: [{ name: "Color", value: "Dark Brown" }],
          },
        },
        {
          node: {
            id: "gid://shopify/ProductVariant/62684224192593",
            selectedOptions: [{ name: "Color", value: "Light Brown" }],
          },
        },
      ],
    },
  };
  const merged = mergePublishedProductMedia(product, {
    productId,
    handle,
    images: galleryIds.map((id, index) => ({
      // Shopify's public product JSON returns legacy Image IDs, while the
      // Storefront gallery carries the product-owned MediaImage GID.
      id: String(800000 + index),
      url: galleryUrls[index].replace("?v=1789811443", "?width=1200"),
      variantIds: ["70148525293649", "70148525326417", "70148525097041"].includes(id)
        ? [
            id === "70148525293649"
              ? "62684224127057"
              : id === "70148525326417"
                ? "62684224159825"
                : "62684224192593",
          ]
        : [],
    })),
  });
  const variants = merged.variants.edges.map((edge) => edge.node);

  assert.deepEqual(
    variants.map((variant) => [variant.selectedOptions[0].value, variant.image?.id]),
    [
      ["Black", "gid://shopify/MediaImage/70148525293649"],
      ["Dark Brown", "gid://shopify/MediaImage/70148525326417"],
      ["Light Brown", "gid://shopify/MediaImage/70148525097041"],
    ],
  );
  assert.ok(variants.every((variant) => variant.imageMappingStatus === "reviewed"));
});

test("reviewed wallet colors still resolve when live Shopify image IDs differ and associations are absent", () => {
  const review = REVIEWED_VARIANT_IMAGE_MAPPINGS.find(
    (entry) => entry.productId === "gid://shopify/Product/16322589392977",
  );
  const galleryUrls = review.assignments.map((assignment) => assignment.imageUrl);
  const product = {
    id: review.productId,
    handle: review.handle,
    options: [{ name: "Color", values: ["Black", "Dark Brown", "Light Brown"] }],
    images: {
      edges: galleryUrls.map((url, index) => ({ node: { id: `product-image-${index}`, url } })),
    },
    variants: {
      edges: review.assignments.map((assignment) => ({
        node: {
          id: assignment.variantId,
          selectedOptions: assignment.selectedOptions,
        },
      })),
    },
  };
  const merged = mergePublishedProductMedia(product, {
    productId: "16322589392977",
    handle: review.handle,
    images: galleryUrls.map((url, index) => ({
      id: String(900000 + index),
      url: url.replace("?v=1789811443", "?width=1200"),
      variantIds: [],
    })),
  });
  const variants = merged.variants.edges.map((edge) => edge.node);

  assert.deepEqual(
    variants.map((variant) => [
      variant.selectedOptions[0].value,
      variant.image?.url?.split("?", 1)[0],
    ]),
    review.assignments.map((assignment) => [
      assignment.selectedOptions[0].value,
      assignment.imageUrl.split("?", 1)[0],
    ]),
  );
  assert.ok(variants.every((variant) => variant.imageMappingStatus === "reviewed"));
});

test("reviewed dog-toy colors override incorrect live links with the exact gallery photos", () => {
  const review = REVIEWED_VARIANT_IMAGE_MAPPINGS.find(
    (entry) => entry.productId === "gid://shopify/Product/15995848327249",
  );
  const gallery = [
    ["71944024588369", "Seaf63250cc3e450a89cdb606aecf9989D.webp", "Purple"],
    ["71944024490065", "Sd6a6bb6f38fc41429ec898a03eac6d07U.webp", "Yellow"],
    ["71944024522833", "S5bf6f9791aa0410190884c077ac9addad.webp", "Orange"],
    ["71944024555601", "Sc0e461d1f7f14c12a24c31f38c0e68f7i.webp", "Blue"],
  ].map(([id, file]) => ({
    id: `gid://shopify/MediaImage/${id}`,
    mediaContentType: "IMAGE",
    image: {
      url: `https://cdn.shopify.com/s/files/1/1065/7008/8529/files/${file}?v=1787715316`,
    },
  }));
  const product = {
    id: review.productId,
    handle: review.handle,
    options: [{ name: "Color", values: ["Purple", "Yellow", "Orange", "Blue"] }],
    media: { edges: gallery.map((node) => ({ node })) },
    variants: {
      edges: review.assignments.map((assignment) => ({
        node: {
          id: assignment.variantId,
          selectedOptions: assignment.selectedOptions,
        },
      })),
    },
  };
  const merged = mergePublishedProductMedia(product, {
    productId: "15995848327249",
    handle: review.handle,
    images: gallery.map((media, index) => ({
      id: String(910000 + index),
      url: media.image.url,
      // Simulate the incorrect live links observed on the product.
      variantIds: [review.assignments[(index + 1) % review.assignments.length].variantId],
    })),
  });
  const variants = merged.variants.edges.map((edge) => edge.node);

  assert.deepEqual(
    variants.map((variant) => [
      variant.selectedOptions[0].value,
      variant.image?.id,
      variant.imageMappingStatus,
    ]),
    review.assignments.map((assignment) => [
      assignment.selectedOptions[0].value,
      assignment.mediaId,
      "reviewed",
    ]),
  );
});

test("uses only the visually matched Synoke color photos and holds the unmatched grey option", () => {
  const productId = "gid://shopify/Product/15981540638801";
  const handle =
    "synoke-military-digital-watches-men-sports-luminous-chronograph-waterproof-male-electronic-wrist-watches-relogio-masculino";
  const gallery = [
    ["71874336129105", "military-green.jpg"],
    ["71874336161873", "white.jpg"],
    ["71874336194641", "black.jpg"],
    ["71874336030801", "wrong-black.jpg"],
  ];
  const product = {
    id: productId,
    handle,
    options: [{ name: "Color", values: ["Military Green", "white", "black", "Grey"] }],
    media: {
      edges: gallery.map(([id, file]) => ({
        node: {
          id: `gid://shopify/MediaImage/${id}`,
          mediaContentType: "IMAGE",
          image: { url: `https://cdn.shopify.com/synoke/${file}` },
        },
      })),
    },
    variants: {
      edges: [
        ["60076336283729", "Military Green", "wrong-black.jpg"],
        ["60076336316497", "white", "wrong-black.jpg"],
        ["60076336349265", "black", "wrong-black.jpg"],
        ["60076336382033", "Grey", "wrong-black.jpg"],
      ].map(([id, color, file]) => ({
        node: {
          id: `gid://shopify/ProductVariant/${id}`,
          selectedOptions: [{ name: "Color", value: color }],
          image: { url: `https://cdn.shopify.com/synoke/${file}` },
        },
      })),
    },
  };
  const merged = mergePublishedProductMedia(product, {
    productId,
    handle,
    images: gallery.map(([id, file], index) => ({
      // Public product JSON uses legacy image IDs; Storefront media carries GIDs.
      id: String(900000 + index),
      url: `https://cdn.shopify.com/synoke/${file}`,
      variantIds:
        id === "71874336030801"
          ? ["60076336283729", "60076336316497", "60076336349265", "60076336382033"]
          : [],
    })),
  });
  const variants = merged.variants.edges.map((edge) => edge.node);

  assert.deepEqual(
    variants.map((variant) => [variant.selectedOptions[0].value, variant.image?.id ?? null]),
    [
      ["Military Green", "gid://shopify/MediaImage/71874336129105"],
      ["white", "gid://shopify/MediaImage/71874336161873"],
      ["black", "gid://shopify/MediaImage/71874336194641"],
      ["Grey", null],
    ],
  );
  assert.deepEqual(
    variants.map((variant) => variant.imageMappingStatus),
    ["reviewed", "reviewed", "reviewed", "conflict"],
  );
});

test("fails closed if a reviewed variant option no longer matches its exact record", () => {
  const productId = "gid://shopify/Product/16022022750289";
  const handle =
    "women-men-nylon-travel-duffel-bag-carry-on-luggage-bag-men-tote-large-capacity-weekender-gym-sport-holdall-overnight-bag-pouches";
  const product = {
    id: productId,
    handle,
    images: { edges: [{ node: { url: "https://cdn.shopify.com/files/primary.webp" } }] },
    variants: {
      edges: [
        {
          node: {
            id: "gid://shopify/ProductVariant/60383152996433",
            selectedOptions: [{ name: "Color", value: "Blue" }],
            image: { url: "https://cdn.shopify.com/files/wrong-gray.webp" },
          },
        },
      ],
    },
  };
  const merged = mergePublishedProductMedia(product, {
    productId,
    handle,
    images: [
      {
        id: "72058621460561",
        url: "https://cdn.shopify.com/files/navy.webp",
        variantIds: ["60383152996433"],
      },
    ],
  });

  assert.equal(merged.variants.edges[0].node.image, null);
});

test("does not copy one size variant's image to an unreviewed sibling size", () => {
  const product = {
    id: "gid://shopify/Product/77",
    handle: "color-size-item",
    options: [
      { name: "Color", values: ["Black", "Blue"] },
      { name: "Size", values: ["Small", "Large"] },
    ],
    images: { edges: [{ node: { url: "https://cdn.shopify.com/items/main.jpg" } }] },
    variants: {
      edges: [
        {
          node: {
            id: "gid://shopify/ProductVariant/7701",
            selectedOptions: [
              { name: "Color", value: "Black" },
              { name: "Size", value: "Small" },
            ],
          },
        },
        {
          node: {
            id: "gid://shopify/ProductVariant/7702",
            selectedOptions: [
              { name: "Color", value: "Black" },
              { name: "Size", value: "Large" },
            ],
          },
        },
        {
          node: {
            id: "gid://shopify/ProductVariant/7703",
            selectedOptions: [
              { name: "Color", value: "Blue" },
              { name: "Size", value: "Small" },
            ],
          },
        },
      ],
    },
  };
  const merged = mergePublishedProductMedia(product, {
    productId: "77",
    handle: "color-size-item",
    images: [
      { url: "https://cdn.shopify.com/items/main.jpg", variantIds: [] },
      { url: "https://cdn.shopify.com/items/black.jpg", variantIds: ["7701"] },
      { url: "https://cdn.shopify.com/items/blue.jpg", variantIds: ["7703"] },
    ],
  });

  assert.match(merged.variants.edges[0].node.image.url, /black\.jpg$/);
  assert.equal(merged.variants.edges[0].node.imageMappingStatus, "assigned");
  assert.equal(merged.variants.edges[1].node.image, null);
  assert.equal(merged.variants.edges[1].node.imageMappingStatus, "unverified");
  assert.match(merged.variants.edges[2].node.image.url, /blue\.jpg$/);
});

test("holds a shared published image assigned across distinct colors instead of claiming a match", () => {
  const product = {
    id: "gid://shopify/Product/78",
    handle: "ambiguous-colors",
    options: [{ name: "Color", values: ["Black", "Brown"] }],
    images: { edges: [{ node: { url: "https://cdn.shopify.com/items/main.jpg" } }] },
    variants: {
      edges: [
        {
          node: {
            id: "gid://shopify/ProductVariant/7801",
            selectedOptions: [{ name: "Color", value: "Black" }],
          },
        },
        {
          node: {
            id: "gid://shopify/ProductVariant/7802",
            selectedOptions: [{ name: "Color", value: "Brown" }],
          },
        },
      ],
    },
  };
  const merged = mergePublishedProductMedia(product, {
    productId: "78",
    handle: "ambiguous-colors",
    images: [
      {
        url: "https://cdn.shopify.com/items/main.jpg",
        variantIds: ["7801", "7802"],
      },
      { url: "https://cdn.shopify.com/items/other-color.jpg", variantIds: [] },
    ],
  });

  assert.equal(merged.variants.edges[0].node.image, null);
  assert.equal(merged.variants.edges[1].node.image, null);
  assert.equal(merged.variants.edges[0].node.imageMappingStatus, "conflict");
  assert.equal(merged.variants.edges[1].node.imageMappingStatus, "conflict");
});

test("uses visually matched watch strap-and-dial images and holds the absent blue-luminous combination", () => {
  const productId = "gid://shopify/Product/15981540704337";
  const handle =
    "boys-brand-cheap-watches-men-fashion-casual-nylon-band-sports-army-gifts-date-quartz-wrist-watch-fluorescent-relogio-masculino";
  const galleryMediaIds = [
    "71874336260177",
    "71874336292945",
    "71874336325713",
    "71874336358481",
    "71874336391249",
    "71874336424017",
    "71874336456785",
    "71874336489553",
    "71874336522321",
    "71874336555089",
    "71874336587857",
    "71874336620625",
    "71874336653393",
    "71874336686161",
    "71874336718929",
    "71874336751697",
    "71874336784465",
    "71874336817233",
    "71874336850001",
    "71874336882769",
    "71874336915537",
  ];
  const reviewedVariants = [
    ["60076336480337", "black fluorescent", "71874336456785"],
    ["60076336513105", "black green", "71874336489553"],
    ["60076336545873", "black black", "71874336424017"],
    ["60076336578641", "green fluorescent", "71874336587857"],
    ["60076336611409", "green green", "71874336325713"],
    ["60076336644177", "black coffee", "71874336620625"],
    ["60076336676945", "green black", "71874336653393"],
    ["60076336709713", "blue fluorescent", null],
    ["60076336742481", "blue green", "71874336522321"],
    ["60076336775249", "green coffee", "71874336784465"],
    ["60076336808017", "blue black", "71874336817233"],
    ["60076336840785", "coffee fluorescent", "71874336555089"],
    ["60076336873553", "coffee green", "71874336686161"],
    ["60076336906321", "blue coffee", "71874336718929"],
    ["60076336939089", "coffee black", "71874336850001"],
    ["60076336971857", "coffee coffee", "71874336915537"],
  ];
  const media = galleryMediaIds.map((id) => ({
    id: `gid://shopify/MediaImage/${id}`,
    mediaContentType: "IMAGE",
    image: { url: `https://cdn.shopify.com/watch/${id}.webp` },
  }));
  const product = {
    id: productId,
    handle,
    images: {
      edges: media.map((node, index) => ({
        node: {
          id: `gid://shopify/ProductImage/${900000 + index}`,
          url: node.image.url,
        },
      })),
    },
    media: { edges: media.map((node) => ({ node })) },
    variants: {
      edges: reviewedVariants.map(([id, color]) => ({
        node: {
          id: `gid://shopify/ProductVariant/${id}`,
          selectedOptions: [
            { name: "Color", value: color },
            { name: "Is Customized", value: "Yes" },
            { name: "Ships From", value: "China Mainland" },
          ],
        },
      })),
    },
  };
  const merged = mergePublishedProductMedia(product, {
    productId,
    handle,
    images: media.map((node) => ({ id: node.id, url: node.image.url, variantIds: [] })),
  });

  for (const [index, [, , expectedMediaId]] of reviewedVariants.entries()) {
    const variant = merged.variants.edges[index].node;
    if (!expectedMediaId) {
      assert.equal(variant.image, null);
      assert.equal(variant.imageMappingStatus, "conflict");
      continue;
    }
    assert.equal(variant.image.id, `gid://shopify/MediaImage/${expectedMediaId}`);
    assert.equal(variant.imageMappingStatus, "reviewed");
  }
});

test("uses exact reviewed leather-strap color/clasp photos across all widths and holds the missing combination", () => {
  const productId = "gid://shopify/Product/15981540769873";
  const handle =
    "genuine-leather-strap-with-box-watch-band-butterfly-clasp-bracelet-12-14-16-18mm-20mm-21mm-22mm-24mm-wristband-watch-accessories";
  const review = REVIEWED_VARIANT_IMAGE_MAPPINGS.find(
    (entry) => entry.productId === productId && entry.handle === handle,
  );
  assert.ok(review);
  assert.equal(review.assignments.length, 20);

  const expectedWidths = [
    "12mm",
    "13mm",
    "14mm",
    "15mm",
    "16mm",
    "17mm",
    "18mm",
    "19mm",
    "20mm",
    "21mm",
    "22mm",
    "24mm",
  ];
  const variantIds = review.assignments.flatMap((assignment) => assignment.variantIds ?? []);
  assert.equal(variantIds.length, 240);
  assert.equal(new Set(variantIds).size, 240);

  const variants = review.assignments.flatMap((assignment) =>
    assignment.variantIds.map((id, index) => ({
      id: `gid://shopify/ProductVariant/${id}`,
      selectedOptions: [
        ...assignment.selectedOptions,
        { name: "Band Width", value: expectedWidths[index] },
      ],
    })),
  );
  const mediaIds = [
    ...new Set(review.assignments.map((assignment) => assignment.mediaId).filter(Boolean)),
  ];
  const media = mediaIds.map((id) => ({
    id,
    mediaContentType: "IMAGE",
    image: { url: `https://cdn.shopify.com/strap/${id.split("/").at(-1)}.webp` },
  }));
  const product = {
    id: productId,
    handle,
    options: [
      {
        name: "Strap color, stitching & clasp",
        values: review.assignments.map((entry) => entry.selectedOptions[0].value),
      },
      { name: "Band Width", values: expectedWidths },
    ],
    images: {
      edges: media.map((node, index) => ({
        node: {
          id: `gid://shopify/ProductImage/${900000 + index}`,
          url: node.image.url,
        },
      })),
    },
    media: { edges: media.map((node) => ({ node })) },
    variants: {
      edges: variants.map((node) => ({
        node: {
          ...node,
          // Shopify currently points most variants at the first gallery image.
          // The reviewed MediaImage ID must survive this duplicate legacy ID.
          image: {
            id: "gid://shopify/ProductImage/900000",
            url: media[0].image.url,
          },
        },
      })),
    },
  };
  const publishedMedia = {
    productId,
    handle,
    images: media.map((node) => ({ id: node.id, url: node.image.url, variantIds: [] })),
  };
  const merged = mergePublishedProductMedia(product, publishedMedia);
  assert.equal(hasImageBearingOption(product.options), true);

  let heldCount = 0;
  for (const assignment of review.assignments) {
    for (const id of assignment.variantIds) {
      const variant = merged.variants.edges.find((edge) => edge.node.id.endsWith(`/${id}`)).node;
      if (!assignment.mediaId) {
        heldCount += 1;
        assert.equal(variant.image, null);
        assert.equal(variant.imageMappingStatus, "conflict");
        continue;
      }
      assert.equal(variant.image.id, assignment.mediaId);
      assert.equal(variant.imageMappingStatus, "reviewed");
    }
  }
  assert.equal(heldCount, 12);

  const mergedVariants = merged.variants.edges.map((edge) => edge.node);
  const blackSilver = mergedVariants.find((variant) => variant.id.endsWith("/60076338151505"));
  const blackGold = mergedVariants.find((variant) => variant.id.endsWith("/60076339626065"));
  const galleryUrls = getProductGalleryImages(merged, mergedVariants).map((image) => image.url);
  assert.notEqual(
    selectVariantGalleryIndex(galleryUrls, blackSilver.image?.url),
    selectVariantGalleryIndex(galleryUrls, blackGold.image?.url),
  );

  const exactVariant = variants.find((variant) => variant.id.endsWith("/60076338151505"));
  const wrongColor = {
    ...exactVariant,
    selectedOptions: [
      { name: "Strap color, stitching & clasp", value: "Brown strap · Silver clasp" },
      { name: "Band Width", value: "22mm" },
    ],
  };
  const mismatchedColor = mergePublishedProductMedia(
    { ...product, variants: { edges: [{ node: wrongColor }] } },
    publishedMedia,
  ).variants.edges[0].node;
  assert.equal(mismatchedColor.image, null);
  assert.equal(mismatchedColor.imageMappingStatus, "conflict");

  const unknownWidth = {
    ...exactVariant,
    selectedOptions: [
      { name: "Strap color, stitching & clasp", value: "Black strap · Silver clasp" },
      { name: "Band Width", value: "23mm" },
    ],
  };
  const mismatchedWidth = mergePublishedProductMedia(
    { ...product, variants: { edges: [{ node: unknownWidth }] } },
    publishedMedia,
  ).variants.edges[0].node;
  assert.equal(mismatchedWidth.image, null);
  assert.equal(mismatchedWidth.imageMappingStatus, "conflict");
});
