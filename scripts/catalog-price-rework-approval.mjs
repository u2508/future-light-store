#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PRICE_REWORK_STRATEGY_ID } from "../src/lib/shopify-price-rework-policy.js";

const rootDir = resolve(import.meta.dirname, "..");
const approvalPath = resolve(rootDir, "docs", "catalog-price-rework-approval.json");

function fail(message) {
  throw new Error(
    `${message}\n` +
      "Price writes are blocked until the approved cost-based pricing manifest is loaded.",
  );
}

const approval = await readFile(approvalPath, "utf8").then(JSON.parse).catch((error) => {
  fail(error?.code === "ENOENT" ? "No catalog price rework approval manifest exists." : error.message);
});

const approvalId = String(approval?.approvalId || "").trim();
if (approval?.approved !== true) fail("Catalog price rework approval is not marked approved.");
if (!approvalId) fail("Catalog price rework approval has no approvalId.");
if (String(approval?.scope?.strategyId || "") !== PRICE_REWORK_STRATEGY_ID) {
  fail(`Price rework approval must use strategy ${PRICE_REWORK_STRATEGY_ID}.`);
}
if (approval?.scope?.costSource !== "live Shopify variant inventoryItem.unitCost.amount") {
  fail("Price rework approval must use the live Shopify variant inventory cost.");
}
if (Number(approval?.scope?.overhead) !== 16) {
  fail("Price rework approval must include the approved $16 overhead.");
}
if (Number(approval?.scope?.minimumSellPrice) !== 0.99) {
  fail("Price rework approval must include the approved $0.99 minimum sell price.");
}
if (approval?.scope?.compareAtPrices !== "preserve absence; when present normalize to at least 1.25x the cost-based sell price with psychological rounding") {
  fail("Price rework approval must preserve compare-at absence and normalize present compare-at prices.");
}
if (approval?.scope?.variantPrices !== "calculate independently per variant; preserve quality, size, color, bundle, and quantity-tier differences") {
  fail("Price rework approval must preserve independent variant pricing.");
}
if (!approval?.scope?.costBands || typeof approval.scope.costBands !== "object") {
  fail("Price rework approval must include the approved cost bands.");
}
if (process.env.SALT_CATALOG_PRICE_REWORK_APPROVED !== "1") {
  fail("Set SALT_CATALOG_PRICE_REWORK_APPROVED=1 only for the approved live price rework.");
}
if (process.env.SALT_CATALOG_PRICE_REWORK_APPROVAL_ID !== approvalId) {
  fail("SALT_CATALOG_PRICE_REWORK_APPROVAL_ID does not match the approved price rework manifest.");
}

process.stdout.write(`Catalog price rework approval verified: ${approvalId}.\n`);
