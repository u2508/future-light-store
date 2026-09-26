import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createFutureLightReleaseCheckpoint,
  writeFutureLightReleaseCheckpoint,
} from "./future-light-release-checkpoint.mjs";
import { runFutureLightReleaseGraph } from "./future-light-release-engine.mjs";

const shopDomain = "vs-future-store-0jl2t-jxu6tnr3.myshopify.com";
const manifestFingerprint = "a".repeat(64);
const graphFingerprint = "b".repeat(64);
const targetStage = Object.freeze({
  id: "shopify.preflight.target",
  target: "shopify",
  kind: "shopify-read",
  operation: "verify-target",
  scope: "configured-shopify-store",
  mutates: [],
  dependsOn: [],
  resumeFingerprint: "c".repeat(64),
});
const readStage = Object.freeze({
  id: "shopify.read.approved-product-snapshot",
  target: "shopify",
  kind: "shopify-read",
  operation: "read-approved-product-snapshot",
  scope: "approved-product-manifest",
  mutates: [],
  dependsOn: [targetStage.id],
  resumeFingerprint: "1".repeat(64),
});
const writeStage = Object.freeze({
  id: "write",
  target: "shopify",
  kind: "shopify-mutation",
  mutates: ["product.title"],
  resumeFingerprint: "d".repeat(64),
});
const verifyStage = Object.freeze({
  id: "verify",
  target: "shopify",
  kind: "shopify-readback",
  mutates: [],
  resumeFingerprint: "e".repeat(64),
});
const stages = [targetStage, readStage, writeStage, verifyStage];
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

function handlersFor({
  runWrite = async () => ({ status: "completed", receipt: receipt(writeStage) }),
  reconcileWrite = async () => ({
    status: "safe_to_retry",
    target: "shopify",
    stageId: "write",
    stageFingerprint: writeStage.resumeFingerprint,
    readbackVerified: true,
    noMutationLanded: true,
  }),
  calls = [],
} = {}) {
  return {
    [targetStage.id]: {
      probe: async () => true,
      run: async () => {
        calls.push("target");
        return { status: "completed", receipt: receipt(targetStage) };
      },
      reconcile: async () => ({
        status: "safe_to_retry",
        target: "shopify",
        stageId: targetStage.id,
        stageFingerprint: targetStage.resumeFingerprint,
        readbackVerified: true,
        noMutationLanded: true,
      }),
    },
    [readStage.id]: {
      probe: async () => true,
      run: async () => {
        calls.push("snapshot");
        return { status: "completed", receipt: receipt(readStage) };
      },
      reconcile: async () => ({
        status: "safe_to_retry",
        target: "shopify",
        stageId: readStage.id,
        stageFingerprint: readStage.resumeFingerprint,
        readbackVerified: true,
        noMutationLanded: true,
      }),
    },
    write: {
      probe: async () => true,
      run: async () => {
        calls.push("write");
        return runWrite();
      },
      reconcile: reconcileWrite,
    },
    verify: {
      probe: async () => true,
      run: async () => {
        calls.push("verify");
        return { status: "completed", receipt: receipt(verifyStage) };
      },
      reconcile: async () => ({
        status: "safe_to_retry",
        target: "shopify",
        stageId: "verify",
        stageFingerprint: verifyStage.resumeFingerprint,
        readbackVerified: true,
        noMutationLanded: true,
      }),
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
    assert.deepEqual(calls, ["target", "snapshot", "write", "verify"]);
    assert.equal(result.status, "completed");
    assert.deepEqual(result.completedStageIds, [targetStage.id, readStage.id, "write", "verify"]);
    assert.equal(Object.keys(result.receiptsByStage).length, 4);
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
    initial.completedStageIds = [targetStage.id, readStage.id];
    initial.receiptsByStage = {
      [targetStage.id]: receipt(targetStage),
      [readStage.id]: receipt(readStage),
    };
    initial.inProgressStageId = "write";
    await writeFutureLightReleaseCheckpoint(checkpointPath, initial);

    const calls = [];
    const handlers = handlersFor({
      calls,
      runWrite: async () => {
        throw new Error("write must not replay");
      },
      reconcileWrite: async () => {
        calls.push("reconcile-write");
        return {
          status: "completed",
          target: "shopify",
          stageId: "write",
          stageFingerprint: writeStage.resumeFingerprint,
          readbackVerified: true,
          receipt: receipt(writeStage, "live-after-crash"),
        };
      },
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
    assert.deepEqual(calls, ["target", "snapshot", "reconcile-write", "verify"]);
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
    initial.completedStageIds = [targetStage.id, readStage.id];
    initial.receiptsByStage = {
      [targetStage.id]: receipt(targetStage),
      [readStage.id]: receipt(readStage),
    };
    initial.inProgressStageId = "write";
    await writeFutureLightReleaseCheckpoint(checkpointPath, initial);
    const calls = [];
    const handlers = handlersFor({
      calls,
      reconcileWrite: async () => ({ status: "unknown" }),
    });
    await assert.rejects(
      runFutureLightReleaseGraph({
        projectRoot: root,
        checkpointPath,
        shopDomain,
        manifestFingerprint,
        graph,
        handlers,
        resume: true,
        lockOptions: { port: 0 },
      }),
      /did not prove completion or a safe retry/,
    );
    assert.deepEqual(calls, ["target", "snapshot"]);
  });
});

test("resume refreshes receipts for completed mutations before advancing", async () => {
  await withWorkspace(async ({ root, checkpointPath }) => {
    const initial = createFutureLightReleaseCheckpoint({
      shopDomain,
      manifestFingerprint,
      graphFingerprint,
      stageIds: stages.map(({ id }) => id),
    });
    initial.status = "failed";
    initial.completedStageIds = [targetStage.id, readStage.id, writeStage.id];
    initial.receiptsByStage = {
      [targetStage.id]: receipt(targetStage),
      [readStage.id]: receipt(readStage),
      [writeStage.id]: receipt(writeStage, "old-write-receipt"),
    };
    initial.inProgressStageId = verifyStage.id;
    await writeFutureLightReleaseCheckpoint(checkpointPath, initial);

    const calls = [];
    const handlers = handlersFor({
      calls,
      reconcileWrite: async () => {
        calls.push("reconcile-completed-write");
        return {
          status: "completed",
          target: "shopify",
          stageId: writeStage.id,
          stageFingerprint: writeStage.resumeFingerprint,
          readbackVerified: true,
          receipt: receipt(writeStage, "fresh-live-write-readback"),
        };
      },
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
      minDelayMs: 0,
      maxDelayMs: 0,
    });

    assert.deepEqual(calls, ["target", "snapshot", "reconcile-completed-write", "verify"]);
    assert.equal(result.receiptsByStage[writeStage.id].evidenceId, "fresh-live-write-readback");
  });
});

test("resume refuses a malformed receipt before making any network request", async () => {
  await withWorkspace(async ({ root, checkpointPath }) => {
    const initial = createFutureLightReleaseCheckpoint({
      shopDomain,
      manifestFingerprint,
      graphFingerprint,
      stageIds: stages.map(({ id }) => id),
    });
    initial.status = "failed";
    initial.completedStageIds = [targetStage.id];
    initial.receiptsByStage = {
      [targetStage.id]: { ...receipt(targetStage), stageFingerprint: "0".repeat(64) },
    };
    initial.inProgressStageId = readStage.id;
    await writeFutureLightReleaseCheckpoint(checkpointPath, initial);

    const calls = [];
    await assert.rejects(
      runFutureLightReleaseGraph({
        projectRoot: root,
        checkpointPath,
        shopDomain,
        manifestFingerprint,
        graph,
        handlers: handlersFor({ calls }),
        resume: true,
        lockOptions: { port: 0 },
      }),
      /complete, exact live-readback receipt/,
    );
    assert.deepEqual(calls, []);
  });
});

test("rejects a graph containing a non-Shopify stage before acquiring the release lock", async () => {
  await withWorkspace(async ({ root, checkpointPath }) => {
    await assert.rejects(
      runFutureLightReleaseGraph({
        projectRoot: root,
        checkpointPath,
        shopDomain,
        manifestFingerprint,
        graph: {
          ...graph,
          stages: [{ ...targetStage, target: "theme" }, readStage, writeStage, verifyStage],
        },
        handlers: {},
      }),
      /non-Shopify target/,
    );
  });
});

test("rejects any fresh graph that does not begin with canonical Step 1 target verification", async () => {
  await withWorkspace(async ({ root, checkpointPath }) => {
    await assert.rejects(
      runFutureLightReleaseGraph({
        projectRoot: root,
        checkpointPath,
        shopDomain,
        manifestFingerprint,
        graph: { ...graph, stages: [readStage, writeStage, verifyStage] },
        handlers: handlersFor(),
      }),
      /begin at Step 1/,
    );
  });
});

test("a fresh run preserves old checkpoint and starts Step 1 in a separate run file", async () => {
  await withWorkspace(async ({ root, checkpointPath }) => {
    const old = createFutureLightReleaseCheckpoint({
      shopDomain,
      manifestFingerprint,
      graphFingerprint,
      stageIds: stages.map(({ id }) => id),
    });
    old.status = "failed";
    await writeFutureLightReleaseCheckpoint(checkpointPath, old);
    const calls = [];
    const result = await runFutureLightReleaseGraph({
      projectRoot: root,
      checkpointPath,
      shopDomain,
      manifestFingerprint,
      graph,
      handlers: handlersFor({ calls }),
      lockOptions: { port: 0 },
      minDelayMs: 0,
      maxDelayMs: 0,
    });
    assert.equal(result.status, "completed");
    assert.equal(result.checkpointPath === checkpointPath, false);
    assert.deepEqual(calls.slice(0, 2), ["target", "snapshot"]);
    const preservedCheckpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
    const freshCheckpoint = JSON.parse(await readFile(result.checkpointPath, "utf8"));
    assert.equal(preservedCheckpoint.runId, old.runId);
    assert.equal(freshCheckpoint.status, "completed");
  });
});
