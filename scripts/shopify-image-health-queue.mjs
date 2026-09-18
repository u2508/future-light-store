#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { readProductCatalogPayload } from "./product-catalog-files.mjs";
import {
  FUTURE_LIGHT_BRAND,
  FUTURE_LIGHT_CDN_HOST,
  FUTURE_LIGHT_CDN_PATH_PREFIX,
  FUTURE_LIGHT_SCOPE,
  FUTURE_LIGHT_SHOP_DOMAIN,
  IMAGE_HEALTH_SCHEMA_VERSION,
  IMAGE_HEALTH_THRESHOLDS,
  asArray,
  buildProductImageAudit,
  buildRepairQueue,
  canonicalImageUrl,
  assertFutureLightCatalog,
  imageUrlFromRecord,
  inspectImageBytes,
  isFutureLightImageUrl,
  normalizeText,
  productCatalogFingerprint,
  productKey,
} from "./lib/product-image-health.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const defaultInputDir = resolve(rootDir, "public", "data");
const defaultOutputPath = resolve(rootDir, "output", "future-light-image-health-queue.json");
const defaultCheckpointPath = resolve(
  rootDir,
  "output",
  "future-light-image-health-checkpoint.json",
);
const defaultProductLimit = 50;
const maxProductLimit = 250;
const defaultMaxImagesPerProduct = 100;
const maxImagesPerProduct = 250;
const defaultProbeConcurrency = 6;
const maxProbeConcurrency = 12;
const defaultProductConcurrency = 4;
const maxProductConcurrency = 6;
const defaultProbeTimeoutMs = 15_000;
const defaultProbeAttempts = 2;
const maxProbeBytes = 50 * 1024 * 1024;
const defaultMaxProbeBytes = 12 * 1024 * 1024;
const defaultCheckpointInterval = 5;
const maxCheckpointInterval = 50;
const defaultManifestInterval = 25;
const maxManifestInterval = 100;

function boundedInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

export function parseArgs(argv = process.argv) {
  const args = {
    inputDir: defaultInputDir,
    output: defaultOutputPath,
    checkpoint: defaultCheckpointPath,
    limit: boundedInteger(process.env.FUTURE_LIGHT_IMAGE_HEALTH_LIMIT, defaultProductLimit, {
      max: maxProductLimit,
    }),
    maxImagesPerProduct: boundedInteger(
      process.env.FUTURE_LIGHT_IMAGE_HEALTH_MAX_IMAGES_PER_PRODUCT,
      defaultMaxImagesPerProduct,
      { max: maxImagesPerProduct },
    ),
    concurrency: boundedInteger(
      process.env.FUTURE_LIGHT_IMAGE_HEALTH_CONCURRENCY,
      defaultProbeConcurrency,
      { max: maxProbeConcurrency },
    ),
    productConcurrency: boundedInteger(
      process.env.FUTURE_LIGHT_IMAGE_HEALTH_PRODUCT_CONCURRENCY,
      defaultProductConcurrency,
      { max: maxProductConcurrency },
    ),
    timeoutMs: boundedInteger(
      process.env.FUTURE_LIGHT_IMAGE_HEALTH_TIMEOUT_MS,
      defaultProbeTimeoutMs,
      { min: 1_000, max: 60_000 },
    ),
    attempts: boundedInteger(process.env.FUTURE_LIGHT_IMAGE_HEALTH_ATTEMPTS, defaultProbeAttempts, {
      max: 5,
    }),
    checkpointInterval: boundedInteger(
      process.env.FUTURE_LIGHT_IMAGE_HEALTH_CHECKPOINT_INTERVAL,
      defaultCheckpointInterval,
      { max: maxCheckpointInterval },
    ),
    manifestInterval: boundedInteger(
      process.env.FUTURE_LIGHT_IMAGE_HEALTH_MANIFEST_INTERVAL,
      defaultManifestInterval,
      { max: maxManifestInterval },
    ),
    maxProbeBytes: boundedInteger(
      process.env.FUTURE_LIGHT_IMAGE_HEALTH_MAX_BYTES,
      defaultMaxProbeBytes,
      { max: maxProbeBytes },
    ),
    probe: true,
    all: false,
    resume: false,
    retryFailed: true,
    handles: [],
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--apply") {
      throw new Error(
        "Future Light image health queue is read-only; it never applies media replacements.",
      );
    }
    if (token === "--input-dir" && next) {
      args.inputDir = resolve(rootDir, next);
      index += 1;
    } else if (token === "--output" && next) {
      args.output = resolve(rootDir, next);
      index += 1;
    } else if (token === "--checkpoint" && next) {
      args.checkpoint = resolve(rootDir, next);
      index += 1;
    } else if (token === "--limit" && next) {
      args.limit = boundedInteger(next, args.limit, { max: maxProductLimit });
      index += 1;
    } else if (token === "--max-images-per-product" && next) {
      args.maxImagesPerProduct = boundedInteger(next, args.maxImagesPerProduct, {
        max: maxImagesPerProduct,
      });
      index += 1;
    } else if (token === "--concurrency" && next) {
      args.concurrency = boundedInteger(next, args.concurrency, { max: maxProbeConcurrency });
      index += 1;
    } else if (token === "--product-concurrency" && next) {
      args.productConcurrency = boundedInteger(next, args.productConcurrency, {
        max: maxProductConcurrency,
      });
      index += 1;
    } else if (token === "--timeout-ms" && next) {
      args.timeoutMs = boundedInteger(next, args.timeoutMs, { min: 1_000, max: 60_000 });
      index += 1;
    } else if (token === "--attempts" && next) {
      args.attempts = boundedInteger(next, args.attempts, { max: 5 });
      index += 1;
    } else if (token === "--checkpoint-interval" && next) {
      args.checkpointInterval = boundedInteger(next, args.checkpointInterval, {
        max: maxCheckpointInterval,
      });
      index += 1;
    } else if (token === "--manifest-interval" && next) {
      args.manifestInterval = boundedInteger(next, args.manifestInterval, {
        max: maxManifestInterval,
      });
      index += 1;
    } else if (token === "--max-probe-bytes" && next) {
      args.maxProbeBytes = boundedInteger(next, args.maxProbeBytes, { max: maxProbeBytes });
      index += 1;
    } else if (token === "--handle" && next) {
      args.handles.push(normalizeText(next).toLowerCase());
      index += 1;
    } else if (token === "--resume") {
      args.resume = true;
    } else if (token === "--no-resume") {
      args.resume = false;
    } else if (token === "--no-probe") {
      args.probe = false;
    } else if (token === "--probe") {
      args.probe = true;
    } else if (token === "--all") {
      args.all = true;
    } else if (token === "--no-retry-failed") {
      args.retryFailed = false;
    }
  }

  if (!args.inputDir) throw new Error("--input-dir is required");
  return args;
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function readResponseBytes(response, maxBytes) {
  const contentLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    const error = new Error(`image response exceeds ${maxBytes} byte limit`);
    error.code = "RESPONSE_TOO_LARGE";
    error.retryable = false;
    throw error;
  }

  const reader = response.body?.getReader?.();
  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      const error = new Error(`image response exceeds ${maxBytes} byte limit`);
      error.code = "RESPONSE_TOO_LARGE";
      error.retryable = false;
      throw error;
    }
    return buffer;
  }

  const chunks = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    const chunk = Buffer.from(next.value || []);
    total += chunk.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      const error = new Error(`image response exceeds ${maxBytes} byte limit`);
      error.code = "RESPONSE_TOO_LARGE";
      error.retryable = false;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

export async function probeImageUrl(
  url,
  {
    attempts = defaultProbeAttempts,
    timeoutMs = defaultProbeTimeoutMs,
    maxBytes = defaultMaxProbeBytes,
    fetchImpl = globalThis.fetch,
    sleepImpl = sleep,
  } = {},
) {
  const normalizedUrl = normalizeText(url);
  if (!isFutureLightImageUrl(normalizedUrl)) {
    return {
      status: "out-of-scope",
      retryable: false,
      finalUrl: normalizedUrl || null,
      error: "image URL is outside the Future Light CDN scope",
      checkedAt: new Date().toISOString(),
      attempts: 0,
    };
  }
  const checkedAt = () => new Date().toISOString();
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(normalizedUrl, {
        headers: {
          Accept: "image/avif,image/webp,image/jpeg,image/png,image/gif,*/*;q=0.8",
          "User-Agent": "Future-Light-Store-image-health-audit/1.0",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const finalUrl = normalizeText(response.url || normalizedUrl);
      if (!isFutureLightImageUrl(finalUrl)) {
        return {
          status: "redirected-out-of-scope",
          retryable: false,
          httpStatus: response.status,
          finalUrl,
          checkedAt: checkedAt(),
          attempts: attempt,
        };
      }
      if (!response.ok) {
        const retryable = isRetryableStatus(response.status);
        if (retryable && attempt < attempts) {
          await sleepImpl(Math.min(2_000, 250 * 2 ** (attempt - 1)));
          continue;
        }
        return {
          status: "http-error",
          retryable,
          httpStatus: response.status,
          contentType: normalizeText(response.headers?.get?.("content-type")),
          checkedAt: checkedAt(),
          attempts: attempt,
        };
      }

      const bytes = await readResponseBytes(response, maxBytes);
      const contentType = normalizeText(response.headers?.get?.("content-type"));
      const inspected = inspectImageBytes(bytes);
      return {
        status: "ok",
        retryable: false,
        httpStatus: response.status,
        contentType,
        byteLength: inspected.byteLength,
        format: inspected.format,
        width: inspected.width,
        height: inspected.height,
        issues: inspected.issues,
        finalUrl,
        checkedAt: checkedAt(),
        attempts: attempt,
      };
    } catch (error) {
      lastError = error;
      const retryable = error?.retryable !== false;
      if (!retryable || attempt >= attempts) {
        return {
          status: "probe-error",
          retryable,
          error: normalizeText(error?.message || error),
          errorCode: normalizeText(error?.code),
          checkedAt: checkedAt(),
          attempts: attempt,
        };
      }
      await sleepImpl(Math.min(2_000, 250 * 2 ** (attempt - 1)));
    }
  }

  return {
    status: "probe-error",
    retryable: true,
    error: normalizeText(lastError?.message || "image probe failed"),
    checkedAt: checkedAt(),
    attempts,
  };
}

async function probeProductImages(product, args, dependencies = {}) {
  const images = asArray(product?.images).slice(0, args.maxImagesPerProduct);
  const urls = [
    ...new Set(
      images
        .map(imageUrlFromRecord)
        .filter((url) => isFutureLightImageUrl(url))
        .filter(Boolean),
    ),
  ];
  const results = new Map();
  let cursor = 0;
  const worker = async () => {
    while (cursor < urls.length) {
      const current = urls[cursor];
      cursor += 1;
      const probe = await probeImageUrl(current, {
        attempts: args.attempts,
        timeoutMs: args.timeoutMs,
        maxBytes: args.maxProbeBytes,
        fetchImpl: dependencies.fetchImpl,
        sleepImpl: dependencies.sleepImpl,
      });
      results.set(current, probe);
      const canonical = canonicalImageUrl(current);
      if (canonical && !results.has(canonical)) results.set(canonical, probe);
    }
  };
  await Promise.all(Array.from({ length: Math.min(args.concurrency, urls.length) }, worker));
  return results;
}

function runFingerprint(products, args) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: IMAGE_HEALTH_SCHEMA_VERSION,
        scope: FUTURE_LIGHT_SCOPE,
        catalogFingerprint: productCatalogFingerprint(products),
        handles: [...args.handles].sort(),
        maxImagesPerProduct: args.maxImagesPerProduct,
        probe: args.probe,
        maxProbeBytes: args.maxProbeBytes,
      }),
    )
    .digest("hex");
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

async function readCheckpoint(filePath, args, fingerprint) {
  if (!args.resume) return null;
  let parsed;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(
      `Could not read image-health checkpoint ${filePath}: ${error.message || error}`,
    );
  }
  if (
    parsed?.schemaVersion !== IMAGE_HEALTH_SCHEMA_VERSION ||
    parsed?.scope !== FUTURE_LIGHT_SCOPE
  ) {
    throw new Error(`Image-health checkpoint is not a Future Light queue: ${filePath}`);
  }
  if (parsed?.fingerprint !== fingerprint) {
    throw new Error(
      "Image-health checkpoint does not match the current Future Light catalog/config; use a new checkpoint or omit --resume.",
    );
  }
  if (!Array.isArray(parsed?.audits))
    throw new Error(`Image-health checkpoint has no audits array: ${filePath}`);
  return parsed;
}

function shouldProcessPriorAudit(audit, args) {
  if (!audit?.completed) return true;
  return args.retryFailed && audit.needsRetry === true;
}

function issueCounts(audits) {
  const counts = {};
  for (const audit of audits) {
    for (const issue of asArray(audit?.issues)) counts[issue.code] = (counts[issue.code] || 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function imageIssueCounts(audits) {
  const counts = {};
  for (const audit of audits) {
    for (const image of asArray(audit?.imageAudits)) {
      for (const issue of asArray(image?.issues))
        counts[issue.code] = (counts[issue.code] || 0) + 1;
    }
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function buildManifest({ args, scope, fingerprint, tasks, audits, run }) {
  const sortedAudits = [...audits].sort(
    (left, right) =>
      String(left.handle).localeCompare(String(right.handle)) ||
      String(left.productId).localeCompare(String(right.productId)),
  );
  const completedKeys = new Set(
    sortedAudits.filter((audit) => audit.completed).map((audit) => audit.key),
  );
  const pendingProducts = tasks
    .filter((product) => !completedKeys.has(productKey(product)))
    .map((product) => ({
      key: productKey(product),
      productId: normalizeText(product?.id),
      handle: normalizeText(product?.handle),
      title: normalizeText(product?.title),
    }));
  const repairQueue = buildRepairQueue(sortedAudits);
  const imageAudits = sortedAudits.flatMap((audit) => asArray(audit?.imageAudits));
  const summary = {
    productsInScope: tasks.length,
    productsAudited: sortedAudits.length,
    productsHealthy: sortedAudits.filter((audit) => audit.status === "healthy").length,
    productsWithIssues: sortedAudits.filter((audit) => audit.status !== "healthy").length,
    productsNeedsRetry: sortedAudits.filter((audit) => audit.needsRetry).length,
    remainingProducts: pendingProducts.length,
    imagesAudited: imageAudits.length,
    imagesWithIssues: imageAudits.filter((image) => image.issues?.length).length,
    imagesWithBlockingIssues: imageAudits.filter((image) => image.blocking).length,
    imageIssueCounts: imageIssueCounts(sortedAudits),
    issueCounts: issueCounts(sortedAudits),
    repairQueueItems: repairQueue.length,
  };
  return {
    schemaVersion: IMAGE_HEALTH_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    status: summary.remainingProducts ? "paused" : "complete",
    mode: "read-only-image-health-audit",
    scope,
    policy: {
      automaticMediaReplacement: false,
      currentGoodMediaNeverReplaced: true,
      repairQueueOnly: true,
      repairRequiresApprovedSource: true,
      foreignUrlsAreNotFetched: true,
      networkProbeRequiredForBrokenImageClaims: true,
    },
    source: {
      inputDir: args.inputDir,
      fingerprint,
      selection: args.handles.length ? "explicit-handles" : "all-local-catalog-products",
    },
    thresholds: IMAGE_HEALTH_THRESHOLDS,
    probe: {
      enabled: args.probe,
      concurrency: args.concurrency,
      timeoutMs: args.timeoutMs,
      attempts: args.attempts,
      maxBytes: args.maxProbeBytes,
    },
    run,
    summary,
    products: sortedAudits,
    repairQueue,
    pendingProducts,
  };
}

export async function runImageHealthQueue(args, dependencies = {}) {
  const payload = await readProductCatalogPayload(args.inputDir);
  const allProducts = asArray(payload?.products);
  const scope = assertFutureLightCatalog(allProducts);
  const selectedHandles = new Set(args.handles);
  const tasks = allProducts
    .filter(
      (product) =>
        !selectedHandles.size || selectedHandles.has(normalizeText(product?.handle).toLowerCase()),
    )
    .sort(
      (left, right) =>
        normalizeText(left?.handle).localeCompare(normalizeText(right?.handle)) ||
        normalizeText(left?.id).localeCompare(normalizeText(right?.id)),
    );
  if (!tasks.length) {
    throw new Error(
      args.handles.length
        ? `No Future Light products matched --handle ${args.handles.join(", ")}`
        : "Future Light catalog contains no products.",
    );
  }

  const fingerprint = runFingerprint(tasks, args);
  const prior = await readCheckpoint(args.checkpoint, args, fingerprint);
  const auditsByKey = new Map(asArray(prior?.audits).map((audit) => [audit.key, audit]));
  const pendingCandidates = tasks.filter((product) => {
    const previous = auditsByKey.get(productKey(product));
    return !previous || shouldProcessPriorAudit(previous, args);
  });
  const candidates = args.all ? pendingCandidates : pendingCandidates.slice(0, args.limit);
  const run = {
    startedAt: new Date().toISOString(),
    resumed: Boolean(prior),
    limit: args.all ? tasks.length : args.limit,
    selectedProductsThisRun: candidates.length,
    probeEnabled: args.probe,
    productConcurrency: args.productConcurrency,
    imageConcurrency: args.concurrency,
    checkpointInterval: args.checkpointInterval,
    manifestInterval: args.manifestInterval,
    retryFailed: args.retryFailed,
  };

  const persist = async (status = "running", { writeManifest = true } = {}) => {
    const audits = [...auditsByKey.values()];
    const manifest = buildManifest({
      args,
      scope,
      fingerprint,
      tasks,
      audits,
      run: { ...run, status },
    });
    const checkpointStatus = status === "complete" ? manifest.status : status;
    const checkpoint = {
      schemaVersion: IMAGE_HEALTH_SCHEMA_VERSION,
      scope: FUTURE_LIGHT_SCOPE,
      fingerprint,
      status: checkpointStatus,
      updatedAt: manifest.generatedAt,
      totalProducts: tasks.length,
      completedProducts: audits.filter((audit) => audit.completed).length,
      audits: manifest.products,
    };
    await writeJsonAtomic(args.checkpoint, checkpoint);
    if (writeManifest) await writeJsonAtomic(args.output, manifest);
    return manifest;
  };

  // Multiple product workers make the network-bound audit much faster while
  // keeping writes serialized so checkpoints remain atomic and resumable.
  let persistTail = Promise.resolve();
  const persistSerial = async (status, options) => {
    const next = persistTail.then(() => persist(status, options));
    persistTail = next.catch(() => undefined);
    return next;
  };

  await persistSerial("running");
  let cursor = 0;
  let productsSinceCheckpoint = 0;
  let productsSinceManifest = 0;
  const worker = async () => {
    while (cursor < candidates.length) {
      const product = candidates[cursor];
      cursor += 1;
      const probes = args.probe ? await probeProductImages(product, args, dependencies) : new Map();
      const audit = buildProductImageAudit(product, {
        probes,
        maxImages: args.maxImagesPerProduct,
      });
      audit.probeEnabled = args.probe;
      audit.probedImageCount = probes.size;
      auditsByKey.set(audit.key, audit);
      process.stdout.write(
        `Audited ${audit.handle || audit.productId}: ${audit.status}, ${audit.issues.length} issue(s)\n`,
      );
      productsSinceCheckpoint += 1;
      productsSinceManifest += 1;
      if (productsSinceCheckpoint >= args.checkpointInterval) {
        productsSinceCheckpoint = 0;
        const writeManifest = productsSinceManifest >= args.manifestInterval;
        if (writeManifest) productsSinceManifest = 0;
        await persistSerial("running", { writeManifest });
      }
    }
  };
  const productWorkerCount = Math.min(
    boundedInteger(args.productConcurrency, defaultProductConcurrency, {
      max: maxProductConcurrency,
    }),
    candidates.length || 1,
  );
  await Promise.all(
    Array.from({ length: productWorkerCount }, worker),
  );

  const final = await persistSerial("complete", { writeManifest: true });
  return final;
}

async function main() {
  const args = parseArgs(process.argv);
  const manifest = await runImageHealthQueue(args);
  process.stdout.write(
    `Future Light image health queue ${manifest.status}: ${manifest.summary.productsAudited}/${manifest.summary.productsInScope} products audited, ${manifest.summary.remainingProducts} remaining, ${manifest.summary.repairQueueItems} repair item(s).\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

export { buildManifest, isRetryableStatus, readResponseBytes };
