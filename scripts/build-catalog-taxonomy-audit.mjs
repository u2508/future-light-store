#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  CATALOG_TAXONOMY_VERSION,
  getCatalogDepartmentDefinitions,
  getCatalogTaxonomyDefinitions,
} from "../src/lib/catalog-taxonomy.js";
import { CATALOG_COLLECTION_PLAN } from "../src/lib/catalog-collection-plan.js";
import { buildProductKnowledgePayload, classifyProductKnowledge } from "../src/lib/product-knowledge-base.js";
import { readProductCatalogPayload } from "./product-catalog-files.mjs";
import { readCatalogKnowledgeModel } from "./catalog-knowledge-model-files.mjs";
import { scoreCatalogKnowledgeModelBatch } from "./catalog-knowledge-model-accelerator.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const dataDir = resolve(rootDir, "public", "data");
const outputDir = resolve(rootDir, "output");
const outputPath = resolve(outputDir, "catalog-taxonomy-audit.json");
const tagsPath = resolve(outputDir, "catalog-tag-proposal.md");
const existingTagsPath = resolve(outputDir, "catalog-existing-tag-inventory.md");
const liveTagInventoryPath = resolve(outputDir, "catalog-live-tag-inventory.json");
const collectionsPath = resolve(outputDir, "catalog-collection-rationalization.md");
const reviewPath = resolve(outputDir, "catalog-taxonomy-review.csv");

const MERGE_TARGETS = Object.freeze({
  "blush-glow": "beauty-makeup-essentials",
  "womens-beauty-essentials": "beauty-makeup-essentials",
  "lips-and-care": "beauty-makeup-essentials",
  "eye-beauty-collection": "beauty-makeup-essentials",
  "women-watches": "watches",
  "women-bags-and-wallets": "bags-wallets",
  "t-shirt": "men-collection",
  trousers: "men-collection",
  jeans: "men-collection",
  robe: "men-collection",
  "wall-lights": "home-decor",
  candles: "home-decor",
  "coffee-tea-accessories": "dining-essentials",
  "dining-essentials": "cookware",
  "massage-tools": "health-wellness",
  "posture-support": "health-wellness",
  "sleep-essentials": "health-wellness",
  "relaxation-products": "health-wellness",
  "mobility-support": "health-wellness",
  "caregiver-essentials": "health-wellness",
  "home-safety": "health-wellness",
  "garden-tools": "home-decor",
  "artificial-aquarium-decor-plants": "home-decor",
  "viral-tiktok-products": "unique-products",
  "staff-picks": "unique-products",
  "best-sellers": "appplaza-best-sellers",
  "pet-assocerries": "pet-essentials",
  "dog-supplies": "pet-assocerries",
  "cat-supplies": "pet-assocerries",
  "pet-feeding": "pet-assocerries",
  "pet-grooming": "pet-assocerries",
  "pet-toys": "pet-assocerries",
  "pet-travel": "pet-assocerries",
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function countBy(records, getKey, getLabel = getKey) {
  const result = new Map();
  for (const record of records) {
    const key = String(getKey(record) || "").trim() || "unknown";
    const label = String(getLabel(record) || key).trim() || key;
    const current = result.get(key) || { id: key, label, products: 0 };
    current.products += 1;
    result.set(key, current);
  }
  return [...result.values()].sort((left, right) => right.products - left.products || left.label.localeCompare(right.label));
}

function countTags(records) {
  const counts = new Map();
  for (const record of records) {
    for (const tag of record.proposedTags) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, products]) => ({ tag, products }))
    .sort((left, right) => right.products - left.products || left.tag.localeCompare(right.tag));
}

function addCount(counts, key) {
  const normalized = String(key || "").replace(/\s+/g, " ").trim();
  if (!normalized) return;
  counts.set(normalized, (counts.get(normalized) || 0) + 1);
}

function topCounts(counts, limit = 2) {
  return [...counts.entries()]
    .map(([label, products]) => ({ label, products }))
    .sort((left, right) => right.products - left.products || left.label.localeCompare(right.label))
    .slice(0, limit);
}

function extractInventoryTags(inventory) {
  return unique(
    asArray(inventory?.tags)
      .map((entry) => (typeof entry === "string" ? entry : entry?.tag || entry?.name || ""))
      .map((entry) => String(entry).replace(/\s+/g, " ").trim()),
  );
}

async function readLiveTagInventory() {
  try {
    const inventory = JSON.parse(await readFile(liveTagInventoryPath, "utf8"));
    return {
      inventory,
      readError: "",
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        inventory: null,
        readError: "No live Shopify tag-inventory artifact is present.",
      };
    }
    return {
      inventory: null,
      readError: `Could not read the Shopify tag-inventory artifact: ${error.message}`,
    };
  }
}

function buildExistingTagInventory(records, inventory) {
  const byTag = new Map();

  function ensure(tag) {
    const normalized = String(tag || "").replace(/\s+/g, " ").trim();
    if (!normalized) return null;
    if (!byTag.has(normalized)) {
      byTag.set(normalized, {
        tag: normalized,
        sources: new Set(),
        productIds: new Set(),
        reviewProductIds: new Set(),
        taxonomyGroups: new Map(),
      });
    }
    return byTag.get(normalized);
  }

  for (const tag of extractInventoryTags(inventory)) {
    ensure(tag)?.sources.add(inventory?.verifiedLive ? "verified-live" : "tag-inventory-snapshot");
  }

  for (const record of records) {
    for (const tag of unique(record.existingTags.map((entry) => String(entry).replace(/\s+/g, " ").trim()))) {
      const entry = ensure(tag);
      if (!entry) continue;
      entry.sources.add("catalog-snapshot");
      entry.productIds.add(record.id);
      if (record.reviewRequired || !record.seoEligible) entry.reviewProductIds.add(record.id);
      addCount(entry.taxonomyGroups, `${record.categoryLabel} > ${record.subcategoryLabel}`);
    }
  }

  return [...byTag.values()]
    .map((entry) => {
      const products = entry.productIds.size;
      const dominant = topCounts(entry.taxonomyGroups, 2);
      const dominantProducts = dominant[0]?.products || 0;
      const dominantShare = products ? dominantProducts / products : 0;
      const reviewProducts = entry.reviewProductIds.size;
      let plannedUse = "preserve only; no current catalog assignment";

      if (products && reviewProducts) {
        plannedUse = "preserve; search discovery and low-priority evidence only while affected products are reviewed";
      } else if (products && dominantShare < 0.8) {
        plannedUse = "preserve; search discovery and low-priority evidence only because current usage is mixed";
      } else if (products) {
        plannedUse = "preserve; search discovery and low-priority classification evidence";
      }

      return {
        tag: entry.tag,
        products,
        reviewProducts,
        dominantClassification: dominant.length
          ? dominant.map((row) => `${row.label} (${row.products.toLocaleString()})`).join(", ")
          : "No current catalog assignment",
        dominantShare,
        observedInLiveInventory: entry.sources.has("verified-live"),
        observedInTagInventorySnapshot: entry.sources.has("tag-inventory-snapshot"),
        observedInCatalogSnapshot: entry.sources.has("catalog-snapshot"),
        plannedUse,
      };
    })
    .sort((left, right) => right.products - left.products || left.tag.localeCompare(right.tag));
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join(" | ") : value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function renderCsv(records) {
  const header = [
    "Product ID",
    "Handle",
    "Title",
    "Classification Rule",
    "Department",
    "Category",
    "Subcategory",
    "Canonical Type",
    "Audience",
    "Confidence",
    "Review Required",
    "Review Reasons",
    "Existing Shopify Tags",
    "Existing Tags Preserved",
    "Proposed SALT Tags",
    "Tags To Remove",
    "Collection Targets",
    "Shopify Category",
  ];
  const rows = records.map((record) => [
    record.id,
    record.handle,
    record.title,
    record.classificationRule,
    record.departmentLabel,
    record.categoryLabel,
    record.subcategoryLabel,
    record.canonicalType,
    record.audience.id,
    record.confidence,
    record.reviewRequired ? "yes" : "no",
    record.reviewReasons,
    record.existingTags,
    "yes",
    record.proposedTags,
    "",
    record.collectionTargets,
    record.shopifyCategory || "",
  ]);
  return `${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function toProductRecord(product, knowledgeModel = null, modelEvidence = undefined) {
  const knowledge = classifyProductKnowledge(product, { knowledgeModel, modelEvidence });
  const variants = asArray(product?.variants);
  return {
    id: Number(product?.id) || 0,
    handle: String(product?.handle || "").trim(),
    title: String(product?.title || "").replace(/\s+/g, " ").trim(),
    productType: String(product?.product_type || product?.productType || "").trim(),
    productKnowledgeId: knowledge.productKnowledgeId,
    specificType: knowledge.specificType,
    specificTypeKey: knowledge.specificTypeKey,
    existingTags: asArray(product?.tags).map((entry) => String(entry).trim()).filter(Boolean),
    classificationRule: knowledge.classificationRule,
    familyId: knowledge.familyId,
    familyLabel: knowledge.familyLabel,
    departmentId: knowledge.departmentId,
    departmentLabel: knowledge.departmentLabel,
    categoryId: knowledge.categoryId,
    categoryLabel: knowledge.categoryLabel,
    subcategoryId: knowledge.subcategoryId,
    subcategoryLabel: knowledge.subcategoryLabel,
    canonicalType: knowledge.canonicalType,
    canonicalTypeId: knowledge.canonicalTypeId,
    audience: knowledge.audience,
    confidence: knowledge.confidence,
    modelEvidence: knowledge.modelEvidence,
    reviewRequired: knowledge.reviewRequired,
    reviewReasons: knowledge.reviewReasons,
    seoEligible: knowledge.seoEligible,
    proposedTags: knowledge.proposedTags,
    collectionTargets: knowledge.collectionTargets,
    shopifyCategory: knowledge.shopifyCategory,
    evidence: knowledge.evidence,
    variantCount: variants.length,
    variantsWithFeaturedImage: variants.filter((variant) => Boolean(variant?.featured_image?.src)).length,
  };
}

function buildCollectionPlan(records, collections) {
  const collectionsByHandle = new Map(
    asArray(collections).map((collection) => [String(collection?.handle || "").trim(), collection]),
  );
  const rows = new Map();

  for (const record of records) {
    const key = `${record.categoryId}/${record.subcategoryId}`;
    if (!rows.has(key)) {
      rows.set(key, {
        key,
        categoryId: record.categoryId,
        categoryLabel: record.categoryLabel,
        subcategoryId: record.subcategoryId,
        subcategoryLabel: record.subcategoryLabel,
        products: 0,
        eligibleProducts: 0,
        heldProducts: 0,
        existingTargets: new Set(),
        missingTargets: new Set(),
      });
    }
    const row = rows.get(key);
    row.products += 1;
    if (record.reviewRequired || !record.seoEligible) {
      row.heldProducts += 1;
      continue;
    }
    row.eligibleProducts += 1;
    for (const target of record.collectionTargets) {
      if (collectionsByHandle.has(target)) row.existingTargets.add(target);
      else row.missingTargets.add(target);
    }
  }

  const taxonomyPlans = [...rows.values()]
    .map((row) => ({
      ...row,
      existingTargets: [...row.existingTargets],
      missingTargets: [...row.missingTargets],
      action:
        row.categoryId === "unclassified" || row.eligibleProducts === 0
          ? "manual-review-only"
          : row.existingTargets.size > 0
          ? "map-to-existing-collection"
          : row.eligibleProducts >= 50
            ? "request-new-collection"
            : "keep-as-search-filter-only",
    }))
    .sort((left, right) => right.products - left.products || left.key.localeCompare(right.key));

  const lowVolumeCollections = asArray(collections)
    .map((collection) => {
      const handle = String(collection?.handle || "").trim();
      const products = Number(collection?.products_count || 0);
      const mergeTarget = MERGE_TARGETS[handle] || "";
      return {
        handle,
        title: String(collection?.title || "").trim(),
        products,
        action:
          products === 0
            ? mergeTarget
              ? "rebuild-or-merge-after-approval"
              : "archive-or-rebuild-after-approval"
            : products < 50
              ? mergeTarget
                ? "merge-after-approval"
                : "manual-merge-target-required"
              : "keep",
        mergeTarget,
      };
    })
    .filter((collection) => collection.products < 50)
    .sort((left, right) => left.products - right.products || left.title.localeCompare(right.title));

  return { taxonomyPlans, lowVolumeCollections };
}

function tagMarkdown(tagCounts, existingTags, tagInventorySource) {
  const existingAssignments = existingTags.reduce((total, entry) => total + entry.products, 0);
  const lines = [
    "# SALT Catalog Tag Proposal",
    "",
    `Taxonomy version: \`${CATALOG_TAXONOMY_VERSION}\``,
    "",
    "## Approval Boundary",
    "",
    "This is a read-only proposal. No Shopify tags, metafields, categories, variants, prices, publication settings, or collections were changed while generating it.",
    "",
    "## Tag Policy",
    "",
    "- Preserve every existing merchant and supplier tag exactly as-is.",
    "- Add only controlled canonical simple tags after written approval.",
    "- Use product knowledge aliases for shopper search. Do not create free-form alias tags for every query.",
    "- Low-confidence classifications remain untagged until reviewed; the review CSV identifies them.",
    "",
    "## Existing Shopify Tags Are Not The Controlled Vocabulary",
    "",
    `- ${existingTags.length.toLocaleString()} existing Shopify tags with ${existingAssignments.toLocaleString()} current product assignments are documented separately in \`output/catalog-existing-tag-inventory.md\`.`,
    `- The ${tagCounts.length.toLocaleString()} tags below are proposed canonical simple tags, not a replacement for unrelated merchant tags.`,
    `- Inventory source: ${tagInventorySource}.`,
    "- Existing tags stay available for raw shopper discovery and low-priority evidence. They never override title, handle, or product-type evidence, and they are never used alone as collection rules.",
    "- Any future apply must add canonical simple tags before removing their mapped legacy SALT tags and must verify every unrelated merchant tag remains present.",
    "",
    "## Controlled Vocabulary",
    "",
    "| Proposed tag | Products |",
    "| --- | ---: |",
    ...tagCounts.map((entry) => `| \`${entry.tag}\` | ${entry.products.toLocaleString()} |`),
    "",
    "## Tag Families",
    "",
    "- Department, category, type, audience, feature, and compatibility values use normalized simple tags.",
    "",
  ];
  return lines.join("\n");
}

function markdownCell(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function existingTagMarkdown(existingTags, tagInventorySource) {
  const assignments = existingTags.reduce((total, entry) => total + entry.products, 0);
  const lines = [
    "# Existing Shopify Tag Inventory",
    "",
    `Taxonomy version: \`${CATALOG_TAXONOMY_VERSION}\``,
    "",
    "## Preservation Contract",
    "",
    "Every tag below is preserved exactly as it currently exists, including spelling, capitalization, and legacy supplier wording. This taxonomy never deletes, rewrites, or normalizes an existing Shopify tag.",
    "",
    `Source: ${tagInventorySource}.`,
    `Current catalog snapshot: ${existingTags.length.toLocaleString()} distinct tags across ${assignments.toLocaleString()} product-tag assignments.`,
    "",
    "## How Existing Tags Are Used",
    "",
    "- They remain searchable by their original wording, including terms such as `earbuds`, `WOMEN FAISHON`, and `Hair Nourishment`.",
    "- They contribute low-priority evidence only after title, handle, and explicit product type. This prevents an old or broad tag from turning a belt into pants or a charger into lighting.",
    "- They do not create, rename, or drive Shopify collections. Canonical simple collection tags are the only collection-rule inputs.",
    "- The per-product review CSV marks existing tags as preserved and has an intentionally empty `Tags To Remove` column.",
    "",
    "## Exact Existing Tag List",
    "",
    "| Existing Shopify tag | Products in current snapshot | Dominant classified use | Review-held products | Planned use |",
    "| --- | ---: | --- | ---: | --- |",
    ...existingTags.map(
      (entry) =>
        `| ${markdownCell(entry.tag)} | ${entry.products.toLocaleString()} | ${markdownCell(entry.dominantClassification)} | ${entry.reviewProducts.toLocaleString()} | ${markdownCell(entry.plannedUse)} |`,
    ),
    "",
  ];
  return lines.join("\n");
}

async function collectionMarkdown(plan, collections) {
  let collectionRelease = null;
  try {
    collectionRelease = JSON.parse(await readFile(resolve(outputDir, "catalog-collection-release-manifest.json"), "utf8"));
  } catch {
    // The audit can run before the separately approved collection release.
  }
  let collectionMergeRelease = null;
  try {
    collectionMergeRelease = JSON.parse(await readFile(resolve(outputDir, "catalog-collection-merge-manifest.json"), "utf8"));
  } catch {
    // The audit can run before the separately approved legacy merge release.
  }
  const canonicalApplyVerified = Boolean(
    collectionRelease?.completedAt &&
      collectionRelease?.summary?.canonicalCollections === CATALOG_COLLECTION_PLAN.length &&
      collectionRelease?.summary?.failed === 0,
  );
  const mergeApplyVerified = Boolean(
    collectionMergeRelease?.completedAt &&
      collectionMergeRelease?.summary?.sourceCollections === 6 &&
      collectionMergeRelease?.summary?.failures === 0,
  );
  const lines = [
    `# SALT Collection Rationalization${canonicalApplyVerified ? " and Apply Audit" : " Proposal"}`,
    "",
    `Taxonomy version: \`${CATALOG_TAXONOMY_VERSION}\``,
    "",
    "## Canonical Collection Apply",
    "",
    canonicalApplyVerified
      ? `The ${CATALOG_COLLECTION_PLAN.length} canonical collection rules were applied and verified in live Shopify under approval \`${collectionRelease.approvalId}\`. Their Online Store publications and controlled tag sources were read back successfully.${mergeApplyVerified ? ` The six separately approved legacy merges were then applied under approval \`${collectionMergeRelease.approvalId}\`; source collection records were preserved in Admin and removed from Online Store publication.` : " Existing legacy merge/archive actions remain outside that approval and were not performed."}`
      : "Canonical collection changes remain separately approval-gated. Existing Shopify collections are not changed, merged, archived, or recreated by this audit.",
    "",
    ...(mergeApplyVerified
      ? [
          "## Approved Legacy Merge Apply",
          "",
          "The six approved source collections were merged without forcing unrelated products into taxonomy collections. Health & Wellness and Camping & Travel Essentials kept their controlled tag rules; Gifts Collection and Trending Finds unioned their existing merchandising conditions. The six source records remain in Shopify Admin for recovery and are no longer published to Online Store.",
          "",
          "| Source collection | Target collection | Mode | Source products read | Evidence-aligned products | Target count after |",
          "| --- | --- | --- | ---: | ---: | ---: |",
          ...asArray(collectionMergeRelease.sourceCollections).map((row) => `| \`${row.sourceHandle}\` | \`${row.targetHandle}\` | ${row.mode} | ${Number(row.sourceProductCount || 0).toLocaleString()} | ${Number(row.eligibleForTarget || 0).toLocaleString()} | ${Number(row.targetProductCountAfter || 0).toLocaleString()} |`),
          "",
        ]
      : []),
    "## Taxonomy To Existing Collection Mapping",
    "",
    "| Taxonomy group | Eligible products | Held for review | Existing target(s) | Missing target(s) | Proposed action |",
    "| --- | ---: | ---: | --- | --- | --- |",
    ...plan.taxonomyPlans.map((row) => `| ${row.categoryLabel} > ${row.subcategoryLabel} | ${row.eligibleProducts.toLocaleString()} | ${row.heldProducts.toLocaleString()} | ${row.existingTargets.length ? row.existingTargets.map((value) => `\`${value}\``).join(", ") : "-"} | ${row.missingTargets.length ? row.missingTargets.map((value) => `\`${value}\``).join(", ") : "-"} | ${row.action} |`),
    "",
    "## New Collection Candidates Requiring Permission",
    "",
    "Only categories with 50 or more matching products and no existing target are listed below. They will remain search filters until explicitly approved.",
    "",
    "| Candidate collection | Products | Why it is needed |",
    "| --- | ---: | --- |",
    ...plan.taxonomyPlans
      .filter((row) => row.action === "request-new-collection")
      .map((row) => `| ${row.subcategoryLabel} | ${row.eligibleProducts.toLocaleString()} | No existing collection maps to ${row.categoryLabel} > ${row.subcategoryLabel}. |`),
    "",
    "## Existing Collections Under 50 Products",
    "",
    `Current Shopify snapshot contains ${asArray(collections).length} collections. The rows below meet the under-50 rule and still require separate approval before any merge or archive.`,
    "",
    "| Current collection | Products | Suggested action | Suggested target |",
    "| --- | ---: | --- | --- |",
    ...plan.lowVolumeCollections.map((row) => `| ${row.title || row.handle} (\`${row.handle}\`) | ${row.products.toLocaleString()} | ${row.action} | ${row.mergeTarget ? `\`${row.mergeTarget}\`` : "Needs taxonomy review"} |`),
    "",
  ];
  return `${lines.join("\n").trimEnd()}\n`;
}

async function main() {
  const [productsPayload, collectionsPayload] = await Promise.all([
    readProductCatalogPayload(dataDir),
    readFile(resolve(dataDir, "collections.json"), "utf8").then(JSON.parse),
  ]);
  const products = asArray(productsPayload?.products);
  const collections = asArray(collectionsPayload?.collections);
  const knowledgeModel = await readCatalogKnowledgeModel({
    required: process.env.SALT_REQUIRE_KNOWLEDGE_MODEL === "1",
  });
  const modelEvidenceByKey = await scoreCatalogKnowledgeModelBatch(knowledgeModel, products);
  if (modelEvidenceByKey) {
    process.stdout.write(`MLX/Metal knowledge scoring completed for ${modelEvidenceByKey.size}/${products.length} products.\n`);
  }
  const records = products
    .map((product) => toProductRecord(
      product,
      knowledgeModel,
      modelEvidenceByKey?.get(String(product?.id || product?.handle || "")),
    ))
    .filter((record) => record.id && record.handle);
  const reviewQueue = records.filter((record) => record.reviewRequired);
  const safeForApproval = records.filter((record) => record.seoEligible && !record.reviewRequired);
  const tagCounts = countTags(safeForApproval);
  const collectionPlan = buildCollectionPlan(records, collections);
  const tagInventoryRead = await readLiveTagInventory();
  const existingTags = buildExistingTagInventory(records, tagInventoryRead.inventory);
  const tagInventorySource = tagInventoryRead.inventory?.verifiedLive
    ? `verified live Shopify Admin tag read at ${tagInventoryRead.inventory.generatedAt || "an unknown time"}`
    : tagInventoryRead.inventory
      ? `catalog-sync tag snapshot at ${tagInventoryRead.inventory?.source?.productGeneratedAt || tagInventoryRead.inventory.generatedAt || "an unknown time"}; live verification is pending`
      : `catalog-sync snapshot only; ${tagInventoryRead.readError}`;
  const variants = {
    productsWithVariants: records.filter((record) => record.variantCount > 0).length,
    totalVariants: records.reduce((total, record) => total + record.variantCount, 0),
    variantsWithFeaturedImage: records.reduce((total, record) => total + record.variantsWithFeaturedImage, 0),
  };
  variants.variantsWithoutFeaturedImage = variants.totalVariants - variants.variantsWithFeaturedImage;

  const knowledgePayload = buildProductKnowledgePayload(productsPayload, {
    knowledgeModel,
    modelEvidenceByKey,
  });
  const manifest = {
    version: CATALOG_TAXONOMY_VERSION,
    generatedAt: new Date().toISOString(),
    source: {
      productGeneratedAt: productsPayload?.generatedAt || null,
      totalProducts: products.length,
      totalCollections: collections.length,
    },
    policy: {
      mode: "read-only-proposal",
      applyRequiresUserApproval: true,
      preserveExistingTags: true,
      existingTagMutation: "none",
      approvedManagedTagApply: "add-only with a live tag-superset verification",
      managedTagSyntax: "canonical simple tags",
      lowConfidencePolicy: "review-before-apply",
    },
    summary: {
      classified: records.length,
      readyForReview: safeForApproval.length,
      reviewRequired: reviewQueue.length,
      variants,
      departments: countBy(records, (record) => record.departmentId, (record) => record.departmentLabel),
      categories: countBy(records, (record) => record.categoryId, (record) => record.categoryLabel),
      subcategories: countBy(records, (record) => record.subcategoryId, (record) => record.subcategoryLabel),
      families: countBy(records, (record) => record.familyId, (record) => record.familyLabel),
      rules: countBy(records, (record) => record.classificationRule, (record) => record.classificationRule),
      existingTags: {
        distinctTags: existingTags.length,
        productTagAssignments: existingTags.reduce((total, entry) => total + entry.products, 0),
        inventorySource: tagInventorySource,
        verifiedLive: Boolean(tagInventoryRead.inventory?.verifiedLive),
        tags: existingTags,
      },
      proposedTags: tagCounts,
      taxonomyDefinitions: getCatalogTaxonomyDefinitions(),
      departmentDefinitions: getCatalogDepartmentDefinitions(),
    },
    collectionPlan,
    reviewQueue,
    products: records,
    knowledge: {
      totalProducts: knowledgePayload.totalProducts,
      uniqueProductTypes: knowledgePayload.uniqueProductTypes,
      uniqueProductKnowledgeRecords: knowledgePayload.uniqueProductKnowledgeRecords,
      uniqueSpecificProductTypes: new Set(records.map((record) => record.specificTypeKey)).size,
      model: knowledgePayload.knowledgeModel,
      families: knowledgePayload.families,
      departments: knowledgePayload.departments,
      categories: knowledgePayload.categories,
    },
  };

  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
    writeFile(tagsPath, tagMarkdown(tagCounts, existingTags, tagInventorySource), "utf8"),
    writeFile(existingTagsPath, existingTagMarkdown(existingTags, tagInventorySource), "utf8"),
    writeFile(collectionsPath, await collectionMarkdown(collectionPlan, collections), "utf8"),
    writeFile(reviewPath, renderCsv(reviewQueue), "utf8"),
  ]);

  process.stdout.write(`${JSON.stringify({
    version: manifest.version,
    catalogProducts: records.length,
    readyForReview: safeForApproval.length,
    reviewRequired: reviewQueue.length,
    uniqueProductTypes: knowledgePayload.uniqueProductTypes,
    uniqueProductKnowledgeRecords: knowledgePayload.uniqueProductKnowledgeRecords,
    uniqueSpecificProductTypes: manifest.knowledge.uniqueSpecificProductTypes,
    proposedTags: tagCounts.length,
    existingShopifyTags: existingTags.length,
    existingShopifyTagAssignments: existingTags.reduce((total, entry) => total + entry.products, 0),
    liveTagInventoryVerified: Boolean(tagInventoryRead.inventory?.verifiedLive),
    newCollectionCandidates: collectionPlan.taxonomyPlans.filter((row) => row.action === "request-new-collection").length,
    under50Collections: collectionPlan.lowVolumeCollections.length,
    variants,
    outputPath,
    tagsPath,
    existingTagsPath,
    collectionsPath,
    reviewPath,
  }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
