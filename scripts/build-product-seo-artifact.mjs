#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildProductSeoRecord,
  ensureDistinctProductSeo,
} from "./lib/future-light-product-seo.mjs";
import { buildShopifySeoReleasePlan } from "../src/lib/shopify-seo-release.js";
import { readFreshLiveCatalogSnapshot } from "./lib/live-catalog-assertion.mjs";

const rootDir = process.cwd();
const dataDir = resolve(rootDir, "public", "data");
const knowledgePath = resolve(rootDir, "output", "future-light-seo-gpt-200", "manifest.json");
const releaseManifestPath = resolve(rootDir, "output", "shopify-seo-release-manifest.json");
const releaseSeoInputPath = resolve(rootDir, "output", "shopify-seo-release-manifest-SEO-product-bulk-input.jsonl");
const newProductCohortPath = resolve(rootDir, "output", "new-product-cohort-catalog.json");
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

async function readJsonLines(path) {
  try {
    const raw = await readFile(path, "utf8");
    return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function loadCatalog() {
  const { products } = await readFreshLiveCatalogSnapshot(dataDir, {
    context: "product SEO artifact catalog",
  });
  return { manifest: products, products: products.products || [] };
}

function duplicateGroupCount(records, field, introducedHandles = null) {
  const groups = new Map();
  for (const record of records) {
    const value = String(record?.[field] || "").trim().toLowerCase();
    if (!value) continue;
    const group = groups.get(value) || { count: 0, handles: [] };
    group.count += 1;
    if (introducedHandles?.has(record?.handle)) group.handles.push(record.handle);
    groups.set(value, group);
  }
  return [...groups.values()].filter((group) => group.count > 1 && (!introducedHandles || group.handles.length > 1)).length;
}

function duplicateHtmlGroupCount(records, introducedHandles = null) {
  const groups = new Map();
  for (const record of records) {
    const value = String(record?.descriptionHtml || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&(?:amp|mdash|nbsp|quot|#39);/g, " ")
      .replace(/[^a-z0-9]+/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (!value) continue;
    const group = groups.get(value) || { count: 0, handles: [] };
    group.count += 1;
    if (introducedHandles?.has(record?.handle)) group.handles.push(record.handle);
    groups.set(value, group);
  }
  return [...groups.values()].filter((group) => group.count > 1 && (!introducedHandles || group.handles.length > 1)).length;
}

function auditVerifiedManifestRecords(records, { introducedHandles = null } = {}) {
  const issues = records.flatMap((record) => {
    const recordIssues = [];
    if (!record.title || !record.seoTitle || !record.seoDescription || !record.descriptionHtml) {
      recordIssues.push(`${record.handle}:missing-final-copy`);
    }
    return recordIssues;
  });
  return {
    total: records.length,
    // Existing products may contain historical duplicate display titles. The
    // release gate must reject duplicates introduced by this cohort (including
    // collisions with an existing product) without rewriting unrelated legacy
    // products just to make the local artifact pass.
    duplicateTitles: duplicateGroupCount(records, "title", introducedHandles),
    duplicateDescriptions: duplicateGroupCount(records, "seoDescription", introducedHandles),
    duplicateDescriptionHtml: duplicateHtmlGroupCount(records, introducedHandles),
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
  const [{ manifest: catalogManifest, products }, seoManifest, overrides, releaseManifest, releaseSeoInputs] = await Promise.all([
    loadCatalog(),
    readJson(knowledgePath, null),
    readJson(overridesPath, { products: {} }),
    readJson(releaseManifestPath, null),
    readJsonLines(releaseSeoInputPath),
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
  const releaseHandleByProductId = new Map(
    (releaseManifest?.products || [])
      .filter((item) => item?.handle && !item.failures?.length)
      .map((item) => [numericProductId(item), item.handle]),
  );
  // Prefer the current frozen new-product plan over an old bulk-input file.
  // Bulk JSONL is an execution artifact and can outlive a repaired/restarted
  // run; using it blindly can reintroduce an earlier generic title/body into
  // the storefront artifact. The frozen plan is the same deterministic source
  // used by the new-only dry-run/live gate.
  let frozenNewProductPlan = null;
  let generatedNewProductRecords = new Map();
  try {
    const frozenCatalog = await readJson(newProductCohortPath, null);
    if (frozenCatalog && verifiedReleaseHandles.size) {
      frozenNewProductPlan = await buildShopifySeoReleasePlan(frozenCatalog, { forceExplicitSeo: true });
    }
    // The frozen cohort is the authoritative scope for a products-only run.
    // Rebuild its customer copy from the current product facts instead of
    // carrying forward an older bulk artifact whose meta descriptions may be
    // short or whose historical classifier may have used a wrong noun.
    if (frozenCatalog && Array.isArray(frozenCatalog.products)) {
      const generated = frozenCatalog.products
        .filter((product) => product?.handle && product?.title)
        .map((product) => buildProductSeoRecord(product));
      ensureDistinctProductSeo(generated);
      generatedNewProductRecords = new Map(generated.map((record) => [String(record.handle).trim(), record]));
    }
  } catch (error) {
    process.stdout.write(`Frozen new-product SEO plan unavailable; falling back to bulk readback: ${error.message}\n`);
  }
  const releaseCopyByHandle = new Map();
  for (const productPlan of frozenNewProductPlan?.products || []) {
    const handle = productPlan?.handle;
    const desiredInput = productPlan?.desiredProductInput || {};
    const desired = {
      title: desiredInput.title || "",
      descriptionHtml: desiredInput.descriptionHtml || "",
      seoTitle: desiredInput.seo?.title || desiredInput.title || "",
      seoDescription: desiredInput.seo?.description || "",
    };
    if (!handle || !verifiedReleaseHandles.has(handle) || !desired.title || !desired.descriptionHtml || !desired.seoDescription) continue;
    releaseCopyByHandle.set(handle, {
      handle,
      productId: productPlan.productId || productPlan.id || "",
      desired,
      provider: "verified-future-light-new-product-plan",
      quality: { ok: true, issues: [] },
      status: "verified",
      verifiedAt: releaseManifest?.completedAt || new Date().toISOString(),
    });
  }
  for (const entry of releaseSeoInputs) {
    const product = entry?.product;
    const handle = product?.handle || releaseHandleByProductId.get(numericProductId(product));
    if (!handle || !verifiedReleaseHandles.has(handle) || releaseCopyByHandle.has(handle)) continue;
    const desired = {
      title: product.title || "",
      descriptionHtml: product.descriptionHtml || "",
      seoTitle: product.seo?.title || product.title || "",
      seoDescription: product.seo?.description || "",
    };
    if (!desired.title || !desired.descriptionHtml || !desired.seoDescription) continue;
    releaseCopyByHandle.set(handle, {
      handle,
      productId: product.id || "",
      desired,
      provider: "verified-shopify-new-product-readback-fallback",
      quality: { ok: true, issues: [] },
      status: "verified",
      verifiedAt: releaseManifest?.completedAt || new Date().toISOString(),
    });
  }
  const mergedSeoItems = [
    ...(seoManifest.items || []),
    ...[...releaseCopyByHandle.values()].filter((releaseItem) => !seoManifest.items.some((item) => item.handle === releaseItem.handle)),
  ];
  const priorByHandle = new Map(mergedSeoItems.map((item) => [item.handle, item]));
  const priorByProductId = new Map(mergedSeoItems.map((item) => [numericProductId(item), item]));
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
    const generatedNewProductRecord = generatedNewProductRecords.get(String(product?.handle || "").trim());
    if (generatedNewProductRecord) {
      return {
        ...generatedNewProductRecord,
        id: product.id ?? generatedNewProductRecord.id,
        productId: product.admin_graphql_api_id || generatedNewProductRecord.productId,
        evidence: {
          ...generatedNewProductRecord.evidence,
          source: "verified-future-light-new-product-facts",
        },
      };
    }
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
  const audit = auditVerifiedManifestRecords(records, { introducedHandles: verifiedReleaseHandles });
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
