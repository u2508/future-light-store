#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const rootDir = resolve(import.meta.dirname, "..");
const execFileAsync = promisify(execFile);
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const reviewManifestPath = resolve(rootDir, "output", "catalog-image-review", "review-manifest.json");
const integrityManifestPath = resolve(rootDir, "output", "shopify-catalog-integrity-manifest.json");
const pollMs = Math.max(5_000, Number(process.env.SALT_CATALOG_VISUAL_REVIEW_POLL_MS || 30_000));
const maxWaitMs = Math.max(0, Number(process.env.SALT_CATALOG_VISUAL_REVIEW_MAX_WAIT_MS || 0));

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function refreshReviewManifest() {
  await execFileAsync(npmBin, ["run", "catalog:image-review:build"], {
    cwd: rootDir,
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
}

async function rerunIntegrity() {
  const batchSize = String(Math.max(1, Number(process.env.SALT_CATALOG_BATCH_SIZE || 50)));
  await execFileAsync(npmBin, [
    "run",
    "shopify:catalog-integrity:apply",
    "--",
    "--review-only",
    "--reclassify",
    "--supervised-vision",
    "--batch-size",
    batchSize,
  ], {
    cwd: rootDir,
    env: { ...process.env, SALT_CATALOG_VISION_SUPERVISED: "1" },
    maxBuffer: 30 * 1024 * 1024,
  });
}

async function main() {
  const startedAt = Date.now();
  let firstPass = true;
  while (true) {
    await refreshReviewManifest();
    const review = await readJson(reviewManifestPath);
    const integrity = await readJson(integrityManifestPath);
    const pending = Number(review?.summary?.pending || 0);
    const blockedNoImage = Number(review?.summary?.blockedNoImage || 0);
    const appliedReview = Number(integrity?.summary?.classificationReviewRemaining || 0);
    process.stdout.write(`Visual review gate: ${pending} pending image decision(s), ${blockedNoImage} no-image blocker(s), ${appliedReview} applied classification-review product(s).\n`);

    if (pending === 0 && blockedNoImage > 0) {
      process.stdout.write("Only no-image blockers remain; the later verified zero-image deletion gate will remove them before final completion.\n");
      return;
    }

    if (pending === 0 && appliedReview === 0) {
      process.stdout.write("Visual review gate passed: zero products remain in classification-review.\n");
      return;
    }

    if (pending === 0 && appliedReview > 0) {
      process.stdout.write("Visual decisions are now present; reapplying the guarded classification plan and live readback.\n");
      await rerunIntegrity();
      firstPass = false;
      continue;
    }

    if (maxWaitMs > 0 && Date.now() - startedAt >= maxWaitMs) {
      throw new Error(`Visual review gate timed out after ${maxWaitMs}ms; inspect ${reviewManifestPath} and resume after image decisions are recorded.`);
    }
    if (firstPass) {
      process.stdout.write("Release remains open while visual classification is reviewed. The queue and image links are persisted for Codex review.\n");
      firstPass = false;
    }
    await sleep(pollMs);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message || error}\n`);
  process.exitCode = 1;
});
