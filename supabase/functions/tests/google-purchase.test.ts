import { assertEquals } from "jsr:@std/assert@1";
import { buildGooglePurchasePayload } from "../_shared/google.ts";

Deno.test("builds a stable GA4 purchase payload from verified order fields", () => {
  const payload = buildGooglePurchasePayload(
    {
      id: "gid://shopify/Order/42",
      name: "#1001",
      customAttributes: [{ key: "marketing_ga_client_id", value: "123.456" }],
      createdAt: "2026-09-21T00:00:00Z",
      processedAt: "2026-09-21T00:00:01Z",
      displayFinancialStatus: "PAID",
      currentTotalPriceSet: { shopMoney: { amount: "39.99", currencyCode: "USD" } },
      currentTotalTaxSet: { shopMoney: { amount: "3.00" } },
      totalShippingPriceSet: { shopMoney: { amount: "0.00" } },
      lineItems: {
        nodes: [
          {
            title: "Example product",
            quantity: 2,
            sku: "SKU-1",
            discountedTotalSet: { shopMoney: { amount: "39.99" } },
            product: { id: "gid://shopify/Product/7" },
            variant: { id: "gid://shopify/ProductVariant/8" },
          },
        ],
      },
    },
    "123.456",
  );

  assertEquals(payload.client_id, "123.456");
  assertEquals(payload.events[0].name, "purchase");
  assertEquals(payload.events[0].params.transaction_id, "#1001");
  assertEquals(payload.events[0].params.event_id, "shopify-order-42");
  assertEquals(payload.events[0].params.items[0], {
    item_id: "7",
    item_name: "Example product",
    quantity: 2,
    price: 20,
  });
});
