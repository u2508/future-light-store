#!/usr/bin/env node

import { existsSync } from "node:fs";
import { readFile, rename, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import {
  configMissing,
  loadVsStoreSocialEnv,
  readVsStoreSocialConfig,
  redactedConfig,
} from "./lib/vs-store-social-config.mjs";
import {
  acquireSocialLock,
  appendSocialEvent,
  appendSocialJournal,
  readSocialState,
  socialPaths,
  writeSocialState,
} from "./lib/vs-store-social-state.mjs";
import {
  buildBrowserIntent,
  readBrowserIntent,
  readBrowserRequest,
  validateBrowserRequest,
  validateBrowserIntent,
  validateBrowserResult,
} from "./lib/vs-store-social-browser-result-schema.mjs";

const rootDir = resolve(import.meta.dirname, "..");

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--show-request") args.showRequest = true;
    else if (token === "--show-steps") args.showSteps = true;
    else if (token === "--write-intent") args.writeIntent = true;
    else if (token === "--validate-result") args.validateResult = true;
    else if (token === "--write-result") args.writeResult = true;
    else if (token === "--run-key") args.runKey = argv[++index];
    else if (token === "--fingerprint") args.fingerprint = argv[++index];
    else if (token === "--attempt-id") args.attemptId = argv[++index];
    else if (token === "--platforms")
      args.platforms = String(argv[++index] || "")
        .split(",")
        .map((platform) => platform.trim())
        .filter(Boolean);
    else if (token === "--result-path") args.resultPath = argv[++index];
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeAtomic(path, value) {
  await mkdir(resolve(path, ".."), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

async function main() {
  const args = parseArgs(process.argv);
  await loadVsStoreSocialEnv(rootDir);
  const config = readVsStoreSocialConfig(rootDir);
  if (
    !["business-suite-browser", "meta-api-primary", "meta-api", "auto"].includes(
      config.socialPublisher,
    )
  )
    throw new Error(
      "Browser bridge requires VS_STORE_SOCIAL_PUBLISHER=meta-api-primary or business-suite-browser.",
    );
  const missing = configMissing(config);
  if (missing.length) throw new Error(`Browser bridge setup is incomplete: ${missing.join(", ")}`);
  const request = await readBrowserRequest(config);
  if (!request)
    throw new Error(`No browser request exists at ${socialPaths(rootDir).browserRequest}.`);
  validateBrowserRequest(request, config, {
    allowExpired: args.writeResult || args.validateResult,
  });

  if (args.showRequest) {
    process.stdout.write(
      `${JSON.stringify({ request, config: redactedConfig(config) }, null, 2)}\n`,
    );
    return;
  }
  if (args.showSteps) {
    const { browserPublishSteps } =
      await import("./lib/vs-store-social-business-suite-browser.mjs");
    process.stdout.write(`${JSON.stringify(browserPublishSteps(request), null, 2)}\n`);
    return;
  }
  if (args.writeIntent) {
    if (!config.socialLiveEnabled)
      throw new Error("Live browser publishing is disabled; submit intent was not recorded.");
    if (!args.attemptId) throw new Error("--attempt-id is required when recording submit intent.");
    const intent = buildBrowserIntent({
      request,
      attemptId: args.attemptId,
      platforms: args.platforms?.length ? args.platforms : request.allowedPlatforms,
    });
    const releaseLock = await acquireSocialLock(rootDir, { publisher: config.socialPublisher });
    try {
      const state = await readSocialState(rootDir);
      const pending = state.pending;
      if (!pending || pending.runKey !== request.runKey)
        throw new Error("Submit intent does not match the current pending social run.");
      if (pending.browserRequestFingerprint !== request.fingerprint)
        throw new Error("Submit intent does not match the current browser request fingerprint.");
      if (pending.browserAttemptId && pending.browserAttemptId !== intent.attemptId)
        throw new Error("A different browser attempt is already recorded for this request.");
      const platformStates = {
        ...(state.platformStates || {}),
        ...(pending.platformStates || {}),
      };
      for (const platform of intent.platforms) {
        const priorStatus = platformStates[platform]?.status || "not_started";
        if (priorStatus === "published")
          throw new Error(`Refusing to submit a destination already verified: ${platform}.`);
        if (["unknown", "submit_intent"].includes(priorStatus))
          throw new Error(`Reconcile the existing ${platform} attempt before submitting again.`);
        platformStates[platform] = {
          ...(platformStates[platform] || {}),
          status: "submit_intent",
          attemptId: intent.attemptId,
          intentAt: intent.createdAt,
        };
      }
      const nextState = {
        ...state,
        status: "publishing",
        platformStates,
        pending: {
          ...pending,
          browserAttemptId: intent.attemptId,
          browserIntentPath: socialPaths(rootDir).browserIntent,
          browserIntentFingerprint: intent.fingerprint,
          platformStates,
        },
      };
      await writeAtomic(socialPaths(rootDir).browserIntent, intent);
      await writeSocialState(rootDir, nextState);
      await appendSocialEvent(rootDir, {
        type: "browser_submit_intent",
        runKey: request.runKey,
        attemptId: intent.attemptId,
        platforms: intent.platforms,
      });
      await appendSocialJournal(rootDir, {
        type: "browser_submit_intent",
        runKey: request.runKey,
        requestFingerprint: request.fingerprint,
        attemptId: intent.attemptId,
        platforms: intent.platforms,
      });
      process.stdout.write(
        `${JSON.stringify({ status: "publishing", runKey: request.runKey, attemptId: intent.attemptId, platforms: intent.platforms }, null, 2)}\n`,
      );
    } finally {
      await releaseLock();
    }
    return;
  }
  if (!args.validateResult && !args.writeResult)
    throw new Error(
      "Use --show-request, --show-steps, --write-intent, --validate-result, or --write-result.",
    );
  if (!args.resultPath) throw new Error("A browser result file is required.");
  const resultPath = resolve(args.resultPath);
  if (!existsSync(resultPath)) throw new Error(`Browser result file does not exist: ${resultPath}`);
  const result = await readJson(resultPath);
  if (args.runKey && result.runKey !== args.runKey)
    throw new Error("Browser result run key does not match --run-key.");
  if (args.fingerprint && result.requestFingerprint !== args.fingerprint)
    throw new Error("Browser result fingerprint does not match --fingerprint.");
  await validateBrowserResult(result, request, config);
  const state = await readSocialState(rootDir);
  if (state.pending?.browserAttemptId && result.attemptId !== state.pending.browserAttemptId)
    throw new Error("Browser result attempt ID does not match the durable submit intent.");
  const intent = await readBrowserIntent(config);
  if (intent) validateBrowserIntent(intent, request);
  if (args.validateResult) {
    process.stdout.write(
      `${JSON.stringify({ valid: true, status: result.status, attemptId: result.attemptId }, null, 2)}\n`,
    );
    return;
  }
  const releaseLock = await acquireSocialLock(rootDir, { publisher: config.socialPublisher });
  try {
    await writeAtomic(socialPaths(rootDir).browserResult, result);
    process.stdout.write(
      `Validated browser result copied to ${socialPaths(rootDir).browserResult}. Run npm run social:daily:resume-browser to reconcile it.\n`,
    );
  } finally {
    await releaseLock();
  }
}

main().catch((error) => {
  process.stderr.write(`VS Store browser bridge failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
