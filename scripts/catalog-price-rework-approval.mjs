#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PRICE_REWORK_STRATEGY_ID } from "../src/lib/shopify-price-rework-policy.js";

const rootDir = resolve(import.meta.dirname, "..");
const approvalPath = resolve(rootDir, "docs", "catalog-price-rework-approval.json");

function fail(message) {
  throw new Error(
    `${message}\n` +
      "Price writes are blocked until the approved tiered-multiplier price rework manifest is loaded.",
  );
}

const approval = await readFile(approvalPath, "utf8").then(JSON.parse).catch((error) => {
  fail(error?.code === "ENOENT" ? "No catalog price rework approval manifest exists." : error.message);
});

const approvalId = String(approval?.approvalId || "").trim();
if (approval?.approved !== true) fail("Catalog price rework approval is not marked approved.");
if (!approvalId) fail("Catalog price rework approval has no approvalId.");
if (Number(approval?.scope?.threshold) !== 35) fail("Price rework approval must target the $35 threshold.");
if (String(approval?.scope?.strategyId || "") !== PRICE_REWORK_STRATEGY_ID) {
  fail(`Price rework approval must use strategy ${PRICE_REWORK_STRATEGY_ID}.`);
}
if (approval?.scope?.compareAtPrices !== "multiply existing compare-at prices by the same variant multiplier; preserve absence") {
  fail("Price rework approval must adjust existing compare-at prices with the variant multiplier.");
}
if (approval?.scope?.variantPrices !== "preserve independent variant pricing; never flatten quality, size, color, or bundle prices") {
  fail("Price rework approval must preserve independent variant pricing.");
}
if (process.env.SALT_CATALOG_PRICE_REWORK_APPROVED !== "1") {
  fail("Set SALT_CATALOG_PRICE_REWORK_APPROVED=1 only for the approved live price rework.");
}
if (process.env.SALT_CATALOG_PRICE_REWORK_APPROVAL_ID !== approvalId) {
  fail("SALT_CATALOG_PRICE_REWORK_APPROVAL_ID does not match the approved price rework manifest.");
}

process.stdout.write(`Catalog price rework approval verified: ${approvalId}.\n`);
