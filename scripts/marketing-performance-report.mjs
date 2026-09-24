#!/usr/bin/env node

/**
 * Build a read-only 14-day funnel and economics report from an operator-supplied
 * Meta/Google export. It never calls an ad platform and never changes budget.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { buildPerformanceReport } from "./lib/marketing-performance.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const inputPath = resolve(
  rootDir,
  process.argv.find((argument) => argument.startsWith("--input="))?.slice("--input=".length) ||
    "docs/marketing-performance.json",
);
const outputPath = resolve(
  rootDir,
  process.argv.find((argument) => argument.startsWith("--output="))?.slice("--output=".length) ||
    "output/marketing-performance-report.json",
);

async function main() {
  let input;
  try {
    input = JSON.parse(await readFile(inputPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Performance input is missing or unreadable at ${inputPath}. Copy docs/marketing-performance.example.json and supply verified metrics. ${error instanceof Error ? error.message : error}`,
    );
  }

  const report = buildPerformanceReport(input);
  await mkdir(resolve(outputPath, ".."), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(
    `Marketing performance report written to ${outputPath}\n` +
      `Products: ${report.products.length}; observation window: ${report.period.days ?? "unknown"} days; decision eligible: ${report.decisionEligible}.\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
});
