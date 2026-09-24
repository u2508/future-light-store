#!/usr/bin/env node

import { resolve } from "node:path";

import {
  configMissing,
  loadVsStoreSocialEnv,
  readVsStoreSocialConfig,
  redactedConfig,
} from "./lib/vs-store-social-config.mjs";
import { acquireSocialLock, readSocialState, socialPaths } from "./lib/vs-store-social-state.mjs";
import {
  readBrowserIntent,
  readBrowserRequest,
  readBrowserResult,
  validateBrowserRequest,
  validateBrowserIntent,
  validateBrowserResult,
} from "./lib/vs-store-social-browser-result-schema.mjs";
import { reconcileBrowserResult } from "./lib/vs-store-social-publish-reconciler.mjs";
import {
  browserPublishSteps,
  runBusinessSuitePreflight,
  openBusinessSuite,
} from "./lib/vs-store-social-business-suite-browser.mjs";

const rootDir = resolve(import.meta.dirname, "..");

function parseArgs(argv) {
  const args = { login: false, check: false, resume: false };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--login") args.login = true;
    else if (token === "--check") args.check = true;
    else if (token === "--resume") args.resume = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

function assertConfig(config) {
  if (
    !["business-suite-browser", "meta-api-primary", "meta-api", "auto"].includes(
      config.socialPublisher,
    )
  )
    throw new Error(
      "Business Suite commands require VS_STORE_SOCIAL_PUBLISHER=meta-api-primary or business-suite-browser.",
    );
  const missing = configMissing(config);
  if (missing.length)
    throw new Error(`Browser workflow setup is incomplete: ${missing.join(", ")}`);
}

async function login(config) {
  const output = await openBusinessSuite(config, { headed: true });
  process.stdout.write(
    `${output}\nDedicated Business Suite session opened as ${config.browserSession}. Complete login, 2FA, consent, or CAPTCHA interactively; credentials are never stored by this runner.\n`,
  );
}

async function check(config) {
  const preflight = await runBusinessSuitePreflight(config);
  process.stdout.write(
    `${JSON.stringify(
      {
        mode: "read-only-browser-preflight",
        config: redactedConfig(config),
        status: preflight.status,
        reason: preflight.reason,
        pageIdentity: preflight.pageIdentity,
        instagramIdentity: preflight.instagramIdentity,
        canCreateContent: preflight.canCreateContent,
        pageUrl: preflight.pageUrl,
        pageTitle: preflight.pageTitle,
      },
      null,
      2,
    )}\n`,
  );
  if (preflight.status !== "ready") process.exitCode = 75;
}

async function resume(config) {
  const releaseLock = await acquireSocialLock(rootDir, { publisher: config.socialPublisher });
  try {
    const state = await readSocialState(rootDir);
    const request = await readBrowserRequest(config);
    if (!request)
      throw new Error(`No browser request exists at ${socialPaths(rootDir).browserRequest}.`);
    if (state.status === "completed" && state.lastRunKey === request.runKey && !state.pending) {
      process.stdout.write(
        `${JSON.stringify({ status: "completed", runKey: request.runKey, message: "This run is already reconciled; no duplicate action was taken." }, null, 2)}\n`,
      );
      return;
    }
    const intent = await readBrowserIntent(config);
    const result = await readBrowserResult(config);
    validateBrowserRequest(request, config, { allowExpired: Boolean(intent || result) });
    if (intent) validateBrowserIntent(intent, request);
    if (state.status === "publishing" && !result) {
      process.stdout.write(
        `${JSON.stringify(
          {
            status: "needs_review",
            runKey: request.runKey,
            attemptId: intent?.attemptId || state.pending?.browserAttemptId || null,
            message:
              "A submit intent exists without a verified browser result. Reconcile Business Suite Content/Published before any retry.",
          },
          null,
          2,
        )}\n`,
      );
      return;
    }
    if (!result) {
      process.stdout.write(
        `${JSON.stringify(
          {
            status: "waiting_for_browser",
            liveEnabled: config.socialLiveEnabled,
            requestFingerprint: request.fingerprint,
            steps: browserPublishSteps(request),
            resultPath: socialPaths(rootDir).browserResult,
            message: config.socialLiveEnabled
              ? "No browser result is available. Use the dedicated Business Suite browser worker, then record its independently verified result."
              : "Live publishing is disabled. No composer was opened and no post was submitted.",
          },
          null,
          2,
        )}\n`,
      );
      return;
    }
    if (intent && result.attemptId !== intent.attemptId)
      throw new Error("Browser result attempt ID does not match the durable submit intent.");
    await validateBrowserResult(result, request, config);
    const reconciled = await reconcileBrowserResult({
      rootDir,
      config,
      state,
      request,
      result,
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          status: reconciled.state.status,
          runKey: request.runKey,
          attemptId: result.attemptId,
          facebook: result.platforms.facebook.status,
          instagram: result.platforms.instagram.status,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await releaseLock();
  }
}

async function main() {
  const args = parseArgs(process.argv);
  await loadVsStoreSocialEnv(rootDir);
  const config = readVsStoreSocialConfig(rootDir);
  assertConfig(config);
  if (args.login) return login(config);
  if (args.check) return check(config);
  if (args.resume) return resume(config);
  throw new Error("Use --login, --check, or --resume.");
}

main().catch((error) => {
  process.stderr.write(`VS Store browser workflow failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
