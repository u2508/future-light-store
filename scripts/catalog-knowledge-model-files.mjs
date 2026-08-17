#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dirname, "..");
const defaultModelPath = resolve(rootDir, "output", "catalog-knowledge-model.json");

export const catalogKnowledgeModelPath = process.env.SALT_CATALOG_KNOWLEDGE_MODEL_PATH || defaultModelPath;

export async function readCatalogKnowledgeModel({ required = false } = {}) {
  try {
    const model = JSON.parse(await readFile(catalogKnowledgeModelPath, "utf8"));
    if (!model || typeof model !== "object") throw new Error("knowledge model is not an object");
    return model;
  } catch (error) {
    if (required) {
      throw new Error(`Catalog knowledge model is required but could not be read from ${catalogKnowledgeModelPath}: ${error.message}`);
    }
    return null;
  }
}
