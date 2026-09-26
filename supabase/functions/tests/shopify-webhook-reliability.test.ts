import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import {
  isRetryableWebhookError,
  webhookFailureStatus,
  webhookReceiptDecision,
  webhookReceiptKey,
  webhookReceiptOutcome,
} from "../_shared/shopify-webhook-reliability.ts";

Deno.test("builds a stable receipt key from topic and Shopify id", () => {
  assertEquals(
    webhookReceiptKey("orders/paid", "gid://shopify/Order/42"),
    "ORDERS/PAID:gid://shopify/Order/42",
  );
});

Deno.test("marks transient processing failures for Shopify retry", () => {
  assert(isRetryableWebhookError(new Error("Shopify Admin API 502: gateway")));
  assertEquals(
    webhookFailureStatus(new Error("Shopify Admin API 502: gateway")),
    500,
  );
  assert(
    isRetryableWebhookError(
      new Error("Order gid://shopify/Order/42 not found in Shopify"),
    ),
  );
});

Deno.test("does not retry malformed payload failures forever", () => {
  assertFalse(
    isRetryableWebhookError(
      new Error("Webhook payload has no resolvable order id"),
    ),
  );
  assertEquals(
    webhookFailureStatus(
      new Error("Webhook payload has no resolvable order id"),
    ),
    422,
  );
});

Deno.test("retries a processed-with-warnings receipt after a transient provider failure", () => {
  assertEquals(
    webhookReceiptDecision({
      status: "processed_with_warnings",
      last_error: "Google Purchase event not sent: fetch failed",
    }),
    "process",
  );
});

Deno.test("keeps non-retryable configuration warnings terminal for Shopify delivery", () => {
  assertEquals(
    webhookReceiptDecision({
      status: "processed_with_warnings",
      last_error:
        "Meta Purchase event not sent: missing_meta_conversions_api_access_token",
    }),
    "duplicate",
  );
});

Deno.test("does not reclaim a fresh processing lease but reclaims one that expired", () => {
  const now = Date.parse("2026-09-25T12:00:00.000Z");
  assertEquals(
    webhookReceiptDecision({
      status: "processing",
      updated_at: "2026-09-25T11:59:00.000Z",
    }, now),
    "in_flight",
  );
  assertEquals(
    webhookReceiptDecision({
      status: "processing",
      updated_at: "2026-09-25T11:54:59.000Z",
    }, now),
    "process",
  );
});

Deno.test("asks Shopify to retry transient downstream analytics failures", () => {
  assertEquals(
    webhookReceiptOutcome(
      "processed_with_warnings",
      "Meta Purchase event not sent: fetch failed",
    ),
    { receiptStatus: "retry_pending", httpStatus: 503, retryable: true },
  );
});

Deno.test("does not retry a permanent missing-secret warning as a failed Shopify webhook", () => {
  assertEquals(
    webhookReceiptOutcome(
      "processed_with_warnings",
      "Google Purchase event not sent: missing_google_measurement_protocol_secrets",
    ),
    {
      receiptStatus: "processed_with_warnings",
      httpStatus: 200,
      retryable: false,
    },
  );
});
