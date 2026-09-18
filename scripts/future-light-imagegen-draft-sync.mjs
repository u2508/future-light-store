#!/usr/bin/env node

/* Add only existing, non-rejected native Image Gen outputs to the local
 * replacement draft. This creates candidates for a later ChatGPT visual
 * review; it never creates approval or touches Shopify. */

import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dirname, "..");
const queuePath = resolve(rootDir, "output", "imagegen", "future-light", "held-repair-queue.json");
const draftPath = resolve(rootDir, "output", "imagegen", "future-light", "replacement-decisions-draft.json");
const progressPath = resolve(rootDir, "output", "future-light-visual-review", "chatgpt-review-progress.json");
const targetStoreDomain = "vs-future-store-0jl2t-jxu6tnr3.myshopify.com";

function normalize(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function key(entry) { return `${normalize(entry.handle)}|${normalize(entry.heldSourceImageUrl)}`; }
function isGeneratedCandidate(entry) {
  return Boolean(entry?.generatedAssetPresent) && [
    "generated_pending_chatgpt_review",
    "generated_approved_for_mapping",
  ].includes(entry?.status);
}

async function readJson(path, fallback = null) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return fallback; throw error; }
}

async function writeJson(path, value) {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function usableFile(path) {
  try { const info = await stat(path); return info.isFile() && info.size >= 512; }
  catch { return false; }
}

function rejectedAssets(progress) {
  return new Set((progress?.entries || []).flatMap((entry) => (entry.reviewedMedia || [])
    .filter((media) => media?.status === "rejected" || media?.decision === "rejected-generated-asset" || media?.notApprovedForUpload === true)
    .map((media) => normalize(media.generatedAssetPath))
    .filter(Boolean)));
}

async function main() {
  const [queue, draft, progress] = await Promise.all([readJson(queuePath), readJson(draftPath), readJson(progressPath)]);
  if (!queue) {
    process.stdout.write("Future Light Image Gen draft sync: queue is not present; no change made.\n");
    return;
  }
  if (queue.targetStoreDomain !== targetStoreDomain) throw new Error("Refused to sync a non-Future Light Store Image Gen queue.");
  const current = draft || {
    schemaVersion: "2026-09-17.future-light-imagegen-replacement-draft.1",
    targetStoreDomain,
    status: "draft_not_applied",
    decisions: [],
    invalidatedDecisions: [],
  };
  if (current.targetStoreDomain !== targetStoreDomain) throw new Error("Refused to sync a draft targeting another store.");
  const rejected = rejectedAssets(progress);
  const existing = new Map((current.decisions || []).map((entry) => [key(entry), entry]));
  const queueEntries = queue.entries || [];
  const queueByKey = new Map(queueEntries.map((entry) => [key(entry), entry]));
  const invalidatedDecisions = [...(current.invalidatedDecisions || [])];
  const invalidatedAt = new Date().toISOString();
  let invalidated = 0;
  // A manual ChatGPT visual rejection is terminal for that generated asset.
  // Remove it from the active draft even when the rejection was recorded
  // after the candidate had already been synced.
  for (const [decisionKey, prior] of existing.entries()) {
    if (!rejected.has(normalize(prior.generatedAssetPath))) continue;
    existing.delete(decisionKey);
    invalidatedDecisions.push({
      ...prior,
      invalidatedAt,
      invalidationReason: "explicit_chatgpt_visual_rejection",
    });
    invalidated += 1;
  }
  // A prior run may have left a draft pointing at an older generated file.
  // Keep the audit trail, but never let a non-current or non-generated asset
  // remain eligible for a later approval/upload step.
  for (const [decisionKey, prior] of existing.entries()) {
    const queued = queueByKey.get(decisionKey);
    if (isGeneratedCandidate(queued)) continue;
    existing.delete(decisionKey);
    invalidatedDecisions.push({
      ...prior,
      invalidatedAt,
      invalidationReason: queued ? "current_queue_asset_not_generated" : "source_not_in_current_repair_queue",
    });
    invalidated += 1;
  }
  let added = 0;
  let updated = 0;
  for (const entry of queueEntries) {
    if (!isGeneratedCandidate(entry)) continue;
    if (rejected.has(normalize(entry.generatedAssetPath))) continue;
    if (!await usableFile(resolve(rootDir, normalize(entry.generatedAssetPath)))) continue;
    const decisionKey = key(entry);
    if (existing.has(decisionKey)) {
      const prior = existing.get(decisionKey);
      // Keep the draft identity/review notes, but point it at the newest
      // generated candidate for this exact held source. This matters when a
      // manual native Image Gen edit supersedes an older unapproved asset.
      if (normalize(prior.generatedAssetPath) !== normalize(entry.generatedAssetPath)) {
        existing.set(decisionKey, {
          ...prior,
          generatedAssetPath: entry.generatedAssetPath,
          reviewStatus: "generated_pending_chatgpt_review",
          notApprovedForUpload: true,
        });
        updated += 1;
      }
      continue;
    }
    existing.set(decisionKey, {
      productId: entry.productId,
      sourceProductId: entry.sourceProductId,
      handle: entry.handle,
      title: entry.title,
      heldSourceImageUrl: entry.heldSourceImageUrl,
      generatedAssetPath: entry.generatedAssetPath,
      action: "recreate_candidate",
      reasonCode: entry.reasonCode,
      productIdentityPreserved: entry.productIdentityPreserved,
      identityReviewNote: entry.identityReviewNote,
      reviewNote: entry.identityReviewNote,
      alt: `${entry.title} on a clean VS Store studio background`,
      reviewStatus: "generated_pending_chatgpt_review",
      notApprovedForUpload: true,
    });
    added += 1;
  }
  if (!added && !updated && !invalidated) {
    process.stdout.write(`Future Light Image Gen draft sync: no new generated candidates; ${(current.decisions || []).length} existing candidate(s) retained.\n`);
    return;
  }
  const output = {
    ...current,
    status: "draft_not_applied",
    repairPlanFingerprint: queue.repairPlanFingerprint,
    updatedAt: new Date().toISOString(),
    decisions: [...existing.values()].sort((left, right) => key(left).localeCompare(key(right))),
    invalidatedDecisions,
  };
  await writeJson(draftPath, output);
  process.stdout.write(`Future Light Image Gen draft sync: added ${added}, updated ${updated}, invalidated ${invalidated} stale candidate(s); ${output.decisions.length} remain unapproved pending ChatGPT visual review.\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
