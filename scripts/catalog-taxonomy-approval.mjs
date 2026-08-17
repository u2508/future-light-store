#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { CATALOG_TAXONOMY_VERSION } from "../src/lib/catalog-taxonomy.js";

const rootDir = resolve(import.meta.dirname, "..");
const approvalPath = resolve(rootDir, "docs", "catalog-taxonomy-approval.json");

function approvalError(message) {
  throw new Error(
    `${message}\n` +
      "Shopify writes are blocked until the catalog taxonomy proposal is approved and recorded in docs/catalog-taxonomy-approval.json.",
  );
}

async function readApproval() {
  try {
    return JSON.parse(await readFile(approvalPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      approvalError("No catalog taxonomy approval manifest exists.");
    }
    approvalError(`Could not read catalog taxonomy approval manifest: ${error.message}`);
  }
}

async function main() {
  const approval = await readApproval();
  const approvalId = String(approval?.approvalId || "").trim();

  if (approval?.approved !== true) approvalError("Catalog taxonomy approval manifest is not marked approved.");
  if (!approvalId) approvalError("Catalog taxonomy approval manifest has no approvalId.");
  if (approval?.taxonomyVersion !== CATALOG_TAXONOMY_VERSION) {
    approvalError(
      `Approval targets taxonomy ${String(approval?.taxonomyVersion || "unknown")}, but the active taxonomy is ${CATALOG_TAXONOMY_VERSION}.`,
    );
  }
  if (approval?.scope?.existingShopifyTags !== "preserve-unmanaged-exactly") {
    approvalError("Approval does not require exact preservation of unmanaged Shopify tags.");
  }
  if (approval?.scope?.managedTags !== "exact replacement within checked-in salt managed namespaces") {
    approvalError("Approval does not limit exact tag replacement to checked-in salt namespaces.");
  }
  if (approval?.scope?.taxonomyClassification !== "deterministic checked-in taxonomy first; guarded local image evidence only for opaque products; auditable release-boundary guess only if the release would otherwise fail") {
    approvalError("Approval does not enforce deterministic-first guarded classification.");
  }
  if (approval?.scope?.seo !== "product-specific SEO and metafields required for every active Shopify product; generic, duplicate, or evidence-free content blocks release; prices preserved") {
    approvalError("Approval does not require product-specific SEO and metafields for every active product.");
  }
  if (approval?.scope?.salesChannel !== "publish every active product to every available sales channel only after all release tasks verify; never change draft or archived status") {
    approvalError("Approval does not enforce the final all-sales-channel publication phase.");
  }
  if (approval?.scope?.categoriesAndMetafields !== "classification and product-specific merchandising metafields plus controlled collection tags approved for every active Shopify product; no Shopify product category writes") {
    approvalError("Approval does not restrict category membership to controlled tags and classification metafields.");
  }
  if (approval?.scope?.zeroImageProducts !== "delete only after a fresh live Shopify image read confirms zero product images") {
    approvalError("Approval does not limit permanent deletion to products with zero freshly verified Shopify images.");
  }
  if (approval?.scope?.prices !== "preserve product and variant prices; collection price conditions may be repaired exactly") {
    approvalError("Approval does not preserve prices.");
  }
  if (approval?.scope?.newCollections !== "approved only for missing canonical collections in the checked-in governance registry" || approval?.scope?.collectionMergesOrArchives !== "not approved") {
    approvalError("Approval does not limit collection creation to checked-in canonical records or forbids merges and archives.");
  }
  if (process.env.SALT_CATALOG_TAXONOMY_APPROVED !== "1") {
    approvalError("Set SALT_CATALOG_TAXONOMY_APPROVED=1 only for the approved release run.");
  }
  if (process.env.SALT_CATALOG_TAXONOMY_APPROVAL_ID !== approvalId) {
    approvalError("SALT_CATALOG_TAXONOMY_APPROVAL_ID does not match the approved taxonomy manifest.");
  }

  process.stdout.write(
    `Catalog taxonomy approval verified: ${approvalId} (taxonomy ${CATALOG_TAXONOMY_VERSION}).\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
