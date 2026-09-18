#!/usr/bin/env node

/*
 * Future Light Store visual variant gate.
 *
 * This file deliberately does not invent labels or image mappings. The
 * queue is evidence only; an explicit approved-mappings.json written from a
 * ChatGPT visual review is required before any live mutation can happen.
 */

import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";

const rootDir = resolve(import.meta.dirname, "..");
const queueDir = resolve(rootDir, "output", "future-light-visual-review");
const queuePath = resolve(queueDir, "queue.json");
const statePath = resolve(queueDir, "state.json");
const approvedPath = resolve(queueDir, "approved-mappings.json");
const reviewProgressPath = resolve(queueDir, "chatgpt-review-progress.json");
const targetStoreDomain = "vs-future-store-0jl2t-jxu6tnr3.myshopify.com";
const queueSchemaVersion = "2026-09-16.future-light-visual-variant-review.2";
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
  return {
    prepare: argv.includes("--prepare") || (!argv.includes("--check") && !argv.includes("--apply")),
    check: argv.includes("--check"),
    apply: argv.includes("--apply"),
  };
}

async function readJson(path, fallback = null) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(path, value) {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalize(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function idKey(value) {
  return normalize(value);
}

function sameShopifyId(left, right) {
  const a = normalize(left);
  const b = normalize(right);
  if (a === b) return true;
  const aNumeric = a.match(/(\d+)$/)?.[1];
  const bNumeric = b.match(/(\d+)$/)?.[1];
  return Boolean(aNumeric && bNumeric && aNumeric === bNumeric);
}

function imageKey(handle, url) {
  return `${normalize(handle)}|${normalize(url)}`;
}

function rejectedGeneratedAssets(progress) {
  return new Set((progress?.entries || []).flatMap((entry) => (entry.reviewedMedia || [])
    .filter((media) => media?.status === "rejected" || media?.decision === "rejected-generated-asset" || media?.notApprovedForUpload === true)
    .map((media) => normalize(media.generatedAssetPath))
    .filter(Boolean)));
}

function variantOptionReviewKey(productId, optionName, currentName) {
  return `${normalize(productId)}\u0000${normalize(optionName).toLowerCase()}\u0000${normalize(currentName).toLowerCase()}`;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function makeQueue(optionManifest, imageCoverage) {
  if (optionManifest?.targetStoreDomain !== targetStoreDomain) {
    throw new Error(`Variant option evidence targets ${optionManifest?.targetStoreDomain || "an unknown store"}, not ${targetStoreDomain}`);
  }

  const optionEntries = [];
  const variantOptionEntries = [];
  const variantEntries = [];
  for (const entry of optionManifest.entries || []) {
    const options = (entry.options || []).map((option) => ({
      optionId: option.optionId,
      optionName: option.optionName,
      values: (option.values || []).map((value) => ({
        optionValueId: value.id,
        currentName: value.name,
      })),
    })).filter((option) => option.values.length);
    if (options.length) {
      optionEntries.push({
        productId: entry.productId,
        handle: entry.handle,
        title: entry.title,
        options,
      });
    }

    const variantOptionIssues = (entry.variantOptionIssues || []).filter((issue) => normalize(issue.name) && normalize(issue.value));
    if (variantOptionIssues.length) {
      variantOptionEntries.push({
        productId: entry.productId,
        handle: entry.handle,
        title: entry.title,
        options: variantOptionIssues.map((issue) => ({
          optionId: null,
          optionName: issue.name,
          source: "variant-selected-option",
          values: [{
            optionValueId: null,
            reviewKey: variantOptionReviewKey(entry.productId, issue.name, issue.value),
            currentName: issue.value,
            variantIds: issue.variantIds || [],
            reasons: issue.reasons || [],
          }],
        })),
      });
    }

    const variants = Object.entries(entry.variantMedia || {}).map(([variantId, variant]) => ({
      variantId,
      title: variant.title,
      sku: variant.sku,
      selectedOptions: variant.selectedOptions || [],
      currentMedia: (variant.media || []).map((media) => ({
        mediaId: media.id,
        url: media.url,
        width: media.width,
        height: media.height,
      })),
    }));
    if (variants.length) {
      variantEntries.push({
        productId: entry.productId,
        handle: entry.handle,
        title: entry.title,
        media: entry.media || [],
        variants,
      });
    }
  }

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
    optionValueDecisions: optionEntries.reduce((sum, entry) => sum + entry.options.reduce((n, option) => n + option.values.length, 0), 0),
    variantOnlyOptionValueDecisions: variantOptionEntries.reduce((sum, entry) => sum + entry.options.reduce((n, option) => n + option.values.length, 0), 0),
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
      optionManifestGeneratedAt: optionManifest.generatedAt || null,
      imageCoverageGeneratedAt: imageCoverage?.generatedAt || null,
    },
    summary: {
      affectedOptionProducts: optionEntries.length,
      affectedOptionValues: requirements.optionValueDecisions,
      productsWithVariantOnlyOptionEvidence: variantOptionEntries.length,
      variantOnlyOptionValueDecisions: requirements.variantOnlyOptionValueDecisions,
      productsWithVariantMediaEvidence: variantEntries.length,
      variantMediaDecisions: requirements.variantMediaDecisions,
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
    optionEntries,
    variantOptionEntries,
    variantEntries: variantEntries.map((entry) => ({ ...entry, media: entry.media.map((media) => media.id) })),
    imageEntries,
  });
  return payload;
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
    failures.push("approved mapping does not match the current visual evidence queue; regenerate decisions after the next queue refresh");
  }

  const optionDecisions = new Map(approvedDecisionEntries(approved, "optionValueDecisions").map((item) => [idKey(item.optionValueId), item]));
  for (const entry of queue.optionEntries) {
    for (const option of entry.options) {
      const names = new Set();
      for (const value of option.values) {
        const decision = optionDecisions.get(idKey(value.optionValueId));
        if (!decision?.newName) failures.push(`${entry.handle}: missing reviewed label for ${value.currentName}`);
        const newName = normalize(decision?.newName);
        if (newName && names.has(newName.toLowerCase())) failures.push(`${entry.handle}: duplicate reviewed option label ${newName}`);
        if (newName) names.add(newName.toLowerCase());
        if (newName && /^(?:image\s*color|color\s*image|tk[-_]?\d{4,}|china(?: mainland)?|mainland china)$/i.test(newName)) {
          failures.push(`${entry.handle}: reviewed label remains a raw code/supplier-origin label (${newName})`);
        }
      }
    }
  }

  const variantOptionDecisions = new Map(approvedDecisionEntries(approved, "variantOptionLabelDecisions").map((item) => [idKey(item.reviewKey || variantOptionReviewKey(item.productId, item.optionName, item.fromName)), item]));
  for (const entry of queue.variantOptionEntries || []) {
    const names = new Set();
    for (const option of entry.options || []) {
      for (const value of option.values || []) {
        const decision = variantOptionDecisions.get(idKey(value.reviewKey));
        if (!decision?.newName) failures.push(`${entry.handle}: missing reviewed label for variant-only ${option.optionName} ${value.currentName}`);
        if (decision?.fromName && normalize(decision.fromName) !== normalize(value.currentName)) failures.push(`${entry.handle}: variant-only label changed since visual review (${value.currentName})`);
        const newName = normalize(decision?.newName);
        if (newName && names.has(newName.toLowerCase())) failures.push(`${entry.handle}: duplicate reviewed variant-only option label ${newName}`);
        if (newName) names.add(newName.toLowerCase());
        if (newName && /^(?:image\s*color|color\s*image|tk[-_]?\d{4,}|china(?: mainland)?|mainland china|\d{1,4})$/i.test(newName)) {
          failures.push(`${entry.handle}: reviewed variant-only label remains a raw code/supplier-origin label (${newName})`);
        }
      }
    }
  }

  const variantDecisions = new Map(approvedDecisionEntries(approved, "variantMediaAssignments").map((item) => [idKey(item.variantId), item]));
  for (const entry of queue.variantEntries) {
    for (const variant of entry.variants) {
      const decision = variantDecisions.get(idKey(variant.variantId));
      if (!decision?.mediaId) failures.push(`${entry.handle}: missing reviewed media mapping for ${variant.title}`);
      if (decision?.mediaId && !entry.media.some((media) => media.id === decision.mediaId)) {
        failures.push(`${entry.handle}: media mapping for ${variant.title} is not one of the product's live media IDs`);
      }
    }
  }

  const imageDecisions = new Map(approvedDecisionEntries(approved, "imageDecisions").map((item) => [imageKey(item.handle, item.imageUrl), item]));
  const rejectedAssets = rejectedGeneratedAssets(reviewProgress);
  for (const image of queue.imageEntries) {
    const decision = imageDecisions.get(imageKey(image.handle, image.imageUrl));
    if (!decision || !["keep", "recreate"].includes(decision.action)) {
      failures.push(`${image.handle}: missing keep/recreate decision for image ${image.imageUrl}`);
      continue;
    }
    if (decision.action === "recreate") {
      if (!RECREATE_REASON_CODES.has(normalize(decision.reasonCode))) {
        failures.push(`${image.handle}: recreate requires an approved objective reasonCode; attractive/accurate images must be kept`);
      }
      if (normalize(decision.reviewNote).length < MIN_REVIEW_NOTE_LENGTH) {
        failures.push(`${image.handle}: recreate requires a concise visual review note; do not regenerate on preference alone`);
      }
      if (decision.productIdentityPreserved !== true || !sameShopifyId(decision.sourceProductId, image.productId)) {
        failures.push(`${image.handle}: recreated asset is blocked unless the exact source product identity is confirmed and matches the queued product`);
      }
      if (normalize(decision.identityReviewNote).length < MIN_IDENTITY_NOTE_LENGTH) {
        failures.push(`${image.handle}: recreate requires a product-identity review note of at least ${MIN_IDENTITY_NOTE_LENGTH} characters`);
      }
      const assetPath = resolve(rootDir, normalize(decision.generatedAssetPath || ""));
      if (!assetPath.startsWith(`${resolve(rootDir, "output", "imagegen")}/`)) {
        failures.push(`${image.handle}: recreated image must live under output/imagegen`);
      } else {
        try { await access(assetPath); }
        catch { failures.push(`${image.handle}: recreated image asset is missing at ${relative(rootDir, assetPath)}`); }
      }
      if (rejectedAssets.has(normalize(decision.generatedAssetPath))) {
        failures.push(`${image.handle}: recreated asset was explicitly rejected by ChatGPT visual review and is not eligible for upload`);
      }
    }
  }
  return failures;
}

async function main() {
  const args = parseArgs();
  const optionManifest = await readJson(resolve(rootDir, "output", "future-light-variant-options", "manifest.json"));
  const imageCoverage = await readJson(resolve(rootDir, "output", "catalog-image-review-coverage.json"));
  if (!optionManifest) throw new Error("Missing Future Light variant option evidence; run npm run shopify:variants:options:media first.");
  if (!imageCoverage) throw new Error("Missing Future Light image coverage; run npm run catalog:image-review:build first.");

  const queue = makeQueue(optionManifest, imageCoverage);
  if (args.prepare) {
    await writeJson(queuePath, queue);
    await writeJson(statePath, {
      schemaVersion: queueSchemaVersion,
      status: queue.status,
      targetStoreDomain,
      queueFingerprint: queue.queueFingerprint,
      requirements: queue.requirements,
      updatedAt: queue.generatedAt,
    });
    process.stdout.write(`Future Light visual review queue prepared: ${queue.summary.affectedOptionValues} option values, ${queue.summary.variantMediaDecisions} variant-media mappings, ${queue.summary.imageCandidates} image decisions pending.\n`);
    if (!args.check && !args.apply) return;
  }

  const persistedQueue = await readJson(queuePath, queue);
  const [approved, reviewProgress] = await Promise.all([readJson(approvedPath), readJson(reviewProgressPath)]);
  const failures = await validateApproved(persistedQueue, approved, reviewProgress);
  if (persistedQueue.queueFingerprint !== queue.queueFingerprint) {
    failures.unshift("persisted visual review queue is stale; run the queue preparation command again before approval");
  }
  if (failures.length) {
    await writeJson(statePath, {
      schemaVersion: queueSchemaVersion,
      status: "blocked_pending_chatgpt_visual_review",
      targetStoreDomain,
      queueFingerprint: persistedQueue.queueFingerprint,
      requirements: persistedQueue.requirements,
      failureCount: failures.length,
      failures: failures.slice(0, 200),
      updatedAt: new Date().toISOString(),
    });
    process.stderr.write(`Future Light visual review gate blocked: ${failures.length} decision(s) missing or invalid.\n`);
    process.stderr.write(`${failures.slice(0, 20).join(" | ")}\n`);
    process.exitCode = 1;
    return;
  }

  if (args.apply) {
    throw new Error("Approved visual decisions are validated, but live option/media mutation is intentionally not enabled until the explicit apply adapter is reviewed.");
  }
  await writeJson(statePath, {
    schemaVersion: queueSchemaVersion,
    status: "approved_pending_live_apply",
    targetStoreDomain,
    queueFingerprint: persistedQueue.queueFingerprint,
    requirements: persistedQueue.requirements,
    approvedAt: new Date().toISOString(),
  });
  process.stdout.write("Future Light visual review gate passed; approved mapping is ready for the guarded live apply adapter.\n");
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
