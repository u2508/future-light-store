import { isShopifyGidOfType, sameProductGid } from "./visual-approval-integrity.mjs";

function normalize(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalOptions(options) {
  return JSON.stringify(
    (Array.isArray(options) ? options : []).map((option) => [
      normalize(option?.name),
      normalize(option?.value),
    ]),
  );
}

function sameStringArray(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

/** Validate one exact, visually reviewed decision for every queued variant. */
export function validateVariantImageAssignments(queue, assignments) {
  const failures = [];
  const entries = Array.isArray(queue?.variantEntries) ? queue.variantEntries : [];
  const items = Array.isArray(assignments) ? assignments : [];
  const groups = new Map();
  for (const item of items) {
    const key = normalize(item?.variantId);
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  }

  const queuedIds = new Set();
  for (const entry of entries) {
    for (const variant of entry.variants || []) {
      const variantId = normalize(variant.variantId);
      const group = groups.get(variantId) || [];
      queuedIds.add(variantId);
      if (group.length === 0) {
        failures.push(`${entry.handle}: missing reviewed image mapping for ${variant.title}`);
        continue;
      }
      if (group.length > 1) {
        failures.push(`${entry.handle}: duplicate reviewed image mappings for ${variant.title}`);
        continue;
      }
      const decision = group[0];
      if (!sameProductGid(decision.productId, entry.productId)) {
        failures.push(
          `${entry.handle}: variant media decision is not bound to the exact queued product`,
        );
      }
      if (normalize(decision.handle) !== entry.handle) {
        failures.push(
          `${entry.handle}: variant media decision handle does not match the exact queued product`,
        );
      }
      if (!isShopifyGidOfType(decision.variantId, "ProductVariant")) {
        failures.push(
          `${entry.handle}: variant decision requires a typed Shopify ProductVariant GID`,
        );
      }
      if (decision.queueFingerprint !== queue.queueFingerprint) {
        failures.push(
          `${entry.handle}: variant decision is not bound to the current complete visual-review snapshot`,
        );
      }
      if (
        decision.reviewedBy !== "ChatGPT" ||
        decision.reviewMethod !== "internal-browser-contact-sheet"
      ) {
        failures.push(
          `${entry.handle}: variant image mapping must be recorded as a ChatGPT visual review`,
        );
      }
      if (normalize(decision.reviewNote).length < 30) {
        failures.push(
          `${entry.handle}: variant image mapping requires a specific visual review note`,
        );
      }
      if (
        !sameStringArray(decision.expectedCurrentMediaIds, variant.expectedCurrentMediaIds || [])
      ) {
        failures.push(
          `${entry.handle}: current variant image changed or its exact preimage was not recorded for ${variantId}`,
        );
      }
      if (
        canonicalOptions(decision.selectedOptions) !== canonicalOptions(variant.selectedOptions)
      ) {
        failures.push(
          `${entry.handle}: selected options changed or were not bound to the visual review for ${variantId}`,
        );
      }

      if (decision.mediaId === null) {
        if (
          decision.decision !== "approved-no-image-required" ||
          (variant.expectedCurrentMediaIds || []).length > 0
        ) {
          failures.push(
            `${entry.handle}: explicit no-image approval is invalid for ${variant.title}`,
          );
        }
      } else if (!isShopifyGidOfType(decision.mediaId, "MediaImage")) {
        failures.push(
          `${entry.handle}: variant media decision requires a typed Shopify MediaImage GID`,
        );
      } else if (decision.decision !== "approved-variant-image") {
        failures.push(`${entry.handle}: variant image decision has an unsupported approval type`);
      } else if (!(entry.media || []).some((media) => media.id === decision.mediaId)) {
        failures.push(
          `${entry.handle}: media mapping for ${variant.title} is not one of the product's live media IDs`,
        );
      }
    }
  }
  for (const variantId of groups.keys()) {
    if (!queuedIds.has(variantId)) {
      failures.push(
        `variant media decision targets an unknown or stale Shopify variant (${variantId})`,
      );
    }
  }
  return failures;
}

export function createVariantImageAssignment(queue, { product, variant, mediaId, reviewNote }) {
  const normalizedNote = normalize(reviewNote);
  if (normalizedNote.length < 30)
    throw new Error("A specific visual comparison note of at least 30 characters is required.");
  const exactProduct = (queue?.variantEntries || []).find(
    (entry) => entry.productId === product?.productId && entry.handle === product?.handle,
  );
  const exactVariant = exactProduct?.variants?.find(
    (entry) => entry.variantId === variant?.variantId,
  );
  if (!exactProduct || !exactVariant)
    throw new Error("The selected product and variant do not exist in this exact review queue.");

  if (mediaId === null) {
    if ((exactVariant.expectedCurrentMediaIds || []).length > 0) {
      throw new Error(
        "Cannot approve no-image for a variant that currently has an image association; choose a product gallery image or hold it for review.",
      );
    }
  } else if (!(exactProduct.media || []).some((media) => media.id === mediaId)) {
    throw new Error("The selected image is not part of this exact Shopify product gallery.");
  }

  return {
    productId: exactProduct.productId,
    handle: exactProduct.handle,
    variantId: exactVariant.variantId,
    selectedOptions: exactVariant.selectedOptions,
    expectedCurrentMediaIds: exactVariant.expectedCurrentMediaIds,
    mediaId,
    decision: mediaId === null ? "approved-no-image-required" : "approved-variant-image",
    queueFingerprint: queue.queueFingerprint,
    reviewedBy: "ChatGPT",
    reviewMethod: "internal-browser-contact-sheet",
    reviewedAt: new Date().toISOString(),
    reviewNote: normalizedNote,
  };
}
