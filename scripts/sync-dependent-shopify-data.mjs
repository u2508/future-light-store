#!/usr/bin/env node

import { spawn } from "node:child_process";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dirname, "..");
const dependentSyncScripts = [
  "sync-recently-ordered-products.mjs",
  "sync-managed-collection-membership.mjs",
];

function runScript(scriptName, children) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [resolve(rootDir, "scripts", scriptName)], {
      cwd: rootDir,
      env: process.env,
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
