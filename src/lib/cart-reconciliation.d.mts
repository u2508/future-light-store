export function reconcileCartSnapshot<T extends { variantId: string }>(
  localItems: T[],
  cart: unknown,
):
  | { status: "empty" }
  | { status: "hold" }
  | { status: "reconciled"; items: T[] };
