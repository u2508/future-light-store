import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const policyPath = join(rootDir, "config/dsers-family-store-search-policy.json");
const cliPath = join(rootDir, "scripts/validate-dsers-candidate-cohort.mjs");
const activeCount = 2989;

function snapshot(overrides = {}) {
  const products = [
    ...Array.from({ length: activeCount }, (_, index) => ({ id: `active-${index}`, status: "ACTIVE" })),
    { id: "archived-1", status: "ARCHIVED" },
  ];
  return {
    schemaVersion: 2,
    createdAt: new Date().toISOString(),
    shopDomain: "vs-future-store-0jl2t-jxu6tnr3.myshopify.com",
    scope: "all Shopify product statuses",
    queryFilters: { products: "status:active,draft,archived,unlisted" },
    coverage: { products: "complete", productStatuses: "complete" },
    counts: { products: products.length },
    products,
    ...overrides,
  };
}

function runCli(snapshotPath, candidatesRelative = null, { capacityOnly = false } = {}) {
  const args = [cliPath];
  if (capacityOnly) args.push("--capacity-only");
  else args.push("--candidates", candidatesRelative ?? "scripts/lib/fixtures/dsers-batch-capacity-candidates.json");
  args.push("--snapshot", relative(rootDir, snapshotPath));
  return spawnSync(
    process.execPath,
    args,
    { cwd: rootDir, encoding: "utf8" },
  );
}

test("unapproved batch allocations hold candidates while fresh capacity-only checks still pass", async (t) => {
  const directory = await mkdtemp(join(rootDir, ".dsers-cohort-cli-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const snapshotPath = join(directory, "catalog.json");
  const candidatesPath = join(directory, "candidates.json");
  const policy = JSON.parse(await readFile(policyPath, "utf8"));
  const family = policy.searchFamilies[0];
  const lane = policy.collectionLanes.find(({ id }) => id === family.laneId);
  const batch = policy.batches.find(({ families, laneAllocations }) =>
    families.includes(family.name) && laneAllocations.some(({ laneId }) => laneId === lane.id),
  );
  const candidates = Array.from({ length: 4 }, (_, index) => ({
    supplierProductId: `cli-fixture-${index}`,
    searchFamily: family.name,
    collectionLane: lane.name,
    batchId: batch.id,
  }));
  candidates.push({
    supplierProductId: "cli-supplier-error",
    supplierStatus: "error",
    searchFamily: family.name,
    collectionLane: lane.name,
    batchId: batch.id,
  });
  await writeFile(snapshotPath, JSON.stringify(snapshot()), "utf8");
  await writeFile(candidatesPath, JSON.stringify(candidates), "utf8");

  const result = runCli(snapshotPath, relative(rootDir, candidatesPath));
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /Shopify products \(all statuses\): 2990\/3000; total headroom: 10; active: 2989; active headroom: 11; safe cohort ceiling: 10/);
  assert.match(result.stdout, /Candidate cohort: 5; HOLD/);
  assert.match(result.stdout, /POLICY_BATCH_CROSSWALK_UNAPPROVED/);
  assert.match(result.stdout, /PRODUCT_POLICY_HOLD: cli-fixture-0: .*missing-cost-evidence/);
  assert.match(result.stdout, /PRODUCT_POLICY_HOLD: cli-supplier-error: /);
  const holdLines = result.stdout.split("\n").filter((line) => line.startsWith("PRODUCT_POLICY_HOLD:"));
  assert.deepEqual(holdLines.map((line) => line.split(": ")[1]), [
    "cli-fixture-0",
    "cli-fixture-1",
    "cli-fixture-2",
    "cli-fixture-3",
    "cli-supplier-error",
  ]);

  const repeated = runCli(snapshotPath, relative(rootDir, candidatesPath));
  const repeatedHoldLines = repeated.stdout
    .split("\n")
    .filter((line) => line.startsWith("PRODUCT_POLICY_HOLD:"));
  assert.deepEqual(repeatedHoldLines, holdLines);

  const capacityOnly = runCli(snapshotPath, null, { capacityOnly: true });
  assert.equal(capacityOnly.status, 0, capacityOnly.stderr || capacityOnly.stdout);
  assert.match(capacityOnly.stdout, /Catalog capacity: VERIFIED; no candidate cohort evaluated/);
  assert.doesNotMatch(capacityOnly.stdout, /PRODUCT_POLICY_HOLD/);
});

test("cohort command rejects a wrong Shopify target and paths outside the project", async (t) => {
  const directory = await mkdtemp(join(rootDir, ".dsers-cohort-cli-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const wrongStorePath = join(directory, "wrong-store.json");
  await writeFile(
    wrongStorePath,
    JSON.stringify(snapshot({ shopDomain: "wrong.myshopify.com" })),
    "utf8",
  );

  const wrongStore = runCli(wrongStorePath);
  assert.equal(wrongStore.status, 1);
  assert.match(wrongStore.stdout, /ACTIVE_CATALOG_SNAPSHOT_WRONG_STORE/);

  const outside = await mkdtemp(join(tmpdir(), "dsers-cohort-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const outsideCandidates = join(outside, "candidates.json");
  await writeFile(outsideCandidates, JSON.stringify([]), "utf8");
  const blockedPath = runCli(wrongStorePath, outsideCandidates);
  assert.equal(blockedPath.status, 2);
  assert.match(blockedPath.stderr, /must be inside the Future Light Store project/);
});
