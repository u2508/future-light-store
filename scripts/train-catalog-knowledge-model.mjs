#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  CATALOG_KNOWLEDGE_MODEL_RECORDS,
  trainCatalogKnowledgeModel,
} from "../src/lib/catalog-knowledge-model.js";

const rootDir = resolve(import.meta.dirname, "..");
const defaultOutput = resolve(rootDir, "output", "catalog-knowledge-model.json");

function parseArgs(argv) {
  const args = { records: CATALOG_KNOWLEDGE_MODEL_RECORDS, output: defaultOutput };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--records") {
      args.records = Number(next);
      index += 1;
    } else if (token === "--output") {
      if (!next) throw new Error("Missing value for --output.");
      args.output = resolve(rootDir, next);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const model = trainCatalogKnowledgeModel({ records: args.records });
  await mkdir(dirname(args.output), { recursive: true });
  await writeFile(args.output, `${JSON.stringify(model, null, 2)}\n`, "utf8");
  process.stdout.write(`Trained catalog knowledge model on ${model.trainingRecords} deterministic records with ${model.representativeRules} representatives at ${args.output}.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
