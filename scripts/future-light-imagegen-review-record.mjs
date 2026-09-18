#!/usr/bin/env node

/* Record an explicit ChatGPT visual review of a native Image Gen candidate.
 * This is a local evidence step only: it never creates approved-mappings.json,
 * uploads media, deletes source media, or changes Shopify. */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dirname, "..");
const queuePath = resolve(rootDir, "output", "imagegen", "future-light", "held-repair-queue.json");
const progressPath = resolve(rootDir, "output", "future-light-visual-review", "chatgpt-review-progress.json");
const targetStoreDomain = "vs-future-store-0jl2t-jxu6tnr3.myshopify.com";

function normalize(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function parseArgs(argv = process.argv.slice(2)) {
  const value = (name, fallback = null) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : fallback;
  };
  return {
    offset: Math.max(0, Number(value("--offset", "0"))),
    limit: Math.max(1, Math.min(24, Number(value("--limit", "1")))),
    decision: normalize(value("--decision", "")),
    note: normalize(value("--note", "")),
    identityNote: normalize(value("--identity-note", "")),
  };
}

async function readJson(path, fallback = null) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return fallback; throw error; }
}

async function writeJson(path, value) {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function key(entry) { return `${normalize(entry.handle)}|${normalize(entry.heldSourceImageUrl)}|${normalize(entry.generatedAssetPath)}`; }

async function main() {
  const args = parseArgs();
  if (!["approve", "reject"].includes(args.decision)) throw new Error("--decision must be approve or reject.");
  if (args.note.length < 30) throw new Error("A substantive visual review note of at least 30 characters is required.");
  if (args.decision === "approve" && args.identityNote.length < 30) {
    throw new Error("Approve requires an identity note of at least 30 characters explaining why the generated asset preserves the exact product.");
  }
  const queue = await readJson(queuePath);
  if (!queue || queue.targetStoreDomain !== targetStoreDomain) throw new Error("Queue is missing or targets a non-Future Light Store store.");
  const candidates = (queue.entries || []).filter((entry) => entry.status === "generated_pending_chatgpt_review" && entry.generatedAssetPresent === true);
  const selected = candidates.slice(args.offset, args.offset + args.limit);
  if (!selected.length) throw new Error(`No generated candidate at offset ${args.offset}.`);
  const progress = await readJson(progressPath, {
    schemaVersion: "2026-09-16.future-light-chatgpt-review-progress.1",
    targetStoreDomain,
    queueFingerprint: null,
    status: "in-progress-not-approved",
    reviewedBy: "ChatGPT manual visual review",
    entries: [],
  });
  if (progress.targetStoreDomain !== targetStoreDomain) throw new Error("Existing review progress targets another store.");
  const byProduct = new Map((progress.entries || []).map((entry) => [normalize(entry.productId), entry]));
  const reviewedAt = new Date().toISOString();
  for (const candidate of selected) {
    const productId = `gid://shopify/Product/${candidate.productId}`;
    const product = byProduct.get(productId) || {
      productId,
      handle: candidate.handle,
      reviewedMedia: [],
      optionToDesignMapping: { status: "pending", reason: "Generated asset review is separate from final variant mapping." },
    };
    const reviewedMedia = Array.isArray(product.reviewedMedia) ? product.reviewedMedia : [];
    const media = {
      heldSourceImageUrl: candidate.heldSourceImageUrl,
      generatedAssetPath: candidate.generatedAssetPath,
      visualFinding: args.note,
      decision: args.decision === "approve" ? "approved-generated-asset" : "rejected-generated-asset",
      status: args.decision === "approve" ? "approved" : "rejected",
      notApprovedForUpload: args.decision !== "approve",
      reviewedBy: "ChatGPT",
      reviewedAt,
      reviewMethod: "manual source-versus-generated visual inspection",
      ...(args.decision === "approve"
        ? { identityReviewNote: args.identityNote }
        : { rejectionReason: "Generated candidate does not safely preserve the exact source product or variant." }),
    };
    const existingIndex = reviewedMedia.findIndex((item) => key({ handle: product.handle, heldSourceImageUrl: item.heldSourceImageUrl, generatedAssetPath: item.generatedAssetPath }) === key(candidate));
    if (existingIndex >= 0) reviewedMedia[existingIndex] = media;
    else reviewedMedia.push(media);
    product.reviewedMedia = reviewedMedia;
    product.handle ||= candidate.handle;
    byProduct.set(productId, product);
  }
  const output = {
    ...progress,
    queueFingerprint: progress.queueFingerprint || queue.repairPlanFingerprint || null,
    updatedAt: reviewedAt,
    entries: [...byProduct.values()].sort((left, right) => normalize(left.handle).localeCompare(normalize(right.handle))),
  };
  await writeJson(progressPath, output);
  process.stdout.write(`Recorded ${selected.length} explicit Image Gen ${args.decision} review(s); local evidence updated only. No approved mapping or Shopify mutation was created.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
