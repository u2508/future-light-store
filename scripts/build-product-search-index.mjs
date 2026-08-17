#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildProductSearchPayload } from "./product-search-index.mjs";
import { readProductCatalogPayload } from "./product-catalog-files.mjs";
import { writeProductSearchPayload } from "./product-search-files.mjs";
import { readCatalogKnowledgeModel } from "./catalog-knowledge-model-files.mjs";
import { scoreCatalogKnowledgeModelBatch } from "./catalog-knowledge-model-accelerator.mjs";

const dataDir = resolve(process.cwd(), "public", "data");
const knowledgePath = resolve(process.cwd(), "output", "product-knowledge.json");

function buildPrecomputedKnowledge(record, payload) {
  const family = (payload.families || []).find((entry) => entry.id === record.familyId);
  const department = (payload.departments || []).find((entry) => entry.id === record.departmentId);
  const category = (payload.categories || []).find((entry) => entry.id === record.categoryId);

  return {
    version: payload.version,
    productKnowledgeId: record.productKnowledgeId,
    typeKey: record.typeKey,
    leafType: record.specificType || record.typeKey,
    specificType: record.specificType,
    specificTypeKey: record.specificTypeKey,
    familyId: record.familyId,
    familyLabel: family?.label || record.familyId,
    taxonomyPath: [record.departmentId, record.categoryId, record.subcategoryId, record.canonicalTypeId].filter(Boolean),
    departmentId: record.departmentId,
    departmentLabel: department?.label || record.departmentId,
    categoryId: record.categoryId,
    categoryLabel: category?.label || record.categoryId,
    subcategoryId: record.subcategoryId,
    subcategoryLabel: record.subcategoryId,
    relatedCategories: record.relatedCategories || [],
    canonicalTypeId: record.canonicalTypeId,
    classificationRule: record.classificationRule,
    audience: null,
    aliases: [],
    searchTerms: record.searchTerms || [],
    negativeTerms: record.negativeTerms || [],
    attributes: record.attributes || {},
    confidence: record.confidence,
    reviewRequired: record.reviewRequired,
    modelEvidence: record.modelEvidence,
  };
}

async function readPrecomputedKnowledgeByKey(productsPayload) {
  try {
    const payload = JSON.parse(await readFile(knowledgePath, "utf8"));
    if (
      payload?.generatedAt !== productsPayload?.generatedAt ||
      Number(payload?.totalProducts) !== productsPayload?.products?.length ||
      !Array.isArray(payload.products)
    ) {
      return null;
    }

    const entries = payload.products
      .map((record) => {
        const key = String(record?.id || record?.handle || "");
        return key ? [key, buildPrecomputedKnowledge(record, payload)] : null;
      })
      .filter(Boolean);
    return entries.length === productsPayload.products.length ? new Map(entries) : null;
  } catch {
    return null;
  }
}

async function main() {
  const productsPayload = await readProductCatalogPayload(dataDir);
  const knowledgeModel = await readCatalogKnowledgeModel({
    required: process.env.SALT_REQUIRE_KNOWLEDGE_MODEL === "1",
  });
  const modelEvidenceByKey = await scoreCatalogKnowledgeModelBatch(knowledgeModel, productsPayload.products || []);
  const precomputedKnowledgeByKey = await readPrecomputedKnowledgeByKey(productsPayload);
  if (precomputedKnowledgeByKey) {
    process.stdout.write(`Reusing knowledge artifact for ${precomputedKnowledgeByKey.size} search records.\n`);
  }
  const searchPayload = buildProductSearchPayload(productsPayload, {
    knowledgeModel,
    modelEvidenceByKey,
    precomputedKnowledgeByKey,
  });

  const manifest = await writeProductSearchPayload(dataDir, searchPayload);
  process.stdout.write(
    `Saved ${searchPayload.total} compact search products to public/data/product-search.json across ${manifest.shardCount} shards (max ${manifest.shardMaxBytes} bytes each)\n`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
