#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { approvalSummary, readApprovalManifest } from "./lib/marketing-cohort-approval.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const manifestPath = resolve(
  rootDir,
  process.argv.find((argument) => argument.startsWith("--file="))?.slice("--file=".length) ||
    "docs/marketing-cohort-approval.json",
);
const outputPath = resolve(rootDir, "output", "marketing-cohort-approval-check.json");
const auditPath = resolve(rootDir, "output", "marketing-cohort-audit.json");

async function main() {
  let approval;
  try {
    approval = await readApprovalManifest(manifestPath);
  } catch (error) {
    approval = {
      manifest: null,
      handles: [],
      errors: [
        `Could not read approval manifest: ${error instanceof Error ? error.message : error}`,
      ],
    };
  }

  let audit = null;
  try {
    audit = JSON.parse(await readFile(auditPath, "utf8"));
  } catch {
    approval.errors.push(
      "marketing-cohort-audit.json is missing; run marketing:cohort:audit first",
    );
  }

  const auditByHandle = new Map(
    (audit?.candidates || []).map((candidate) => [candidate.handle, candidate]),
  );
  for (const handle of approval.handles) {
    const candidate = auditByHandle.get(handle);
    if (!candidate) approval.errors.push(`${handle}: not present in the latest audit shortlist`);
    else if (candidate.dataEligible !== true)
      approval.errors.push(`${handle}: latest audit is not data-eligible`);
    else if (candidate.copy?.ready !== true)
      approval.errors.push(`${handle}: latest audit copy gate is not ready`);
  }

  const report = {
    schemaVersion: "2026-09-21.vs-store.marketing-cohort-approval-check.1",
    generatedAt: new Date().toISOString(),
    mode: "read-only",
    manifestPath,
    auditPath,
    ...approvalSummary(approval),
    safeActionsTaken: ["No Shopify or DSers mutation.", "No feed upload or ad campaign change."],
  };
  await mkdir(resolve(rootDir, "output"), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(
    `Marketing cohort approval check written to ${outputPath}\n` +
      `Status: ${report.approved ? "pass" : "blocked"}; handles: ${report.handles.length}; errors: ${report.errors.length}.\n`,
  );
  if (!report.approved) process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : error}\n`);
  process.exitCode = 1;
});
