export function webhookReceiptKey(topic: string, shopifyId: string) {
  return `${topic.trim().toUpperCase()}:${shopifyId.trim()}`;
}

export function isRetryableWebhookError(error: unknown) {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  return /429|5\d\d|timeout|timed out|network|fetch|connection|temporar|unavailable|database|not found in shopify|gateway|rate limit/.test(
    message,
  );
}

export function webhookFailureStatus(error: unknown) {
  return isRetryableWebhookError(error) ? 500 : 422;
}
