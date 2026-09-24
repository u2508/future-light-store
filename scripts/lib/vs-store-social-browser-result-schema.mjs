import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { socialPaths } from "./vs-store-social-state.mjs";
import { inspectSocialImage } from "./vs-store-social-image-validation.mjs";

export const BROWSER_REQUEST_VERSION = 1;
export const BROWSER_RESULT_VERSION = 1;
export const BROWSER_INTENT_VERSION = 1;
export const BROWSER_PLATFORMS = ["facebook", "instagram"];
export const BROWSER_PLATFORM_STATES = [
  "not_started",
  "submit_intent",
  "published",
  "known_failed",
  "unknown",
];
const DIRECT_PUBLISH_LEAD_MINUTES = 2;

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableJson(entry)]),
    );
  }
  return value;
}

export function sha256Text(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

export function fingerprintJson(value) {
  return sha256Text(JSON.stringify(stableJson(value)));
}

function isContained(root, candidate) {
  const rootPath = resolve(root);
  const candidatePath = resolve(candidate);
  return candidatePath.startsWith(`${rootPath}/`);
}

function assertNoSecrets(value, label) {
  const sensitiveKey =
    /(?:access[_-]?token|password|cookie|(?:^|[_-])otp(?:$|[_-])|session[_-]?token|authorization)/i;
  const visit = (entry) => {
    if (!entry || typeof entry !== "object") return false;
    return Object.entries(entry).some(([key, child]) => sensitiveKey.test(key) || visit(child));
  };
  if (visit(value)) throw new Error(`${label} contains a credential or browser secret.`);
}

async function writeAtomic(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

export function browserRunDirectory(config, runKey) {
  return resolve(config.socialOutputDir, "runs", String(runKey));
}

export function resolveBrowserPublishMode(
  scheduledAt,
  { now = new Date(), minimumLeadMinutes = DIRECT_PUBLISH_LEAD_MINUTES } = {},
) {
  const scheduledAtMs =
    scheduledAt instanceof Date ? scheduledAt.getTime() : Date.parse(String(scheduledAt || ""));
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now || ""));
  if (!Number.isFinite(scheduledAtMs) || !Number.isFinite(nowMs))
    throw new Error("Browser publish mode requires valid scheduledAt and now timestamps.");
  return scheduledAtMs > nowMs + minimumLeadMinutes * 60_000 ? "scheduled" : "now";
}

export async function buildBrowserRequest({
  config,
  runKey,
  revision = 1,
  imagePath,
  caption,
  content,
  scheduledAt,
  offerPlan,
  expiresAt,
  allowedPlatforms = BROWSER_PLATFORMS,
  now = new Date(),
}) {
  const outputDir = resolve(config.socialOutputDir);
  const absoluteImagePath = resolve(imagePath);
  if (!isContained(outputDir, absoluteImagePath))
    throw new Error("Browser request image must be contained inside the social output directory.");
  const image = await inspectSocialImage(absoluteImagePath);
  const runDir = browserRunDirectory(config, runKey);
  const captionPath = resolve(runDir, "caption.txt");
  const offerSnapshotPath = resolve(runDir, "offer.json");
  const normalizedPlatforms = [...new Set(allowedPlatforms)].filter((platform) =>
    BROWSER_PLATFORMS.includes(platform),
  );
  if (!normalizedPlatforms.length || normalizedPlatforms.length !== allowedPlatforms.length)
    throw new Error("Browser request must allow at least one known platform without duplicates.");
  await mkdir(runDir, { recursive: true });
  await writeFile(captionPath, String(caption), "utf8");
  await writeAtomic(offerSnapshotPath, offerPlan || { status: "not-requested" });
  const canonical = {
    schemaVersion: BROWSER_REQUEST_VERSION,
    runKey: String(runKey),
    revision: Number(revision),
    facebookPageId: normalizeText(config.facebookPageId),
    facebookPageName: normalizeText(config.facebookPageName),
    facebookPageUrl: normalizeText(config.facebookPageUrl),
    instagramHandle: normalizeText(config.instagramHandle).replace(/^@/, ""),
    imagePath: absoluteImagePath,
    imageSha256: image.sha256,
    captionPath,
    captionSha256: sha256Text(caption),
    // The best-time slot is authoritative: schedule only while it is still
    // safely ahead; once crossed, Business Suite must publish immediately.
    publishMode: resolveBrowserPublishMode(scheduledAt, { now }),
    timezone: config.timezone,
    scheduledAt: new Date(scheduledAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    allowedPlatforms: normalizedPlatforms,
    offerSnapshotPath,
    content,
  };
  assertNoSecrets(canonical, "Browser request");
  const request = {
    ...canonical,
    fingerprint: fingerprintJson(canonical),
    createdAt: new Date().toISOString(),
  };
  await writeAtomic(resolve(outputDir, "browser-request.json"), request);
  await writeAtomic(resolve(runDir, "browser-request.json"), request);
  return { request, image };
}

export async function readBrowserRequest(config) {
  const path = resolve(config.socialOutputDir, "browser-request.json");
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function readBrowserResult(config) {
  const path = resolve(config.socialOutputDir, "browser-result.json");
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function readBrowserIntent(config) {
  const path = resolve(config.socialOutputDir, "browser-intent.json");
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export function buildBrowserIntent({ request, attemptId, platforms = request.allowedPlatforms }) {
  if (!attemptId || !/^[-a-zA-Z0-9_:.]+$/.test(attemptId))
    throw new Error("Browser submit intent requires a safe attempt ID.");
  const normalizedPlatforms = [...new Set(platforms)].filter((platform) =>
    request.allowedPlatforms.includes(platform),
  );
  if (!normalizedPlatforms.length || normalizedPlatforms.length !== platforms.length)
    throw new Error("Browser submit intent must target only the request's allowed platforms.");
  const canonical = {
    schemaVersion: BROWSER_INTENT_VERSION,
    runKey: request.runKey,
    requestFingerprint: request.fingerprint,
    attemptId,
    platforms: normalizedPlatforms,
    facebookPageId: request.facebookPageId,
    facebookPageName: request.facebookPageName,
    instagramHandle: request.instagramHandle,
    imageSha256: request.imageSha256,
    captionSha256: request.captionSha256,
    createdAt: new Date().toISOString(),
  };
  assertNoSecrets(canonical, "Browser submit intent");
  return { ...canonical, fingerprint: fingerprintJson(canonical) };
}

export function validateBrowserIntent(intent, request, { now = new Date() } = {}) {
  if (!intent || intent.schemaVersion !== BROWSER_INTENT_VERSION)
    throw new Error("Browser submit intent schema is missing or unsupported.");
  assertNoSecrets(intent, "Browser submit intent");
  if (intent.runKey !== request.runKey || intent.requestFingerprint !== request.fingerprint)
    throw new Error("Browser submit intent does not match the current request.");
  const canonical = { ...intent };
  delete canonical.fingerprint;
  if (fingerprintJson(canonical) !== intent.fingerprint)
    throw new Error("Browser submit intent fingerprint does not match its contents.");
  if (!Array.isArray(intent.platforms) || !intent.platforms.length)
    throw new Error("Browser submit intent does not target a platform.");
  if (intent.platforms.some((platform) => !request.allowedPlatforms.includes(platform)))
    throw new Error("Browser submit intent targets a platform outside the request.");
  const createdAt = Date.parse(String(intent.createdAt || ""));
  if (!Number.isFinite(createdAt) || createdAt > now.getTime() + 5 * 60_000)
    throw new Error("Browser submit intent timestamp is invalid.");
  return intent;
}

export function validateBrowserRequest(
  request,
  config,
  { now = new Date(), allowExpired = false } = {},
) {
  if (!request || request.schemaVersion !== BROWSER_REQUEST_VERSION)
    throw new Error("Browser request schema is missing or unsupported.");
  if (!request.runKey || !request.fingerprint)
    throw new Error("Browser request is missing its run key or fingerprint.");
  const canonical = { ...request };
  delete canonical.fingerprint;
  delete canonical.createdAt;
  if (fingerprintJson(canonical) !== request.fingerprint)
    throw new Error("Browser request fingerprint does not match its canonical contents.");
  const outputDir = resolve(config.socialOutputDir);
  if (!isContained(outputDir, request.imagePath))
    throw new Error("Browser request image path is outside the social output directory.");
  if (!isContained(outputDir, request.captionPath))
    throw new Error("Browser request caption path is outside the social output directory.");
  if (!isContained(outputDir, request.offerSnapshotPath))
    throw new Error("Browser request offer snapshot path is outside the social output directory.");
  if (!existsSync(request.imagePath) || !existsSync(request.captionPath))
    throw new Error("Browser request media or caption file is missing.");
  if (
    request.facebookPageId !== config.facebookPageId ||
    request.facebookPageName !== config.facebookPageName ||
    request.facebookPageUrl !== normalizeText(config.facebookPageUrl) ||
    request.instagramHandle !== config.instagramHandle.replace(/^@/, "") ||
    !Array.isArray(request.allowedPlatforms) ||
    !request.allowedPlatforms.length ||
    request.allowedPlatforms.some((platform) => !BROWSER_PLATFORMS.includes(platform)) ||
    new Set(request.allowedPlatforms).size !== request.allowedPlatforms.length
  )
    throw new Error(
      "Browser request destination identity does not match configured VS Store accounts.",
    );
  const expiresAt = Date.parse(String(request.expiresAt || ""));
  if (!Number.isFinite(expiresAt)) throw new Error("Browser request expiry is invalid.");
  if (!allowExpired && expiresAt <= now.getTime()) throw new Error("Browser request has expired.");
  return request;
}

function validateEvidencePath(value, outputDir, label) {
  if (!value || !isContained(outputDir, value))
    throw new Error(`${label} evidence path must stay inside the social output directory.`);
  if (!existsSync(value)) throw new Error(`${label} evidence file is missing.`);
}

export function deriveBrowserResultStatus(platforms) {
  const states = BROWSER_PLATFORMS.map((platform) => platforms?.[platform]?.status);
  if (states.every((status) => status === "published")) return "success";
  if (states.some((status) => status === "unknown" || status === "submit_intent"))
    return "needs_review";
  if (states.some((status) => status === "published")) return "partial";
  if (states.every((status) => status === "known_failed")) return "failed";
  return "needs_review";
}

export async function validateBrowserResult(result, request, config, { now = new Date() } = {}) {
  if (!result || result.schemaVersion !== BROWSER_RESULT_VERSION)
    throw new Error("Browser result schema is missing or unsupported.");
  assertNoSecrets(result, "Browser result");
  if (result.runKey !== request.runKey)
    throw new Error("Browser result run key does not match the request.");
  if (result.requestFingerprint !== request.fingerprint)
    throw new Error("Browser result does not match the request fingerprint.");
  if (!result.attemptId || !/^[-a-zA-Z0-9_:.]+$/.test(result.attemptId))
    throw new Error("Browser result is missing a safe attempt ID.");
  for (const platform of BROWSER_PLATFORMS) {
    const receipt = result.platforms?.[platform];
    if (!receipt || !BROWSER_PLATFORM_STATES.includes(receipt.status))
      throw new Error(`Browser result is missing a valid ${platform} state.`);
    if (!request.allowedPlatforms.includes(platform)) {
      if (receipt.status !== "published")
        throw new Error(
          `${platform} is outside this retry request but is not preserved as published.`,
        );
      continue;
    }
    if (receipt.status === "published") {
      if (!receipt.id && !receipt.url)
        throw new Error(`${platform} published receipt is missing an observable ID or URL.`);
      if (receipt.pageId && receipt.pageId !== request.facebookPageId && platform === "facebook")
        throw new Error("Facebook receipt belongs to an unexpected Page.");
      if (
        receipt.handle &&
        receipt.handle.replace(/^@/, "") !== request.instagramHandle &&
        platform === "instagram"
      )
        throw new Error("Instagram receipt belongs to an unexpected account.");
      if (receipt.captionSha256 !== request.captionSha256)
        throw new Error(`${platform} receipt caption hash does not match the canonical caption.`);
      if (receipt.imageSha256 !== request.imageSha256)
        throw new Error(`${platform} receipt image hash does not match the uploaded asset.`);
      validateEvidencePath(receipt.evidencePath, resolve(config.socialOutputDir), platform);
    }
    if (receipt.status === "known_failed" && !normalizeText(receipt.error))
      throw new Error(`${platform} known failure must include a reason.`);
    if (receipt.status === "unknown" && !normalizeText(receipt.reason))
      throw new Error(`${platform} unknown state must include a reconciliation reason.`);
  }
  const derivedStatus = deriveBrowserResultStatus(result.platforms);
  if (result.status !== derivedStatus)
    throw new Error(
      `Browser result status ${result.status} does not match platform receipts ${derivedStatus}.`,
    );
  const recordedAt = Date.parse(String(result.recordedAt || ""));
  if (!Number.isFinite(recordedAt) || recordedAt > now.getTime() + 5 * 60_000)
    throw new Error("Browser result timestamp is invalid.");
  return result;
}

export function browserPaths(config) {
  const paths = socialPaths(config.rootDir);
  return {
    request: resolve(config.socialOutputDir, "browser-request.json"),
    result: resolve(config.socialOutputDir, "browser-result.json"),
    journal: paths.journal,
  };
}
