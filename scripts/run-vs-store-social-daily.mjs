#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  configMissing,
  loadVsStoreSocialEnv,
  readVsStoreSocialConfig,
  redactedConfig,
} from "./lib/vs-store-social-config.mjs";
import {
  acquireSocialLock,
  appendSocialEvent,
  appendSocialJournal,
  clearBrowserIntent,
  clearBrowserRequest,
  clearBrowserResult,
  clearImageGenResult,
  clearImageGenFiles,
  readImageGenResult,
  readSocialState,
  socialPaths,
  writeImageGenRequest,
  writeSocialState,
} from "./lib/vs-store-social-state.mjs";
import {
  buildRunKey,
  getDailySchedule,
  getFridayOfferWindow,
  selectDailyContent,
} from "./lib/vs-store-social-content.mjs";
import {
  buildCollectionCaption,
  buildProductCaption,
  buildPromotionCaption,
  buildWelcomeCaption,
  contentImageUrl,
  extractProductFacts,
} from "./lib/vs-store-social-copy.mjs";
import { prepareImageGenReferences } from "./lib/vs-store-social-image.mjs";
import {
  assessDiscountMargin,
  buildDiscountInput,
  createDiscount,
  createVsStoreShopifyClient,
  fetchStorewideProductsForOffer,
  fetchSocialCatalog,
  findDiscountByCode,
  readDiscount,
  updateDiscount,
  verifyDiscountReadback,
} from "./lib/vs-store-social-shopify.mjs";
import { nextScheduledDateForWeekday } from "./lib/vs-store-social-meta.mjs";
import {
  browserPendingMigrationBlocker,
  isMetaApiPublishWindowPending,
  metaApiRetryPlan,
  publishWithMetaApi,
} from "./lib/vs-store-social-api-publisher.mjs";
import { isSocialNetworkError as isNetworkError } from "./lib/vs-store-social-network.mjs";
import { inspectSocialImage } from "./lib/vs-store-social-image-validation.mjs";
import {
  BROWSER_PLATFORMS,
  buildBrowserRequest,
  readBrowserIntent,
  readBrowserRequest,
  readBrowserResult,
} from "./lib/vs-store-social-browser-result-schema.mjs";

const rootDir = resolve(import.meta.dirname, "..");

function parseArgs(argv) {
  const args = {
    checkConfig: false,
    dryRun: false,
    resume: false,
    resumeApi: false,
    resumeImageGen: false,
    skipOffer: false,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--check-config") args.checkConfig = true;
    else if (token === "--dry-run") args.dryRun = true;
    else if (token === "--resume") args.resume = true;
    else if (token === "--resume-api") args.resumeApi = true;
    else if (token === "--resume-imagegen") args.resumeImageGen = true;
    else if (token === "--skip-offer") args.skipOffer = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function postingSlot(config) {
  const configured = String(config.socialPostTimeEt || "").trim();
  if (configured) {
    const match = configured.match(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
    if (!match) throw new Error("VS_STORE_SOCIAL_POST_TIME_ET must use HH:mm in America/New_York.");
    return {
      hour: Number(configured.slice(0, 2)),
      minute: Number(configured.slice(3, 5)),
      source: "configured-post-time-et",
    };
  }
  return { hour: config.fallbackHour, minute: 0, source: "configured-fallback-hour" };
}

function browserRetryPlan(pending, status) {
  if (!pending?.platformStates) return { platforms: [...BROWSER_PLATFORMS] };
  if (status === "failed") return { blocked: true, reason: "previous browser attempt failed" };
  const entries = BROWSER_PLATFORMS.map((platform) => [
    platform,
    pending.platformStates?.[platform]?.status || "not_started",
  ]);
  const uncertain = entries.filter(([, platformStatus]) =>
    ["submit_intent", "unknown"].includes(platformStatus),
  );
  if (uncertain.length) {
    return {
      blocked: true,
      reason: `platform outcome requires reconciliation: ${uncertain
        .map(([platform, platformStatus]) => `${platform}=${platformStatus}`)
        .join(", ")}`,
    };
  }
  const platforms = entries
    .filter(([, platformStatus]) => platformStatus !== "published")
    .map(([platform]) => platform);
  return platforms.length
    ? { platforms }
    : { blocked: true, reason: "all destinations are already published" };
}

function isMetaApiPrimary(config) {
  return ["meta-api-primary", "meta-api", "auto"].includes(config.socialPublisher);
}

function redactedMetaError(error, config) {
  let message = normalizeText(error?.message || error || "Meta API setup is not ready.");
  for (const secret of [config.metaPageAccessToken, config.metaInstagramAccessToken]) {
    if (secret) message = message.replaceAll(secret, "[redacted]");
  }
  return message.replace(/([?&](?:access_token|client_secret)=)[^&\s]+/gi, "$1[redacted]");
}

async function hasExternalAttemptForRun(rootDir, runKey) {
  const paths = socialPaths(rootDir);
  const attemptedTypes = new Set([
    "browser_submit_intent",
    "browser_result_reconciled",
    "meta_api_publish_started",
    "meta_api_result",
  ]);
  for (const filePath of [paths.eventLog, paths.journal]) {
    let contents;
    try {
      contents = await readFile(filePath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    for (const line of contents.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry.runKey === runKey && attemptedTypes.has(entry.type)) return true;
    }
  }
  return false;
}

async function migrateBrowserPendingToApi({ rootDir, config, state, pending, runKey }) {
  const [request, intent, result] = await Promise.all([
    readBrowserRequest(config),
    readBrowserIntent(config),
    readBrowserResult(config),
  ]);
  const hasExternalAttempt = await hasExternalAttemptForRun(rootDir, runKey);
  const blocker = browserPendingMigrationBlocker({
    stateStatus: state.status,
    pending,
    request,
    intent,
    result,
    platformStates: state.platformStates,
    hasExternalAttempt,
    facebookPageId: config.facebookPageId,
    instagramHandle: config.instagramHandle,
  });
  if (blocker) throw new Error(`Cannot move the pending browser run: ${blocker}.`);
  const states = pending.platformStates || state.platformStates || {};
  const imagePath = resolve(pending.imagePath || "");
  if (!imagePath.startsWith(`${resolve(config.socialOutputDir)}/`)) {
    throw new Error(
      "Cannot move the pending run because its frozen image is outside the social output directory.",
    );
  }
  const verifiedImage = await inspectSocialImage(imagePath);
  if (pending.imageSha256 && verifiedImage.sha256 !== pending.imageSha256) {
    throw new Error("Cannot move the pending run because its frozen image hash has changed.");
  }

  const pendingWithoutBrowser = { ...pending };
  delete pendingWithoutBrowser.browserRequestPath;
  delete pendingWithoutBrowser.browserRequestFingerprint;
  delete pendingWithoutBrowser.browserRevision;
  delete pendingWithoutBrowser.allowedPlatforms;
  const platformStates = {
    facebook: { ...(states.facebook || {}), status: "not_started" },
    instagram: {
      ...(states.instagram || {}),
      status: "not_started",
      username: config.instagramHandle,
    },
  };
  const apiPending = {
    ...pendingWithoutBrowser,
    publisher: "meta-api-primary",
    imageSha256: verifiedImage.sha256,
    platformStates,
  };
  const migrated = await writeSocialState(rootDir, {
    ...state,
    publisher: "meta-api-primary",
    status: "waiting_for_publish_window",
    error: null,
    pending: apiPending,
    platformStates,
  });
  await Promise.all([
    clearBrowserRequest(rootDir),
    clearBrowserIntent(rootDir),
    clearBrowserResult(rootDir),
  ]);
  await appendSocialEvent(rootDir, {
    type: "browser_transport_migrated_to_meta_api",
    runKey,
    from: "business-suite-browser",
    to: "meta-api-primary",
  });
  await appendSocialJournal(rootDir, {
    type: "browser_transport_migrated_to_meta_api",
    runKey,
    status: "waiting_for_publish_window",
  });
  return migrated;
}

function buildApiPending({ pendingBase, pendingForRun, image, caption, instagramHandle }) {
  const previousStates = pendingForRun?.platformStates || {};
  const platformStates = {
    facebook: {
      ...(previousStates.facebook || {}),
      status: previousStates.facebook?.status || "not_started",
    },
    instagram: {
      ...(previousStates.instagram || {}),
      status: previousStates.instagram?.status || "not_started",
      username: instagramHandle,
    },
  };
  const pending = {
    ...pendingBase,
    publisher: "meta-api-primary",
    imageSha256: image.sha256,
    captionTemplate: caption,
    platformStates,
  };
  delete pending.browserRequestPath;
  delete pending.browserRequestFingerprint;
  delete pending.browserRevision;
  delete pending.allowedPlatforms;
  return pending;
}

async function loadCatalog(config, retryInfo) {
  if (!config.shopifyAdminAccessToken && !config.shopifyUseCli) {
    throw new Error("Shopify API credentials are required; local catalog fallback is disabled.");
  }
  const client = createVsStoreShopifyClient(config);
  const remote = await fetchSocialCatalog(client, { retryInfo });
  if (!remote.products.length || !remote.collections.length) {
    throw new Error(
      "Shopify social catalog response is incomplete; refusing to use local catalog data.",
    );
  }
  return { ...remote, source: "shopify-admin-graphql" };
}

function buildContentCaption(content, config, offer = null) {
  if (content.kind === "product") return buildProductCaption(content.product, config, { offer });
  if (content.kind === "collection")
    return buildCollectionCaption(content.collection, config, { offer });
  if (content.variant === "promotion-teaser") return buildPromotionCaption(config);
  return buildWelcomeCaption(config, { offer });
}

function targetForContent(content) {
  if (content.kind === "product")
    return {
      type: "product",
      id: content.product?.id || content.id,
      handle: content.product?.handle || content.handle,
    };
  if (content.kind === "collection")
    return {
      type: "collection",
      id: content.collection?.id || content.id,
      handle: content.collection?.handle || content.handle,
    };
  if (content.kind === "banner" && content.variant === "heartfelt") {
    return { type: "all", id: "all", handle: null };
  }
  return null;
}

function isManagedDiscount(discountId, discount, state, code) {
  return Boolean(
    state?.couponRegistry?.[code]?.discountId === discountId ||
    /^VS Store weekly Friday sale$/i.test(normalizeText(discount?.title)),
  );
}

async function prepareOffer({ config, content, now, retryInfo, skipOffer, state, dryRun = false }) {
  if (skipOffer || !content || content.variant !== "heartfelt")
    return {
      status: "not-requested",
      reason: skipOffer ? "operator-skip" : "not-friday-offer-slot",
    };
  if (state?.lastOffer && Date.parse(String(state.lastOffer.endsAt || "")) > now.getTime()) {
    return { status: "not-requested", reason: "rolling-offer-window-active" };
  }
  const target = targetForContent(content);
  if (!target?.id) return { status: "not-requested", reason: "target-id-missing" };

  const client =
    config.shopifyAdminAccessToken || config.shopifyUseCli
      ? createVsStoreShopifyClient(config)
      : null;
  if (!client) {
    return { status: "not-requested", target, reason: "shopify-api-credential-missing" };
  }

  const products = await fetchStorewideProductsForOffer(client, { retryInfo });
  const assessment = assessDiscountMargin(products, {
    ...config,
    maxDiscountPercent: config.primaryDiscountPercent,
    defaultDiscountPercent: config.fallbackDiscountPercent,
  });
  if (!assessment.eligible)
    return { status: "not-requested", target, assessment, reason: assessment.reason };

  const window = getFridayOfferWindow(now, config.timezone);
  const code =
    assessment.percent === config.primaryDiscountPercent
      ? config.primaryDiscountCode
      : config.fallbackDiscountCode;
  const input = buildDiscountInput({
    code,
    title: "VS Store weekly Friday sale",
    percent: assessment.percent,
    startsAt: window.startsAt.toISOString(),
    endsAt: window.endsAt.toISOString(),
    target,
  });
  if (dryRun) {
    return {
      status: "preview",
      target,
      code,
      percent: assessment.percent,
      startsAt: window.startsAt.toISOString(),
      endsAt: window.endsAt.toISOString(),
      assessment,
      input,
    };
  }
  let discountId = await findDiscountByCode(client, code, { retryInfo });
  let discountAction = "created";
  if (discountId) {
    const existing = await readDiscount(client, discountId, { retryInfo });
    if (!isManagedDiscount(discountId, existing, state, code)) {
      return {
        status: "not-requested",
        target,
        assessment,
        reason: "discount-code-conflict",
        conflictCode: code,
      };
    }
    discountId = (await updateDiscount(client, discountId, input, { retryInfo })).id;
    discountAction = "updated";
  } else {
    try {
      discountId = (await createDiscount(client, input, { retryInfo })).id;
    } catch (error) {
      if (!/already exists|duplicate|taken|in use/i.test(String(error?.message || error))) {
        throw error;
      }
      discountId = await findDiscountByCode(client, code, { retryInfo });
      if (!discountId) throw error;
      const existing = await readDiscount(client, discountId, { retryInfo });
      if (!isManagedDiscount(discountId, existing, state, code)) {
        return {
          status: "not-requested",
          target,
          assessment,
          reason: "discount-code-conflict",
          conflictCode: code,
        };
      }
      discountId = (await updateDiscount(client, discountId, input, { retryInfo })).id;
      discountAction = "updated-after-create-race";
    }
  }
  const readback = await readDiscount(client, discountId, { retryInfo });
  const verified = verifyDiscountReadback(readback, { input, target, percent: assessment.percent });
  return {
    status: "verified",
    target,
    code,
    percent: assessment.percent,
    discountId,
    startsAt: window.startsAt.toISOString(),
    endsAt: window.endsAt.toISOString(),
    assessment,
    verified,
    input,
    discountAction,
  };
}

function makeFingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function contentSummary(content) {
  const title =
    content.product?.title ||
    content.collection?.title ||
    (content.variant === "promotion-teaser"
      ? "VS Store Friday sale teaser"
      : content.variant === "heartfelt"
        ? "VS Store heartfelt Friday banner"
        : "VS Store banner");
  return {
    kind: content.kind,
    variant: content.variant || null,
    slot: content.slot || null,
    weekday: content.weekday || null,
    weekKey: content.weekKey || null,
    id: content.id || content.product?.id || content.collection?.id || null,
    handle: content.handle || content.product?.handle || content.collection?.handle || null,
    title,
  };
}

function safeAssetSlug(value) {
  return (
    normalizeText(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "vs-store-post"
  );
}

function imageGenOutputPath(assetDir, content) {
  return resolve(
    assetDir,
    `imagegen-${safeAssetSlug(content.product?.title || content.collection?.title || content.kind)}.png`,
  );
}

function targetUrlForContent(content, config) {
  if (content.kind === "product")
    return `${config.siteUrl}/products/${encodeURIComponent(content.product?.handle || content.handle)}?utm_source=facebook&utm_medium=organic_social&utm_campaign=vs_store_daily_social&utm_content=product`;
  if (content.kind === "collection")
    return `${config.siteUrl}/collections/${encodeURIComponent(content.collection?.handle || content.handle)}?utm_source=facebook&utm_medium=organic_social&utm_campaign=vs_store_daily_social&utm_content=collection`;
  if (content.variant === "promotion-teaser")
    return `${config.siteUrl}/offers?utm_source=facebook&utm_medium=organic_social&utm_campaign=vs_store_daily_social&utm_content=friday-sale-teaser`;
  return `${config.siteUrl}/?utm_source=facebook&utm_medium=organic_social&utm_campaign=vs_store_daily_social&utm_content=welcome-banner`;
}

function buildImageGenPrompt(content) {
  if (content.kind === "product") {
    const facts = extractProductFacts(content.product || { title: content.title });
    const evidence = [
      `Product name: ${facts.title}.`,
      `Product type: ${facts.type}.`,
      facts.brand ? `Verified supplier or brand: ${facts.brand}.` : "",
      facts.features.length ? `Verified features: ${facts.features.join(", ")}.` : "",
      facts.materials.length ? `Verified materials: ${facts.materials.join(", ")}.` : "",
      facts.measurements.length ? `Verified measurements: ${facts.measurements.join(", ")}.` : "",
      facts.uses.length ? `Verified use context: ${facts.uses.join(", ")}.` : "",
      facts.variants.length ? `Visible options: ${facts.variants.join(", ")}.` : "",
    ].filter(Boolean);
    return [
      "Create a premium square 1080x1080 organic Facebook Page creative for VS Store.",
      "Use the supplied product reference image as the only source of truth: keep the product recognizable, accurate, and visually central. Do not redesign, replace, or add product components.",
      ...evidence,
      "Use the supplied VS Store logo reference exactly as the brand mark. Use a refined navy, white, and warm-gold palette with clean retail lighting and generous safe margins.",
      "Do not invent text, claims, prices, discounts, specifications, gender, audience labels, packaging, badges, or brand names. Do not add people unless they already appear in the product reference. Do not render any text other than the supplied logo artwork.",
      "The post caption carries the product copy separately, so keep this image polished, legible, and text-free apart from the exact logo.",
    ].join("\n");
  }
  if (content.variant === "promotion-teaser") {
    return [
      "Create a premium square 1080x1080 organic Facebook Page promotional teaser creative for VS Store.",
      "Use the supplied VS Store logo reference exactly and create a refined navy, white, and warm-gold retail scene that feels anticipatory and polished.",
      "The creative should tease a Friday weekend sale without showing a percentage, coupon code, price, product, discount claim, or other text. Do not render any text other than the supplied logo artwork.",
    ].join("\n");
  }
  if (content.kind === "collection") {
    const featured = Array.isArray(content.collection?.products?.nodes)
      ? content.collection.products.nodes
          .map((item) => normalizeText(item?.title))
          .filter(Boolean)
          .slice(0, 3)
      : [];
    return [
      "Create a premium square 1080x1080 organic Facebook Page collection creative for VS Store.",
      `Collection: ${normalizeText(content.collection?.title || content.title)}.`,
      featured.length
        ? `Use only these verified featured product references: ${featured.join(", ")}.`
        : "",
      "Use the supplied collection/product image reference as the only source of product truth. Preserve the real products and do not invent items, features, prices, discounts, gender, or category labels.",
      "Use the supplied VS Store logo reference exactly. Use a refined navy, white, and warm-gold palette, clear retail composition, and generous safe margins.",
      "Do not render any text other than the exact supplied logo artwork; the caption provides the collection message separately.",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    "Create a warm, premium square 1080x1080 organic Facebook Page welcome creative for VS Store.",
    "Use the supplied VS Store logo reference exactly and build a heartfelt but restrained retail welcome scene in navy, white, and warm gold.",
    "Do not invent products, prices, discounts, claims, people, or other brand names. Do not render any text other than the exact supplied logo artwork; the welcome message is supplied separately as the post caption.",
  ].join("\n");
}

async function usableImageGenResult({ state, runKey }) {
  const expectedFingerprint = state.pending?.imageGenRequest?.fingerprint;
  if (!expectedFingerprint) return null;
  const result = await readImageGenResult(rootDir);
  if (!result) return null;
  if (result.runKey !== runKey || result.fingerprint !== expectedFingerprint) return null;
  if (result.status !== "success")
    throw new Error(`Image Gen bridge reported ${result.status || "failure"}.`);
  const imagePath = resolve(String(result.image?.path || ""));
  const socialRoot = resolve(
    String(process.env.VS_STORE_SOCIAL_OUTPUT_DIR || resolve(rootDir, "output", "social")),
  );
  if (!imagePath.startsWith(`${socialRoot}/`))
    throw new Error("Image Gen result must point to an image inside output/social.");
  if (!/\.(?:png|jpe?g|webp)$/i.test(imagePath))
    throw new Error("Image Gen result must be a PNG, JPEG, or WebP file.");
  let imageInfo;
  try {
    imageInfo = await inspectSocialImage(imagePath);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error("Image Gen result file is missing.");
    throw error;
  }
  if (result.image?.sha256 && result.image.sha256 !== imageInfo.sha256)
    throw new Error("Image Gen result hash does not match the recorded handoff hash.");
  return {
    path: imagePath,
    mode: result.image?.mode || "imagegen",
    sha256: imageInfo.sha256,
    bytes: imageInfo.bytes,
    mimeType: imageInfo.mimeType,
    width: imageInfo.width,
    height: imageInfo.height,
  };
}

async function requestImageGen({
  config,
  state,
  content,
  runKey,
  scheduledAt,
  peak,
  offerPlan,
  captionTemplate,
  targetUrl,
}) {
  const sameRunPending = state.pending?.runKey === runKey ? state.pending : null;
  const existingRequest = sameRunPending?.imageGenRequest;
  const references = await prepareImageGenReferences({
    config,
    content,
    runKey,
    sourceUrl: contentImageUrl(content),
    existingSourcePath: existingRequest?.sourceImagePath,
  });
  const imageFingerprint =
    existingRequest?.fingerprint ||
    makeFingerprint({
      runKey,
      content: contentSummary(content),
      scheduledAt: scheduledAt.toISOString(),
      sourceImagePath: references.sourcePath || null,
    });
  const outputPath = imageGenOutputPath(references.assetDir, content);
  const request = {
    runKey,
    fingerprint: imageFingerprint,
    content: contentSummary(content),
    targetUrl,
    scheduledAt: scheduledAt.toISOString(),
    peak,
    offerPlan,
    captionTemplate,
    sourceImagePath: references.sourcePath,
    logoPath: references.logoPath,
    referenceImagePaths: [references.sourcePath, references.logoPath].filter(Boolean),
    outputPath,
    prompt: buildImageGenPrompt(content),
    instructions:
      "Use the Codex Image Gen tool with every listed local reference image. Inspect the generated image before copying it to outputPath. Leave the original generated file intact. Do not use the ffmpeg renderer for a live post.",
  };
  if (state.pending?.imageGenRequest?.fingerprint !== imageFingerprint)
    await clearImageGenResult(rootDir);
  await writeImageGenRequest(rootDir, request);
  const pending = {
    ...(sameRunPending || {}),
    runKey,
    fingerprint: imageFingerprint,
    content: contentSummary(content),
    selectedAt: content.selectedAt || sameRunPending?.selectedAt || new Date().toISOString(),
    peak,
    scheduledAt: scheduledAt.toISOString(),
    imagePath: null,
    imageMode: null,
    imageGenRequest: {
      fingerprint: imageFingerprint,
      sourceImagePath: references.sourcePath,
      logoPath: references.logoPath,
      outputPath,
    },
    captionTemplate,
    targetUrl,
    offerPlan,
  };
  await writeSocialState(rootDir, { ...state, status: "waiting_for_imagegen", pending });
  await appendSocialEvent(rootDir, {
    type: "waiting_for_imagegen",
    runKey,
    fingerprint: imageFingerprint,
    referenceCount: request.referenceImagePaths.length,
  });
  process.stdout.write(
    `Image Gen creative required. Request saved at ${socialPaths(rootDir).imageGenRequest}.\n`,
  );
}

async function waitForNetwork({ config, state, runKey, error }) {
  const startedAt = Date.now();
  let intervalMs = config.networkPollMs;
  await writeSocialState(config.rootDir, {
    ...state,
    status: "waiting_for_network",
    pending: {
      ...(state.pending || {}),
      runKey,
      networkError: normalizeText(error.message),
      waitingSince: new Date().toISOString(),
    },
  });
  process.stdout.write(
    `Network/DNS failure; waiting and polling for recovery for up to ${Math.ceil(config.networkMaxWaitMs / 60_000)} minutes.\n`,
  );
  while (Date.now() - startedAt < config.networkMaxWaitMs) {
    const probes = [
      config.storeDomain ? `https://${config.storeDomain}` : "",
      config.businessSuiteUrl || "",
    ].filter(Boolean);
    for (const url of probes) {
      try {
        const response = await fetch(url, {
          method: "HEAD",
          signal: AbortSignal.timeout(Math.min(config.requestTimeoutMs, 15_000)),
        });
        if (response || response.status === 0) {
          process.stdout.write(`Network probe recovered via ${new URL(url).hostname}; resuming.\n`);
          return true;
        }
      } catch {
        // Keep polling until the durable wait window expires.
      }
    }
    process.stdout.write(
      `Network still unavailable; next probe in ${Math.ceil(intervalMs / 1000)}s.\n`,
    );
    await sleep(intervalMs);
    intervalMs = Math.min(300_000, Math.round(intervalMs * 1.5));
  }
  await writeSocialState(config.rootDir, {
    ...state,
    status: "waiting_for_network",
    pending: {
      ...(state.pending || {}),
      runKey,
      networkError: normalizeText(error.message),
      waitingSince: new Date().toISOString(),
    },
  });
  return false;
}

async function migrateStalePendingState({ state, runKey, now }) {
  const pendingRunKey = state?.pending?.runKey;
  const legacyPending =
    Number(state?.schemaVersion || 1) < 3 ||
    !state?.pending?.content?.variant ||
    !state?.pending?.content?.slot;
  if (!pendingRunKey || (pendingRunKey === runKey && !legacyPending)) return state;
  const scheduledAt = Date.parse(String(state.pending?.scheduledAt || ""));
  if (!legacyPending && Number.isFinite(scheduledAt) && scheduledAt > now.getTime()) return state;
  await clearImageGenFiles(rootDir);
  const migrated = await writeSocialState(rootDir, {
    ...state,
    status: "idle",
    pending: null,
    lastStalePending: {
      runKey: pendingRunKey,
      fingerprint: state.pending?.fingerprint || null,
      discardedAt: now.toISOString(),
      reason: "weekday-schedule-migration",
    },
  });
  await appendSocialEvent(rootDir, {
    type: "stale_pending_discarded",
    runKey: pendingRunKey,
    reason: "weekday-schedule-migration",
  });
  return migrated;
}

async function runDaily(args, config) {
  const releaseLock = await acquireSocialLock(rootDir, { publisher: config.socialPublisher });
  try {
    const apiPrimary = isMetaApiPrimary(config);
    let state = await readSocialState(rootDir);
    const now = new Date();
    const runKey = buildRunKey(now, config.timezone);
    state = await migrateStalePendingState({ state, runKey, now });
    let pendingForRun =
      state.pending?.runKey === runKey && state.pending?.content?.kind ? state.pending : null;

    if (args.resumeApi) {
      if (!apiPrimary)
        throw new Error("--resume-api requires VS_STORE_SOCIAL_PUBLISHER=meta-api-primary.");
      if (!pendingForRun)
        throw new Error("--resume-api requires an active pending social run for today.");
      if (state.status === "waiting_for_browser" || pendingForRun.browserRequestPath) {
        state = await migrateBrowserPendingToApi({
          rootDir,
          config,
          state,
          pending: pendingForRun,
          runKey,
        });
        pendingForRun = state.pending;
        process.stdout.write(
          `VS Store social run ${runKey} moved to Meta API. No browser or Meta post was submitted; the saved due slot remains ${pendingForRun.scheduledAt}.\n`,
        );
      }
    }

    const compatiblePublisher =
      !pendingForRun ||
      !state.publisher ||
      state.publisher === config.socialPublisher ||
      (apiPrimary &&
        ["meta-api", "meta-api-primary", "business-suite-browser"].includes(state.publisher));
    if (pendingForRun && !compatiblePublisher) {
      process.stdout.write(
        `VS Store social run ${runKey} belongs to the ${state.publisher} transport and cannot be switched while a submission is pending. Reconcile it first.\n`,
      );
      return;
    }

    if (state.status === "completed" && state.lastRunKey === runKey) {
      process.stdout.write(
        `VS Store social post for ${runKey} is already completed; skipping duplicate work.\n`,
      );
      return;
    }
    if (state.status === "waiting_for_browser" && pendingForRun?.browserRequestPath) {
      process.stdout.write(
        `VS Store social run ${runKey} is waiting for the read-only-verified Business Suite browser handoff at ${pendingForRun.browserRequestPath}.\n`,
      );
      return;
    }
    if (state.status === "waiting_for_publish_window" && pendingForRun?.scheduledAt) {
      if (isMetaApiPublishWindowPending(pendingForRun.scheduledAt, { now })) {
        process.stdout.write(
          `VS Store social run ${runKey} is waiting for its API publish window at ${pendingForRun.scheduledAt}.\n`,
        );
        return;
      }
    }
    if (["needs_review", "failed"].includes(state.status) && pendingForRun) {
      process.stdout.write(
        `VS Store social run ${runKey} is paused for review (${state.error || state.status}); reconcile it before retrying.\n`,
      );
      return;
    }
    if (pendingForRun?.nextRetryAt) {
      const nextRetryAt = Date.parse(String(pendingForRun.nextRetryAt));
      if (Number.isFinite(nextRetryAt) && nextRetryAt > now.getTime()) {
        process.stdout.write(
          `VS Store social retry for ${runKey} is due at ${pendingForRun.nextRetryAt}; no new submission was created.\n`,
        );
        return;
      }
    }
    const browserHandoffPending =
      state.status === "waiting_for_browser" || Boolean(pendingForRun?.browserRequestPath);
    const retryPlan = browserHandoffPending
      ? browserRetryPlan(pendingForRun, state.status)
      : apiPrimary
        ? metaApiRetryPlan(pendingForRun, state.status)
        : browserRetryPlan(pendingForRun, state.status);
    if (retryPlan.blocked) {
      process.stdout.write(`VS Store social run ${runKey} is paused: ${retryPlan.reason}.\n`);
      return;
    }

    const retryInfo = [];
    const catalog = await loadCatalog(config, retryInfo);
    const content = pendingForRun
      ? {
          kind: pendingForRun.content.kind,
          variant: pendingForRun.content.variant || "showcase",
          slot: pendingForRun.content.slot || null,
          weekday: pendingForRun.content.weekday || null,
          weekKey: pendingForRun.content.weekKey || null,
          id: pendingForRun.content.id,
          handle: pendingForRun.content.handle,
          product:
            pendingForRun.content.kind === "product"
              ? catalog.products.find((product) => product.handle === pendingForRun.content.handle)
              : null,
          collection:
            pendingForRun.content.kind === "collection"
              ? catalog.collections.find(
                  (collection) => collection.handle === pendingForRun.content.handle,
                )
              : null,
        }
      : selectDailyContent({ catalog, state, now, timeZone: config.timezone });
    if (content.kind === "product" && !content.product) {
      throw new Error(`No eligible in-stock product is available for the ${content.slot} slot.`);
    }
    if (content.kind === "collection" && !content.collection) {
      throw new Error(
        `No eligible image-backed collection is available for the ${content.slot} slot.`,
      );
    }

    const slot = postingSlot(config);
    let peak = pendingForRun?.peak
      ? pendingForRun.peak
      : { hour: slot.hour, minute: slot.minute, source: slot.source, scores: {} };
    const instagramAccount = {
      id: null,
      username: config.instagramHandle || "vs.store2608",
    };
    const scheduledAt = pendingForRun?.scheduledAt
      ? new Date(pendingForRun.scheduledAt)
      : nextScheduledDateForWeekday(
          now,
          config.timezone,
          peak.hour,
          content.weekday ?? getDailySchedule(now, config.timezone).weekday,
          25,
          peak.minute || 0,
        );
    const offerDue = content.variant === "heartfelt";
    let offerPlan = pendingForRun?.offerPlan
      ? pendingForRun.offerPlan
      : offerDue
        ? null
        : { status: "not-requested", reason: "not-friday-offer-slot" };
    if (!offerPlan) {
      try {
        offerPlan = await prepareOffer({
          config,
          content,
          now,
          retryInfo,
          skipOffer: args.skipOffer,
          state,
          dryRun: args.dryRun,
        });
      } catch (error) {
        if (isNetworkError(error)) {
          const recovered = await waitForNetwork({ config, state, runKey, error });
          if (!recovered) {
            process.exitCode = 75;
            return;
          }
          offerPlan = await prepareOffer({
            config,
            content,
            now,
            retryInfo,
            skipOffer: args.skipOffer,
            state,
            dryRun: args.dryRun,
          });
        } else {
          offerPlan = {
            status: "not-requested",
            reason: `offer-api-failure:${normalizeText(error.message)}`,
          };
        }
      }
    }

    const offerForCaption =
      offerPlan.status === "verified" ? { code: offerPlan.code, percent: offerPlan.percent } : null;
    const generatedCaption = buildContentCaption(content, config, offerForCaption);
    const baseCaption = pendingForRun?.captionTemplate || generatedCaption;
    const captionTemplate = baseCaption;
    const targetUrl = targetUrlForContent(content, config);
    let image = null;
    if (
      pendingForRun?.imagePath &&
      pendingForRun.imageMode === "imagegen" &&
      existsSync(pendingForRun.imagePath)
    ) {
      image = {
        path: pendingForRun.imagePath,
        mode: "imagegen",
        sha256: pendingForRun.imageSha256 || null,
      };
    }
    if (!image && !args.dryRun) image = await usableImageGenResult({ state, runKey });
    if (!image && args.dryRun) {
      const references = await prepareImageGenReferences({
        config,
        content,
        runKey,
        sourceUrl: contentImageUrl(content),
      });
      image = {
        path: imageGenOutputPath(references.assetDir, content),
        mode: "imagegen-request-preview",
        referenceImagePaths: [references.sourcePath, references.logoPath].filter(Boolean),
      };
    }
    if (!image) {
      await requestImageGen({
        config,
        state,
        content,
        runKey,
        scheduledAt,
        peak,
        offerPlan,
        captionTemplate,
        targetUrl,
      });
      process.exitCode = 75;
      return;
    }
    if (!args.dryRun && !image.sha256) {
      const inspectedImage = await inspectSocialImage(image.path);
      image = { ...image, ...inspectedImage };
    }
    const pendingBase = {
      runKey,
      fingerprint: makeFingerprint({
        runKey,
        content: contentSummary(content),
        scheduledAt: scheduledAt.toISOString(),
        offer:
          offerPlan.status === "verified"
            ? { code: offerPlan.code, percent: offerPlan.percent }
            : offerPlan.status,
      }),
      content: contentSummary(content),
      selectedAt: content.selectedAt || pendingForRun?.selectedAt || now.toISOString(),
      peak,
      scheduledAt: scheduledAt.toISOString(),
      imagePath: image.path,
      imageMode: image.mode,
      captionTemplate,
      targetUrl,
      offerPlan,
      retryInfo,
      destinations: {
        facebook: {
          required: true,
          pageId: config.facebookPageId || null,
          pageName: config.facebookPageName || null,
          pageUrl: config.facebookPageUrl || null,
        },
        instagram: {
          required: true,
          username: instagramAccount.username,
        },
      },
    };

    if (args.dryRun) {
      process.stdout.write(
        `${JSON.stringify(
          {
            mode: "dry-run",
            runKey,
            config: redactedConfig(config),
            catalogSource: catalog.source,
            catalogCounts: {
              products: catalog.products.length,
              collections: catalog.collections.length,
            },
            content: contentSummary(content),
            peak,
            scheduledAt: scheduledAt.toISOString(),
            offerPlan: {
              status: offerPlan.status,
              reason: offerPlan.reason || null,
              percent: offerPlan.percent || null,
              target: offerPlan.target || null,
            },
            image: { path: image.path, mode: image.mode },
            caption: captionTemplate,
          },
          null,
          2,
        )}\n`,
      );
      return;
    }

    const offer = offerPlan.status === "verified" ? offerPlan : null;
    const caption = baseCaption;

    if (apiPrimary && !browserHandoffPending) {
      if (isMetaApiPublishWindowPending(scheduledAt, { now })) {
        const apiPending = buildApiPending({
          pendingBase,
          pendingForRun,
          image,
          caption,
          instagramHandle: config.instagramHandle,
        });
        state = await writeSocialState(rootDir, {
          ...state,
          publisher: "meta-api-primary",
          status: "waiting_for_publish_window",
          error: null,
          pending: apiPending,
          platformStates: apiPending.platformStates,
        });
        await appendSocialEvent(rootDir, {
          type: "meta_api_waiting_for_publish_window",
          runKey,
          scheduledAt: scheduledAt.toISOString(),
        });
        await appendSocialJournal(rootDir, {
          type: "meta_api_waiting_for_publish_window",
          runKey,
          status: "waiting_for_publish_window",
        });
        process.stdout.write(
          `VS Store social run ${runKey} is waiting for its Meta API publish window at ${scheduledAt.toISOString()}; no post was sent.\n`,
        );
        return;
      }
      try {
        const apiResult = await publishWithMetaApi({
          rootDir,
          config,
          state,
          pendingBase,
          pendingForRun,
          image,
          caption,
          scheduledAt,
          retryPlan,
          now,
          retryInfo,
        });
        process.stdout.write(
          `VS Store Meta API publishing finished with status ${apiResult.status}; independent Facebook and Instagram readback was recorded.\n`,
        );
        return;
      } catch (error) {
        if (
          ![
            "META_API_LIVE_DISABLED",
            "META_API_PREFLIGHT_FAILED",
            "META_API_PREFLIGHT_NOT_READY",
            "META_API_WAITING_FOR_DUE_SLOT",
          ].includes(error?.code)
        )
          throw error;
        const waitingStatus =
          error.code === "META_API_WAITING_FOR_DUE_SLOT"
            ? "waiting_for_publish_window"
            : "waiting_for_setup";
        const apiPending = buildApiPending({
          pendingBase,
          pendingForRun,
          image,
          caption,
          instagramHandle: config.instagramHandle,
        });
        const safeError = redactedMetaError(error, config);
        state = await writeSocialState(rootDir, {
          ...state,
          publisher: "meta-api-primary",
          status: waitingStatus,
          error: safeError,
          pending: apiPending,
          platformStates: apiPending.platformStates,
        });
        await appendSocialEvent(rootDir, {
          type:
            waitingStatus === "waiting_for_publish_window"
              ? "meta_api_waiting_for_publish_window"
              : "meta_api_waiting_for_setup",
          runKey,
          code: error.code,
          reason: safeError,
        });
        await appendSocialJournal(rootDir, {
          type:
            waitingStatus === "waiting_for_publish_window"
              ? "meta_api_waiting_for_publish_window"
              : "meta_api_waiting_for_setup",
          runKey,
          status: waitingStatus,
        });
        process.stdout.write(
          `Meta API is waiting for setup (${safeError}); no post was sent and the run remains on API transport.\n`,
        );
        return;
      }
    }

    if (!apiPrimary && config.socialPublisher !== "business-suite-browser")
      throw new Error("Unsupported VS Store social publisher.");
    const browserExpiresAt = offer?.endsAt
      ? new Date(offer.endsAt)
      : new Date(scheduledAt.getTime() + 24 * 60 * 60 * 1000);
    const revision = Number(pendingForRun?.browserRevision || 0) + 1;
    const { request, image: verifiedImage } = await buildBrowserRequest({
      config,
      runKey,
      revision,
      imagePath: image.path,
      caption,
      content: contentSummary(content),
      scheduledAt,
      offerPlan: offer || { status: "not-requested", reason: "no-verified-offer" },
      expiresAt: browserExpiresAt,
      allowedPlatforms: retryPlan.platforms,
    });
    await clearBrowserResult(rootDir);
    const priorPlatformStates = pendingForRun?.platformStates || {};
    const platformStates = Object.fromEntries(
      BROWSER_PLATFORMS.map((platform) => [
        platform,
        {
          ...(priorPlatformStates[platform] || {}),
          status: priorPlatformStates[platform]?.status || "not_started",
          ...(platform === "instagram" ? { username: config.instagramHandle } : {}),
        },
      ]),
    );
    const browserPending = {
      ...pendingBase,
      imagePath: verifiedImage.path,
      imageMode: image.mode,
      imageSha256: verifiedImage.sha256,
      captionTemplate: caption,
      offerPlan: offer,
      browserRequestPath: resolve(config.socialOutputDir, "browser-request.json"),
      browserRequestFingerprint: request.fingerprint,
      browserRevision: revision,
      allowedPlatforms: retryPlan.platforms,
      platformStates,
    };
    const waitingState = {
      ...state,
      publisher: "business-suite-browser",
      status: "waiting_for_browser",
      error: null,
      pending: browserPending,
      platformStates: browserPending.platformStates,
      destinations: browserPending.destinations,
    };
    await writeSocialState(rootDir, waitingState);
    await appendSocialEvent(rootDir, {
      type: "waiting_for_browser",
      runKey,
      requestFingerprint: request.fingerprint,
      imageSha256: verifiedImage.sha256,
      allowedPlatforms: request.allowedPlatforms,
      retry: retryPlan.platforms.length < BROWSER_PLATFORMS.length,
      liveEnabled: config.socialLiveEnabled,
    });
    await appendSocialJournal(rootDir, {
      type: "browser_request_created",
      runKey,
      requestFingerprint: request.fingerprint,
      revision,
      status: "waiting_for_browser",
    });
    process.stdout.write(
      `Browser publishing request prepared at ${resolve(config.socialOutputDir, "browser-request.json")}. ${
        config.socialLiveEnabled
          ? "Live browser publishing is enabled after the configured rollout approval; complete the Business Suite preflight and publish verification."
          : "Live publishing remains disabled until the dedicated Business Suite preflight and explicit rollout approval are complete."
      }\n`,
    );
  } finally {
    await releaseLock();
  }
}

async function runWithNetworkRecovery(args, config) {
  let nextArgs = { ...args };
  while (true) {
    try {
      await runDaily(nextArgs, config);
      return;
    } catch (error) {
      if (!isNetworkError(error)) throw error;
      const state = await readSocialState(rootDir).catch(() => null);
      const recovered = await waitForNetwork({
        config,
        state: state || {},
        runKey: buildRunKey(new Date(), config.timezone),
        error,
      });
      if (!recovered) {
        process.exitCode = 75;
        return;
      }
      nextArgs = { ...nextArgs, resume: true };
      process.stdout.write("Network recovered; resuming the persisted social run automatically.\n");
    }
  }
}

async function main() {
  const args = parseArgs(process.argv);
  await loadVsStoreSocialEnv(rootDir);
  const config = readVsStoreSocialConfig(rootDir);
  if (args.checkConfig) {
    const missing = configMissing(config);
    process.stdout.write(
      `${JSON.stringify({ config: redactedConfig(config), missing, socialEnvFiles: [".env.vs-store-social.local", ".env.vs-store-social"] }, null, 2)}\n`,
    );
    if (missing.length) process.exitCode = 2;
    return;
  }
  const missing = configMissing(config);
  if (missing.length) {
    const state = await readSocialState(rootDir).catch(() => null);
    if (state)
      await writeSocialState(rootDir, {
        ...state,
        status: "waiting_for_setup",
        error: `Missing standalone social configuration: ${missing.join(", ")}`,
      });
    process.stderr.write(
      `VS Store social automation is waiting for setup: ${missing.join(", ")}\n`,
    );
    process.exitCode = 2;
    return;
  }
  try {
    await runWithNetworkRecovery(args, config);
  } catch (error) {
    const state = await readSocialState(rootDir).catch(() => null);
    if (state)
      await writeSocialState(rootDir, {
        ...state,
        status: "failed",
        error: normalizeText(error.message),
      });
    process.stderr.write(`VS Store social automation failed: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

main();
