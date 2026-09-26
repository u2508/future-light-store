import { assertEquals } from "jsr:@std/assert@1";
import { purchaseCatalogItemId } from "../_shared/meta.ts";

Deno.test("Meta Purchase uses the same Shopify variant identity as storefront events", () => {
  assertEquals(
    purchaseCatalogItemId({
      title: "Example product",
      quantity: 1,
      sku: "SKU-1",
      discountedTotalSet: { shopMoney: { amount: "10.00" } },
      product: { id: "gid://shopify/Product/7" },
      variant: { id: "gid://shopify/ProductVariant/8" },
    }),
    "8",
  );
});

Deno.test("Meta Purchase falls back to product identity only when variant identity is absent", () => {
  assertEquals(
    purchaseCatalogItemId({
      title: "Example product",
      quantity: 1,
      sku: "SKU-1",
      discountedTotalSet: { shopMoney: { amount: "10.00" } },
      product: { id: "gid://shopify/Product/7" },
      variant: null,
    }),
    "7",
  );
});
