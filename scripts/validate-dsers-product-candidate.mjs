#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { inspectDsersProductCandidate } from "../src/lib/dsers-product-policy.mjs";

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || "" : "";
}

function readBoolean(name) {
  const value = readArg(name).trim().toLowerCase();
  if (value === "true" || value === "yes" || value === "1") return true;
  if (value === "false" || value === "no" || value === "0") return false;
  return undefined;
}

function readNumber(name) {
  const value = readArg(name);
  return value === "" ? undefined : Number(value);
}

function candidateFromFlags() {
  return {
    title: readArg("--title"),
    description: readArg("--description"),
    sku: readArg("--sku"),
    supplierProductId: readArg("--supplier-product-id"),
    searchFamily: readArg("--search-family"),
    searchTerm: readArg("--search-term"),
    collectionLane: readArg("--collection-lane"),
    supplierStock: readNumber("--stock"),
    supplierCost: readNumber("--cost"),
    proposedUsPrice: readNumber("--us-price"),
    shippingCost: readNumber("--shipping-cost"),
    shippingDestination: readArg("--shipping-destination"),
    imageCount: readNumber("--image-count"),
    costStable: readBoolean("--cost-stable"),
    shippingEvidence: readBoolean("--shipping-evidence"),
    imagesUsable: readBoolean("--images-usable"),
    primaryImageMatchesProduct: readBoolean("--primary-image-matches"),
    supplierWatermarkDominates: readBoolean("--supplier-watermark-dominates"),
    chinaFocusedSceneDominates: readBoolean("--china-scene-dominates"),
    variantMappingClear: readBoolean("--variant-mapping-clear"),
    duplicateCheckComplete: readBoolean("--duplicate-check-complete"),
    isDuplicate: readBoolean("--is-duplicate"),
    isNearDuplicate: readBoolean("--is-near-duplicate"),
    meaningfulDifferentiation: readBoolean("--meaningfully-different"),
    supplierCopyAccurate: readBoolean("--supplier-copy-accurate"),
    variantNamesShopperReadable: readBoolean("--variants-readable"),
    variantImagesVisible: readBoolean("--variant-images-visible"),
    certificationEvidence: readBoolean("--certification-evidence"),
    containsLicensedCharacter: readBoolean("--licensed-character"),
    licensingEvidence: readBoolean("--licensing-evidence"),
    ageAndSafetyEvidence: readBoolean("--age-safety-evidence"),
    variants: process.argv
      .flatMap((arg, index) => (arg === "--variant" ? [process.argv[index + 1] || ""] : []))
      .filter(Boolean),
    qualificationScores: {
      evidenceQuality: readNumber("--score-evidence"),
      storeFit: readNumber("--score-store-fit"),
      commercialFit: readNumber("--score-commercial-fit"),
      variantClarity: readNumber("--score-variant-clarity"),
      contentReadiness: readNumber("--score-content-readiness"),
    },
  };
}

function normalizeCandidatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("candidate evidence must be a JSON object");
  }
  if (
    payload.candidate &&
    typeof payload.candidate === "object" &&
    !Array.isArray(payload.candidate)
  ) {
    return {
      ...payload.candidate,
      evidenceBundle: payload.evidenceBundle ?? payload.candidate.evidenceBundle,
    };
  }
  return payload;
}

async function readCandidate() {
  const candidateFile = readArg("--candidate-file");
  if (candidateFile) {
    let filePayload;
    try {
      filePayload = JSON.parse(await readFile(resolve(candidateFile), "utf8"));
    } catch {
      throw new Error("--candidate-file must point to a readable JSON file");
    }
    return normalizeCandidatePayload(filePayload);
  }
  const json = readArg("--candidate-json");
  if (!json) return candidateFromFlags();
  let payload;
  try {
    payload = JSON.parse(json);
  } catch {
    throw new Error("--candidate-json must contain valid JSON");
  }
  return normalizeCandidatePayload(payload);
}

try {
  const candidate = await readCandidate();
  const result = inspectDsersProductCandidate(candidate);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.allowed) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
