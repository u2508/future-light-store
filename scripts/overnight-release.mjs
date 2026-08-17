#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDir = resolve(import.meta.dirname, "..");
const manifestPath = resolve(rootDir, "output", "shopify-seo-release-manifest.json");
const logPath = resolve(rootDir, "output", "overnight-release.log");
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const pollIntervalMs = Math.max(60_000, Number(process.env.SALT_OVERNIGHT_POLL_MS || 300_000));
const releaseCommand = process.env.SALT_OVERNIGHT_RELEASE_COMMAND || "npm";
const releaseArgs = process.env.SALT_OVERNIGHT_RELEASE_ARGS
  ? process.env.SALT_OVERNIGHT_RELEASE_ARGS.split(" ").filter(Boolean)
  : ["run", "release"];

async function appendLog(line) {
  await mkdir(resolve(rootDir, "output"), { recursive: true });
  await writeFile(logPath, `${line}\n`, { flag: "a" });
}

async function manifestIsComplete() {
  if (!existsSync(manifestPath)) {
    return false;
  }

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    return Boolean(manifest.completedAt);
  } catch {
    return false;
  }
}

async function waitForCompletion() {
  while (!(await manifestIsComplete())) {
    await appendLog(`[overnight] waiting for SEO apply to complete at ${new Date().toISOString()}`);
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

async function runRelease() {
  await appendLog(`[overnight] starting release at ${new Date().toISOString()}`);
  const child = spawn(releaseCommand, releaseArgs, {
    cwd: rootDir,
    env: process.env,
    stdio: "inherit",
  });

  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`release exited with ${signal ? `signal ${signal}` : `code ${code}`}`));
    });
  });
}

async function main() {
  await appendLog(`[overnight] watcher started at ${new Date().toISOString()}`);
  await waitForCompletion();
  await appendLog(`[overnight] SEO apply complete; launching release`);
  await runRelease();
  await appendLog(`[overnight] release finished at ${new Date().toISOString()}`);
  process.stdout.write("Overnight release finished.\n");
}

main().catch(async (error) => {
  await appendLog(`[overnight] failed: ${error.message}`);
  console.error(error.message || error);
  process.exit(1);
});
