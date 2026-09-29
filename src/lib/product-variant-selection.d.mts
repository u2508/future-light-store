export type SelectableProductVariant = {
  id: string;
  availableForSale: boolean;
  selectedOptions?: Array<{ name: string; value: string }>;
  image?: { id?: string | null; url: string; altText?: string | null } | null;
  imageMappingStatus?: "assigned" | "reviewed" | "conflict" | "unverified";
};

export type ProductOptionDefinition = { name: string; values: string[] };

export function hasImageBearingOption(options?: ProductOptionDefinition[]): boolean;

export function isVerifiedVariantImage(
  variant: SelectableProductVariant | null | undefined,
): boolean;

export function displayOptionGroupName(
  name: string,
  values?: string[],
  productTitle?: string,
): string;

export function displayOptionValue(
  value: string,
  optionName: string,
  productTitle?: string,
): string;

export function resolveVariantOptionSelection(args: {
  variants: SelectableProductVariant[];
  currentVariantId: string | null;
  optionName: string;
  optionValue: string;
  unavailableVariantIds?: Set<string>;
}): SelectableProductVariant | null;

export function buildVariantOptionGroups(args: {
  options?: ProductOptionDefinition[];
  variants: SelectableProductVariant[];
  selectedVariantId: string | null;
  unavailableVariantIds?: Set<string>;
  productTitle?: string;
}): Array<{
  name: string;
  label: string;
  values: Array<{
    value: string;
    displayValue: string;
    selected: boolean;
    available: boolean;
    variantId: string | null;
    image: { id?: string | null; url: string; altText?: string | null } | null;
  }>;
}>;

export function chooseProductVariantId({
  variants,
  requestedVariant,
  currentId,
  userSelected,
}: {
  variants: SelectableProductVariant[];
  requestedVariant: string | null;
  currentId: string | null;
  userSelected?: boolean;
}): string | null;
