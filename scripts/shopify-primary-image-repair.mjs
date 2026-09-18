#!/usr/bin/env node

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import {
  FUTURE_LIGHT_BRAND,
  FUTURE_LIGHT_CDN_HOST,
  FUTURE_LIGHT_CDN_PATH_PREFIX,
  IMAGE_HEALTH_THRESHOLDS,
  buildRepairQueue,
  canonicalImageUrl,
  normalizeText,
} from "./lib/product-image-health.mjs";

const execFileAsync = promisify(execFile);
const rootDir = resolve(import.meta.dirname, "..");
const targetStoreDomain = "vs-future-store-0jl2t-jxu6tnr3.myshopify.com";
const apiVersion = normalizeText(process.env.SHOPIFY_ADMIN_API_VERSION || "2026-07");
const cliBinary = normalizeText(process.env.SHOPIFY_CLI_BINARY || "shopify");
const checkpointPath = resolve(rootDir, "output", "future-light-image-health-checkpoint.json");
const imageHealthQueuePath = resolve(rootDir, "output", "future-light-image-health-queue.json");
const manifestPath = resolve(rootDir, "output", "future-light-primary-image-repair-manifest.json");
const lockPath = resolve(rootDir, "output", "future-light-primary-image-repair.lock");
const defaultConcurrency = Math.max(
  1,
  Math.min(3, Number(process.env.FUTURE_LIGHT_IMAGE_REPAIR_CONCURRENCY || 3) || 3),
);
const maxAttempts = Math.max(
  1,
  Math.min(5, Number(process.env.FUTURE_LIGHT_IMAGE_REPAIR_ATTEMPTS || 4) || 4),
);
const jobPollIntervalMs = Math.max(
  500,
  Math.min(10_000, Number(process.env.FUTURE_LIGHT_IMAGE_REPAIR_POLL_MS || 1_000) || 1_000),
);
const jobPollTimeoutMs = Math.max(
  30_000,
  Math.min(300_000, Number(process.env.FUTURE_LIGHT_IMAGE_REPAIR_JOB_TIMEOUT_MS || 120_000) || 120_000),
);

const LIVE_PRODUCTS_QUERY = /* GraphQL */ `
  query FutureLightPrimaryImageRepairProducts($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        handle
        title
        vendor
        status
        media(first: 250) {
          nodes {
            __typename
            ... on MediaImage {
              id
              alt
              image {
                url
                altText
                width
                height
              }
            }
          }
          pageInfo {
            hasNextPage
          }
        }
        variants(first: 250) {
          nodes {
            id
            title
            media(first: 1) {
              nodes {
                __typename
                ... on MediaImage {
                  id
                }
              }
            }
          }
          pageInfo {
            hasNextPage
          }
        }
      }
    }
  }
`;

const REORDER_MEDIA_MUTATION = /* GraphQL */ `
  mutation FutureLightPrimaryImageRepairReorder($id: ID!, $moves: [MoveInput!]!) {
    productReorderMedia(id: $id, moves: $moves) {
      job {
        id
      }
      mediaUserErrors {
        field
        message
        code
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const JOB_STATUS_QUERY = /* GraphQL */ `
  query FutureLightPrimaryImageRepairJob($id: ID!) {
    job(id: $id) {
      id
      done
    }
  }
`;

const MEDIA_ALT_UPDATE_MUTATION = /* GraphQL */ `
  mutation FutureLightPrimaryImageRepairAlt($productId: ID!, $media: [UpdateMediaInput!]!) {
    productUpdateMedia(productId: $productId, media: $media) {
      media {
        id
        alt
      }
      mediaUserErrors {
        field
        message
        code
      }
      userErrors {
        field
        message
      }
    }
  }
`;

function now() {
  return new Date().toISOString();
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeId(value) {
  return normalizeText(value);
}

function productGid(value) {
  const raw = normalizeId(value);
  if (!raw) return "";
  if (raw.startsWith("gid://shopify/Product/")) return raw;
  const numeric = raw.match(/(\d+)$/)?.[1];
  return numeric ? `gid://shopify/Product/${numeric}` : "";
}

function numericId(value) {
  return normalizeId(value).match(/(\d+)$/)?.[1] || "";
}

function sameId(left, right) {
  const leftValue = normalizeId(left);
  const rightValue = normalizeId(right);
  if (!leftValue || !rightValue) return false;
  if (leftValue === rightValue) return true;
  const leftNumeric = numericId(leftValue);
  const rightNumeric = numericId(rightValue);
  return Boolean(leftNumeric && rightNumeric && leftNumeric === rightNumeric);
}

function parseArgs(argv = process.argv) {
  const args = {
    mode: "dry-run",
    resume: false,
    handles: [],
    concurrency: defaultConcurrency,
    updateAlt: true,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--apply") args.mode = "apply";
    else if (token === "--dry-run") args.mode = "dry-run";
    else if (token === "--resume") args.resume = true;
    else if (token === "--no-alt") args.updateAlt = false;
    else if (token === "--handle" && next) {
      args.handles.push(normalizeText(next).toLowerCase());
      index += 1;
    } else if (token === "--concurrency" && next) {
      args.concurrency = Math.max(1, Math.min(3, Number(next) || args.concurrency));
      index += 1;
    } else if (token === "--help" || token === "-h") {
      process.stdout.write(
        [
          "Usage: node scripts/shopify-primary-image-repair.mjs [--dry-run|--apply] [--resume]",
          "       [--handle <handle>] [--concurrency 1..3] [--no-alt]",
          "",
          "Repairs only Future Light products whose audited primary image is below the card target.",
          "The repair reorders an existing verified Shopify image and fills blank image alt text.",
        ].join("\n") + "\n",
      );
      process.exit(0);
    }
  }

  return args;
}

function parseGraphQlPayload(raw) {
  const text = String(raw || "").trim();
  const jsonStart = text.indexOf("{");
  if (jsonStart < 0) throw new Error(text || "Shopify returned no JSON payload");
  const payload = JSON.parse(text.slice(jsonStart));
  const errors = [...asArray(payload?.errors), ...asArray(payload?.data?.errors)];
  if (errors.length) {
    throw new Error(
      errors
        .map((error) => normalizeText(error?.message || "Unknown Shopify GraphQL error"))
        .filter(Boolean)
        .join(" | "),
    );
  }
  return payload?.data || payload || {};
}

function normalizeError(error) {
  return normalizeText(error?.message || error).slice(0, 800);
}

function isRetryable(error) {
  const message = normalizeError(error);
  return Boolean(
    error?.killed ||
      error?.code === "ETIMEDOUT" ||
      /429|rate limit|throttl|timeout|timed out|5\d\d|network|socket|eai_again|enotfound|getaddrinfo|temporar|unavailable|bad gateway|gateway timeout|aborted/i.test(
        message,
      ),
  );
}

function childEnvironment() {
  const safeEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^SALT_/i.test(key) &&
        !/^VITE_SALT_/i.test(key) &&
        key !== "SHOPIFY_ADMIN_ACCESS_TOKEN" &&
        key !== "SALT_SHOPIFY_ADMIN_ACCESS_TOKEN",
    ),
  );
  return {
    ...safeEnvironment,
    CI: "1",
    SHOPIFY_CLI_DISABLE_ANALYTICS: "1",
    SHOPIFY_CLI_AGENT_INFO: "n:future-light-image-repair|v:1|p:openai-codex",
    SHOPIFY_CLI_AGENT_IDS: `s:future-light-image-repair|r:${process.pid}|i:primary-media-repair`,
  };
}

async function runShopify(query, variables, { allowMutations = false, label = "Shopify operation" } = {}) {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "future-light-primary-image-repair-"));
  const queryPath = join(temporaryDirectory, "operation.graphql");
  const variablesPath = join(temporaryDirectory, "variables.json");
  const outputPath = join(temporaryDirectory, "result.json");
  const args = [
    "store",
    "execute",
    "--store",
    targetStoreDomain,
    "--version",
    apiVersion,
    "--query-file",
    queryPath,
    "--variable-file",
    variablesPath,
    "--output-file",
    outputPath,
    "--json",
  ];
  if (allowMutations) args.push("--allow-mutations");

  try {
    await Promise.all([
      writeFile(queryPath, query, "utf8"),
      writeFile(variablesPath, `${JSON.stringify(variables, null, 2)}\n`, "utf8"),
    ]);
    const result = await execFileAsync(cliBinary, args, {
      cwd: rootDir,
      env: childEnvironment(),
      maxBuffer: 20 * 1024 * 1024,
      timeout: 180_000,
      killSignal: "SIGTERM",
    });
    let raw = result.stdout || "";
    try {
      raw = await readFile(outputPath, "utf8");
    } catch {
      // Some Shopify CLI versions return JSON on stdout only.
    }
    return parseGraphQlPayload(raw);
  } catch (error) {
    throw new Error(`${label} failed: ${normalizeError(error)}`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function withRetry(operation, { label }) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt >= maxAttempts) throw error;
      const delayMs = Math.min(30_000, 1_000 * 2 ** (attempt - 1));
      process.stdout.write(`Retrying ${label} after a network/Shopify error in ${delayMs}ms (${attempt}/${maxAttempts - 1})\n`);
      await sleep(delayMs);
    }
  }
  throw lastError || new Error(`${label} failed`);
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonAtomic(filePath, payload) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function acquireLock() {
  await mkdir(dirname(lockPath), { recursive: true });
  try {
    const handle = await open(lockPath, "wx");
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: now() })}\n`, "utf8");
    await handle.close();
    return;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await readJson(lockPath, null);
    if (isProcessAlive(Number(existing?.pid))) {
      throw new Error(`another Future Light primary-image repair is already running (pid ${existing.pid})`);
    }
    await rm(lockPath, { force: true });
    const handle = await open(lockPath, "wx");
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: now() })}\n`, "utf8");
    await handle.close();
  }
}

async function releaseLock() {
  await rm(lockPath, { force: true });
}

function imageAuditsFor(audit) {
  return asArray(audit?.imageAudits);
}

function findAuditImage(audit, mediaOrId) {
  const mediaId = typeof mediaOrId === "string" ? mediaOrId : mediaOrId?.id;
  const mediaUrl = typeof mediaOrId === "string" ? "" : mediaOrId?.image?.url || mediaOrId?.url;
  const canonicalUrl = canonicalImageUrl(mediaUrl);
  return (
    imageAuditsFor(audit).find(
      (image) =>
        sameId(image?.id, mediaId) ||
        (canonicalUrl && canonicalImageUrl(image?.url) === canonicalUrl),
    ) || null
  );
}

function isInTargetCdn(url) {
  try {
    const parsed = new URL(normalizeText(url));
    return parsed.protocol === "https:" && parsed.hostname === FUTURE_LIGHT_CDN_HOST && parsed.pathname.startsWith(FUTURE_LIGHT_CDN_PATH_PREFIX);
  } catch {
    return false;
  }
}

function mediaDimensions(media, auditImage) {
  const width = Number(media?.image?.width || auditImage?.probe?.width || auditImage?.effectiveWidth || auditImage?.width);
  const height = Number(media?.image?.height || auditImage?.probe?.height || auditImage?.effectiveHeight || auditImage?.height);
  return {
    width: Number.isFinite(width) ? width : null,
    height: Number.isFinite(height) ? height : null,
  };
}

function isUsablePrimaryCandidate(media, auditImage) {
  if (!media?.id || !normalizeText(media?.image?.url) || !auditImage) return false;
  if (auditImage.blocking === true) return false;
  if (!isInTargetCdn(media.image.url)) return false;
  const { width, height } = mediaDimensions(media, auditImage);
  return Boolean(
    width &&
      height &&
      Math.min(width, height) >= IMAGE_HEALTH_THRESHOLDS.primaryMinDimension &&
      !/placeholder|no[-_ ]?image|default[-_ ]?image|transparent/i.test(media.image.url),
  );
}

function liveMediaNodes(product) {
  return asArray(product?.media?.nodes).filter((media) => media?.__typename === "MediaImage" && media?.id && media?.image?.url);
}

function liveVariantMediaMap(product) {
  const result = {};
  for (const variant of asArray(product?.variants?.nodes)) {
    const media = asArray(variant?.media?.nodes).find((node) => node?.__typename === "MediaImage" && node?.id);
    if (variant?.id) result[normalizeId(variant.id)] = normalizeId(media?.id);
  }
  return result;
}

function mediaVariantLabels(product) {
  const labels = new Map();
  for (const variant of asArray(product?.variants?.nodes)) {
    const title = normalizeText(variant?.title);
    if (!title || /^default title$/i.test(title)) continue;
    const media = asArray(variant?.media?.nodes).find((node) => node?.__typename === "MediaImage" && node?.id);
    if (!media?.id) continue;
    const list = labels.get(normalizeId(media.id)) || [];
    if (!list.includes(title)) list.push(title);
    labels.set(normalizeId(media.id), list);
  }
  return labels;
}

function truncate(value, maximum = 250) {
  const text = normalizeText(value);
  if (text.length <= maximum) return text;
  return `${text.slice(0, maximum - 1).trimEnd()}…`;
}

function altTextFor(product, media, index, targetMediaId, variantLabels) {
  const title = truncate(product?.title || "VS Store product", 180);
  const labels = variantLabels.get(normalizeId(media?.id)) || [];
  const context =
    sameId(media?.id, targetMediaId)
      ? "main product image"
      : labels.length
        ? `${labels.slice(0, 2).join(" / ")} product image`
        : `product detail image ${index + 1}`;
  return truncate(`${title} — ${context}`);
}

function mutationErrors(payload) {
  return [...asArray(payload?.mediaUserErrors), ...asArray(payload?.userErrors)]
    .map((error) => `${Array.isArray(error?.field) ? error.field.join(".") : ""} ${normalizeText(error?.message || "Shopify media error")}`.trim())
    .filter(Boolean);
}

function ensureFutureLightProduct(audit, product) {
  if (!product) throw new Error(`live product ${audit?.handle || audit?.productId || "unknown"} was not found`);
  if (normalizeText(product.vendor) !== FUTURE_LIGHT_BRAND) {
    throw new Error(`refused non-${FUTURE_LIGHT_BRAND} product ${product.handle || product.id}`);
  }
  if (normalizeText(product.handle).toLowerCase() !== normalizeText(audit.handle).toLowerCase()) {
    throw new Error(`live handle mismatch for product ${audit.handle || audit.productId}`);
  }
}

function buildPlan(audit, liveProduct, priorEntry, { updateAlt = true } = {}) {
  ensureFutureLightProduct(audit, liveProduct);
  const media = liveMediaNodes(liveProduct);
  if (!media.length) throw new Error(`product ${audit.handle} has no live MediaImage records`);
  const priorTargetId = normalizeId(priorEntry?.targetMediaId);
  const currentPrimary = media[0];
  const currentPrimaryAudit = findAuditImage(audit, currentPrimary);
  const currentPrimaryHealthy = isUsablePrimaryCandidate(currentPrimary, currentPrimaryAudit);
  const candidates = media
    .map((entry, index) => ({ entry, index, auditImage: findAuditImage(audit, entry) }))
    .filter(({ entry, auditImage }) => isUsablePrimaryCandidate(entry, auditImage));
  const priorCandidate = candidates.find(({ entry }) => sameId(entry.id, priorTargetId));
  const selected = currentPrimaryHealthy
    ? { entry: currentPrimary, index: 0, auditImage: currentPrimaryAudit, source: "already-healthy" }
    : priorCandidate && priorCandidate.index > 0
      ? { ...priorCandidate, source: "persisted-plan" }
      : candidates.find(({ index }) => index > 0)
        ? { ...candidates.find(({ index }) => index > 0), source: "first-verified-alternate" }
        : null;
  if (!selected) {
    throw new Error(`product ${audit.handle} has no verified alternate image at or above ${IMAGE_HEALTH_THRESHOLDS.primaryMinDimension}px`);
  }

  const targetMediaId = normalizeId(selected.entry.id);
  const variantBindingsBefore = liveVariantMediaMap(liveProduct);
  const variantLabels = mediaVariantLabels(liveProduct);
  const altInputs = updateAlt
    ? media
        .map((entry, index) => ({
          id: normalizeId(entry.id),
          alt: altTextFor(liveProduct, entry, index, targetMediaId, variantLabels),
          currentAlt: normalizeText(entry.alt || entry.image?.altText),
        }))
        .filter((entry) => !entry.currentAlt)
        .map(({ id, alt }) => ({ id, alt }))
    : [];
  return {
    productId: normalizeId(liveProduct.id),
    handle: normalizeText(liveProduct.handle),
    title: normalizeText(liveProduct.title),
    currentPrimaryMediaId: normalizeId(currentPrimary.id),
    targetMediaId,
    targetPosition: 0,
    targetWidth: mediaDimensions(selected.entry, selected.auditImage).width,
    targetHeight: mediaDimensions(selected.entry, selected.auditImage).height,
    source: selected.source,
    reorderNeeded: !sameId(currentPrimary.id, targetMediaId),
    beforeMediaIds: media.map((entry) => normalizeId(entry.id)),
    variantBindingsBefore,
    altInputs,
    auditImageId: normalizeId(selected.auditImage?.id),
  };
}

function targetAudits(checkpoint, handles) {
  const audits = asArray(checkpoint?.audits).filter((audit) => {
    const primary = imageAuditsFor(audit)[0];
    return Boolean(primary?.blocking || asArray(audit?.issues).some((issue) => issue?.code === "primary-image-unusable"));
  });
  if (!handles.length) return audits;
  const selected = audits.filter((audit) => handles.includes(normalizeText(audit.handle).toLowerCase()));
  const missing = handles.filter((handle) => !selected.some((audit) => normalizeText(audit.handle).toLowerCase() === handle));
  if (missing.length) throw new Error(`requested handle(s) are not in the blocked image audit: ${missing.join(", ")}`);
  return selected;
}

async function fetchLiveProducts(productIds, label = "Future Light image repair live read") {
  const ids = productIds.map(productGid).filter(Boolean);
  if (!ids.length) return new Map();
  const payload = await withRetry(
    () => runShopify(LIVE_PRODUCTS_QUERY, { ids }, { label }),
    { label },
  );
  const result = new Map();
  for (const product of asArray(payload?.nodes)) {
    if (product?.id) result.set(normalizeId(product.id), product);
  }
  return result;
}

async function pollJob(jobId, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= jobPollTimeoutMs) {
    const payload = await withRetry(
      () => runShopify(JOB_STATUS_QUERY, { id: jobId }, { label: `${label} job status` }),
      { label: `${label} job status` },
    );
    const job = payload?.job;
    if (!job) throw new Error(`${label} returned no Shopify job during readback`);
    if (job.done === true) return;
    await sleep(jobPollIntervalMs);
  }
  throw new Error(`${label} job did not finish within ${jobPollTimeoutMs}ms`);
}

async function applyPlan(plan, { updateAlt }) {
  if (plan.reorderNeeded) {
    const payload = await withRetry(
      () =>
        runShopify(
          REORDER_MEDIA_MUTATION,
          {
            id: plan.productId,
            moves: [{ id: plan.targetMediaId, newPosition: "0" }],
          },
          { allowMutations: true, label: `reorder ${plan.handle}` },
        ),
      { label: `reorder ${plan.handle}` },
    );
    const result = payload?.productReorderMedia;
    const errors = mutationErrors(result);
    if (errors.length) throw new Error(`reorder ${plan.handle}: ${errors.join("; ")}`);
    const jobId = normalizeId(result?.job?.id);
    if (!jobId) throw new Error(`reorder ${plan.handle} returned no asynchronous job`);
    await pollJob(jobId, `reorder ${plan.handle}`);
  }

  if (updateAlt && plan.altInputs.length) {
    const payload = await withRetry(
      () =>
        runShopify(
          MEDIA_ALT_UPDATE_MUTATION,
          { productId: plan.productId, media: plan.altInputs },
          { allowMutations: true, label: `alt text ${plan.handle}` },
        ),
      { label: `alt text ${plan.handle}` },
    );
    const result = payload?.productUpdateMedia;
    const errors = mutationErrors(result);
    if (errors.length) throw new Error(`alt text ${plan.handle}: ${errors.join("; ")}`);
  }
}

function verifyPlan(plan, liveProduct, { updateAlt }) {
  ensureFutureLightProduct({ handle: plan.handle }, liveProduct);
  const media = liveMediaNodes(liveProduct);
  const primary = media[0];
  if (!primary || !sameId(primary.id, plan.targetMediaId)) {
    throw new Error(`primary media readback mismatch; expected ${plan.targetMediaId}, got ${primary?.id || "none"}`);
  }
  const primaryAudit = {
    id: primary.id,
    width: primary.image?.width,
    height: primary.image?.height,
    blocking: false,
  };
  if (!isUsablePrimaryCandidate(primary, primaryAudit)) {
    throw new Error(`primary media readback is still below the ${IMAGE_HEALTH_THRESHOLDS.primaryMinDimension}px card target`);
  }
  const beforeBindings = JSON.stringify(plan.variantBindingsBefore);
  const afterBindings = JSON.stringify(liveVariantMediaMap(liveProduct));
  if (beforeBindings !== afterBindings) throw new Error("variant-to-media associations changed during image repair");
  if (updateAlt) {
    const missingAlt = media.filter((entry) => !normalizeText(entry.alt || entry.image?.altText));
    if (missingAlt.length) throw new Error(`${missingAlt.length} image alt text value(s) remained blank after repair`);
  }
  return {
    primaryMediaId: normalizeId(primary.id),
    primaryWidth: Number(primary.image?.width) || null,
    primaryHeight: Number(primary.image?.height) || null,
    mediaCount: media.length,
    variantBindingsAfter: liveVariantMediaMap(liveProduct),
    mediaIdsAfter: media.map((entry) => normalizeId(entry.id)),
  };
}

function refreshedImageAudit(previousImage, media, index) {
  const width = Number(media?.image?.width) || null;
  const height = Number(media?.image?.height) || null;
  const alt = normalizeText(media?.alt || media?.image?.altText);
  const primary = index === 0;
  const issues = [];
  const shortSide = width && height ? Math.min(width, height) : null;
  if (!alt) issues.push({ code: "missing-alt", severity: "warning", target: "image" });
  if (!width || !height) {
    issues.push({ code: "missing-image-dimensions", severity: "warning", target: "image" });
  } else {
    if (shortSide < IMAGE_HEALTH_THRESHOLDS.minDimension) {
      issues.push({
        code: primary ? "primary-low-resolution" : "low-resolution",
        severity: primary ? "error" : "warning",
        width,
        height,
        shortSide,
        minimum: IMAGE_HEALTH_THRESHOLDS.minDimension,
      });
    }
    if (primary && shortSide < IMAGE_HEALTH_THRESHOLDS.primaryMinDimension) {
      issues.push({
        code: "primary-below-card-target",
        severity: "error",
        width,
        height,
        shortSide,
        target: IMAGE_HEALTH_THRESHOLDS.primaryMinDimension,
      });
    }
  }
  const contextualIssues = issues.map((issue) => ({
    ...issue,
    imageId: normalizeId(media?.id) || null,
    imageIndex: index,
    url: normalizeText(media?.image?.url) || null,
  }));
  return {
    ...(previousImage || {}),
    id: normalizeId(media?.id),
    url: normalizeText(media?.image?.url),
    alt,
    width,
    height,
    position: index + 1,
    index,
    primary,
    effectiveWidth: width,
    effectiveHeight: height,
    issues: contextualIssues,
    blocking: contextualIssues.some((issue) => ["error", "critical"].includes(issue.severity)),
    retryable: false,
    probe: previousImage?.probe
      ? {
          ...previousImage.probe,
          status: "ok",
          httpStatus: 200,
          width,
          height,
          retryable: false,
          error: null,
          errorCode: null,
        }
      : { status: "live-readback" },
  };
}

function refreshedProductAudit(previous, liveProduct) {
  const liveMedia = liveMediaNodes(liveProduct);
  const previousImages = imageAuditsFor(previous);
  const refreshedImages = liveMedia.map((media, index) => {
    const previousImage = previousImages.find(
      (image) =>
        sameId(image?.id, media?.id) ||
        canonicalImageUrl(image?.url) === canonicalImageUrl(media?.image?.url),
    );
    return refreshedImageAudit(previousImage, media, index);
  });
  const imageIssues = refreshedImages.flatMap((image) => asArray(image.issues));
  const variantAudits = asArray(previous?.variantAudits);
  const variantIssues = variantAudits.flatMap((variant) => asArray(variant?.issues));
  const issues = [...imageIssues, ...variantIssues];
  const uniqueIssues = [];
  for (const issue of issues) {
    const key = `${issue?.target || "image"}:${issue?.code || "unknown"}:${issue?.imageId || ""}:${issue?.variantId || ""}`;
    if (!uniqueIssues.some((existing) => `${existing?.target || "image"}:${existing?.code || "unknown"}:${existing?.imageId || ""}:${existing?.variantId || ""}` === key)) {
      uniqueIssues.push(issue);
    }
  }
  const blocking = uniqueIssues.some((issue) => ["critical", "error"].includes(issue?.severity));
  return {
    ...previous,
    key: previous?.key || `${normalizeId(previous?.productId)}::${normalizeText(liveProduct?.handle).toLowerCase()}`,
    productId: normalizeId(previous?.productId) || numericId(liveProduct?.id),
    handle: normalizeText(liveProduct?.handle),
    title: normalizeText(liveProduct?.title),
    vendor: normalizeText(liveProduct?.vendor),
    imageCount: liveMedia.length,
    auditedImageCount: refreshedImages.length,
    variantCount: asArray(liveProduct?.variants?.nodes).length,
    imageAudits: refreshedImages,
    variantAudits,
    issues: uniqueIssues,
    repairQueue: [],
    status: blocking ? "repair-required" : uniqueIssues.length ? "review" : "healthy",
    completed: true,
    needsRetry: false,
    refreshedAt: now(),
  };
}

function artifactSummary(products) {
  const audits = asArray(products);
  const images = audits.flatMap((audit) => asArray(audit?.imageAudits));
  const issueCounts = {};
  const imageIssueCounts = {};
  for (const audit of audits) {
    for (const issue of asArray(audit?.issues)) issueCounts[issue.code] = (issueCounts[issue.code] || 0) + 1;
    for (const image of asArray(audit?.imageAudits)) {
      for (const issue of asArray(image?.issues)) imageIssueCounts[issue.code] = (imageIssueCounts[issue.code] || 0) + 1;
    }
  }
  return {
    productsInScope: audits.length,
    productsAudited: audits.length,
    productsHealthy: audits.filter((audit) => audit.status === "healthy").length,
    productsWithIssues: audits.filter((audit) => audit.status !== "healthy").length,
    productsNeedsRetry: audits.filter((audit) => audit.needsRetry).length,
    remainingProducts: audits.filter((audit) => !audit.completed).length,
    imagesAudited: images.length,
    imagesWithIssues: images.filter((image) => asArray(image?.issues).length).length,
    imagesWithBlockingIssues: images.filter((image) => image?.blocking).length,
    imageIssueCounts: Object.fromEntries(Object.entries(imageIssueCounts).sort(([left], [right]) => left.localeCompare(right))),
    issueCounts: Object.fromEntries(Object.entries(issueCounts).sort(([left], [right]) => left.localeCompare(right))),
    repairQueueItems: buildRepairQueue(audits).length,
  };
}

async function refreshImageHealthArtifacts(plans) {
  const liveById = await fetchLiveProducts(
    plans.map(({ plan }) => plan.productId),
    "Future Light image health artifact refresh",
  );
  const checkpoint = await readJson(checkpointPath, null);
  const queue = await readJson(imageHealthQueuePath, null);
  if (!checkpoint?.audits || !queue?.products) throw new Error("image health artifacts are missing; refusing partial artifact refresh");
  const replacements = new Map();
  for (const { plan } of plans) {
    const liveProduct = liveById.get(plan.productId);
    const previous = asArray(checkpoint.audits).find(
      (audit) => normalizeText(audit?.handle).toLowerCase() === normalizeText(plan.handle).toLowerCase(),
    );
    if (!liveProduct || !previous) throw new Error(`cannot refresh image health artifact for ${plan.handle}`);
    replacements.set(normalizeText(plan.handle).toLowerCase(), refreshedProductAudit(previous, liveProduct));
  }
  const replaceAudit = (audit) => replacements.get(normalizeText(audit?.handle).toLowerCase()) || audit;
  const checkpointAudits = asArray(checkpoint.audits).map(replaceAudit);
  const queueProducts = asArray(queue.products).map(replaceAudit);
  const summary = artifactSummary(queueProducts);
  const repairQueue = buildRepairQueue(queueProducts);
  const pendingProducts = queueProducts.filter((audit) => !audit.completed).map((audit) => ({
    key: audit.key,
    productId: audit.productId,
    handle: audit.handle,
    title: audit.title,
  }));
  queue.products = queueProducts;
  queue.repairQueue = repairQueue;
  queue.pendingProducts = pendingProducts;
  queue.summary = summary;
  queue.status = pendingProducts.length ? "paused" : "complete";
  queue.generatedAt = now();
  queue.run = { ...(queue.run || {}), liveRepairRefreshedAt: now(), liveRepairProducts: replacements.size };
  checkpoint.audits = checkpointAudits;
  checkpoint.completedProducts = checkpointAudits.filter((audit) => audit.completed).length;
  checkpoint.status = pendingProducts.length ? "paused" : "complete";
  checkpoint.updatedAt = now();
  await writeJsonAtomic(checkpointPath, checkpoint);
  await writeJsonAtomic(imageHealthQueuePath, queue);
  process.stdout.write(`Image health artifacts refreshed from live readback for ${replacements.size} product(s); blocking media images now ${summary.imagesWithBlockingIssues}.\n`);
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function runWorker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()));
  return results;
}

async function main() {
  const args = parseArgs();
  if (targetStoreDomain !== "vs-future-store-0jl2t-jxu6tnr3.myshopify.com") {
    throw new Error("Future Light image repair target guard failed");
  }
  const checkpoint = await readJson(checkpointPath);
  if (checkpoint?.scope !== "future-light-store") throw new Error("image checkpoint is not a Future Light Store artifact");
  const audits = targetAudits(checkpoint, args.handles);
  if (!audits.length) {
    process.stdout.write("No blocked Future Light primary images remain in the checkpoint.\n");
    return;
  }

  const existingManifest = args.resume ? await readJson(manifestPath, null) : null;
  const priorByHandle = new Map(
    asArray(existingManifest?.entries).map((entry) => [normalizeText(entry?.handle).toLowerCase(), entry]),
  );
  const liveById = await fetchLiveProducts(
    audits.map((audit) => audit.productId),
    "Future Light primary image repair initial read",
  );
  const plans = audits.map((audit) => {
    const liveProduct = liveById.get(productGid(audit.productId));
    return {
      audit,
      liveProduct,
      plan: buildPlan(audit, liveProduct, priorByHandle.get(normalizeText(audit.handle).toLowerCase()), {
        updateAlt: args.updateAlt,
      }),
    };
  });

  const manifest = {
    schemaVersion: 1,
    scope: "future-light-store",
    targetStoreDomain,
    status: args.mode === "apply" ? "planned" : "dry-run",
    mode: args.mode,
    updateAlt: args.updateAlt,
    generatedAt: now(),
    updatedAt: now(),
    selectedCount: plans.length,
    entries: plans.map(({ audit, plan }) => ({
      productId: plan.productId,
      handle: plan.handle,
      title: plan.title,
      issueCodes: asArray(audit?.issues).map((issue) => issue?.code).filter(Boolean),
      currentPrimaryMediaId: plan.currentPrimaryMediaId,
      targetMediaId: plan.targetMediaId,
      targetPosition: plan.targetPosition,
      targetWidth: plan.targetWidth,
      targetHeight: plan.targetHeight,
      source: plan.source,
      reorderNeeded: plan.reorderNeeded,
      altMediaCount: plan.altInputs.length,
      beforeMediaIds: plan.beforeMediaIds,
      variantBindingsBefore: plan.variantBindingsBefore,
      status: "planned",
      error: null,
    })),
    summary: {
      reorderCount: plans.filter(({ plan }) => plan.reorderNeeded).length,
      alreadyHealthyCount: plans.filter(({ plan }) => !plan.reorderNeeded).length,
      altUpdateProducts: plans.filter(({ plan }) => plan.altInputs.length > 0).length,
      altUpdateMedia: plans.reduce((count, { plan }) => count + plan.altInputs.length, 0),
    },
  };
  await writeJsonAtomic(manifestPath, manifest);

  process.stdout.write(
    `Image repair plan: ${plans.length} blocked product(s), ${manifest.summary.reorderCount} existing primary image reorder(s), ${manifest.summary.altUpdateMedia} alt text update(s).\n`,
  );
  for (const { plan } of plans) {
    process.stdout.write(
      `${plan.handle}: ${plan.reorderNeeded ? `${plan.currentPrimaryMediaId} -> ${plan.targetMediaId}` : "primary already healthy"} (${plan.targetWidth}x${plan.targetHeight})\n`,
    );
  }

  if (args.mode !== "apply") return;

  await acquireLock();
  try {
    manifest.status = "running";
    manifest.startedAt = now();
    manifest.updatedAt = now();
    await writeJsonAtomic(manifestPath, manifest);
    let completed = 0;
    await mapWithConcurrency(plans, args.concurrency, async ({ plan }, index) => {
      const entry = manifest.entries[index];
      try {
        await applyPlan(plan, { updateAlt: args.updateAlt });
        const readbackById = await fetchLiveProducts([plan.productId], `Future Light image repair readback ${plan.handle}`);
        const liveAfter = readbackById.get(plan.productId);
        if (!liveAfter) throw new Error("product missing from final live readback");
        const verification = verifyPlan(plan, liveAfter, { updateAlt: args.updateAlt });
        Object.assign(entry, verification, {
          status: "verified",
          verifiedAt: now(),
          error: null,
        });
        completed += 1;
        process.stdout.write(`Image repair verified ${completed}/${plans.length}: ${plan.handle}\n`);
      } catch (error) {
        entry.status = "failed";
        entry.error = normalizeError(error);
        process.stdout.write(`Image repair failed: ${plan.handle}: ${entry.error}\n`);
      } finally {
        manifest.updatedAt = now();
        await writeJsonAtomic(manifestPath, manifest);
      }
    });
    const failures = manifest.entries.filter((entry) => entry.status === "failed");
    manifest.status = failures.length ? "failed" : "complete";
    manifest.completedAt = now();
    manifest.updatedAt = now();
    manifest.failureCount = failures.length;
    await writeJsonAtomic(manifestPath, manifest);
    if (failures.length) throw new Error(`${failures.length}/${plans.length} image repair(s) failed; see ${manifestPath}`);
    await refreshImageHealthArtifacts(plans);
    process.stdout.write(`Future Light primary image repair complete: ${completed}/${plans.length} verified.\n`);
  } finally {
    await releaseLock();
  }
}

main().catch((error) => {
  process.stderr.write(`Future Light primary image repair stopped: ${normalizeError(error)}\n`);
  process.exitCode = 1;
});
