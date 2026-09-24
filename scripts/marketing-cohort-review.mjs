#!/usr/bin/env node

/**
 * Turn the read-only Shopify cohort audit into an operator-review artifact.
 *
 * This command never approves a product and never talks to Shopify. The
 * generated report deliberately keeps the missing supplier, US returns,
 * landed-cost, and operator-approval evidence visible beside every handle.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dirname, "..");
const inputPath = resolve(rootDir, "output", "marketing-cohort-audit.json");
const outputPath = resolve(rootDir, "output", "marketing-cohort-review.md");

function money(value) {
  return value === null || value === undefined ? "—" : `$${Number(value).toFixed(2)}`;
}

function percent(value) {
  return value === null || value === undefined ? "—" : `${Number(value).toFixed(1)}%`;
}

function text(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

function costRange(candidate) {
  const costs = (candidate.variants ?? [])
    .map((variant) => Number(variant.cost))
    .filter((value) => Number.isFinite(value));
  if (!costs.length) return "—";
  const min = Math.min(...costs);
  const max = Math.max(...costs);
  return min === max ? money(min) : `${money(min)}–${money(max)}`;
}

function evidenceStatus(candidate) {
  const evidence = candidate.evidence ?? {};
  return [
    evidence.supplierDelivery ? "verified" : "PENDING",
    evidence.returnsProcess ? "verified" : "PENDING",
    evidence.marginApproval ? "verified" : "PENDING",
  ];
}

async function main() {
  const report = JSON.parse(await readFile(inputPath, "utf8"));
  const candidates = Array.isArray(report.candidates) ? report.candidates : [];
  const generatedAt = new Date().toISOString();
  const lines = [
    "# VS Store ad-cohort review",
    "",
    `Generated: ${generatedAt}`,
    `Source: ${text(report.liveSource || "Shopify Admin API active products")}`,
    "",
    "> Review order only. This is not approval and is not a profitability claim.",
    "> Shopify unit cost is shown before shipping, payment fees, refunds, taxes,",
    "> supplier reliability, and allowable CPA. Do not enable ads until each",
    "> selected handle has the required manual evidence and operator approval.",
    "",
    "## Snapshot",
    "",
    `- Active products read: **${report.totalActiveProductsRead ?? "—"}**`,
    `- Data-eligible products: **${report.summary?.dataEligibleProducts ?? "—"}**`,
    `- Review candidates: **${candidates.length}**`,
    `- Copy-ready candidates: **${candidates.filter((candidate) => candidate.copy?.ready).length}**`,
    `- Approval gate: **${text(report.approvalGate?.status || "blocked")}**`,
    "",
    "## Candidate shortlist",
    "",
    "| Rank | Product | Handle | Price | Shopify cost | Gross margin* | Inventory | Copy | Manual checks |",
    "| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |",
  ];

  for (const candidate of candidates) {
    const [supplier, returns, marginApproval] = evidenceStatus(candidate);
    const manualChecks = `supplier: ${supplier}; returns: ${returns}; margin: ${marginApproval}`;
    lines.push(
      `| ${candidate.reviewRank ?? "—"} | ${text(candidate.title)} | \`${text(candidate.handle)}\` | ${money(candidate.minPrice)}–${money(candidate.maxPrice)} | ${costRange(candidate)} | ${money(candidate.minGrossMarginBeforeShipping)} (${percent(candidate.minGrossMarginPercentBeforeShipping)}) | ${candidate.totalInventory ?? "—"} | ${candidate.copy?.wordCount ?? 0} words | ${manualChecks} |`,
    );
  }

  lines.push(
    "",
    "\\* Gross margin is the Shopify price minus Shopify unit cost only; it excludes shipping, payment fees, refunds, taxes, and advertising.",
    "",
    "## Required sign-off for every selected handle",
    "",
    "- [ ] Supplier and DSers mapping, supplier stock, and US delivery estimate verified.",
    "- [ ] US shipping charge and returns address/process verified.",
    "- [ ] Payment fee, shipping cost, refund reserve, and allowable CPA modeled.",
    "- [ ] Product-specific title, description, compatibility/FAQ and trust copy reviewed.",
    "- [ ] Meta and Google policy suitability reviewed.",
    "- [ ] Operator approved the exact handle for the first 12–18-product cohort.",
    "",
    "## Test cycles",
    "",
  );

  for (const cycle of report.testCycles ?? []) {
    lines.push(
      `- Cycle ${cycle.cycle}: ${cycle.handles.map((handle) => `\`${text(handle)}\``).join(", ")} — ${cycle.status}.`,
    );
  }

  lines.push(
    "",
    "Next gate: record the manual evidence and explicit handle approval, then rerun `npm run marketing:cohort:audit` and `npm run marketing:preflight:strict`.",
    "",
  );

  await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
  process.stdout.write(`Marketing cohort review written to ${outputPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : error}\n`);
  process.exitCode = 1;
});
