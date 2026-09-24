const images = import.meta.glob<string>("../assets/collection-artwork/*.jpg", {
  eager: true,
  query: "?url",
  import: "default",
});
const thumbnails = import.meta.glob<string>("../assets/collection-artwork/240/*.jpg", {
  eager: true,
  query: "?url",
  import: "default",
});
const mediumImages = import.meta.glob<string>("../assets/collection-artwork/768/*.jpg", {
  eager: true,
  query: "?url",
  import: "default",
});

export const MERCHANDISING_COLLECTIONS = [
  {
    handle: "new-arrivals",
    title: "New Arrivals",
    eyebrow: "Meet your next favourite",
    headline: "The future looks good on you.",
    copy: "Unexpected finds. Everyday upgrades. A whole new world to explore.",
    cta: "Explore the drop",
  },
  {
    handle: "best-sellers",
    title: "Curated Picks",
    eyebrow: "The considered edit",
    headline: "Good finds. Great company.",
    copy: "Discover a considered mix of pieces for everyday life.",
    cta: "Explore curated picks",
  },
  {
    handle: "premium-picks",
    title: "Premium Picks",
    eyebrow: "A little more extraordinary",
    headline: "Elevate your everyday.",
    copy: "Considered details. Standout pieces. Discover the premium edit.",
    cta: "Explore premium picks",
  },
  {
    handle: "travel-outdoor",
    title: "Travel & Outdoor",
    eyebrow: "Go beyond the everyday",
    headline: "Pack better. Go further.",
    copy: "Clever companions for open roads, weekends away and everywhere in between.",
    cta: "Explore travel",
  },
  {
    handle: "portable-gadgets",
    title: "Portable Gadgets",
    eyebrow: "Small tech. Big upgrade.",
    headline: "Good things, ready to go.",
    copy: "Portable power, smart accessories and everyday tech that keeps up.",
    cta: "Explore gadgets",
  },
  {
    handle: "kitchen-gadgets",
    title: "Kitchen",
    eyebrow: "Make it easier",
    headline: "A better way to everyday.",
    copy: "Useful little upgrades that make prep, storage and daily rituals feel effortless.",
    cta: "Explore kitchen",
  },
  {
    handle: "beauty-makeup-essentials",
    title: "Beauty Essentials",
    eyebrow: "Your routine, refined",
    headline: "Your kind of glow.",
    copy: "Thoughtful tools and feel-good essentials for the rituals that are yours.",
    cta: "Explore beauty",
  },
  {
    handle: "home-decor",
    title: "Home Decor",
    eyebrow: "Make room for better",
    headline: "Your space, reimagined.",
    copy: "Atmosphere, comfort and considered details for the place you come back to.",
    cta: "Explore home",
  },
] as const;

export const INTERNAL_COLLECTION_HANDLES = new Set([
  "classification-review",
  "classification-fallback",
]);

export function collectionArtwork(handle: string, fallback?: string | null) {
  return images[`../assets/collection-artwork/${handle}.jpg`] || fallback || undefined;
}

export function collectionThumbnail(handle: string) {
  return thumbnails[`../assets/collection-artwork/240/${handle}.jpg`] || collectionArtwork(handle);
}

export function collectionArtworkSrcSet(handle: string) {
  const full = collectionArtwork(handle);
  const medium = mediumImages[`../assets/collection-artwork/768/${handle}.jpg`];
  return full && medium ? `${medium} 768w, ${full} 1536w` : undefined;
}
