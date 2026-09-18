#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { retryDelayMs, sleep, stableJson } from "./lib/performance-runtime.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, "..");
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const nodeBin = process.execPath;
const require = createRequire(import.meta.url);
const releaseName = process.env.SALT_RELEASE_NAME || "Future Light Store";
const catalogBatchSize = Math.max(1, Math.min(1000, Number(process.env.SALT_CATALOG_BATCH_SIZE || 50)));
const releaseRunStatePath = resolve(rootDir, "output", "release-run-state.json");
const releaseRunStateMirrorDir = resolve(rootDir, "output");
const releaseHeartbeatMs = Math.max(10_000, Number(process.env.SALT_RELEASE_HEARTBEAT_MS || 30_000));
const releaseStageTelemetryMs = Math.max(1_000, Number(process.env.SALT_RELEASE_STAGE_TELEMETRY_MS || 5_000));
const releaseStageRetries = Math.max(0, Math.min(3, Number(process.env.SALT_RELEASE_STAGE_RETRIES || 2)));
const releaseStageRetryDelayMs = Math.max(1_000, Number(process.env.SALT_RELEASE_STAGE_RETRY_DELAY_MS || 5_000));
const releaseStageRetryDelayMaxMs = Math.max(
  releaseStageRetryDelayMs,
  Number(process.env.SALT_RELEASE_STAGE_RETRY_DELAY_MAX_MS || 30_000),
);
const releaseOwnerLockPath = resolve(rootDir, "output", "release-process.lock");
const proactiveRepairScriptPath = resolve(rootDir, "scripts", "release-proactive-repair.mjs");
const releaseNetworkPollMs = Math.max(5_000, Number(process.env.SALT_RELEASE_NETWORK_POLL_MS || 30_000));
const releaseNetworkProbeTimeoutMs = Math.max(2_000, Number(process.env.SALT_RELEASE_NETWORK_PROBE_TIMEOUT_MS || 15_000));
const releaseNetworkFailureBackoffMs = Math.max(1_000, Number(process.env.SALT_RELEASE_NETWORK_FAILURE_BACKOFF_MS || 2_000));
const releaseNetworkFailureBackoffMaxMs = Math.max(
  releaseNetworkFailureBackoffMs,
  Number(process.env.SALT_RELEASE_NETWORK_FAILURE_BACKOFF_MAX_MS || 30_000),
);
const releaseFailureOutputLimit = 8_000;
const releaseFailureStateLimit = 1_500;
const networkFailurePattern = /429|rate limit|throttl|timeout|timed out|network|socket|temporar|aborted|econnreset|econnrefused|econnaborted|enetunreach|ehostunreach|enotfound|eai_again|getaddrinfo|dns|err_network|und_err|fetch failed|could not resolve host|name resolution|no such host|connection refused|connection reset|service unavailable|bad gateway|gateway timeout/i;
const retryableStageFailurePattern = /429|too many requests|rate limit|throttl|timeout|timed out|network|socket|temporar|aborted|econn|enet|ehost|enotfound|eai_again|getaddrinfo|dns|fetch failed|service unavailable|bad gateway|gateway timeout|\bHTTP\s+5\d\d\b|\b5\d\d\s+(?:error|response)|bulk operation .*?(?:did not finish|failed to complete|timed out)|readback .*?(?:pending|temporar|not ready)|temporar(?:y|ily) unavailable/i;
const remoteReleaseStagePattern = /shopify|sync:data|seo:new-products:apply|catalog-integrity/i;

function releaseStepFingerprint(step, profile) {
  return createHash("sha256")
    .update(stableJson({ profile, label: step.label, command: step.command, args: step.args, cwd: step.cwd }))
    .digest("hex");
}

const catalogIntegrityArgs = [
  "--reclassify",
  "--batch-size",
  String(catalogBatchSize),
];
const deterministicCatalogIntegrityArgs = [
  ...catalogIntegrityArgs,
  "--skip-vision",
  "--deterministic-only",
];
const supervisedVisionCatalogIntegrityArgs = [
  ...catalogIntegrityArgs,
  "--supervised-vision",
];

function formatCommand(command, args) {
  return [command, ...args].join(" ");
}

let releaseRunState = {};
let releaseOwnerLockAcquired = false;
let releaseRunStateOwned = false;
let releaseStateWriteQueue = Promise.resolve();

function stripAnsi(value) {
  return String(value || "").replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

function redactFailureText(value, limit = releaseFailureOutputLimit) {
  const redacted = stripAnsi(value)
    .replace(/(authorization|x-shopify-access-token|access[_-]?token|api[_-]?key|secret|password|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .trim();
  return redacted.length > limit ? `…${redacted.slice(-limit)}` : redacted;
}

export function isNetworkFailureText(value) {
  return networkFailurePattern.test(redactFailureText(value));
}

export function isRetryableStageFailure(value) {
  return retryableStageFailurePattern.test(redactFailureText(value));
}

export function isRemoteReleaseStage(command, args = []) {
  return remoteReleaseStagePattern.test(`${command} ${args.join(" ")}`);
}

export function shouldRepairKnowledgeModel(label, failureText) {
  return label === "Verify trained 256M-record catalog knowledge model"
    && /Catalog knowledge model training fingerprint does not match the checked-in taxonomy\./i.test(
      stripAnsi(String(failureText || "")),
    );
}

function releaseRunStateMirrorPath(profile) {
  const safeProfile = String(profile || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return safeProfile ? resolve(releaseRunStateMirrorDir, `release-run-state.${safeProfile}.json`) : null;
}

function releaseStateTimestamp(state) {
  return [
    state?.heartbeatAt,
    state?.completedAt,
    state?.failedAt,
    state?.startedAt,
  ].map((value) => Date.parse(String(value || ""))).find((value) => Number.isFinite(value)) || 0;
}

async function readJsonFile(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

export async function readReleaseRunState(profile = "") {
  const candidates = [
    await readJsonFile(releaseRunStatePath),
    await readJsonFile(releaseRunStateMirrorPath(profile)),
  ].filter(Boolean);
  const exactProfileCandidates = candidates.filter((candidate) =>
    !profile || !candidate.profile || candidate.profile === profile);
  return (exactProfileCandidates.length ? exactProfileCandidates : candidates)
    .sort((left, right) => releaseStateTimestamp(right) - releaseStateTimestamp(left))[0] || null;
}

export function areCompatibleReleaseProfiles(previousProfile, requestedProfile) {
  const previous = String(previousProfile || "").trim();
  const requested = String(requestedProfile || "").trim();
  if (!previous || !requested || previous === requested) return true;
  return [previous, requested].every((profile) => ["catalog", "daily"].includes(profile));
}

export function resolveResumeStep(steps, previousRunState, requestedResumeFromStep = 1) {
  const requested = Math.max(1, Number(requestedResumeFromStep || 1));
  const priorLabel = String(previousRunState?.stepLabel || "").trim();
  const byLabel = priorLabel ? steps.findIndex((step) => step.label === priorLabel) + 1 : 0;
  if (byLabel > 0) {
    return {
      resumeFromStep: byLabel,
      migrated: byLabel !== requested,
      priorStepLabel: priorLabel,
    };
  }
  if (requested <= steps.length) {
    return { resumeFromStep: requested, migrated: false, priorStepLabel: priorLabel };
  }
  return {
    resumeFromStep: requested,
    migrated: false,
    priorStepLabel: priorLabel,
    error: `Cannot resume from step ${requested}; release has ${steps.length} steps and the prior step label is unavailable.`,
  };
}

function isProcessAlive(pid) {
  const parsedPid = Number(pid || 0);
  if (!Number.isInteger(parsedPid) || parsedPid <= 0) return false;
  try {
    process.kill(parsedPid, 0);
    return true;
  } catch {
    return false;
  }
}

async function writeOwnerLock(profile) {
  await mkdir(releaseOwnerLockPath);
  await writeFile(
    resolve(releaseOwnerLockPath, "owner.json"),
    `${JSON.stringify({ pid: process.pid, profile, startedAt: new Date().toISOString() })}\n`,
    "utf8",
  );
  releaseOwnerLockAcquired = true;
}

async function acquireReleaseOwnerLock(profile) {
  try {
    await writeOwnerLock(profile);
    return;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }

  const owner = await readJsonFile(resolve(releaseOwnerLockPath, "owner.json"));
  const ownerPid = Number(owner?.pid || 0);
  if (ownerPid && ownerPid !== process.pid && isProcessAlive(ownerPid)) {
    throw new Error(`Another Future Light Store release process is active (pid ${ownerPid}); refusing to overlap releases.`);
  }

  // The directory is an exact Future Light Store lock target. Reclaim only a
  // stale lock whose recorded owner is no longer alive or whose owner file
  // was never completed after a process interruption.
  await rm(releaseOwnerLockPath, { recursive: true, force: true });
  await writeOwnerLock(profile);
}

async function releaseOwnerLock() {
  if (!releaseOwnerLockAcquired) return;
  const owner = await readJsonFile(resolve(releaseOwnerLockPath, "owner.json"));
  if (Number(owner?.pid || 0) === process.pid) {
    await rm(releaseOwnerLockPath, { recursive: true, force: true });
  }
  releaseOwnerLockAcquired = false;
}

const RELEASE_REPAIR_ROUTES = [
  {
    failedLabel: "Verify every active product has product-specific SEO and metafields",
    startLabel: "Run local SEO and product-content quality audit",
    matches: /product-specificity|SEO and metafields/i,
    reason: "product-specificity verification failed after content rules changed; replaying guarded content and live-readback steps",
    message: "so updated product content reaches Shopify before verification",
  },
  {
    failedLabel: "Apply all-active-catalog product categories and merchandising metafields",
    startLabel: "Refresh Shopify data after final product publication",
    matches: /metafield|category|taxonomy|owner subtype|union|schema/i,
    reason: "category or merchandising backfill failed; replaying the final publication refresh and live-aware backfill",
    message: "so the category/metafield repair can retry from a fresh live catalog",
  },
  {
    failedLabel: "Verify Shopify merchandising backfill",
    startLabel: "Apply all-active-catalog product categories and merchandising metafields",
    matches: /merchandising|mismatch|collection|shop/i,
    reason: "merchandising readback found stale generated collection or shop data; replaying live-aware merchandising backfill before verification",
    message: "so live-aware merchandising values reach Shopify before verification",
  },
  {
    failedLabel: "Automatically clear visual classification review with guarded evidence",
    startLabel: "Build visual taxonomy review queue",
    matches: /visual|classification|review|image|evidence/i,
    reason: "visual classification automation did not clear its guarded queue; rebuilding the evidence queue and retrying",
    message: "so visual evidence is regenerated before the classification gate",
  },
  {
    failedLabel: "Require image-backed taxonomy evidence",
    startLabel: "Build visual taxonomy review queue",
    matches: /visual|classification|review|image|evidence/i,
    reason: "image-backed taxonomy evidence was incomplete; rebuilding the persisted review queue",
    message: "so image-backed evidence is regenerated before validation",
  },
  {
    failedLabel: "Require complete ChatGPT visual variant and image decisions",
    startLabel: "Build Future Light ChatGPT visual variant and image review queue",
    matches: /variant|image|mapping|visual|review|approval/i,
    reason: "manual visual variant/image approval was incomplete or stale; rebuilding the evidence queue",
    message: "so only current, explicitly reviewed visual decisions can pass the release gate",
  },
  {
    failedLabel: "Apply approved ChatGPT visual variant and image decisions with live readback",
    startLabel: "Require complete ChatGPT visual variant and image decisions",
    matches: /variant|image|mapping|visual|media|readback|upload/i,
    reason: "approved visual variant/image mutation or readback failed; rebuilding current evidence before retry",
    message: "so the guarded adapter retries only against the latest reviewed media IDs",
  },
  {
    failedLabel: "Apply approved taxonomy tags and metafields with live readback",
    startLabel: "Dry-run exact full-catalog collection reconciliation",
    matches: /taxonomy|tag|metafield|collection|manifest|readback/i,
    reason: "taxonomy apply encountered a stale or incomplete plan; replaying the guarded full-catalog classification and live-readback steps",
    message: "so the classification manifest covers every active product",
  },
  {
    failedLabel: "Verify live full-catalog nominal market pricing before base SEO",
    startLabel: "Dry-run products with missing live Shopify variant costs",
    matches: /missing|invalid|nominal market pricing|cost-based pricing|unitCost|price/i,
    reason: "full-catalog pricing verification found products with missing or invalid live costs; replaying the approval-gated cost repair before pricing",
    message: "so missing-cost products are handled before pricing is retried",
  },
  {
    failedLabel: "Verify exact collection membership and price rules",
    startLabel: "Dry-run exact full-catalog collection reconciliation",
    matches: /collection|tag|classification|collectionless|govern|price|cost/i,
    reason: "collection, classification, or price-integrity readback found drift; replaying the guarded full-catalog reconciliation",
    message: "so evidence-backed collection and price repairs reach live readback",
  },
  {
    failedLabel: "Validate final catalog taxonomy snapshot",
    startLabel: "Read live Shopify tag inventory",
    matches: /taxonomy|tag|classification|collection|snapshot|review/i,
    reason: "final taxonomy snapshot validation found stale catalog evidence; replaying the live tag and taxonomy audit",
    message: "so the final taxonomy snapshot is rebuilt from live evidence",
  },
  {
    failedLabel: "Verify daily manual collection shuffle",
    startLabel: "Dry-run daily manual collection shuffle",
    matches: /shuffle|order|collection|readback/i,
    reason: "collection shuffle readback failed; replaying the same-seed guarded shuffle plan",
    message: "so failed collection order entries are repaired and read back",
  },
  {
    failedLabel: "Final live-readback gate after tag cleanup and collection merges",
    startLabel: "Dry-run exact full-catalog collection reconciliation",
    matches: /collection|tag|classification|collectionless|govern|price|cost|readback/i,
    reason: "the final live-readback gate found governed catalog drift; replaying the guarded reconciliation before the final gate",
    message: "so the final live-readback gate can verify the repaired catalog",
  },
];

export function getReleaseRepairRoute(steps, previousRunState, requestedResumeFromStep) {
  if (previousRunState?.status !== "failed") {
    return null;
  }

  const failureText = `${previousRunState?.stepLabel || ""}\n${previousRunState?.error || ""}`;
  for (const route of RELEASE_REPAIR_ROUTES) {
    const failedStep = steps.findIndex((step) => step.label === route.failedLabel) + 1;
    const startStep = steps.findIndex((step) => step.label === route.startLabel) + 1;
    if (failedStep < 1 || startStep < 1 || requestedResumeFromStep !== failedStep) {
      continue;
    }
    if (!route.matches.test(failureText) || startStep >= requestedResumeFromStep) {
      continue;
    }
    return {
      fromStep: startStep,
      failedStep,
      reason: route.reason,
      message: `Repair-aware resume: replaying steps ${startStep}-${failedStep} ${route.message}.\n`,
    };
  }

  return null;
}

async function probeReleaseNetwork() {
  const shopUrl = String(process.env.SALT_SHOP_URL || "").trim();
  let parsedUrl;
  try {
    parsedUrl = new URL(shopUrl);
  } catch {
    return { available: false, reason: "release store URL is unavailable" };
  }

  try {
    await lookup(parsedUrl.hostname);
  } catch (error) {
    return { available: false, reason: `DNS lookup unavailable (${error?.code || "lookup failure"})` };
  }

  try {
    const response = await fetch(parsedUrl, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(releaseNetworkProbeTimeoutMs),
    });
    response.body?.cancel?.();
    return { available: true, status: response.status };
  } catch (error) {
    return { available: false, reason: redactFailureText(error?.message || error, 300) || "store network probe failed" };
  }
}

function stageFailureError({ label, commandLine, cwd, result }) {
  const exitDetail = result.error
    ? `process error ${result.error.code || result.error.message || result.error}`
    : result.signal
      ? `signal ${result.signal}`
      : `exit code ${result.code}`;
  const output = redactFailureText(result.output);
  return new Error([
    `Release stopped at step ${result.index}/${result.total} (${label}) with ${exitDetail}.`,
    `Command: ${commandLine}`,
    `Working directory: ${cwd}`,
    output ? `Output tail: ${redactFailureText(output, releaseFailureStateLimit)}` : "",
  ].filter(Boolean).join("\n"));
}

async function writeReleaseRunState(patch = {}) {
  releaseRunState = {
    ...releaseRunState,
    ...patch,
    heartbeatAt: new Date().toISOString(),
  };

  const snapshot = { ...releaseRunState };
  const persist = async () => {
    try {
      await mkdir(resolve(rootDir, "output"), { recursive: true });
      const targets = [releaseRunStatePath, releaseRunStateMirrorPath(snapshot.profile)].filter(Boolean);
      for (const targetPath of targets) {
        const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
        await writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
        await rename(tempPath, targetPath);
      }
    } catch {
      // Run-state telemetry must never turn a valid release into a failed release.
    }
  };

  // Heartbeat, stage telemetry, and retry updates can overlap. Serialize
  // atomic snapshots so a late heartbeat cannot overwrite a newer checkpoint.
  releaseStateWriteQueue = releaseStateWriteQueue.then(persist, persist);
  await releaseStateWriteQueue;
}

function runStageAttempt({ command, args, cwd, index, total, label = "release stage", attempt = 1 }) {
  return new Promise((resolveAttempt) => {
    let output = "";
    let outputBytes = 0;
    let settled = false;
    let child;
    let telemetryTimer;
    const stageStartedAt = new Date().toISOString();
    let lastOutputAt = stageStartedAt;
    const appendOutput = (chunk) => {
      const text = String(chunk || "");
      outputBytes += Buffer.byteLength(text);
      lastOutputAt = new Date().toISOString();
      output += text;
      if (output.length > releaseFailureOutputLimit) output = output.slice(-releaseFailureOutputLimit);
    };
    const writeStageTelemetry = (patch = {}) => {
      void writeReleaseRunState({
        stageStatus: "running",
        stageLabel: label,
        stageAttempt: attempt,
        stageStartedAt,
        stageLastOutputAt: lastOutputAt,
        stageOutputBytes: outputBytes,
        ...patch,
      }).catch(() => {});
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (telemetryTimer) clearInterval(telemetryTimer);
      writeStageTelemetry({
        stageStatus: result.code === 0 ? "completed" : "failed",
        stageFinishedAt: new Date().toISOString(),
        stageExitCode: result.code ?? null,
        stageSignal: result.signal || null,
        stageChildPid: child?.pid || null,
      });
      resolveAttempt({ ...result, output, index, total });
    };
    child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["inherit", "pipe", "pipe"],
    });
    writeStageTelemetry({
      stageChildPid: child.pid || null,
      stageFinishedAt: null,
      stageExitCode: null,
      stageSignal: null,
    });
    telemetryTimer = setInterval(() => {
      writeStageTelemetry({ stageChildPid: child.pid || null });
    }, releaseStageTelemetryMs);
    telemetryTimer.unref?.();
    child.stdout?.on("data", (chunk) => {
      process.stdout.write(chunk);
      appendOutput(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      process.stderr.write(chunk);
      appendOutput(chunk);
    });
    child.on("error", (error) => finish({ error }));
    child.on("close", (code, signal) => finish({ code, signal }));
  });
}

async function waitForNetworkBeforeRetry({ label, commandLine, cwd, index, total, attempt, initialProbe = null }) {
  const startedAt = releaseRunState.networkWait?.active && releaseRunState.networkWait?.startedAt
    ? releaseRunState.networkWait.startedAt
    : new Date().toISOString();
  const baseWait = retryDelayMs({
    attempt: Math.max(0, attempt - 1),
    baseMs: releaseNetworkFailureBackoffMs,
    maxMs: releaseNetworkFailureBackoffMaxMs,
    jitterMs: 500,
  });
  let pollCount = 0;
  let probe = initialProbe;

  await writeReleaseRunState({
    status: "waiting_for_network",
    stageStatus: "waiting_for_network",
    networkWait: {
      active: true,
      stepIndex: index,
      totalSteps: total,
      stepLabel: label,
      command: commandLine,
      cwd,
      attempt,
      startedAt,
      pollCount,
      reason: releaseRunState.networkWait?.reason || "transient network or DNS failure",
      nextProbeAt: new Date(Date.now() + baseWait).toISOString(),
    },
  });
  process.stdout.write(
    `Network/DNS failure at step ${index}/${total}; entering wait state before retry ${attempt}. Polling until the store network is restored.\n`,
  );
  await sleep(baseWait);

  while (true) {
    probe ||= await probeReleaseNetwork();
    const now = new Date().toISOString();
    if (probe.available) {
      await writeReleaseRunState({
        status: "running",
        stageStatus: "retrying",
        networkWait: {
          active: false,
          stepIndex: index,
          totalSteps: total,
          stepLabel: label,
          command: commandLine,
          cwd,
          attempt,
          startedAt,
          pollCount,
          lastProbeAt: now,
          restoredAt: now,
          nextProbeAt: null,
          reason: "network restored; retrying the same guarded step",
        },
      });
      process.stdout.write(`Network restored; retrying step ${index}/${total} (${label}) from its guarded checkpoint.\n`);
      return;
    }

    pollCount += 1;
    const nextProbeAt = new Date(Date.now() + releaseNetworkPollMs).toISOString();
    await writeReleaseRunState({
      status: "waiting_for_network",
      stageStatus: "waiting_for_network",
      networkWait: {
        active: true,
        stepIndex: index,
        totalSteps: total,
        stepLabel: label,
        command: commandLine,
        cwd,
        attempt,
        startedAt,
        pollCount,
        lastProbeAt: now,
        nextProbeAt,
        reason: probe.reason || "store network probe failed",
      },
    });
    process.stdout.write(`Network still unavailable; next probe in ${Math.round(releaseNetworkPollMs / 1000)}s (poll ${pollCount}).\n`);
    await sleep(releaseNetworkPollMs);
    probe = null;
  }
}

function proactiveRepairModesForStage(label) {
  const text = String(label || "").toLowerCase();
  const modes = ["preflight", "collection"];
  if (/visual|classification|image|evidence/.test(text)) modes.push("visual");
  if (/seo|specificity|content|metafield/.test(text)) modes.push("seo");
  if (/shuffle|final|readback|integrity/.test(text)) modes.push("postflight");
  return [...new Set(modes)];
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function runProactiveDiagnostic(mode, { optional = false } = {}) {
  if (process.env.FUTURE_LIGHT_RELEASE_SKIP_PROACTIVE_DIAGNOSTICS === "1") return false;
  if (!await pathExists(proactiveRepairScriptPath)) {
    if (optional) return false;
    throw new Error(`Future Light Store proactive repair script is missing at ${proactiveRepairScriptPath}`);
  }

  const diagnosticArgs = [proactiveRepairScriptPath, `--${mode}`];
  try {
    execFileSync(nodeBin, diagnosticArgs, {
      cwd: rootDir,
      env: { ...process.env, FUTURE_LIGHT_STORE: "1" },
      stdio: "inherit",
    });
    return true;
  } catch (error) {
    if (optional) {
      process.stdout.write(`Proactive ${mode} diagnostic was unavailable during retry; preserving the original stage failure.\n`);
      return false;
    }
    throw new Error(`Future Light Store proactive ${mode} diagnostic failed: ${error?.message || error}`);
  }
}

async function runStandbyProactiveRepairs({ label, failureText }) {
  if (process.env.FUTURE_LIGHT_RELEASE_SKIP_PROACTIVE_DIAGNOSTICS === "1") return;
  const modes = proactiveRepairModesForStage(`${label}\n${failureText}`);
  for (const mode of modes) {
    if (mode === "visual" && !await pathExists(resolve(rootDir, "output", "shopify-catalog-integrity-manifest.json"))) continue;
    if (mode === "seo" && !await pathExists(resolve(rootDir, "output", "shopify-seo-release-manifest.json"))) continue;
    if (mode === "postflight" && !await pathExists(resolve(rootDir, "output", "shopify-collection-shuffle-manifest.json"))) continue;
    await runProactiveDiagnostic(mode, { optional: true });
  }
}

async function runStage({ label, command, args, cwd, index, total }) {
  const commandLine = formatCommand(command, args);

  process.stdout.write(`\n[${index}/${total}] ${label}\n`);
  process.stdout.write(`$ ${commandLine}\n`);

  let stageAttempt = 0;
  let networkAttempt = 0;
  let knowledgeModelRepairAttempted = false;
  while (true) {
    stageAttempt += 1;
    await writeReleaseRunState({
      status: "running",
      stageStatus: "starting",
      stageAttempt,
      stageRetryLimit: releaseStageRetries,
      stageRetryable: false,
    });
    const result = await runStageAttempt({ command, args, cwd, index, total, label, attempt: stageAttempt });
    if (result.code === 0) {
      await writeReleaseRunState({
        status: "running",
        stageStatus: "completed",
        stageAttempt,
        stageFinishedAt: new Date().toISOString(),
      });
      process.stdout.write(`[ok] ${label}\n`);
      return;
    }

    const failure = stageFailureError({ label, commandLine, cwd, result });
    if (!knowledgeModelRepairAttempted && shouldRepairKnowledgeModel(label, `${result.error?.message || ""}\n${result.output}`)) {
      knowledgeModelRepairAttempted = true;
      process.stdout.write(
        "Knowledge model fingerprint drift detected; retraining the approved 256M-record local model before retrying verification.\n",
      );
      const repairCommand = formatCommand(npmBin, ["run", "catalog:knowledge:model:train"]);
      const repairResult = await runStageAttempt({
        command: npmBin,
        args: ["run", "catalog:knowledge:model:train"],
        cwd,
        index,
        total,
        label: "Repair catalog knowledge model fingerprint",
        attempt: stageAttempt,
      });
      if (repairResult.code !== 0) {
        throw stageFailureError({
          label: "Repair catalog knowledge model fingerprint",
          commandLine: repairCommand,
          cwd,
          result: repairResult,
        });
      }
      process.stdout.write("Catalog knowledge model retrained; retrying the original verification gate.\n");
      continue;
    }
    let initialProbe = null;
    let networkFailure = isNetworkFailureText(`${result.error?.code || ""} ${result.error?.message || ""} ${result.output}`);
    if (!networkFailure && isRemoteReleaseStage(command, args)) {
      initialProbe = await probeReleaseNetwork();
      networkFailure = !initialProbe.available;
    }
    // Network failures intentionally stay in the unbounded DNS/transport
    // wait above. This bounded branch handles only non-network transient
    // failures such as Shopify throttling or an eventually-consistent readback.
    const failureText = `${result.error?.code || ""} ${result.error?.message || ""} ${result.output}`;
    if (networkFailure) {
      networkAttempt += 1;
      const failureReason = redactFailureText(failureText, releaseFailureStateLimit);
      releaseRunState = {
        ...releaseRunState,
        networkWait: {
          ...(releaseRunState.networkWait || {}),
          reason: failureReason || initialProbe?.reason || "transient network or DNS failure",
          lastFailureAt: new Date().toISOString(),
        },
      };
      await waitForNetworkBeforeRetry({
        label,
        commandLine,
        cwd,
        index,
        total,
        attempt: networkAttempt,
        initialProbe,
      });
      continue;
    }
    if (!isRetryableStageFailure(failureText)) {
      throw failure;
    }
    if (stageAttempt > releaseStageRetries) {
      await writeReleaseRunState({
        status: "failed",
        stageStatus: "retry-exhausted",
        stageRetryable: true,
      });
      throw failure;
    }
    await runStandbyProactiveRepairs({ label, failureText });
    const delayMs = retryDelayMs({
      attempt: stageAttempt - 1,
      baseMs: releaseStageRetryDelayMs,
      maxMs: releaseStageRetryDelayMaxMs,
      jitterMs: Math.min(500, Math.floor(releaseStageRetryDelayMs / 2)),
    });
    await writeReleaseRunState({
      status: "running",
      stageStatus: "retrying",
      stageAttempt,
      stageRetryable: true,
      stageRetryAt: new Date(Date.now() + delayMs).toISOString(),
      stageRetryReason: redactFailureText(failureText, releaseFailureStateLimit),
    });
    process.stdout.write(`Transient stage failure; retry ${stageAttempt + 1}/${releaseStageRetries + 1} in ${Math.round(delayMs / 1000)}s.\n`);
    await sleep(delayMs);
  }
}

async function ensurePathExists(path, label) {
  try {
    await access(path);
  } catch {
    throw new Error(`${label} not found at ${path}`);
  }
}

function getReleasePaths(releaseRootDir) {
  return {
    iosDir: resolve(releaseRootDir, "salt-store-ios"),
    androidDir: resolve(releaseRootDir, "salt-store-android"),
    capacitorCliBin: resolve(releaseRootDir, "node_modules", "@capacitor", "cli", "bin", "capacitor"),
    shopifyThemeDir: resolve(
      process.env.SALT_SHOPIFY_THEME_DIR ||
        process.env.SHOPIFY_THEME_DIR ||
        resolve(releaseRootDir, "..", "future-light-store-shopify"),
    ),
    productCohortCatalog: resolve(releaseRootDir, "output", "new-product-cohort-catalog.json"),
    productCohortHandles: resolve(releaseRootDir, "output", "new-product-cohort-handles.json"),
  };
}

function buildCatalogReleaseSteps({
  releaseRootDir = rootDir,
  includeMobile = process.env.SALT_RELEASE_SKIP_MOBILE !== "1",
  supervisedVision = false,
} = {}) {
  const { iosDir, androidDir, capacitorCliBin, shopifyThemeDir } = getReleasePaths(releaseRootDir);
  const integrityArgs = supervisedVision
    ? supervisedVisionCatalogIntegrityArgs
    : deterministicCatalogIntegrityArgs;
  const verificationIntegrityArgs = process.env.SALT_RELEASE_REUSE_VERIFIED_PLAN === "1"
    ? [...integrityArgs, "--reuse-prior-manifest"]
    : integrityArgs;
  // The final gate still fetches current Shopify products, collections, and
  // memberships. Reuse only the already verified classification plan so the
  // release does not score the full catalog a second time after step 11.
  const finalIntegrityArgs = process.env.SALT_RELEASE_REUSE_VERIFIED_PLAN === "1"
    ? [...verificationIntegrityArgs]
    : [...integrityArgs];

  return [
    {
      label: "Verify trained 256M-record catalog knowledge model",
      command: npmBin,
      args: ["run", "catalog:knowledge:model:verify"],
      cwd: releaseRootDir,
    },
    {
      label: "Verify approved catalog taxonomy release",
      command: nodeBin,
      args: ["scripts/catalog-taxonomy-approval.mjs"],
      cwd: releaseRootDir,
    },
    {
      label: "Refresh Shopify data",
      command: npmBin,
      args: ["run", "sync:data"],
      cwd: releaseRootDir,
    },
    {
      label: "Dry-run active low-stock product removal",
      command: npmBin,
      args: ["run", "shopify:products:low-stock:dry-run"],
      cwd: releaseRootDir,
    },
    {
      label: "Apply approved active low-stock product removal with live readback",
      command: npmBin,
      args: ["run", "shopify:products:low-stock:apply"],
      cwd: releaseRootDir,
    },
    {
      label: "Verify active low-stock product removal",
      command: npmBin,
      args: ["run", "shopify:products:low-stock:verify"],
      cwd: releaseRootDir,
    },
    {
      label: "Read live Shopify tag inventory",
      command: npmBin,
      args: ["run", "catalog:tags:fetch"],
      cwd: releaseRootDir,
    },
    {
      label: "Regenerate catalog taxonomy and preserved-tag audit",
      command: npmBin,
      args: ["run", "catalog:taxonomy:audit"],
      cwd: releaseRootDir,
    },
    {
      label: "Validate refreshed catalog taxonomy",
      command: npmBin,
      args: ["run", "catalog:taxonomy:validate"],
      cwd: releaseRootDir,
    },
    {
      label: "Build visual taxonomy review queue",
      command: npmBin,
      args: ["run", "catalog:image-review:build"],
      cwd: releaseRootDir,
    },
    {
      label: "Require image-backed taxonomy evidence",
      command: npmBin,
      args: ["run", "catalog:image-review:validate"],
      cwd: releaseRootDir,
    },
    {
      label: "Dry-run exact full-catalog collection reconciliation",
      command: npmBin,
      args: ["run", "shopify:catalog-integrity:dry-run", "--", ...integrityArgs],
      cwd: releaseRootDir,
    },
    {
      label: "Apply exact full-catalog collection reconciliation",
      command: npmBin,
      args: ["run", "shopify:catalog-integrity:apply", "--", ...integrityArgs],
      cwd: releaseRootDir,
    },
    ...(supervisedVision ? [{
      label: "Automatically clear visual classification review with guarded evidence",
      command: nodeBin,
      args: [resolve(releaseRootDir, "scripts", "auto-resolve-catalog-visual-review.mjs")],
      cwd: releaseRootDir,
    }] : []),
    {
      label: "Refresh Shopify data after collection reconciliation",
      command: npmBin,
      args: ["run", "sync:data"],
      cwd: releaseRootDir,
    },
    {
      label: "Ensure Shopify product metafield definitions",
      command: npmBin,
      args: ["run", "shopify:product-metafields:ensure"],
      cwd: releaseRootDir,
    },
    {
      label: "Dry-run products with missing live Shopify variant costs",
      command: npmBin,
      args: ["run", "shopify:products:missing-cost:dry-run"],
      cwd: releaseRootDir,
    },
    {
      label: "Apply approved missing-cost product removal with live readback",
      command: npmBin,
      args: ["run", "shopify:products:missing-cost:apply"],
      cwd: releaseRootDir,
    },
    {
      label: "Verify missing-cost product removal",
      command: npmBin,
      args: ["run", "shopify:products:missing-cost:verify"],
      cwd: releaseRootDir,
    },
    {
      label: "Dry-run approved nominal market pricing before base SEO",
      command: npmBin,
      args: ["run", "shopify:price-rework:dry-run"],
      cwd: releaseRootDir,
    },
    {
      label: "Apply approved nominal market pricing before base SEO",
      command: npmBin,
      args: ["run", "shopify:price-rework:apply"],
      cwd: releaseRootDir,
    },
    {
      label: "Verify live full-catalog nominal market pricing before base SEO",
      command: npmBin,
      args: ["run", "shopify:price-rework:verify"],
      cwd: releaseRootDir,
    },
    {
      label: "Dry-run same-product variant cost-price alignment",
      command: npmBin,
      args: ["run", "shopify:variant-cost-price:dry-run"],
      cwd: releaseRootDir,
    },
    {
      label: "Apply same-product variant cost-price alignment",
      command: npmBin,
      args: ["run", "shopify:variant-cost-price:apply"],
      cwd: releaseRootDir,
    },
    {
      label: "Verify same-product variant cost-price alignment",
      command: npmBin,
      args: ["run", "shopify:variant-cost-price:verify"],
      cwd: releaseRootDir,
    },
    {
      label: "Build evidence-first product SEO JSON artifact",
      command: npmBin,
      args: ["run", "catalog:seo:build"],
      cwd: releaseRootDir,
    },
    {
      label: "Run local SEO and product-content quality audit",
      command: npmBin,
      args: ["run", "shopify:seo:local-review"],
      cwd: releaseRootDir,
    },
    {
      label: "Dry-run final evidence-first Shopify product SEO artifact",
      command: npmBin,
      args: ["run", "shopify:seo:final:dry-run"],
      cwd: releaseRootDir,
    },
    {
      label: "Apply final evidence-first Shopify product SEO with live readback",
      command: npmBin,
      args: ["run", "shopify:seo:final"],
      cwd: releaseRootDir,
    },
    {
      label: "Apply approved taxonomy tags and metafields with live readback",
      command: npmBin,
      args: ["run", "shopify:taxonomy:apply"],
      cwd: releaseRootDir,
    },
    {
      label: "Fetch Future Light live variant and image evidence for ChatGPT review",
      command: npmBin,
      args: ["run", "shopify:variants:options:media"],
      cwd: releaseRootDir,
    },
    {
      label: "Build Future Light ChatGPT visual variant and image review queue",
      command: npmBin,
      args: ["run", "shopify:variants:visual:queue"],
      cwd: releaseRootDir,
    },
    {
      label: "Prepare guarded held-image repair plan",
      command: npmBin,
      args: ["run", "shopify:images:recreate:draft:plan"],
      cwd: releaseRootDir,
    },
    {
      label: "Prepare native Image Gen queue for held-image repairs",
      command: npmBin,
      args: ["run", "shopify:images:recreate:queue"],
      cwd: releaseRootDir,
    },
    {
      label: "Generate identity-preserving held-image candidates with Image Gen",
      command: npmBin,
      args: ["run", "shopify:images:recreate:generate"],
      cwd: releaseRootDir,
    },
    {
      label: "Sync generated held-image candidates into the unapproved draft",
      command: npmBin,
      args: ["run", "shopify:images:recreate:draft:sync"],
      cwd: releaseRootDir,
    },
    {
      label: "Sanitize stale Image Gen candidates against current visual holds",
      command: npmBin,
      args: ["run", "shopify:images:recreate:draft:sanitize"],
      cwd: releaseRootDir,
    },
    {
      label: "Validate identity-safe Image Gen replacement candidates",
      command: npmBin,
      args: ["run", "shopify:images:recreate:draft:validate"],
      cwd: releaseRootDir,
    },
    {
      label: "Reconcile approved held-image replacements with live media and variant evidence",
      command: npmBin,
      args: ["run", "shopify:images:recreate:mapping:live-audit"],
      cwd: releaseRootDir,
    },
    {
      label: "Require complete ChatGPT visual variant and image decisions",
      command: npmBin,
      args: ["run", "shopify:variants:visual:check"],
      cwd: releaseRootDir,
    },
    {
      label: "Apply approved ChatGPT visual variant and image decisions with live readback",
      command: npmBin,
      args: ["run", "shopify:variants:visual:apply"],
      cwd: releaseRootDir,
    },
    {
      label: "Delete verified active zero-image products",
      command: npmBin,
      args: ["run", "shopify:products:zero-images:apply"],
      cwd: releaseRootDir,
    },
    {
      label: "Publish every active product to all sales channels",
      command: npmBin,
      args: ["run", "shopify:publications:all:apply"],
      cwd: releaseRootDir,
    },
    {
      label: "Refresh Shopify data after final product publication",
      command: npmBin,
      args: ["run", "sync:data"],
      cwd: releaseRootDir,
    },
    {
      label: "Apply all-active-catalog product categories and merchandising metafields",
      command: npmBin,
      args: ["run", "shopify:product-metafields:backfill:all-active"],
      cwd: releaseRootDir,
    },
    {
      label: "Refresh Shopify data after merchandising backfill",
      command: npmBin,
      args: ["run", "sync:data"],
      cwd: releaseRootDir,
    },
    {
      label: "Repair known short Future Light SEO descriptions with live readback",
      command: npmBin,
      args: ["run", "shopify:product-specificity:repair"],
      cwd: releaseRootDir,
    },
    {
      label: "Verify every active product has product-specific SEO and metafields",
      command: npmBin,
      args: ["run", "shopify:product-specificity:verify"],
      cwd: releaseRootDir,
    },
    {
      label: "Verify live Shopify SEO matches the final Future Light product artifact",
      command: npmBin,
      args: ["run", "shopify:product-seo:live-parity"],
      cwd: releaseRootDir,
    },
    {
      label: "Verify exact collection membership and price rules",
      command: npmBin,
      args: ["run", "shopify:catalog-integrity:verify", "--", ...verificationIntegrityArgs],
      cwd: releaseRootDir,
    },
    {
      label: "Verify Shopify merchandising backfill",
      command: npmBin,
      args: ["run", "shopify:merchandising:verify"],
      cwd: releaseRootDir,
    },
    {
      label: "Validate final catalog taxonomy snapshot",
      command: npmBin,
      args: ["run", "catalog:taxonomy:validate"],
      cwd: releaseRootDir,
    },
    {
      label: "Build web app",
      command: npmBin,
      args: ["run", "build:web:release"],
      cwd: releaseRootDir,
    },
    {
      label: "Generate Shopify theme bundle",
      command: npmBin,
      args: ["run", "theme:bundle:release", "--", "--out", shopifyThemeDir],
      cwd: releaseRootDir,
    },
    {
      label: "Dry-run approved similar-purpose collection merges",
      command: npmBin,
      args: ["run", "shopify:collection-merges:dry-run"],
      cwd: releaseRootDir,
    },
    {
      label: "Apply approved similar-purpose collection merges with live readback",
      command: npmBin,
      args: ["run", "shopify:collection-merges:apply:approved"],
      cwd: releaseRootDir,
    },
    {
      label: "Verify Future Light managed tag cleanup is out of scope",
      command: nodeBin,
      args: ["-e", "process.stdout.write('Future Light Store: legacy cross-store tag cleanup is intentionally disabled.\\n')"],
      cwd: releaseRootDir,
    },
    {
      label: "Verify Future Light managed collection cleanup is out of scope",
      command: nodeBin,
      args: ["-e", "process.stdout.write('Future Light Store: legacy cross-store collection cleanup is intentionally disabled.\\n')"],
      cwd: releaseRootDir,
    },
    {
      label: "Confirm no cross-store cleanup process is launched",
      command: nodeBin,
      args: ["-e", "process.stdout.write('Future Light Store: no cross-store cleanup process launched.\\n')"],
      cwd: releaseRootDir,
    },
    {
      label: "Verify variant-aware SEO profiles for every active variant",
      command: npmBin,
      args: ["run", "shopify:variant-seo:verify"],
      cwd: releaseRootDir,
    },
    {
      label: "Dry-run daily manual collection shuffle",
      command: npmBin,
      args: ["run", "shopify:collections:shuffle:dry-run"],
      cwd: releaseRootDir,
    },
    {
      label: "Apply daily manual collection shuffle with live readback",
      command: npmBin,
      args: ["run", "shopify:collections:shuffle:apply"],
      cwd: releaseRootDir,
    },
    {
      label: "Verify daily manual collection shuffle",
      command: npmBin,
      args: ["run", "shopify:collections:shuffle:verify"],
      cwd: releaseRootDir,
    },
    {
      label: "Final live-readback gate after tag cleanup and collection merges",
      command: npmBin,
      args: ["run", "shopify:catalog-integrity:verify", "--", ...finalIntegrityArgs],
      cwd: releaseRootDir,
    },
    ...(includeMobile ? [
      {
        label: "Sync iOS Capacitor shell",
        command: nodeBin,
        args: [resolve(releaseRootDir, "scripts", "sync-capacitor-local.mjs"), "ios"],
        cwd: releaseRootDir,
      },
      {
        label: "Sync Android Capacitor shell",
        command: nodeBin,
        args: [resolve(releaseRootDir, "scripts", "sync-capacitor-local.mjs"), "android"],
        cwd: releaseRootDir,
      },
    ] : []),
  ];
}

function buildProductReleaseSteps({
  releaseRootDir = rootDir,
  includeMobile = process.env.SALT_RELEASE_SKIP_MOBILE !== "1",
} = {}) {
  const {
    iosDir,
    androidDir,
    capacitorCliBin,
    shopifyThemeDir,
  } = getReleasePaths(releaseRootDir);
  const cohortCatalogArg = "output/new-product-cohort-catalog.json";
  const cohortHandlesArg = "output/new-product-cohort-handles.json";

  return [
    {
      label: "Run frozen new-product SEO, metafield, and mapping pipeline",
      command: npmBin,
      args: [
        "run",
        "seo:new-products:apply",
        "--",
        "--frozen-catalog",
        cohortCatalogArg,
        "--product-handles-file",
        cohortHandlesArg,
      ],
      cwd: releaseRootDir,
    },
    {
      label: "Delete verified zero-image products in the new cohort",
      command: npmBin,
      args: ["run", "shopify:products:zero-images:apply", "--", "--product-handles-file", cohortHandlesArg],
      cwd: releaseRootDir,
    },
    {
      label: "Publish new-cohort products to all sales channels",
      command: npmBin,
      args: ["run", "shopify:publications:all:apply", "--", "--product-handles-file", cohortHandlesArg],
      cwd: releaseRootDir,
    },
    {
      label: "Build web app",
      command: npmBin,
      args: ["run", "build:web:release"],
      cwd: releaseRootDir,
    },
    {
      label: "Generate Shopify theme bundle",
      command: npmBin,
      args: ["run", "theme:bundle:release", "--", "--out", shopifyThemeDir],
      cwd: releaseRootDir,
    },
    ...(includeMobile ? [
      {
        label: "Sync iOS Capacitor shell",
        command: nodeBin,
        args: [capacitorCliBin, "sync", "ios"],
        cwd: iosDir,
      },
      {
        label: "Sync Android Capacitor shell",
        command: nodeBin,
        args: [capacitorCliBin, "sync", "android"],
        cwd: androidDir,
      },
    ] : []),
  ];
}

export function buildReleaseSteps({
  rootDir: releaseRootDir = rootDir,
  includeMobile = process.env.SALT_RELEASE_SKIP_MOBILE !== "1",
  profile = "catalog",
} = {}) {
  if (profile === "products") {
    return buildProductReleaseSteps({ releaseRootDir, includeMobile });
  }

  if (!["catalog", "daily"].includes(profile)) {
    throw new Error(`Invalid release profile ${profile}; expected catalog, daily, or products`);
  }

  return buildCatalogReleaseSteps({
    releaseRootDir,
    includeMobile,
    supervisedVision: ["catalog", "daily"].includes(profile) && process.env.SALT_CATALOG_VISION_SUPERVISED === "1",
  });
}

function parseArgs(argv) {
  const args = {
    profile: process.env.SALT_RELEASE_PROFILE || "catalog",
    resume: process.env.SALT_RELEASE_RESUME === "1",
    fresh: false,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === "--profile") {
      if (!next) {
        throw new Error("Missing value for --profile");
      }
      args.profile = next;
      index += 1;
      continue;
    }

    if (token === "--product-release" || token === "--products-only") {
      args.profile = "products";
      continue;
    }

    if (token === "--catalog-release") {
      args.profile = "catalog";
      continue;
    }

    if (token === "--resume") {
      args.resume = true;
      continue;
    }

    if (token === "--fresh") {
      args.fresh = true;
    }
  }

  if (args.resume && args.fresh) {
    throw new Error("Release cannot use --resume and --fresh together");
  }

  if (!["catalog", "daily", "products"].includes(args.profile)) {
    throw new Error(`Invalid release profile ${args.profile}; expected catalog, daily, or products`);
  }

  return args;
}

async function main() {
  let args = { profile: process.env.SALT_RELEASE_PROFILE || "catalog" };
  let heartbeatTimer;
  const invocationStartedAt = Date.now();
  try {
    args = parseArgs(process.argv);
    await acquireReleaseOwnerLock(args.profile);
    if (args.resume) {
      process.env.SALT_VARIANT_IMAGE_RESUME = "1";
    }
    let previousRunState = null;
    if (args.resume) {
      previousRunState = await readReleaseRunState(args.profile);
      if (!previousRunState) {
        throw new Error(`Cannot resume release: no readable run state at ${releaseRunStatePath}`);
      }
      if (!previousRunState || !["failed", "running", "waiting_for_network"].includes(previousRunState.status)) {
        throw new Error(`Cannot resume release: run state is ${previousRunState?.status || "missing"}, not failed or interrupted`);
      }
      if (!areCompatibleReleaseProfiles(previousRunState.profile, args.profile)) {
        throw new Error(`Cannot resume ${args.profile} release from ${previousRunState.profile} run state`);
      }
      const previousPid = Number(previousRunState.pid || 0);
      if (previousRunState.status === "running" && previousPid > 0 && previousPid !== process.pid && isProcessAlive(previousPid)) {
        throw new Error(`Cannot resume while release process ${previousPid} is still running`);
      }
    }
    let requestedResumeFromStep = args.resume
      ? Math.max(1, Number(previousRunState?.stepIndex || previousRunState?.completedStepIndex || 1))
      : 1;
    releaseRunState = {
      status: "running",
      pid: process.pid,
      profile: args.profile,
      startedAt: new Date().toISOString(),
      stepIndex: requestedResumeFromStep - (args.resume ? 0 : 1),
      totalSteps: 0,
      stepLabel: "initializing",
      heartbeatAt: new Date().toISOString(),
      resumed: args.resume,
      resumedFromStep: args.resume ? requestedResumeFromStep : null,
      fresh: args.fresh,
      completedSteps: args.resume && Array.isArray(previousRunState?.completedSteps)
        ? previousRunState.completedSteps
        : [],
    };
    releaseRunStateOwned = true;
    await writeReleaseRunState();
    heartbeatTimer = setInterval(() => {
      void writeReleaseRunState().catch(() => {});
    }, releaseHeartbeatMs);
    heartbeatTimer.unref?.();

    const packageJson = JSON.parse(await readFile(resolve(rootDir, "package.json"), "utf8"));
    const { shopifyThemeDir } = getReleasePaths(rootDir);
    const viteVersion = require("vite/package.json").version;
    const capacitorCliVersion = process.env.SALT_RELEASE_SKIP_MOBILE === "1"
      ? "skipped"
      : require("@capacitor/cli/package.json").version;
    const npmVersion = execFileSync(npmBin, ["--version"], { encoding: "utf8" }).trim();
    await mkdir(shopifyThemeDir, { recursive: true });

    process.stdout.write(`${releaseName} release workflow\n`);
    process.stdout.write(`  app: ${packageJson.version}\n`);
    process.stdout.write(`  node: ${process.version}\n`);
    process.stdout.write(`  npm: ${npmVersion}\n`);
    process.stdout.write(`  vite: ${viteVersion}\n`);
    process.stdout.write(`  capacitor-cli: ${capacitorCliVersion}\n`);
    process.stdout.write(`  shopify-theme: ${shopifyThemeDir}\n`);
    process.stdout.write(`  mobile-sync: ${process.env.SALT_RELEASE_SKIP_MOBILE === "1" ? "skipped" : "included"}\n`);
    process.stdout.write(`  profile: ${args.profile}\n`);
    process.stdout.write(`  execution: ${args.resume ? `resume from step ${requestedResumeFromStep}` : args.fresh ? "fresh run" : "guarded run"}\n`);

    if (args.profile === "products") {
      const { productCohortCatalog, productCohortHandles } = getReleasePaths(rootDir);
      await ensurePathExists(productCohortCatalog, "new-product cohort catalog");
      await ensurePathExists(productCohortHandles, "new-product cohort handles");
      process.stdout.write(`  product-cohort: ${productCohortHandles}\n`);
    }

    const steps = buildReleaseSteps({ rootDir, profile: args.profile });
    if (args.resume) {
      const resumeResolution = resolveResumeStep(steps, previousRunState, requestedResumeFromStep);
      if (resumeResolution.error) {
        throw new Error(
          `${resumeResolution.error} Use --fresh after reviewing the changed release graph.`,
        );
      }
      if (resumeResolution.migrated || previousRunState?.totalSteps !== steps.length) {
        process.stdout.write(
          `Migrating resumable release checkpoint from ${previousRunState?.totalSteps || "unknown"} to ${steps.length} steps by label at ${resumeResolution.priorStepLabel || "the saved numeric checkpoint"}.\n`,
        );
      }
      requestedResumeFromStep = resumeResolution.resumeFromStep;
    }
    if (requestedResumeFromStep > steps.length) {
      throw new Error(`Cannot resume from step ${requestedResumeFromStep}; release has ${steps.length} steps`);
    }
    if (args.resume && previousRunState?.stepFingerprint) {
      const currentStepFingerprint = releaseStepFingerprint(steps[requestedResumeFromStep - 1], args.profile);
      const compatibleProfileChange = previousRunState.profile &&
        previousRunState.profile !== args.profile &&
        areCompatibleReleaseProfiles(previousRunState.profile, args.profile);
      if (currentStepFingerprint !== previousRunState.stepFingerprint && !compatibleProfileChange) {
        throw new Error(
          `Cannot resume safely: step ${requestedResumeFromStep} changed since the prior run. Use --fresh after reviewing the changed step.`,
        );
      }
      if (compatibleProfileChange) {
        process.stdout.write(`Compatible ${previousRunState.profile}->${args.profile} profile resume accepted by step label; guarded commands remain unchanged.\n`);
      }
    }
    let resumeFromStep = requestedResumeFromStep;
    let resumeRepair = null;
    const repairRoute = args.resume
      ? getReleaseRepairRoute(steps, previousRunState, requestedResumeFromStep)
      : null;
    if (repairRoute && repairRoute.fromStep < resumeFromStep) {
      resumeFromStep = repairRoute.fromStep;
      resumeRepair = repairRoute;
      process.stdout.write(`${repairRoute.message}`);
    }
    await writeReleaseRunState({
      totalSteps: steps.length,
      resumedFromStep: args.resume ? resumeFromStep : null,
      resumeRepair,
    });

    if (args.profile !== "products" && process.env.FUTURE_LIGHT_RELEASE_SKIP_PROACTIVE_DIAGNOSTICS !== "1") {
      process.stdout.write("Running Future Light Store deterministic release preflight and collection-rule standby audit.\n");
      await runProactiveDiagnostic("preflight");
      await runProactiveDiagnostic("collection");
    }

    for (const [index, step] of steps.entries()) {
      const stepIndex = index + 1;
      const fingerprint = releaseStepFingerprint(step, args.profile);
      if (stepIndex < resumeFromStep) {
        process.stdout.write(`[reuse] ${stepIndex}/${steps.length} ${step.label}\n`);
        continue;
      }
      await writeReleaseRunState({
        stepIndex,
        stepLabel: step.label,
        stepFingerprint: fingerprint,
      });
      const stepStartedAt = Date.now();
      await runStage({
        ...step,
        index: stepIndex,
        total: steps.length,
      });

      if (step.label === "Build web app") {
        await ensurePathExists(resolve(rootDir, "dist", "index.html"), "Vite build output");
      }
      if (step.label === "Apply full-catalog Shopify SEO and product-field reconciliation with live readback") {
        await runProactiveDiagnostic("seo");
      }
      if (step.label === "Final live-readback gate after tag cleanup and collection merges") {
        await runProactiveDiagnostic("visual");
        await runProactiveDiagnostic("postflight");
      }
      const completedSteps = [
        ...(Array.isArray(releaseRunState.completedSteps) ? releaseRunState.completedSteps : []),
        {
          index: stepIndex,
          label: step.label,
          fingerprint,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - stepStartedAt,
        },
      ].filter((entry, entryIndex, entries) => entries.findIndex((candidate) => candidate.index === entry.index) === entryIndex);
      await writeReleaseRunState({
        completedStepIndex: stepIndex,
        completedStepFingerprint: fingerprint,
        completedSteps,
      });
    }

    const finalIntegrityManifestPath = resolve(rootDir, "output", "shopify-catalog-integrity-manifest.json");
    try {
      const finalIntegrityManifest = JSON.parse(await readFile(finalIntegrityManifestPath, "utf8"));
      const classificationReviewRemaining = Number(finalIntegrityManifest?.summary?.classificationReviewRemaining || 0);
      if (classificationReviewRemaining > 0) {
        throw new Error(
          `Release completion blocked: ${classificationReviewRemaining} active product(s) remain in classification-review. Inspect output/catalog-visual-review-queue.json and resume after visual decisions.`,
        );
      }
    } catch (error) {
      if (error?.message?.startsWith("Release completion blocked:")) throw error;
      throw new Error(`Release completion blocked: final catalog integrity manifest is missing or unreadable at ${finalIntegrityManifestPath}.`);
    }

    await writeReleaseRunState({
      status: "completed",
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - invocationStartedAt,
      stepLabel: "complete",
    });
    process.stdout.write(`\nRelease complete in ${Math.round((Date.now() - invocationStartedAt) / 1000)}s.\n`);
  } catch (error) {
    if (releaseRunStateOwned) {
      await writeReleaseRunState({
        status: "failed",
        failedAt: new Date().toISOString(),
        error: error?.message || String(error),
      });
    }
    throw error;
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    await releaseOwnerLock();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(`\n${error.message}`);
    process.exit(1);
  });
}
