import { validateShopifyCategoryMetafieldReadback } from "./shopify-category-metafield-readback-validator.mjs";

function definitionKeyOf(entry) {
  if (typeof entry?.definition === "string" && entry.definition.includes(".")) {
    return entry.definition;
  }
  const namespace = String(entry?.namespace || "shopify").trim();
  const key = String(entry?.key || "").trim();
  return namespace && key ? `${namespace}.${key}` : "";
}

function productIdOf(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text.startsWith("gid://shopify/Product/")) return text;
  return `gid://shopify/Product/${text}`;
}

export function assertCategoryMetafieldPlanMappings({ plans, expectedProductIds }) {
  if (!Array.isArray(plans) || plans.length === 0) {
    throw new Error("Category-metafield mapping gate requires a non-empty product plan cohort");
  }
  if (!Array.isArray(expectedProductIds) || expectedProductIds.length === 0) {
    throw new Error("Category-metafield mapping gate requires the exact non-empty product cohort");
  }
  const expectedIds = [...new Set(expectedProductIds.map(productIdOf))].sort();
  const planIds = [];
  for (const plan of plans) {
    const productId = productIdOf(plan?.productId);
    if (!productId || !String(plan?.categoryId || "").trim()) {
      throw new Error("Category-metafield plan has an unknown product or category mapping");
    }
    if (!Array.isArray(plan.writes) || !Array.isArray(plan.skipped)) {
      throw new Error(`Category-metafield plan is incomplete for ${productId}`);
    }
    const unmapped = plan.skipped.filter((entry) =>
      /no category metafield definition|category attributes unavailable|unknown.*metafield|unmapped.*metafield/i
        .test(String(entry?.reason || "")),
    );
    if (unmapped.length) {
      const names = unmapped.map((entry) => entry.attributeName || entry.reason).join(", ");
      throw new Error(`Unknown or unmapped required category metafield for ${productId}: ${names}`);
    }
    const requiredEvidenceHolds = plan.skipped.filter((entry) =>
      entry?.required === true || /\brequired\b.*\b(?:missing|unavailable|no evidence)/i.test(String(entry?.reason || "")),
    );
    if (requiredEvidenceHolds.length) {
      const entry = requiredEvidenceHolds[0];
      const key = definitionKeyOf(entry);
      if (!key) {
        throw new Error(`Unknown or unmapped required category metafield for ${productId}: ${entry.attributeName || entry.reason}`);
      }
      throw new Error(`Required category metafield ${key} is unresolved for ${productId}: ${entry.reason || "missing evidence"}`);
    }
    const evidenceBackedWrites = plan.writes.filter(
      (write) => write?.clear !== true && write?.action !== "clear-invalid" && String(write?.key || "").trim(),
    );
    if (evidenceBackedWrites.length === 0) {
      throw new Error(`No evidence-backed category metafield values are available for ${productId}`);
    }
    planIds.push(productId);
  }
  if (new Set(expectedIds).size !== expectedProductIds.length || new Set(planIds).size !== planIds.length) {
    throw new Error("Category-metafield product cohort contains duplicate IDs");
  }
  const missing = expectedIds.filter((id) => !planIds.includes(id));
  const unexpected = planIds.filter((id) => !expectedIds.includes(id));
  if (missing.length || unexpected.length) {
    throw new Error(
      `Category-metafield plan cohort mismatch: ${missing.length} missing and ${unexpected.length} unexpected product plan(s)`,
    );
  }
  return { expectedProducts: expectedIds.length, unmappedRequiredFields: 0 };
}

/**
 * Build a strict, manifest-bounded category-metafield readback comparison.
 * Every category-bearing product must have a plan. Unknown definitions and
 * required fields without evidence remain blockers; this helper never guesses
 * a namespace, key, category, or value.
 */
export function buildCategoryMetafieldReadbackInput({
  plans,
  resolvedWrites,
  expectedProductIds,
}) {
  if (!Array.isArray(plans) || plans.length === 0) {
    throw new Error("Category-metafield readback requires a non-empty product plan cohort");
  }
  if (!Array.isArray(resolvedWrites)) throw new TypeError("resolvedWrites must be an array");
  if (!Array.isArray(expectedProductIds) || expectedProductIds.length === 0) {
    throw new Error("Category-metafield readback requires the exact non-empty category product cohort");
  }

  assertCategoryMetafieldPlanMappings({ plans, expectedProductIds });
  const planByProductId = new Map();
  for (const plan of plans) {
    const productId = productIdOf(plan?.productId);
    const categoryId = String(plan?.categoryId || "").trim();
    if (!productId || !categoryId) {
      throw new Error("Category-metafield plan has an unknown product or category mapping");
    }
    if (!Array.isArray(plan.writes) || !Array.isArray(plan.skipped)) {
      throw new Error(`Category-metafield plan is incomplete for ${productId}`);
    }
    if (planByProductId.has(productId)) {
      throw new Error(`Duplicate category-metafield plan for ${productId}`);
    }
    planByProductId.set(productId, plan);
  }

  const expectedIds = [...new Set(expectedProductIds.map(productIdOf))].sort();
  if (expectedIds.some((id) => !id)) throw new Error("Expected category product cohort contains an invalid product ID");
  if (expectedIds.length !== expectedProductIds.length) {
    throw new Error("Expected category product cohort contains duplicate product IDs");
  }
  const plannedIds = [...planByProductId.keys()].sort();
  const missingPlans = expectedIds.filter((id) => !planByProductId.has(id));
  const unexpectedPlans = plannedIds.filter((id) => !expectedIds.includes(id));
  if (missingPlans.length || unexpectedPlans.length) {
    throw new Error(
      `Category-metafield plan cohort mismatch: ${missingPlans.length} missing and ${unexpectedPlans.length} unexpected product plan(s)`,
    );
  }

  const resolvedByKey = new Map();
  for (const entry of resolvedWrites) {
    const productId = productIdOf(entry?.productId || entry?.ownerId);
    const key = definitionKeyOf(entry);
    if (!productId || !key) throw new Error("Resolved category-metafield write has unknown product or definition mapping");
    const mapKey = `${productId}\u0000${key}`;
    if (resolvedByKey.has(mapKey)) throw new Error(`Duplicate resolved category-metafield value ${key} for ${productId}`);
    resolvedByKey.set(mapKey, entry);
  }

  const expectedProducts = [];
  for (const productId of expectedIds) {
    const plan = planByProductId.get(productId);
    const requiredKeys = new Set();
    const writesByKey = new Map();
    for (const write of plan.writes) {
      const key = definitionKeyOf(write);
      if (!key) throw new Error(`Planned category metafield has no definition key for ${productId}`);
      const group = writesByKey.get(key) || [];
      group.push(write);
      writesByKey.set(key, group);
    }
    for (const [key, group] of writesByKey) {
      if (!group.every((write) => write.clear === true || write.action === "clear-invalid")) {
        requiredKeys.add(key);
      }
    }
    for (const skipped of plan.skipped) {
      const key = definitionKeyOf(skipped);
      if (skipped?.required === true) {
        if (!key) {
          throw new Error(`Unknown or unmapped required category metafield for ${productId}`);
        }
        requiredKeys.add(key);
        throw new Error(`Required category metafield ${key} has no evidence-backed value for ${productId}`);
      }
    }
    const metafields = [];
    for (const [key, group] of writesByKey) {
      if (group.every((write) => write.clear === true || write.action === "clear-invalid")) {
        metafields.push({
          definitionKey: { namespace: group[0].namespace, key: group[0].key },
          expectedType: group[0].type,
          canonicalValue: "[]",
        });
        continue;
      }
      const resolved = resolvedByKey.get(`${productId}\u0000${key}`);
      if (resolved) {
        metafields.push({
          definitionKey: { namespace: resolved.namespace, key: resolved.key },
          expectedType: resolved.type,
          canonicalValue: String(resolved.value),
        });
        continue;
      }
      const referenceIds = [...new Set(group.flatMap((write) => write.currentReferenceIds || []).map(String))];
      if (!referenceIds.length) {
        throw new Error(`Required category metafield ${key} was not resolved for ${productId}`);
      }
      metafields.push({
        definitionKey: { namespace: group[0].namespace, key: group[0].key },
        expectedType: group[0].type,
        canonicalReference: referenceIds,
      });
    }
    expectedProducts.push({
      productId,
      categoryId: plan.categoryId,
      metafields,
      requiredDefinitionKeys: [...requiredKeys].sort(),
    });
  }

  return { expectedProducts };
}

export function validateCategoryMetafieldReadback({ expectedProducts, readbackProducts }) {
  return validateShopifyCategoryMetafieldReadback({
    expectedProducts,
    readbackProducts,
    managedMetafieldNamespaces: ["shopify"],
  });
}

export function assertCategoryMetafieldReadbackReceipt(manifest) {
  const receipt = manifest?.categoryMetafieldReadback;
  if (!receipt || receipt.status !== "pass") {
    throw new Error("Category-metafield live readback receipt is missing or failed");
  }
  if (!Number.isInteger(receipt.expectedProducts) || receipt.expectedProducts < 1) {
    throw new Error("Category-metafield live readback receipt has no complete product cohort");
  }
  if (
    !Number.isInteger(receipt.readbackProducts) ||
    receipt.readbackProducts !== receipt.expectedProducts
  ) {
    throw new Error("Category-metafield live readback receipt does not cover the complete product cohort");
  }
  if (!Number.isInteger(receipt.checkedRequiredFields) || receipt.checkedRequiredFields < 1) {
    throw new Error("Category-metafield live readback receipt has no checked required fields");
  }
  if (typeof receipt.generatedAt !== "string" || !Number.isFinite(Date.parse(receipt.generatedAt))) {
    throw new Error("Category-metafield live readback receipt has no valid timestamp");
  }
  if (receipt.unmappedRequiredFields !== 0 || receipt.missing !== 0 || receipt.mismatch !== 0 || receipt.unexpected !== 0) {
    throw new Error("Category-metafield live readback receipt contains unresolved fields");
  }
  return receipt;
}
