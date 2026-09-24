import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFutureLightReleaseCheckpoint, writeFutureLightReleaseCheckpoint } from "./future-light-release-checkpoint.mjs";
import { runFutureLightReleaseGraph } from "./future-light-release-engine.mjs";

const shopDomain = "vs-future-store-0jl2t-jxu6tnr3.myshopify.com";
const manifestFingerprint = "a".repeat(64);
const graphFingerprint = "b".repeat(64);
const readStage = Object.freeze({ id: "read", target: "shopify", kind: "shopify-read", mutates: [], resumeFingerprint: "c".repeat(64) });
const writeStage = Object.freeze({ id: "write", target: "shopify", kind: "shopify-mutation", mutates: ["product.title"], resumeFingerprint: "d".repeat(64) });
const verifyStage = Object.freeze({ id: "verify", target: "shopify", kind: "shopify-readback", mutates: [], resumeFingerprint: "e".repeat(64) });
const stages = [readStage, writeStage, verifyStage];
const graph = Object.freeze({ target: "shopify", graphFingerprint, stages });

function receipt(stage, id = "snapshot-1") {
  return {
    target: "shopify",
    stageId: stage.id,
    stageFingerprint: stage.resumeFingerprint,
    readbackVerified: true,
    readbackFingerprint: "f".repeat(64),
    verifiedAt: "2026-09-24T12:00:00.000Z",
    evidenceId: id,
  };
}

function handlersFor({ runWrite = async () => ({ status: "completed", receipt: receipt(writeStage) }),
  reconcileWrite = async () => ({ status: "safe_to_retry", target: "shopify", stageId: "write", stageFingerprint: writeStage.resumeFingerprint, readbackVerified: true, noMutationLanded: true }),
  calls = [] } = {}) {
  return {
    read: {
      probe: async () => true,
      run: async () => { calls.push("read"); return { status: "completed", receipt: receipt(readStage) }; },
      reconcile: async () => ({ status: "safe_to_retry", target: "shopify", stageId: "read", stageFingerprint: readStage.resumeFingerprint, readbackVerified: true, noMutationLanded: true }),
    },
    write: { probe: async () => true, run: async () => { calls.push("write"); return runWrite(); }, reconcile: reconcileWrite },
    verify: {
      probe: async () => true,
      run: async () => { calls.push("verify"); return { status: "completed", receipt: receipt(verifyStage) }; },
      reconcile: async () => ({ status: "safe_to_retry", target: "shopify", stageId: "verify", stageFingerprint: verifyStage.resumeFingerprint, readbackVerified: true, noMutationLanded: true }),
    },
  };
}

async function withWorkspace(callback) {
  const root = await mkdtemp(join(tmpdir(), "future-light-engine-test-"));
  try {
    return await callback({ root, checkpointPath: join(root, "release-state.json") });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("executes a Shopify-only graph in order and stores a verified receipt per stage", async () => {
  await withWorkspace(async ({ root, checkpointPath }) => {
    const calls = [];
    const result = await runFutureLightReleaseGraph({
      projectRoot: root,
      checkpointPath,
      shopDomain,
      manifestFingerprint,
      graph,
      handlers: handlersFor({ calls }),
      lockOptions: { port: 0 },
      now: () => "2026-09-24T12:00:00.000Z",
      minDelayMs: 0,
      maxDelayMs: 0,
    });
    assert.deepEqual(calls, ["read", "write", "verify"]);
    assert.equal(result.status, "completed");
    assert.deepEqual(result.completedStageIds, ["read", "write", "verify"]);
    assert.equal(Object.keys(result.receiptsByStage).length, 3);
  });
});

test("resume reconciles an uncertain in-progress write before deciding not to replay it", async () => {
  await withWorkspace(async ({ root, checkpointPath }) => {
    const initial = createFutureLightReleaseCheckpoint({
      shopDomain,
      manifestFingerprint,
      graphFingerprint,
      stageIds: stages.map(({ id }) => id),
      now: () => "2026-09-24T12:00:00.000Z",
    });
    initial.status = "failed";
    initial.completedStageIds = ["read"];
    initial.receiptsByStage = { read: receipt(readStage) };
    initial.inProgressStageId = "write";
    await writeFutureLightReleaseCheckpoint(checkpointPath, initial);

    const calls = [];
    const handlers = handlersFor({
      calls,
      runWrite: async () => { throw new Error("write must not replay"); },
      reconcileWrite: async () => ({
        status: "completed",
        target: "shopify",
        stageId: "write",
        stageFingerprint: writeStage.resumeFingerprint,
        readbackVerified: true,
        receipt: receipt(writeStage, "live-after-crash"),
      }),
    });
    const result = await runFutureLightReleaseGraph({
      projectRoot: root,
      checkpointPath,
      shopDomain,
      manifestFingerprint,
      graph,
      handlers,
      resume: true,
      lockOptions: { port: 0 },
      now: () => "2026-09-24T12:01:00.000Z",
      minDelayMs: 0,
      maxDelayMs: 0,
    });
    assert.deepEqual(calls, ["verify"]);
    assert.equal(result.status, "completed");
    assert.equal(result.receiptsByStage.write.evidenceId, "live-after-crash");
  });
});

test("resume fails closed when the interrupted mutation has no exact readback result", async () => {
  await withWorkspace(async ({ root, checkpointPath }) => {
    const initial = createFutureLightReleaseCheckpoint({
      shopDomain,
      manifestFingerprint,
      graphFingerprint,
      stageIds: stages.map(({ id }) => id),
    });
    initial.status = "failed";
    initial.completedStageIds = ["read"];
    initial.receiptsByStage = { read: receipt(readStage) };
    initial.inProgressStageId = "write";
    await writeFutureLightReleaseCheckpoint(checkpointPath, initial);
    const calls = [];
    const handlers = handlersFor({
      calls,
      reconcileWrite: async () => ({ status: "unknown" }),
    });
    await assert.rejects(runFutureLightReleaseGraph({
      projectRoot: root,
      checkpointPath,
      shopDomain,
      manifestFingerprint,
      graph,
      handlers,
      resume: true,
      lockOptions: { port: 0 },
    }), /did not prove completion or a safe retry/);
    assert.deepEqual(calls, []);
  });
});

test("rejects a graph containing a non-Shopify stage before acquiring the release lock", async () => {
  await withWorkspace(async ({ root, checkpointPath }) => {
    await assert.rejects(runFutureLightReleaseGraph({
      projectRoot: root,
      checkpointPath,
      shopDomain,
      manifestFingerprint,
      graph: { ...graph, stages: [{ ...readStage, target: "theme" }] },
      handlers: {},
    }), /non-Shopify target/);
  });
});
