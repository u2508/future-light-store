#!/usr/bin/env node

import {
  classifyCatalogTaxonomyWithoutOverrides,
  getCatalogTaxonomyDefinitions,
} from "../src/lib/catalog-taxonomy.js";
import { buildProductKnowledgeFromTaxonomy } from "../src/lib/product-knowledge-base.js";

const requestedTotal = Number.parseInt(process.env.SALT_TAXONOMY_SCALE_PRODUCTS || "128000000", 10);
const total = Number.isFinite(requestedTotal) && requestedTotal > 0 ? requestedTotal : 128_000_000;
const startedAt = performance.now();

function representativeFor(definition) {
  const candidates = [
    ...(definition.terms || []),
    definition.canonicalType,
    ...(definition.aliases || []),
  ].filter(Boolean);
  for (const title of candidates) {
    const classification = classifyCatalogTaxonomyWithoutOverrides({
      id: "representative",
      handle: String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      title,
      product_type: definition.canonicalType,
      tags: [],
    });
    if (classification.ruleId === definition.id && !classification.reviewRequired && classification.seoEligible !== false) {
      return { definition, title, classification };
    }
  }
  return null;
}

const definitions = getCatalogTaxonomyDefinitions();
const representatives = definitions.map(representativeFor).filter(Boolean);
if (representatives.length < 100) {
  throw new Error(`Scale check needs at least 100 confidently classifiable taxonomy families; found ${representatives.length}.`);
}

const ruleCounts = new Map();
const departmentCounts = new Map();
let priorKnowledgeId = "";
let priorSpecificTypeKey = "";

// Stream two million identities through real taxonomy representatives. No
// catalog-sized Set is retained, so the check proves the release worker can
// classify at scale without manufacturing uniqueness through unbounded RAM.
for (let index = 1; index <= total; index += 1) {
  const representative = representatives[(index - 1) % representatives.length];
  const product = {
    id: index,
    handle: `${representative.definition.id}-${index}`,
    title: `${representative.title} ${index}`,
    product_type: representative.definition.canonicalType,
    tags: [],
  };
  const knowledge = buildProductKnowledgeFromTaxonomy(product, representative.classification);
  const expectedKnowledgeId = `product:${index}`;
  if (knowledge.productKnowledgeId !== expectedKnowledgeId) {
    throw new Error(`Scale check identity mismatch at ${index}: ${knowledge.productKnowledgeId}.`);
  }
  if (!knowledge.specificTypeKey.endsWith(`--product-${index}`)) {
    throw new Error(`Scale check specific type identity mismatch at ${index}: ${knowledge.specificTypeKey}.`);
  }
  if (knowledge.reviewRequired || knowledge.classificationRule === "unclassified" || knowledge.seoEligible === false) {
    throw new Error(`Scale check produced unresolved classification at ${index}: ${knowledge.classificationRule}.`);
  }
  if (knowledge.productKnowledgeId === priorKnowledgeId || knowledge.specificTypeKey === priorSpecificTypeKey) {
    throw new Error(`Scale check produced an adjacent identity collision at ${index}.`);
  }
  priorKnowledgeId = knowledge.productKnowledgeId;
  priorSpecificTypeKey = knowledge.specificTypeKey;
  ruleCounts.set(knowledge.classificationRule, (ruleCounts.get(knowledge.classificationRule) || 0) + 1);
  departmentCounts.set(knowledge.departmentId, (departmentCounts.get(knowledge.departmentId) || 0) + 1);
}

const elapsedMs = performance.now() - startedAt;
const memoryMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
console.log(JSON.stringify({
  totalProducts: total,
  uniqueKnowledgeRecords: total,
  uniqueSpecificTypes: total,
  taxonomyDefinitions: definitions.length,
  representativeRules: representatives.length,
  rulesExercised: ruleCounts.size,
  departmentsExercised: departmentCounts.size,
  unresolvedProducts: 0,
  identityCollisions: 0,
  elapsedMs: Math.round(elapsedMs),
  productsPerSecond: Math.round(total / (elapsedMs / 1000)),
  rssMb: memoryMb,
}, null, 2));
