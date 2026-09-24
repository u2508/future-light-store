import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

export const FUTURE_LIGHT_RELEASE_CHECKPOINT_SCHEMA = 1;

const TERMINAL_STATUSES = new Set(["completed", "cancelled"]);
const RESUMABLE_STATUSES = new Set(["prepared", "running", "failed", "interrupted", "waiting_for_network"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

export function createFutureLightReleaseCheckpoint({
  runId = randomUUID(),
  shopDomain,
  manifestFingerprint,
  graphFingerprint,
  stageIds,
  now = () => new Date().toISOString(),
} = {}) {
  const stages = Array.isArray(stageIds) ? [...stageIds] : null;
  if (!stages || stages.some((id) => typeof id !== "string" || !id.trim())) {
    throw new TypeError("stageIds must be an array of non-empty stage IDs");
  }
  if (new Set(stages).size !== stages.length) throw new Error("stageIds must be unique");
  return {
    schemaVersion: FUTURE_LIGHT_RELEASE_CHECKPOINT_SCHEMA,
    runId: requiredString(runId, "runId"),
    shopDomain: requiredString(shopDomain, "shopDomain"),
    manifestFingerprint: requiredString(manifestFingerprint, "manifestFingerprint"),
    graphFingerprint: requiredString(graphFingerprint, "graphFingerprint"),
    stageIds: stages,
    completedStageIds: [],
    receiptsByStage: {},
    status: "prepared",
    inProgressStageId: null,
    createdAt: now(),
    updatedAt: now(),
    failure: null,
  };
}

export function validateFutureLightReleaseCheckpoint(value) {
  if (!isRecord(value) || value.schemaVersion !== FUTURE_LIGHT_RELEASE_CHECKPOINT_SCHEMA) {
    throw new Error("Unsupported or malformed Future Light release checkpoint");
  }
  requiredString(value.runId, "checkpoint.runId");
  requiredString(value.shopDomain, "checkpoint.shopDomain");
  requiredString(value.manifestFingerprint, "checkpoint.manifestFingerprint");
  requiredString(value.graphFingerprint, "checkpoint.graphFingerprint");
  if (!Array.isArray(value.stageIds) || value.stageIds.some((id) => typeof id !== "string" || !id)) {
    throw new Error("checkpoint.stageIds must be an array of stage IDs");
  }
  if (new Set(value.stageIds).size !== value.stageIds.length) {
    throw new Error("checkpoint.stageIds must be unique");
  }
  if (!Array.isArray(value.completedStageIds)) {
    throw new Error("checkpoint.completedStageIds must be an array");
  }
  let completedCount = 0;
  for (const stageId of value.completedStageIds) {
    if (value.stageIds[completedCount] !== stageId) {
      throw new Error("checkpoint completed stages must be a contiguous prefix of the release graph");
    }
    completedCount += 1;
  }
  if (!isRecord(value.receiptsByStage)) throw new Error("checkpoint.receiptsByStage must be an object");
  for (const stageId of value.completedStageIds) {
    if (!Object.hasOwn(value.receiptsByStage, stageId)) {
      throw new Error(`checkpoint is missing the exact receipt for completed stage ${stageId}`);
    }
  }
  for (const stageId of Object.keys(value.receiptsByStage)) {
    if (!value.completedStageIds.includes(stageId)) {
      throw new Error(`checkpoint has a receipt for uncompleted stage ${stageId}`);
    }
  }
  if (value.inProgressStageId !== null && value.inProgressStageId !== value.stageIds[completedCount]) {
    throw new Error("checkpoint in-progress stage must be the next uncompleted graph stage");
  }
  if (TERMINAL_STATUSES.has(value.status) && value.inProgressStageId !== null) {
    throw new Error(`terminal checkpoint status ${value.status} cannot have an in-progress stage`);
  }
  return value;
}

export function prepareFutureLightReleaseResume(checkpoint, {
  shopDomain,
  manifestFingerprint,
  graphFingerprint,
  stageIds,
} = {}) {
  validateFutureLightReleaseCheckpoint(checkpoint);
  if (!RESUMABLE_STATUSES.has(checkpoint.status)) {
    throw new Error(`Checkpoint status ${checkpoint.status} is not resumable`);
  }
  for (const [key, expected] of Object.entries({ shopDomain, manifestFingerprint, graphFingerprint })) {
    if (typeof expected !== "string" || expected !== checkpoint[key]) {
      throw new Error(`Resume refused: ${key} does not match the saved checkpoint`);
    }
  }
  if (!Array.isArray(stageIds) || stageIds.length !== checkpoint.stageIds.length ||
      stageIds.some((id, index) => id !== checkpoint.stageIds[index])) {
    throw new Error("Resume refused: release stage graph does not exactly match the saved checkpoint");
  }
  if (checkpoint.inProgressStageId !== null) {
    throw new Error(
      `Resume requires live readback reconciliation for in-progress stage ${checkpoint.inProgressStageId}; no stage was skipped or retried`,
    );
  }
  return Object.freeze({
    checkpoint,
    nextStageIndex: checkpoint.completedStageIds.length,
    nextStageId: checkpoint.stageIds[checkpoint.completedStageIds.length] || null,
  });
}

export async function readFutureLightReleaseCheckpoint(path) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Release checkpoint JSON is invalid: ${error.message}`);
  }
  return validateFutureLightReleaseCheckpoint(parsed);
}

export async function writeFutureLightReleaseCheckpoint(path, value, { mode = 0o600 } = {}) {
  validateFutureLightReleaseCheckpoint(value);
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let file;
  try {
    file = await open(temporaryPath, "wx", mode);
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await file.sync();
    await file.close();
    file = null;
    await rename(temporaryPath, path);
    try {
      const directoryHandle = await open(directory, "r");
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } catch {
      // Some filesystems do not support syncing directories; file data is synced.
    }
  } catch (error) {
    if (file) await file.close().catch(() => {});
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}
