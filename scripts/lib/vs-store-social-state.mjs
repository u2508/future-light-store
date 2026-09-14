import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const SOCIAL_STATE_VERSION = 1;

export function socialPaths(rootDir) {
  const directory = resolve(rootDir, "output", "social");
  return {
    directory,
    state: resolve(directory, "vs-store-facebook-daily-state.json"),
    lock: resolve(directory, ".vs-store-facebook-daily.lock"),
    browserRequest: resolve(directory, "browser-fallback-request.json"),
    browserResult: resolve(directory, "browser-fallback-result.json"),
    imageGenRequest: resolve(directory, "imagegen-request.json"),
    imageGenResult: resolve(directory, "imagegen-result.json"),
    eventLog: resolve(directory, "events.jsonl"),
  };
}

function defaultState() {
  return {
    schemaVersion: SOCIAL_STATE_VERSION,
    status: "idle",
    nextRotation: 0,
    lastRunKey: null,
    lastOffer: null,
    pending: null,
    history: [],
    updatedAt: null,
  };
}

async function writeAtomic(filePath, value) {
  await mkdir(resolve(filePath, ".."), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

export async function readSocialState(rootDir) {
  const filePath = socialPaths(rootDir).state;
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    return {
      ...defaultState(),
      ...parsed,
      history: Array.isArray(parsed?.history) ? parsed.history : [],
    };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return defaultState();
  }
}

export async function writeSocialState(rootDir, state) {
  const normalized = {
    ...defaultState(),
    ...state,
    schemaVersion: SOCIAL_STATE_VERSION,
    updatedAt: new Date().toISOString(),
  };
  await writeAtomic(socialPaths(rootDir).state, normalized);
  return normalized;
}

export async function appendSocialEvent(rootDir, event) {
  const paths = socialPaths(rootDir);
  await mkdir(paths.directory, { recursive: true });
  await writeFile(
    paths.eventLog,
    `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`,
    {
      encoding: "utf8",
      flag: "a",
    },
  );
}

function pidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function acquireSocialLock(rootDir, { staleAfterMs = 8 * 60 * 60 * 1000 } = {}) {
  const paths = socialPaths(rootDir);
  await mkdir(paths.directory, { recursive: true });
  try {
    await mkdir(paths.lock);
    await writeFile(
      resolve(paths.lock, "owner.json"),
      `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
      "utf8",
    );
    return async () => {
      await rm(paths.lock, { recursive: true, force: true });
    };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    let metadata = null;
    try {
      metadata = JSON.parse(await readFile(resolve(paths.lock, "owner.json"), "utf8"));
    } catch {
      // A lock directory without metadata is treated as stale only after the
      // directory itself has aged past the safety window.
    }
    let ageMs = 0;
    try {
      ageMs = Date.now() - (await stat(paths.lock)).mtimeMs;
    } catch {
      ageMs = 0;
    }
    if (ageMs > staleAfterMs && !pidIsAlive(Number(metadata?.pid))) {
      await rm(paths.lock, { recursive: true, force: true });
      return acquireSocialLock(rootDir, { staleAfterMs });
    }
    throw new Error(
      `VS Store social automation is already running (pid ${metadata?.pid || "unknown"}).`,
    );
  }
}

export async function writeBrowserFallbackRequest(rootDir, request) {
  const paths = socialPaths(rootDir);
  await writeAtomic(paths.browserRequest, {
    schemaVersion: 1,
    status: "pending",
    createdAt: new Date().toISOString(),
    ...request,
  });
}

export async function writeImageGenRequest(rootDir, request) {
  const paths = socialPaths(rootDir);
  await writeAtomic(paths.imageGenRequest, {
    schemaVersion: 1,
    status: "pending",
    createdAt: new Date().toISOString(),
    mode: "imagegen",
    ...request,
  });
}

export async function readImageGenRequest(rootDir) {
  const filePath = socialPaths(rootDir).imageGenRequest;
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeImageGenResult(rootDir, result) {
  const paths = socialPaths(rootDir);
  await writeAtomic(paths.imageGenResult, {
    schemaVersion: 1,
    status: "success",
    recordedAt: new Date().toISOString(),
    mode: "imagegen",
    ...result,
  });
}

export async function readImageGenResult(rootDir) {
  const filePath = socialPaths(rootDir).imageGenResult;
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function clearImageGenResult(rootDir) {
  await rm(socialPaths(rootDir).imageGenResult, { force: true });
}

export async function clearImageGenFiles(rootDir) {
  const paths = socialPaths(rootDir);
  await Promise.all([
    rm(paths.imageGenRequest, { force: true }),
    rm(paths.imageGenResult, { force: true }),
  ]);
}

export async function readBrowserFallbackResult(rootDir) {
  const filePath = socialPaths(rootDir).browserResult;
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function clearBrowserFallbackFiles(rootDir) {
  const paths = socialPaths(rootDir);
  await Promise.all([
    rm(paths.browserRequest, { force: true }),
    rm(paths.browserResult, { force: true }),
  ]);
}

export function isOfferStillActive(lastOffer, nowMs, windowDays = 7) {
  const createdAt = Date.parse(String(lastOffer?.createdAt || ""));
  return Number.isFinite(createdAt) && nowMs - createdAt < windowDays * 24 * 60 * 60 * 1000;
}
