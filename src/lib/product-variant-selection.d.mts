export type SelectableProductVariant = {
  id: string;
  availableForSale: boolean;
};

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
