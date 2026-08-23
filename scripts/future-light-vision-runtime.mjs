import { mkdir } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function runtimeUrl() {
  return String(process.env.SALT_CATALOG_VISION_OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
}

function modelName() {
  return String(process.env.SALT_CATALOG_VISION_MODEL || "gemma3:4b").trim();
}

async function readTags() {
  try {
    const response = await fetch(`${runtimeUrl()}/api/tags`, {
      signal: AbortSignal.timeout(Math.max(1_000, Number(process.env.SALT_CATALOG_VISION_RUNTIME_TIMEOUT_MS || 3_000))),
    });
    if (!response.ok) return { available: false, reason: `Ollama HTTP ${response.status}` };
    const payload = await response.json();
    const models = Array.isArray(payload?.models) ? payload.models : [];
    const requested = modelName();
    const installed = models.some((entry) => String(entry?.name || "") === requested || String(entry?.model || "") === requested);
    return { available: true, installed, models: models.map((entry) => String(entry?.name || entry?.model || "")).filter(Boolean) };
  } catch (error) {
    return { available: false, reason: error?.message || String(error) };
  }
}

async function ollamaBinary() {
  try {
    const { stdout } = await execFileAsync("which", ["ollama"]);
    return String(stdout || "").trim() || null;
  } catch {
    return null;
  }
}

async function startServer(rootDir) {
  const binary = await ollamaBinary();
  if (!binary) return false;
  const outputDir = resolve(rootDir, "output");
  await mkdir(outputDir, { recursive: true });
  const logPath = resolve(outputDir, "future-light-vision-runtime.log");
  const logHandle = await import("node:fs").then(({ openSync }) => openSync(logPath, "a"));
  const parsedUrl = new URL(runtimeUrl());
  const child = spawn(binary, ["serve"], {
    cwd: rootDir,
    detached: true,
    env: {
      ...process.env,
      OLLAMA_HOST: `${parsedUrl.hostname}:${parsedUrl.port || "11434"}`,
    },
    stdio: ["ignore", logHandle, logHandle],
  });
  child.unref();
  return true;
}

export async function ensureFutureLightVisionRuntime(rootDir) {
  let state = await readTags();
  if (state.available) return state;
  if (String(process.env.SALT_CATALOG_VISION_AUTO_START || "1") !== "1") return state;

  const started = await startServer(rootDir);
  if (!started) return { available: false, reason: "ollama binary is unavailable" };
  const attempts = Math.max(1, Number(process.env.SALT_CATALOG_VISION_RUNTIME_ATTEMPTS || 30));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await sleep(Math.max(250, Number(process.env.SALT_CATALOG_VISION_RUNTIME_RETRY_MS || 1_000)));
    state = await readTags();
    if (state.available) return state;
  }
  return state;
}
