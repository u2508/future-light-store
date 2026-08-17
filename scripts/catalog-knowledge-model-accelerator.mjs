import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import {
  buildCatalogKnowledgeModelFields,
  scoreCatalogKnowledgeModel,
} from "../src/lib/catalog-knowledge-model.js";

const execFileAsync = promisify(execFile);
const rootDir = resolve(import.meta.dirname, "..");
const scriptPath = resolve(rootDir, "scripts", "catalog-knowledge-model-mlx.py");
const cachePath = resolve(
  process.env.SALT_KNOWLEDGE_CACHE_PATH || resolve(rootDir, "output", "catalog-knowledge-model-evidence.json"),
);
const CACHE_VERSION = 1;
const inFlightScores = new Map();

function acceleratorMode() {
  return String(process.env.SALT_KNOWLEDGE_ACCELERATOR || "auto").trim().toLowerCase();
}

function productKey(product) {
  return String(product?.id || product?.handle || "");
}

function buildRecords(products) {
  return products.map((product) => ({
    key: productKey(product),
    fields: buildCatalogKnowledgeModelFields(product),
  }));
}

function buildFingerprints(model, records) {
  const modelFingerprint = createHash("sha256")
    .update(JSON.stringify({
      modelVersion: model?.modelVersion || "",
      trainingRecords: model?.trainingRecords || 0,
      ruleProfiles: model?.ruleProfiles || [],
    }))
    .digest("hex");
  const catalogFingerprint = createHash("sha256")
    .update(JSON.stringify(records))
    .digest("hex");

  return {
    modelFingerprint,
    catalogFingerprint,
    fingerprint: createHash("sha256")
      .update(`${CACHE_VERSION}:${modelFingerprint}:${catalogFingerprint}`)
      .digest("hex"),
  };
}

async function readCachedEvidence(fingerprint, mode) {
  try {
    const cached = JSON.parse(await readFile(cachePath, "utf8"));
    if (
      cached?.cacheVersion === CACHE_VERSION &&
      cached?.fingerprint === fingerprint &&
      (mode !== "cpu" || cached?.accelerator === "cpu") &&
      cached?.evidence &&
      typeof cached.evidence === "object"
    ) {
      return new Map(Object.entries(cached.evidence));
    }
  } catch {
    // Cache is optional; regenerate when absent, corrupt, or stale.
  }

  return null;
}

async function writeCachedEvidence(payload) {
  await mkdir(dirname(cachePath), { recursive: true });
  const temporaryPath = `${cachePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporaryPath, JSON.stringify({ cacheVersion: CACHE_VERSION, ...payload }), "utf8");
    await rename(temporaryPath, cachePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

function cpuFallbackEvidence(model, products) {
  return new Map(
    products.map((product) => [
      productKey(product),
      scoreCatalogKnowledgeModel(model, product),
    ]),
  );
}

async function scoreBatch(model, products, records, fingerprints, mode) {
  const cached = await readCachedEvidence(fingerprints.fingerprint, mode);
  if (cached) {
    process.stdout.write(`Reusing ${cached.size} MLX knowledge scores from the fingerprinted catalog cache.\n`);
    return cached;
  }

  if (mode === "cpu") {
    const evidence = cpuFallbackEvidence(model, products);
    await writeCachedEvidence({
      ...fingerprints,
      accelerator: "cpu",
      generatedAt: new Date().toISOString(),
      evidence: Object.fromEntries(evidence),
    });
    return evidence;
  }

  const tempDir = await mkdtemp(join(tmpdir(), "salt-knowledge-mlx-"));
  const modelPath = join(tempDir, "model.json");
  const inputPath = join(tempDir, "input.json");
  try {
    await Promise.all([
      writeFile(modelPath, JSON.stringify(model), "utf8"),
      writeFile(inputPath, JSON.stringify(records), "utf8"),
    ]);
    const { stdout } = await execFileAsync("python3", [scriptPath, modelPath, inputPath], {
      cwd: rootDir,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      maxBuffer: 100 * 1024 * 1024,
    });
    const parsed = JSON.parse(String(stdout || "{}"));
    const evidence = new Map(Object.entries(parsed));
    await writeCachedEvidence({
      ...fingerprints,
      accelerator: "mlx-gpu",
      generatedAt: new Date().toISOString(),
      evidence: Object.fromEntries(evidence),
    });
    return evidence;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (mode === "required") throw new Error(`MLX knowledge accelerator failed: ${message}`);
    process.stderr.write(`MLX knowledge accelerator unavailable; using deterministic CPU scoring (${message})\n`);
    const evidence = cpuFallbackEvidence(model, products);
    await writeCachedEvidence({
      ...fingerprints,
      accelerator: "cpu-fallback",
      generatedAt: new Date().toISOString(),
      evidence: Object.fromEntries(evidence),
    });
    return evidence;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function scoreCatalogKnowledgeModelBatch(model, products) {
  const mode = acceleratorMode();
  if (!model?.trained || !Array.isArray(products) || !products.length || mode === "off") return null;

  const records = buildRecords(products);
  const fingerprints = buildFingerprints(model, records);
  const inFlight = inFlightScores.get(fingerprints.fingerprint);
  if (inFlight) {
    return inFlight;
  }

  const promise = scoreBatch(model, products, records, fingerprints, mode);
  inFlightScores.set(fingerprints.fingerprint, promise);
  try {
    return await promise;
  } finally {
    inFlightScores.delete(fingerprints.fingerprint);
  }
}
