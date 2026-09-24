import assert from "node:assert/strict";
import test from "node:test";

import {
  chinaWatermarkRejectedFixture,
  fullyApprovedCoverageFixture,
} from "./product-media-variant-image-coverage.fixtures.mjs";
import { validateProductMediaVariantImageCoverage } from "./product-media-variant-image-coverage.mjs";

function findingCodes(report) {
  return report.findings.map((finding) => finding.code);
}

test("preserves explicit approval for existing-good media and associations", () => {
  const report = validateProductMediaVariantImageCoverage(fullyApprovedCoverageFixture());

  assert.equal(report.complete, true);
  assert.equal(report.ready, true);
  assert.deepEqual(
    report.mediaDecisions.map((item) => item.status),
    ["approved", "approved"],
  );
  assert.deepEqual(
    report.variantAssociationDecisions.map((item) => item.status),
    ["approved", "approved"],
  );
  assert.deepEqual(report.findings, []);
});

test("requires a decision for every media image and every variant image association", () => {
  const fixture = fullyApprovedCoverageFixture();
  fixture.mediaDecisions.pop();
  fixture.variantAssociationDecisions.pop();

  const report = validateProductMediaVariantImageCoverage(fixture);

  assert.equal(report.complete, false);
  assert.equal(report.ready, false);
  assert.ok(findingCodes(report).includes("omitted-media-decision"));
  assert.ok(findingCodes(report).includes("omitted-variant-association-decision"));
});

test("requires separate decisions for every image linked to the same variant", () => {
  const fixture = fullyApprovedCoverageFixture();
  fixture.products[0].variants.nodes[0].media.nodes.push({
    __typename: "MediaImage",
    id: "gid://shopify/MediaImage/202",
  });
  fixture.variantAssociationDecisions.push({
    productId: "gid://shopify/Product/101",
    handle: "canvas-travel-bag",
    variantId: "gid://shopify/ProductVariant/301",
    mediaId: "gid://shopify/MediaImage/202",
    decision: "approved-existing-association",
  });

  const completeReport = validateProductMediaVariantImageCoverage(fixture);
  assert.equal(completeReport.complete, true);
  assert.equal(completeReport.summary.variantImageAssociations, 3);

  fixture.variantAssociationDecisions.pop();
  const incompleteReport = validateProductMediaVariantImageCoverage(fixture);
  assert.ok(findingCodes(incompleteReport).includes("omitted-variant-association-decision"));
  assert.ok(
    incompleteReport.findings.some(
      (finding) =>
        finding.code === "omitted-variant-association-decision" &&
        finding.variantId === "gid://shopify/ProductVariant/301" &&
        finding.mediaId === "gid://shopify/MediaImage/202",
    ),
  );
});

test("detects duplicate decisions for a media image and a variant association", () => {
  const fixture = fullyApprovedCoverageFixture();
  fixture.mediaDecisions.push({ ...fixture.mediaDecisions[0] });
  fixture.variantAssociationDecisions.push({ ...fixture.variantAssociationDecisions[0] });

  const report = validateProductMediaVariantImageCoverage(fixture);

  assert.ok(findingCodes(report).includes("duplicate-media-decision"));
  assert.ok(findingCodes(report).includes("duplicate-variant-association-decision"));
  assert.equal(report.mediaDecisions[0].status, "duplicate");
  assert.equal(report.variantAssociationDecisions[0].status, "duplicate");
});

test("detects stale media, variant, and former-association decisions", () => {
  const fixture = fullyApprovedCoverageFixture();
  fixture.mediaDecisions.push({
    productId: "gid://shopify/Product/101",
    mediaId: "gid://shopify/MediaImage/999",
    decision: "approved-existing-good",
  });
  fixture.variantAssociationDecisions.push({
    productId: "gid://shopify/Product/101",
    variantId: "gid://shopify/ProductVariant/999",
    mediaId: null,
    decision: "hold",
    reason: "Variant was removed from the current catalog snapshot.",
  });
  fixture.variantAssociationDecisions.push({
    productId: "gid://shopify/Product/101",
    variantId: "gid://shopify/ProductVariant/302",
    mediaId: "gid://shopify/MediaImage/201",
    decision: "approved-existing-association",
  });

  const report = validateProductMediaVariantImageCoverage(fixture);

  assert.ok(findingCodes(report).includes("stale-media-decision-target"));
  assert.ok(findingCodes(report).includes("stale-variant-decision-target"));
  assert.ok(findingCodes(report).includes("stale-variant-association-decision-target"));
});

test("holds ambiguous identity and association decisions without approving them", () => {
  const fixture = fullyApprovedCoverageFixture();
  fixture.mediaDecisions[0] = {
    ...fixture.mediaDecisions[0],
    decision: "hold",
    reasonCode: "visual-identity-ambiguous",
  };
  fixture.variantAssociationDecisions[0] = {
    ...fixture.variantAssociationDecisions[0],
    decision: "hold",
    reasonCode: "variant-identity-ambiguous",
  };

  const report = validateProductMediaVariantImageCoverage(fixture);

  assert.equal(report.complete, true);
  assert.equal(report.ready, false);
  assert.equal(report.mediaDecisions[0].status, "held");
  assert.equal(report.variantAssociationDecisions[0].status, "held");
});

test("rejects supplier/China watermark media while retaining an explicit decision record", () => {
  const report = validateProductMediaVariantImageCoverage(chinaWatermarkRejectedFixture());

  assert.equal(report.complete, true);
  assert.equal(report.ready, false);
  assert.equal(report.mediaDecisions[0].decision, "rejected");
  assert.equal(report.mediaDecisions[0].status, "rejected");
  assert.equal(report.mediaDecisions[0].reasonCode, "supplier-or-China-branding-watermark");
  assert.equal(report.summary.rejectedMediaImages, 1);
});

test("distinguishes an identity mismatch from a stale target", () => {
  const fixture = fullyApprovedCoverageFixture();
  fixture.mediaDecisions[0] = {
    ...fixture.mediaDecisions[0],
    productId: "gid://shopify/Product/other",
  };
  fixture.variantAssociationDecisions[0] = {
    ...fixture.variantAssociationDecisions[0],
    productId: "gid://shopify/Product/other",
  };

  const report = validateProductMediaVariantImageCoverage(fixture);

  assert.ok(findingCodes(report).includes("mismatched-media-product-identity"));
  assert.ok(findingCodes(report).includes("mismatched-variant-product-identity"));
});

test("marks a paginated snapshot incomplete", () => {
  const fixture = fullyApprovedCoverageFixture();
  fixture.products[0].media.pageInfo.hasNextPage = true;

  const report = validateProductMediaVariantImageCoverage(fixture);

  assert.equal(report.complete, false);
  assert.equal(report.ready, false);
  assert.ok(findingCodes(report).includes("incomplete-product-media-pagination"));
});
