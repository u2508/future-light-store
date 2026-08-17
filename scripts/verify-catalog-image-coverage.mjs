#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { classifyCatalogTaxonomyWithoutOverrides } from "../src/lib/catalog-taxonomy.js";
import { isImageReviewedCatalogTaxonomyOverride } from "../src/lib/catalog-taxonomy-image-overrides.js";
import { CATALOG_TAXONOMY_OVERRIDES, getCatalogTaxonomyOverride } from "../src/lib/catalog-taxonomy-overrides.js";
import { readProductCatalogPayload } from "./product-catalog-files.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const dataDir = resolve(rootDir, "public", "data");
const defaultOutputPath = resolve(rootDir, "output", "catalog-image-review-coverage.json");
const fallbackQueuePath = resolve(rootDir, "output", "catalog-image-review", "classification-review-fallback.json");

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function productImageUrls(product) {
  return unique(
    asArray(product?.images)
      .map((image) => (typeof image === "string" ? image : image?.src || image?.url || image?.originalSrc || ""))
      .map(normalizeText),
  );
}

function parseArgs(argv) {
  const args = { output: defaultOutputPath };
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] === "--output") {
      args.output = resolve(rootDir, argv[index + 1] || args.output);
      index += 1;
    }
  }
  return args;
}

async function writeReport(filePath, report) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function readFallbackQueue() {
  try {
    const parsed = JSON.parse(await readFile(fallbackQueuePath, "utf8"));
    return Array.isArray(parsed?.products) ? parsed.products : null;
  } catch {
    return null;
  }
}

function compareHandles(expected, actual) {
  const expectedSet = new Set(expected.map((entry) => normalizeText(entry?.handle).toLowerCase()).filter(Boolean));
  const actualSet = new Set(actual.map((entry) => normalizeText(entry?.handle).toLowerCase()).filter(Boolean));
  return {
    missing: [...expectedSet].filter((handle) => !actualSet.has(handle)).sort(),
    unexpected: [...actualSet].filter((handle) => !expectedSet.has(handle)).sort(),
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const payload = await readProductCatalogPayload(dataDir);
  const products = asArray(payload.products);
  const productById = new Map(products.map((product) => [normalizeText(product?.id), product]));
  const productByHandle = new Map(products.map((product) => [normalizeText(product?.handle).toLowerCase(), product]));
  const invalidVisualOverrides = [];

  for (const override of CATALOG_TAXONOMY_OVERRIDES) {
    if (!override?.imageReviewed) continue;
    const product = productById.get(normalizeText(override.productId)) || productByHandle.get(normalizeText(override.handle).toLowerCase());
    const imageUrls = productImageUrls(product);
    if (!product) {
      invalidVisualOverrides.push({ id: override.id, reason: "product-not-in-refreshed-catalog" });
      continue;
    }
    if (!isImageReviewedCatalogTaxonomyOverride(override)) {
      invalidVisualOverrides.push({ id: override.id, handle: product.handle, reason: "incomplete-image-review-evidence" });
      continue;
    }
    if (!imageUrls.includes(normalizeText(override.imageUrl))) {
      invalidVisualOverrides.push({
        id: override.id,
        handle: product.handle,
        reason: "reviewed-image-no-longer-present",
        reviewedImageUrl: normalizeText(override.imageUrl),
        currentImageUrls: imageUrls,
      });
    }
  }

  const unresolved = [];
  const zeroImageProducts = [];
  for (const product of products) {
    const rawClassification = classifyCatalogTaxonomyWithoutOverrides(product);
    const imageUrls = productImageUrls(product);
    if (!imageUrls.length) {
      zeroImageProducts.push({
        productId: normalizeText(product?.id),
        handle: normalizeText(product?.handle),
        title: normalizeText(product?.title),
        status: normalizeText(product?.status) || "snapshot-status-unknown",
      });
    }
    if (!rawClassification.reviewRequired) continue;

    const override = getCatalogTaxonomyOverride(product);
    if (!isImageReviewedCatalogTaxonomyOverride(override)) {
      unresolved.push({
        productId: normalizeText(product?.id),
        handle: normalizeText(product?.handle),
        title: normalizeText(product?.title),
        imageUrls,
        suggestedRuleId: rawClassification.ruleId,
        suggestedCanonicalType: rawClassification.canonicalType,
        reviewReasons: rawClassification.reviewReasons,
      });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    source: resolve(dataDir, "products.json"),
    summary: {
      products: products.length,
      imageReviewedOverrides: CATALOG_TAXONOMY_OVERRIDES.filter(isImageReviewedCatalogTaxonomyOverride).length,
      unresolvedVisualCandidates: unresolved.length,
      invalidVisualOverrides: invalidVisualOverrides.length,
      zeroImageProducts: zeroImageProducts.length,
    },
    invalidVisualOverrides,
    unresolved,
    zeroImageProducts,
    fallbackQueue: {
      path: fallbackQueuePath,
      products: null,
      missing: [],
      unexpected: [],
    },
  };
  const fallbackQueue = await readFallbackQueue();
  if (!fallbackQueue) {
    report.fallbackQueue.missing = unresolved.map((entry) => normalizeText(entry?.handle)).filter(Boolean).sort();
    invalidVisualOverrides.push({ reason: "classification-review-fallback-queue-missing", path: fallbackQueuePath });
  } else {
    const mismatch = compareHandles(unresolved, fallbackQueue);
    report.fallbackQueue.products = fallbackQueue.length;
    report.fallbackQueue.missing = mismatch.missing;
    report.fallbackQueue.unexpected = mismatch.unexpected;
    if (mismatch.missing.length || mismatch.unexpected.length) {
      invalidVisualOverrides.push({
        reason: "classification-review-fallback-queue-mismatch",
        missing: mismatch.missing,
        unexpected: mismatch.unexpected,
      });
    }
    if (fallbackQueue.some((entry) => entry?.collectionHandle !== "classification-review"
      || entry?.managedTag !== "classification-review"
      || entry?.semanticAssignmentAllowed !== false)) {
      invalidVisualOverrides.push({ reason: "classification-review-fallback-policy-invalid" });
    }
  }
  report.summary.invalidVisualOverrides = invalidVisualOverrides.length;
  report.summary.fallbackQueueProducts = report.fallbackQueue.products;
  await writeReport(args.output, report);

  const supervisedPending = process.env.SALT_CATALOG_VISION_SUPERVISED === "1";
  const deterministicFallbackAllowed = process.env.SALT_CATALOG_DETERMINISTIC_FALLBACK_ALLOWED === "1";
  if (invalidVisualOverrides.length || (!supervisedPending && !deterministicFallbackAllowed && unresolved.length)) {
    process.stderr.write(
      `Image review gate blocked: ${unresolved.length} ambiguous products still need visual decisions and ${invalidVisualOverrides.length} review records are stale or incomplete.\n`,
    );
    process.exitCode = 1;
    return;
  }

  if (supervisedPending && unresolved.length) {
    process.stdout.write(
      `Supervised image evidence gate passed: ${unresolved.length} image-backed candidates will be processed by the guarded vision classifier; unresolved or low-confidence results remain in classification-review.\n`,
    );
    return;
  }

  if (deterministicFallbackAllowed && unresolved.length) {
    process.stdout.write(
      `Deterministic image evidence gate passed with fallback: ${unresolved.length} ambiguous products are explicitly held in classification-review; no semantic image guesses will be published.\n`,
    );
    return;
  }

  process.stdout.write(
    `Image review coverage verified: ${report.summary.imageReviewedOverrides} visual decisions, ${zeroImageProducts.length} zero-image products awaiting the separate live deletion check.\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
