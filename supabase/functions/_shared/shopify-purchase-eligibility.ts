/**
 * Keep paid-order conversion eligibility aligned with the local sales baseline.
 * A partially paid order is not a completed sale; a partially refunded order
 * still represents a completed purchase and remains eligible for the event.
 */
export function shopifyPurchaseEligibility(order: {
  test?: boolean | null;
  cancelledAt?: string | null;
  displayFinancialStatus?: string | null;
}) {
  if (order.test === true) return { eligible: false, reason: "test_order" };
  if (order.cancelledAt) return { eligible: false, reason: "cancelled_order" };

  const status = String(order.displayFinancialStatus || "").trim()
    .toUpperCase();
  if (status === "PAID" || status === "PARTIALLY_REFUNDED") {
    return { eligible: true, reason: "" };
  }
  return {
    eligible: false,
    reason: "order_not_fully_paid_or_partially_refunded",
  };
}
