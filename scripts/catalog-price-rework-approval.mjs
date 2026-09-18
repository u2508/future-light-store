#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PRICE_REWORK_RULES, PRICE_REWORK_STRATEGY_ID } from "../src/lib/shopify-price-rework-policy.js";

const rootDir = resolve(import.meta.dirname, "..");
const approvalPath = resolve(rootDir, "docs", "future-light-nominal-pricing-approval.json");

function fail(message) {
  throw new Error(
    `${message}\n` +
      "Price writes are blocked until the approved Future Light nominal-market pricing manifest is loaded.",
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
if (Number(approval?.scope?.overhead) !== PRICE_REWORK_RULES.overhead) {
  fail("Price rework approval must include the approved $16 overhead.");
}
if (Number(approval?.scope?.minimumNetContribution) !== PRICE_REWORK_RULES.minimumNetContribution) {
  fail(`Price rework approval must include the approved $${PRICE_REWORK_RULES.minimumNetContribution} minimum net contribution.`);
}
if (Number(approval?.scope?.minimumSellPrice) !== PRICE_REWORK_RULES.minimumSellPrice) {
  fail("Price rework approval must include the approved $0.99 minimum sell price.");
}
if (approval?.scope?.compareAtPrices !== "preserve absence; when present normalize to at least 1.25x the nominal market sell price with psychological rounding") {
  fail("Price rework approval must preserve compare-at absence and normalize present compare-at prices.");
}
if (approval?.scope?.variantPrices !== "calculate independently per variant; preserve size, color, bundle, quality, and quantity-tier differences") {
  fail("Price rework approval must preserve independent variant pricing.");
}
if (!Array.isArray(approval?.scope?.marketBands) || !approval.scope.marketBands.length) {
  fail("Price rework approval must include the approved nominal market bands.");
}
if (process.env.FUTURE_LIGHT_PRICING_APPROVAL_ID && process.env.FUTURE_LIGHT_PRICING_APPROVAL_ID !== approvalId) {
  fail("FUTURE_LIGHT_PRICING_APPROVAL_ID does not match the approved price rework manifest.");
}

process.stdout.write(`Catalog price rework approval verified: ${approvalId}.\n`);
