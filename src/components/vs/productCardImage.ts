const SHOPIFY_CDN_HOST = "cdn.shopify.com";

const PRODUCT_CARD_IMAGE_WIDTHS = [160, 240, 320, 480, 640, 800] as const;

export const PRODUCT_CARD_IMAGE_SIZES =
  "(min-width: 1280px) 196px, (min-width: 1024px) calc((100vw - 7rem) / 4), (min-width: 768px) calc((100vw - 5rem) / 3), calc((100vw - 3rem) / 2)";

function parseShopifyCdnUrl(source: string) {
  try {
    const url = new URL(source);
    return url.protocol === "https:" && url.hostname === SHOPIFY_CDN_HOST ? url : null;
  } catch {
    return null;
  }
}

function withWidth(url: URL, width: number) {
  const resized = new URL(url);
  resized.searchParams.set("width", String(width));
  return resized.toString();
}

export function getProductCardImageDelivery(source: string) {
  const shopifyUrl = parseShopifyCdnUrl(source);

  if (!shopifyUrl) {
    return { src: source, srcSet: undefined };
  }

  return {
    src: withWidth(shopifyUrl, 640),
    srcSet: PRODUCT_CARD_IMAGE_WIDTHS.map(
      (width) => `${withWidth(shopifyUrl, width)} ${width}w`,
    ).join(", "),
  };
}
