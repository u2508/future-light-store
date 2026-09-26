import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  computeDsersLaneBatchCrosswalkSha256,
  DSERS_POLICY_RELATIVE_PATH,
  DSERS_CATALOG_SNAPSHOT_MAX_AGE_MS,
  DSERS_TOTAL_CAPACITY,
  isDsersLaneBatchCrosswalkApproved,
  readDsersPolicy,
  validateDsersBatchCapacity,
} from "./dsers-batch-capacity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const policyFixture = JSON.parse(
  await readFile(join(here, "fixtures/dsers-batch-capacity-policy.json"), "utf8"),
);
const candidateFixture = JSON.parse(
  await readFile(join(here, "fixtures/dsers-batch-capacity-candidates.json"), "utf8"),
);
const FIXED_NOW = "2026-09-24T10:00:00.000Z";

function catalogSnapshot(activeCount = 2989, overrides = {}) {
  const products = [
    ...Array.from({ length: activeCount }, (_, index) => ({ id: `active-${index}`, status: "ACTIVE" })),
    { id: "archived-1", status: "ARCHIVED" },
  ];
  return {
    schemaVersion: 2,
    createdAt: FIXED_NOW,
    shopDomain: policyFixture.shopDomain,
    scope: "all Shopify product statuses",
    queryFilters: { products: "status:active,draft,archived,unlisted" },
    coverage: { products: "complete", productStatuses: "complete" },
    counts: { products: products.length },
    products,
    ...overrides,
  };
}

function validate(candidates, policy = policyFixture, options = {}) {
  const { activeProductCount = 2989, ...validationOptions } = options;
  return validateDsersBatchCapacity(candidates, policy, {
    activeCatalogSnapshot: catalogSnapshot(activeProductCount),
    now: Date.parse(FIXED_NOW),
    ...validationOptions,
  });
}

function createAllocation(policy = policyFixture) {
  const records = [];
  const familyByLane = new Map(policy.searchFamilies.map(({ name, laneId }) => [laneId, name]));
  const laneById = new Map(policy.collectionLanes.map(({ id, name }) => [id, name]));

  for (const batch of policy.batches) {
    for (const allocation of batch.laneAllocations) {
      for (let index = 0; index < allocation.slots; index += 1) {
        records.push({
          supplierProductId: `fixture-${String(records.length + 1).padStart(4, "0")}`,
          searchFamily: familyByLane.get(allocation.laneId),
          collectionLane: laneById.get(allocation.laneId),
          batchId: batch.id,
        });
      }
    }
  }
  return records;
}

function errorCodes(result) {
  return result.errors.map(({ code }) => code);
}

test("accepts fixture candidates and returns stable lane and batch counts", () => {
  const result = validate(candidateFixture);
  assert.equal(result.valid, true);
  assert.deepEqual(result.counts, {
    total: 4,
    lanes: { "lane-a": 2, "lane-b": 2 },
    batches: { 1: 1, 2: 1, 6: 1, 7: 1 },
  });
  assert.deepEqual(result.errors, []);
});

test("accepts exactly 679 candidates at all lane and batch ceilings", () => {
  const allocation = createAllocation();
  const result = validate(allocation, policyFixture, { activeProductCount: 2320 });
  assert.equal(result.valid, true);
  assert.equal(result.counts.total, 679);
  assert.deepEqual(result.counts.lanes, { "lane-a": 400, "lane-b": 279 });
  assert.deepEqual(result.counts.batches, {
    1: 100,
    2: 100,
    3: 100,
    4: 100,
    5: 100,
    6: 100,
    7: 79,
  });
});

test("reports total, lane, and batch over-capacity with stable error codes", () => {
  const allocation = createAllocation();
  allocation.push({ ...allocation[0], supplierProductId: "fixture-over-capacity" });
  const first = validate(allocation, policyFixture, { activeProductCount: 2320 });
  const second = validate(allocation, policyFixture, { activeProductCount: 2320 });
  assert.equal(first.valid, false);
  assert.ok(errorCodes(first).includes("TOTAL_CAP_EXCEEDED"));
  assert.ok(errorCodes(first).includes("LANE_CAP_EXCEEDED"));
  assert.ok(errorCodes(first).includes("BATCH_CAP_EXCEEDED"));
  assert.deepEqual(first, second);
});

test("enforces a lane ceiling even when total and every batch remain within capacity", () => {
  const allocation = createAllocation();
  const candidateIndex = allocation.findIndex(
    ({ batchId, collectionLane }) => batchId === 1 && collectionLane === "Lane B",
  );
  allocation[candidateIndex] = {
    ...allocation[candidateIndex],
    searchFamily: "Family A",
    collectionLane: "Lane A",
  };
  const result = validate(allocation);
  assert.ok(errorCodes(result).includes("LANE_CAP_EXCEEDED"));
  assert.ok(errorCodes(result).includes("BATCH_LANE_CAP_EXCEEDED"));
});

test("enforces each batch cap while the overall total and lane ceilings remain valid", () => {
  const allocation = createAllocation();
  const candidate = allocation.find(({ batchId }) => batchId === 1);
  allocation.push({ ...candidate, supplierProductId: "fixture-batch-overflow" });
  const result = validate(allocation);
  assert.ok(errorCodes(result).includes("BATCH_CAP_EXCEEDED"));
  assert.ok(errorCodes(result).includes("BATCH_LANE_CAP_EXCEEDED"));
});

test("rejects unknown families and lanes, disallowed family-lane pairs, and unknown batches", () => {
  const candidates = [
    {
      supplierProductId: "unknown-family",
      searchFamily: "Family X",
      collectionLane: "Lane A",
      batchId: 1,
    },
    {
      supplierProductId: "unknown-lane",
      searchFamily: "Family A",
      collectionLane: "Lane X",
      batchId: 1,
    },
    {
      supplierProductId: "mismatched-lane",
      searchFamily: "Family A",
      collectionLane: "Lane B",
      batchId: 1,
    },
    {
      supplierProductId: "unknown-batch",
      searchFamily: "Family A",
      collectionLane: "Lane A",
      batchId: 8,
    },
  ];
  const result = validate(candidates);
  assert.ok(errorCodes(result).includes("UNKNOWN_FAMILY"));
  assert.ok(errorCodes(result).includes("UNKNOWN_LANE"));
  assert.ok(errorCodes(result).includes("FAMILY_LANE_MISMATCH"));
  assert.ok(errorCodes(result).includes("UNKNOWN_BATCH"));
});

test("rejects duplicate supplier product identifiers and missing identifiers", () => {
  const candidates = [
    ...candidateFixture,
    { ...candidateFixture[0], collectionLane: "Lane A", batchId: 3 },
    { searchFamily: "Family A", collectionLane: "Lane A", batchId: 4 },
  ];
  const result = validate(candidates);
  assert.ok(errorCodes(result).includes("DUPLICATE_CANDIDATE"));
  assert.ok(errorCodes(result).includes("MISSING_CANDIDATE_ID"));
});

test("rejects malformed policy shape, unknown policy references, and allocation drift", () => {
  const invalidPolicy = structuredClone(policyFixture);
  invalidPolicy.collectionLanes[0].slots -= 1;
  invalidPolicy.searchFamilies[0].laneId = "missing-lane";
  invalidPolicy.batches[0].families = ["missing-family"];
  invalidPolicy.batches[0].laneAllocations[0].slots += 1;
  invalidPolicy.batches.pop();
  const result = validate([], invalidPolicy);
  assert.equal(result.valid, false);
  assert.ok(errorCodes(result).includes("POLICY_LANE_CEILINGS_MISMATCH"));
  assert.ok(errorCodes(result).includes("POLICY_UNKNOWN_LANE"));
  assert.ok(errorCodes(result).includes("POLICY_UNKNOWN_FAMILY"));
  assert.ok(errorCodes(result).includes("POLICY_BATCH_COUNT_INVALID"));
  assert.ok(errorCodes(result).includes("POLICY_BATCH_CAPS_MISMATCH"));
  assert.ok(errorCodes(result).includes("POLICY_BATCH_LANE_TOTAL_MISMATCH"));
  assert.ok(errorCodes(result).includes("POLICY_LANE_BATCH_ALLOCATION_MISMATCH"));
});

test("reads the working-tree policy only when its source document hash matches", async (t) => {
  const repoRoot = await mkdtemp(join(tmpdir(), "dsers-capacity-policy-"));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));

  const policyPath = join(repoRoot, DSERS_POLICY_RELATIVE_PATH);
  await mkdir(dirname(policyPath), { recursive: true });
  const sourceBytes = Buffer.from("fixture source document");
  const policy = {
    ...policyFixture,
    sourceDocument: "terms.docx",
    sourceSha256: createHash("sha256").update(sourceBytes).digest("hex"),
  };
  await writeFile(join(repoRoot, policy.sourceDocument), sourceBytes);
  await writeFile(policyPath, JSON.stringify(policy, null, 2));

  assert.deepEqual(readDsersPolicy({ repoRoot }), policy);

  await writeFile(join(repoRoot, policy.sourceDocument), "changed source document");
  assert.throws(
    () => readDsersPolicy({ repoRoot }),
    (error) => error.code === "POLICY_SOURCE_HASH_MISMATCH",
  );
});

test("loads this checkout's policy only when the plan source hash still matches", () => {
  const policy = readDsersPolicy();
  assert.equal(policy.planningSlots, DSERS_TOTAL_CAPACITY);
  assert.equal(policy.targetMarket, "US");
  assert.equal(policy.productTarget, 3000);
  assert.equal(policy.shopDomain, "vs-future-store-0jl2t-jxu6tnr3.myshopify.com");
  assert.equal(isDsersLaneBatchCrosswalkApproved(policy), false);
  assert.equal(
    policy.laneToBatchCrosswalkApproval.crosswalkSha256,
    computeDsersLaneBatchCrosswalkSha256(policy),
  );
});

test("accepts only a source-, policy-, and crosswalk-bound approval before candidate validation", () => {
  const policy = structuredClone(policyFixture);
  policy.laneToBatchCrosswalkApproval = {
    status: "approved",
    policyVersion: policy.policyVersion,
    sourceSha256: policy.sourceSha256,
    crosswalkSha256: computeDsersLaneBatchCrosswalkSha256(policy),
    approvedBy: "fixture owner",
    approvedAt: FIXED_NOW,
  };
  assert.equal(isDsersLaneBatchCrosswalkApproved(policy, { now: Date.parse(FIXED_NOW) }), true);
  assert.equal(
    isDsersLaneBatchCrosswalkApproved(
      { ...policy, laneToBatchCrosswalkApproval: { ...policy.laneToBatchCrosswalkApproval, sourceSha256: "wrong" } },
      { now: Date.parse(FIXED_NOW) },
    ),
    false,
  );
  assert.equal(
    isDsersLaneBatchCrosswalkApproved(
      { ...policy, laneToBatchCrosswalkApproval: { ...policy.laneToBatchCrosswalkApproval, crosswalkSha256: "wrong" } },
      { now: Date.parse(FIXED_NOW) },
    ),
    false,
  );
});

test("rejects a policy source path that escapes the project", async (t) => {
  const repoRoot = await mkdtemp(join(tmpdir(), "dsers-capacity-path-"));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));

  const policyPath = join(repoRoot, DSERS_POLICY_RELATIVE_PATH);
  await mkdir(dirname(policyPath), { recursive: true });
  await writeFile(
    policyPath,
    JSON.stringify({
      ...policyFixture,
      sourceDocument: "../outside.docx",
      sourceSha256: "0".repeat(64),
    }),
  );

  assert.throws(
    () => readDsersPolicy({ repoRoot }),
    (error) => error.code === "POLICY_SOURCE_PATH_INVALID",
  );
});

test("returns CANDIDATES_INVALID for a non-array input", () => {
  const result = validate({}, policyFixture);
  assert.deepEqual(result.errors, [{ code: "CANDIDATES_INVALID" }]);
});

test("requires a complete, correct-store catalog snapshot no older than 30 minutes", () => {
  const missing = validateDsersBatchCapacity([], policyFixture, { now: Date.parse(FIXED_NOW) });
  assert.ok(errorCodes(missing).includes("ACTIVE_CATALOG_SNAPSHOT_REQUIRED"));

  const wrongStoreSnapshot = catalogSnapshot(2989, { shopDomain: "another-store.myshopify.com" });
  const wrongStore = validateDsersBatchCapacity([], policyFixture, {
    activeCatalogSnapshot: wrongStoreSnapshot,
    now: Date.parse(FIXED_NOW),
  });
  assert.ok(errorCodes(wrongStore).includes("ACTIVE_CATALOG_SNAPSHOT_WRONG_STORE"));

  const staleSnapshot = catalogSnapshot(2989, {
    createdAt: new Date(Date.parse(FIXED_NOW) - DSERS_CATALOG_SNAPSHOT_MAX_AGE_MS - 1).toISOString(),
  });
  const stale = validateDsersBatchCapacity([], policyFixture, {
    activeCatalogSnapshot: staleSnapshot,
    now: Date.parse(FIXED_NOW),
  });
  assert.ok(errorCodes(stale).includes("ACTIVE_CATALOG_SNAPSHOT_STALE_OR_INVALID"));

  const incompleteSnapshot = catalogSnapshot(2989, { coverage: { products: "partial" } });
  const incomplete = validateDsersBatchCapacity([], policyFixture, {
    activeCatalogSnapshot: incompleteSnapshot,
    now: Date.parse(FIXED_NOW),
  });
  assert.ok(errorCodes(incomplete).includes("ACTIVE_CATALOG_SNAPSHOT_COVERAGE_INCOMPLETE"));

  const missingStatusFilter = catalogSnapshot(2989, { queryFilters: {} });
  const statusFilter = validateDsersBatchCapacity([], policyFixture, {
    activeCatalogSnapshot: missingStatusFilter,
    now: Date.parse(FIXED_NOW),
  });
  assert.ok(errorCodes(statusFilter).includes("ACTIVE_CATALOG_STATUS_FILTER_INCOMPLETE"));

  const invalidStatusSnapshot = catalogSnapshot(2989);
  invalidStatusSnapshot.products[0].status = "REMOVED";
  const invalidStatus = validateDsersBatchCapacity([], policyFixture, {
    activeCatalogSnapshot: invalidStatusSnapshot,
    now: Date.parse(FIXED_NOW),
  });
  assert.ok(errorCodes(invalidStatus).includes("ACTIVE_CATALOG_PRODUCT_STATUS_INVALID"));

  const wrongCountSnapshot = catalogSnapshot(2989);
  wrongCountSnapshot.counts.products -= 1;
  const wrongCount = validateDsersBatchCapacity([], policyFixture, {
    activeCatalogSnapshot: wrongCountSnapshot,
    now: Date.parse(FIXED_NOW),
  });
  assert.ok(errorCodes(wrongCount).includes("ACTIVE_CATALOG_PRODUCT_COUNT_INVALID"));

  const futureSnapshot = catalogSnapshot(2989, {
    createdAt: new Date(Date.parse(FIXED_NOW) + 1).toISOString(),
  });
  const future = validateDsersBatchCapacity([], policyFixture, {
    activeCatalogSnapshot: futureSnapshot,
    now: Date.parse(FIXED_NOW),
  });
  assert.ok(errorCodes(future).includes("ACTIVE_CATALOG_SNAPSHOT_STALE_OR_INVALID"));
});

test("caps candidates by the stricter all-status and active headroom rather than the static 679 ceiling", () => {
  const withinLimit = validate(candidateFixture, policyFixture, { activeProductCount: 2989 });
  assert.equal(withinLimit.capacity.totalProductCount, 2990);
  assert.equal(withinLimit.capacity.activeHeadroom, 11);
  assert.equal(withinLimit.capacity.totalProductHeadroom, 10);
  assert.equal(withinLimit.capacity.availableHeadroom, 10);
  assert.equal(withinLimit.capacity.effectiveCeiling, 10);
  assert.equal(withinLimit.valid, true);

  const twelveCandidates = [
    ...candidateFixture,
    ...Array.from({ length: 8 }, (_, index) => ({
      ...candidateFixture[index % candidateFixture.length],
      supplierProductId: `extra-${index}`,
    })),
  ];
  const blocked = validate(twelveCandidates, policyFixture, { activeProductCount: 2989 });
  assert.equal(blocked.valid, false);
  assert.ok(errorCodes(blocked).includes("DYNAMIC_CAPACITY_EXCEEDED"));
  assert.equal(blocked.errors.find(({ code }) => code === "DYNAMIC_CAPACITY_EXCEEDED").limit, 10);

  const targetReached = validate(candidateFixture, policyFixture, { activeProductCount: 3000 });
  assert.equal(targetReached.capacity.effectiveCeiling, 0);
  assert.ok(errorCodes(targetReached).includes("DYNAMIC_CAPACITY_EXCEEDED"));
});
