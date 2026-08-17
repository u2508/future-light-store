#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dirname, "..");
const modelPath = process.env.SALT_CATALOG_KNOWLEDGE_MODEL_PATH ||
  resolve(rootDir, "output", "catalog-knowledge-model.json");
const evidencePath = process.env.SALT_CATALOG_KNOWLEDGE_EVIDENCE_PATH ||
  resolve(rootDir, "output", "catalog-knowledge-model-evidence.json");

export async function readCatalogKnowledgeModel({ required = false } = {}) {
  try {
    const model = JSON.parse(await readFile(modelPath, "utf8"));
    if (!model || typeof model !== "object") throw new Error("knowledge model is not an object");
    return model;
  } catch (error) {
    if (required && process.env.SALT_CATALOG_KNOWLEDGE_EVIDENCE_PATH) {
      const evidenceCache = JSON.parse(await readFile(evidencePath, "utf8"));
      return {
        modelVersion: Object.values(evidenceCache.evidence || {})[0]?.modelVersion || "unknown",
        trainingRecords: Object.values(evidenceCache.evidence || {})[0]?.trainingRecords || 0,
        rules: [],
        evidenceCache,
      };
    }
    if (required) {
      throw new Error(`Catalog knowledge model is required but could not be read from ${modelPath}: ${error.message}`);
    }
    return null;
  }
}
