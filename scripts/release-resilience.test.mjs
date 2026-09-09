import test from "node:test";
import assert from "node:assert/strict";

import {
  buildReleaseSteps,
  getReleaseRepairRoute,
  isNetworkFailureText,
  isRemoteReleaseStage,
  shouldRepairKnowledgeModel,
} from "./release.mjs";

test("recognizes DNS and transient transport failures", () => {
  assert.equal(isNetworkFailureText("getaddrinfo EAI_AGAIN Shopify host"), true);
  assert.equal(isNetworkFailureText("Admin GraphQL HTTP 503: service unavailable"), true);
  assert.equal(isNetworkFailureText("curl: could not resolve host"), true);
  assert.equal(isNetworkFailureText("collectionUpdate userErrors: invalid sort order"), false);
});

test("only treats remote release stages as probe-eligible", () => {
  assert.equal(isRemoteReleaseStage("npm", ["run", "sync:data"]), true);
  assert.equal(isRemoteReleaseStage("shopify", ["store", "execute"]), true);
  assert.equal(isRemoteReleaseStage("npm", ["run", "build:web:release"]), false);
});

test("repairs only an exact catalog knowledge-model fingerprint drift", () => {
  assert.equal(
    shouldRepairKnowledgeModel(
      "Verify trained 256M-record catalog knowledge model",
      "Catalog knowledge model training fingerprint does not match the checked-in taxonomy.",
    ),
    true,
  );
  assert.equal(
    shouldRepairKnowledgeModel(
      "Verify trained 256M-record catalog knowledge model",
      "Catalog knowledge model validation contains unresolved representatives.",
    ),
    false,
  );
  assert.equal(shouldRepairKnowledgeModel("Verify approved catalog taxonomy release", "fingerprint drift"), false);
});

test("catalog release audits and verifies low-stock removal before other catalog stages", () => {
  const steps = buildReleaseSteps({ rootDir: "/tmp/future-light-store-test", includeMobile: false, profile: "daily" });
  const labels = steps.map((step) => step.label);
  const refreshIndex = labels.indexOf("Refresh Shopify data");
  assert.deepEqual(labels.slice(refreshIndex + 1, refreshIndex + 4), [
    "Dry-run active low-stock product removal",
    "Apply approved active low-stock product removal with live readback",
    "Verify active low-stock product removal",
  ]);
});

test("catalog release removes missing-cost products before pricing", () => {
  const steps = buildReleaseSteps({ rootDir: "/tmp/future-light-store-test", includeMobile: false, profile: "daily" });
  const labels = steps.map((step) => step.label);
  const missingCostIndex = labels.indexOf("Dry-run products with missing live Shopify variant costs");
  const pricingIndex = labels.indexOf("Dry-run approved cost-based pricing before base SEO");
  assert.deepEqual(labels.slice(missingCostIndex, missingCostIndex + 3), [
    "Dry-run products with missing live Shopify variant costs",
    "Apply approved missing-cost product removal with live readback",
    "Verify missing-cost product removal",
  ]);
  assert.equal(missingCostIndex >= 0 && missingCostIndex < pricingIndex, true);
});

test("known guarded failures route to their supported repair ranges", () => {
  const previousVisionSetting = process.env.SALT_CATALOG_VISION_SUPERVISED;
  process.env.SALT_CATALOG_VISION_SUPERVISED = "1";
  const steps = buildReleaseSteps({ rootDir: "/tmp/future-light-store-test", includeMobile: false, profile: "daily" });
  if (previousVisionSetting === undefined) delete process.env.SALT_CATALOG_VISION_SUPERVISED;
  else process.env.SALT_CATALOG_VISION_SUPERVISED = previousVisionSetting;
  const labels = steps.map((step) => step.label);
  const cases = [
    ["Verify every active product has product-specific SEO and metafields", "insufficient-product-evidence", "Run local SEO and product-content quality audit"],
    ["Apply all-active-catalog product categories and merchandising metafields", "metafield export failed", "Refresh Shopify data after final product publication"],
    ["Verify Shopify merchandising backfill", "Collection all-products mismatch", "Apply all-active-catalog product categories and merchandising metafields"],
    ["Automatically clear visual classification review with guarded evidence", "visual classification review failed", "Build visual taxonomy review queue"],
    ["Apply resumable variant-image mapping with live readback", "variant image readback mismatch", "Dry-run deterministic and visual variant-image mapping"],
    ["Verify live full-catalog cost-based pricing before base SEO", "missing live unitCost", "Dry-run products with missing live Shopify variant costs"],
    ["Verify exact collection membership and price rules", "collection membership mismatch", "Dry-run exact full-catalog collection reconciliation"],
    ["Validate final catalog taxonomy snapshot", "taxonomy snapshot stale", "Read live Shopify tag inventory"],
    ["Verify daily manual collection shuffle", "shuffle order readback mismatch", "Dry-run daily manual collection shuffle"],
    ["Final live-readback gate after tag cleanup and collection merges", "final collection readback mismatch", "Dry-run exact full-catalog collection reconciliation"],
  ];

  for (const [failedLabel, error, startLabel] of cases) {
    const failedStep = labels.indexOf(failedLabel) + 1;
    const route = getReleaseRepairRoute(
      steps,
      { status: "failed", stepIndex: failedStep, stepLabel: failedLabel, error },
      failedStep,
    );
    assert.ok(route, `expected a repair route for ${failedLabel}`);
    assert.equal(route.failedStep, failedStep);
    assert.equal(route.fromStep, labels.indexOf(startLabel) + 1);
    assert.equal(route.fromStep < route.failedStep, true);
  }
});
