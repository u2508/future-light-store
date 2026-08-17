#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

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
  process.env.SALT_SHOPIFY_THEME_DIR = themeDir;
  process.env.SHOPIFY_THEME_DIR = themeDir;
  process.env.SHOPIFY_CLI_AGENT_INFO ||= "n:future-light-store|v:1|p:openai";
  process.env.SHOPIFY_CLI_AGENT_IDS ||= `s:future-light-store|r:${process.pid}|i:future-light-store-release`;

  const child = spawnSync(process.execPath, [resolve(rootDir, "scripts", "release.mjs"), ...process.argv.slice(2)], {
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
