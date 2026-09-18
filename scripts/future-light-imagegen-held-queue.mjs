#!/usr/bin/env node

/*
 * Prepare the native Image Gen work queue for the held Future Light images.
 *
 * This is deliberately a preparation step only. It downloads the exact
 * ChatGPT-reviewed source assets into tmp/imagegen, records one immutable
 * prompt per held source, and reports whether a generated asset is ready for
 * visual review. It never calls an image model, changes Shopify, or approves
 * a replacement. Source-review-required holds are never placed in the
 * generation queue.
 */

import { createHash } from "node:crypto";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

const rootDir = resolve(import.meta.dirname, "..");
const reviewDir = resolve(rootDir, "output", "future-light-visual-review");
const planPath = resolve(reviewDir, "held-image-repair-plan.json");
const progressPath = resolve(reviewDir, "chatgpt-review-progress.json");
const queuePath = resolve(rootDir, "output", "imagegen", "future-light", "held-repair-queue.json");
const generationStatePath = resolve(rootDir, "output", "imagegen", "future-light", "generation-state.json");
const sourceRoot = resolve(rootDir, "tmp", "imagegen", "future-light-held");
const targetStoreDomain = "vs-future-store-0jl2t-jxu6tnr3.myshopify.com";
const maxAttempts = 4;
const maxConcurrency = 8;

function normalize(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }

function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 20);
}

function safeExtension(url) {
  try {
    const extension = extname(new URL(url).pathname).toLowerCase();
    return [".jpg", ".jpeg", ".png", ".webp"].includes(extension) ? extension : ".img";
  } catch {
    return ".img";
  }
}

function imageKey(handle, url) { return `${normalize(handle)}|${normalize(url)}`; }

function isRetryableError(error) {
  return /408|429|5\d\d|abort|timeout|timed out|network|socket|dns|enotfound|eai_again|temporar|unavailable|gateway/i.test(normalize(error?.message || error));
}

function errorMessage(error) {
  return normalize(error?.message || error).replace(/https?:\/\/\S+/gi, "[source-url]").slice(0, 300);
}

async function readJson(path, fallback = null) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return fallback; throw error; }
}

function parseEnvValue(value) {
  const trimmed = String(value || "").trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed.replace(/\s+#.*$/, "");
}

async function loadLocalImageGenConfig() {
  for (const file of [resolve(rootDir, ".env.local"), resolve(rootDir, ".env.release.local")]) {
    let raw;
    try { raw = await readFile(file, "utf8"); }
    catch (error) { if (error?.code === "ENOENT") continue; throw error; }
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match && match[1] === "OPENAI_API_KEY" && process.env.OPENAI_API_KEY === undefined) process.env.OPENAI_API_KEY = parseEnvValue(match[2]);
    }
  }
}

async function writeJson(path, value) {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function usableFile(path) {
  try {
    const info = await stat(path);
    return info.isFile() && info.size >= 512;
  } catch {
    return false;
  }
}

async function downloadSource(url, outputPath) {
  if (await usableFile(outputPath)) return { status: "source_ready", sourcePath: outputPath };
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000), headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8" } });
      if (!response.ok) throw new Error(`source download HTTP ${response.status}`);
      const contentType = normalize(response.headers.get("content-type"));
      if (contentType && !/^image\//i.test(contentType)) throw new Error(`source download returned ${contentType}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 512) throw new Error("source download returned an unexpectedly small file");
      await writeFile(outputPath, bytes);
      return { status: "source_ready", sourcePath: outputPath };
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error) || attempt === maxAttempts) break;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, Math.min(8_000, 750 * 2 ** (attempt - 1))));
    }
  }
  return { status: "waiting_for_network", sourcePath: outputPath, error: errorMessage(lastError) || "source download failed" };
}

function rejectedAssets(progress) {
  return new Set((progress?.entries || []).flatMap((entry) => (entry.reviewedMedia || [])
    .filter((media) => media?.status === "rejected" || media?.decision === "rejected-generated-asset" || media?.notApprovedForUpload === true)
    .map((media) => normalize(media.generatedAssetPath))
    .filter(Boolean)));
}

function rejectedAssetTimes(progress) {
  const times = new Map();
  for (const entry of progress?.entries || []) {
    for (const media of entry.reviewedMedia || []) {
      if (!(media?.status === "rejected" || media?.decision === "rejected-generated-asset" || media?.notApprovedForUpload === true)) continue;
      const generatedAssetPath = normalize(media.generatedAssetPath);
      const reviewedAt = Date.parse(media.reviewedAt || "");
      if (!generatedAssetPath || !Number.isFinite(reviewedAt)) continue;
      times.set(generatedAssetPath, Math.max(times.get(generatedAssetPath) || 0, reviewedAt));
    }
  }
  return times;
}

function approvedAssets(progress) {
  return new Set((progress?.entries || []).flatMap((entry) => (entry.reviewedMedia || [])
    .filter((media) => media?.status === "approved" && media?.decision === "approved-generated-asset" && media?.notApprovedForUpload === false)
    .map((media) => normalize(media.generatedAssetPath))
    .filter(Boolean)));
}

async function mapWithConcurrency(items, worker, concurrency) {
  const output = new Array(items.length);
  let nextIndex = 0;
  async function runWorker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, () => runWorker()));
  return output;
}

async function main() {
  await loadLocalImageGenConfig();
  const [plan, progress] = await Promise.all([readJson(planPath), readJson(progressPath)]);
  if (!plan) throw new Error("Held-image repair plan is missing; run shopify:images:recreate:draft:plan first.");
  if (plan.targetStoreDomain !== targetStoreDomain) throw new Error("Refused to prepare an Image Gen queue for a non-Future Light Store target.");
  const candidates = Array.isArray(plan.replacementCandidates) ? plan.replacementCandidates : [];
  const sourceReview = Array.isArray(plan.sourceReviewRequired) ? plan.sourceReviewRequired : [];
  if (candidates.length + sourceReview.length !== Number(plan.summary?.heldImages)) {
    throw new Error("Held-image plan counts do not reconcile; no Image Gen queue was written.");
  }

  await mkdir(sourceRoot, { recursive: true });
  const rejected = rejectedAssets(progress);
  const rejectedAt = rejectedAssetTimes(progress);
  const approved = approvedAssets(progress);
  const queueEntries = await mapWithConcurrency(candidates, async (candidate) => {
    const jobId = `held-${digest(`${candidate.productId}|${candidate.handle}|${candidate.heldSourceImageUrl}|${candidate.prompt}`)}`;
    const sourcePath = resolve(sourceRoot, `${jobId}${safeExtension(candidate.heldSourceImageUrl)}`);
    const source = await downloadSource(candidate.heldSourceImageUrl, sourcePath);
    const generatedAssetPath = normalize(candidate.generatedAssetPath);
    const generatedAbsolutePath = resolve(rootDir, generatedAssetPath);
    const generated = await usableFile(generatedAbsolutePath);
    const generatedInfo = generated ? await stat(generatedAbsolutePath) : null;
    const regeneratedAfterRejection = generated
      && rejected.has(generatedAssetPath)
      && Number(generatedInfo?.mtimeMs || 0) > Number(rejectedAt.get(generatedAssetPath) || 0);
    let status = source.status === "source_ready" ? "ready_for_native_imagegen" : source.status;
    if (generated && approved.has(generatedAssetPath)) status = "generated_approved_for_mapping";
    else if (generated && (!rejected.has(generatedAssetPath) || regeneratedAfterRejection)) status = "generated_pending_chatgpt_review";
    if (rejected.has(generatedAssetPath) && !regeneratedAfterRejection) status = "generated_asset_rejected";
    return {
      jobId,
      productId: candidate.productId,
      sourceProductId: candidate.sourceProductId,
      handle: candidate.handle,
      title: candidate.title,
      heldSourceImageUrl: candidate.heldSourceImageUrl,
      sourcePath,
      generatedAssetPath,
      prompt: candidate.prompt,
      reasonCode: candidate.reasonCode,
      productIdentityPreserved: candidate.productIdentityPreserved === true,
      identityReviewNote: candidate.identityReviewNote,
      applyPolicy: candidate.applyPolicy,
      sourceStatus: source.status,
      generatedAssetPresent: generated && (!rejected.has(generatedAssetPath) || regeneratedAfterRejection),
      status,
      error: source.error || (rejected.has(generatedAssetPath) ? "generated asset was explicitly rejected by ChatGPT visual review" : null),
    };
  }, maxConcurrency);

  const counts = {
    held: candidates.length + sourceReview.length,
    identitySafeCandidates: candidates.length,
    sourceReviewRequired: sourceReview.length,
    sourceReady: queueEntries.filter((entry) => entry.sourceStatus === "source_ready").length,
    waitingForNetwork: queueEntries.filter((entry) => entry.status === "waiting_for_network").length,
    readyForNativeImageGen: queueEntries.filter((entry) => entry.status === "ready_for_native_imagegen").length,
    generatedPendingChatGptReview: queueEntries.filter((entry) => entry.status === "generated_pending_chatgpt_review").length,
    generatedApprovedForMapping: queueEntries.filter((entry) => entry.status === "generated_approved_for_mapping").length,
    rejectedGeneratedAssets: queueEntries.filter((entry) => entry.status === "generated_asset_rejected").length,
  };
  const status = counts.waitingForNetwork > 0
    ? "waiting_for_network"
    : counts.readyForNativeImageGen > 0
      ? "ready_for_native_imagegen"
    : counts.generatedPendingChatGptReview > 0
      ? "generated_pending_chatgpt_review"
      : counts.generatedApprovedForMapping > 0
        ? "complete_pending_live_apply"
        : "complete_pending_visual_approval";
  const payload = {
    schemaVersion: "2026-09-17.future-light-held-native-imagegen-queue.1",
    targetStoreDomain,
    repairPlanFingerprint: plan.queueFingerprint,
    status,
    liveMutation: false,
    approvalCreated: false,
    imageModel: "gpt-image-1.5 via native Image Gen",
    openAIKeyConfigured: Boolean(normalize(process.env.OPENAI_API_KEY)),
    sourceRoot,
    policy: {
      source: "ChatGPT visual holds and current held-image repair plan only",
      goodImagesRemainUntouched: true,
      sourceReviewHoldsNeverGenerate: true,
      generatedAssetsNeedFreshChatGptVisualReview: true,
      noShopifyMutation: true,
      noSALTAccess: true,
    },
    counts,
    sourceReviewRequired: sourceReview.map((entry) => ({
      productId: entry.productId,
      handle: entry.handle,
      heldSourceImageUrl: entry.heldSourceImageUrl,
      reasonCode: entry.reasonCode,
      reviewNote: entry.reviewNote,
      status: "source_review_required",
    })),
    entries: queueEntries,
    createdAt: new Date().toISOString(),
  };
  await writeJson(queuePath, payload);
  const priorGenerationState = await readJson(generationStatePath, {});
  const nextGenerationState = {
    ...priorGenerationState,
    schemaVersion: "2026-09-17.future-light-held-imagegen-run.1",
    targetStoreDomain,
    queueFingerprint: payload.repairPlanFingerprint,
    status: !payload.openAIKeyConfigured
      ? "waiting_for_imagegen_key"
      : counts.waitingForNetwork > 0
        ? "waiting_for_network"
        : counts.readyForNativeImageGen > 0
          ? "ready_for_native_imagegen"
          : counts.generatedPendingChatGptReview > 0
            ? "generated_pending_chatgpt_review"
            : "complete_pending_visual_approval",
    counts,
    liveMutation: false,
    approvalCreated: false,
    openAIKeyConfigured: payload.openAIKeyConfigured,
    updatedAt: new Date().toISOString(),
    message: !payload.openAIKeyConfigured
      ? "Set OPENAI_API_KEY locally in .env.local; no Image Gen model call was attempted."
      : null,
  };
  await writeJson(generationStatePath, nextGenerationState);
  process.stdout.write(`Future Light native Image Gen queue: ${counts.identitySafeCandidates} identity-safe candidate(s), ${counts.sourceReviewRequired} source-review hold(s), ${counts.readyForNativeImageGen} ready, ${counts.generatedPendingChatGptReview} generated-awaiting-review, ${counts.waitingForNetwork} waiting for network. No live mutation.\n`);
  if (!payload.openAIKeyConfigured && counts.readyForNativeImageGen > 0) {
    process.stdout.write("Image Gen remains waiting for a locally configured OPENAI_API_KEY; no model call was made.\n");
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
