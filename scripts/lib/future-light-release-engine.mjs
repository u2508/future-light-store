import { isRetryableNetworkFailure, runStageWithNetworkRecovery, waitForNetworkRestoration } from "./future-light-network-recovery.mjs";
import { access } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  createFutureLightReleaseCheckpoint,
  prepareFutureLightReleaseResume,
  readFutureLightReleaseCheckpoint,
  validateFutureLightReleaseCheckpoint,
  writeFutureLightReleaseCheckpoint,
} from "./future-light-release-checkpoint.mjs";
import { acquireFutureLightReleaseLock } from "./future-light-release-process-lock.mjs";

function safeFailure(error) {
  const message = String(error?.message || error || "Unknown release failure")
    .replace(/\b(?:shpat|shpca|shppa|shpss)_[A-Za-z0-9_-]+\b/gi, "[redacted-token]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/([?&](?:access_token|token|key|password)=)[^&\s]+/gi, "$1[redacted]")
    .slice(0, 1_000);
  return { code: String(error?.code || error?.name || "RELEASE_ERROR").slice(0, 100), message };
}

function assertGraph(graph) {
  if (!graph || graph.target !== "shopify" || !Array.isArray(graph.stages) || graph.stages.length === 0) {
    throw new TypeError("A non-empty Shopify-only release graph is required");
  }
  const ids = new Set();
  for (const stage of graph.stages) {
    if (stage?.target !== "shopify" || typeof stage.id !== "string" || !stage.id.trim() ||
        typeof stage.resumeFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(stage.resumeFingerprint)) {
      throw new Error("Release graph contains an invalid stage or a non-Shopify target");
    }
    if (ids.has(stage.id)) throw new Error(`Duplicate release stage: ${stage.id}`);
    ids.add(stage.id);
  }
  const [targetStage, snapshotStage] = graph.stages;
  if (targetStage.id !== "shopify.preflight.target" || targetStage.kind !== "shopify-read" ||
      targetStage.operation !== "verify-target" || targetStage.scope !== "configured-shopify-store" ||
      !Array.isArray(targetStage.mutates) || targetStage.mutates.length !== 0 ||
      !Array.isArray(targetStage.dependsOn) || targetStage.dependsOn.length !== 0) {
    throw new Error("Release graph must begin at Step 1 with the canonical read-only Shopify target verification");
  }
  if (snapshotStage.id !== "shopify.read.approved-product-snapshot" || snapshotStage.kind !== "shopify-read" ||
      snapshotStage.operation !== "read-approved-product-snapshot" ||
      !Array.isArray(snapshotStage.mutates) || snapshotStage.mutates.length !== 0 ||
      !Array.isArray(snapshotStage.dependsOn) || snapshotStage.dependsOn.length !== 1 ||
      snapshotStage.dependsOn[0] !== targetStage.id) {
    throw new Error("Release graph Step 2 must read the approved snapshot after target verification");
  }
  return graph.stages;
}

function assertReceipt(receipt, stage) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt) ||
      receipt.target !== "shopify" || receipt.stageId !== stage.id ||
      receipt.stageFingerprint !== stage.resumeFingerprint || receipt.readbackVerified !== true ||
      !/^[a-f0-9]{64}$/.test(String(receipt.readbackFingerprint || "")) ||
      !Number.isFinite(Date.parse(receipt.verifiedAt))) {
    throw new Error(`Stage ${stage.id} did not return a complete, exact live-readback receipt`);
  }
  return receipt;
}

function assertReconciliation(result, stage) {
  const exact = result?.target === "shopify" && result?.stageId === stage.id &&
    result?.stageFingerprint === stage.resumeFingerprint && result?.readbackVerified === true;
  if (result?.status === "completed" && exact) {
    return { status: "completed", receipt: assertReceipt(result.receipt, stage) };
  }
  if (result?.status === "safe_to_retry" && exact && result.noMutationLanded === true) {
    return { status: "safe_to_retry" };
  }
  throw new Error(`Stage ${stage.id} reconciliation did not prove completion or a safe retry`);
}

function assertIdentity(checkpoint, identity, stages) {
  validateFutureLightReleaseCheckpoint(checkpoint);
  for (const [key, value] of Object.entries({
    shopDomain: identity.shopDomain,
    manifestFingerprint: identity.manifestFingerprint,
    graphFingerprint: identity.graphFingerprint,
  })) {
    if (checkpoint[key] !== value) throw new Error(`Resume refused: ${key} does not match the saved checkpoint`);
  }
  const stageIds = stages.map(({ id }) => id);
  if (checkpoint.stageIds.length !== stageIds.length || checkpoint.stageIds.some((id, index) => id !== stageIds[index])) {
    throw new Error("Resume refused: release stage graph does not exactly match the saved checkpoint");
  }
}

/**
 * Run a frozen Shopify-only graph. Stage handlers must provide read-only
 * connectivity probes, exact Shopify readback reconciliation, and a receipt
 * proving the requested stage is visible on the live store.
 */
export async function runFutureLightReleaseGraph({
  projectRoot,
  checkpointPath,
  shopDomain,
  manifestFingerprint,
  graph,
  handlers,
  resume = false,
  lockOptions = {},
  signal,
  now = () => new Date().toISOString(),
  sleep,
  minDelayMs = 1_000,
  maxDelayMs = 60_000,
  onStateChange = () => {},
} = {}) {
  const stages = assertGraph(graph);
  if (typeof projectRoot !== "string" || !projectRoot.trim()) throw new TypeError("projectRoot is required");
  if (typeof checkpointPath !== "string" || !checkpointPath.trim()) throw new TypeError("checkpointPath is required");
  if (typeof shopDomain !== "string" || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shopDomain)) {
    throw new TypeError("An explicit Shopify myshopify.com target is required");
  }
  if (typeof manifestFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(manifestFingerprint)) {
    throw new TypeError("manifestFingerprint must be a lowercase SHA-256 digest");
  }
  if (!handlers || typeof handlers !== "object") throw new TypeError("Stage handlers are required");
  for (const stage of stages) {
    const handler = handlers[stage.id];
    if (!handler || typeof handler.run !== "function" || typeof handler.probe !== "function" ||
        typeof handler.reconcile !== "function") {
      throw new TypeError(`Stage ${stage.id} requires run, probe, and reconcile handlers`);
    }
  }

  const lock = await acquireFutureLightReleaseLock({ projectRoot, ...lockOptions });
  let activeCheckpointPath = checkpointPath;
  let checkpoint;
  const persist = async () => {
    checkpoint.updatedAt = now();
    await writeFutureLightReleaseCheckpoint(activeCheckpointPath, checkpoint);
  };
  const report = async (event) => onStateChange(Object.freeze({ ...event, runId: checkpoint?.runId }));

  try {
    const identity = {
      shopDomain,
      manifestFingerprint,
      graphFingerprint: graph.graphFingerprint,
      stageIds: stages.map(({ id }) => id),
    };
    if (resume) {
      const existing = await readFutureLightReleaseCheckpoint(checkpointPath);
      if (!existing) throw new Error("Resume refused: no saved Future Light checkpoint exists");
      checkpoint = existing;
      assertIdentity(checkpoint, identity, stages);
      for (const stageId of checkpoint.completedStageIds) {
        const stage = stages.find(({ id }) => id === stageId);
        assertReceipt(checkpoint.receiptsByStage[stageId], stage);
      }

      const targetStage = stages[0];
      const targetHandler = handlers[targetStage.id];
      const targetExecution = await runStageWithNetworkRecovery({
        stageId: targetStage.id,
        stageFingerprint: targetStage.resumeFingerprint,
        mutating: false,
        run: ({ signal: stageSignal }) => targetHandler.run({ stage: targetStage, checkpoint, signal: stageSignal }),
        reconcile: ({ stageId, error, signal: stageSignal }) => targetHandler.reconcile({
          stage: targetStage,
          checkpoint,
          error,
          signal: stageSignal,
        }),
        probe: targetHandler.probe,
        signal,
        sleep,
        minDelayMs,
        maxDelayMs,
        onStateChange: async (event) => {
          checkpoint.status = event.state === "waiting_for_network" ? "waiting_for_network" : "running";
          checkpoint.failure = event.error ? { code: "NETWORK_WAIT", message: event.error } : null;
          await persist();
          await report({ ...event, stageId: targetStage.id, stageIndex: 0, stageCount: stages.length });
        },
      });
      const targetReceipt = targetExecution?.status === "reconciled_completed"
        ? assertReceipt(targetExecution.receipt, targetStage)
        : targetExecution?.status === "completed"
          ? assertReceipt(targetExecution.receipt, targetStage)
          : assertReceipt(null, targetStage);
      if (!checkpoint.completedStageIds.includes(targetStage.id)) {
        checkpoint.completedStageIds.unshift(targetStage.id);
      }
      checkpoint.receiptsByStage ||= {};
      checkpoint.receiptsByStage[targetStage.id] = targetReceipt;
      if (checkpoint.inProgressStageId === targetStage.id) checkpoint.inProgressStageId = null;
      checkpoint.status = "running";
      checkpoint.failure = null;
      await persist();
      await report({ state: "stage_reverified", stageId: targetStage.id, stageIndex: 0, stageCount: stages.length });

      if (checkpoint.inProgressStageId) {
        const stage = stages.find(({ id }) => id === checkpoint.inProgressStageId);
        const handler = handlers[stage.id];
        let outcome;
        for (;;) {
          try {
            outcome = assertReconciliation(await handler.reconcile({ stage, checkpoint, signal }), stage);
            break;
          } catch (error) {
            if (!isRetryableNetworkFailure(error)) throw error;
            checkpoint.status = "waiting_for_network";
            checkpoint.failure = safeFailure(error);
            await persist();
            await report({ state: "waiting_for_network", stageId: stage.id, error: checkpoint.failure.message });
            await waitForNetworkRestoration({
              probe: handler.probe,
              signal,
              sleep,
              minDelayMs,
              maxDelayMs,
              onStateChange: async (event) => {
                checkpoint.status = event.state === "waiting_for_network" ? "waiting_for_network" : "running";
                checkpoint.failure = event.error ? { code: "NETWORK_WAIT", message: event.error } : null;
                await persist();
                await report({ ...event, stageId: stage.id });
              },
            });
          }
        }
        if (outcome.status === "completed") {
          checkpoint.completedStageIds.push(stage.id);
          checkpoint.receiptsByStage ||= {};
          checkpoint.receiptsByStage[stage.id] = outcome.receipt;
        }
        checkpoint.inProgressStageId = null;
        checkpoint.status = "running";
        checkpoint.failure = null;
        await persist();
      }
      prepareFutureLightReleaseResume(checkpoint, identity);
    } else {
      try {
        await access(checkpointPath);
        activeCheckpointPath = `${checkpointPath}.fresh-${randomUUID()}`;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      checkpoint = createFutureLightReleaseCheckpoint(identity);
      checkpoint.receiptsByStage = {};
      await persist();
    }

    const firstIndex = checkpoint.completedStageIds.length;
    for (let index = firstIndex; index < stages.length; index += 1) {
      const stage = stages[index];
      const handler = handlers[stage.id];
      checkpoint.status = "running";
      checkpoint.failure = null;
      checkpoint.inProgressStageId = stage.id;
      await persist();
      await report({ state: "running", stageId: stage.id, stageIndex: index, stageCount: stages.length });

      try {
        const mutating = Array.isArray(stage.mutates) && stage.mutates.length > 0;
        const execution = await runStageWithNetworkRecovery({
          stageId: stage.id,
          stageFingerprint: stage.resumeFingerprint,
          mutating,
          run: ({ signal: stageSignal }) => handler.run({ stage, checkpoint, signal: stageSignal }),
          reconcile: ({ stageId, error, signal: stageSignal }) => handler.reconcile({
            stage,
            checkpoint,
            error,
            signal: stageSignal,
          }),
          probe: handler.probe,
          signal,
          sleep,
          minDelayMs,
          maxDelayMs,
          onStateChange: async (event) => {
            checkpoint.status = event.state === "waiting_for_network" ? "waiting_for_network" : "running";
            checkpoint.failure = event.error ? { code: "NETWORK_WAIT", message: event.error } : null;
            await persist();
            await report({ ...event, stageId: stage.id, stageIndex: index, stageCount: stages.length });
          },
        });
        const receipt = execution?.status === "reconciled_completed"
          ? assertReceipt(execution.receipt, stage)
          : execution?.status === "completed"
            ? assertReceipt(execution.receipt, stage)
            : assertReceipt(null, stage);
        checkpoint.receiptsByStage ||= {};
        checkpoint.receiptsByStage[stage.id] = receipt;
        checkpoint.completedStageIds.push(stage.id);
        checkpoint.inProgressStageId = null;
        checkpoint.status = "running";
        checkpoint.failure = null;
        await persist();
        await report({ state: "stage_completed", stageId: stage.id, stageIndex: index, stageCount: stages.length });
      } catch (error) {
        checkpoint.status = isRetryableNetworkFailure(error) ? "waiting_for_network" : "failed";
        checkpoint.failure = safeFailure(error);
        await persist();
        await report({ state: checkpoint.status, stageId: stage.id, error: checkpoint.failure.message });
        throw error;
      }
    }

    checkpoint.status = "completed";
    checkpoint.inProgressStageId = null;
    checkpoint.failure = null;
    await persist();
    await report({ state: "completed", stageCount: stages.length });
    return Object.freeze({ ...checkpoint, checkpointPath: activeCheckpointPath });
  } finally {
    await lock.close();
  }
}
