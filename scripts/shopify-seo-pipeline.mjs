#!/usr/bin/env node

import { spawn } from "node:child_process";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dirname, "..");
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const nodeBin = process.execPath;

function parseArgs(argv) {
  const args = { mode: "dry-run", scope: "new-products", frozenCatalog: "", productHandlesFile: "" };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--apply") args.mode = "apply";
    else if (token === "--dry-run") args.mode = "dry-run";
    else if (token === "--scope") {
      args.scope = argv[index + 1];
      index += 1;
    } else if (token === "--all-products") args.scope = "all-products";
    else if (token === "--new-products-only") args.scope = "new-products";
    else if (token === "--frozen-catalog") {
      args.frozenCatalog = argv[index + 1] || "";
      index += 1;
    } else if (token === "--product-handles-file") {
      args.productHandlesFile = argv[index + 1] || "";
      index += 1;
    }
  }
  if (!["all-products", "new-products"].includes(args.scope)) {
    throw new Error(`Invalid --scope ${args.scope}; expected all-products or new-products`);
  }
  return args;
}

function runStage(label, command, args, index, total) {
  process.stdout.write(`\n[${index}/${total}] ${label}\n$ ${[command, ...args].join(" ")}\n`);
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd: rootDir, env: process.env, stdio: "inherit" });
    child.on("error", rejectPromise);
    child.on("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${label} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`));
    });
  });
}

export function buildSeoPipelineStages({ mode, scope, frozenCatalog = "", productHandlesFile = "" }) {
  const modeFlag = mode === "apply" ? "--apply" : "--dry-run";
  const handlesPath = productHandlesFile || "output/shopify-seo-scope-handles.json";
  const variantHandlesOutput = productHandlesFile ? "output/shopify-seo-scope-handles.json" : handlesPath;
  const variantArgs = [
    "scripts/shopify-variant-google-metafields.mjs",
    modeFlag,
    "--scope", scope,
    "--handles-output", variantHandlesOutput,
    "--output", `output/shopify-variant-google-metafields-${scope}-manifest.json`,
  ];
  if (productHandlesFile) variantArgs.push("--product-handles-file", productHandlesFile);
  const variantImageArgs = [
    "scripts/shopify-variant-image-mapping.mjs",
    modeFlag,
    "--scope", scope,
    "--handles-output", handlesPath,
    "--output", `output/shopify-variant-image-mapping-${scope}-manifest.json`,
  ];
  if (frozenCatalog) variantImageArgs.push("--input", frozenCatalog);
  const seoArgs = [
    "scripts/shopify-seo-release.mjs",
    modeFlag,
    scope === "all-products" ? "--full-catalog" : "--new-products-only",
    "--preserve-prices",
  ];
  if (frozenCatalog) seoArgs.push("--frozen-catalog", frozenCatalog);
  if (productHandlesFile) seoArgs.push("--product-handles-file", productHandlesFile);
  const productMetafieldArgs = ["scripts/shopify-product-metafield-backfill.mjs", modeFlag];
  if (scope === "new-products") productMetafieldArgs.push("--product-handles-file", handlesPath, "--product-only");

  const stages = [];
  if (mode === "apply") {
    stages.push({ label: "Ensure Shopify metafield definitions", command: npmBin, args: ["run", "shopify:product-metafields:ensure"] });
  }
  if (!frozenCatalog) {
    stages.push({ label: "Refresh Shopify catalog data", command: npmBin, args: ["run", "sync:data"] });
  }
  stages.push(
    { label: `Plan/apply Google variant metafields (${scope})`, command: nodeBin, args: variantArgs },
    { label: `Reconcile handle-first SEO (${scope})`, command: nodeBin, args: seoArgs },
    { label: `Map variant images (${scope})`, command: nodeBin, args: variantImageArgs },
    { label: `Backfill product merchandising metafields (${scope})`, command: nodeBin, args: productMetafieldArgs },
  );
  if (mode === "apply" && !frozenCatalog) {
    stages.push(
      { label: "Refresh catalog after Shopify mutations", command: npmBin, args: ["run", "sync:data"] },
      { label: "Verify merchandising metafields", command: npmBin, args: ["run", "shopify:merchandising:verify"] },
    );
  }
  return stages;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.scope === "new-products" && Boolean(args.frozenCatalog) !== Boolean(args.productHandlesFile)) {
    throw new Error("New-products frozen runs require both --frozen-catalog and --product-handles-file");
  }
  const stages = buildSeoPipelineStages(args);
  process.stdout.write(`SALT Shopify SEO pipeline: ${args.mode}, scope=${args.scope}\n`);
  for (const [index, stage] of stages.entries()) {
    await runStage(stage.label, stage.command, stage.args, index + 1, stages.length);
  }
  process.stdout.write(`\nSEO pipeline completed: ${args.mode}, scope=${args.scope}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
