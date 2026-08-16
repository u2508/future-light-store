export const POLICIES: Record<string, { title: string; body: string[] }> = {
  shipping: {
    title: "Shipping policy",
    body: [
      "Orders are processed within 1–2 business days. Delivery estimates and costs are calculated at checkout based on your address.",
      "Once dispatched, you'll receive a tracking link by email.",
    ],
  },
  returns: {
    title: "Returns policy",
    body: [
      "Unused items in original packaging can be returned within 30 days of delivery.",
      "Refunds are issued to the original payment method once the return is received.",
    ],
  },
  privacy: {
    title: "Privacy policy",
    body: [
      "We collect only the information needed to process and deliver your orders.",
      "Payment details are handled by Shopify and never stored by VS Store.",
    ],
  },
  terms: {
    title: "Terms of service",
    body: [
      "By placing an order you agree to our pricing, delivery and returns terms as described on this site.",
      "Prices and availability may change without notice.",
    ],
  },
};
