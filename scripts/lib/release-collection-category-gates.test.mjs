import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const releaseSource = await readFile(new URL("../release.mjs", import.meta.url), "utf8");
const integritySource = await readFile(new URL("../shopify-catalog-integrity.mjs", import.meta.url), "utf8");
const categoryGateSource = await readFile(new URL("./category-metafield-release-gate.mjs", import.meta.url), "utf8");

test("release graph invokes exact collection-membership verification", () => {
  assert.ok(
    /label: "Verify exact collection membership and price rules",\s*command: npmBin,\s*args: \["run", "shopify:catalog-integrity:verify", "--", \.\.\.verificationIntegrityArgs\]/s
      .test(releaseSource),
    "the release step must execute the catalog-integrity readback command",
  );
  assert.match(integritySource, /const membershipIssue = collectionProductsCountIssue\(/);
  assert.match(integritySource, /productsCount \{ count precision \}/);
  assert.match(integritySource, /allowEmptyReviewed: policy\?\.allowEmptyReviewed === true/);
  assert.match(integritySource, /async function verifyCollectionMembership\(\{[^}]*collections/s);
  assert.match(integritySource, /collectionPublicationReadbackIssue\(collection\)/);
  assert.match(integritySource, /pageInfo \{ hasNextPage \}/);
});

test("release graph checks fresh category-metafield readback before advancing", async () => {
  const applyLabel = 'label: "Apply all-active-catalog product categories and merchandising metafields"';
  const readbackLabel = 'label: "Verify exact category-metafield completeness readback"';
  const refreshLabel = 'label: "Refresh Shopify data after merchandising backfill"';
  const applyIndex = releaseSource.indexOf(applyLabel);
  const readbackIndex = releaseSource.indexOf(readbackLabel);
  const refreshIndex = releaseSource.indexOf(refreshLabel, readbackIndex);

  assert.ok(applyIndex >= 0 && readbackIndex > applyIndex && refreshIndex > readbackIndex);
  assert.match(
    releaseSource.slice(readbackIndex, refreshIndex),
    /args: \["run", "shopify:category-metafield:readback:verify"\]/,
  );

  const backfillSource = await readFile(new URL("../shopify-product-metafield-backfill.mjs", import.meta.url), "utf8");
  assert.match(backfillSource, /validateCategoryMetafieldReadback\(/);
  assert.match(categoryGateSource, /managedMetafieldNamespaces: \["shopify"\]/);
  assert.match(backfillSource, /await fetchLiveProductCustomDataMap\(categoryProductsForReadback\)/);
});
