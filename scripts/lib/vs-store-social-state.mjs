import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const SOCIAL_STATE_VERSION = 4;

export function socialPaths(rootDir) {
  const directory = resolve(rootDir, "output", "social");
  return {
    directory,
    state: resolve(directory, "vs-store-facebook-daily-state.json"),
    lock: resolve(directory, ".vs-store-facebook-daily.lock"),
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
    couponRegistry: {},
    lastStalePending: null,
    usageLedger: {
      product: {},
      collection: {},
    },
    destinations: {
      facebook: { required: true },
      instagram: { required: true, username: "vs.store2608" },
    },
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
    const browserFallbackState =
      parsed?.status === "waiting_for_browser" ||
      parsed?.pending?.offerPlan?.status === "browser-required";
    return {
      ...defaultState(),
      ...parsed,
      schemaVersion: SOCIAL_STATE_VERSION,
      status: browserFallbackState ? "failed" : parsed?.status || "idle",
      pending: browserFallbackState ? null : parsed?.pending || null,
      error: browserFallbackState
        ? "Internal-browser fallback was removed; the social runner is API-only."
        : parsed?.error || null,
      usageLedger: {
        product: parsed?.usageLedger?.product || {},
        collection: parsed?.usageLedger?.collection || {},
      },
      destinations: {
        ...defaultState().destinations,
        ...(parsed?.destinations || {}),
        facebook: { required: true, ...(parsed?.destinations?.facebook || {}) },
        instagram: {
          required: true,
          username: "vs.store2608",
          ...(parsed?.destinations?.instagram || {}),
        },
      },
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

export function recordUsage(state, { kind, handle, usedAt, weekKey }) {
  if (!["product", "collection"].includes(kind) || !handle) return state;
  const currentLedger = state?.usageLedger?.[kind] || {};
  const normalizedHandle = String(handle).trim().toLowerCase();
  return {
    ...state,
    usageLedger: {
      ...(state?.usageLedger || {}),
      [kind]: {
        ...currentLedger,
        [normalizedHandle]: {
          uses: Number(currentLedger[normalizedHandle]?.uses || 0) + 1,
          firstUsedAt: currentLedger[normalizedHandle]?.firstUsedAt || usedAt,
          lastUsedAt: usedAt,
          lastUsedWeekKey: weekKey || currentLedger[normalizedHandle]?.lastUsedWeekKey || null,
        },
      },
    },
  };
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

export function isOfferStillActive(lastOffer, nowMs, windowDays = 7) {
  const startsAt = Date.parse(String(lastOffer?.startsAt || lastOffer?.createdAt || ""));
  const endsAt = Date.parse(String(lastOffer?.endsAt || ""));
  if (Number.isFinite(endsAt)) {
    return nowMs < endsAt && (!Number.isFinite(startsAt) || nowMs >= startsAt);
  }
  return Number.isFinite(startsAt) && nowMs - startsAt < windowDays * 24 * 60 * 60 * 1000;
}
