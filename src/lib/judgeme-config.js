/**
 * Judge.me configuration is deliberately supplied by the public runtime host,
 * not inferred from Shopify or embedded in the application bundle.
 */
export function normalizeJudgeMeRuntimeConfig(value) {
  if (!value || typeof value !== "object") return null;

  const widgetScriptUrl = String(value.widgetScriptUrl ?? "").trim();
  if (!widgetScriptUrl) return null;

  let scriptUrl;
  try {
    scriptUrl = new URL(widgetScriptUrl);
  } catch {
    return null;
  }

  if (
    scriptUrl.protocol !== "https:" ||
    scriptUrl.hostname !== "cdn.judge.me" ||
    scriptUrl.username ||
    scriptUrl.password
  ) {
    return null;
  }
  const rawReviewCount = value.shopReviewsCount;
  const parsedReviewCount =
    rawReviewCount == null || rawReviewCount === "" ? 0 : Number(rawReviewCount);
  if (!Number.isInteger(parsedReviewCount) || parsedReviewCount < 0) return null;

  return {
    widgetScriptUrl: scriptUrl.toString(),
    shopReviewsCount: parsedReviewCount,
  };
}

export function parseShopifyProductNumericId(value) {
  const match = /^gid:\/\/shopify\/Product\/(\d+)$/.exec(String(value ?? "").trim());
  return match?.[1] ?? null;
}
