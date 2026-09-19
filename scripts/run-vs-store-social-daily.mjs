#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { readProductCatalogPayload } from "./product-catalog-files.mjs";
import {
  configMissing,
  loadVsStoreSocialEnv,
  readVsStoreSocialConfig,
  redactedConfig,
} from "./lib/vs-store-social-config.mjs";
import {
  acquireSocialLock,
  appendSocialEvent,
  clearImageGenResult,
  clearImageGenFiles,
  readImageGenResult,
  readSocialState,
  recordUsage,
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
import {
  choosePeakHour,
  createVsStoreMetaClient,
  nextScheduledDateForWeekday,
} from "./lib/vs-store-social-meta.mjs";
import { isSocialNetworkError as isNetworkError } from "./lib/vs-store-social-network.mjs";

const rootDir = resolve(import.meta.dirname, "..");

function parseArgs(argv) {
  const args = {
    checkConfig: false,
    dryRun: false,
    resume: false,
    resumeImageGen: false,
    skipOffer: false,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--check-config") args.checkConfig = true;
    else if (token === "--dry-run") args.dryRun = true;
    else if (token === "--resume") args.resume = true;
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

function isAuthOrPermissionError(error) {
  return Boolean(
    error?.code === "MISSING_CREDENTIAL" ||
    error?.status === 401 ||
    error?.status === 403 ||
    /permission|access token|unauthori[sz]ed|forbidden|credentials? not configured/i.test(
      String(error?.message || error),
    ),
  );
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function loadLocalCatalog() {
  const productPayload = await readProductCatalogPayload(resolve(rootDir, "public", "data"));
  const collectionPayload = JSON.parse(
    await readFile(resolve(rootDir, "public", "data", "collections.json"), "utf8"),
  );
  const products = Array.isArray(productPayload?.products) ? productPayload.products : [];
  const productsByHandle = new Map(products.map((product) => [product?.handle, product]));
  const collections = (
    Array.isArray(collectionPayload?.collections) ? collectionPayload.collections : []
  ).map((collection) => {
    const featuredProducts = Array.isArray(collection?.customData?.featuredProducts)
      ? collection.customData.featuredProducts
      : [];
    const nodes = featuredProducts
      .map((featured) => productsByHandle.get(featured?.handle) || featured)
      .filter(Boolean);
    const firstImage =
      nodes[0]?.image?.src || nodes[0]?.featuredImage?.url || nodes[0]?.images?.[0]?.src || "";
    return {
      ...collection,
      image: collection?.image || (firstImage ? { src: firstImage } : null),
      products: collection?.products || { nodes },
    };
  });
  return {
    products,
    collections,
    fetchedAt: productPayload?.generatedAt || collectionPayload?.generatedAt || null,
    source: "local-catalog-snapshot",
  };
}

async function loadCatalog(config, retryInfo) {
  const local = await loadLocalCatalog();
  if (!config.shopifyAdminAccessToken && !config.shopifyUseCli) {
    process.stdout.write(
      `Shopify API credentials are not configured; using local catalog snapshot (${local.products.length} products, ${local.collections.length} collections).\n`,
    );
    return local;
  }
  const client = createVsStoreShopifyClient(config);
  try {
    const remote = await fetchSocialCatalog(client, { retryInfo });
    if (!remote.products.length || !remote.collections.length)
      throw new Error("Shopify social catalog response is incomplete.");
    return { ...remote, source: "shopify-admin-graphql" };
  } catch (error) {
    if (
      local.products.length &&
      local.collections.length &&
      (isNetworkError(error) || isAuthOrPermissionError(error))
    ) {
      process.stdout.write(
        `Shopify catalog read unavailable; using local snapshot for this run: ${normalizeText(error.message)}\n`,
      );
      return { ...local, fallbackReason: normalizeText(error.message) };
    }
    throw error;
  }
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
  const socialRoot = resolve(rootDir, "output", "social");
  if (!imagePath.startsWith(`${socialRoot}/`))
    throw new Error("Image Gen result must point to an image inside output/social.");
  if (!/\.(?:png|jpe?g|webp)$/i.test(imagePath))
    throw new Error("Image Gen result must be a PNG, JPEG, or WebP file.");
  try {
    const imageStats = await stat(imagePath);
    if (!imageStats.isFile() || imageStats.size < 512)
      throw new Error("Image Gen result is unexpectedly small or is not a file.");
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error("Image Gen result file is missing.");
    throw error;
  }
  return { path: imagePath, mode: result.image?.mode || "imagegen" };
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

async function writePending(rootDir, state, pending, status) {
  await writeSocialState(rootDir, { ...state, status, pending });
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
      "https://graph.facebook.com",
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
  const releaseLock = await acquireSocialLock(rootDir);
  try {
    let state = await readSocialState(rootDir);
    const now = new Date();
    const runKey = buildRunKey(now, config.timezone);
    state = await migrateStalePendingState({ state, runKey, now });
    const pendingForRun =
      state.pending?.runKey === runKey && state.pending?.content?.kind ? state.pending : null;

    if (state.status === "completed" && state.lastRunKey === runKey) {
      process.stdout.write(
        `VS Store social post for ${runKey} is already completed; skipping duplicate work.\n`,
      );
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

    let peak = pendingForRun?.peak
      ? pendingForRun.peak
      : choosePeakHour(new Map(), config.fallbackHour);
    let metaClient = null;
    let instagramAccount = {
      id: config.metaInstagramAccountId || null,
      username: config.metaInstagramUsername || "vs.store2608",
    };
    if (config.metaPageAccessToken) {
      metaClient = createVsStoreMetaClient(config);
      try {
        peak = await metaClient.audiencePeak({ retryInfo });
      } catch (error) {
        if (!isNetworkError(error)) {
          throw new Error(
            `Meta audience timing failed; no fallback timing is configured: ${normalizeText(error.message)}`,
          );
        } else {
          const recovered = await waitForNetwork({ config, state, runKey, error });
          if (!recovered) {
            process.exitCode = 75;
            return;
          }
          peak = await metaClient.audiencePeak({ retryInfo });
        }
      }
      try {
        const linkedInstagram = await metaClient.instagramAccountReadback({ retryInfo });
        instagramAccount = {
          id: linkedInstagram.id || instagramAccount.id,
          username: linkedInstagram.username || instagramAccount.username,
        };
      } catch (error) {
        if (isNetworkError(error)) throw error;
        throw new Error(
          `Linked Instagram account readback failed; API-only publishing cannot continue: ${normalizeText(error.message)}`,
        );
      }
    }
    const scheduledAt = pendingForRun?.scheduledAt
      ? new Date(pendingForRun.scheduledAt)
      : nextScheduledDateForWeekday(
          now,
          config.timezone,
          peak.hour,
          content.weekday ?? getDailySchedule(now, config.timezone).weekday,
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
    const baseCaption = buildContentCaption(content, config, offerForCaption);
    const captionTemplate = baseCaption;
    const targetUrl = targetUrlForContent(content, config);
    let image = null;
    if (
      pendingForRun?.imagePath &&
      pendingForRun.imageMode === "imagegen" &&
      existsSync(pendingForRun.imagePath)
    ) {
      image = { path: pendingForRun.imagePath, mode: "imagegen" };
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
        facebook: { required: true, pageId: config.metaPageId || null },
        instagram: {
          required: true,
          accountId: instagramAccount.id,
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

    let offer = offerPlan.status === "verified" ? offerPlan : null;
    let caption = offer
      ? buildContentCaption(content, config, { code: offer.code, percent: offer.percent })
      : baseCaption;
    let postResponse;

    if (!metaClient) {
      throw new Error("Meta API credentials are missing; browser fallback has been removed.");
    }

    const apiCannotPublishInstagram =
      !instagramAccount.id ||
      !config.metaInstagramPublicImageUrl ||
      scheduledAt.getTime() > Date.now() + 2 * 60 * 1000;
    if (apiCannotPublishInstagram) {
      throw new Error(
        "Instagram API publishing requires a linked Instagram account, a public image URL, and an immediate API slot; browser fallback has been removed.",
      );
    }

    let instagramResponse;
    let postId = normalizeText(pendingForRun?.metaPost?.id);
    if (!postId) {
      try {
        postResponse = await metaClient.schedulePhoto({
          imagePath: image.path,
          caption,
          scheduledAt,
          retryInfo,
        });
      } catch (error) {
        if (isNetworkError(error)) {
          state = await writeSocialState(rootDir, {
            ...state,
            status: "waiting_for_network",
            pending: { ...pendingBase, captionTemplate: caption, offerPlan: offer },
          });
          const recovered = await waitForNetwork({ config, state, runKey, error });
          if (!recovered) {
            process.exitCode = 75;
            return;
          }
          postResponse = await metaClient.schedulePhoto({
            imagePath: image.path,
            caption,
            scheduledAt,
            retryInfo,
          });
        } else {
          throw error;
        }
      }
      postId = normalizeText(postResponse?.id || postResponse?.post_id);
      if (!postId) throw new Error("Meta publish response did not include a post ID.");
      state = await writeSocialState(rootDir, {
        ...state,
        status: "verifying",
        pending: {
          ...pendingBase,
          captionTemplate: caption,
          offerPlan: offer,
          metaPost: { id: postId },
        },
      });
    }
    const postReadback = await metaClient.postReadback(postId, { retryInfo });
    if (normalizeText(postReadback?.id) !== postId)
      throw new Error("Meta post readback returned an unexpected post ID.");
    if (!postReadback?.permalink_url && !postReadback?.scheduled_publish_time)
      throw new Error("Meta post readback has neither a permalink nor a scheduled publish time.");
    try {
      instagramResponse = await metaClient.publishInstagramPhoto({
        accountId: instagramAccount.id,
        imageUrl: config.metaInstagramPublicImageUrl,
        caption,
        retryInfo,
      });
      const instagramPostId = normalizeText(instagramResponse?.id || instagramResponse?.post_id);
      if (!instagramPostId)
        throw new Error("Instagram publish response did not include a post ID.");
      const instagramReadback = await metaClient.instagramPostReadback(instagramPostId, {
        retryInfo,
      });
      if (normalizeText(instagramReadback?.id) !== instagramPostId)
        throw new Error("Instagram post readback returned an unexpected post ID.");
      if (!instagramReadback?.permalink)
        throw new Error("Instagram post readback did not include a permalink.");
      instagramResponse = { ...instagramReadback, id: instagramPostId };
    } catch (error) {
      throw error;
    }
    const instagramPostId = normalizeText(instagramResponse?.id);
    const historyEntry = {
      runKey,
      kind: content.kind,
      variant: content.variant || null,
      slot: content.slot || null,
      weekday: content.weekday || null,
      weekKey: content.weekKey || null,
      handle: content.handle || null,
      title: contentSummary(content).title,
      selectedAt: content.selectedAt || now.toISOString(),
      publishedAt:
        postReadback.created_time || postReadback.scheduled_publish_time || now.toISOString(),
      postId,
      postUrl: postReadback.permalink_url || null,
      instagramPostId,
      instagramPostUrl: instagramResponse.permalink || null,
      instagramPost: {
        id: instagramPostId,
        url: instagramResponse.permalink,
        publishedAt: instagramResponse.timestamp || now.toISOString(),
      },
      image: { path: image.path, mode: image.mode },
      offer: offer
        ? { code: offer.code, percent: offer.percent, discountId: offer.discountId }
        : null,
      executionPath: "meta-api",
    };
    const completedState = {
      ...recordUsage(state, {
        kind: content.kind,
        handle: content.handle,
        usedAt: historyEntry.publishedAt,
        weekKey: content.weekKey,
      }),
      status: "completed",
      lastRunKey: runKey,
      lastOffer: offer
        ? {
            createdAt: offer.startsAt,
            startsAt: offer.startsAt,
            endsAt: offer.endsAt,
            code: offer.code,
            percent: offer.percent,
            discountId: offer.discountId,
            target: offer.target,
          }
        : state.lastOffer,
      couponRegistry: offer
        ? {
            ...(state.couponRegistry || {}),
            [offer.code]: {
              discountId: offer.discountId,
              code: offer.code,
              percent: offer.percent,
              targetType: offer.target?.type || null,
              startsAt: offer.startsAt,
              endsAt: offer.endsAt,
            },
          }
        : state.couponRegistry || {},
      pending: null,
      destinations: {
        facebook: {
          ...(state.destinations?.facebook || { required: true }),
          lastPostId: postId,
          lastPostUrl: postReadback.permalink_url || null,
        },
        instagram: {
          ...(state.destinations?.instagram || { required: true }),
          required: true,
          accountId: instagramAccount.id,
          username: instagramAccount.username,
          lastPostId: instagramPostId,
          lastPostUrl: instagramResponse.permalink || null,
        },
      },
      history: [historyEntry, ...(Array.isArray(state.history) ? state.history : [])].slice(0, 90),
    };
    await writeSocialState(rootDir, completedState);
    await appendSocialEvent(rootDir, {
      type: "completed",
      runKey,
      executionPath: "meta-api",
      postId,
      instagramPostId,
      discountId: offer?.discountId || null,
    });
    await clearImageGenFiles(rootDir);
    process.stdout.write(
      `VS Store social run completed through Meta API: Facebook ${postReadback.permalink_url || `scheduled post ${postId}`}; Instagram ${instagramResponse.permalink || instagramPostId}\n`,
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
