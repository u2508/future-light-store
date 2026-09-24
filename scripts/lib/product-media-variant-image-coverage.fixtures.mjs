export function fullyApprovedCoverageFixture() {
  return {
    products: [
      {
        id: "gid://shopify/Product/101",
        handle: "canvas-travel-bag",
        media: {
          nodes: [
            {
              __typename: "MediaImage",
              id: "gid://shopify/MediaImage/201",
              image: { url: "https://cdn.test/bag-front.jpg" },
            },
            {
              __typename: "MediaImage",
              id: "gid://shopify/MediaImage/202",
              image: { url: "https://cdn.test/bag-detail.jpg" },
            },
            { __typename: "Video", id: "gid://shopify/Video/203" },
          ],
          pageInfo: { hasNextPage: false },
        },
        variants: {
          nodes: [
            {
              id: "gid://shopify/ProductVariant/301",
              media: {
                nodes: [{ __typename: "MediaImage", id: "gid://shopify/MediaImage/201" }],
                pageInfo: { hasNextPage: false },
              },
            },
            {
              id: "gid://shopify/ProductVariant/302",
              media: { nodes: [], pageInfo: { hasNextPage: false } },
            },
          ],
          pageInfo: { hasNextPage: false },
        },
      },
    ],
    mediaDecisions: [
      {
        productId: "gid://shopify/Product/101",
        handle: "canvas-travel-bag",
        mediaId: "gid://shopify/MediaImage/201",
        decision: "approved-existing-good",
      },
      {
        productId: "gid://shopify/Product/101",
        handle: "canvas-travel-bag",
        mediaId: "gid://shopify/MediaImage/202",
        decision: "approved-existing-good",
      },
    ],
    variantAssociationDecisions: [
      {
        productId: "gid://shopify/Product/101",
        handle: "canvas-travel-bag",
        variantId: "gid://shopify/ProductVariant/301",
        mediaId: "gid://shopify/MediaImage/201",
        decision: "approved-existing-association",
      },
      {
        productId: "gid://shopify/Product/101",
        handle: "canvas-travel-bag",
        variantId: "gid://shopify/ProductVariant/302",
        mediaId: null,
        decision: "approved-no-image-required",
      },
    ],
  };
}

export function chinaWatermarkRejectedFixture() {
  const fixture = fullyApprovedCoverageFixture();
  fixture.products[0].media.nodes = [fixture.products[0].media.nodes[0]];
  fixture.products[0].variants.nodes[0].media.nodes = [fixture.products[0].media.nodes[0]];
  fixture.mediaDecisions = [
    {
      productId: "gid://shopify/Product/101",
      handle: "canvas-travel-bag",
      mediaId: "gid://shopify/MediaImage/201",
      decision: "rejected",
      reasonCode: "supplier-or-China-branding-watermark",
    },
  ];
  fixture.variantAssociationDecisions = [
    {
      productId: "gid://shopify/Product/101",
      handle: "canvas-travel-bag",
      variantId: "gid://shopify/ProductVariant/301",
      mediaId: "gid://shopify/MediaImage/201",
      decision: "approved-existing-association",
    },
    {
      productId: "gid://shopify/Product/101",
      handle: "canvas-travel-bag",
      variantId: "gid://shopify/ProductVariant/302",
      mediaId: null,
      decision: "approved-no-image-required",
    },
  ];
  return fixture;
}
