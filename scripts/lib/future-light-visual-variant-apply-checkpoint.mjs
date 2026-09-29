import { createHash } from "node:crypto";

export const VISUAL_VARIANT_APPLY_STATE_SCHEMA_VERSION =
  "2026-09-28.future-light-visual-variant-apply.2";

/** Recompute the exact queue digest contract used by the review queue builder. */
export function computeVisualVariantQueueFingerprint(queue) {
  const payload = {
    targetStoreDomain: queue?.targetStoreDomain,
    catalogSnapshotGeneratedAt: queue?.sourceEvidence?.catalogSnapshotGeneratedAt,
    optionEntries: queue?.optionEntries,
    variantOptionEntries: queue?.variantOptionEntries,
    variantEntries: queue?.variantEntries,
    imageEntries: queue?.imageEntries,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * Verify persisted inputs and bind a resumable apply state to those exact bytes.
 * approvalBytes must be the same Buffer parsed by the caller for its apply run.
 */
export function bindVisualVariantApplyCheckpoint({ queue, approvalBytes, priorState = null }) {
  const queueFingerprint = computeVisualVariantQueueFingerprint(queue);
  if (queue?.queueFingerprint !== queueFingerprint) {
    throw new Error("Persisted visual apply queue contents do not match its queue fingerprint.");
  }

  if (!Buffer.isBuffer(approvalBytes)) {
    throw new TypeError("Visual apply approval bytes must be read from the exact approval file.");
  }
  const approvedMappingsSha256 = createHash("sha256").update(approvalBytes).digest("hex");

  if (priorState !== null && priorState !== undefined) {
    if (priorState.schemaVersion !== VISUAL_VARIANT_APPLY_STATE_SCHEMA_VERSION) {
      throw new Error("Visual apply state uses an unsupported checkpoint schema; refusing resume.");
    }
    if (priorState.targetStoreDomain !== queue?.targetStoreDomain) {
      throw new Error("Visual apply state targets a different store; refusing resume.");
    }
    if (priorState.queueFingerprint !== queueFingerprint) {
      throw new Error("Visual apply state is bound to a different queue fingerprint; refusing resume.");
    }
    if (priorState.approvedMappingsSha256 !== approvedMappingsSha256) {
      throw new Error("Approved mappings changed since the visual apply checkpoint; refusing resume.");
    }
    if (!Array.isArray(priorState.completedHandles)) {
      throw new Error("Visual apply checkpoint has no valid completed-handle list; refusing resume.");
    }
  }

  return { queueFingerprint, approvedMappingsSha256 };
}
