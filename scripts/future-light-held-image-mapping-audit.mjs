#!/usr/bin/env node

/*
 * Build an evidence-only mapping audit for manually approved held-image
 * replacements. This file never decides a variant mapping and never writes to
 * Shopify. It only joins ChatGPT's explicit image review with the latest
 * persisted product/media/variant evidence so a later guarded apply can review
 * every source-to-replacement relationship.
 */

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dirname, "..");
const queuePath = resolve(rootDir, "output", "future-light-visual-review", "queue.json");
const progressPath = resolve(rootDir, "output", "future-light-visual-review", "chatgpt-review-progress.json");
const repairQueuePath = resolve(rootDir, "output", "imagegen", "future-light", "held-repair-queue.json");
const outputPath = resolve(rootDir, "output", "future-light-visual-review", "held-image-mapping-audit.json");
const targetStoreDomain = "vs-future-store-0jl2t-jxu6tnr3.myshopify.com";

function normalize(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function sameId(left, right) {
  const a = normalize(left);
  const b = normalize(right);
  if (a === b) return true;
  const an = a.match(/(\d+)$/)?.[1];
  const bn = b.match(/(\d+)$/)?.[1];
  return Boolean(an && bn && an === bn);
}
function imageKey(handle, url) { return `${normalize(handle)}|${normalize(url)}`; }

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function fileExists(path) {
  try { await access(path); return true; }
  catch { return false; }
}

async function main() {
  const [queue, progress, repairQueue] = await Promise.all([
    readJson(queuePath),
    readJson(progressPath),
    readJson(repairQueuePath),
  ]);
  if (queue.targetStoreDomain !== targetStoreDomain || repairQueue.targetStoreDomain !== targetStoreDomain) {
    throw new Error("Refused to build a held-image audit for a non-Future Light Store target.");
  }

  const imageEvidence = new Map((queue.imageEntries || []).map((entry) => [imageKey(entry.handle, entry.imageUrl), entry]));
  const variantEvidence = new Map((queue.variantEntries || []).map((entry) => [entry.handle, entry]));
  const repairEvidence = new Map((repairQueue.entries || []).map((entry) => [imageKey(entry.handle, entry.heldSourceImageUrl), entry]));
  const reviewed = [];
  for (const parent of progress.entries || []) {
    for (const media of parent.reviewedMedia || []) {
      if (media.decision !== "approved-generated-asset" || media.status !== "approved" || media.notApprovedForUpload !== false) continue;
      const repair = repairEvidence.get(imageKey(parent.handle, media.heldSourceImageUrl));
      const image = imageEvidence.get(imageKey(parent.handle, media.heldSourceImageUrl));
      const variantEntry = variantEvidence.get(parent.handle);
      const linkedVariants = (variantEntry?.variants || []).filter((variant) =>
        (variant.currentMedia || []).some((current) => normalize(current.url) === normalize(media.heldSourceImageUrl)),
      ).map((variant) => ({
        variantId: variant.variantId,
        title: variant.title,
        sku: variant.sku,
        selectedOptions: variant.selectedOptions || [],
        sourceMedia: (variant.currentMedia || []).filter((current) => normalize(current.url) === normalize(media.heldSourceImageUrl)),
      }));
      const assetPath = resolve(rootDir, normalize(media.generatedAssetPath));
      const issues = [];
      if (!repair) issues.push("approved review is not present in the current held-repair queue");
      if (!image) issues.push("source image is not present in the current visual evidence queue");
      if (repair && !sameId(repair.productId, parent.productId)) issues.push("repair queue product ID disagrees with ChatGPT review");
      if (!await fileExists(assetPath)) issues.push("approved generated asset is missing");
      reviewed.push({
        productId: parent.productId,
        handle: parent.handle,
        title: image?.title || parent.title,
        sourceImageUrl: media.heldSourceImageUrl,
        sourceMediaId: variantEntry?.media?.find((item) => normalize(item.url) === normalize(media.heldSourceImageUrl))?.id || null,
        generatedAssetPath: media.generatedAssetPath,
        visualFinding: media.visualFinding,
        identityReviewNote: media.identityReviewNote,
        variantLinkage: {
          status: variantEntry ? (linkedVariants.length ? "evidence-linked" : "no-variant-currently-linked") : "variant-evidence-unavailable",
          variantIds: linkedVariants,
        },
        applyStatus: issues.length ? "blocked_pending_evidence_reconciliation" : "approved_for_guarded_mapping_review",
        issues,
      });
    }
  }

  const output = {
    schemaVersion: "2026-09-17.future-light-held-image-mapping-audit.1",
    targetStoreDomain,
    liveMutation: false,
    mappingDecisionsInvented: false,
    source: {
      chatgptReviewProgress: "output/future-light-visual-review/chatgpt-review-progress.json",
      visualQueue: "output/future-light-visual-review/queue.json",
      heldRepairQueue: "output/imagegen/future-light/held-repair-queue.json",
    },
    entries: reviewed,
    summary: {
      approvedReviews: reviewed.length,
      readyForGuardedMappingReview: reviewed.filter((entry) => entry.applyStatus === "approved_for_guarded_mapping_review").length,
      blockedPendingEvidenceReconciliation: reviewed.filter((entry) => entry.applyStatus !== "approved_for_guarded_mapping_review").length,
      withExplicitVariantLinkage: reviewed.filter((entry) => entry.variantLinkage.status === "evidence-linked").length,
      withoutCurrentVariantLinkage: reviewed.filter((entry) => entry.variantLinkage.status !== "evidence-linked").length,
    },
    generatedAt: new Date().toISOString(),
  };
  await mkdir(resolve(outputPath, ".."), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  process.stdout.write(`Future Light held-image mapping audit: ${output.summary.approvedReviews} approved review(s), ${output.summary.readyForGuardedMappingReview} ready for guarded mapping review, ${output.summary.blockedPendingEvidenceReconciliation} blocked. No Shopify mutation.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
