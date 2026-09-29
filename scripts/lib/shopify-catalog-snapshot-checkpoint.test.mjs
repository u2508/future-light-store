import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  archiveTerminalSnapshotCheckpoint,
  parseSnapshotCliArgs,
  retryTerminalFailedSnapshotOperations,
} from "./shopify-catalog-snapshot-checkpoint.mjs";

const operationNames = ["catalog", "variantMedia", "publications", "metafieldReferences"];
const expectedQueryHashes = Object.fromEntries(operationNames.map((name) => [name, `hash-${name}`]));
const expectedStore = "vs-future-store-0jl2t-jxu6tnr3.myshopify.com";

function checkpoint(overrides = {}) {
  return {
    version: 2,
    runId: "old-run",
    storeDomain: expectedStore,
    queries: { ...expectedQueryHashes },
    operations: Object.fromEntries(
      operationNames.map((name) => [
        name,
        { queryHash: expectedQueryHashes[name], id: `gid://shopify/BulkOperation/${name}`, status: "COMPLETED" },
      ]),
    ),
    ...overrides,
  };
}

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), "future-light-snapshot-checkpoint-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function archiveOptions(dir) {
  return {
    checkpointPath: join(dir, "checkpoint.json"),
    archiveDir: dir,
    expectedStore,
    checkpointVersion: 2,
    operationNames,
    expectedQueryHashes,
    now: new Date("2026-09-28T00:00:00.000Z"),
    id: "test-id",
  };
}

test("fresh mode archives a verified terminal checkpoint without losing its contents", async () => {
  await withTempDir(async (dir) => {
    const original = checkpoint();
    const options = archiveOptions(dir);
    await writeFile(options.checkpointPath, JSON.stringify(original));

    const result = await archiveTerminalSnapshotCheckpoint(options);

    assert.equal(result.archived, true);
    assert.equal(result.runId, "old-run");
    assert.deepEqual(JSON.parse(await readFile(result.archivePath, "utf8")), original);
    await assert.rejects(readFile(options.checkpointPath), { code: "ENOENT" });
  });
});

test("fresh mode refuses an active or inconsistent checkpoint and preserves it", async () => {
  await withTempDir(async (dir) => {
    const options = archiveOptions(dir);
    const active = checkpoint();
    active.operations.publications.status = "RUNNING";
    await writeFile(options.checkpointPath, JSON.stringify(active));

    await assert.rejects(archiveTerminalSnapshotCheckpoint(options), /not in a verified terminal state/);
    assert.deepEqual(JSON.parse(await readFile(options.checkpointPath, "utf8")), active);
    assert.deepEqual(await readdir(dir), ["checkpoint.json"]);
  });
});

test("fresh mode refuses another store/query and never archives an incompatible checkpoint", async () => {
  await withTempDir(async (dir) => {
    const options = archiveOptions(dir);
    const otherStore = checkpoint({ storeDomain: "other.myshopify.com" });
    await writeFile(options.checkpointPath, JSON.stringify(otherStore));

    await assert.rejects(archiveTerminalSnapshotCheckpoint(options), /incompatible/);
    assert.deepEqual(JSON.parse(await readFile(options.checkpointPath, "utf8")), otherStore);
    assert.deepEqual(await readdir(dir), ["checkpoint.json"]);
  });
});

test("missing checkpoint is a safe no-op", async () => {
  await withTempDir(async (dir) => {
    const result = await archiveTerminalSnapshotCheckpoint(archiveOptions(dir));
    assert.deepEqual(result, { archived: false, reason: "missing" });
  });
});

test("retry mode requeues only failed exports and retains completed artifacts", async () => {
  await withTempDir(async (dir) => {
    const options = archiveOptions(dir);
    const previous = checkpoint();
    previous.operations.publications = {
      queryHash: expectedQueryHashes.publications,
      id: "gid://shopify/BulkOperation/failed",
      status: "FAILED",
      errorCode: "ACCESS_DENIED",
    };
    await writeFile(options.checkpointPath, JSON.stringify(previous));

    const result = await retryTerminalFailedSnapshotOperations(options);
    const next = JSON.parse(await readFile(options.checkpointPath, "utf8"));
    assert.deepEqual(result, { retried: true, operations: ["publications"], retryCount: 1 });
    assert.equal(next.operations.publications.status, "NOT_STARTED");
    assert.equal(next.operations.publications.id, null);
    assert.equal(next.operations.catalog.id, previous.operations.catalog.id);
    assert.equal(next.operations.catalog.status, "COMPLETED");
    assert.equal(next.retryHistory[0].previousErrorCode, "ACCESS_DENIED");
  });
});

test("retry mode refuses active exports and preserves the checkpoint", async () => {
  await withTempDir(async (dir) => {
    const options = archiveOptions(dir);
    const active = checkpoint();
    active.operations.publications.status = "RUNNING";
    await writeFile(options.checkpointPath, JSON.stringify(active));

    await assert.rejects(retryTerminalFailedSnapshotOperations(options), /active or unknown/);
    assert.deepEqual(JSON.parse(await readFile(options.checkpointPath, "utf8")), active);
  });
});

test("CLI accepts only an optional single fresh flag", () => {
  assert.deepEqual(parseSnapshotCliArgs([]), { fresh: false, retryFailed: false });
  assert.deepEqual(parseSnapshotCliArgs(["--fresh"]), { fresh: true, retryFailed: false });
  assert.deepEqual(parseSnapshotCliArgs(["--retry-failed"]), { fresh: false, retryFailed: true });
  assert.throws(() => parseSnapshotCliArgs(["--resume"]), /Usage:/);
  assert.throws(() => parseSnapshotCliArgs(["--fresh", "--fresh"]), /Usage:/);
  assert.throws(() => parseSnapshotCliArgs(["--fresh", "--retry-failed"]), /Usage:/);
});
