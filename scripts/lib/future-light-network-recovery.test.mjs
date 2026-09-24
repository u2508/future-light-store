import test from "node:test";
import assert from "node:assert/strict";
import {
  isRetryableNetworkFailure,
  ReleaseStageReconciliationRequiredError,
  runStageWithNetworkRecovery,
  waitForNetworkRestoration,
} from "./future-light-network-recovery.mjs";

const networkError = (code = "ENOTFOUND", message = "temporary DNS failure") => Object.assign(new Error(message), { code });
const stageFingerprint = "a".repeat(64);

test("classifies transient network and throttling failures without retrying auth or input errors", () => {
  assert.equal(isRetryableNetworkFailure(networkError("EAI_AGAIN")), true);
  assert.equal(isRetryableNetworkFailure(Object.assign(new Error("rate limited"), { status: 429 })), true);
  assert.equal(isRetryableNetworkFailure(Object.assign(new Error("service unavailable"), { statusCode: 503 })), true);
  assert.equal(isRetryableNetworkFailure(Object.assign(new Error("unauthorized"), { status: 401 })), false);
  assert.equal(isRetryableNetworkFailure(new Error("invalid GraphQL selection")), false);
});

test("polls until connectivity returns with bounded exponential backoff", async () => {
  const probes = [false, false, true];
  const waits = [];
  const states = [];
  await waitForNetworkRestoration({
    probe: async () => probes.shift(),
    sleep: async (delay) => waits.push(delay),
    minDelayMs: 5,
    maxDelayMs: 12,
    onStateChange: (event) => states.push(event.state),
  });
  assert.deepEqual(waits, [5, 10]);
  assert.deepEqual(states, ["waiting_for_network", "network_restored"]);
});

test("read-only stages retry after the network probe recovers", async () => {
  let calls = 0;
  let probeCalls = 0;
  const value = await runStageWithNetworkRecovery({
    stageId: "read.catalog",
    stageFingerprint,
    run: async () => {
      calls += 1;
      if (calls === 1) throw networkError();
      return "readback";
    },
    probe: async () => ++probeCalls > 0,
    sleep: async () => {},
    minDelayMs: 0,
    maxDelayMs: 0,
  });
  assert.equal(value, "readback");
  assert.equal(calls, 2);
});

test("mutating stages accept authoritative completed readback without replay", async () => {
  let calls = 0;
  const result = await runStageWithNetworkRecovery({
    stageId: "write.product",
    stageFingerprint,
    mutating: true,
    run: async () => {
      calls += 1;
      throw networkError("ECONNRESET", "connection dropped after write");
    },
    reconcile: async () => ({
      status: "completed",
      target: "shopify",
      stageId: "write.product",
      stageFingerprint,
      readbackVerified: true,
      receipt: { productId: "gid://shopify/Product/1" },
    }),
    probe: async () => true,
    sleep: async () => {},
    minDelayMs: 0,
    maxDelayMs: 0,
  });
  assert.deepEqual(result, {
    status: "reconciled_completed",
    receipt: { productId: "gid://shopify/Product/1" },
  });
  assert.equal(calls, 1);
});

test("mutating stages replay only after reconciliation explicitly proves no write landed", async () => {
  let calls = 0;
  let reconcileCalls = 0;
  const result = await runStageWithNetworkRecovery({
    stageId: "write.metafield",
    stageFingerprint,
    mutating: true,
    run: async () => {
      calls += 1;
      if (calls === 1) throw networkError("ETIMEDOUT");
      return "written-and-read-back";
    },
    reconcile: async () => {
      reconcileCalls += 1;
      return {
        status: "safe_to_retry",
        target: "shopify",
        stageId: "write.metafield",
        stageFingerprint,
        readbackVerified: true,
        noMutationLanded: true,
      };
    },
    probe: async () => true,
    sleep: async () => {},
    minDelayMs: 0,
    maxDelayMs: 0,
  });
  assert.equal(result, "written-and-read-back");
  assert.equal(calls, 2);
  assert.equal(reconcileCalls, 1);
});

test("mutating stages fail closed when reconciliation cannot determine the live result", async () => {
  let calls = 0;
  await assert.rejects(
    runStageWithNetworkRecovery({
      stageId: "write.variant",
      stageFingerprint,
      mutating: true,
      run: async () => {
        calls += 1;
        throw networkError();
      },
      reconcile: async () => ({
        status: "unknown",
        target: "shopify",
        stageId: "write.variant",
        stageFingerprint,
        readbackVerified: true,
      }),
      probe: async () => true,
      sleep: async () => {},
      minDelayMs: 0,
      maxDelayMs: 0,
    }),
    (error) => error instanceof ReleaseStageReconciliationRequiredError && error.stageId === "write.variant",
  );
  assert.equal(calls, 1);
});

test("a mutating stage cannot start without a reconciliation function", async () => {
  let calls = 0;
  await assert.rejects(
    runStageWithNetworkRecovery({
      stageId: "write.category",
      stageFingerprint,
      mutating: true,
      run: async () => { calls += 1; },
      probe: async () => true,
    }),
    /requires a live reconciliation function/,
  );
  assert.equal(calls, 0);
});

test("transient diagnostics redact token-like values", async () => {
  const events = [];
  await waitForNetworkRestoration({
    probe: async () => {
      if (events.length === 0) throw networkError("ENOTFOUND", "request https://x.invalid/?access_token=shpat_secret123 failed");
      return true;
    },
    sleep: async () => {},
    minDelayMs: 0,
    maxDelayMs: 0,
    onStateChange: (event) => events.push(event),
  });
  assert.match(events[0].error, /\[redacted\]/);
  assert.doesNotMatch(events[0].error, /shpat_secret123/);
});

test("aborted recovery exits rather than polling indefinitely", async () => {
  const controller = new AbortController();
  await assert.rejects(
    waitForNetworkRestoration({
      probe: async () => false,
      signal: controller.signal,
      sleep: async () => {
        controller.abort();
        throw Object.assign(new Error("stopped"), { name: "AbortError" });
      },
      minDelayMs: 0,
      maxDelayMs: 0,
    }),
    { name: "AbortError" },
  );
});
