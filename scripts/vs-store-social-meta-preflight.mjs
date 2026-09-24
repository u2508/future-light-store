#!/usr/bin/env node

import { resolve } from "node:path";

import {
  configMissing,
  loadVsStoreSocialEnv,
  readVsStoreSocialConfig,
  redactedConfig,
} from "./lib/vs-store-social-config.mjs";
import { createVsStoreMetaClient } from "./lib/vs-store-social-meta.mjs";

const rootDir = resolve(import.meta.dirname, "..");

async function main() {
  await loadVsStoreSocialEnv(rootDir);
  const config = readVsStoreSocialConfig(rootDir);
  const missing = configMissing(config, { includeShopify: false });
  if (missing.length) {
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: "meta-api-read-only-preflight",
          status: "not_ready",
          config: redactedConfig(config),
          missing,
          reason: "Standalone social identity configuration is incomplete.",
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = 2;
    return;
  }
  if (!config.metaPageAccessToken) {
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: "meta-api-read-only-preflight",
          status: "not_ready",
          config: redactedConfig(config),
          reason: "FUTURE_LIGHT_META_PAGE_ACCESS_TOKEN is not configured locally.",
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = 2;
    return;
  }
  const preflight = await createVsStoreMetaClient(config).preflight();
  process.stdout.write(
    `${JSON.stringify(
      {
        mode: "meta-api-read-only-preflight",
        status: preflight.status,
        config: redactedConfig(config),
        reason: preflight.reason,
        page: preflight.page,
        instagram: preflight.instagram,
        pageReady: preflight.pageReady,
        instagramReady: preflight.instagramReady,
      },
      null,
      2,
    )}\n`,
  );
  if (preflight.status !== "ready") process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`VS Store Meta API preflight failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
