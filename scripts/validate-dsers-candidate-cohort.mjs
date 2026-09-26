#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  readDsersPolicy,
  validateDsersBatchCapacity,
} from "./lib/dsers-batch-capacity.mjs";
import { inspectDsersProductCandidate } from "../src/lib/dsers-product-policy.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--capacity-only") {
      if (result[key]) throw new Error(`Duplicate argument: ${key}`);
      result[key] = true;
      continue;
    }
    if (!["--candidates", "--snapshot"].includes(key)) {
      throw new Error(`Unknown argument: ${key}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    if (result[key]) throw new Error(`Duplicate argument: ${key}`);
    result[key] = value;
    index += 1;
  }
  if (!result["--snapshot"] || (result["--capacity-only"] && result["--candidates"])) {
    throw new Error(
      "Usage: npm run dsers:validate-cohort -- --snapshot <complete-shopify-snapshot-json> [--candidates <project-json> | --capacity-only]",
    );
  }
  if (!result["--capacity-only"] && !result["--candidates"]) {
    throw new Error("Provide --candidates <project-json> or use --capacity-only.");
  }
  return result;
}

function readProjectJson(inputPath, label) {
  const path = resolve(rootDir, inputPath);
  const relativePath = relative(rootDir, path);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
    throw new Error(`${label} must be inside the Future Light Store project.`);
  }
  let value;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} is unreadable or invalid JSON: ${error.message}`);
  }
  return value;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function inspectCandidatePolicies(candidates) {
  if (!Array.isArray(candidates)) return [];

  return candidates.flatMap((candidate, index) => {
    const entry = candidate && typeof candidate === "object" && !Array.isArray(candidate)
      ? candidate
      : {};
    const inspection = inspectDsersProductCandidate(entry);
    if (inspection?.allowed === true) return [];

    const reasonCodes = Array.isArray(inspection?.reasonCodes)
      ? [...new Set(inspection.reasonCodes.filter((code) => typeof code === "string"))]
        .sort(compareText)
      : [];
    const supplierProductId = typeof entry.supplierProductId === "string" && entry.supplierProductId.trim()
      ? entry.supplierProductId.trim()
      : "<missing-supplierProductId>";

    return [{
      code: "PRODUCT_POLICY_HOLD",
      supplierProductId,
      reasonCodes,
      index,
    }];
  }).sort((left, right) =>
    compareText(left.supplierProductId, right.supplierProductId) ||
    compareText(left.reasonCodes.join(","), right.reasonCodes.join(",")) ||
    left.index - right.index,
  );
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const candidates = args["--capacity-only"]
      ? []
      : readProjectJson(args["--candidates"], "Candidate cohort");
    const activeCatalogSnapshot = readProjectJson(args["--snapshot"], "Shopify catalog snapshot");
    const policy = readDsersPolicy({ repoRoot: rootDir });
    const capacityResult = validateDsersBatchCapacity(candidates, policy, { activeCatalogSnapshot });
    const productPolicyHolds = args["--capacity-only"] ? [] : inspectCandidatePolicies(candidates);
    const result = {
      ...capacityResult,
      valid: capacityResult.valid && productPolicyHolds.length === 0,
      errors: [...capacityResult.errors, ...productPolicyHolds],
    };

    if (result.capacity) {
      const {
        totalProductCount,
        activeProductCount,
        target,
        totalProductHeadroom,
        activeHeadroom,
        availableHeadroom,
        planningCeiling,
        effectiveCeiling,
      } = result.capacity;
      process.stdout.write(
        `Shopify products (all statuses): ${totalProductCount}/${target}; total headroom: ${totalProductHeadroom}; active: ${activeProductCount}; active headroom: ${activeHeadroom}; safe cohort ceiling: ${effectiveCeiling} (planning ceiling ${planningCeiling}; available headroom ${availableHeadroom}).\n`,
      );
    }
    process.stdout.write(args["--capacity-only"]
      ? `Catalog capacity: ${result.valid ? "VERIFIED" : "HOLD"}; no candidate cohort evaluated.\n`
      : `Candidate cohort: ${result.counts.total}; ${result.valid ? "PASS" : "HOLD"}.\n`);
    for (const error of result.errors) {
      if (error.code === "PRODUCT_POLICY_HOLD") {
        const reasons = error.reasonCodes.length > 0 ? error.reasonCodes.join(",") : "<no reason codes>";
        process.stdout.write(`${error.code}: ${error.supplierProductId}: ${reasons}\n`);
        continue;
      }
      process.stdout.write(`${error.code}${error.candidateId ? `: ${error.candidateId}` : ""}\n`);
    }
    process.exitCode = result.valid ? 0 : 1;
  } catch (error) {
    process.stderr.write(`Cohort validation stopped: ${error.message}\n`);
    process.exitCode = 2;
  }
}

main();
