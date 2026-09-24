import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import {
  isRetryableWebhookError,
  webhookFailureStatus,
  webhookReceiptKey,
} from "../_shared/shopify-webhook-reliability.ts";

Deno.test("builds a stable receipt key from topic and Shopify id", () => {
  assertEquals(
    webhookReceiptKey("orders/paid", "gid://shopify/Order/42"),
    "ORDERS/PAID:gid://shopify/Order/42",
  );
});

Deno.test("marks transient processing failures for Shopify retry", () => {
  assert(isRetryableWebhookError(new Error("Shopify Admin API 502: gateway")));
  assertEquals(webhookFailureStatus(new Error("Shopify Admin API 502: gateway")), 500);
  assert(isRetryableWebhookError(new Error("Order gid://shopify/Order/42 not found in Shopify")));
});

Deno.test("does not retry malformed payload failures forever", () => {
  assertFalse(isRetryableWebhookError(new Error("Webhook payload has no resolvable order id")));
  assertEquals(webhookFailureStatus(new Error("Webhook payload has no resolvable order id")), 422);
});
