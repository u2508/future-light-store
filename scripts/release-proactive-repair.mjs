#!/usr/bin/env node

// Diagnostic-only release safety checks. This file never mutates Shopify or
// another repository; it produces durable evidence so a retry can start from
// the correct release checkpoint without hiding the original stage failure.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { SEMANTIC_COLLECTION_POLICIES } from "../src/lib/catalog-collection-governance.js";
import { readProductCatalogPayload } from "./product-catalog-files-local.mjs";
import { validateCollectionRepairRules } from "./validate-collection-repair-rules.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const outputDir = resolve(rootDir, "output");
const planPath = resolve(outputDir, "release-proactive-repair-plan.json");
const reportPath = resolve(outputDir, "release-proactive-repair-report.json");
process.env.FUTURE_LIGHT_STORE ||= "1";

const VALID_CLASSIFICATION_SOURCES = new Set([
  "taxonomy",
  "approved-override",
  "vision",
  "existing-vision",
  "evidence-fallback",
  "review",
]);
const ALLOWED_REVIEW_COLLECTIONS = new Set(["classification-review"]);
const ALLOWED_FALLBACK_CURATED_COLLECTIONS = new Set(
  SEMANTIC_COLLECTION_POLICIES.flatMap((policy) => [policy.handle, ...(policy.legacyHandles || [])]),
);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function fingerprintProducts(products) {
  return createHash("sha256")
    .update(products
      .map((product) => `${product?.id || ""}|${product?.handle || ""}|${product?.updated_at || product?.updatedAt || ""}`)
      .sort()
      .join("\n"))
    .digest("hex");
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function validateCatalog(products) {
  const duplicateIds = duplicateValues(products.map((product) => normalize(product?.id)));
  const duplicateHandles = duplicateValues(products.map((product) => normalize(product?.handle)));
  const missingIdentity = products
    .filter((product) => !normalize(product?.id) || !normalize(product?.handle) || !normalize(product?.title))
    .map((product) => ({ id: product?.id || "", handle: product?.handle || "", title: product?.title || "" }));
  return {
    products: products.length,
    duplicateIds,
    duplicateHandles,
    missingIdentity,
    fingerprint: fingerprintProducts(products),
  };
}

function validateVisualDecisions(classifications) {
  const invalid = [];
  const fallback = [];
  for (const entry of classifications) {
    const source = normalize(entry?.source);
    const handle = normalize(entry?.handle) || normalize(entry?.productId);
    if (!VALID_CLASSIFICATION_SOURCES.has(source)) {
      invalid.push({ handle, reason: "missing-or-unsupported-classification-source", source });
      continue;
    }
    if (source !== "review" && source !== "evidence-fallback") continue;

    fallback.push(handle);
    const collectionHandles = unique(asArray(entry?.collectionHandles).map(normalize));
    const hasEvidence = Boolean(entry?.visualEvidence || entry?.visionError || entry?.reason || entry?.evidenceFallback);
    const allowedCollections = new Set([...ALLOWED_REVIEW_COLLECTIONS, ...ALLOWED_FALLBACK_CURATED_COLLECTIONS]);
    const unsupportedCollections = collectionHandles.filter((value) => !allowedCollections.has(value));
    const validReviewCollection = source === "review" && collectionHandles.length === 1 && collectionHandles.every((value) => ALLOWED_REVIEW_COLLECTIONS.has(value));
    if (source === "review" && !validReviewCollection) {
      invalid.push({ handle, reason: "review-has-unsupported-collection-assignment", collectionHandles, unsupportedCollections });
    }
    if (source === "evidence-fallback" && unsupportedCollections.length) {
      invalid.push({ handle, reason: "fallback-has-unsupported-collection-assignment", collectionHandles, unsupportedCollections });
    }
    if (!hasEvidence) invalid.push({ handle, reason: "fallback-missing-evidence-and-reason" });
  }
  return { invalid, fallbackCount: fallback.length };
}

function validateReviewManifest(reviewManifest, autoManifest) {
  const summary = reviewManifest?.summary || reviewManifest?.final || {};
  const autoFinal = autoManifest?.final || {};
  const autoReconciled = autoManifest?.status === "completed"
    && Number(autoFinal.liveClassificationReviewRemaining || 0) === 0
    && Number(autoFinal.localNoImageBlockers || 0) === 0
    && Number(autoFinal.localPending || 0) === 0
    && Number(autoManifest.staleLocalPendingReconciled || 0) >= Number(summary.pending || 0);
  const pending = autoReconciled ? Number(autoFinal.localPending || 0) : Number(summary.pending || 0);
  const noImageBlockers = autoReconciled
    ? Number(autoFinal.localNoImageBlockers || 0)
    : Number(summary.blockedNoImage || summary.localNoImageBlockers || 0);
  const invalid = [];
  if (pending !== 0) invalid.push({ reason: "visual-review-pending", pending });
  if (noImageBlockers > 0) {
    invalid.push({ reason: "visual-review-no-image-blockers", count: noImageBlockers });
  }
  return invalid;
}

async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeReport(path, report) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function runPreflight() {
  const products = asArray(await readProductCatalogPayload(resolve(rootDir, "public", "data")));
  const checks = validateCatalog(products);
  const plan = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: "preflight",
    policy: "Future Light Store catalog identity and collection repair checks are deterministic; no semantic classification is guessed.",
    checks,
    repairs: [],
    blocked: [
      ...checks.duplicateIds.map((value) => ({ reason: "duplicate-product-id", value })),
      ...checks.duplicateHandles.map((value) => ({ reason: "duplicate-product-handle", value })),
      ...checks.missingIdentity.map((value) => ({ reason: "missing-product-identity", ...value })),
    ],
  };
  await writeReport(planPath, plan);
  if (plan.blocked.length) throw new Error(`Release preflight blocked by ${plan.blocked.length} catalog identity issue(s). See ${planPath}`);
  process.stdout.write(`Release preflight passed: ${checks.products} products, unique IDs/handles, repair plan written.\n`);
}

async function runCollectionRepairAudit() {
  const checks = validateCollectionRepairRules();
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: "standby-collection-repair-rule-audit",
    ...checks,
  };
  await writeReport(resolve(outputDir, "release-collection-repair-standby.json"), report);
  process.stdout.write(`Standby collection repair audit passed: ${checks.cases.length} regression cases.\n`);
}

async function runVisualAudit() {
  const integrity = await readJson(resolve(outputDir, "shopify-catalog-integrity-manifest.json"));
  if (!integrity) throw new Error("Visual audit requires output/shopify-catalog-integrity-manifest.json");
  const classifications = asArray(integrity.classifications);
  if (!classifications.length) throw new Error("Visual audit found no catalog classifications.");
  const reviewManifest = await readJson(resolve(outputDir, "catalog-image-review", "review-manifest.json"));
  const autoManifest = await readJson(resolve(outputDir, "catalog-visual-review-auto-manifest.json"));
  const visual = validateVisualDecisions(classifications);
  const invalid = [
    ...visual.invalid,
    ...validateReviewManifest(reviewManifest, autoManifest),
    ...(autoManifest?.status === "blocked" ? [{ reason: "automatic-visual-review-blocked" }] : []),
    ...(Number(integrity?.summary?.classificationReviewRemaining || 0) > 0
      ? [{ reason: "live-classification-review-pending", pending: Number(integrity.summary.classificationReviewRemaining) }]
      : []),
  ];
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: "visual",
    classifications: classifications.length,
    fallbackCount: visual.fallbackCount,
    pending: autoManifest?.status === "completed"
      ? Number(autoManifest?.final?.localPending || 0)
      : Number(reviewManifest?.summary?.pending || 0),
    invalid,
    policy: "Visual evidence may produce a semantic decision only through the supervised taxonomy gate; unresolved evidence remains in classification-review and never becomes a guess.",
  };
  await writeReport(reportPath, report);
  if (invalid.length) throw new Error(`Visual decision audit blocked by ${invalid.length} issue(s). See ${reportPath}`);
  process.stdout.write(`Visual decision audit passed: ${classifications.length} classifications, ${visual.fallbackCount} guarded fallbacks, pending=0.\n`);
}

async function runSeoAudit() {
  const manifest = await readJson(resolve(outputDir, "shopify-seo-release-manifest.json"));
  if (!manifest) throw new Error("SEO audit requires output/shopify-seo-release-manifest.json");
  const invalid = [];
  for (const conflict of asArray(manifest?.seoContradictionAudit?.conflicts)) invalid.push(conflict);
  if (Number(manifest?.qualityAudit?.failed || 0) > 0) {
    invalid.push({ reason: "seo-quality-audit-failures", count: Number(manifest.qualityAudit.failed) });
  }
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: "seo",
    products: asArray(manifest.products).length,
    invalid,
    qualityAudit: manifest.qualityAudit || null,
  };
  await writeReport(reportPath, report);
  if (invalid.length) throw new Error(`SEO contradiction audit blocked by ${invalid.length} issue(s). See ${reportPath}`);
  process.stdout.write(`SEO contradiction audit passed: ${report.products} planned products, zero recorded conflicts.\n`);
}

async function runPostflight() {
  const integrity = await readJson(resolve(outputDir, "shopify-catalog-integrity-final-report.json")) ||
    await readJson(resolve(outputDir, "shopify-catalog-integrity-manifest.json"));
  const shuffle = await readJson(resolve(outputDir, "shopify-collection-shuffle-manifest.json"));
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: "postflight",
    activeProducts: Number(integrity?.summary?.activeProducts || integrity?.products || 0),
    collectionlessProducts: Number(integrity?.summary?.collectionlessProducts || 0),
    shuffleCollections: Number(shuffle?.appliedCollections?.length || 0),
    shuffleFailures: asArray(shuffle?.failures),
    completedAt: shuffle?.completedAt || null,
    repairs: [],
  };
  const blocked = [];
  if (!report.activeProducts) blocked.push({ reason: "missing-final-integrity-product-count" });
  if (report.collectionlessProducts) blocked.push({ reason: "collectionless-products", count: report.collectionlessProducts });
  if (report.shuffleFailures.length) blocked.push({ reason: "shuffle-failures", count: report.shuffleFailures.length });
  if (!report.completedAt) blocked.push({ reason: "shuffle-not-complete" });
  report.blocked = blocked;
  await writeReport(reportPath, report);
  if (blocked.length) throw new Error(`Release postflight blocked by ${blocked.length} issue(s). See ${reportPath}`);
  process.stdout.write(`Release postflight passed: ${report.activeProducts} active products, ${report.shuffleCollections} shuffled collections.\n`);
}

export { duplicateValues, validateCatalog, validateVisualDecisions };

async function main() {
  const mode = process.argv.includes("--visual")
    ? "visual"
    : process.argv.includes("--seo")
      ? "seo"
      : process.argv.includes("--postflight")
        ? "postflight"
        : process.argv.includes("--collection")
          ? "collection"
          : "preflight";
  const runner = mode === "visual" ? runVisualAudit
    : mode === "seo" ? runSeoAudit
      : mode === "postflight" ? runPostflight
        : mode === "collection" ? runCollectionRepairAudit
          : runPreflight;
  await runner();
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message || error}\n`);
    process.exitCode = 1;
  });
}
