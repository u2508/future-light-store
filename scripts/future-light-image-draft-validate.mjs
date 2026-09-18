#!/usr/bin/env node

/* Validate Image Gen replacement candidates without touching Shopify.
 * This is intentionally a draft-only gate: it verifies exact held-source
 * identity and local assets, but never creates an approved mapping or writes
 * live media. */

import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dirname, "..");
const reviewDir = resolve(rootDir, "output", "future-light-visual-review");
const draftPath = resolve(rootDir, "output", "imagegen", "future-light", "replacement-decisions-draft.json");
const queuePath = resolve(reviewDir, "queue.json");
const decisionsPath = resolve(reviewDir, "chatgpt-image-decisions.json");
const reviewProgressPath = resolve(reviewDir, "chatgpt-review-progress.json");
const repairPlanPath = resolve(reviewDir, "held-image-repair-plan.json");
const repairQueuePath = resolve(rootDir, "output", "imagegen", "future-light", "held-repair-queue.json");
const approvedPath = resolve(reviewDir, "approved-mappings.json");
const targetStoreDomain = "vs-future-store-0jl2t-jxu6tnr3.myshopify.com";

function normalize(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function isGeneratedCandidate(entry) {
  return Boolean(entry?.generatedAssetPresent) && [
    "generated_pending_chatgpt_review",
    "generated_approved_for_mapping",
  ].includes(entry?.status);
}
function sameId(left, right) {
  const a = normalize(left);
  const b = normalize(right);
  if (a === b) return true;
  return Boolean(a.match(/(\d+)$/)?.[1] && a.match(/(\d+)$/)[1] === b.match(/(\d+)$/)?.[1]);
}
async function readJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function rejectedGeneratedAssets(progress) {
  return new Set((progress?.entries || []).flatMap((entry) => (entry.reviewedMedia || [])
    .filter((media) => media?.status === "rejected" || media?.decision === "rejected-generated-asset" || media?.notApprovedForUpload === true)
    .map((media) => normalize(media.generatedAssetPath))
    .filter(Boolean)));
}

async function main() {
  const [draft, queue, decisions, reviewProgress, repairPlan, repairQueue] = await Promise.all([
    readJson(draftPath),
    readJson(queuePath),
    readJson(decisionsPath),
    readJson(reviewProgressPath),
    readJson(repairPlanPath),
    readJson(repairQueuePath),
  ]);
  if (!draft) {
    process.stdout.write("Future Light Image Gen draft validation: no local replacement candidates; no live mutation or approval file created.\n");
    return;
  }
  if (!queue || !decisions || !repairQueue) throw new Error("Visual queue, repair queue, and ChatGPT image decisions are required when an Image Gen draft exists");
  const failures = [];
  if (draft.status !== "draft_not_applied") failures.push("draft status must remain draft_not_applied");
  if (draft.targetStoreDomain !== targetStoreDomain) failures.push("draft targets the wrong store");
  if (await access(approvedPath).then(() => true).catch(() => false)) failures.push("approved-mappings.json exists; draft validator refuses to run over an approval file");
  if (draft.queueFingerprint && draft.queueFingerprint !== queue.queueFingerprint) failures.push("draft queue fingerprint is stale");

  const held = new Map((decisions.holds || []).map((item) => [`${normalize(item.handle)}|${normalize(item.imageUrl)}`, item]));
  const explicitRecreates = new Map((decisions.entries || [])
    .filter((item) => item.productIdentityPreserved === true && normalize(item.generatedAssetPath))
    .map((item) => [`${normalize(item.handle)}|${normalize(item.imageUrl)}`, item]));
  const queueImages = new Map((queue.imageEntries || []).map((item) => [`${normalize(item.handle)}|${normalize(item.imageUrl)}`, item]));
  const generatedQueue = new Map((repairQueue.entries || []).map((item) => [`${normalize(item.handle)}|${normalize(item.heldSourceImageUrl)}`, item]));
  const sourceReviewRequired = new Set((repairPlan?.sourceReviewRequired || []).map((item) => `${normalize(item.handle)}|${normalize(item.heldSourceImageUrl)}`));
  const plannedCandidates = new Set((repairPlan?.replacementCandidates || []).map((item) => `${normalize(item.handle)}|${normalize(item.heldSourceImageUrl)}`));
  const rejectedAssets = rejectedGeneratedAssets(reviewProgress);
  const seen = new Set();
  for (const [index, item] of (draft.decisions || []).entries()) {
    const key = `${normalize(item.handle)}|${normalize(item.heldSourceImageUrl)}`;
    if (seen.has(key)) failures.push(`decision ${index + 1} duplicates the same held source`);
    seen.add(key);
    const hold = held.get(key);
    const reviewedSource = hold || explicitRecreates.get(key);
    const queued = queueImages.get(key);
    const generatedQueued = generatedQueue.get(key);
    if (!reviewedSource) failures.push(`decision ${index + 1} does not match a held ChatGPT-reviewed source image or explicit recreate review`);
    if (!queued) failures.push(`decision ${index + 1} does not match the current image queue`);
    if (sourceReviewRequired.has(key)) failures.push(`decision ${index + 1} is blocked because the current repair plan requires source/product review`);
    if (!sourceReviewRequired.has(key) && repairPlan && !plannedCandidates.has(key)) failures.push(`decision ${index + 1} is not present in the current held-image repair plan`);
    if (!isGeneratedCandidate(generatedQueued)) failures.push(`decision ${index + 1} does not point to a currently generated queue asset`);
    if (generatedQueued && normalize(item.generatedAssetPath) !== normalize(generatedQueued.generatedAssetPath)) failures.push(`decision ${index + 1} generatedAssetPath does not match the current queue asset`);
    if (reviewedSource && queued && (!sameId(item.sourceProductId, reviewedSource.productId) || !sameId(item.sourceProductId, queued.productId))) {
      failures.push(`decision ${index + 1} sourceProductId does not match the held/queued product`);
    }
    if (item.action !== "recreate_candidate") failures.push(`decision ${index + 1} must remain recreate_candidate until final review`);
    if (item.productIdentityPreserved !== true) failures.push(`decision ${index + 1} is missing productIdentityPreserved=true`);
    if (normalize(item.identityReviewNote).length < 30) failures.push(`decision ${index + 1} needs a substantive identity review note`);
    const assetPath = resolve(rootDir, normalize(item.generatedAssetPath || ""));
    if (!assetPath.startsWith(`${resolve(rootDir, "output", "imagegen")}/`)) failures.push(`decision ${index + 1} asset is outside output/imagegen`);
    else if (!(await access(assetPath).then(() => true).catch(() => false))) failures.push(`decision ${index + 1} asset is missing`);
    if (rejectedAssets.has(normalize(item.generatedAssetPath))) failures.push(`decision ${index + 1} uses a generated asset explicitly rejected by ChatGPT visual review`);
  }
  if (failures.length) {
    process.stderr.write(`Future Light Image Gen draft validation failed: ${failures.length} issue(s).\n${failures.join("\n")}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`Future Light Image Gen draft validated: ${(draft.decisions || []).length} identity-safe candidate(s); no live mutation or approval file created.\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
