export function selectVariantGalleryIndex(
  galleryImageUrls: string[],
  variantImageUrl: string | null | undefined,
): number;

export function selectGalleryImageForDisplay<T extends { url?: string | null }>(
  images: T[],
  preferredIndex: number,
  failedImageUrls?: Set<string>,
): T | null;

export type ShopifyProductImage = {
  id?: string | null;
  url: string;
  altText?: string | null;
};

export function getVariantImage(
  variant:
    | {
        image?: ShopifyProductImage | null;
      }
    | null
    | undefined,
): ShopifyProductImage | null;

export function getProductGalleryImages(
  product: {
    images?: { edges?: Array<{ node?: ShopifyProductImage }> };
    media?: {
      edges?: Array<{
        node?: {
          id?: string | null;
          mediaContentType?: string;
          alt?: string | null;
          image?: ShopifyProductImage | null;
        };
      }>;
    };
  },
  variants?: Array<{ image?: ShopifyProductImage | null }>,
): ShopifyProductImage[];

export function preserveSelectedVariantId(
  currentId: string | null,
  variants: Array<{ id: string }>,
  preferredId: string | null,
): string | null;

export type PublishedProductMedia = {
  productId: string;
  handle: string;
  images: Array<ShopifyProductImage & { variantIds?: string[] }>;
};

export function mergePublishedProductMedia<
  T extends {
    id: string;
    handle: string;
    images?: { edges?: Array<{ node?: ShopifyProductImage }> };
    variants?: {
      edges?: Array<{
        node: {
          id: string;
          image?: ShopifyProductImage | null;
          imageMappingStatus?: "assigned" | "reviewed" | "conflict" | "unverified";
          selectedOptions?: Array<{ name: string; value: string }>;
        };
      }>;
    };
    options?: Array<{ name: string; values: string[] }>;
  },
>(product: T, publishedMedia: PublishedProductMedia | null | undefined): T;
