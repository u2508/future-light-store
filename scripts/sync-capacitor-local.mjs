#!/usr/bin/env node

import { cp, mkdtemp, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const rootDir = resolve(import.meta.dirname, "..");
const platform = process.argv[2];
if (!new Set(["ios", "android"]).has(platform)) throw new Error("Usage: sync-capacitor-local.mjs <ios|android>");

const appDir = resolve(rootDir, `salt-store-${platform}`);
const capacitorBin = process.env.SALT_CAPACITOR_CLI_BIN ||
  "/tmp/salt-capacitor-tools/node_modules/@capacitor/cli/bin/capacitor";
const stageRoot = await mkdtemp(join(tmpdir(), `salt-capacitor-${platform}-`));
const stageApp = join(stageRoot, `salt-store-${platform}`);
const stageDist = join(stageRoot, "dist");

async function copyMaterializedTree(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyMaterializedTree(from, to);
      continue;
    }
    const metadata = await stat(from);
    if (metadata.blocks === 0) continue;
    await cp(from, to, { force: true });
  }
}

async function mkdir(path) {
  const { mkdir: createDirectory } = await import("node:fs/promises");
  await createDirectory(path, { recursive: true });
}

try {
  await copyMaterializedTree(appDir, stageApp);
  await symlink("/tmp/salt-capacitor-tools/node_modules", join(stageApp, "node_modules"), "dir");
  await rm(join(stageApp, "capacitor.config.ts"), { force: true });
  await writeFile(join(stageApp, "capacitor.config.json"), `${JSON.stringify({
    appId: process.env.FUTURE_LIGHT_CAPACITOR_APP_ID || "com.futurelightstore.app",
    appName: process.env.FUTURE_LIGHT_CAPACITOR_APP_NAME || "Future Light Store",
    webDir: "../dist",
    bundledWebRuntime: false,
    plugins: {
      SplashScreen: {
        launchAutoHide: false,
        launchFadeOutDuration: 280,
        backgroundColor: "#FFFDF9",
        showSpinner: false,
      },
    },
    ios: { handleApplicationNotifications: false },
  }, null, 2)}\n`, "utf8");
  await copyMaterializedTree(resolve(rootDir, "dist"), stageDist);
  await copyMaterializedTree(resolve(rootDir, "public"), stageDist);

  const exitCode = await new Promise((resolveExit) => {
    const child = spawn(process.execPath, [capacitorBin, "sync", platform], {
      cwd: stageApp,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", (error) => {
      console.error(error.message);
      resolveExit(1);
    });
    child.once("exit", (code, signal) => resolveExit(typeof code === "number" ? code : signal ? 1 : 0));
  });
  if (exitCode !== 0) process.exitCode = exitCode;
  else await cp(join(stageApp, platform), resolve(appDir, platform), { recursive: true, force: true });
} finally {
  await rm(stageRoot, { recursive: true, force: true });
}
