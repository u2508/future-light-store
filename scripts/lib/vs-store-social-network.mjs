export function isSocialNetworkError(error) {
  return Boolean(
    error?.retryable ||
    error?.code === "ETIMEDOUT" ||
    error?.code === "EAI_AGAIN" ||
    error?.code === "ENOTFOUND" ||
    error?.status === 429 ||
    (Number.isInteger(error?.status) && error.status >= 500) ||
    /network|socket|dns|timeout|timed out|temporar|unavailable|gateway|429|5\d\d/i.test(
      String(error?.message || error),
    ),
  );
}
