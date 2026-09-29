#!/usr/bin/env node

/*
 * Future Light Store visual variant gate.
 *
 * This file deliberately does not invent labels or image mappings. The
 * queue is evidence only; an explicit approved-mappings.json written from a
 * ChatGPT visual review is required before any live mutation can happen.
 */

import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { isAbsolute, resolve, relative } from "node:path";
import {
  isSha256Hex,
  isShopifyGidOfType,
  sameProductGid,
  sha256Hex,
} from "./lib/visual-approval-integrity.mjs";
import { buildVariantImageReviewEntries } from "./lib/future-light-variant-image-review-queue.mjs";
import { validateVariantImageAssignments } from "./lib/future-light-variant-image-approvals.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const queueDir = resolve(rootDir, "output", "future-light-visual-review");
const queuePath = resolve(queueDir, "queue.json");
const statePath = resolve(queueDir, "state.json");
const approvedPath = resolve(queueDir, "approved-mappings.json");
const reviewProgressPath = resolve(queueDir, "chatgpt-review-progress.json");
const targetStoreDomain = "vs-future-store-0jl2t-jxu6tnr3.myshopify.com";
const queueSchemaVersion = "2026-09-27.future-light-visual-variant-review.3";
const maxSnapshotAgeMs = 24 * 60 * 60 * 1000;
const RECREATE_REASON_CODES = new Set([
  "supplier-or-China branding/watermark",
  "wrong-product-or-variant",
  "broken-or-unusable-image",
  "materially misleading crop/composition",
  "clearly off-brand presentation",
]);
const MIN_REVIEW_NOTE_LENGTH = 20;
const MIN_IDENTITY_NOTE_LENGTH = 30;

function parseArgs(argv = process.argv) {
  const snapshotIndex = argv.indexOf("--snapshot");
  const outputIndex = argv.indexOf("--output");
  const queueIndex = argv.indexOf("--queue");
  const approvedIndex = argv.indexOf("--approved");
  const progressIndex = argv.indexOf("--progress");
  return {
    prepare: argv.includes("--prepare") || (!argv.includes("--check") && !argv.includes("--apply")),
    check: argv.includes("--check"),
    apply: argv.includes("--apply"),
    snapshotPath: snapshotIndex >= 0 ? argv[snapshotIndex + 1] : null,
    outputPath: outputIndex >= 0 ? argv[outputIndex + 1] : null,
    queuePath: queueIndex >= 0 ? argv[queueIndex + 1] : null,
    approvedFile: approvedIndex >= 0 ? argv[approvedIndex + 1] : null,
    progressFile: progressIndex >= 0 ? argv[progressIndex + 1] : null,
  };
}

function resolveReviewFile(requestedPath, fallbackPath, label) {
  if (!requestedPath) return fallbackPath;
  const reviewDir = resolve(rootDir, "output", "future-light-visual-review");
  const selected = isAbsolute(requestedPath)
    ? resolve(requestedPath)
    : resolve(rootDir, requestedPath);
  if (!selected.startsWith(`${reviewDir}/`) || !selected.endsWith(".json")) {
    throw new Error(`${label} must be a .json file inside output/future-light-visual-review/.`);
  }
  return selected;
}

function resolveQueueOutputPaths(requestedPath) {
  if (!requestedPath) return { queuePath, statePath };
  const reviewDir = resolve(rootDir, "output", "future-light-visual-review");
  const selectedQueuePath = isAbsolute(requestedPath)
    ? resolve(requestedPath)
    : resolve(rootDir, requestedPath);
  if (!selectedQueuePath.startsWith(`${reviewDir}/`) || !selectedQueuePath.endsWith(".json")) {
    throw new Error(
      "A custom visual review queue must be a .json file inside output/future-light-visual-review/.",
    );
  }
  if ([approvedPath, reviewProgressPath, statePath].includes(selectedQueuePath)) {
    throw new Error(
      "The visual queue output cannot overwrite approval, review-progress, or state records.",
    );
  }
  return {
    queuePath: selectedQueuePath,
    statePath: selectedQueuePath.replace(/\.json$/, ".state.json"),
  };
}

async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(path, value) {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalize(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function idKey(value) {
  return normalize(value);
}

function imageKey(handle, url) {
  return `${normalize(handle)}|${normalize(url)}`;
}

function rejectedGeneratedAssets(progress) {
  return new Set(
    (progress?.entries || []).flatMap((entry) =>
      (entry.reviewedMedia || [])
        .filter(
          (media) =>
            media?.status === "rejected" ||
            media?.decision === "rejected-generated-asset" ||
            media?.notApprovedForUpload === true,
        )
        .map((media) => normalize(media.generatedAssetPath))
        .filter(Boolean),
    ),
  );
}

function variantOptionReviewKey(productId, optionName, currentName) {
  return `${normalize(productId)}\u0000${normalize(optionName).toLowerCase()}\u0000${normalize(currentName).toLowerCase()}`;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function makeQueue(optionManifest, imageCoverage, catalogSnapshot, snapshotPath) {
  if (optionManifest?.targetStoreDomain !== targetStoreDomain) {
    throw new Error(
      `Variant option evidence targets ${optionManifest?.targetStoreDomain || "an unknown store"}, not ${targetStoreDomain}`,
    );
  }

  const optionEntries = [];
  const variantOptionEntries = [];
  const variantEntries = [];
  for (const entry of optionManifest.entries || []) {
    const options = (entry.options || [])
      .map((option) => ({
        optionId: option.optionId,
        optionName: option.optionName,
        values: (option.values || []).map((value) => ({
          optionValueId: value.id,
          currentName: value.name,
        })),
      }))
      .filter((option) => option.values.length);
    if (options.length) {
      optionEntries.push({
        productId: entry.productId,
        handle: entry.handle,
        title: entry.title,
        options,
      });
    }

    const variantOptionIssues = (entry.variantOptionIssues || []).filter(
      (issue) => normalize(issue.name) && normalize(issue.value),
    );
    if (variantOptionIssues.length) {
      variantOptionEntries.push({
        productId: entry.productId,
        handle: entry.handle,
        title: entry.title,
        options: variantOptionIssues.map((issue) => ({
          optionId: null,
          optionName: issue.name,
          source: "variant-selected-option",
          values: [
            {
              optionValueId: null,
              reviewKey: variantOptionReviewKey(entry.productId, issue.name, issue.value),
              currentName: issue.value,
              variantIds: issue.variantIds || [],
              reasons: issue.reasons || [],
            },
          ],
        })),
      });
    }
  }

  const variantReview = buildVariantImageReviewEntries(catalogSnapshot, { targetStoreDomain });
  variantEntries.push(...variantReview.entries);

  const imageEntries = [];
  const seenImages = new Set();
  for (const entry of imageCoverage?.unresolved || []) {
    for (const url of entry.imageUrls || []) {
      const key = imageKey(entry.handle, url);
      if (seenImages.has(key)) continue;
      seenImages.add(key);
      imageEntries.push({
        productId: entry.productId,
        handle: entry.handle,
        title: entry.title,
        imageUrl: url,
        decisionRequired: "keep or recreate",
      });
    }
  }

  const requirements = {
    optionValueDecisions: optionEntries.reduce(
      (sum, entry) => sum + entry.options.reduce((n, option) => n + option.values.length, 0),
      0,
    ),
    variantOnlyOptionValueDecisions: variantOptionEntries.reduce(
      (sum, entry) => sum + entry.options.reduce((n, option) => n + option.values.length, 0),
      0,
    ),
    variantMediaDecisions: variantEntries.reduce((sum, entry) => sum + entry.variants.length, 0),
    imageDecisions: imageEntries.length,
  };

  const payload = {
    schemaVersion: queueSchemaVersion,
    generatedAt: new Date().toISOString(),
    targetStoreDomain,
    decisionPolicy: {
      source: "ChatGPT manual visual review only",
      noGeneratedLabels: true,
      noDeterministicVariantGuessing: true,
      beautifulAccurateImages: "keep",
      recreateOnlyWhenVisualReviewMarksImageInappropriate: true,
      regenerationDefault: "keep",
      regenerationRequiresObjectiveIssue: [
        "supplier-or-China branding/watermark",
        "wrong-product-or-variant",
        "broken-or-unusable-image",
        "materially misleading crop/composition",
        "clearly off-brand presentation",
      ],
      recreateRequiresProductIdentityConfirmation: true,
      identityMustMatchSourceProduct: true,
      noGeneratedAssetWithoutIdentityReview: true,
      generatedAssetsRoot: "output/imagegen/future-light",
      preserveSkuPriceInventory: true,
    },
    status: "pending_chatgpt_visual_review",
    sourceEvidence: {
      optionManifest: "output/future-light-variant-options/manifest.json",
      imageCoverage: "output/catalog-image-review-coverage.json",
      catalogSnapshot: relative(rootDir, snapshotPath),
      optionManifestGeneratedAt: optionManifest.generatedAt || null,
      imageCoverageGeneratedAt: imageCoverage?.generatedAt || null,
      catalogSnapshotGeneratedAt: catalogSnapshot.createdAt,
      catalogSnapshotCounts: catalogSnapshot.counts,
    },
    summary: {
      affectedOptionProducts: optionEntries.length,
      affectedOptionValues: requirements.optionValueDecisions,
      productsWithVariantOnlyOptionEvidence: variantOptionEntries.length,
      variantOnlyOptionValueDecisions: requirements.variantOnlyOptionValueDecisions,
      productsWithVariantMediaEvidence: variantEntries.length,
      variantMediaDecisions: requirements.variantMediaDecisions,
      activeVariantsWithoutCurrentImage: variantReview.summary.activeVariantsWithoutCurrentImage,
      productImageCandidatesForVariantReview: variantReview.summary.productImageCandidates,
      imageCandidates: imageEntries.length,
      unresolvedProducts: imageCoverage?.summary?.unresolvedVisualCandidates ?? null,
    },
    requirements,
    optionEntries,
    variantOptionEntries,
    variantEntries,
    imageEntries,
  };
  payload.queueFingerprint = digest({
    targetStoreDomain,
    catalogSnapshotGeneratedAt: catalogSnapshot.createdAt,
    optionEntries,
    variantOptionEntries,
    variantEntries,
    imageEntries,
  });
  return payload;
}

async function resolveCatalogSnapshotPath(requestedPath) {
  const outputDir = resolve(rootDir, "output");
  if (requestedPath) {
    const selected = resolve(rootDir, isAbsolute(requestedPath) ? requestedPath : requestedPath);
    if (!selected.startsWith(`${outputDir}/`)) {
      throw new Error(
        "Visual review catalog snapshot must be inside this project's output directory.",
      );
    }
    return selected;
  }
  const files = await readdir(outputDir);
  const candidates = files
    .filter((name) =>
      /^future-light-shopify-catalog-snapshot-\d{4}-\d{2}-\d{2}T.*\.json$/.test(name),
    )
    .sort()
    .reverse();
  if (!candidates.length)
    throw new Error(
      "No completed Future Light catalog snapshot was found; refresh the catalog before building the full variant queue.",
    );
  return resolve(outputDir, candidates[0]);
}

async function readFreshCatalogSnapshot(requestedPath) {
  const snapshotPath = await resolveCatalogSnapshotPath(requestedPath);
  const snapshot = await readJson(snapshotPath);
  if (!snapshot)
    throw new Error(`Could not read catalog snapshot at ${relative(rootDir, snapshotPath)}.`);
  const createdAt = Date.parse(snapshot.createdAt || "");
  if (
    !Number.isFinite(createdAt) ||
    createdAt > Date.now() + 5 * 60 * 1000 ||
    Date.now() - createdAt > maxSnapshotAgeMs
  ) {
    throw new Error(
      "Full-catalog visual review requires a completed Shopify catalog snapshot no older than 24 hours; refresh it before queue preparation.",
    );
  }
  return { snapshot, snapshotPath };
}

function approvedDecisionEntries(approved, name) {
  return Array.isArray(approved?.[name]) ? approved[name] : [];
}

async function validateApproved(queue, approved, reviewProgress) {
  const failures = [];
  if (!approved || approved.targetStoreDomain !== targetStoreDomain) {
    failures.push("approved mapping has the wrong or missing Future Light Store target");
  }
  if (approved?.approval?.mode !== "chatgpt-manual-visual-review") {
    failures.push("approved mapping must declare approval.mode=chatgpt-manual-visual-review");
  }
  if (approved?.queueFingerprint !== queue.queueFingerprint) {
    failures.push(
      "approved mapping does not match the current visual evidence queue; regenerate decisions after the next queue refresh",
    );
  }

  const optionDecisions = new Map(
    approvedDecisionEntries(approved, "optionValueDecisions").map((item) => [
      idKey(item.optionValueId),
      item,
    ]),
  );
  for (const entry of queue.optionEntries) {
    for (const option of entry.options) {
      const names = new Set();
      for (const value of option.values) {
        const decision = optionDecisions.get(idKey(value.optionValueId));
        if (!decision?.newName)
          failures.push(`${entry.handle}: missing reviewed label for ${value.currentName}`);
        const newName = normalize(decision?.newName);
        if (newName && names.has(newName.toLowerCase()))
          failures.push(`${entry.handle}: duplicate reviewed option label ${newName}`);
        if (newName) names.add(newName.toLowerCase());
        if (
          newName &&
          /^(?:image\s*color|color\s*image|tk[-_]?\d{4,}|china(?: mainland)?|mainland china)$/i.test(
            newName,
          )
        ) {
          failures.push(
            `${entry.handle}: reviewed label remains a raw code/supplier-origin label (${newName})`,
          );
        }
      }
    }
  }

  const variantOptionDecisions = new Map(
    approvedDecisionEntries(approved, "variantOptionLabelDecisions").map((item) => [
      idKey(
        item.reviewKey || variantOptionReviewKey(item.productId, item.optionName, item.fromName),
      ),
      item,
    ]),
  );
  for (const entry of queue.variantOptionEntries || []) {
    const names = new Set();
    for (const option of entry.options || []) {
      for (const value of option.values || []) {
        const decision = variantOptionDecisions.get(idKey(value.reviewKey));
        if (!decision?.newName)
          failures.push(
            `${entry.handle}: missing reviewed label for variant-only ${option.optionName} ${value.currentName}`,
          );
        if (decision?.fromName && normalize(decision.fromName) !== normalize(value.currentName))
          failures.push(
            `${entry.handle}: variant-only label changed since visual review (${value.currentName})`,
          );
        const newName = normalize(decision?.newName);
        if (newName && names.has(newName.toLowerCase()))
          failures.push(`${entry.handle}: duplicate reviewed variant-only option label ${newName}`);
        if (newName) names.add(newName.toLowerCase());
        if (
          newName &&
          /^(?:image\s*color|color\s*image|tk[-_]?\d{4,}|china(?: mainland)?|mainland china|\d{1,4})$/i.test(
            newName,
          )
        ) {
          failures.push(
            `${entry.handle}: reviewed variant-only label remains a raw code/supplier-origin label (${newName})`,
          );
        }
      }
    }
  }

  failures.push(
    ...validateVariantImageAssignments(
      queue,
      approvedDecisionEntries(approved, "variantMediaAssignments"),
    ),
  );

  const imageDecisions = new Map(
    approvedDecisionEntries(approved, "imageDecisions").map((item) => [
      imageKey(item.handle, item.imageUrl),
      item,
    ]),
  );
  const rejectedAssets = rejectedGeneratedAssets(reviewProgress);
  for (const image of queue.imageEntries) {
    const decision = imageDecisions.get(imageKey(image.handle, image.imageUrl));
    if (!decision || !["keep", "recreate"].includes(decision.action)) {
      failures.push(`${image.handle}: missing keep/recreate decision for image ${image.imageUrl}`);
      continue;
    }
    if (!sameProductGid(decision.productId, image.productId)) {
      failures.push(
        `${image.handle}: image decision is not bound to the exact queued product identity`,
      );
    }
    if (decision.action === "recreate") {
      if (!RECREATE_REASON_CODES.has(normalize(decision.reasonCode))) {
        failures.push(
          `${image.handle}: recreate requires an approved objective reasonCode; attractive/accurate images must be kept`,
        );
      }
      if (normalize(decision.reviewNote).length < MIN_REVIEW_NOTE_LENGTH) {
        failures.push(
          `${image.handle}: recreate requires a concise visual review note; do not regenerate on preference alone`,
        );
      }
      if (
        decision.productIdentityPreserved !== true ||
        !sameProductGid(decision.sourceProductId, image.productId)
      ) {
        failures.push(
          `${image.handle}: recreated asset is blocked unless the exact source product identity is confirmed and matches the queued product`,
        );
      }
      if (normalize(decision.identityReviewNote).length < MIN_IDENTITY_NOTE_LENGTH) {
        failures.push(
          `${image.handle}: recreate requires a product-identity review note of at least ${MIN_IDENTITY_NOTE_LENGTH} characters`,
        );
      }
      const assetPath = resolve(rootDir, normalize(decision.generatedAssetPath || ""));
      if (!assetPath.startsWith(`${resolve(rootDir, "output", "imagegen")}/`)) {
        failures.push(`${image.handle}: recreated image must live under output/imagegen`);
      } else {
        try {
          const assetBytes = await readFile(assetPath);
          if (!isSha256Hex(decision.generatedAssetSha256)) {
            failures.push(
              `${image.handle}: recreated image is missing its approved SHA-256 asset fingerprint`,
            );
          } else if (sha256Hex(assetBytes) !== decision.generatedAssetSha256.toLowerCase()) {
            failures.push(`${image.handle}: recreated image bytes changed after visual approval`);
          }
        } catch {
          failures.push(
            `${image.handle}: recreated image asset is missing at ${relative(rootDir, assetPath)}`,
          );
        }
      }
      if (rejectedAssets.has(normalize(decision.generatedAssetPath))) {
        failures.push(
          `${image.handle}: recreated asset was explicitly rejected by ChatGPT visual review and is not eligible for upload`,
        );
      }
    }
  }
  return failures;
}

async function main() {
  const args = parseArgs();
  if (args.outputPath && (args.check || args.apply)) {
    throw new Error(
      "A custom queue path is preparation-only; validate/apply after promoting the reviewed full queue into the guarded default workflow.",
    );
  }
  if (args.queuePath && args.prepare) {
    throw new Error(
      "Use --output to prepare a queue, or --queue to validate an already persisted queue.",
    );
  }
  const outputPaths = resolveQueueOutputPaths(args.outputPath);
  const selectedQueuePath = resolveReviewFile(args.queuePath, outputPaths.queuePath, "Queue path");
  const selectedStatePath = args.queuePath
    ? selectedQueuePath.replace(/\.json$/, ".state.json")
    : outputPaths.statePath;
  const selectedApprovedPath = resolveReviewFile(args.approvedFile, approvedPath, "Approval path");
  const selectedProgressPath = resolveReviewFile(
    args.progressFile,
    reviewProgressPath,
    "Progress path",
  );
  const optionManifest = await readJson(
    resolve(rootDir, "output", "future-light-variant-options", "manifest.json"),
  );
  const imageCoverage = await readJson(
    resolve(rootDir, "output", "catalog-image-review-coverage.json"),
  );
  if (!optionManifest)
    throw new Error(
      "Missing Future Light variant option evidence; run npm run shopify:variants:options:media first.",
    );
  if (!imageCoverage)
    throw new Error(
      "Missing Future Light image coverage; run npm run catalog:image-review:build first.",
    );

  const { snapshot: catalogSnapshot, snapshotPath } = await readFreshCatalogSnapshot(
    args.snapshotPath,
  );

  const queue = makeQueue(optionManifest, imageCoverage, catalogSnapshot, snapshotPath);
  if (args.prepare) {
    await writeJson(outputPaths.queuePath, queue);
    await writeJson(outputPaths.statePath, {
      schemaVersion: queueSchemaVersion,
      status: queue.status,
      targetStoreDomain,
      queueFingerprint: queue.queueFingerprint,
      requirements: queue.requirements,
      updatedAt: queue.generatedAt,
    });
    process.stdout.write(
      `Future Light visual review queue prepared from ${relative(rootDir, snapshotPath)}: ${queue.summary.productsWithVariantMediaEvidence} active products, ${queue.summary.variantMediaDecisions} variant mappings, ${queue.summary.productImageCandidatesForVariantReview} candidate images. ${queue.summary.imageCandidates} separate image-repair decisions remain.\n`,
    );
    if (!args.check && !args.apply) return;
  }

  const persistedQueue = await readJson(selectedQueuePath, args.prepare ? queue : null);
  if (!persistedQueue) {
    throw new Error(
      `Persisted review queue is missing at ${relative(rootDir, selectedQueuePath)}; prepare that exact queue first.`,
    );
  }
  const [approved, reviewProgress] = await Promise.all([
    readJson(selectedApprovedPath),
    readJson(selectedProgressPath),
  ]);
  const failures = await validateApproved(persistedQueue, approved, reviewProgress);
  if (persistedQueue.queueFingerprint !== queue.queueFingerprint) {
    failures.unshift(
      "persisted visual review queue is stale; run the queue preparation command again before approval",
    );
  }
  if (failures.length) {
    await writeJson(selectedStatePath, {
      schemaVersion: queueSchemaVersion,
      status: "blocked_pending_chatgpt_visual_review",
      targetStoreDomain,
      queueFingerprint: persistedQueue.queueFingerprint,
      requirements: persistedQueue.requirements,
      failureCount: failures.length,
      failures: failures.slice(0, 200),
      updatedAt: new Date().toISOString(),
    });
    process.stderr.write(
      `Future Light visual review gate blocked: ${failures.length} decision(s) missing or invalid.\n`,
    );
    process.stderr.write(`${failures.slice(0, 20).join(" | ")}\n`);
    process.exitCode = 1;
    return;
  }

  if (args.apply) {
    throw new Error(
      "Approved visual decisions are validated, but live option/media mutation is intentionally not enabled until the explicit apply adapter is reviewed.",
    );
  }
  await writeJson(selectedStatePath, {
    schemaVersion: queueSchemaVersion,
    status: "approved_pending_live_apply",
    targetStoreDomain,
    queueFingerprint: persistedQueue.queueFingerprint,
    requirements: persistedQueue.requirements,
    approvedAt: new Date().toISOString(),
  });
  process.stdout.write(
    "Future Light visual review gate passed; approved mapping is ready for the guarded live apply adapter.\n",
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
