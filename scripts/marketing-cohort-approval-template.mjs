#!/usr/bin/env node

/**
 * Build a sign-off template from the latest live cohort audit.
 * This never approves a product and never writes to Shopify or DSers.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dirname, "..");
const auditPath = resolve(rootDir, "output", "marketing-cohort-audit.json");
const outputPath = resolve(rootDir, "output", "marketing-cohort-approval-template.json");

async function main() {
  const audit = JSON.parse(await readFile(auditPath, "utf8"));
  const candidates = Array.isArray(audit.candidates) ? audit.candidates.slice(0, 18) : [];
  if (candidates.length < 12 || candidates.length > 18) {
    throw new Error(`The live audit must contain 12-18 candidates; found ${candidates.length}.`);
  }

  const template = {
    schemaVersion: "2026-09-21.vs-store.marketing-cohort-approval-template.1",
    approved: false,
    approvalId: "",
    approvedAt: null,
    approvedBy: null,
    source: {
      liveSource: audit.liveSource,
      auditGeneratedAt: audit.generatedAt,
      candidateCount: candidates.length,
    },
    handles: candidates.map((candidate) => ({
      handle: candidate.handle,
      title: candidate.title,
      supplierDeliveryVerified: false,
      returnsVerified: false,
      marginApproved: false,
      operatorApproved: false,
      allowableCpaUsd: null,
      notes:
        "Verify DSers supplier mapping, US delivery/returns, landed cost, fees, refund reserve, policy suitability, then record explicit operator approval.",
    })),
    instructions:
      "Review every row against current supplier and Shopify evidence. Copy this file to docs/marketing-cohort-approval.json only after all required flags and allowableCpaUsd are verified.",
    safeActionsTaken: [
      "Read the latest live Shopify cohort audit only.",
      "No product, collection, price, inventory, DSers, Merchant Center, or ad mutation.",
      "All approval flags remain false.",
    ],
  };

  await mkdir(resolve(outputPath, ".."), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(template, null, 2)}\n`, "utf8");
  process.stdout.write(
    `Marketing cohort approval template written to ${outputPath}\n` +
      `Handles: ${template.handles.length}; approved: ${template.approved}.\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
});
