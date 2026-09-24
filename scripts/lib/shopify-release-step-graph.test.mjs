import test from "node:test";
import assert from "node:assert/strict";

import {
  SHOPIFY_MUTATING_STAGE_IDS,
  SHOPIFY_RELEASE_STAGE_IDS,
  buildShopifyReleaseStepGraph,
} from "./shopify-release-step-graph.mjs";

const INPUT_FINGERPRINT = "a".repeat(64);
const STAGE = Object.freeze({
  target: "shopify",
  productContent: "shopify.apply.approved-product-content",
  nativeCategory: "shopify.apply.approved-native-category",
  categoryMetafields: "shopify.apply.approved-category-metafields",
  productMetafields: "shopify.apply.approved-product-metafields",
  variantOptions: "shopify.apply.approved-shopper-readable-variant-options",
  imageReplacements: "shopify.apply.approved-safe-product-image-replacements",
  variantImageMapping: "shopify.apply.approved-variant-image-mapping",
  exactReadback: "shopify.verify.approved-product-exact-readback",
});

test("builds the fixed manifest-bounded Shopify catalog graph", () => {
  const graph = buildShopifyReleaseStepGraph({
    approvedInputFingerprint: INPUT_FINGERPRINT,
  });
  const mutationStages = graph.stages.filter(({ kind }) => kind === "shopify-mutation");

  assert.deepEqual(
    graph.stages.map(({ id }) => id),
    [
      "shopify.preflight.target",
      "shopify.read.approved-product-snapshot",
      ...SHOPIFY_MUTATING_STAGE_IDS,
      STAGE.exactReadback,
    ],
  );
  assert.ok(graph.stages.every(({ target }) => target === "shopify"));
  assert.ok(graph.stages.every(({ id }) => SHOPIFY_RELEASE_STAGE_IDS.includes(id)));
  assert.ok(
    mutationStages.every(
      ({ scope, constraints }) =>
        scope === "approved-product-manifest" &&
        constraints.includes("approved-product-manifest-only") &&
        constraints.includes("approved-values-only"),
    ),
  );

  const expectedMutations = new Map([
    [
      STAGE.productContent,
      ["product.title", "product.descriptionHtml", "product.seo.title", "product.seo.description"],
    ],
    [STAGE.nativeCategory, ["product.category"]],
    [STAGE.categoryMetafields, ["product.categoryMetafields.approvedKeys"]],
    [STAGE.productMetafields, ["product.metafields.approvedKeys"]],
    [
      STAGE.variantOptions,
      ["product.options.shopperReadableNames", "variant.optionValues.shopperReadable"],
    ],
    [STAGE.imageReplacements, ["product.media.approvedReplacementPairs", "product.media.altText"]],
    [STAGE.variantImageMapping, ["variant.imageId.approvedMapping"]],
  ]);
  assert.deepEqual(
    new Map(mutationStages.map(({ id, mutates }) => [id, mutates])),
    expectedMutations,
  );

  assert.deepEqual(graph.stages.find(({ id }) => id === STAGE.categoryMetafields).dependsOn, [
    STAGE.nativeCategory,
  ]);
  assert.deepEqual(graph.stages.find(({ id }) => id === STAGE.variantImageMapping).dependsOn, [
    STAGE.variantOptions,
    STAGE.imageReplacements,
  ]);

  const exactReadback = graph.stages.at(-1);
  assert.equal(exactReadback.id, STAGE.exactReadback);
  assert.deepEqual(exactReadback.dependsOn, SHOPIFY_MUTATING_STAGE_IDS);
  assert.deepEqual(
    exactReadback.verifies,
    mutationStages.flatMap(({ mutates }) => mutates),
  );
  assert.doesNotMatch(
    JSON.stringify(graph),
    /delete|reprice|publish|collection|theme|web|google|merchant|salt/i,
  );
});

test("every fresh graph starts with Shopify target verification and protects approved copy", () => {
  const graph = buildShopifyReleaseStepGraph({
    approvedInputFingerprint: INPUT_FINGERPRINT,
  });
  const contentStage = graph.stages.find(({ id }) => id === STAGE.productContent);

  assert.equal(graph.stages[0].id, "shopify.preflight.target");
  assert.equal(graph.stages[0].operation, "verify-target");
  assert.equal(graph.stages[1].id, "shopify.read.approved-product-snapshot");
  assert.deepEqual(graph.stages[1].dependsOn, ["shopify.preflight.target"]);
  assert.ok(contentStage.constraints.includes("preserve-approved-keep-byte-for-byte"));
  assert.ok(contentStage.constraints.includes("rewrite-needs-rewrite-only"));
  assert.ok(contentStage.constraints.includes("independent-claim-ledger-required"));
  assert.ok(contentStage.constraints.includes("reject-generic-or-self-evidenced-copy"));
  assert.deepEqual(contentStage.dependsOn, ["shopify.read.approved-product-snapshot"]);
});

test("resume fingerprints are stable across calls and selection ordering", () => {
  const first = buildShopifyReleaseStepGraph({
    approvedInputFingerprint: INPUT_FINGERPRINT,
    requestedStages: [...SHOPIFY_MUTATING_STAGE_IDS],
  });
  const second = buildShopifyReleaseStepGraph({
    approvedInputFingerprint: INPUT_FINGERPRINT,
    requestedStages: [...SHOPIFY_MUTATING_STAGE_IDS].reverse(),
  });

  assert.equal(first.graphFingerprint, second.graphFingerprint);
  assert.deepEqual(
    first.stages.map(({ resumeFingerprint }) => resumeFingerprint),
    second.stages.map(({ resumeFingerprint }) => resumeFingerprint),
  );
});

test("resume fingerprints change when the approved input fingerprint changes", () => {
  const first = buildShopifyReleaseStepGraph({
    approvedInputFingerprint: INPUT_FINGERPRINT,
    requestedStages: [STAGE.productContent],
  });
  const second = buildShopifyReleaseStepGraph({
    approvedInputFingerprint: "b".repeat(64),
    requestedStages: [STAGE.productContent],
  });

  assert.notEqual(first.graphFingerprint, second.graphFingerprint);
  assert.notEqual(first.stages[0].resumeFingerprint, second.stages[0].resumeFingerprint);
});

test("supports a bounded selection and verifies exactly its selected fields", () => {
  const graph = buildShopifyReleaseStepGraph({
    approvedInputFingerprint: INPUT_FINGERPRINT,
    requestedStages: [STAGE.nativeCategory, STAGE.categoryMetafields],
  });

  assert.deepEqual(
    graph.stages.map(({ id }) => id),
    [
      "shopify.preflight.target",
      "shopify.read.approved-product-snapshot",
      STAGE.nativeCategory,
      STAGE.categoryMetafields,
      STAGE.exactReadback,
    ],
  );
  assert.deepEqual(graph.stages.at(-1).verifies, [
    "product.category",
    "product.categoryMetafields.approvedKeys",
  ]);
});

test("rejects unknown, non-mutable, and non-Shopify stages", () => {
  assert.throws(
    () =>
      buildShopifyReleaseStepGraph({
        approvedInputFingerprint: INPUT_FINGERPRINT,
        requestedStages: ["shopify.delete-products"],
      }),
    /Unknown or non-mutable Shopify release stage/,
  );
  assert.throws(
    () =>
      buildShopifyReleaseStepGraph({
        approvedInputFingerprint: INPUT_FINGERPRINT,
        requestedStages: ["shopify.preflight.target"],
      }),
    /Unknown or non-mutable Shopify release stage/,
  );
  assert.throws(
    () =>
      buildShopifyReleaseStepGraph({
        approvedInputFingerprint: INPUT_FINGERPRINT,
        requestedStages: [{ id: "google.feed.upload", target: "google" }],
      }),
    /Non-Shopify stage target is not allowed/,
  );
});

test("rejects selections missing mutating prerequisites", () => {
  assert.throws(
    () =>
      buildShopifyReleaseStepGraph({
        approvedInputFingerprint: INPUT_FINGERPRINT,
        requestedStages: [STAGE.categoryMetafields],
      }),
    /requires selected prerequisite stage/,
  );
  assert.throws(
    () =>
      buildShopifyReleaseStepGraph({
        approvedInputFingerprint: INPUT_FINGERPRINT,
        requestedStages: [STAGE.variantImageMapping],
      }),
    /requires selected prerequisite stage/,
  );
});

test("rejects custom stage descriptors and malformed input fingerprints", () => {
  assert.throws(
    () =>
      buildShopifyReleaseStepGraph({
        approvedInputFingerprint: INPUT_FINGERPRINT,
        requestedStages: [
          { id: STAGE.productContent, target: "shopify", operation: "replace-product" },
        ],
      }),
    /must contain only data fields id and target/,
  );
  assert.throws(
    () => buildShopifyReleaseStepGraph({ approvedInputFingerprint: "not-a-digest" }),
    /lowercase SHA-256 hex digest/,
  );
});
