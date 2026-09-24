import {
  appendSocialEvent,
  appendSocialJournal,
  clearBrowserIntent,
  clearBrowserResult,
  clearImageGenFiles,
  recordUsage,
  writeSocialState,
} from "./vs-store-social-state.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  readBrowserIntent,
  validateBrowserRequest,
  validateBrowserIntent,
  validateBrowserResult,
} from "./vs-store-social-browser-result-schema.mjs";

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function receiptForHistory(receipt) {
  return {
    id: normalizeText(receipt?.id) || null,
    url: normalizeText(receipt?.url) || null,
    observedAt: receipt?.observedAt || null,
    evidencePath: receipt?.evidencePath || null,
  };
}

function anyPublished(platforms) {
  return Object.values(platforms || {}).some((receipt) => receipt?.status === "published");
}

function couponState(state, offer) {
  if (!offer?.code || offer.status !== "verified") return state.couponRegistry || {};
  return {
    ...(state.couponRegistry || {}),
    [offer.code]: {
      discountId: offer.discountId,
      code: offer.code,
      percent: offer.percent,
      targetType: offer.target?.type || null,
      startsAt: offer.startsAt,
      endsAt: offer.endsAt,
    },
  };
}

export async function reconcileBrowserResult({ rootDir, config, state, request, result }) {
  const intent = await readBrowserIntent(config);
  validateBrowserRequest(request, config, { allowExpired: Boolean(intent) });
  await validateBrowserResult(result, request, config);
  const pending = state.pending;
  if (!pending || pending.runKey !== request.runKey)
    throw new Error("Browser result does not match the current pending social run.");
  if (pending.browserRequestFingerprint && pending.browserRequestFingerprint !== request.fingerprint)
    throw new Error("Current state and browser request fingerprints do not match.");
  if (pending.browserAttemptId && pending.browserAttemptId !== result.attemptId)
    throw new Error("Browser result attempt ID does not match the durable submit intent.");
  if (intent) {
    validateBrowserIntent(intent, request);
    if (intent.attemptId !== result.attemptId)
      throw new Error("Browser result attempt ID does not match the browser intent file.");
  }

  const facebook = result.platforms.facebook;
  const instagram = result.platforms.instagram;
  const publishedAt =
    result.verifiedAt ||
    facebook.observedAt ||
    instagram.observedAt ||
    new Date().toISOString();
  const published = anyPublished(result.platforms);
  const historyEntry = {
    runKey: request.runKey,
    kind: pending.content?.kind || null,
    variant: pending.content?.variant || null,
    slot: pending.content?.slot || null,
    weekday: pending.content?.weekday || null,
    weekKey: pending.content?.weekKey || null,
    handle: pending.content?.handle || null,
    title: pending.content?.title || "VS Store social post",
    selectedAt: pending.selectedAt || new Date().toISOString(),
    publishedAt,
    postId: normalizeText(facebook.id) || null,
    postUrl: normalizeText(facebook.url) || null,
    instagramPostId: normalizeText(instagram.id) || null,
    instagramPostUrl: normalizeText(instagram.url) || null,
    instagramPost: instagram.status === "published" ? receiptForHistory(instagram) : null,
    image: {
      path: request.imagePath,
      mode: pending.imageMode || "imagegen",
      sha256: request.imageSha256,
    },
    captionSha256: request.captionSha256,
    offer:
      pending.offerPlan?.status === "verified"
        ? {
            code: pending.offerPlan.code,
            percent: pending.offerPlan.percent,
            discountId: pending.offerPlan.discountId,
          }
        : null,
    executionPath: "business-suite-browser",
    attemptId: result.attemptId,
    deliveryStatus: result.status,
    platformStates: result.platforms,
  };
  const usageState = published
    ? recordUsage(state, {
        kind: pending.content?.kind,
        handle: pending.content?.handle,
        usedAt: publishedAt,
        weekKey: pending.content?.weekKey,
      })
    : state;
  const destinations = {
    ...(usageState.destinations || {}),
    facebook: {
      ...(usageState.destinations?.facebook || { required: true }),
      status: facebook.status,
      lastPostId: normalizeText(facebook.id) || usageState.destinations?.facebook?.lastPostId || null,
      lastPostUrl: normalizeText(facebook.url) || usageState.destinations?.facebook?.lastPostUrl || null,
    },
    instagram: {
      ...(usageState.destinations?.instagram || { required: true }),
      status: instagram.status,
      required: true,
      username: request.instagramHandle,
      lastPostId:
        normalizeText(instagram.id) || usageState.destinations?.instagram?.lastPostId || null,
      lastPostUrl:
        normalizeText(instagram.url) || usageState.destinations?.instagram?.lastPostUrl || null,
    },
  };
  const nextStatus =
    result.status === "success"
      ? "completed"
      : result.status === "partial"
        ? "partial_published"
        : result.status === "failed"
          ? "failed"
          : "needs_review";
  const nextState = {
    ...usageState,
    publisher: "business-suite-browser",
    status: nextStatus,
    lastRunKey: result.status === "success" ? request.runKey : usageState.lastRunKey,
    lastOffer:
      pending.offerPlan?.status === "verified"
        ? {
            createdAt: pending.offerPlan.startsAt,
            startsAt: pending.offerPlan.startsAt,
            endsAt: pending.offerPlan.endsAt,
            code: pending.offerPlan.code,
            percent: pending.offerPlan.percent,
            discountId: pending.offerPlan.discountId,
            target: pending.offerPlan.target,
          }
        : usageState.lastOffer,
    couponRegistry: couponState(usageState, pending.offerPlan),
    platformStates: result.platforms,
    destinations,
    pending: result.status === "success"
      ? null
      : {
          ...pending,
          browserResultPath: config.socialOutputDir + "/browser-result.json",
          browserAttemptId: result.attemptId,
          platformStates: result.platforms,
          nextRetryAt:
            result.status === "partial" &&
            Object.values(result.platforms).some((platform) => platform.status === "known_failed")
              ? new Date(Date.now() + 15 * 60_000).toISOString()
              : pending.nextRetryAt || null,
        },
    history: published
      ? [historyEntry, ...(Array.isArray(usageState.history) ? usageState.history : [])].slice(0, 90)
      : usageState.history || [],
    error:
      result.status === "success"
        ? null
        : normalizeText(result.error || result.reason || `Browser result status: ${result.status}`),
  };
  await writeSocialState(rootDir, nextState);
  await appendSocialEvent(rootDir, {
    type: `browser_${result.status}`,
    runKey: request.runKey,
    attemptId: result.attemptId,
    facebookStatus: facebook.status,
    instagramStatus: instagram.status,
    postId: normalizeText(facebook.id) || null,
    instagramPostId: normalizeText(instagram.id) || null,
  });
  await appendSocialJournal(rootDir, {
    type: "browser_result_reconciled",
    runKey: request.runKey,
    attemptId: result.attemptId,
    status: result.status,
    facebookStatus: facebook.status,
    instagramStatus: instagram.status,
  });
  const archiveDir = resolve(config.socialOutputDir, "runs", request.runKey, "browser-results");
  await mkdir(archiveDir, { recursive: true });
  await writeFile(
    resolve(archiveDir, `${result.attemptId}.json`),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
  if (intent) {
    await writeFile(
      resolve(archiveDir, `${result.attemptId}-intent.json`),
      `${JSON.stringify(intent, null, 2)}\n`,
      "utf8",
    );
  }
  await clearBrowserIntent(rootDir);
  await clearBrowserResult(rootDir);
  if (result.status === "success") await clearImageGenFiles(rootDir);
  return { state: nextState, historyEntry: published ? historyEntry : null };
}
