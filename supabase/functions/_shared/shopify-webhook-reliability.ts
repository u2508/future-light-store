export function webhookReceiptKey(topic: string, shopifyId: string) {
  return `${topic.trim().toUpperCase()}:${shopifyId.trim()}`;
}

export type WebhookReceiptDecision = "process" | "duplicate" | "in_flight";

const PROCESSING_LEASE_MS = 5 * 60 * 1000;

/**
 * A completed receipt is terminal. Retriable failures (including transient
 * downstream analytics errors) can be reclaimed when Shopify redelivers; a
 * fresh processing lease prevents concurrent retries from double-running.
 */
export function webhookReceiptDecision(
  receipt: {
    status: string;
    last_error?: string | null;
    updated_at?: string | null;
  },
  nowMs = Date.now(),
): WebhookReceiptDecision {
  if (receipt.status === "processed") return "duplicate";

  if (receipt.status === "processing") {
    const updatedAt = Date.parse(String(receipt.updated_at ?? ""));
    if (
      !Number.isFinite(updatedAt) || updatedAt > nowMs ||
      nowMs - updatedAt < PROCESSING_LEASE_MS
    ) {
      return "in_flight";
    }
    return "process";
  }

  if (
    receipt.status === "processed_with_warnings" || receipt.status === "failed"
  ) {
    return isRetryableWebhookError(receipt.last_error ?? "")
      ? "process"
      : "duplicate";
  }

  // retry_pending and unknown nonterminal states can be reclaimed.
  return "process";
}

export function webhookReceiptOutcome(status: string, error: string | null) {
  if (
    status === "processed_with_warnings" && isRetryableWebhookError(error ?? "")
  ) {
    return {
      receiptStatus: "retry_pending",
      httpStatus: 503,
      retryable: true,
    } as const;
  }
  if (status === "failed") {
    return {
      receiptStatus: "failed",
      httpStatus: webhookFailureStatus(error ?? ""),
      retryable: isRetryableWebhookError(error ?? ""),
    } as const;
  }
  return { receiptStatus: status, httpStatus: 200, retryable: false } as const;
}

export function isRetryableWebhookError(error: unknown) {
  const message = String(error instanceof Error ? error.message : error)
    .toLowerCase();
  return /429|5\d\d|timeout|timed out|network|fetch|connection|temporar|unavailable|database|not found in shopify|gateway|rate limit/
    .test(
      message,
    );
}

export function webhookFailureStatus(error: unknown) {
  return isRetryableWebhookError(error) ? 500 : 422;
}
