#!/usr/bin/env node

import { access, cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawn } from "node:child_process";

const rootDir = process.cwd();
const nodeBin = process.execPath;

async function ensure(path, label) {
  try {
    await access(path);
  } catch {
    throw new Error(`${label} not found at ${path}`);
  }
}

function run(command, args, env = process.env, cwd = rootDir) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: "inherit",
    });

    child.on("error", rejectRun);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }

      rejectRun(new Error(`${command} ${args.join(" ")} failed with ${signal || `exit code ${code}`}`));
    });
  });
}

function getOneDrivePids() {
  if (process.env.SALT_BUILD_PAUSE_ONEDRIVE === "0" || !rootDir.includes("OneDrive")) {
    return [];
  }

  const processList = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
  return processList
    .split("\n")
    .map((line) => line.trim())
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.*)$/);
      return match ? { pid: Number(match[1]), command: match[2] } : null;
    })
    .filter(Boolean)
    .filter(({ command }) =>
      /\/Applications\/OneDrive\.app\/Contents\/MacOS\/OneDrive(?:\s|$)/.test(command)
      || /OneDrive File Provider\.appex\/Contents\/MacOS\/OneDrive File Provider/.test(command),
    )
    .map(({ pid }) => pid)
    .filter((pid) => pid !== process.pid);
}

function pauseOneDrive() {
  const pids = getOneDrivePids();
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGSTOP");
    } catch {
      // The provider can exit between ps and kill; continue with local build.
    }
  }

  return () => {
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGCONT");
      } catch {
        // The provider may have been restarted with a new pid.
      }
    }
  };
}

async function main() {
  await ensure(resolve(rootDir, "output", "product-knowledge.json"), "validated product knowledge artifact");
  await ensure(resolve(rootDir, "public", "data", "products.json"), "full product catalog manifest");
  await ensure(resolve(rootDir, "public", "data", "product-search.json"), "product search manifest");
  await ensure(resolve(rootDir, "public", "data", "home-collection-products.json"), "homepage collection artifact");

  const stageDir = await mkdtemp(join(tmpdir(), "salt-web-build-"));
  const stageNodeModules = resolve(stageDir, "node_modules");
  const stageScripts = resolve(stageDir, "scripts");

  try {
    // Vite can be killed by the OneDrive file-provider while traversing the
    // dependency graph. Keep the graph and compiler cache on local storage.
    await cp(resolve(rootDir, "src"), resolve(stageDir, "src"), {
      recursive: true,
      force: true,
    });
    if (process.env.SALT_BUILD_USE_WORKSPACE_NODE_MODULES === "1") {
      await symlink(resolve(rootDir, "node_modules"), stageNodeModules, "junction");
    } else {
      await cp(resolve(rootDir, "node_modules"), stageNodeModules, {
        recursive: true,
        force: true,
      });
    }
    await mkdir(stageScripts, { recursive: true });
    await cp(resolve(rootDir, "scripts"), stageScripts, {
      recursive: true,
      force: true,
    });
    await cp(resolve(rootDir, "scripts", "postbuild-compat.mjs"), resolve(stageScripts, "postbuild-compat.mjs"));

    for (const filename of [
      "index.html",
      "vite.config.ts",
      "postcss.config.js",
      "tailwind.config.cjs",
      "tsconfig.json",
      "tsconfig.app.json",
      "tsconfig.node.json",
      "package.json",
      "package-lock.json",
      ".env",
      ".env.local",
      ".env.production",
    ]) {
      try {
        await cp(resolve(rootDir, filename), resolve(stageDir, filename), { force: true });
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }

    await symlink(resolve(rootDir, "public"), resolve(stageDir, "public"), "junction");
    await symlink(resolve(rootDir, "output"), resolve(stageDir, "output"), "junction");

    const buildEnv = {
      ...process.env,
      SALT_BUILD_SKIP_PUBLIC_COPY: "1",
    };
    const resumeOneDrive = pauseOneDrive();
    try {
      await run(nodeBin, [resolve(stageNodeModules, "vite", "bin", "vite.js"), "build"], buildEnv, stageDir);
    } finally {
      resumeOneDrive();
    }

    await cp(resolve(rootDir, "public"), resolve(stageDir, "dist"), {
      recursive: true,
      force: true,
    });
    await run(nodeBin, [resolve(stageDir, "scripts", "postbuild-compat.mjs")], process.env, stageDir);
    await cp(resolve(stageDir, "dist"), resolve(rootDir, "dist"), {
      recursive: true,
      force: true,
    });
  } finally {
    await rm(stageDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
