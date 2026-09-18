#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildProductSeoRecord,
} from "./lib/future-light-product-seo.mjs";

const rootDir = process.cwd();
const dataDir = resolve(rootDir, "public", "data");
const manifestPath = resolve(dataDir, "products.json");
const knowledgePath = resolve(rootDir, "output", "future-light-seo-gpt-200", "manifest.json");
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
  const manifest = await readJson(manifestPath);
  if (!manifest?.shards?.length) throw new Error("Product catalog manifest has no shards");
  const products = [];
  for (const shard of manifest.shards) {
    const payload = await readJson(resolve(dataDir, shard.file));
    products.push(...(payload?.products || []));
  }
  return { manifest, products };
}

function duplicateGroupCount(records, field) {
  const counts = new Map();
  for (const record of records) {
    const value = String(record?.[field] || "").trim().toLowerCase();
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.values()].filter((count) => count > 1).length;
}

function duplicateHtmlGroupCount(records) {
  const counts = new Map();
  for (const record of records) {
    const value = String(record?.descriptionHtml || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&(?:amp|mdash|nbsp|quot|#39);/g, " ")
      .replace(/[^a-z0-9]+/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.values()].filter((count) => count > 1).length;
}

function auditVerifiedManifestRecords(records) {
  const issues = records.flatMap((record) => {
    const recordIssues = [];
    if (!record.title || !record.seoTitle || !record.seoDescription || !record.descriptionHtml) {
      recordIssues.push(`${record.handle}:missing-final-copy`);
    }
    return recordIssues;
  });
  return {
    total: records.length,
    duplicateTitles: duplicateGroupCount(records, "title"),
    duplicateDescriptions: duplicateGroupCount(records, "seoDescription"),
    duplicateDescriptionHtml: duplicateHtmlGroupCount(records),
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
  const [{ manifest: catalogManifest, products }, seoManifest, overrides] = await Promise.all([
    loadCatalog(),
    readJson(knowledgePath, null),
    readJson(overridesPath, { products: {} }),
  ]);
  const eligibleProducts = products.filter((product) => product?.handle && product?.title);
  const priorByHandle = new Map((seoManifest?.items || []).map((item) => [item.handle, item]));
  const priorByProductId = new Map(
    (seoManifest?.items || []).map((item) => [numericProductId(item), item]),
  );
  if (!seoManifest || !Array.isArray(seoManifest.items)) {
    throw new Error("Verified Future Light GPT SEO manifest is missing; refusing to rebuild generic storefront SEO");
  }
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
    record.title = item.desired.title;
    record.seoTitle = item.desired.seoTitle || item.desired.title;
    record.seoDescription = item.desired.seoDescription;
    record.descriptionHtml = item.desired.descriptionHtml;
    const override = overrides?.products?.[product.handle];
    if (override) {
      record.title = override.title;
      record.seoTitle = override.seoTitle || override.title;
      record.seoDescription = override.seoDescription;
      record.descriptionHtml = override.descriptionHtml;
    }
    record.evidence = {
      ...record.evidence,
      source: "verified-future-light-gpt-seo-manifest",
    };
    return record;
  });
  const audit = auditVerifiedManifestRecords(records);
  if (audit.issues.length || audit.duplicateTitles || audit.duplicateDescriptionHtml) {
    throw new Error(
      `Product SEO artifact failed quality audit (${audit.issues.length} issue(s), ${audit.duplicateDescriptionHtml} duplicate HTML description group(s)); first: ${audit.issues.slice(0, 8).join(" | ")}`,
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
