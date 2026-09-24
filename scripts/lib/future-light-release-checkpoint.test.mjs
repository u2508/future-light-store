import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createFutureLightReleaseCheckpoint,
  prepareFutureLightReleaseResume,
  readFutureLightReleaseCheckpoint,
  validateFutureLightReleaseCheckpoint,
  writeFutureLightReleaseCheckpoint,
} from "./future-light-release-checkpoint.mjs";

const identity = {
  shopDomain: "confirmed-store.myshopify.com",
  manifestFingerprint: "a".repeat(64),
  graphFingerprint: "b".repeat(64),
  stageIds: ["read", "apply", "verify"],
};

function checkpoint(overrides = {}) {
  return createFutureLightReleaseCheckpoint({
    ...identity,
    runId: "release-test-run",
    now: () => "2026-09-24T12:00:00.000Z",
    ...overrides,
  });
}

test("checkpoint is durably round-tripped through an atomic local file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "future-light-checkpoint-test-"));
  try {
    const path = join(directory, "state.json");
    const initial = checkpoint();
    await writeFutureLightReleaseCheckpoint(path, initial);
    assert.deepEqual(await readFutureLightReleaseCheckpoint(path), initial);

    const updated = { ...initial, status: "failed", failure: { code: "network" } };
    await writeFutureLightReleaseCheckpoint(path, updated);
    assert.deepEqual(await readFutureLightReleaseCheckpoint(path), updated);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("resume starts at the first uncompleted stage only when target and all fingerprints match", () => {
  const saved = {
    ...checkpoint(),
    status: "waiting_for_network",
    completedStageIds: ["read"],
    receiptsByStage: { read: { readbackVerified: true } },
    failure: { code: "ENOTFOUND" },
  };
  const resumed = prepareFutureLightReleaseResume(saved, identity);
  assert.equal(resumed.nextStageIndex, 1);
  assert.equal(resumed.nextStageId, "apply");
  assert.equal(resumed.checkpoint, saved);
});

test("resume refuses changed target, manifest, graph, or stage order", () => {
  const saved = { ...checkpoint(), status: "failed" };
  assert.throws(() => prepareFutureLightReleaseResume(saved, { ...identity, shopDomain: "other.myshopify.com" }), /shopDomain does not match/);
  assert.throws(() => prepareFutureLightReleaseResume(saved, { ...identity, manifestFingerprint: "c".repeat(64) }), /manifestFingerprint does not match/);
  assert.throws(() => prepareFutureLightReleaseResume(saved, { ...identity, graphFingerprint: "d".repeat(64) }), /graphFingerprint does not match/);
  assert.throws(() => prepareFutureLightReleaseResume(saved, { ...identity, stageIds: ["read", "verify", "apply"] }), /stage graph does not exactly match/);
});

test("resume refuses a stage interrupted before its completion/readback receipt", () => {
  const saved = {
    ...checkpoint(),
    status: "interrupted",
    inProgressStageId: "apply",
    completedStageIds: ["read"],
    receiptsByStage: { read: { readbackVerified: true } },
  };
  assert.throws(() => prepareFutureLightReleaseResume(saved, identity), /requires live readback reconciliation.*apply/);
});

test("checkpoint validation rejects skipped or reordered stages", () => {
  assert.throws(() => validateFutureLightReleaseCheckpoint({
    ...checkpoint(),
    status: "failed",
    completedStageIds: ["read", "verify"],
  }), /contiguous prefix/);
  assert.throws(() => validateFutureLightReleaseCheckpoint({
    ...checkpoint(),
    status: "failed",
    inProgressStageId: "verify",
    completedStageIds: ["read"],
    receiptsByStage: { read: { readbackVerified: true } },
  }), /next uncompleted graph stage/);
});

test("only explicitly resumable checkpoints can resume", () => {
  assert.equal(prepareFutureLightReleaseResume(checkpoint(), identity).nextStageId, "read");
  assert.throws(
    () => prepareFutureLightReleaseResume({ ...checkpoint(), status: "completed" }, identity),
    /status completed is not resumable/,
  );
});
