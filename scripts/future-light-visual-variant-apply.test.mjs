import assert from "node:assert/strict";
import test from "node:test";

import {
  bindVisualVariantApplyCheckpoint,
  computeVisualVariantQueueFingerprint,
  VISUAL_VARIANT_APPLY_STATE_SCHEMA_VERSION,
} from "./lib/future-light-visual-variant-apply-checkpoint.mjs";

const approvalBytes = Buffer.from('{"approval":"reviewed"}\n', "utf8");

function queue() {
  const value = {
    targetStoreDomain: "vs-future-store-0jl2t-jxu6tnr3.myshopify.com",
    sourceEvidence: { catalogSnapshotGeneratedAt: "2026-09-26T20:20:08.922Z" },
    optionEntries: [],
    variantOptionEntries: [],
    variantEntries: [
      {
        productId: "gid://shopify/Product/10",
        handle: "travel-bag",
        variants: [
          {
            variantId: "gid://shopify/ProductVariant/20",
            expectedCurrentMediaIds: ["gid://shopify/MediaImage/12"],
          },
        ],
      },
    ],
    imageEntries: [],
  };
  value.queueFingerprint = computeVisualVariantQueueFingerprint(value);
  return value;
}

function priorState(sourceQueue, sourceApprovalBytes) {
  return {
    schemaVersion: VISUAL_VARIANT_APPLY_STATE_SCHEMA_VERSION,
    targetStoreDomain: sourceQueue.targetStoreDomain,
    ...bindVisualVariantApplyCheckpoint({ queue: sourceQueue, approvalBytes: sourceApprovalBytes }),
    completedHandles: ["travel-bag"],
    entries: { "travel-bag": { status: "completed-verified" } },
  };
}

test("rejects changed persisted queue contents when its saved fingerprint is stale", () => {
  const persistedQueue = queue();
  persistedQueue.variantEntries[0].variants[0].expectedCurrentMediaIds = [];

  assert.throws(
    () => bindVisualVariantApplyCheckpoint({ queue: persistedQueue, approvalBytes }),
    /contents do not match its queue fingerprint/,
  );
});

test("rejects changed approval-file bytes when resuming a checkpoint", () => {
  const persistedQueue = queue();
  const state = priorState(persistedQueue, approvalBytes);
  const changedApprovalBytes = Buffer.from('{ "approval": "reviewed" }\n', "utf8");

  assert.throws(
    () =>
      bindVisualVariantApplyCheckpoint({
        queue: persistedQueue,
        approvalBytes: changedApprovalBytes,
        priorState: state,
      }),
    /Approved mappings changed since the visual apply checkpoint/,
  );
});

test("allows resume when queue, exact approval bytes, and checkpoint bindings match", () => {
  const persistedQueue = queue();
  const state = priorState(persistedQueue, approvalBytes);

  assert.deepEqual(
    bindVisualVariantApplyCheckpoint({
      queue: persistedQueue,
      approvalBytes,
      priorState: state,
    }),
    {
      queueFingerprint: persistedQueue.queueFingerprint,
      approvedMappingsSha256: state.approvedMappingsSha256,
    },
  );
});
