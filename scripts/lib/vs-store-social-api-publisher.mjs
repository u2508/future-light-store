// API-primary dual-platform publisher. It owns the Meta submission state until
// both independent Facebook and Instagram readbacks are verified. Browser
// publishing is a separate, explicitly selected transport.

import { createHash, randomUUID } from "node:crypto";

import {
  appendSocialEvent,
  appendSocialJournal,
  clearImageGenFiles,
  recordUsage,
  writeSocialState,
} from "./vs-store-social-state.mjs";
import { createVsStoreMetaClient } from "./vs-store-social-meta.mjs";
import { isSocialNetworkError } from "./vs-store-social-network.mjs";

export const META_API_PLATFORMS = Object.freeze(["facebook", "instagram"]);

export function browserPendingMigrationBlocker({
  stateStatus,
  pending,
  request,
  intent,
  result,
  platformStates,
  hasExternalAttempt = false,
  facebookPageId,
  instagramHandle,
}) {
  if (stateStatus !== "waiting_for_browser" || !pending?.browserRequestPath)
    return "the run is not an active browser handoff";
  if (
    !request ||
    request.runKey !== pending.runKey ||
    request.fingerprint !== pending.browserRequestFingerprint ||
    request.facebookPageId !== facebookPageId ||
    request.instagramHandle !== instagramHandle
  )
    return "the browser request does not match this run and account pair";
  if (intent || result || pending.browserAttemptId || pending.browserIntentFingerprint)
    return "a browser submit intent or result already exists";
  if (hasExternalAttempt) return "an external submit is present in the durable journal";
  const states = pending.platformStates || platformStates || {};
  if (
    META_API_PLATFORMS.some(
      (platform) => (states[platform]?.status || "not_started") !== "not_started",
    )
  )
    return "a destination is not untouched";
  return null;
}

export function isMetaApiPublishWindowPending(
  scheduledAt,
  { now = new Date(), toleranceMs = 2 * 60_000 } = {},
) {
  const scheduledAtMs =
    scheduledAt instanceof Date ? scheduledAt.getTime() : Date.parse(String(scheduledAt || ""));
  return Number.isFinite(scheduledAtMs) && scheduledAtMs > now.getTime() + toleranceMs;
}

export function resolveMetaPagePostId(response) {
  return normalizeText(response?.post_id || response?.id);
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function sha256Text(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function safeAttemptId(runKey) {
  return `meta-api-${runKey}-${randomUUID()}`;
}

function errorClass(error) {
  if (error?.retryable || error?.code === "ETIMEDOUT" || error?.code === "EAI_AGAIN")
    return "unknown";
  if (
    /timeout|timed out|network|socket|dns|temporar|unavailable|gateway/i.test(
      String(error?.message || error),
    )
  )
    return "unknown";
  return "known_failed";
}

function platformState(status, extra = {}) {
  return { status, ...extra };
}

function platformStatesFor(pending) {
  return Object.fromEntries(
    META_API_PLATFORMS.map((platform) => [
      platform,
      {
        ...(pending?.platformStates?.[platform] || {}),
        status: pending?.platformStates?.[platform]?.status || "not_started",
      },
    ]),
  );
}

export function metaApiRetryPlan(pending, status) {
  if (!pending?.platformStates) return { platforms: [...META_API_PLATFORMS] };
  if (status === "failed") return { blocked: true, reason: "previous Meta API attempt failed" };
  const entries = META_API_PLATFORMS.map((platform) => [
    platform,
    pending.platformStates?.[platform]?.status || "not_started",
  ]);
  const uncertain = entries.filter(([, value]) => ["submit_intent", "unknown"].includes(value));
  if (uncertain.length) {
    return {
      blocked: true,
      reason: `platform outcome requires reconciliation: ${uncertain
        .map(([platform, value]) => `${platform}=${value}`)
        .join(", ")}`,
    };
  }
  const platforms = entries
    .filter(([, value]) => value !== "published")
    .map(([platform]) => platform);
  return platforms.length
    ? { platforms }
    : { blocked: true, reason: "all Meta API destinations are already published" };
}

function publishedCount(platformStates) {
  return META_API_PLATFORMS.filter((platform) => platformStates[platform]?.status === "published")
    .length;
}

function nextRetryAt() {
  return new Date(Date.now() + 15 * 60_000).toISOString();
}

async function writeApiAttemptState({
  rootDir,
  state,
  pending,
  platformStates,
  status,
  error = null,
}) {
  return writeSocialState(rootDir, {
    ...state,
    publisher: "meta-api",
    status,
    error: error ? normalizeText(error) : null,
    platformStates,
    pending: {
      ...pending,
      publisher: "meta-api",
      platformStates,
    },
  });
}

function historyEntry({ pending, request, platformStates, publishedAt, attemptId }) {
  const facebook = platformStates.facebook;
  const instagram = platformStates.instagram;
  return {
    runKey: pending.runKey,
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
    instagramPost:
      instagram.status === "published"
        ? {
            id: normalizeText(instagram.id) || null,
            url: normalizeText(instagram.url) || null,
            observedAt: instagram.observedAt || null,
          }
        : null,
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
    executionPath: "meta-api",
    attemptId,
    deliveryStatus: "success",
    platformStates,
  };
}

function destinationState(state, platformStates, account) {
  const facebook = platformStates.facebook;
  const instagram = platformStates.instagram;
  return {
    ...(state.destinations || {}),
    facebook: {
      ...(state.destinations?.facebook || { required: true }),
      required: true,
      status: facebook.status,
      pageId: facebook.pageId || state.destinations?.facebook?.pageId || null,
      lastPostId: normalizeText(facebook.id) || state.destinations?.facebook?.lastPostId || null,
      lastPostUrl: normalizeText(facebook.url) || state.destinations?.facebook?.lastPostUrl || null,
    },
    instagram: {
      ...(state.destinations?.instagram || { required: true }),
      required: true,
      status: instagram.status,
      accountId: account.id,
      username: account.username,
      lastPostId: normalizeText(instagram.id) || state.destinations?.instagram?.lastPostId || null,
      lastPostUrl:
        normalizeText(instagram.url) || state.destinations?.instagram?.lastPostUrl || null,
    },
  };
}

async function recordPartial({
  rootDir,
  state,
  pending,
  platformStates,
  account,
  attemptId,
  error,
}) {
  const published = publishedCount(platformStates) > 0;
  const status =
    platformStates.facebook.status === "unknown" || platformStates.instagram.status === "unknown"
      ? "needs_review"
      : published
        ? "partial_published"
        : "failed";
  const nextState = await writeApiAttemptState({
    rootDir,
    state: {
      ...state,
      destinations: destinationState(state, platformStates, account),
    },
    pending: {
      ...pending,
      metaApiAttemptId: attemptId,
      nextRetryAt: status === "partial_published" ? nextRetryAt() : null,
    },
    platformStates,
    status,
    error,
  });
  await appendSocialEvent(rootDir, {
    type: `meta_api_${status}`,
    runKey: pending.runKey,
    attemptId,
    facebookStatus: platformStates.facebook.status,
    instagramStatus: platformStates.instagram.status,
  });
  await appendSocialJournal(rootDir, {
    type: "meta_api_result",
    runKey: pending.runKey,
    attemptId,
    status,
    facebookStatus: platformStates.facebook.status,
    instagramStatus: platformStates.instagram.status,
  });
  return { status, state: nextState, platformStates };
}

export async function publishWithMetaApi({
  rootDir,
  config,
  state,
  pendingBase,
  pendingForRun,
  image,
  caption,
  scheduledAt,
  retryPlan,
  now = new Date(),
  retryInfo = [],
}) {
  if (!config.socialLiveEnabled) {
    const error = new Error(
      "Meta API live publishing is disabled; set VS_STORE_SOCIAL_LIVE_ENABLED=1 after preflight.",
    );
    error.code = "META_API_LIVE_DISABLED";
    throw error;
  }
  if (!retryPlan?.platforms?.length)
    throw new Error("Meta API retry plan has no publishable destination.");
  if (isMetaApiPublishWindowPending(scheduledAt, { now })) {
    const error = new Error(
      "Meta API dual publishing requires the runner to execute at the due time; Instagram cannot be scheduled through this API.",
    );
    error.code = "META_API_WAITING_FOR_DUE_SLOT";
    throw error;
  }

  const client = createVsStoreMetaClient(config);
  let preflight;
  try {
    preflight = await client.preflight({ retryInfo });
  } catch (cause) {
    if (isSocialNetworkError(cause)) throw cause;
    const error = new Error(
      `Meta API preflight failed before publishing: ${normalizeText(cause?.message || cause)}`,
    );
    error.code = "META_API_PREFLIGHT_FAILED";
    error.cause = cause;
    throw error;
  }
  if (preflight.status !== "ready") {
    const error = new Error(`Meta API preflight is not ready: ${preflight.reason}`);
    error.code = "META_API_PREFLIGHT_NOT_READY";
    error.preflight = preflight;
    throw error;
  }
  const account = preflight.instagram;
  const attemptId = pendingForRun?.metaApiAttemptId || safeAttemptId(pendingBase.runKey);
  const pending = {
    ...pendingBase,
    publisher: "meta-api",
    metaApiAttemptId: attemptId,
    captionTemplate: caption,
    captionSha256: sha256Text(caption),
    platformStates: platformStatesFor(pendingForRun || pendingBase),
    nextRetryAt: null,
  };
  const platformStates = pending.platformStates;
  const allowed = new Set(retryPlan.platforms);
  for (const platform of META_API_PLATFORMS) {
    if (!allowed.has(platform) && platformStates[platform].status !== "published")
      throw new Error(`Meta API retry plan omitted an unpublished destination: ${platform}`);
  }

  let workingState = await writeApiAttemptState({
    rootDir,
    state,
    pending,
    platformStates,
    status: "publishing",
  });
  await appendSocialEvent(rootDir, {
    type: "meta_api_publish_started",
    runKey: pending.runKey,
    attemptId,
    platforms: retryPlan.platforms,
  });
  await appendSocialJournal(rootDir, {
    type: "meta_api_publish_started",
    runKey: pending.runKey,
    attemptId,
    platforms: retryPlan.platforms,
  });

  let facebookReadback = null;
  if (allowed.has("facebook") && platformStates.facebook.status !== "published") {
    platformStates.facebook = platformState("submit_intent", {
      attemptId,
      intentAt: new Date().toISOString(),
      pageId: config.metaPageId,
    });
    workingState = await writeApiAttemptState({
      rootDir,
      state: workingState,
      pending,
      platformStates,
      status: "publishing",
    });
    try {
      const response = await client.schedulePhoto({
        imagePath: image.path,
        caption,
        scheduledAt: now,
        forceImmediate: true,
        retryInfo,
      });
      const postId = resolveMetaPagePostId(response);
      if (!postId) throw new Error("Meta Page publish response did not include a post ID.");
      facebookReadback = await client.postReadback(postId, { retryInfo });
      if (normalizeText(facebookReadback?.id) !== postId || !facebookReadback?.permalink_url)
        throw new Error("Meta Page readback did not verify the published post.");
      platformStates.facebook = platformState("published", {
        id: postId,
        url: facebookReadback.permalink_url,
        pageId: config.metaPageId,
        captionSha256: sha256Text(caption),
        imageSha256: image.sha256,
        imageUrl: normalizeText(facebookReadback.full_picture) || null,
        observedAt: facebookReadback.created_time || new Date().toISOString(),
      });
      pending.metaPost = {
        id: postId,
        url: facebookReadback.permalink_url,
        imageUrl: normalizeText(facebookReadback.full_picture) || null,
      };
      workingState = await writeApiAttemptState({
        rootDir,
        state: workingState,
        pending,
        platformStates,
        status: "publishing",
      });
    } catch (error) {
      platformStates.facebook = platformState(errorClass(error), {
        attemptId,
        error: normalizeText(error.message),
        reason: errorClass(error) === "unknown" ? normalizeText(error.message) : undefined,
      });
      const result = await recordPartial({
        rootDir,
        state: workingState,
        pending,
        platformStates,
        account,
        attemptId,
        error: normalizeText(error.message),
      });
      return result;
    }
  }

  if (allowed.has("instagram") && platformStates.instagram.status !== "published") {
    const imageUrl =
      config.metaImageSource === "public-url"
        ? config.metaInstagramPublicImageUrl
        : pending.metaPost?.imageUrl || facebookReadback?.full_picture;
    if (!imageUrl) {
      // The Page publish is verified, but Instagram cannot be safely submitted
      // without a stable image source. Treat this as an unknown outcome/setup
      // problem so the autonomous runner stops for reconciliation instead of
      // retrying the same impossible request every 15 minutes.
      platformStates.instagram = platformState("unknown", {
        attemptId,
        error:
          "Facebook readback did not provide a public image URL for Instagram container creation.",
        reason: "verified Facebook publish has no reusable Instagram image source",
      });
      return recordPartial({
        rootDir,
        state: workingState,
        pending: { ...pending, instagramImageUrl: null },
        platformStates,
        account,
        attemptId,
        error: "Instagram image source is unavailable after the verified Facebook publish.",
      });
    }
    pending.instagramImageUrl = imageUrl;
    platformStates.instagram = platformState("submit_intent", {
      attemptId,
      intentAt: new Date().toISOString(),
      accountId: account.id,
      username: account.username,
    });
    workingState = await writeApiAttemptState({
      rootDir,
      state: workingState,
      pending,
      platformStates,
      status: "publishing",
    });
    try {
      const response = await client.publishInstagramPhoto({
        accountId: account.id,
        imageUrl,
        caption,
        retryInfo,
      });
      const postId = normalizeText(response?.id || response?.post_id);
      if (!postId) throw new Error("Instagram publish response did not include a post ID.");
      const readback = await client.instagramPostReadback(postId, { retryInfo });
      if (normalizeText(readback?.id) !== postId || !readback?.permalink)
        throw new Error("Instagram readback did not verify the published post.");
      platformStates.instagram = platformState("published", {
        id: postId,
        url: readback.permalink,
        accountId: account.id,
        handle: account.username,
        captionSha256: sha256Text(caption),
        imageSha256: image.sha256,
        observedAt: readback.timestamp || new Date().toISOString(),
      });
    } catch (error) {
      platformStates.instagram = platformState(errorClass(error), {
        attemptId,
        error: normalizeText(error.message),
        reason: errorClass(error) === "unknown" ? normalizeText(error.message) : undefined,
        accountId: account.id,
        username: account.username,
      });
      return recordPartial({
        rootDir,
        state: workingState,
        pending,
        platformStates,
        account,
        attemptId,
        error: normalizeText(error.message),
      });
    }
  }

  const publishedAt =
    platformStates.instagram.observedAt || platformStates.facebook.observedAt || now.toISOString();
  const entry = historyEntry({
    pending,
    request: {
      imagePath: image.path,
      imageSha256: image.sha256,
      captionSha256: sha256Text(caption),
    },
    platformStates,
    publishedAt,
    attemptId,
  });
  const usageState = recordUsage(workingState, {
    kind: pending.content?.kind,
    handle: pending.content?.handle,
    usedAt: publishedAt,
    weekKey: pending.content?.weekKey,
  });
  const completedState = {
    ...usageState,
    publisher: "meta-api",
    status: "completed",
    lastRunKey: pending.runKey,
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
    couponRegistry:
      pending.offerPlan?.status === "verified"
        ? {
            ...(usageState.couponRegistry || {}),
            [pending.offerPlan.code]: {
              discountId: pending.offerPlan.discountId,
              code: pending.offerPlan.code,
              percent: pending.offerPlan.percent,
              targetType: pending.offerPlan.target?.type || null,
              startsAt: pending.offerPlan.startsAt,
              endsAt: pending.offerPlan.endsAt,
            },
          }
        : usageState.couponRegistry || {},
    pending: null,
    platformStates,
    destinations: destinationState(usageState, platformStates, account),
    history: [entry, ...(Array.isArray(usageState.history) ? usageState.history : [])].slice(0, 90),
    error: null,
  };
  await writeSocialState(rootDir, completedState);
  await appendSocialEvent(rootDir, {
    type: "completed",
    runKey: pending.runKey,
    executionPath: "meta-api",
    attemptId,
    postId: platformStates.facebook.id,
    instagramPostId: platformStates.instagram.id,
    discountId: pending.offerPlan?.discountId || null,
  });
  await appendSocialJournal(rootDir, {
    type: "meta_api_completed",
    runKey: pending.runKey,
    attemptId,
    facebookPostId: platformStates.facebook.id,
    instagramPostId: platformStates.instagram.id,
  });
  await clearImageGenFiles(rootDir);
  return { status: "completed", state: completedState, platformStates };
}
