#!/usr/bin/env node

import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { normalizeCollectionHandle } from "../src/lib/catalog-collection-governance.js";

const rootDir = resolve(import.meta.dirname, "..");
const manifestPath = resolve(rootDir, "output", "shopify-catalog-integrity-manifest.json");
const checkpointPath = resolve(rootDir, "output", ".shopify-catalog-integrity-live-input.json");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
if (!checkpoint.complete || !Array.isArray(checkpoint.liveProducts) || checkpoint.liveProducts.length === 0) {
  throw new Error("The catalog-integrity live checkpoint is incomplete.");
}

const normalizeTag = (value) => String(value || "").trim().toLowerCase();
const liveByHandle = new Map(checkpoint.liveProducts.map((product) => [product.handle, product]));
const managedTagUniverse = new Set(
  (manifest.tagTasks || []).flatMap((task) => task.desiredManagedTags || []).map(normalizeTag),
);
const collectionHandles = new Set([
  "all-products",
  ...(manifest.collectionTargets || []).map((target) => target?.policy?.handle),
].filter(Boolean).map(normalizeCollectionHandle));

const isManaged = (tag) => managedTagUniverse.has(normalizeTag(tag)) || collectionHandles.has(normalizeCollectionHandle(tag));
const recoveredTagTasks = [];
const recoveredClassifications = [];
for (const priorTask of manifest.tagTasks || []) {
  const liveProduct = liveByHandle.get(priorTask.handle);
  if (!liveProduct) throw new Error(`Live checkpoint is missing ${priorTask.handle}.`);
  const liveTags = Array.isArray(liveProduct.tags) ? liveProduct.tags : [];
  const desiredManagedTags = [...new Set(liveTags.filter(isManaged))];
  recoveredTagTasks.push({
    productId: liveProduct.id,
    handle: liveProduct.handle,
    desiredTags: liveTags,
    desiredManagedTags,
    tagsToAdd: [],
    tagsToRemove: [],
    status: "exact-match",
  });

  const priorClassification = (manifest.classifications || []).find((entry) => entry.handle === priorTask.handle) || {};
  const collectionTagSet = new Set(desiredManagedTags.map(normalizeCollectionHandle));
  const collectionHandlesForProduct = [...collectionHandles].filter((handle) => collectionTagSet.has(handle));
  const isReview = collectionTagSet.has("classification-review");
  recoveredClassifications.push({
    ...priorClassification,
    productId: liveProduct.id,
    handle: liveProduct.handle,
    source: isReview ? "review" : (priorClassification.source === "review" ? "taxonomy" : (priorClassification.source || "taxonomy")),
    collectionHandles: collectionHandlesForProduct,
    reused: true,
  });
}

const specialCollectionCounts = {};
for (const handle of ["creator-essentials", "anime-collectables", "hats"]) {
  specialCollectionCounts[handle] = recoveredTagTasks.filter((task) =>
    task.desiredManagedTags.some((tag) => normalizeCollectionHandle(tag) === handle),
  ).length;
}

const summary = {
  ...manifest.summary,
  activeProducts: checkpoint.liveProducts.length,
  productsNeedingTagChanges: 0,
  tagsToAdd: 0,
  tagsToRemove: 0,
  taxonomyClassified: recoveredClassifications.filter((entry) => entry.source === "taxonomy").length,
  approvedOverrides: 0,
  visionClassified: 0,
  guessedAssignments: 0,
  reusedClassifications: recoveredClassifications.length,
  collectionlessProducts: null,
  failures: null,
  specialCollectionCounts,
};

const recovered = {
  ...manifest,
  generatedAt: new Date().toISOString(),
  mode: "verify",
  summary,
  classifications: recoveredClassifications,
  tagTasks: recoveredTagTasks,
  recovery: {
    source: "complete Shopify live-input checkpoint after interrupted final readback",
    recoveredAt: new Date().toISOString(),
    liveProducts: checkpoint.liveProducts.length,
    writesPerformed: false,
  },
  completedAt: new Date().toISOString(),
};

const temporaryPath = `${manifestPath}.tmp-recovered-${process.pid}`;
await writeFile(temporaryPath, JSON.stringify(recovered, null, 2), "utf8");
await rename(temporaryPath, manifestPath);
process.stdout.write(`Recovered catalog-integrity manifest from live checkpoint: ${checkpoint.liveProducts.length} products, zero planned tag changes, no Shopify writes.\n`);
