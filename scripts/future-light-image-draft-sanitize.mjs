#!/usr/bin/env node

/*
 * Remove only stale/unsafe Image Gen candidates from the active draft. The
 * original decisions are retained under invalidatedDecisions for auditability;
 * nothing is uploaded, deleted from Shopify, or promoted to approval here.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dirname, "..");
const draftPath = resolve(rootDir, "output", "imagegen", "future-light", "replacement-decisions-draft.json");
const planPath = resolve(rootDir, "output", "future-light-visual-review", "held-image-repair-plan.json");
const targetStoreDomain = "vs-future-store-0jl2t-jxu6tnr3.myshopify.com";

function normalize(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function key(item) { return `${normalize(item.handle)}|${normalize(item.heldSourceImageUrl)}`; }

async function readJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

async function main() {
  const [draft, plan] = await Promise.all([readJson(draftPath), readJson(planPath)]);
  if (!draft) {
    process.stdout.write("Future Light Image Gen draft sanitize: no draft present; no change made.\n");
    return;
  }
  if (!plan) throw new Error("Held-image repair plan is required before sanitizing the active Image Gen draft.");
  if (draft.targetStoreDomain !== targetStoreDomain || plan.targetStoreDomain !== targetStoreDomain) {
    throw new Error("Refused to sanitize a non-Future Light Store Image Gen draft.");
  }
  const sourceReview = new Map((plan.sourceReviewRequired || []).map((item) => [key(item), item]));
  const active = [];
  const invalidated = [...(draft.invalidatedDecisions || [])];
  for (const decision of draft.decisions || []) {
    const hold = sourceReview.get(key(decision));
    if (!hold) {
      active.push(decision);
      continue;
    }
    invalidated.push({
      ...decision,
      invalidatedAt: new Date().toISOString(),
      invalidationReason: "current-held-image-repair-plan-requires-source-review",
      sourceReviewReason: hold.reviewNote,
      notApprovedForUpload: true,
    });
  }
  if (active.length === (draft.decisions || []).length) {
    process.stdout.write(`Future Light Image Gen draft sanitize: no stale candidates found; ${active.length} active candidate(s) retained.\n`);
    return;
  }
  const output = {
    ...draft,
    decisions: active,
    invalidatedDecisions: invalidated,
    repairPlanFingerprint: plan.queueFingerprint,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(draftPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  process.stdout.write(`Future Light Image Gen draft sanitized: removed ${draft.decisions.length - active.length} unsafe stale candidate(s); ${active.length} active candidate(s) retained for later review.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
