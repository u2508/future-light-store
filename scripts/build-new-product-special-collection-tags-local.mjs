#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dirname, "..");
const futureLightProfile = process.env.FUTURE_LIGHT_STORE === "1" ||
  String(process.env.SALT_RELEASE_NAME || "").toLowerCase().includes("future light");
const manifestPath = process.env.SALT_SPECIAL_COLLECTION_MANIFEST_PATH ||
  resolve(rootDir, "output", "catalog-special-collection-tags.json");
let manifest = { assignments: [] };
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (error) {
  if (!futureLightProfile) throw error;
}

export const SPECIAL_COLLECTION_MINIMUMS = Object.freeze(futureLightProfile ? {} : {
  "creator-essentials": 500,
  "anime-collectables": 1000,
});

export function buildSpecialCollectionAssignments(products) {
  const activeHandles = new Set(products.map((product) => String(product?.handle || "").toLowerCase()));
  const assignments = new Map((manifest.assignments || [])
    .filter((assignment) => activeHandles.has(String(assignment?.handle || "").toLowerCase()))
    .map((assignment) => [String(assignment.handle).toLowerCase(), {
      handle: assignment.handle,
      tags: assignment.tags || [],
      matchedCollections: assignment.matchedCollections || [],
      matchedSignals: assignment.matchedSignals || [],
      rationale: assignment.rationale || "Full-catalog deterministic special-collection manifest.",
    }]));
  for (const product of products) {
    const tags = (product?.tags || []).map((tag) => String(tag).toLowerCase());
    const handle = String(product?.handle || "").toLowerCase();
    for (const collection of Object.keys(SPECIAL_COLLECTION_MINIMUMS)) {
      const tagMatches = tags.includes(collection) || tags.includes(`salt:category:${collection}`);
      if (tagMatches && !assignments.has(handle)) {
        assignments.set(handle, {
          handle: product.handle,
          tags: [`salt:category:${collection}`],
          matchedCollections: [collection],
          matchedSignals: ["current live canonical collection tag"],
          rationale: "Current live canonical tag preserved during full-catalog verification.",
        });
      }
    }
  }
  return [...assignments.values()];
}

export function assertSpecialCollectionMinimums(counts) {
  const failures = Object.entries(SPECIAL_COLLECTION_MINIMUMS)
    .filter(([handle, minimum]) => Number(counts?.[handle] || 0) < minimum)
    .map(([handle, minimum]) => `${handle}: ${counts?.[handle] || 0}/${minimum}`);
  if (failures.length) throw new Error(`Special collection minimum gate failed: ${failures.join(", ")}`);
}
