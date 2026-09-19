#!/usr/bin/env node

import { inspectDsersProductCandidate } from "../src/lib/dsers-product-policy.mjs";

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || "" : "";
}

const candidate = {
  title: readArg("--title"),
  description: readArg("--description"),
  sku: readArg("--sku"),
  supplierProductId: readArg("--supplier-product-id"),
  variants: process.argv
    .flatMap((arg, index) => arg === "--variant" ? [process.argv[index + 1] || ""] : [])
    .filter(Boolean),
};

const result = inspectDsersProductCandidate(candidate);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.allowed) process.exitCode = 1;
