#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const rootDir = resolve(import.meta.dirname, "..");
const execFileAsync = promisify(execFile);
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const reviewManifestPath = resolve(rootDir, "output", "catalog-image-review", "review-manifest.json");
const integrityManifestPath = resolve(rootDir, "output", "shopify-catalog-integrity-manifest.json");
const autoManifestPath = resolve(rootDir, "output", "catalog-visual-review-auto-manifest.json");
const maxAttempts = Math.max(1, Math.min(8, Number(process.env.SALT_CATALOG_AUTO_VISUAL_REVIEW_ATTEMPTS || 4)));
const batchSize = Math.max(1, Math.min(1000, Number(process.env.SALT_CATALOG_BATCH_SIZE || 50)));
const retryDelayMs = Math.max(250, Number(process.env.SALT_CATALOG_AUTO_VISUAL_REVIEW_RETRY_MS || 2_000));

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
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

async function writeLiveReconciledCompletion(finalSnapshot, staleLocalPending = 0, attempts = []) {
  const manifest = {
    status: "completed",
    policy: "Supervised image evidence only; live Shopify classification-review readback is authoritative. Stale local queue entries are reconciled only when live review remaining is zero and no no-image blockers exist.",
    staleLocalPendingReconciled: staleLocalPending,
    attempts,
    final: finalSnapshot,
    completedAt: new Date().toISOString(),
  };
  await writeFile(autoManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(
    `Automatic visual review passed on live readback: zero live review items remain; reconciled ${staleLocalPending} stale local queue item(s).\n`,
  );
}

async function runGuardedVisualClassification() {
  await execFileAsync(npmBin, [
    "run",
    "shopify:catalog-integrity:apply",
    "--",
    "--review-only",
    "--reclassify",
    "--supervised-vision",
    "--batch-size",
    String(batchSize),
  ], {
    cwd: rootDir,
    env: { ...process.env, SALT_CATALOG_VISION_SUPERVISED: "1" },
    maxBuffer: 40 * 1024 * 1024,
  });
}

function snapshot(review, integrity) {
  const summary = integrity?.summary || {};
  return {
    at: new Date().toISOString(),
    localPending: Number(review?.summary?.pending || 0),
    localNoImageBlockers: Number(review?.summary?.blockedNoImage || 0),
    liveClassificationReviewRemaining: Number(summary.classificationReviewRemaining || 0),
    liveVisionClassified: Number(summary.visionClassified || 0),
    liveApprovedOverrides: Number(summary.approvedOverrides || 0),
    failures: Number(summary.failures || 0),
  };
}

function unresolvedHandles(integrity) {
  return (integrity?.classifications || [])
    .filter((entry) => entry?.source === "review")
    .map((entry) => entry.handle || entry.productId)
    .filter(Boolean);
}

async function main() {
  const attempts = [];
  let lastReview = null;
  let lastIntegrity = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await refreshReviewManifest();
    lastReview = await readJson(reviewManifestPath);
    lastIntegrity = await readJson(integrityManifestPath);
    const before = snapshot(lastReview, lastIntegrity);
    process.stdout.write(
      `Automatic visual review attempt ${attempt}/${maxAttempts}: ${before.liveClassificationReviewRemaining} live review item(s), ${before.localPending} local pending item(s).\n`,
    );

    if (before.liveClassificationReviewRemaining === 0 && before.localPending === 0) {
      await writeLiveReconciledCompletion(before, 0, attempts);
      return;
    }

    if (before.liveClassificationReviewRemaining === 0 && before.localPending > 0 && before.localNoImageBlockers === 0) {
      await writeLiveReconciledCompletion({ ...before, localPending: 0 }, before.localPending, attempts);
      return;
    }

    if (before.localNoImageBlockers > 0 && before.liveClassificationReviewRemaining === 0) {
      const manifest = {
        status: "deferred-no-image-cleanup",
        policy: "No-image products remain for the later verified zero-image deletion gate; no classification guess was made.",
        attempts,
        final: before,
        completedAt: new Date().toISOString(),
      };
      await writeFile(autoManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      process.stdout.write("Automatic visual review deferred only verified no-image cleanup to the later release gate.\n");
      return;
    }

    const startedAt = new Date().toISOString();
    try {
      await runGuardedVisualClassification();
      await refreshReviewManifest();
      lastReview = await readJson(reviewManifestPath);
      lastIntegrity = await readJson(integrityManifestPath);
      const after = snapshot(lastReview, lastIntegrity);
      attempts.push({ attempt, startedAt, completedAt: new Date().toISOString(), before, after });
      process.stdout.write(
        `Automatic visual review result ${attempt}/${maxAttempts}: ${after.liveClassificationReviewRemaining} live review item(s), ${after.localPending} local pending item(s).\n`,
      );
      if (after.liveClassificationReviewRemaining === 0 && after.localPending === 0) {
        await writeLiveReconciledCompletion(after, 0, attempts);
        return;
      }
      if (after.liveClassificationReviewRemaining === 0 && after.localPending > 0 && after.localNoImageBlockers === 0) {
        await writeLiveReconciledCompletion({ ...after, localPending: 0 }, after.localPending, attempts);
        return;
      }
    } catch (error) {
      attempts.push({
        attempt,
        startedAt,
        completedAt: new Date().toISOString(),
        before,
        error: error?.message || String(error),
      });
      process.stderr.write(`Automatic visual review attempt ${attempt} failed: ${error?.message || error}\n`);
    }

    if (attempt < maxAttempts) await sleep(retryDelayMs * attempt);
  }

  const final = snapshot(lastReview, lastIntegrity);
  const manifest = {
    status: "blocked",
    policy: "Release remains blocked when supervised visual evidence cannot clear every product; no guessed assignment is permitted.",
    attempts,
    final,
    unresolvedHandles: unresolvedHandles(lastIntegrity),
    blockedAt: new Date().toISOString(),
  };
  await writeFile(autoManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  throw new Error(
    `Automatic visual review exhausted ${maxAttempts} guarded attempt(s); ${final.liveClassificationReviewRemaining} live classification-review product(s) remain. See ${autoManifestPath}.`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message || error}\n`);
  process.exitCode = 1;
});
