const EVERYDAY_CARRY_HANDLES = new Set([
  "travel-outdoor",
  "portable-gadgets",
  "car-accessories",
  "electronic-accessories",
]);

export function getCollectionEditorial(handle: string) {
  if (!EVERYDAY_CARRY_HANDLES.has(handle)) return null;

  return {
    heading: "Everyday carry essentials",
    body:
      "Build a lighter, more capable everyday setup with practical accessories for commutes, road trips and weekends away. Explore compact tech, travel-ready tools and small upgrades designed to earn a place in your daily routine.",
  };
}
