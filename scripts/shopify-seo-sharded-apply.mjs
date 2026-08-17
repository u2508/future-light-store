#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dirname, "..");
const nodeBin = process.execPath;

function parseArgs(argv) {
  const args = {
    sourceManifest: resolve(rootDir, "output", "shopify-seo-full-catalog-missing-apply.json"),
    catalog: resolve(rootDir, "output", ".shopify-seo-live-catalog.json"),
    outputDir: resolve(rootDir, "output", "shopify-seo-shards"),
    shardCount: 4,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--source-manifest") args.sourceManifest = resolve(rootDir, next || "");
    else if (token === "--catalog") args.catalog = resolve(rootDir, next || "");
    else if (token === "--output-dir") args.outputDir = resolve(rootDir, next || "");
    else if (token === "--shards") args.shardCount = Math.max(1, Math.min(5, Number(next) || 4));
    else continue;
    index += 1;
  }
  return args;
}

function runShard({ index, catalogPath, manifestPath }) {
  const args = [
    "scripts/shopify-seo-release.mjs",
    "--apply",
    "--full-catalog",
    "--preserve-prices",
    "--preserve-tags",
    "--frozen-catalog", catalogPath,
    "--output", manifestPath,
  ];
  process.stdout.write(`[shard ${index + 1}] $ ${nodeBin} ${args.join(" ")}\n`);
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(nodeBin, args, { cwd: rootDir, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    const logPath = manifestPath.replace(/\.json$/i, ".log");
    const chunks = [];
    const errors = [];
    child.stdout.on("data", (chunk) => {
      chunks.push(chunk);
      const text = String(chunk);
      const updates = (text.match(/updated-verified:/g) || []).length;
      if (updates) process.stdout.write(`[shard ${index + 1}] verified +${updates}\n`);
    });
    child.stderr.on("data", (chunk) => errors.push(chunk));
    child.on("error", rejectPromise);
    child.on("exit", async (code, signal) => {
      await writeFile(logPath, Buffer.concat([...chunks, ...errors]), "utf8");
      if (code === 0) resolvePromise({ index, manifestPath, logPath });
      else rejectPromise(new Error(`SEO shard ${index + 1} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}; see ${logPath}`));
    });
  });
}

export async function runShardedSeoApply(options = {}) {
  const args = { ...parseArgs(["node", "script"]), ...options };
  const [sourceManifest, catalogPayload] = await Promise.all([
    readFile(args.sourceManifest, "utf8").then(JSON.parse),
    readFile(args.catalog, "utf8").then(JSON.parse),
  ]);
  const completedStatuses = new Set(["updated-verified", "skipped-exact-match"]);
  const remainingEntries = (sourceManifest.products || [])
    .filter((product) => !completedStatuses.has(product.status) && !String(product.status || "").startsWith("failed"));
  const remainingProductIds = new Set(remainingEntries.map((product) => String(product.liveProductId || "").match(/(\d+)$/)?.[1]).filter(Boolean));
  const products = (catalogPayload.products || []).filter((product) => remainingProductIds.has(String(product.id)));
  if (products.length !== remainingProductIds.size) {
    throw new Error(`Frozen catalog resolved ${products.length}/${remainingProductIds.size} remaining product ids`);
  }
  const shards = Array.from({ length: args.shardCount }, () => []);
  products.forEach((product, index) => shards[index % shards.length].push(product));
  await mkdir(args.outputDir, { recursive: true });

  const jobs = [];
  for (const [index, shardProducts] of shards.entries()) {
    const catalogPath = resolve(args.outputDir, `catalog-${index + 1}.json`);
    const manifestPath = resolve(args.outputDir, `manifest-${index + 1}.json`);
    await writeFile(catalogPath, `${JSON.stringify({ products: shardProducts })}\n`, "utf8");
    jobs.push({ index, catalogPath, manifestPath, products: shardProducts.length });
  }
  await writeFile(resolve(args.outputDir, "plan.json"), `${JSON.stringify({
    createdAt: new Date().toISOString(),
    sourceManifest: args.sourceManifest,
    products: products.length,
    shards: jobs.map(({ index, catalogPath, manifestPath, products: count }) => ({ index: index + 1, catalogPath, manifestPath, products: count })),
  }, null, 2)}\n`, "utf8");

  const results = await Promise.all(jobs.map(runShard));
  const manifests = await Promise.all(results.map((result) => readFile(result.manifestPath, "utf8").then(JSON.parse)));
  const summary = {
    completedAt: new Date().toISOString(),
    products: products.length,
    updatedVerified: manifests.reduce((sum, manifest) => sum + (manifest.summary?.updatedVerified || 0), 0),
    exactMatches: manifests.reduce((sum, manifest) => sum + (manifest.summary?.exactMatches || 0), 0),
    failures: manifests.reduce((sum, manifest) => sum + (manifest.summary?.failed || 0), 0),
    totalWrites: manifests.reduce((sum, manifest) => sum + (manifest.summary?.totalWrites || 0), 0),
  };
  await writeFile(resolve(args.outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  if (summary.failures || summary.updatedVerified + summary.exactMatches !== summary.products) {
    throw new Error(`SEO shard verification incomplete: ${JSON.stringify(summary)}`);
  }
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  runShardedSeoApply(parseArgs(process.argv)).catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
