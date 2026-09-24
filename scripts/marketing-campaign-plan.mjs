#!/usr/bin/env node

/**
 * Build a proposal-only paid acquisition plan from the current preflight.
 * This file never creates or edits a Meta, Google, Shopify, or Merchant Center
 * campaign. It is the final local guard before an operator configures spend.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dirname, "..");
const preflightPath = resolve(rootDir, "output", "marketing-launch-preflight.json");
const auditPath = resolve(rootDir, "output", "marketing-cohort-audit.json");
const outputPath = resolve(rootDir, "output", "marketing-campaign-plan.json");
const strictMode = process.argv.includes("--strict");

const decisionRules = [
  "Clicks but no product engagement: change creative or targeting.",
  "Product views but no add-to-cart: review product, price, or offer.",
  "Add-to-cart but no checkout: review shipping, trust, or product page.",
  "Checkout but no purchase: review payment, final price, or delivery.",
  "Purchase with acceptable CPA: shift the next test cycle toward that product.",
  "CPA above allowable gross profit: pause the product.",
  "Do not increase budget automatically after a no-conversion window.",
];

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function main() {
  const preflight = await readJson(preflightPath);
  const audit = await readJson(auditPath);
  const blockedGates = (preflight.gates ?? [])
    .filter((gate) => gate.status === "blocked" || gate.status === "pending")
    .map((gate) => gate.id);
  const approvedHandles = preflight.advertisingCohort?.approvedHandles ?? [];
  const approved = preflight.advertisingCohort?.status === "pass" && approvedHandles.length >= 12;
  const testCycles = approved
    ? (audit.testCycles ?? []).map((cycle) => ({
        cycle: cycle.cycle,
        handles: cycle.handles.slice(0, 5),
        maxProducts: 5,
        status: "ready-after-launch-gates",
      }))
    : [];

  const plan = {
    schemaVersion: "2026-09-21.vs-store.marketing-campaign-plan.1",
    generatedAt: new Date().toISOString(),
    mode: "proposal-only",
    status: blockedGates.length === 0 ? "ready-for-operator-review" : "blocked",
    sourceOfTruth: "live Shopify preflight and live cohort audit",
    budget: {
      currency: "INR",
      monthlyTotal: 5000,
      meta: { monthly: 3000, daily: 100 },
      googleShopping: { monthly: 2000, daily: 67 },
      tiktok: { status: "deferred", budget: 0 },
    },
    meta: {
      campaignCount: 1,
      campaignType: "Sales",
      objective: "Website Purchase",
      country: "US",
      dailyBudgetInr: 100,
      productsPerTestCycle: "3-5",
      creativeMix: ["product demo", "lifestyle use", "carousel", "problem/solution"],
      retargeting: "disabled until the audience is sufficient",
      purchaseSource: "Shopify ORDERS_PAID webhook to Meta Conversions API",
    },
    googleShopping: {
      campaignCount: 1,
      campaignType: "Standard Shopping",
      country: "US",
      dailyBudgetInr: 67,
      productsPerTestCycle: "3-5",
      performanceMax: "deferred until conversion data exists",
      prerequisites: [
        "Merchant Center approval",
        "verified shipping",
        "live product test",
        "Google purchase readback",
      ],
    },
    cohort: {
      candidateCount: Number(preflight.advertisingCohort?.candidateCount ?? 0),
      copyReadyCandidateCount: Number(preflight.advertisingCohort?.copyReadyCandidateCount ?? 0),
      approved,
      approvedHandles,
      testCycles,
    },
    decisionRules,
    blockedGates,
    safeActionsTaken: [
      "No campaign was created or enabled.",
      "No ad spend was changed.",
      "No product was imported or added through DSers.",
    ],
  };

  await mkdir(resolve(rootDir, "output"), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  process.stdout.write(
    `Marketing campaign plan written to ${outputPath}\n` +
      `Status: ${plan.status}; blocked/pending gates: ${blockedGates.length}; approved handles: ${approvedHandles.length}.\n`,
  );
  if (strictMode && blockedGates.length > 0) process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : error}\n`);
  process.exitCode = 1;
});
