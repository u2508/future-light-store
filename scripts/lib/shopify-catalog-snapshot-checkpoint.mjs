import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const ARCHIVABLE_STATUSES = new Set([
  "NOT_STARTED",
  "COMPLETED",
  "FAILED",
  "CANCELED",
  "EXPIRED",
]);

export function parseSnapshotCliArgs(args) {
  const allowed = new Set(["--fresh", "--retry-failed"]);
  if (
    !Array.isArray(args) ||
    args.some((arg) => !allowed.has(arg)) ||
    args.length > 1
  ) {
    throw new Error("Usage: node future-light-shopify-bulk-catalog-snapshot.mjs [--fresh | --retry-failed]");
  }
  return { fresh: args.includes("--fresh"), retryFailed: args.includes("--retry-failed") };
}

/** Requeue only terminal failures, keeping completed export artifacts and recording the old IDs. */
export async function retryTerminalFailedSnapshotOperations({
  checkpointPath,
  expectedStore,
  checkpointVersion,
  operationNames,
  expectedQueryHashes,
  now = new Date(),
}) {
  let checkpoint;
  try {
    checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error("No catalog snapshot checkpoint exists to retry.");
    throw new Error(`Cannot safely inspect the existing snapshot checkpoint: ${error.message}`);
  }

  const incompatible =
    checkpoint?.version !== checkpointVersion ||
    checkpoint?.storeDomain !== expectedStore ||
    !checkpoint?.operations ||
    !checkpoint?.queries ||
    operationNames.some(
      (name) =>
        checkpoint.queries[name] !== expectedQueryHashes[name] ||
        checkpoint.operations[name]?.queryHash !== expectedQueryHashes[name],
    );
  if (incompatible) {
    throw new Error("Existing Shopify snapshot checkpoint is incompatible; preserved without changes.");
  }

  const failures = [];
  for (const name of operationNames) {
    const operation = checkpoint.operations[name];
    if (!operation || !ARCHIVABLE_STATUSES.has(operation.status)) {
      throw new Error(`Snapshot operation ${name} is active or unknown; checkpoint preserved.`);
    }
    if (operation.status === "FAILED" || operation.status === "CANCELED" || operation.status === "EXPIRED") {
      if (typeof operation.id !== "string" || !operation.id) {
        throw new Error(`Failed snapshot operation ${name} has no recorded Shopify ID; checkpoint preserved.`);
      }
      failures.push({ name, operation });
    }
  }
  if (!failures.length) return { retried: false, reason: "no-terminal-failures" };

  checkpoint.retryHistory = Array.isArray(checkpoint.retryHistory) ? checkpoint.retryHistory : [];
  for (const { name, operation } of failures) {
    checkpoint.retryHistory.push({
      name,
      previousId: operation.id,
      previousStatus: operation.status,
      previousErrorCode: operation.errorCode || null,
      retriedAt: now.toISOString(),
    });
    checkpoint.operations[name] = {
      ...operation,
      id: null,
      status: "NOT_STARTED",
      startedAt: null,
      errorCode: null,
      objectCount: null,
      rootObjectCount: null,
      localJsonl: null,
      lineCount: null,
    };
  }

  const temporaryPath = `${checkpointPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(checkpoint, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  await rename(temporaryPath, checkpointPath);
  return { retried: true, operations: failures.map(({ name }) => name), retryCount: checkpoint.retryHistory.length };
}

/** Archive only a fully terminal checkpoint that belongs to this exact read query/store. */
export async function archiveTerminalSnapshotCheckpoint({
  checkpointPath,
  archiveDir,
  expectedStore,
  checkpointVersion,
  operationNames,
  expectedQueryHashes,
  now = new Date(),
  id = randomUUID(),
}) {
  let checkpoint;
  try {
    checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return { archived: false, reason: "missing" };
    throw new Error(`Cannot safely inspect the existing snapshot checkpoint: ${error.message}`);
  }

  const incompatible =
    checkpoint?.version !== checkpointVersion ||
    checkpoint?.storeDomain !== expectedStore ||
    !checkpoint?.operations ||
    !checkpoint?.queries ||
    operationNames.some(
      (name) =>
        checkpoint.queries[name] !== expectedQueryHashes[name] ||
        checkpoint.operations[name]?.queryHash !== expectedQueryHashes[name],
    );
  if (incompatible) {
    throw new Error("Existing Shopify snapshot checkpoint is incompatible; preserved without changes.");
  }

  for (const name of operationNames) {
    const operation = checkpoint.operations[name];
    if (!operation || !ARCHIVABLE_STATUSES.has(operation.status)) {
      throw new Error(`Snapshot operation ${name} is not in a verified terminal state; checkpoint preserved.`);
    }
    if (operation.status === "NOT_STARTED" ? operation.id != null : typeof operation.id !== "string" || !operation.id) {
      throw new Error(`Snapshot operation ${name} has inconsistent ID/status data; checkpoint preserved.`);
    }
  }

  await mkdir(archiveDir, { recursive: true });
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  const archivePath = join(
    archiveDir,
    `${basename(checkpointPath, ".json")}.recovery-${timestamp}-${id}.json`,
  );
  try {
    await copyFile(checkpointPath, archivePath, 1); // COPYFILE_EXCL: never overwrite a recovery artifact.
  } catch (error) {
    throw new Error(`Could not preserve the old snapshot checkpoint at a unique recovery path: ${error.message}`);
  }
  try {
    await unlink(checkpointPath);
  } catch (error) {
    throw new Error(`Checkpoint was copied to ${archivePath} but not retired: ${error.message}`);
  }
  return { archived: true, archivePath, runId: checkpoint.runId };
}
