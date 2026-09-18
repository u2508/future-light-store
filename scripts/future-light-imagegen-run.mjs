#!/usr/bin/env node

/*
 * Run identity-preserving Image Gen edits for the current Future Light held
 * image queue. This is a resumable candidate-generation stage only: it never
 * approves a replacement, mutates Shopify, or deletes a source image.
 */

import { execFile } from "node:child_process";
import { access, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { recommendedConcurrency, retryDelayMs, sleep } from "./lib/performance-runtime.mjs";

const execFileAsync = promisify(execFile);
const rootDir = resolve(import.meta.dirname, "..");
const queuePath = resolve(rootDir, "output", "imagegen", "future-light", "held-repair-queue.json");
const statePath = resolve(rootDir, "output", "imagegen", "future-light", "generation-state.json");
const lockPath = resolve(rootDir, "output", "imagegen", "future-light", "generation.lock");
const sourceRoot = resolve(rootDir, "tmp", "imagegen", "future-light-held");
const generatedRoot = resolve(rootDir, "output", "imagegen", "future-light");
const targetStoreDomain = "vs-future-store-0jl2t-jxu6tnr3.myshopify.com";
const imageGenScript = resolve(process.env.CODEX_HOME || "/Users/mac/.codex", "skills", "imagegen", "scripts", "image_gen.py");
const maxAttempts = Math.max(1, Math.min(4, Number(process.env.FUTURE_LIGHT_IMAGEGEN_MAX_ATTEMPTS || 3)));
const maxConcurrency = Math.max(1, Math.min(3, Number(process.env.FUTURE_LIGHT_IMAGEGEN_CONCURRENCY || recommendedConcurrency({ kind: "vision", reserve: 1, max: 3 }))));
const transientErrorPattern = /408|429|5\d\d|timeout|timed out|network|socket|dns|enotfound|eai_again|temporar|unavailable|gateway|connection reset|connection refused|fetch failed/i;

function normalize(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }

function safeChildEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^SALT_/i.test(key)));
}

function parseEnvValue(value) {
  const trimmed = String(value || "").trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed.replace(/\s+#.*$/, "");
}

async function loadImageGenEnv() {
  for (const file of [resolve(rootDir, ".env.local"), resolve(rootDir, ".env.release.local")]) {
    let raw;
    try { raw = await readFile(file, "utf8"); }
    catch (error) { if (error?.code === "ENOENT") continue; throw error; }
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || match[1] !== "OPENAI_API_KEY" || process.env.OPENAI_API_KEY !== undefined) continue;
      process.env.OPENAI_API_KEY = parseEnvValue(match[2]);
    }
  }
}

async function readJson(path, fallback = null) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return fallback; throw error; }
}

async function writeJson(path, value) {
  await mkdir(resolve(path, ".."), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

async function usableFile(path) {
  try {
    const info = await stat(path);
    return info.isFile() && info.size >= 512;
  } catch {
    return false;
  }
}

function errorMessage(error) {
  return normalize(error?.stderr || error?.message || error).replace(/https?:\/\/\S+/gi, "[redacted-url]").slice(0, 500);
}

function isTransient(error) { return transientErrorPattern.test(errorMessage(error)); }

function within(path, parent) {
  const resolvedPath = resolve(path);
  const resolvedParent = resolve(parent);
  return resolvedPath === resolvedParent || resolvedPath.startsWith(`${resolvedParent}/`);
}

function assertQueuePath(path, parent, label) {
  if (!within(path, parent)) throw new Error(`${label} is outside the Future Light image root`);
}

function generationPrompt(entry) {
  return [
    normalize(entry.prompt),
    "",
    "This is a candidate for a product listing, not an approved asset.",
    "Use the supplied source image as the identity reference with high fidelity.",
    "Preserve the exact product and exact variant shown; change only the documented presentation defect.",
    "Do not substitute another product, color, pattern, size, connector, accessory, model, or packaging.",
    "Do not invent or remove physical product markings. Remove only external supplier overlays, promotional panels, shipping claims, or watermarks when the source clearly shows them.",
    "If exact identity cannot be preserved, the result must not be used.",
  ].join("\n");
}

function emptyState(queue) {
  return {
    schemaVersion: "2026-09-17.future-light-held-imagegen-run.1",
    targetStoreDomain,
    queueFingerprint: queue.queueFingerprint,
    status: "ready_for_native_imagegen",
    liveMutation: false,
    approvalCreated: false,
    imageModel: "gpt-image-1.5 via bundled Image Gen CLI",
    concurrency: maxConcurrency,
    maxAttempts,
    counts: queue.counts,
    entries: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function acquireLock() {
  await mkdir(resolve(lockPath, ".."), { recursive: true });
  try {
    await mkdir(lockPath);
    await writeFile(join(lockPath, "owner.json"), `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`, "utf8");
    return;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const owner = await readJson(join(lockPath, "owner.json"));
  if (owner?.pid) {
    try {
      process.kill(Number(owner.pid), 0);
      throw new Error(`Another Future Light Image Gen run is active (pid ${owner.pid})`);
    } catch (error) {
      if (error?.message?.startsWith("Another Future Light")) throw error;
    }
  }
  await rm(lockPath, { recursive: true, force: true });
  await mkdir(lockPath);
  await writeFile(join(lockPath, "owner.json"), `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`, "utf8");
}

async function releaseLock() { await rm(lockPath, { recursive: true, force: true }); }

function queueCounts(queue) {
  const entries = Array.isArray(queue.entries) ? queue.entries : [];
  return {
    held: Number(queue.counts?.held || entries.length + (queue.sourceReviewRequired || []).length),
    identitySafeCandidates: Number(queue.counts?.identitySafeCandidates || entries.length),
    sourceReviewRequired: Number(queue.counts?.sourceReviewRequired || (queue.sourceReviewRequired || []).length),
    sourceReady: Number(queue.counts?.sourceReady || entries.filter((entry) => entry.sourceStatus === "source_ready").length),
    waitingForNetwork: entries.filter((entry) => entry.status === "waiting_for_network").length,
    readyForNativeImageGen: entries.filter((entry) => entry.status === "ready_for_native_imagegen").length,
    generatedPendingChatGptReview: entries.filter((entry) => entry.status === "generated_pending_chatgpt_review").length,
    rejectedGeneratedAssets: entries.filter((entry) => entry.status === "generated_asset_rejected").length,
    generationFailed: entries.filter((entry) => entry.status === "generation_failed").length,
  };
}

async function runEdit(entry, promptDir) {
  const sourcePath = resolve(rootDir, normalize(entry.sourcePath));
  const outputPath = resolve(rootDir, normalize(entry.generatedAssetPath));
  assertQueuePath(sourcePath, sourceRoot, "Source image");
  assertQueuePath(outputPath, generatedRoot, "Generated asset");
  if (!(await usableFile(sourcePath))) throw new Error(`source image is missing or too small: ${sourcePath}`);
  if (await usableFile(outputPath)) return { status: "generated_pending_chatgpt_review", generatedAt: new Date().toISOString(), attempts: 0 };

  const promptPath = resolve(promptDir, `${entry.jobId}.txt`);
  await writeFile(promptPath, generationPrompt(entry), "utf8");
  let lastError;
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await execFileAsync("python3", [
          imageGenScript,
          "edit",
          "--image", sourcePath,
          "--prompt-file", promptPath,
          "--model", "gpt-image-1.5",
          "--size", "1536x1024",
          "--quality", "high",
          "--input-fidelity", "high",
          "--output-format", "png",
          "--out", outputPath,
          "--no-augment",
        ], {
          cwd: rootDir,
          env: safeChildEnv(),
          timeout: 900_000,
          maxBuffer: 2 * 1024 * 1024,
        });
        if (!(await usableFile(outputPath))) throw new Error("Image Gen completed without a usable output file");
        return { status: "generated_pending_chatgpt_review", generatedAt: new Date().toISOString(), attempts: attempt };
      } catch (error) {
        lastError = error;
        if (!isTransient(error) || attempt === maxAttempts) break;
        await sleep(retryDelayMs({ attempt: attempt - 1, baseMs: 3_000, maxMs: 30_000, jitterMs: 500 }));
      }
    }
  } finally {
    await rm(promptPath, { force: true });
  }
  return {
    status: isTransient(lastError) ? "waiting_for_network" : "generation_failed",
    error: errorMessage(lastError),
    attempts: maxAttempts,
  };
}

async function mapWithConcurrency(items, worker) {
  const result = new Array(items.length);
  let next = 0;
  async function runWorker() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      result[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(maxConcurrency, items.length || 1) }, runWorker));
  return result;
}

async function main() {
  await loadImageGenEnv();
  const queue = await readJson(queuePath);
  if (!queue) throw new Error("Held Image Gen queue is missing; run shopify:images:recreate:queue first.");
  if (queue.targetStoreDomain !== targetStoreDomain) throw new Error("Refused Image Gen work for a non-Future Light Store target.");
  if (queue.liveMutation || queue.approvalCreated) throw new Error("Refused a queue that claims live mutation or approval was already created.");

  const args = new Set(process.argv.slice(2));
  const state = { ...(await readJson(statePath, emptyState(queue)) || emptyState(queue)), queueFingerprint: queue.queueFingerprint, targetStoreDomain };
  state.entries ||= {};
  const candidates = (queue.entries || []).filter((entry) => entry.productIdentityPreserved === true && entry.status === "ready_for_native_imagegen");
  const counts = queueCounts(queue);

  if (args.has("--check-config")) {
    await access(imageGenScript);
    process.stdout.write(`Future Light Image Gen config: key=${Boolean(normalize(process.env.OPENAI_API_KEY)) ? "configured" : "missing"}, script=ready, candidates=${candidates.length}, concurrency=${maxConcurrency}.\n`);
    return;
  }
  if (args.has("--dry-run")) {
    process.stdout.write(`Future Light Image Gen dry-run: ${candidates.length} identity-safe edit(s) would run at high quality with input fidelity high; ${counts.sourceReviewRequired} source-review hold(s) remain excluded. No model call or live mutation.\n`);
    return;
  }

  state.updatedAt = new Date().toISOString();
  state.counts = counts;
  state.openAIKeyConfigured = Boolean(normalize(process.env.OPENAI_API_KEY));
  state.liveMutation = false;
  state.approvalCreated = false;
  if (!state.openAIKeyConfigured) {
    state.status = "waiting_for_imagegen_key";
    state.message = "Set OPENAI_API_KEY locally in .env.local; no Image Gen model call was attempted.";
    await writeJson(statePath, state);
    process.stdout.write(`Future Light Image Gen: ${candidates.length} candidate(s) waiting for a locally configured OPENAI_API_KEY. No model call or live mutation.\n`);
    return;
  }

  await access(imageGenScript);
  await acquireLock();
  try {
    const promptDir = resolve(rootDir, "tmp", "imagegen", "future-light-prompts");
    await mkdir(promptDir, { recursive: true });
    state.status = "running";
    state.startedAt = state.startedAt || new Date().toISOString();
    await writeJson(statePath, state);

    const results = await mapWithConcurrency(candidates, async (entry) => {
      const startedAt = new Date().toISOString();
      state.entries[entry.jobId] = { jobId: entry.jobId, handle: entry.handle, productId: entry.productId, status: "running", startedAt };
      await writeJson(statePath, state);
      const result = await runEdit(entry, promptDir);
      state.entries[entry.jobId] = { ...state.entries[entry.jobId], ...result, finishedAt: new Date().toISOString() };
      await writeJson(statePath, state);
      return { entry, result };
    });

    const resultByJob = new Map(results.map(({ entry, result }) => [entry.jobId, result]));
    const nextEntries = (queue.entries || []).map((entry) => {
      const result = resultByJob.get(entry.jobId);
      if (!result) return entry;
      return {
        ...entry,
        status: result.status,
        generatedAssetPresent: result.status === "generated_pending_chatgpt_review",
        generatedAt: result.generatedAt || entry.generatedAt || null,
        generationAttempts: result.attempts || entry.generationAttempts || 0,
        error: result.error || null,
      };
    });
    const nextQueue = {
      ...queue,
      entries: nextEntries,
      counts: queueCounts({ ...queue, entries: nextEntries }),
      status: "updated_after_native_imagegen",
      updatedAt: new Date().toISOString(),
      liveMutation: false,
      approvalCreated: false,
    };
    await writeJson(queuePath, nextQueue);
    state.status = nextQueue.counts.waitingForNetwork > 0
      ? "waiting_for_network"
      : nextQueue.counts.generationFailed > 0
        ? "generation_failed"
        : nextQueue.counts.readyForNativeImageGen > 0
          ? "ready_for_native_imagegen"
          : "generated_pending_chatgpt_review";
    state.counts = nextQueue.counts;
    state.updatedAt = new Date().toISOString();
    await writeJson(statePath, state);
    process.stdout.write(`Future Light Image Gen: ${nextQueue.counts.generatedPendingChatGptReview} generated candidate(s) awaiting fresh ChatGPT review, ${nextQueue.counts.readyForNativeImageGen} remaining, ${nextQueue.counts.waitingForNetwork} waiting for network, ${nextQueue.counts.sourceReviewRequired} source-review hold(s) excluded. No Shopify mutation.\n`);
    if (nextQueue.counts.waitingForNetwork > 0 || nextQueue.counts.generationFailed > 0) process.exitCode = 1;
  } finally {
    await releaseLock();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
