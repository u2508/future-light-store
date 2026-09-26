import { assertEquals } from "jsr:@std/assert@1";
import { shopifyPurchaseEligibility } from "../_shared/shopify-purchase-eligibility.ts";

Deno.test("purchase eligibility matches completed paid-order statuses", () => {
  assertEquals(shopifyPurchaseEligibility({ displayFinancialStatus: "PAID" }), {
    eligible: true,
    reason: "",
  });
  assertEquals(
    shopifyPurchaseEligibility({
      displayFinancialStatus: "PARTIALLY_REFUNDED",
    }),
    { eligible: true, reason: "" },
  );
});

Deno.test("partially paid and other unpaid statuses do not count as purchases", () => {
  for (
    const displayFinancialStatus of [
      "PARTIALLY_PAID",
      "PENDING",
      "AUTHORIZED",
      "REFUNDED",
    ]
  ) {
    assertEquals(
      shopifyPurchaseEligibility({ displayFinancialStatus }),
      { eligible: false, reason: "order_not_fully_paid_or_partially_refunded" },
    );
  }
});

Deno.test("test and cancelled orders never count as purchases", () => {
  assertEquals(
    shopifyPurchaseEligibility({ test: true, displayFinancialStatus: "PAID" }),
    { eligible: false, reason: "test_order" },
  );
  assertEquals(
    shopifyPurchaseEligibility({
      cancelledAt: "2026-09-25T00:00:00Z",
      displayFinancialStatus: "PAID",
    }),
    { eligible: false, reason: "cancelled_order" },
  );
});
