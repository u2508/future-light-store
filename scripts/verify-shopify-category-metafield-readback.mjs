#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertCategoryMetafieldReadbackReceipt } from "./lib/category-metafield-release-gate.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const manifestPath = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : resolve(rootDir, "output", "product-metafield-backfill-manifest.json");

try {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const receipt = assertCategoryMetafieldReadbackReceipt(manifest);
  const manifestGeneratedAt = Date.parse(manifest.generatedAt || "");
  const receiptGeneratedAt = Date.parse(receipt.generatedAt || "");
  if (!Number.isFinite(manifestGeneratedAt) || !Number.isFinite(receiptGeneratedAt) || receiptGeneratedAt < manifestGeneratedAt) {
    throw new Error("Category-metafield readback receipt is stale relative to the current backfill manifest");
  }
  process.stdout.write(
    `Category-metafield readback verified: ${receipt.expectedProducts} products, ${receipt.checkedRequiredFields} required fields, no missing/mismatched/unmapped values.\n`,
  );
} catch (error) {
  process.stderr.write(`Category-metafield readback gate failed: ${error.message || error}\n`);
  process.exitCode = 1;
}
