import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const DSERS_POLICY_RELATIVE_PATH = "config/dsers-family-store-search-policy.json";
export const DSERS_TOTAL_CAPACITY = 679;
export const DSERS_BATCH_COUNT = 7;

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function makeReadError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

/** Read the checked-in policy source and verify it against its source document. */
export function readDsersPolicy({ repoRoot = PROJECT_ROOT } = {}) {
  const policyPath = resolve(repoRoot, DSERS_POLICY_RELATIVE_PATH);
  let policyText;
  try {
    policyText = readFileSync(policyPath, "utf8");
  } catch {
    throw makeReadError("POLICY_NOT_FOUND");
  }

  let policy;
  try {
    policy = JSON.parse(policyText);
  } catch {
    throw makeReadError("POLICY_JSON_INVALID");
  }

  const sourceDocument = policy?.sourceDocument;
  if (
    typeof sourceDocument !== "string" ||
    sourceDocument.trim() === "" ||
    isAbsolute(sourceDocument)
  ) {
    throw makeReadError("POLICY_SOURCE_PATH_INVALID");
  }
  const sourcePath = resolve(repoRoot, sourceDocument);
  const sourceRelativePath = relative(resolve(repoRoot), sourcePath);
  if (sourceRelativePath === ".." || sourceRelativePath.startsWith(`..${sep}`)) {
    throw makeReadError("POLICY_SOURCE_PATH_INVALID");
  }

  let sourceBytes;
  try {
    sourceBytes = readFileSync(sourcePath);
  } catch {
    throw makeReadError("POLICY_SOURCE_NOT_FOUND");
  }
  const actualHash = createHash("sha256").update(sourceBytes).digest("hex");
  if (typeof policy.sourceSha256 !== "string" || actualHash !== policy.sourceSha256.toLowerCase()) {
    throw makeReadError("POLICY_SOURCE_HASH_MISMATCH");
  }

  return policy;
}

// Retain the previous export name for callers; policy provenance is now checked
// from the working tree so an uncommitted, locally reviewed plan can be tested.
export const readCommittedDsersPolicy = readDsersPolicy;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortErrors(errors) {
  return errors.sort(
    (left, right) =>
      compareText(left.code, right.code) ||
      compareText(String(left.candidateId ?? ""), String(right.candidateId ?? "")) ||
      compareText(String(left.laneId ?? ""), String(right.laneId ?? "")) ||
      compareText(String(left.batchId ?? ""), String(right.batchId ?? "")) ||
      (left.index ?? -1) - (right.index ?? -1),
  );
}

function inspectPolicy(policy) {
  const errors = [];
  const lanes = Array.isArray(policy?.collectionLanes) ? policy.collectionLanes : [];
  const families = Array.isArray(policy?.searchFamilies) ? policy.searchFamilies : [];
  const batches = Array.isArray(policy?.batches) ? policy.batches : [];
  const laneById = new Map();
  const laneByName = new Map();
  const familyByName = new Map();
  const batchById = new Map();
  const batchLaneCaps = new Map();
  const laneAllocatedTotals = new Map();

  if (policy?.planningSlots !== DSERS_TOTAL_CAPACITY) {
    errors.push({ code: "POLICY_TOTAL_CEILING_INVALID" });
  }
  if (!Array.isArray(policy?.collectionLanes) || lanes.length === 0) {
    errors.push({ code: "POLICY_LANES_INVALID" });
  }
  if (!Array.isArray(policy?.searchFamilies) || families.length === 0) {
    errors.push({ code: "POLICY_FAMILIES_INVALID" });
  }
  if (!Array.isArray(policy?.batches)) {
    errors.push({ code: "POLICY_BATCHES_INVALID" });
  }
  if (batches.length !== DSERS_BATCH_COUNT) {
    errors.push({ code: "POLICY_BATCH_COUNT_INVALID" });
  }

  let laneCapacityTotal = 0;
  for (const lane of lanes) {
    if (
      !isRecord(lane) ||
      !isNonEmptyString(lane.id) ||
      !isNonEmptyString(lane.name) ||
      !isPositiveInteger(lane.slots)
    ) {
      errors.push({ code: "POLICY_LANE_INVALID" });
      continue;
    }
    if (laneById.has(lane.id) || laneByName.has(lane.name)) {
      errors.push({ code: "POLICY_DUPLICATE_LANE" });
      continue;
    }
    laneById.set(lane.id, lane);
    laneByName.set(lane.name, lane);
    laneCapacityTotal += lane.slots;
  }

  if (laneCapacityTotal !== DSERS_TOTAL_CAPACITY) {
    errors.push({ code: "POLICY_LANE_CEILINGS_MISMATCH" });
  }

  for (const family of families) {
    if (!isRecord(family) || !isNonEmptyString(family.name) || !isNonEmptyString(family.laneId)) {
      errors.push({ code: "POLICY_FAMILY_INVALID" });
      continue;
    }
    if (familyByName.has(family.name)) {
      errors.push({ code: "POLICY_DUPLICATE_FAMILY" });
      continue;
    }
    familyByName.set(family.name, family);
    if (!laneById.has(family.laneId)) {
      errors.push({ code: "POLICY_UNKNOWN_LANE" });
    }
  }

  let batchCapacityTotal = 0;
  for (const batch of batches) {
    if (
      !isRecord(batch) ||
      !isPositiveInteger(batch.id) ||
      !isPositiveInteger(batch.ceiling) ||
      !Array.isArray(batch.families) ||
      batch.families.length === 0 ||
      !Array.isArray(batch.laneAllocations) ||
      batch.laneAllocations.length === 0
    ) {
      errors.push({ code: "POLICY_BATCH_INVALID" });
      continue;
    }
    if (batchById.has(batch.id)) {
      errors.push({ code: "POLICY_DUPLICATE_BATCH" });
      continue;
    }
    batchById.set(batch.id, batch);
    batchCapacityTotal += batch.ceiling;
    const laneCaps = new Map();
    let laneAllocationTotal = 0;
    for (const allocation of batch.laneAllocations) {
      if (!isRecord(allocation) || !isNonEmptyString(allocation.laneId) || !isPositiveInteger(allocation.slots)) {
        errors.push({ code: "POLICY_BATCH_LANE_ALLOCATION_INVALID", batchId: batch.id });
        continue;
      }
      if (laneCaps.has(allocation.laneId)) {
        errors.push({ code: "POLICY_DUPLICATE_BATCH_LANE_ALLOCATION", batchId: batch.id, laneId: allocation.laneId });
        continue;
      }
      if (!laneById.has(allocation.laneId)) {
        errors.push({ code: "POLICY_BATCH_ALLOCATION_UNKNOWN_LANE", batchId: batch.id, laneId: allocation.laneId });
        continue;
      }
      laneCaps.set(allocation.laneId, allocation.slots);
      laneAllocationTotal += allocation.slots;
      laneAllocatedTotals.set(
        allocation.laneId,
        (laneAllocatedTotals.get(allocation.laneId) ?? 0) + allocation.slots,
      );
    }
    batchLaneCaps.set(batch.id, laneCaps);
    if (laneAllocationTotal !== batch.ceiling) {
      errors.push({
        code: "POLICY_BATCH_LANE_TOTAL_MISMATCH",
        batchId: batch.id,
        actual: laneAllocationTotal,
        expected: batch.ceiling,
      });
    }
    for (const familyName of batch.families) {
      if (!familyByName.has(familyName)) {
        errors.push({ code: "POLICY_UNKNOWN_FAMILY" });
      }
    }
    const declaredFamilies = new Set(batch.families);
    const allocatedFamilies = new Set(
      [...familyByName.values()]
        .filter((family) => laneCaps.has(family.laneId))
        .map((family) => family.name),
    );
    if (
      declaredFamilies.size !== batch.families.length ||
      declaredFamilies.size !== allocatedFamilies.size ||
      [...declaredFamilies].some((familyName) => !allocatedFamilies.has(familyName))
    ) {
      errors.push({ code: "POLICY_BATCH_FAMILY_LANE_MISMATCH", batchId: batch.id });
    }
  }

  if (batchCapacityTotal !== DSERS_TOTAL_CAPACITY) {
    errors.push({ code: "POLICY_BATCH_CAPS_MISMATCH" });
  }

  for (const lane of laneById.values()) {
    const allocated = laneAllocatedTotals.get(lane.id) ?? 0;
    if (allocated !== lane.slots) {
      errors.push({
        code: "POLICY_LANE_BATCH_ALLOCATION_MISMATCH",
        laneId: lane.id,
        actual: allocated,
        expected: lane.slots,
      });
    }
  }

  return {
    errors: sortErrors(errors),
    laneById,
    laneByName,
    familyByName,
    batchById,
    batchLaneCaps,
  };
}

function emptyCounts(total = 0) {
  return { total, lanes: {}, batches: {} };
}

function sortedCounts(counts) {
  return {
    total: counts.total,
    lanes: Object.fromEntries(Object.entries(counts.lanes).sort(([a], [b]) => compareText(a, b))),
    batches: Object.fromEntries(
      Object.entries(counts.batches).sort(([a], [b]) => Number(a) - Number(b)),
    ),
  };
}

/**
 * Validate candidate allocations against the source-hash-verified DSers policy.
 * Pass a policy object only for isolated tests.
 * Each candidate uses supplierProductId, searchFamily, collectionLane, and batchId.
 */
export function validateDsersBatchCapacity(candidates, policy = readDsersPolicy()) {
  const records = Array.isArray(candidates) ? candidates : [];
  const counts = emptyCounts(records.length);
  if (!Array.isArray(candidates)) {
    return { valid: false, counts: sortedCounts(counts), errors: [{ code: "CANDIDATES_INVALID" }] };
  }

  const inspectedPolicy = inspectPolicy(policy);
  if (inspectedPolicy.errors.length > 0) {
    return { valid: false, counts: sortedCounts(counts), errors: inspectedPolicy.errors };
  }

  const errors = [];
  const seenIds = new Set();
  const duplicateIdsReported = new Set();
  const laneCounts = new Map();
  const batchCounts = new Map();
  const batchLaneCounts = new Map();

  for (const [index, candidate] of records.entries()) {
    const entry = isRecord(candidate) ? candidate : {};
    const rawId = entry.supplierProductId;
    const candidateId = isNonEmptyString(rawId) ? rawId.trim() : undefined;
    const familyName = entry.searchFamily;
    const laneValue = entry.collectionLane;
    const batchId = entry.batchId;
    const context = { index };

    if (!candidateId) {
      errors.push({ code: "MISSING_CANDIDATE_ID", ...context });
    } else if (seenIds.has(candidateId)) {
      if (!duplicateIdsReported.has(candidateId)) {
        errors.push({ code: "DUPLICATE_CANDIDATE", candidateId, ...context });
        duplicateIdsReported.add(candidateId);
      }
    } else {
      seenIds.add(candidateId);
    }

    const family = inspectedPolicy.familyByName.get(familyName);
    if (!family) {
      errors.push({ code: "UNKNOWN_FAMILY", ...(candidateId ? { candidateId } : {}), ...context });
    }

    const lane =
      typeof laneValue === "string"
        ? (inspectedPolicy.laneByName.get(laneValue) ?? inspectedPolicy.laneById.get(laneValue))
        : undefined;
    if (!lane) {
      errors.push({ code: "UNKNOWN_LANE", ...(candidateId ? { candidateId } : {}), ...context });
    } else {
      laneCounts.set(lane.id, (laneCounts.get(lane.id) ?? 0) + 1);
      if (family && family.laneId !== lane.id) {
        errors.push({ code: "FAMILY_LANE_MISMATCH", candidateId, laneId: lane.id, ...context });
      }
    }

    const batch = inspectedPolicy.batchById.get(batchId);
    if (!batch) {
      errors.push({
        code: "UNKNOWN_BATCH",
        ...(candidateId ? { candidateId } : {}),
        batchId,
        ...context,
      });
    } else {
      batchCounts.set(batch.id, (batchCounts.get(batch.id) ?? 0) + 1);
      if (family && !batch.families.includes(family.name)) {
        errors.push({ code: "FAMILY_NOT_IN_BATCH", candidateId, batchId, ...context });
      }
      if (lane) {
        const laneLimit = inspectedPolicy.batchLaneCaps.get(batch.id)?.get(lane.id);
        if (laneLimit == null) {
          errors.push({ code: "LANE_NOT_ALLOCATED_TO_BATCH", candidateId, batchId, laneId: lane.id, ...context });
        } else {
          const key = `${batch.id}:${lane.id}`;
          const actual = (batchLaneCounts.get(key) ?? 0) + 1;
          batchLaneCounts.set(key, actual);
          if (actual > laneLimit) {
            errors.push({
              code: "BATCH_LANE_CAP_EXCEEDED",
              candidateId,
              batchId,
              laneId: lane.id,
              actual,
              limit: laneLimit,
              ...context,
            });
          }
        }
      }
    }
  }

  if (counts.total > DSERS_TOTAL_CAPACITY) {
    errors.push({ code: "TOTAL_CAP_EXCEEDED", actual: counts.total, limit: DSERS_TOTAL_CAPACITY });
  }

  for (const lane of [...inspectedPolicy.laneById.values()].sort((a, b) =>
    compareText(a.id, b.id),
  )) {
    const actual = laneCounts.get(lane.id) ?? 0;
    if (actual > lane.slots) {
      errors.push({ code: "LANE_CAP_EXCEEDED", laneId: lane.id, actual, limit: lane.slots });
    }
  }

  for (const batch of [...inspectedPolicy.batchById.values()].sort((a, b) => a.id - b.id)) {
    const actual = batchCounts.get(batch.id) ?? 0;
    if (actual > batch.ceiling) {
      errors.push({ code: "BATCH_CAP_EXCEEDED", batchId: batch.id, actual, limit: batch.ceiling });
    }
  }

  const orderedErrors = sortErrors(errors);
  const finalCounts = emptyCounts(records.length);
  for (const [laneId, count] of laneCounts) finalCounts.lanes[laneId] = count;
  for (const [batchId, count] of batchCounts) finalCounts.batches[String(batchId)] = count;

  return {
    valid: orderedErrors.length === 0,
    counts: sortedCounts(finalCounts),
    errors: orderedErrors,
  };
}
