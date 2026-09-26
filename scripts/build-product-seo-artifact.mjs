#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildProductSeoRecord } from "./lib/future-light-product-seo.mjs";
import { readFreshLiveCatalogSnapshot } from "./lib/live-catalog-assertion.mjs";
import { assertSeoManifestSourceFreshness } from "./lib/seo-source-freshness.mjs";
import { auditProductSeoDuplicateGroups } from "./lib/product-seo-artifact-audit.mjs";
import {
  auditVerifiedProductSeoCopy,
  resolveVerifiedProductSeoCopy,
} from "./lib/verified-product-seo-copy.mjs";

const rootDir = process.cwd();
const dataDir = resolve(rootDir, "public", "data");
const knowledgePath = resolve(rootDir, "output", "future-light-seo-gpt-200", "manifest.json");
const releaseManifestPath = resolve(rootDir, "output", "shopify-seo-release-manifest.json");
const outputPath = resolve(dataDir, "product-seo.json");
const overridesPath = resolve(rootDir, "config", "future-light-seo-overrides.json");

async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function loadCatalog() {
  const { products } = await readFreshLiveCatalogSnapshot(dataDir, {
    context: "product SEO artifact catalog",
  });
  return { manifest: products, products: products.products || [] };
}

function auditVerifiedManifestRecords(records, { introducedHandles = null } = {}) {
  const issues = records.flatMap((record) => {
    const recordIssues = [];
    if (record.classification?.reviewRequired) {
      recordIssues.push(`${record.handle}:shopify-category-listing-conflict`);
    }
    if (!record.title || !record.seoTitle || !record.seoDescription || !record.descriptionHtml) {
      recordIssues.push(`${record.handle}:missing-final-copy`);
    }
    const copyIssues = auditVerifiedProductSeoCopy(
      { handle: record.handle, title: record.sourceTitle },
      {
        title: record.title,
        seoTitle: record.seoTitle,
        seoDescription: record.seoDescription,
        descriptionHtml: record.descriptionHtml,
      },
    );
    recordIssues.push(...copyIssues.map((issue) => `${record.handle}:${issue}`));
    return recordIssues;
  });
  return {
    total: records.length,
    // Existing products may contain historical duplicate copy. Reject any
    // collision involving the release cohort, including one new record that
    // duplicates one existing record, without rewriting unrelated legacy copy.
    ...auditProductSeoDuplicateGroups(records, { introducedHandles }),
    issues,
  };
}

function numericProductId(product) {
  const value = product?.legacyResourceId ?? product?.id ?? product?.productId ?? "";
  return String(value).match(/\d+$/)?.[0] || String(value);
}

function manifestItemForProduct(product, byHandle, byProductId) {
  return byHandle.get(product?.handle) || byProductId.get(numericProductId(product));
}

async function main() {
  const [{ manifest: catalogManifest, products }, seoManifest, overrides, releaseManifest] = await Promise.all([
    loadCatalog(),
    readJson(knowledgePath, null),
    readJson(overridesPath, { products: {} }),
    readJson(releaseManifestPath, null),
  ]);
  const eligibleProducts = products.filter((product) => product?.handle && product?.title);
  if (!seoManifest || !Array.isArray(seoManifest.items)) {
    throw new Error("Verified Future Light GPT SEO manifest is missing; refusing to rebuild generic storefront SEO");
  }
  const verifiedReleaseHandles = new Set(
    releaseManifest?.summary?.failed === 0 && Array.isArray(releaseManifest?.products)
      ? releaseManifest.products
        .filter((item) => item?.handle && !item.failures?.length)
        .map((item) => item.handle)
      : [],
  );
  // A successful Shopify readback proves what is live, not that its copy was
  // reviewed. Require a quality-passing SEO manifest record for every product
  // and bind it to the current exact product identity/source title.
  assertSeoManifestSourceFreshness(eligibleProducts, seoManifest.items);
  const priorByHandle = new Map(seoManifest.items.map((item) => [item.handle, item]));
  const priorByProductId = new Map(seoManifest.items.map((item) => [numericProductId(item), item]));
  const manifestRecords = eligibleProducts.map((product) => ({
    product,
    item: manifestItemForProduct(product, priorByHandle, priorByProductId),
  }));
  const incomplete = manifestRecords.filter(
    ({ product }) => {
      // Handles can preserve Unicode/punctuation differently between the
      // Shopify API export and the local catalog shard. The product ID is the
      // stable identity, so use the same ID fallback as the record builder
      // before declaring a verified live copy missing.
      const item = manifestItemForProduct(product, priorByHandle, priorByProductId);
      return item?.status !== "verified" || item?.quality?.ok !== true || !item?.desired?.title || !item?.desired?.seoDescription || !item?.desired?.descriptionHtml;
    },
  );
  if (incomplete.length) {
    throw new Error(
      `Verified Future Light GPT SEO manifest is incomplete for ${incomplete.length} product(s); first: ${incomplete
        .slice(0, 8)
        .map(({ product }) => product.handle)
        .join(" | ")}`,
    );
  }
  const records = manifestRecords.map(({ product, item }) => {
    // Keep the catalog-derived evidence/classification envelope used by the
    // storefront, but take the final copy verbatim from the live-verified GPT
    // manifest. This prevents the artifact builder from silently replacing
    // approved product-specific copy with its older generic fallback.
    const record = buildProductSeoRecord(product, item);
    const override = overrides?.products?.[product.handle];
    const finalCopy = resolveVerifiedProductSeoCopy(item, override);
    record.title = finalCopy.title;
    record.seoTitle = finalCopy.seoTitle;
    record.seoDescription = finalCopy.seoDescription;
    record.descriptionHtml = finalCopy.descriptionHtml;
    record.evidence = {
      ...record.evidence,
      source: "verified-future-light-gpt-seo-manifest",
      seoSourcePreimageFingerprint: item.sourceFingerprint,
    };
    return record;
  });
  const audit = auditVerifiedManifestRecords(records, { introducedHandles: verifiedReleaseHandles });
  if (audit.issues.length || audit.duplicateTitles || audit.duplicateDescriptions || audit.duplicateDescriptionHtml) {
    throw new Error(
      `Product SEO artifact failed quality audit (${audit.issues.length} issue(s), ${audit.duplicateTitles} duplicate title group(s), ${audit.duplicateDescriptions} duplicate SEO description group(s), ${audit.duplicateDescriptionHtml} duplicate HTML description group(s)); first: ${audit.issues.slice(0, 8).join(" | ")}`,
    );
  }
  const payload = {
    schemaVersion: "2026-09-15.future-light-product-seo.1",
    generatedAt: new Date().toISOString(),
    source: {
      catalog: catalogManifest?.source || "/data/products.json",
      catalogGeneratedAt: catalogManifest?.generatedAt || "",
      priorSeoManifestGeneratedAt: seoManifest?.generatedAt || "",
      method: "verified-future-light-gpt-seo-manifest",
    },
    total: records.length,
    audit: {
      total: audit.total,
      duplicateTitles: audit.duplicateTitles,
      duplicateDescriptions: audit.duplicateDescriptions,
      duplicateDescriptionHtml: audit.duplicateDescriptionHtml,
      issueCount: audit.issues.length,
    },
    products: records,
  };
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(
    `Saved product-specific SEO JSON for ${records.length} products (${audit.duplicateTitles} duplicate title groups, ${audit.duplicateDescriptions} duplicate description groups).\n`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
