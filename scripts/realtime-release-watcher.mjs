#!/usr/bin/env node

import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { COLLECTION_GOVERNANCE_POLICIES } from "../src/lib/catalog-collection-governance.js";
import { createShopifyAdminGraphQLClient } from "./shopify-admin-graphql-client.mjs";
import { readProductCatalogPayload } from "./product-catalog-files.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const outputDir = resolve(rootDir, "output");
const statePath = resolve(outputDir, "realtime-release-watcher-state.json");
const releaseRunStatePath = resolve(outputDir, "release-run-state.json");
const logPath = resolve(outputDir, "realtime-release-watcher.log");
const lockPath = resolve(outputDir, "realtime-release.lock");
const pollIntervalMs = Math.max(60_000, Number(process.env.SALT_RELEASE_WATCHER_POLL_MS || 300_000));
const maxRetryIntervalMs = Math.max(pollIntervalMs, Number(process.env.SALT_RELEASE_WATCHER_MAX_RETRY_MS || 3_600_000));
const releaseStateStaleMs = Math.max(
  pollIntervalMs * 2,
  Number(process.env.SALT_RELEASE_WATCHER_STALE_MS || 900_000),
);
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const client = createShopifyAdminGraphQLClient({ rootDir, agentName: "realtime-release-watcher" });

const WATCH_QUERY = /* GraphQL */ `
  query RealtimeReleaseWatcher {
    products(first: 1, query: "status:active", sortKey: UPDATED_AT, reverse: true) {
      nodes { id handle updatedAt status }
    }
    collections(first: 250) {
      nodes { handle title productsCount { count } }
    }
  }
`;

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function timestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function log(message) {
  await mkdir(outputDir, { recursive: true });
  const line = `[${new Date().toISOString()}] ${message}\n`;
  await appendFile(logPath, line, "utf8");
  process.stdout.write(line);
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeState(state) {
  await mkdir(outputDir, { recursive: true });
  const tempPath = `${statePath}.tmp-${process.pid}`;
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tempPath, statePath);
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopStaleRelease(pid) {
  if (!isProcessAlive(pid) || pid === process.pid) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  await sleep(5_000);
  if (isProcessAlive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The process may have exited between the liveness check and the kill.
    }
  }
}

async function inspectReleaseRun(state) {
  const release = await readJson(releaseRunStatePath, null);
  if (!release?.status) return { active: false, reasons: [] };

  if (release.status === "running") {
    const pid = Number(release.pid || 0);
    const ageMs = Date.now() - timestamp(release.heartbeatAt || release.startedAt);
    if (isProcessAlive(pid) && ageMs <= releaseStateStaleMs) {
      return { active: true, release, reasons: [] };
    }

    if (isProcessAlive(pid) && ageMs > releaseStateStaleMs) {
      await log(`release heartbeat stale for ${Math.round(ageMs / 1000)}s; stopping pid ${pid}`);
      await stopStaleRelease(pid);
    }
    return {
      active: false,
      release,
      reasons: [`previous release interrupted at step ${release.stepIndex || "unknown"}: ${release.stepLabel || "unknown"}`],
    };
  }

  if (release.status === "failed") {
    const successfulAt = timestamp(state?.lastSuccessfulReleaseAt);
    if (timestamp(release.failedAt) > successfulAt) {
      return {
        active: false,
        release,
        reasons: [`previous release failed at step ${release.stepIndex || "unknown"}: ${release.error || "unknown error"}`],
      };
    }
  }

  return { active: false, release, reasons: [] };
}

function governedHandles() {
  return new Set(
    COLLECTION_GOVERNANCE_POLICIES
      .map((policy) => normalize(policy.handle))
      .filter(Boolean),
  );
}

async function readLocalBaseline() {
  const [catalog, collections, recentOrders] = await Promise.all([
    readProductCatalogPayload(resolve(rootDir, "public", "data")),
    readJson(resolve(rootDir, "public", "data", "collections.json"), { collections: [] }),
    readJson(resolve(rootDir, "public", "data", "recently-ordered-products.json"), { products: [] }),
  ]);
  const products = Array.isArray(catalog?.products) ? catalog.products : [];
  const governed = governedHandles();
  const collectionCounts = Object.fromEntries(
    (Array.isArray(collections?.collections) ? collections.collections : [])
      .filter((collection) => governed.has(normalize(collection?.handle)))
      .map((collection) => [normalize(collection.handle), Number(collection.products_count || 0)]),
  );
  const bestsellerFeedCount = Array.isArray(recentOrders?.products) ? recentOrders.products.length : 0;
  if (bestsellerFeedCount > 0) collectionCounts["best-sellers"] = bestsellerFeedCount;
  const latestLocalUpdatedAt = products.reduce(
    (latest, product) => Math.max(latest, timestamp(product?.updated_at || product?.created_at)),
    0,
  );
  return {
    activeProducts: products.length,
    latestLocalUpdatedAt: latestLocalUpdatedAt ? new Date(latestLocalUpdatedAt).toISOString() : "",
    generatedAt: String(catalog?.generatedAt || ""),
    collectionCounts,
  };
}

async function readLiveFingerprint() {
  const payload = await client.run(WATCH_QUERY, {}, { operation: "read realtime release fingerprint" });
  const latestProduct = payload?.products?.nodes?.[0] || null;
  const governed = governedHandles();
  const collectionCounts = Object.fromEntries(
    (Array.isArray(payload?.collections?.nodes) ? payload.collections.nodes : [])
      .filter((collection) => governed.has(normalize(collection?.handle)))
      .map((collection) => [normalize(collection.handle), Number(collection.productsCount?.count || 0)]),
  );
  return {
    latestProductId: String(latestProduct?.id || ""),
    latestProductHandle: String(latestProduct?.handle || ""),
    latestProductUpdatedAt: String(latestProduct?.updatedAt || ""),
    collectionCounts,
    checkedAt: new Date().toISOString(),
  };
}

function detectDrift(baseline, live, state) {
  const reasons = [];
  const baselineUpdatedAt = Math.max(
    timestamp(baseline.latestLocalUpdatedAt),
    timestamp(state?.lastSuccessfulLiveUpdatedAt),
  );
  if (timestamp(live.latestProductUpdatedAt) > baselineUpdatedAt + 1000) {
    reasons.push(`active product changed after baseline (${live.latestProductHandle || live.latestProductId})`);
  }

  const expectedCounts = baseline.collectionCounts || {};
  for (const [handle, actualCount] of Object.entries(live.collectionCounts || {})) {
    if (Object.prototype.hasOwnProperty.call(expectedCounts, handle) && Number(expectedCounts[handle]) !== actualCount) {
      reasons.push(`collection count drift: ${handle} ${expectedCounts[handle]} -> ${actualCount}`);
    }
  }

  const bestsellerCount = live.collectionCounts?.["best-sellers"];
  if (!Number.isFinite(bestsellerCount)) {
    reasons.push("best-sellers collection is missing from live governance");
  } else if (bestsellerCount < 300) {
    reasons.push(`best-sellers below required floor: ${bestsellerCount} < 300`);
  }

  if (state?.lastSuccessfulFingerprint) {
    const previous = JSON.stringify(state.lastSuccessfulFingerprint.collectionCounts || {});
    const current = JSON.stringify(live.collectionCounts || {});
    if (previous !== current) reasons.push("governed collection fingerprint changed");
  }

  return [...new Set(reasons)];
}

async function acquireLock() {
  try {
    await mkdir(lockPath);
    await writeFile(resolve(lockPath, "owner.json"), `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
    return true;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const owner = await readJson(resolve(lockPath, "owner.json"), {});
    const pid = Number(owner?.pid || 0);
    let alive = false;
    if (pid > 0) {
      try {
        process.kill(pid, 0);
        alive = true;
      } catch {
        alive = false;
      }
    }
    if (alive) return false;
    await rm(lockPath, { recursive: true, force: true });
    await mkdir(lockPath);
    await writeFile(resolve(lockPath, "owner.json"), `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
    return true;
  }
}

async function releaseLock() {
  await rm(lockPath, { recursive: true, force: true });
}

function runDailyRelease({ resume = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const args = ["run", "release:daily"];
    if (resume) args.push("--", "--resume");
    const child = spawn(npmBin, args, {
      cwd: rootDir,
      env: { ...process.env, SALT_RELEASE_WATCHER_CHILD: "1" },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`release:daily exited with ${signal ? `signal ${signal}` : `code ${code}`}`));
    });
  });
}

async function checkOnce(state) {
  const releaseInspection = await inspectReleaseRun(state);
  if (releaseInspection.active) {
    await log(`release active; step=${releaseInspection.release.stepIndex || "unknown"}/${releaseInspection.release.totalSteps || "unknown"} ${releaseInspection.release.stepLabel || "unknown"}`);
    return {
      ...state,
      lastCheckedAt: new Date().toISOString(),
      activeReleasePid: Number(releaseInspection.release.pid || 0),
      lastError: "",
    };
  }

  const baseline = await readLocalBaseline();
  const live = await readLiveFingerprint();
  const reasons = [...releaseInspection.reasons, ...detectDrift(baseline, live, state)];
  if (!reasons.length) {
    await log(`no drift; latest=${live.latestProductHandle || live.latestProductId || "none"}`);
    return { ...state, lastCheckedAt: live.checkedAt, lastError: "" };
  }

  if (state?.nextRetryAt && timestamp(state.nextRetryAt) > Date.now()) {
    await log(`drift held for retry backoff until ${state.nextRetryAt}: ${reasons.join("; ")}`);
    return { ...state, lastCheckedAt: live.checkedAt, lastDriftReasons: reasons };
  }

  if (!(await acquireLock())) {
    await log(`drift detected while another release is running: ${reasons.join("; ")}`);
    return { ...state, lastCheckedAt: live.checkedAt, lastDriftReasons: reasons };
  }

  try {
    await log(`deterministic drift detected; starting guarded release: ${reasons.join("; ")}`);
    const resume = ["failed", "running"].includes(releaseInspection.release?.status);
    await log(`release mode: ${resume ? "resume from checkpoint" : "full catalog run"}`);
    await runDailyRelease({ resume });
    const refreshed = await readLiveFingerprint();
    await log(`guarded release completed and live fingerprint refreshed`);
    return {
      ...state,
      lastCheckedAt: refreshed.checkedAt,
      lastSuccessfulReleaseAt: new Date().toISOString(),
      lastSuccessfulLiveUpdatedAt: refreshed.latestProductUpdatedAt,
      lastSuccessfulFingerprint: refreshed,
      lastDriftReasons: [],
      failureCount: 0,
      nextRetryAt: "",
      lastError: "",
    };
  } catch (error) {
    const failureCount = Number(state?.failureCount || 0) + 1;
    const retryMs = Math.min(maxRetryIntervalMs, pollIntervalMs * 2 ** Math.min(failureCount - 1, 8));
    const nextRetryAt = new Date(Date.now() + retryMs).toISOString();
    await log(`guarded release failed; no partial repair attempted: ${error.message}`);
    return {
      ...state,
      lastCheckedAt: live.checkedAt,
      lastDriftReasons: reasons,
      failureCount,
      nextRetryAt,
      lastError: error.message,
    };
  } finally {
    await releaseLock();
  }
}

async function main() {
  await log(`watcher started; polling every ${Math.round(pollIntervalMs / 1000)}s`);
  let state = await readJson(statePath, {});
  while (true) {
    try {
      state = await checkOnce(state);
      await writeState(state);
    } catch (error) {
      await log(`fingerprint check failed; no mutation attempted: ${error.message}`);
      state = { ...state, lastError: error.message, lastCheckedAt: new Date().toISOString() };
      await writeState(state);
    }
    await sleep(pollIntervalMs);
  }
}

main().catch(async (error) => {
  await log(`watcher stopped: ${error.message}`);
  process.exit(1);
});
