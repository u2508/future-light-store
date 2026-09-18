#!/usr/bin/env node

/* Persist only an explicit ChatGPT visual decision. This helper never guesses
 * labels, variant mappings, or image replacements; it records a batch that was
 * actually inspected in the local visual evidence viewer. */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dirname, "..");
const queuePath = resolve(rootDir, "output", "future-light-visual-review", "queue.json");
const decisionsPath = resolve(rootDir, "output", "future-light-visual-review", "chatgpt-image-decisions.json");
const lockPath = resolve(rootDir, "output", "future-light-visual-review", "record.lock");
const targetStoreDomain = "vs-future-store-0jl2t-jxu6tnr3.myshopify.com";

function normalize(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function imageKey(handle, imageUrl) { return `${normalize(handle)}|${normalize(imageUrl)}`; }
function parseArgs(argv = process.argv.slice(2)) {
  const value = (name, fallback = null) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : fallback;
  };
  return {
    offset: Math.max(0, Number(value("--offset", "0"))),
    limit: Math.max(1, Math.min(24, Number(value("--limit", "24")))),
    action: normalize(value("--action", "keep")),
    note: normalize(value("--note", "")),
    reasonCode: normalize(value("--reason-code", "")),
    holdReason: normalize(value("--hold-reason", "")),
    generatedAssetPath: normalize(value("--generated-asset", "")),
    sourceProductId: normalize(value("--source-product-id", "")),
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

function canMigrateImageDecisions(prior, queue) {
  const queued = new Map((queue.imageEntries || []).map((entry) => [imageKey(entry.handle, entry.imageUrl), entry]));
  const reviewed = [...(prior.entries || []), ...(prior.holds || [])];
  if (!reviewed.length) return true;
  return reviewed.every((entry) => {
    const current = queued.get(imageKey(entry.handle, entry.imageUrl));
    return Boolean(current && normalize(current.productId) === normalize(entry.productId));
  });
}

async function run() {
  const args = parseArgs();
  if (!["keep", "recreate", "hold"].includes(args.action)) throw new Error("Decision action must be keep, recreate, or hold.");
  if (!args.note || args.note.length < 20) throw new Error("A substantive visual review note is required.");
  if (args.action === "recreate" && (!args.reasonCode || !args.generatedAssetPath || !args.sourceProductId || args.identityNote.length < 30)) {
    throw new Error("Recreate requires --reason-code, --generated-asset, --source-product-id, and an identity note of at least 30 characters.");
  }
  if (args.action === "hold" && args.holdReason.length < 10) {
    throw new Error("Hold requires --hold-reason explaining the identity or safety issue.");
  }
  const queue = await readJson(queuePath);
  if (!queue || queue.targetStoreDomain !== targetStoreDomain) throw new Error("Queue is missing or targets a non-Future Light Store.");
  const sourceEntries = (queue.imageEntries || []).slice(args.offset, args.offset + args.limit);
  if (!sourceEntries.length) throw new Error(`No image entries at offset ${args.offset}.`);
  const prior = await readJson(decisionsPath, {
    schemaVersion: "2026-09-16.future-light-chatgpt-image-decisions.1",
    targetStoreDomain,
    queueFingerprint: queue.queueFingerprint,
    entries: [],
    holds: [],
  });
  if (prior.targetStoreDomain !== targetStoreDomain) {
    throw new Error("Existing ChatGPT image decisions target a different store; review cannot be migrated.");
  }
  if (prior.queueFingerprint !== queue.queueFingerprint) {
    const previousQueueFingerprint = prior.queueFingerprint;
    if (!canMigrateImageDecisions(prior, queue)) {
      throw new Error("Existing ChatGPT image decisions do not match the current queue fingerprint; refresh and review again.");
    }
    prior.queueFingerprint = queue.queueFingerprint;
    prior.migration = {
      ...(prior.migration || {}),
      fromQueueFingerprint: prior.migration?.fromQueueFingerprint || previousQueueFingerprint,
      migratedAt: new Date().toISOString(),
      method: "exact-handle-image-url-and-product-id-match",
    };
  }
  const decisions = new Map((prior.entries || []).map((entry) => [imageKey(entry.handle, entry.imageUrl), entry]));
  const holds = new Map((prior.holds || []).map((entry) => [imageKey(entry.handle, entry.imageUrl), entry]));
  const reviewedAt = new Date().toISOString();
  for (const entry of sourceEntries) {
    if (args.action === "hold") {
      holds.set(imageKey(entry.handle, entry.imageUrl), {
        productId: entry.productId,
        handle: entry.handle,
        title: entry.title,
        imageUrl: entry.imageUrl,
        action: "hold",
        reviewedBy: "ChatGPT",
        reviewMethod: "internal-browser-contact-sheet",
        reviewedAt,
        holdReason: args.holdReason,
        visualNote: args.note,
      });
      decisions.delete(imageKey(entry.handle, entry.imageUrl));
      continue;
    }
    const decision = {
      productId: entry.productId,
      handle: entry.handle,
      title: entry.title,
      imageUrl: entry.imageUrl,
      action: "keep",
      reviewedBy: "ChatGPT",
      reviewMethod: "internal-browser-contact-sheet",
      reviewedAt,
      visualNote: args.note,
    };
    if (args.action === "recreate") Object.assign(decision, {
      reasonCode: args.reasonCode,
      reviewNote: args.note,
      sourceProductId: args.sourceProductId,
      productIdentityPreserved: true,
      identityReviewNote: args.identityNote,
      generatedAssetPath: args.generatedAssetPath,
    });
    decisions.set(imageKey(entry.handle, entry.imageUrl), decision);
    holds.delete(imageKey(entry.handle, entry.imageUrl));
  }
  const entries = [...decisions.values()].sort((left, right) => `${left.handle}|${left.imageUrl}`.localeCompare(`${right.handle}|${right.imageUrl}`));
  const heldEntries = [...holds.values()].sort((left, right) => `${left.handle}|${left.imageUrl}`.localeCompare(`${right.handle}|${right.imageUrl}`));
  const output = {
    ...prior,
    updatedAt: reviewedAt,
    entries,
    holds: heldEntries,
    summary: { reviewed: decisions.size, held: holds.size, pending: Math.max(0, (queue.imageEntries || []).length - decisions.size) },
  };
  await writeJson(decisionsPath, output);
  process.stdout.write(`Recorded ${sourceEntries.length} explicit ${args.action} decision(s); ${output.summary.reviewed} approved, ${output.summary.held || 0} held, ${output.summary.pending} pending.\n`);
}
async function main() {
  try {
    await mkdir(lockPath);
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("Another visual decision recorder is active; run batches sequentially.");
    throw error;
  }
  try { await run(); }
  finally { await rm(lockPath, { recursive: true, force: true }); }
}
main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
