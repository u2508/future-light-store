function comparableVariantId(value) {
  return (
    String(value ?? "")
      .split("/")
      .pop() ?? ""
  );
}

const IMAGE_OPTION_NAME =
  /^(color|colour|band color|band style|strap color, stitching & clasp|pattern|design|print|style|finish|tone|shade|appearance)$/i;

function normalizeOptionName(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase();
}

function optionValue(variant, name) {
  const targetName = normalizeOptionName(name);
  return (
    variant?.selectedOptions?.find((option) => normalizeOptionName(option?.name) === targetName)
      ?.value ?? null
  );
}

function isUnavailable(variant, unavailableVariantIds) {
  return !variant?.availableForSale || unavailableVariantIds?.has?.(variant.id) === true;
}

export function hasImageBearingOption(options = []) {
  return options.some((option) => IMAGE_OPTION_NAME.test(String(option?.name ?? "").trim()));
}

export function isVerifiedVariantImage(variant) {
  return Boolean(variant?.image?.url && variant?.imageMappingStatus === "reviewed");
}

export function displayOptionGroupName(name, values = [], productTitle = "") {
  const hasOpaqueStyleCodes =
    values.length > 0 && values.every((value) => /^[A-Z]{1,8}-\d{5,}$/i.test(String(value).trim()));
  const isDeskMat = /mouse\s*pad|mousepad|desk\s*mat|gaming\s*mat/i.test(productTitle);
  if (
    normalizeOptionName(name) === "color" &&
    /square-screen smartwatch with band styles/i.test(productTitle)
  ) {
    return "Band style";
  }
  if (normalizeOptionName(name) === "color" && hasOpaqueStyleCodes && isDeskMat) {
    return "Design";
  }
  if (
    normalizeOptionName(name) === "band color" &&
    /leather strap.*watch band.*butterfly clasp/i.test(productTitle)
  ) {
    return "Strap finish";
  }
  return name;
}

export function displayOptionValue(value, optionName, productTitle = "") {
  const isDeskMat = /mouse\s*pad|mousepad|desk\s*mat|gaming\s*mat/i.test(productTitle);
  if (
    normalizeOptionName(optionName) === "band color" &&
    /leather strap.*watch band.*butterfly clasp/i.test(productTitle)
  ) {
    return displayLeatherStrapFinish(value);
  }
  if (
    normalizeOptionName(optionName) === "color" &&
    isDeskMat &&
    /^[A-Z]{1,8}-(\d{5,})$/i.test(String(value).trim())
  ) {
    const code =
      String(value)
        .trim()
        .match(/-(\d{5,})$/)?.[1] ?? String(value).trim();
    return `Design code ${code.replace(/^0+(?=\d)/, "")}`;
  }
  return value;
}

function displayLeatherStrapFinish(value) {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const claspMatch = normalized.match(/(rose\s*gold|silver|gold|black)$/i);
  if (!claspMatch) return value;

  const clasp = claspMatch[1].replace(/\s+/g, " ").toLowerCase();
  const prefix = normalized.slice(0, claspMatch.index).trim();
  const whiteStitching = /white/i.test(prefix);
  const strapColor = prefix
    .replace(/white/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^lightbrown$/i, "Light brown")
    .replace(/^brown$/i, "Brown")
    .replace(/^black$/i, "Black");

  if (!strapColor) return value;
  const claspLabel = /^rose\s*gold$/i.test(clasp) ? "rose-gold" : clasp;
  return `${strapColor} strap${whiteStitching ? " · white stitching" : ""} · ${claspLabel} clasp`;
}

export function resolveVariantOptionSelection({
  variants = [],
  currentVariantId,
  optionName,
  optionValue: requestedValue,
  unavailableVariantIds = new Set(),
}) {
  const current = variants.find((variant) => variant.id === currentVariantId) ?? null;
  const matching = variants.filter(
    (variant) => optionValue(variant, optionName) === requestedValue,
  );
  if (!matching.length) return null;
  if (
    current &&
    optionValue(current, optionName) === requestedValue &&
    !isUnavailable(current, unavailableVariantIds)
  ) {
    return current;
  }

  const currentOptions = current?.selectedOptions ?? [];
  const score = (variant) =>
    currentOptions.reduce((total, option) => {
      if (normalizeOptionName(option?.name) === normalizeOptionName(optionName)) return total;
      return total + (optionValue(variant, option?.name) === option?.value ? 1 : 0);
    }, 0);

  const available = matching.filter((variant) => !isUnavailable(variant, unavailableVariantIds));
  const candidates = available.length ? available : matching;
  return candidates.reduce(
    (best, candidate) => (!best || score(candidate) > score(best) ? candidate : best),
    null,
  );
}

export function buildVariantOptionGroups({
  options = [],
  variants = [],
  selectedVariantId,
  unavailableVariantIds = new Set(),
  productTitle = "",
}) {
  const presentation = buildLeatherStrapOptionPresentation({ options, variants, productTitle });
  const presentationVariants = presentation?.variants ?? variants;
  const presentationOptions = presentation?.options ?? options;
  const selectedVariant =
    presentationVariants.find((variant) => variant.id === selectedVariantId) ?? null;
  const definitions = presentationOptions.length
    ? presentationOptions
    : (selectedVariant?.selectedOptions ?? []).map((option) => ({
        name: option.name,
        values: [
          ...new Set(
            presentationVariants
              .map((variant) => optionValue(variant, option.name))
              .filter(Boolean),
          ),
        ],
      }));

  return definitions
    .filter((definition) => (definition?.values?.length ?? 0) > 1)
    .map((definition) => {
      const values = [...new Set(definition.values.map(String))];
      return {
        name: definition.name,
        label: displayOptionGroupName(definition.name, values, productTitle),
        values: values.map((value) => {
          const matching = presentationVariants.filter(
            (variant) => optionValue(variant, definition.name) === value,
          );
          const nextVariant = resolveVariantOptionSelection({
            variants: presentationVariants,
            currentVariantId: selectedVariantId,
            optionName: definition.name,
            optionValue: value,
            unavailableVariantIds,
          });
          const mappedImages = new Map();
          for (const variant of matching) {
            if (!isVerifiedVariantImage(variant) || !variant.image?.url) continue;
            mappedImages.set(variant.image.url, variant.image);
          }
          const verifiedImage = mappedImages.size === 1 ? [...mappedImages.values()][0] : null;
          const hasUnverifiedSibling = matching.some(
            (variant) => !isVerifiedVariantImage(variant) || !variant.image?.url,
          );
          return {
            value,
            displayValue: displayOptionValue(value, definition.name, productTitle),
            selected: optionValue(selectedVariant, definition.name) === value,
            available: matching.some((variant) => !isUnavailable(variant, unavailableVariantIds)),
            variantId: nextVariant?.id ?? null,
            image: verifiedImage && !hasUnverifiedSibling ? verifiedImage : null,
          };
        }),
      };
    });
}

function buildLeatherStrapOptionPresentation({ options, variants, productTitle }) {
  if (!/leather\s+strap.*watch\s+band.*butterfly\s+clasp/i.test(productTitle)) return null;
  const bandColorOption = options.find(
    (option) => normalizeOptionName(option?.name) === "band color",
  );
  const bandWidthOption = options.find(
    (option) => normalizeOptionName(option?.name) === "band width",
  );
  if (!bandColorOption || !bandWidthOption) return null;

  const parsedVariants = variants.map((variant) => {
    const finish = parseLeatherStrapFinish(optionValue(variant, "Band Color"));
    if (!finish) return null;
    return {
      ...variant,
      selectedOptions: [
        ...(variant.selectedOptions ?? []),
        { name: "Strap color", value: finish.strapColor },
        { name: "Stitching", value: finish.stitching },
        { name: "Clasp finish", value: finish.claspFinish },
      ],
    };
  });
  if (!parsedVariants.length || parsedVariants.some((variant) => !variant)) return null;

  const values = (name, preferredOrder) => {
    const unique = new Set(
      parsedVariants.map((variant) => optionValue(variant, name)).filter(Boolean),
    );
    return [
      ...preferredOrder.filter((value) => unique.has(value)),
      ...[...unique].filter((value) => !preferredOrder.includes(value)).sort(),
    ];
  };

  return {
    variants: parsedVariants,
    options: [
      { name: "Strap color", values: values("Strap color", ["Black", "Brown", "Light brown"]) },
      { name: "Stitching", values: values("Stitching", ["Black", "White"]) },
      {
        name: "Clasp finish",
        values: values("Clasp finish", ["Silver", "Gold", "Rose gold", "Black"]),
      },
      {
        ...bandWidthOption,
        values: [...bandWidthOption.values].sort(
          (left, right) => Number.parseFloat(left) - Number.parseFloat(right),
        ),
      },
    ],
  };
}

function parseLeatherStrapFinish(value) {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const claspMatch = normalized.match(/(rose\s*gold|rosegold|silver|gold|black)$/i);
  if (!claspMatch) return null;

  const prefix = normalized.slice(0, claspMatch.index).trim();
  const whiteStitching = /white/i.test(prefix);
  const strapToken = prefix.replace(/white/gi, "").replace(/\s+/g, " ").trim();
  const compactStrap = strapToken.replace(/\s+/g, "").toLowerCase();
  const strapColor =
    compactStrap === "black"
      ? "Black"
      : compactStrap === "brown"
        ? "Brown"
        : compactStrap === "lightbrown"
          ? "Light brown"
          : null;
  if (!strapColor) return null;

  const rawClasp = claspMatch[1].replace(/\s+/g, " ").toLowerCase();
  const claspFinish = rawClasp.startsWith("rose")
    ? "Rose gold"
    : `${rawClasp[0].toUpperCase()}${rawClasp.slice(1)}`;
  return {
    strapColor,
    stitching: whiteStitching ? "White" : "Black",
    claspFinish,
  };
}

export function chooseProductVariantId({
  variants,
  requestedVariant,
  currentId,
  userSelected = false,
}) {
  const requestedId = comparableVariantId(requestedVariant);
  const requestedMatch = requestedId
    ? variants.find((variant) => comparableVariantId(variant.id) === requestedId)
    : null;

  // A feed URL is an explicit product-offer promise. Honor it on entry even
  // when a valid default variant is already selected; only a shopper's own
  // subsequent choice should take precedence during background revalidation.
  if (requestedMatch && !userSelected) return requestedMatch.id;

  const currentMatch = variants.find((variant) => variant.id === currentId);
  if (currentMatch && (userSelected || currentMatch.availableForSale)) return currentMatch.id;

  return variants.find((variant) => variant.availableForSale)?.id ?? variants[0]?.id ?? null;
}
