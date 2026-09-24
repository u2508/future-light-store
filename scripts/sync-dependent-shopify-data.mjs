#!/usr/bin/env node

import { spawn } from "node:child_process";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dirname, "..");
const shopBase =
  process.env.SALT_SHOP_URL || "https://vs-future-store-0jl2t-jxu6tnr3.myshopify.com";
const dependentSyncScripts = [
  "sync-recently-ordered-products.mjs",
  "sync-managed-collection-membership.mjs",
];

function runScript(scriptName, children) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [resolve(rootDir, "scripts", scriptName)], {
      cwd: rootDir,
      env: {
        ...process.env,
        SALT_SHOP_URL: shopBase,
        // A missing Shopify CLI session should fall back promptly to the last
        // verified snapshot instead of holding the complete live refresh for
        // several exponential-retry windows.
        FUTURE_LIGHT_SHOPIFY_REQUEST_TIMEOUT_MS:
          process.env.FUTURE_LIGHT_SHOPIFY_REQUEST_TIMEOUT_MS || "30000",
        FUTURE_LIGHT_SHOPIFY_MAX_REQUEST_ATTEMPTS:
          process.env.FUTURE_LIGHT_SHOPIFY_MAX_REQUEST_ATTEMPTS || "1",
      },
      stdio: "inherit",
    });
    children.add(child);

    child.once("error", (error) => {
      children.delete(child);
      rejectRun(error);
    });
    child.once("exit", (code, signal) => {
      children.delete(child);
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(
        new Error(`${scriptName} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`),
      );
    });
  });
}

async function main() {
  const children = new Set();
  try {
    await Promise.all(dependentSyncScripts.map((scriptName) => runScript(scriptName, children)));
  } catch (error) {
    for (const child of children) child.kill("SIGTERM");
    throw error;
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message || error}\n`);
  process.exit(1);
});
