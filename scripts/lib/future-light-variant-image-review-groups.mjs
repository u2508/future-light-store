const IMAGE_OPTION_NAME =
  /^(color|colour|band color|pattern|design|print|style|finish|tone|shade|appearance)$/i;

function normalize(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function imageOptions(variant, optionNames) {
  const selectedOptions = Array.isArray(variant?.selectedOptions) ? variant.selectedOptions : [];
  const byName = new Map();
  for (const option of selectedOptions) {
    const name = normalize(option?.name).toLowerCase();
    if (!name || byName.has(name)) return null;
    byName.set(name, normalize(option?.value));
  }
  const pairs = optionNames.map((name) => {
    const key = name.toLowerCase();
    return byName.has(key) && byName.get(key) ? [key, byName.get(key)] : null;
  });
  return pairs.every(Boolean) ? pairs : null;
}

function currentMediaKey(variant) {
  return JSON.stringify(
    [...new Set((variant?.expectedCurrentMediaIds ?? []).map(normalize).filter(Boolean))].sort(),
  );
}

/** Warn only when one appearance value is linked to multiple current images. */
export function findVariantImageMappingConflicts(productEntry) {
  const mediaByAppearanceValue = new Map();
  for (const variant of Array.isArray(productEntry?.variants) ? productEntry.variants : []) {
    const mediaIds = (variant?.currentMedia || [])
      .map((media) => normalize(media?.id || media?.mediaId))
      .filter(Boolean);
    for (const option of Array.isArray(variant?.selectedOptions) ? variant.selectedOptions : []) {
      const name = normalize(option?.name);
      const value = normalize(option?.value);
      if (!IMAGE_OPTION_NAME.test(name) || !value || !mediaIds.length) continue;
      const key = `${name.toLowerCase()}\u0000${value.toLowerCase()}`;
      if (!mediaByAppearanceValue.has(key)) mediaByAppearanceValue.set(key, new Set());
      for (const mediaId of mediaIds) mediaByAppearanceValue.get(key).add(mediaId);
    }
  }

  return [...mediaByAppearanceValue.entries()]
    .filter(([, mediaIds]) => mediaIds.size > 1)
    .map(([key, mediaIds]) => {
      const [name, value] = key.split("\u0000");
      return `${name}: ${value} currently points to ${mediaIds.size} different media assets`;
    });
}

/**
 * Group only variants with the same exact appearance-option values and the
 * same current Shopify media evidence. The group is a visual-review aid only:
 * no image is selected here, and each member still receives an exact decision.
 */
export function buildVariantImageReviewGroups(productEntry) {
  const variants = Array.isArray(productEntry?.variants) ? productEntry.variants : [];
  if (!variants.length) return [];

  const optionNames = [
    ...new Set(
      variants.flatMap((variant) =>
        (Array.isArray(variant?.selectedOptions) ? variant.selectedOptions : [])
          .map((option) => normalize(option?.name))
          .filter((name) => IMAGE_OPTION_NAME.test(name)),
      ),
    ),
  ].sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()));

  const groups = new Map();
  variants.forEach((variant, index) => {
    const pairs = optionNames.length ? imageOptions(variant, optionNames) : null;
    // Missing or duplicate visual-option evidence is never grouped.
    const key = pairs
      ? JSON.stringify([pairs, currentMediaKey(variant)])
      : `variant-only:${normalize(variant?.variantId) || index}`;
    const group = groups.get(key) || {
      groupKey: key,
      visualOptionNames: pairs ? optionNames : [],
      visualOptionValues: pairs ? pairs.map(([name, value]) => ({ name, value })) : [],
      currentMediaIds: pairs ? JSON.parse(currentMediaKey(variant)) : [],
      reviewBasis: pairs
        ? "same-exact-appearance-options-and-current-media-evidence"
        : "variant-specific-incomplete-or-no-appearance-option-evidence",
      variants: [],
    };
    group.variants.push(variant);
    groups.set(key, group);
  });

  return [...groups.values()];
}

export function findVariantImageReviewGroup(productEntry, variantId) {
  const targetId = normalize(variantId);
  if (!targetId) return null;
  return (
    buildVariantImageReviewGroups(productEntry).find((group) =>
      group.variants.some((variant) => normalize(variant?.variantId) === targetId),
    ) ?? null
  );
}
