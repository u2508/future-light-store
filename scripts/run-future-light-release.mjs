#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { availableParallelism } from "./lib/performance-runtime.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const envFiles = [
  resolve(rootDir, ".env.release.local"),
  resolve(rootDir, ".env.release"),
];
const approvalFiles = [
  "docs/catalog-taxonomy-approval.json",
  "docs/catalog-collection-approval.json",
  "docs/catalog-price-rework-approval.json",
  "docs/catalog-collection-merge-approval.json",
];
const releaseRunStatePath = resolve(rootDir, "output", "release-run-state.json");

function parseEnvValue(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return "";
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value.replace(/\s+#.*$/, "").trim();
}

async function loadReleaseEnv() {
  for (const filePath of envFiles) {
    if (!existsSync(filePath)) continue;
    const content = await readFile(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      process.env[match[1]] = parseEnvValue(match[2]);
    }
  }
}

function fail(message) {
  process.stderr.write(`Future Light Store release preflight failed: ${message}\n`);
  process.exit(1);
}

async function main() {
  await loadReleaseEnv();

  const shopUrl = String(process.env.SALT_SHOP_URL || "").trim();
  if (!shopUrl) {
    fail("SALT_SHOP_URL is missing. Create .env.release.local from .env.release.example.");
  }

  let shopHost;
  try {
    shopHost = new URL(shopUrl).hostname;
  } catch {
    fail(`SALT_SHOP_URL is not a valid URL: ${shopUrl}`);
  }
  if (shopHost === "0309d3-72.myshopify.com") {
    fail("SALT_SHOP_URL points to the SALT store; refusing to run against the wrong store.");
  }

  if (!process.env.SHOPIFY_ADMIN_ACCESS_TOKEN && !process.env.SHOPIFY_CLI_BINARY) {
    process.env.SHOPIFY_CLI_BINARY = "shopify";
  }

  const themeDir = resolve(
    process.env.SALT_SHOPIFY_THEME_DIR ||
      process.env.SHOPIFY_THEME_DIR ||
      resolve(rootDir, "..", "future-light-store-shopify"),
  );
  await mkdir(themeDir, { recursive: true });
  await mkdir(resolve(rootDir, "output"), { recursive: true });
  await mkdir(resolve(rootDir, "public", "data"), { recursive: true });

  const missingApprovals = approvalFiles.filter((relativePath) => !existsSync(resolve(rootDir, relativePath)));
  if (missingApprovals.length) {
    fail(`approval manifests are missing: ${missingApprovals.join(", ")}`);
  }

  process.env.SALT_RELEASE_NAME ||= "Future Light Store";
  process.env.SALT_RELEASE_SKIP_MOBILE ||= "1";
  process.env.SALT_KNOWLEDGE_ACCELERATOR ||= "auto";
  process.env.SALT_CATALOG_VISION_SUPERVISED ||= "1";
  // The final integrity readback is still readback-first by default. The
  // release wrapper alone may apply its evidence-backed correction plan so a
  // resumable release can heal stale classifications without Codex input.
  process.env.SALT_CATALOG_INTEGRITY_VERIFY_APPLY ||= "1";
  process.env.SALT_RELEASE_WAIT_FOR_VISUAL_REVIEW ||= "1";
  process.env.SALT_RELEASE_REUSE_VERIFIED_PLAN ||= "1";
  const tunedConcurrency = String(Math.min(8, Math.max(2, availableParallelism({ reserve: 2, max: 8 }))));
  const setAutoTuned = (name, value) => {
    if (!process.env[name] || /^(auto|adaptive|tuned)$/i.test(String(process.env[name]).trim())) {
      process.env[name] = value;
    }
  };
  setAutoTuned("SALT_CATALOG_CLASSIFICATION_CONCURRENCY", tunedConcurrency);
  setAutoTuned("SALT_BACKFILL_READ_CONCURRENCY", tunedConcurrency);
  setAutoTuned("SALT_SHOPIFY_REQUEST_CONCURRENCY", tunedConcurrency);
  process.env.SALT_SHOPIFY_REQUEST_DELAY_MS ||= "125";
  setAutoTuned("SALT_SHOPIFY_SEO_READ_CONCURRENCY", tunedConcurrency);
  setAutoTuned("SALT_CATALOG_TAXONOMY_CONCURRENCY", tunedConcurrency);
  setAutoTuned("SALT_VARIANT_IMAGE_FETCH_CONCURRENCY", tunedConcurrency);
  process.env.SALT_VARIANT_IMAGE_APPLY_CONCURRENCY ||= "3";
  setAutoTuned("SALT_VARIANT_IMAGE_PLAN_CONCURRENCY", tunedConcurrency);
  process.env.SALT_VARIANT_IMAGE_VERIFY_CONCURRENCY ||= "3";
  process.env.SALT_CATALOG_VISION_CONCURRENCY ||= "2";
  process.env.SALT_VARIANT_IMAGE_VISION_CONCURRENCY ||= "2";
  process.env.SALT_BACKFILL_APPLY_CONCURRENCY ||= "4";
  process.env.SALT_SHOPIFY_PUBLICATION_CONCURRENCY ||= "4";
  process.env.SALT_SHOPIFY_THEME_DIR = themeDir;
  process.env.SHOPIFY_THEME_DIR = themeDir;
  process.env.SHOPIFY_CLI_AGENT_INFO ||= "n:future-light-store|v:1|p:openai";
  process.env.SHOPIFY_CLI_AGENT_IDS ||= `s:future-light-store|r:${process.pid}|i:future-light-store-release`;

  const listingIntelligence = spawnSync(
    process.execPath,
    [resolve(rootDir, "scripts", "validate-product-listing-intelligence.mjs")],
    { cwd: rootDir, env: process.env, stdio: "inherit" },
  );
  if (listingIntelligence.error) throw listingIntelligence.error;
  if (listingIntelligence.status !== 0) {
    fail("product-listing intelligence preflight failed; release was not started.");
  }

  const forwardedArgs = [...process.argv.slice(2)];
  const npmResumeFlag = /^(1|true|yes)$/i.test(String(process.env.npm_config_resume || ""));
  const npmFreshFlag = /^(1|true|yes)$/i.test(String(process.env.npm_config_fresh || ""));
  if (npmResumeFlag && !forwardedArgs.includes("--resume")) forwardedArgs.push("--resume");
  if (npmFreshFlag && !forwardedArgs.includes("--fresh")) forwardedArgs.push("--fresh");
  const hasResumeFlag = forwardedArgs.includes("--resume");
  const hasFreshFlag = forwardedArgs.includes("--fresh");
  const profileIndex = forwardedArgs.indexOf("--profile");
  const requestedProfile = profileIndex >= 0 ? forwardedArgs[profileIndex + 1] : "catalog";
  if (!hasResumeFlag && !hasFreshFlag && process.env.SALT_RELEASE_AUTO_RESUME !== "0") {
    try {
      const previousRun = JSON.parse(await readFile(releaseRunStatePath, "utf8"));
      const resumable = ["failed", "running"].includes(previousRun?.status);
      const sameProfile = !previousRun?.profile || previousRun.profile === requestedProfile;
      if (resumable && sameProfile) {
        forwardedArgs.push("--resume");
        process.stdout.write(`Detected resumable ${previousRun.profile || requestedProfile} release state; continuing from its last guarded step.\n`);
      }
    } catch {
      // A fresh release is the correct behavior when no prior state exists.
    }
  }

  const child = spawnSync(process.execPath, [resolve(rootDir, "scripts", "release.mjs"), ...forwardedArgs], {
    cwd: rootDir,
    env: process.env,
    stdio: "inherit",
  });

  if (child.error) throw child.error;
  process.exit(child.status ?? 1);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
