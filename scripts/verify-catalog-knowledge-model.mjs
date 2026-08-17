#!/usr/bin/env node

import {
  assertCatalogKnowledgeModel,
  summarizeCatalogKnowledgeModel,
} from "../src/lib/catalog-knowledge-model.js";
import { readCatalogKnowledgeModel } from "./catalog-knowledge-model-files.mjs";

async function main() {
  const model = await readCatalogKnowledgeModel({ required: true });
  assertCatalogKnowledgeModel(model);
  process.stdout.write(`${JSON.stringify({
    status: "verified",
    ...summarizeCatalogKnowledgeModel(model),
    validation: model.validation,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
