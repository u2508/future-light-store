const RETRYABLE_CODES = new Set([
  "EAI_AGAIN",
  "ENOTFOUND",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
]);

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function abortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  return Object.assign(new Error("Network recovery was aborted"), { name: "AbortError" });
}

function defaultSleep(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const timer = setTimeout(done, milliseconds);
    function done() {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError(signal));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function isRetryableNetworkFailure(error) {
  if (!error || typeof error !== "object") return false;
  if (RETRYABLE_CODES.has(String(error.code || "").toUpperCase())) return true;
  const status = Number(error.status ?? error.statusCode ?? error.response?.status);
  if (RETRYABLE_STATUS.has(status)) return true;
  return /\b(?:dns|network|socket|connection reset|connection refused|timed? ?out|temporarily unavailable|gateway timeout|fetch failed)\b/i
    .test(String(error.message || ""));
}

function safeErrorMessage(error) {
  return String(error?.message || error || "unknown network error")
    .replace(/\b(?:shpat|shpca|shppa|shpss)_[A-Za-z0-9_-]+\b/gi, "[redacted-token]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/([?&](?:access_token|token|key|password)=)[^&\s]+/gi, "$1[redacted]")
    .slice(0, 500);
}

export class ReleaseStageReconciliationRequiredError extends Error {
  constructor(stageId, cause) {
    super(`Stage ${stageId} had an uncertain network failure; live reconciliation is required before retry`, { cause });
    this.name = "ReleaseStageReconciliationRequiredError";
    this.code = "RELEASE_STAGE_RECONCILIATION_REQUIRED";
    this.stageId = stageId;
  }
}

/** Poll a caller-supplied read-only connectivity probe until it succeeds. */
export async function waitForNetworkRestoration({
  probe,
  signal,
  sleep = defaultSleep,
  minDelayMs = 1_000,
  maxDelayMs = 60_000,
  onStateChange = () => {},
} = {}) {
  if (typeof probe !== "function") throw new TypeError("A read-only network probe is required");
  if (!Number.isFinite(minDelayMs) || minDelayMs < 0 || !Number.isFinite(maxDelayMs) || maxDelayMs < minDelayMs) {
    throw new RangeError("Network recovery delays must be finite and maxDelayMs must be >= minDelayMs");
  }

  let delay = minDelayMs;
  let waiting = false;
  for (;;) {
    if (signal?.aborted) throw abortError(signal);
    try {
      if (await probe({ signal })) {
        if (waiting) await onStateChange({ state: "network_restored" });
        return;
      }
    } catch (error) {
      if (!isRetryableNetworkFailure(error)) throw error;
      if (!waiting) await onStateChange({ state: "waiting_for_network", error: safeErrorMessage(error) });
      waiting = true;
    }

    if (!waiting) {
      await onStateChange({ state: "waiting_for_network", error: "connectivity probe did not pass" });
      waiting = true;
    }
    await sleep(delay, signal);
    delay = Math.min(Math.max(minDelayMs, delay * 2), maxDelayMs);
  }
}

/**
 * Retry network failures for read-only stages. For writes, first wait for
 * connectivity and reconcile authoritative state; never blindly replay.
 */
export async function runStageWithNetworkRecovery({
  stageId,
  target = "shopify",
  stageFingerprint,
  mutating = false,
  run,
  reconcile,
  probe,
  signal,
  sleep = defaultSleep,
  minDelayMs = 1_000,
  maxDelayMs = 60_000,
  onStateChange = () => {},
} = {}) {
  if (typeof stageId !== "string" || !stageId.trim()) throw new TypeError("stageId is required");
  if (target !== "shopify") throw new Error("Future Light release stages are restricted to the Shopify target");
  if (typeof stageFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(stageFingerprint)) {
    throw new TypeError("a SHA-256 stageFingerprint is required");
  }
  if (typeof run !== "function") throw new TypeError("stage run function is required");
  if (typeof probe !== "function") throw new TypeError("a read-only network probe is required");
  if (mutating && typeof reconcile !== "function") {
    throw new TypeError(`Mutating stage ${stageId} requires a live reconciliation function before execution`);
  }

  for (;;) {
    if (signal?.aborted) throw abortError(signal);
    try {
      return await run({ signal });
    } catch (error) {
      if (!isRetryableNetworkFailure(error)) throw error;
      await waitForNetworkRestoration({ probe, signal, sleep, minDelayMs, maxDelayMs, onStateChange });
      if (!mutating) continue;

      let result;
      for (;;) {
        try {
          result = await reconcile({ stageId, error, signal });
          break;
        } catch (readbackError) {
          if (!isRetryableNetworkFailure(readbackError)) throw readbackError;
          await waitForNetworkRestoration({ probe, signal, sleep, minDelayMs, maxDelayMs, onStateChange });
        }
      }

      const exactReadback = result?.target === target && result?.stageId === stageId &&
        result?.stageFingerprint === stageFingerprint && result?.readbackVerified === true;
      if (result?.status === "completed" && exactReadback && result.receipt && typeof result.receipt === "object") {
        return Object.freeze({ status: "reconciled_completed", receipt: result.receipt ?? null });
      }
      if (result?.status === "safe_to_retry" && exactReadback && result.noMutationLanded === true) continue;
      throw new ReleaseStageReconciliationRequiredError(stageId, error);
    }
  }
}
