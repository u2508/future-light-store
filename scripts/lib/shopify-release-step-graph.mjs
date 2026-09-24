import { createHash } from "node:crypto";

export const SHOPIFY_RELEASE_GRAPH_SCHEMA_VERSION = 2;

const TARGET = "shopify";
const MANIFEST_SCOPE = "approved-product-manifest";
const EMPTY = Object.freeze([]);
const APPROVED_PRODUCT_SCOPE = Object.freeze([
  "approved-product-manifest-only",
  "approved-values-only",
]);

const BASE_STAGES = Object.freeze([
  Object.freeze({
    id: "shopify.preflight.target",
    kind: "shopify-read",
    operation: "verify-target",
    scope: "configured-shopify-store",
    mutates: EMPTY,
    verifies: EMPTY,
    constraints: EMPTY,
    dependsOn: EMPTY,
  }),
  Object.freeze({
    id: "shopify.read.approved-product-snapshot",
    kind: "shopify-read",
    operation: "read-approved-product-snapshot",
    scope: MANIFEST_SCOPE,
    mutates: EMPTY,
    verifies: EMPTY,
    constraints: EMPTY,
    dependsOn: Object.freeze(["shopify.preflight.target"]),
  }),
]);

const MUTATING_STAGES = Object.freeze([
  Object.freeze({
    id: "shopify.apply.approved-product-content",
    kind: "shopify-mutation",
    operation: "update-approved-product-title-body-and-seo",
    scope: MANIFEST_SCOPE,
    mutates: Object.freeze([
      "product.title",
      "product.descriptionHtml",
      "product.seo.title",
      "product.seo.description",
    ]),
    verifies: EMPTY,
    constraints: Object.freeze([
      ...APPROVED_PRODUCT_SCOPE,
      "preserve-approved-keep-byte-for-byte",
      "rewrite-needs-rewrite-only",
      "independent-claim-ledger-required",
      "reject-generic-or-self-evidenced-copy",
    ]),
    dependsOn: Object.freeze(["shopify.read.approved-product-snapshot"]),
  }),
  Object.freeze({
    id: "shopify.apply.approved-native-category",
    kind: "shopify-mutation",
    operation: "assign-approved-native-product-category",
    scope: MANIFEST_SCOPE,
    mutates: Object.freeze(["product.category"]),
    verifies: EMPTY,
    constraints: APPROVED_PRODUCT_SCOPE,
    dependsOn: Object.freeze(["shopify.read.approved-product-snapshot"]),
  }),
  Object.freeze({
    id: "shopify.apply.approved-category-metafields",
    kind: "shopify-mutation",
    operation: "set-approved-category-metafields",
    scope: MANIFEST_SCOPE,
    mutates: Object.freeze(["product.categoryMetafields.approvedKeys"]),
    verifies: EMPTY,
    constraints: APPROVED_PRODUCT_SCOPE,
    dependsOn: Object.freeze(["shopify.apply.approved-native-category"]),
  }),
  Object.freeze({
    id: "shopify.apply.approved-product-metafields",
    kind: "shopify-mutation",
    operation: "set-approved-product-metafields",
    scope: MANIFEST_SCOPE,
    mutates: Object.freeze(["product.metafields.approvedKeys"]),
    verifies: EMPTY,
    constraints: APPROVED_PRODUCT_SCOPE,
    dependsOn: Object.freeze(["shopify.read.approved-product-snapshot"]),
  }),
  Object.freeze({
    id: "shopify.apply.approved-shopper-readable-variant-options",
    kind: "shopify-mutation",
    operation: "set-approved-shopper-readable-variant-options",
    scope: MANIFEST_SCOPE,
    mutates: Object.freeze([
      "product.options.shopperReadableNames",
      "variant.optionValues.shopperReadable",
    ]),
    verifies: EMPTY,
    constraints: APPROVED_PRODUCT_SCOPE,
    dependsOn: Object.freeze(["shopify.read.approved-product-snapshot"]),
  }),
  Object.freeze({
    id: "shopify.apply.approved-safe-product-image-replacements",
    kind: "shopify-mutation",
    operation: "apply-approved-product-image-replacements-and-alt-text",
    scope: MANIFEST_SCOPE,
    mutates: Object.freeze(["product.media.approvedReplacementPairs", "product.media.altText"]),
    verifies: EMPTY,
    constraints: Object.freeze([
      ...APPROVED_PRODUCT_SCOPE,
      "approved-source-images-only",
      "explicit-approved-replacement-pairs-only",
      "preserve-unlisted-media",
    ]),
    dependsOn: Object.freeze(["shopify.read.approved-product-snapshot"]),
  }),
  Object.freeze({
    id: "shopify.apply.approved-variant-image-mapping",
    kind: "shopify-mutation",
    operation: "map-approved-variants-to-approved-images",
    scope: MANIFEST_SCOPE,
    mutates: Object.freeze(["variant.imageId.approvedMapping"]),
    verifies: EMPTY,
    constraints: Object.freeze([
      ...APPROVED_PRODUCT_SCOPE,
      "approved-variant-to-media-pairs-only",
      "media-must-exist-in-snapshot-or-approved-replacement-stage",
    ]),
    dependsOn: Object.freeze([
      "shopify.apply.approved-shopper-readable-variant-options",
      "shopify.apply.approved-safe-product-image-replacements",
    ]),
  }),
]);

const FINAL_STAGE = Object.freeze({
  id: "shopify.verify.approved-product-exact-readback",
  kind: "shopify-readback",
  operation: "verify-exact-approved-product-manifest-readback",
  scope: MANIFEST_SCOPE,
  mutates: EMPTY,
  constraints: EMPTY,
});

const MUTATING_STAGE_BY_ID = new Map(MUTATING_STAGES.map((stage) => [stage.id, stage]));

export const SHOPIFY_RELEASE_STAGE_IDS = Object.freeze([
  ...BASE_STAGES.map(({ id }) => id),
  ...MUTATING_STAGES.map(({ id }) => id),
  FINAL_STAGE.id,
]);

export const SHOPIFY_MUTATING_STAGE_IDS = Object.freeze(MUTATING_STAGES.map(({ id }) => id));

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function validateInputFingerprint(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError("approvedInputFingerprint must be a lowercase SHA-256 hex digest");
  }
  return value;
}

function requestedStageId(requestedStage, index) {
  if (typeof requestedStage === "string") return requestedStage;

  if (!requestedStage || typeof requestedStage !== "object" || Array.isArray(requestedStage)) {
    throw new TypeError(`requestedStages[${index}] must be a Shopify stage ID or descriptor`);
  }

  const idProperty = Object.getOwnPropertyDescriptor(requestedStage, "id");
  const targetProperty = Object.getOwnPropertyDescriptor(requestedStage, "target");
  const keys = Object.keys(requestedStage).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== "id" ||
    keys[1] !== "target" ||
    !idProperty ||
    !targetProperty ||
    !("value" in idProperty) ||
    !("value" in targetProperty)
  ) {
    throw new TypeError(`requestedStages[${index}] must contain only data fields id and target`);
  }

  if (targetProperty.value !== TARGET) {
    throw new Error(`Non-Shopify stage target is not allowed: ${String(targetProperty.value)}`);
  }

  return idProperty.value;
}

function normalizeRequestedStages(requestedStages) {
  if (!Array.isArray(requestedStages)) {
    throw new TypeError("requestedStages must be an array");
  }

  const selectedIds = new Set();
  requestedStages.forEach((requestedStage, index) => {
    const id = requestedStageId(requestedStage, index);
    if (typeof id !== "string" || !MUTATING_STAGE_BY_ID.has(id)) {
      throw new Error(`Unknown or non-mutable Shopify release stage: ${String(id)}`);
    }
    if (selectedIds.has(id)) throw new Error(`Duplicate Shopify release stage: ${id}`);
    selectedIds.add(id);
  });

  for (const id of selectedIds) {
    const stage = MUTATING_STAGE_BY_ID.get(id);
    const missingMutationDependencies = stage.dependsOn.filter(
      (dependencyId) => MUTATING_STAGE_BY_ID.has(dependencyId) && !selectedIds.has(dependencyId),
    );
    if (missingMutationDependencies.length) {
      throw new Error(
        `Shopify stage ${id} requires selected prerequisite stage(s): ${missingMutationDependencies.join(", ")}`,
      );
    }
  }

  return MUTATING_STAGES.filter(({ id }) => selectedIds.has(id));
}

function freezeStage(stage) {
  return Object.freeze({
    ...stage,
    mutates: Object.freeze([...stage.mutates]),
    verifies: Object.freeze([...stage.verifies]),
    constraints: Object.freeze([...stage.constraints]),
    dependsOn: Object.freeze([...stage.dependsOn]),
  });
}

/**
 * Build a deterministic, Shopify-only step graph. This module describes steps;
 * it performs no release actions or external I/O.
 */
export function buildShopifyReleaseStepGraph({
  approvedInputFingerprint,
  requestedStages = SHOPIFY_MUTATING_STAGE_IDS,
} = {}) {
  const inputFingerprint = validateInputFingerprint(approvedInputFingerprint);
  const selectedMutations = normalizeRequestedStages(requestedStages);
  const selectedIds = new Set(selectedMutations.map(({ id }) => id));

  const definitions = [
    ...BASE_STAGES,
    ...MUTATING_STAGES.filter(({ id }) => selectedIds.has(id)),
    {
      ...FINAL_STAGE,
      verifies: selectedMutations.flatMap(({ mutates }) => mutates),
      dependsOn: selectedMutations.length
        ? selectedMutations.map(({ id }) => id)
        : [BASE_STAGES[1].id],
    },
  ];

  const fingerprintById = new Map();
  const stages = definitions.map((definition) => {
    const dependencyFingerprints = definition.dependsOn.map((dependencyId) => {
      const dependencyFingerprint = fingerprintById.get(dependencyId);
      if (!dependencyFingerprint) throw new Error(`Missing graph dependency: ${dependencyId}`);
      return { id: dependencyId, fingerprint: dependencyFingerprint };
    });

    const resumeFingerprint = sha256({
      schemaVersion: SHOPIFY_RELEASE_GRAPH_SCHEMA_VERSION,
      approvedInputFingerprint: inputFingerprint,
      stage: {
        id: definition.id,
        target: TARGET,
        kind: definition.kind,
        operation: definition.operation,
        scope: definition.scope,
        mutates: definition.mutates,
        verifies: definition.verifies,
        constraints: definition.constraints,
        dependsOn: definition.dependsOn,
      },
      dependencyFingerprints,
    });

    fingerprintById.set(definition.id, resumeFingerprint);
    return freezeStage({
      ...definition,
      target: TARGET,
      resumeFingerprint,
    });
  });

  const graphFingerprint = sha256({
    schemaVersion: SHOPIFY_RELEASE_GRAPH_SCHEMA_VERSION,
    target: TARGET,
    approvedInputFingerprint: inputFingerprint,
    stages: stages.map(({ id, resumeFingerprint }) => ({ id, resumeFingerprint })),
  });

  return Object.freeze({
    schemaVersion: SHOPIFY_RELEASE_GRAPH_SCHEMA_VERSION,
    target: TARGET,
    approvedInputFingerprint: inputFingerprint,
    graphFingerprint,
    stages: Object.freeze(stages),
  });
}
