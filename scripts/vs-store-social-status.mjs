#!/usr/bin/env node

import { resolve } from "node:path";

import {
  loadVsStoreSocialEnv,
  readVsStoreSocialConfig,
  redactedConfig,
  configMissing,
} from "./lib/vs-store-social-config.mjs";
import { readSocialState, socialPaths } from "./lib/vs-store-social-state.mjs";
import {
  readBrowserIntent,
  readBrowserRequest,
  readBrowserResult,
} from "./lib/vs-store-social-browser-result-schema.mjs";

const rootDir = resolve(import.meta.dirname, "..");

async function main() {
  await loadVsStoreSocialEnv(rootDir);
  const config = readVsStoreSocialConfig(rootDir);
  const state = await readSocialState(rootDir);
  const request = await readBrowserRequest(config);
  const intent = await readBrowserIntent(config);
  const result = await readBrowserResult(config);
  process.stdout.write(
    `${JSON.stringify(
      {
        config: redactedConfig(config),
        missing: configMissing(config),
        state: {
          schemaVersion: state.schemaVersion,
          publisher: state.publisher,
          status: state.status,
          lastRunKey: state.lastRunKey,
          pendingRunKey: state.pending?.runKey || null,
          pendingFingerprint:
            state.pending?.browserRequestFingerprint || state.pending?.fingerprint || null,
          nextRetryAt: state.pending?.nextRetryAt || null,
          platformStates: state.platformStates,
          historyCount: state.history?.length || 0,
          updatedAt: state.updatedAt,
          error: state.error || null,
        },
        browserRequest: request
          ? {
              path: socialPaths(rootDir).browserRequest,
              runKey: request.runKey,
              fingerprint: request.fingerprint,
              expiresAt: request.expiresAt,
              allowedPlatforms: request.allowedPlatforms,
            }
          : null,
        browserResult: result
          ? {
              path: socialPaths(rootDir).browserResult,
              runKey: result.runKey,
              requestFingerprint: result.requestFingerprint,
              status: result.status,
              attemptId: result.attemptId,
              platforms: result.platforms,
            }
          : null,
        browserIntent: intent
          ? {
              path: socialPaths(rootDir).browserIntent,
              runKey: intent.runKey,
              requestFingerprint: intent.requestFingerprint,
              attemptId: intent.attemptId,
              platforms: intent.platforms,
            }
          : null,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`VS Store social status failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
