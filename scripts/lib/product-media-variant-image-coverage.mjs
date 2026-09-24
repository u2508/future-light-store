/**
 * Pure reconciliation of a complete Shopify GraphQL product-media snapshot
 * with explicit media and variant-image-association audit decisions.
 *
 * A media decision is required for each MediaImage. A variant decision is
 * required for each current variant-to-MediaImage association; variants with
 * no image association require one explicit decision with mediaId: null.
 * This module performs no I/O and does not infer visual approval.
 */

export const PRODUCT_MEDIA_VARIANT_IMAGE_COVERAGE_SCHEMA_VERSION = 1;

const MEDIA_DECISIONS = new Set(["approved-existing-good", "rejected", "hold"]);

const VARIANT_ASSOCIATION_DECISIONS = new Set([
  "approved-existing-association",
  "approved-no-image-required",
  "hold",
]);

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedHandle(value) {
  return normalizeText(value).toLowerCase();
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function connectionNodes(connection) {
  if (Array.isArray(connection)) return connection;
  if (Array.isArray(connection?.nodes)) return connection.nodes;
  if (Array.isArray(connection?.edges)) return connection.edges.map((edge) => edge?.node);
  return null;
}

function hasCompletePaginationState(connection) {
  return Array.isArray(connection) || connection?.pageInfo?.hasNextPage === false;
}

function isMediaImage(media) {
  if (!media || typeof media !== "object") return false;
  if (media.__typename) return media.__typename === "MediaImage";
  return Boolean(media.image && typeof media.image === "object");
}

function mediaDecisionKey(productId, mediaId) {
  return JSON.stringify([productId, mediaId]);
}

function variantAssociationKey(productId, variantId, mediaId) {
  return JSON.stringify([productId, variantId, mediaId]);
}

function pushFinding(findings, category, code, details = {}) {
  findings.push({ category, code, ...details });
}

function hasExactSet(values, expected) {
  if (values.length !== expected.length) return false;
  const sortedValues = [...values].sort();
  const sortedExpected = [...expected].sort();
  return sortedValues.every((value, index) => value === sortedExpected[index]);
}

function countByCategory(findings) {
  const counts = { omitted: 0, duplicate: 0, stale: 0, mismatched: 0, invalid: 0, incomplete: 0 };
  for (const finding of findings) counts[finding.category] = (counts[finding.category] || 0) + 1;
  return counts;
}

/**
 * @param {{
 *   products: Array<object>,
 *   mediaDecisions: Array<object>,
 *   variantAssociationDecisions: Array<object>
 * }} snapshot
 * @returns {object} Deterministic report; `ready` is false for holds/rejections.
 */
export function validateProductMediaVariantImageCoverage(snapshot) {
  const findings = [];
  const products = Array.isArray(snapshot?.products) ? snapshot.products : [];
  const mediaDecisions = Array.isArray(snapshot?.mediaDecisions) ? snapshot.mediaDecisions : [];
  const variantDecisions = Array.isArray(snapshot?.variantAssociationDecisions)
    ? snapshot.variantAssociationDecisions
    : [];

  if (!snapshot || !Array.isArray(snapshot.products)) {
    pushFinding(findings, "invalid", "invalid-products-input", { field: "products" });
  }
  if (!Array.isArray(snapshot?.mediaDecisions)) {
    pushFinding(findings, "invalid", "invalid-media-decisions-input", { field: "mediaDecisions" });
  }
  if (!Array.isArray(snapshot?.variantAssociationDecisions)) {
    pushFinding(findings, "invalid", "invalid-variant-decisions-input", {
      field: "variantAssociationDecisions",
    });
  }

  const productById = new Map();
  const mediaByKey = new Map();
  const mediaById = new Map();
  const variantByKey = new Map();
  const variantsById = new Map();
  const expectedMedia = [];
  const expectedVariantAssociations = [];
  const invalidMediaDecisionKeys = new Set();
  const invalidVariantDecisionKeys = new Set();

  for (let productIndex = 0; productIndex < products.length; productIndex += 1) {
    const product = products[productIndex];
    const productId = normalizeText(product?.id);
    const handle = normalizeText(product?.handle);

    if (!productId) {
      pushFinding(findings, "invalid", "invalid-shopify-product-identity", { productIndex });
      continue;
    }
    if (productById.has(productId)) {
      pushFinding(findings, "duplicate", "duplicate-shopify-product-id", { productId });
      continue;
    }
    productById.set(productId, { product, handle });

    const mediaNodes = connectionNodes(product?.media);
    if (mediaNodes === null) {
      pushFinding(findings, "incomplete", "missing-or-invalid-product-media-connection", {
        productId,
      });
    } else {
      if (!hasCompletePaginationState(product.media)) {
        pushFinding(
          findings,
          "incomplete",
          product?.media?.pageInfo?.hasNextPage === true
            ? "incomplete-product-media-pagination"
            : "missing-product-media-pagination-state",
          { productId },
        );
      }

      for (let mediaIndex = 0; mediaIndex < mediaNodes.length; mediaIndex += 1) {
        const media = mediaNodes[mediaIndex];
        if (!media || typeof media !== "object") {
          pushFinding(findings, "invalid", "invalid-shopify-product-media-node", {
            productId,
            mediaIndex,
          });
          continue;
        }
        if (!media.__typename && !(media.image && typeof media.image === "object")) {
          pushFinding(findings, "incomplete", "unclassified-shopify-product-media-node", {
            productId,
            mediaIndex,
          });
          continue;
        }
        if (!isMediaImage(media)) continue;
        const mediaId = normalizeText(media?.id);
        if (!mediaId) {
          pushFinding(findings, "invalid", "invalid-shopify-media-image-identity", {
            productId,
            mediaIndex,
          });
          continue;
        }

        const item = { productId, handle, mediaId, media };
        const key = mediaDecisionKey(productId, mediaId);
        if (mediaByKey.has(key)) {
          pushFinding(findings, "duplicate", "duplicate-shopify-media-image", {
            productId,
            mediaId,
          });
        } else {
          mediaByKey.set(key, item);
          expectedMedia.push(item);
        }
        const owners = mediaById.get(mediaId) || [];
        if (owners.some((owner) => owner.productId !== productId)) {
          pushFinding(findings, "duplicate", "duplicate-shopify-media-image-id-across-products", {
            mediaId,
            productIds: [...owners.map((owner) => owner.productId), productId],
          });
        }
        owners.push(item);
        mediaById.set(mediaId, owners);
      }
    }

    const variantNodes = connectionNodes(product?.variants);
    if (variantNodes === null) {
      pushFinding(findings, "incomplete", "missing-or-invalid-product-variants-connection", {
        productId,
      });
      continue;
    }
    if (!hasCompletePaginationState(product.variants)) {
      pushFinding(
        findings,
        "incomplete",
        product?.variants?.pageInfo?.hasNextPage === true
          ? "incomplete-product-variants-pagination"
          : "missing-product-variants-pagination-state",
        { productId },
      );
    }

    for (let variantIndex = 0; variantIndex < variantNodes.length; variantIndex += 1) {
      const variant = variantNodes[variantIndex];
      const variantId = normalizeText(variant?.id);
      if (!variantId) {
        pushFinding(findings, "invalid", "invalid-shopify-variant-identity", {
          productId,
          variantIndex,
        });
        continue;
      }

      const variantKey = JSON.stringify([productId, variantId]);
      const variantRecord = { productId, handle, variantId, variant };
      if (variantByKey.has(variantKey)) {
        pushFinding(findings, "duplicate", "duplicate-shopify-variant-id", {
          productId,
          variantId,
        });
        continue;
      }
      variantByKey.set(variantKey, variantRecord);
      const variantOwners = variantsById.get(variantId) || [];
      if (variantOwners.some((owner) => owner.productId !== productId)) {
        pushFinding(findings, "duplicate", "duplicate-shopify-variant-id-across-products", {
          variantId,
          productIds: [...variantOwners.map((owner) => owner.productId), productId],
        });
      }
      variantOwners.push(variantRecord);
      variantsById.set(variantId, variantOwners);

      const associatedNodes = connectionNodes(variant?.media);
      if (associatedNodes === null) {
        pushFinding(findings, "incomplete", "missing-or-invalid-variant-media-connection", {
          productId,
          variantId,
        });
        continue;
      }
      if (!hasCompletePaginationState(variant.media)) {
        pushFinding(
          findings,
          "incomplete",
          variant?.media?.pageInfo?.hasNextPage === true
            ? "incomplete-variant-media-pagination"
            : "missing-variant-media-pagination-state",
          { productId, variantId },
        );
      }

      const associationIds = [];
      for (
        let associationIndex = 0;
        associationIndex < associatedNodes.length;
        associationIndex += 1
      ) {
        const media = associatedNodes[associationIndex];
        if (!media || typeof media !== "object") {
          pushFinding(findings, "invalid", "invalid-live-variant-media-node", {
            productId,
            variantId,
            associationIndex,
          });
          continue;
        }
        if (!media.__typename && !(media.image && typeof media.image === "object")) {
          pushFinding(findings, "incomplete", "unclassified-live-variant-media-node", {
            productId,
            variantId,
            associationIndex,
          });
          continue;
        }
        if (!isMediaImage(media)) continue;
        const mediaId = normalizeText(media?.id);
        if (!mediaId) {
          pushFinding(findings, "invalid", "invalid-live-variant-media-identity", {
            productId,
            variantId,
            associationIndex,
          });
          continue;
        }
        associationIds.push(mediaId);
        const owners = mediaById.get(mediaId) || [];
        if (!owners.some((owner) => owner.productId === productId)) {
          pushFinding(findings, "mismatched", "mismatched-live-variant-media-identity", {
            productId,
            variantId,
            mediaId,
            actualMediaProductIds: owners.map((owner) => owner.productId),
          });
        }
      }

      if (new Set(associationIds).size !== associationIds.length) {
        pushFinding(findings, "duplicate", "duplicate-live-variant-media-association", {
          productId,
          variantId,
          mediaIds: associationIds,
        });
      }

      if (associationIds.length === 0) {
        expectedVariantAssociations.push({ ...variantRecord, mediaId: null });
      } else {
        for (const mediaId of associationIds) {
          expectedVariantAssociations.push({ ...variantRecord, mediaId });
        }
      }
    }
  }

  const mediaDecisionGroups = new Map();
  for (let index = 0; index < mediaDecisions.length; index += 1) {
    const decision = mediaDecisions[index];
    const productId = normalizeText(decision?.productId);
    const mediaId = normalizeText(decision?.mediaId);
    if (!productId || !mediaId) {
      pushFinding(findings, "invalid", "invalid-media-decision-identity", { decisionIndex: index });
      continue;
    }

    const key = mediaDecisionKey(productId, mediaId);
    const group = mediaDecisionGroups.get(key) || [];
    group.push(decision);
    mediaDecisionGroups.set(key, group);

    const productRecord = productById.get(productId);
    const exactMedia = mediaByKey.get(key);
    const mediaOwners = mediaById.get(mediaId) || [];
    if (!exactMedia) {
      if (mediaOwners.length) {
        pushFinding(findings, "mismatched", "mismatched-media-product-identity", {
          decisionIndex: index,
          productId,
          mediaId,
          actualProductIds: mediaOwners.map((owner) => owner.productId),
        });
        invalidMediaDecisionKeys.add(key);
      } else {
        pushFinding(findings, "stale", "stale-media-decision-target", {
          decisionIndex: index,
          productId,
          mediaId,
        });
      }
    }
    if (!productRecord) {
      if (!mediaOwners.length) {
        pushFinding(findings, "stale", "stale-media-decision-product", {
          decisionIndex: index,
          productId,
          mediaId,
        });
      }
      invalidMediaDecisionKeys.add(key);
    }
    if (
      productRecord &&
      hasOwn(decision, "handle") &&
      normalizedHandle(decision.handle) !== normalizedHandle(productRecord.handle)
    ) {
      pushFinding(findings, "mismatched", "mismatched-media-handle-identity", {
        decisionIndex: index,
        productId,
        mediaId,
        expectedHandle: productRecord.handle,
        decisionHandle: normalizeText(decision.handle),
      });
      invalidMediaDecisionKeys.add(key);
    }
    if (!MEDIA_DECISIONS.has(decision?.decision)) {
      pushFinding(findings, "invalid", "invalid-media-decision", {
        decisionIndex: index,
        productId,
        mediaId,
        decision: normalizeText(decision?.decision),
      });
      invalidMediaDecisionKeys.add(key);
    } else if (
      (decision.decision === "hold" || decision.decision === "rejected") &&
      !normalizeText(decision.reasonCode || decision.reason)
    ) {
      pushFinding(findings, "invalid", "media-decision-reason-required", {
        decisionIndex: index,
        productId,
        mediaId,
        decision: decision.decision,
      });
      invalidMediaDecisionKeys.add(key);
    }
  }

  for (const [key, group] of mediaDecisionGroups) {
    if (group.length > 1) {
      const [productId, mediaId] = JSON.parse(key);
      pushFinding(findings, "duplicate", "duplicate-media-decision", {
        productId,
        mediaId,
        count: group.length,
      });
      invalidMediaDecisionKeys.add(key);
    }
  }

  const variantDecisionGroups = new Map();
  for (let index = 0; index < variantDecisions.length; index += 1) {
    const decision = variantDecisions[index];
    const productId = normalizeText(decision?.productId);
    const variantId = normalizeText(decision?.variantId);
    const hasMediaId = hasOwn(decision, "mediaId");
    const mediaId = decision?.mediaId === null ? null : normalizeText(decision?.mediaId);
    if (!productId || !variantId || !hasMediaId || (decision.mediaId !== null && !mediaId)) {
      pushFinding(findings, "invalid", "invalid-variant-association-decision-identity", {
        decisionIndex: index,
      });
      continue;
    }

    const key = variantAssociationKey(productId, variantId, mediaId);
    const group = variantDecisionGroups.get(key) || [];
    group.push(decision);
    variantDecisionGroups.set(key, group);

    const productRecord = productById.get(productId);
    const exactVariant = variantByKey.get(JSON.stringify([productId, variantId]));
    const variantOwners = variantsById.get(variantId) || [];
    if (!exactVariant) {
      if (variantOwners.length) {
        pushFinding(findings, "mismatched", "mismatched-variant-product-identity", {
          decisionIndex: index,
          productId,
          variantId,
          actualProductIds: variantOwners.map((owner) => owner.productId),
        });
        invalidVariantDecisionKeys.add(key);
      } else {
        pushFinding(findings, "stale", "stale-variant-decision-target", {
          decisionIndex: index,
          productId,
          variantId,
        });
      }
    }
    if (!productRecord) {
      if (!variantOwners.length) {
        pushFinding(findings, "stale", "stale-variant-decision-product", {
          decisionIndex: index,
          productId,
          variantId,
        });
      }
      invalidVariantDecisionKeys.add(key);
    }
    if (
      productRecord &&
      hasOwn(decision, "handle") &&
      normalizedHandle(decision.handle) !== normalizedHandle(productRecord.handle)
    ) {
      pushFinding(findings, "mismatched", "mismatched-variant-handle-identity", {
        decisionIndex: index,
        productId,
        variantId,
        expectedHandle: productRecord.handle,
        decisionHandle: normalizeText(decision.handle),
      });
      invalidVariantDecisionKeys.add(key);
    }

    if (mediaId !== null) {
      const mediaOwners = mediaById.get(mediaId) || [];
      if (!mediaOwners.length) {
        pushFinding(findings, "stale", "stale-variant-association-media-target", {
          decisionIndex: index,
          productId,
          variantId,
          mediaId,
        });
        invalidVariantDecisionKeys.add(key);
      } else if (!mediaOwners.some((owner) => owner.productId === productId)) {
        pushFinding(findings, "mismatched", "mismatched-variant-association-product-identity", {
          decisionIndex: index,
          productId,
          variantId,
          mediaId,
          actualMediaProductIds: mediaOwners.map((owner) => owner.productId),
        });
        invalidVariantDecisionKeys.add(key);
      }
      if (exactVariant) {
        const currentNodes = connectionNodes(exactVariant.variant?.media) || [];
        const isCurrentAssociation = currentNodes.some(
          (media) => isMediaImage(media) && normalizeText(media?.id) === mediaId,
        );
        if (!isCurrentAssociation) {
          pushFinding(findings, "stale", "stale-variant-association-decision-target", {
            decisionIndex: index,
            productId,
            variantId,
            mediaId,
          });
          invalidVariantDecisionKeys.add(key);
        }
      }
    } else if (exactVariant) {
      const currentNodes = connectionNodes(exactVariant.variant?.media) || [];
      const currentImageIds = currentNodes
        .filter(isMediaImage)
        .map((media) => normalizeText(media?.id))
        .filter(Boolean);
      if (currentImageIds.length) {
        pushFinding(findings, "mismatched", "mismatched-empty-variant-association-decision", {
          decisionIndex: index,
          productId,
          variantId,
          currentMediaIds: currentImageIds,
        });
        invalidVariantDecisionKeys.add(key);
      }
    }

    if (!VARIANT_ASSOCIATION_DECISIONS.has(decision?.decision)) {
      pushFinding(findings, "invalid", "invalid-variant-association-decision", {
        decisionIndex: index,
        productId,
        variantId,
        mediaId,
        decision: normalizeText(decision?.decision),
      });
      invalidVariantDecisionKeys.add(key);
    } else if (
      decision.decision === "hold" &&
      !normalizeText(decision.reasonCode || decision.reason)
    ) {
      pushFinding(findings, "invalid", "variant-association-hold-reason-required", {
        decisionIndex: index,
        productId,
        variantId,
        mediaId,
      });
      invalidVariantDecisionKeys.add(key);
    } else if (decision.decision === "approved-existing-association" && mediaId === null) {
      pushFinding(findings, "mismatched", "existing-association-approval-has-no-media", {
        decisionIndex: index,
        productId,
        variantId,
      });
      invalidVariantDecisionKeys.add(key);
    } else if (decision.decision === "approved-no-image-required" && mediaId !== null) {
      pushFinding(findings, "mismatched", "no-image-approval-targets-media", {
        decisionIndex: index,
        productId,
        variantId,
        mediaId,
      });
      invalidVariantDecisionKeys.add(key);
    }
  }

  for (const [key, group] of variantDecisionGroups) {
    if (group.length > 1) {
      const [productId, variantId, mediaId] = JSON.parse(key);
      pushFinding(findings, "duplicate", "duplicate-variant-association-decision", {
        productId,
        variantId,
        mediaId,
        count: group.length,
      });
      invalidVariantDecisionKeys.add(key);
    }
  }

  const mediaResults = expectedMedia.map((item) => {
    const key = mediaDecisionKey(item.productId, item.mediaId);
    const group = mediaDecisionGroups.get(key) || [];
    let status = "missing";
    if (group.length > 1) status = "duplicate";
    else if (group.length === 1) {
      if (invalidMediaDecisionKeys.has(key)) status = "invalid";
      else if (group[0].decision === "approved-existing-good") status = "approved";
      else if (group[0].decision === "rejected") status = "rejected";
      else if (group[0].decision === "hold") status = "held";
      else status = "invalid";
    }
    if (group.length === 0) {
      pushFinding(findings, "omitted", "omitted-media-decision", {
        productId: item.productId,
        mediaId: item.mediaId,
      });
    }
    return {
      productId: item.productId,
      handle: item.handle,
      mediaId: item.mediaId,
      decision: group.length === 1 ? normalizeText(group[0].decision) || null : null,
      reasonCode: group.length === 1 ? normalizeText(group[0].reasonCode) || null : null,
      status,
    };
  });

  const variantAssociationResults = expectedVariantAssociations.map((item) => {
    const key = variantAssociationKey(item.productId, item.variantId, item.mediaId);
    const group = variantDecisionGroups.get(key) || [];
    let status = "missing";
    if (group.length > 1) status = "duplicate";
    else if (group.length === 1) {
      if (invalidVariantDecisionKeys.has(key)) status = "invalid";
      else if (group[0].decision === "hold") status = "held";
      else if (
        group[0].decision === "approved-existing-association" ||
        group[0].decision === "approved-no-image-required"
      )
        status = "approved";
      else status = "invalid";
    }
    if (group.length === 0) {
      pushFinding(findings, "omitted", "omitted-variant-association-decision", {
        productId: item.productId,
        variantId: item.variantId,
        mediaId: item.mediaId,
      });
    }
    return {
      productId: item.productId,
      handle: item.handle,
      variantId: item.variantId,
      mediaId: item.mediaId,
      decision: group.length === 1 ? normalizeText(group[0].decision) || null : null,
      reasonCode: group.length === 1 ? normalizeText(group[0].reasonCode) || null : null,
      status,
    };
  });

  const issueCounts = countByCategory(findings);
  const approvedMediaImages = mediaResults.filter((item) => item.status === "approved").length;
  const rejectedMediaImages = mediaResults.filter((item) => item.status === "rejected").length;
  const heldMediaImages = mediaResults.filter((item) => item.status === "held").length;
  const approvedVariantAssociations = variantAssociationResults.filter(
    (item) => item.status === "approved",
  ).length;
  const heldVariantAssociations = variantAssociationResults.filter(
    (item) => item.status === "held",
  ).length;
  const complete = findings.length === 0;

  return {
    schemaVersion: PRODUCT_MEDIA_VARIANT_IMAGE_COVERAGE_SCHEMA_VERSION,
    complete,
    ready:
      complete &&
      rejectedMediaImages === 0 &&
      heldMediaImages === 0 &&
      heldVariantAssociations === 0,
    summary: {
      products: productById.size,
      productMediaImages: expectedMedia.length,
      variantImageAssociations: expectedVariantAssociations.length,
      approvedMediaImages,
      rejectedMediaImages,
      heldMediaImages,
      approvedVariantAssociations,
      heldVariantAssociations,
      issues: issueCounts,
    },
    mediaDecisions: mediaResults,
    variantAssociationDecisions: variantAssociationResults,
    findings,
  };
}
