import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { configMissing, redactedConfig } from "./lib/vs-store-social-config.mjs";
import {
  assessDiscountMargin,
  buildDiscountInput,
  findDiscountByCode,
  SOCIAL_DISCOUNT_BY_CODE_QUERY,
  verifyDiscountReadback,
} from "./lib/vs-store-social-shopify.mjs";
import {
  buildOfferCode,
  buildRunKey,
  getDailySchedule,
  getFridayOfferWindow,
  getWeekKey,
  selectDailyContent,
  shouldAttemptOffer,
} from "./lib/vs-store-social-content.mjs";
import { nextScheduledDate, nextScheduledDateForWeekday } from "./lib/vs-store-social-meta.mjs";
import {
  buildProductCaption,
  buildPromotionCaption,
  extractProductFacts,
  validatePostCopy,
} from "./lib/vs-store-social-copy.mjs";
import { isSocialNetworkError } from "./lib/vs-store-social-network.mjs";
import {
  browserPendingMigrationBlocker,
  isMetaApiPublishWindowPending,
  resolveMetaPagePostId,
} from "./lib/vs-store-social-api-publisher.mjs";
import { createFallbackLogoPng } from "./lib/vs-store-social-image.mjs";
import {
  buildBrowserIntent,
  buildBrowserRequest,
  deriveBrowserResultStatus,
  resolveBrowserPublishMode,
  validateBrowserIntent,
  validateBrowserRequest,
  validateBrowserResult,
} from "./lib/vs-store-social-browser-result-schema.mjs";
import { reconcileBrowserResult } from "./lib/vs-store-social-publish-reconciler.mjs";
import { inspectBusinessSuiteSnapshot } from "./lib/vs-store-social-business-suite-browser.mjs";
import {
  readImageGenRequest,
  readImageGenResult,
  readSocialState,
  recordUsage,
  socialPaths,
  writeImageGenRequest,
  writeImageGenResult,
} from "./lib/vs-store-social-state.mjs";

const config = {
  siteUrl: "https://vss-store.vercel.app",
  timezone: "America/New_York",
  defaultDiscountPercent: 10,
  maxDiscountPercent: 15,
  offerWindowDays: 7,
  offerWeekday: 5,
  primaryDiscountCode: "VSSTORE15",
  fallbackDiscountCode: "VSSTORE10",
  primaryDiscountPercent: 15,
  fallbackDiscountPercent: 10,
  overheadUsd: 16,
  minimumContributionUsd: 10,
};

function browserConfig(rootDir) {
  return {
    rootDir,
    socialOutputDir: join(rootDir, "output", "social"),
    socialPublisher: "business-suite-browser",
    socialLiveEnabled: false,
    socialPublishMode: "now",
    timezone: "America/New_York",
    facebookPageName: "VS Store",
    facebookPageId: "page-123",
    facebookPageUrl: "https://www.facebook.com/vs-store",
    instagramHandle: "vs.store2608",
  };
}

function product(overrides = {}) {
  return {
    id: "gid://shopify/Product/1",
    handle: "funnyjack-aux-audio-cable",
    title: "Funnyjack 3 5mm Aux Audio Cable To Xh2 54 3p Terminal Male To Male",
    vendor: "VS Store",
    productType: "Audio Extension Cord",
    status: "ACTIVE",
    publishedAt: "2026-09-01T00:00:00Z",
    tags: ["audio", "electronic-accessories"],
    featuredImage: { url: "https://cdn.example.test/audio.jpg", altText: "Audio cable" },
    variants: {
      nodes: [
        {
          id: "gid://shopify/ProductVariant/1",
          title: "Default Title",
          price: "60.00",
          inventoryItem: { unitCost: { amount: "20.00", currencyCode: "USD" } },
        },
      ],
    },
    ...overrides,
  };
}

test("audio accessory copy never invents a gender audience", () => {
  const item = product();
  const facts = extractProductFacts(item);
  assert.equal(facts.apparel, false);
  const caption = buildProductCaption(item, config);
  assert.doesNotMatch(caption, /\b(women|womens|female|men|mens|men's|women's)\b/i);
  assert.match(caption, /male-to-male/i);
  assert.match(caption, /3\.5 mm/i);
});

test("non-fashion catalog tags cannot add women or men language", () => {
  const item = product({
    tags: ["women", "camera-accessories"],
    title: "Compact Camera Tripod Stand",
  });
  const caption = buildProductCaption(item, config);
  assert.doesNotMatch(caption, /\b(women|female|men|male)\b/i);
});

test("apparel gender remains available when the product itself supports it", () => {
  const item = product({
    title: "Women's Linen Beach Shirt",
    productType: "Shirt",
    tags: ["women", "linen", "fashion"],
  });
  assert.equal(extractProductFacts(item).apparel, true);
  assert.match(buildProductCaption(item, config), /Women's Linen Beach Shirt/i);
});

test("US weekday schedule selects the approved content lane", () => {
  const catalog = {
    products: [product()],
    collections: [
      {
        id: "gid://shopify/Collection/1",
        handle: "audio",
        title: "Audio Accessories",
        image: { url: "https://cdn.example.test/collection.jpg" },
        products: { nodes: [product()] },
      },
    ],
  };
  assert.equal(
    selectDailyContent({
      catalog,
      state: { usageLedger: {}, history: [] },
      now: new Date("2026-09-18T16:00:00Z"),
      timeZone: config.timezone,
    }).kind,
    "banner",
  );
  assert.equal(
    selectDailyContent({
      catalog,
      state: { usageLedger: {}, history: [] },
      now: new Date("2026-09-19T16:00:00Z"),
      timeZone: config.timezone,
    }).kind,
    "collection",
  );
  assert.equal(
    selectDailyContent({
      catalog,
      state: { usageLedger: {}, history: [] },
      now: new Date("2026-09-21T16:00:00Z"),
      timeZone: config.timezone,
    }).kind,
    "product",
  );
  assert.equal(
    getDailySchedule(new Date("2026-09-18T16:00:00Z"), config.timezone).slot,
    "friday-heartfelt",
  );
  assert.equal(
    getDailySchedule(new Date("2026-09-22T16:00:00Z"), config.timezone).variant,
    "promotion-teaser",
  );
});

test("Friday offer window is Friday midnight through Monday midnight in US time", () => {
  const window = getFridayOfferWindow(new Date("2026-09-18T16:00:00Z"), config.timezone);
  assert.equal(window.startsAt.toISOString(), "2026-09-18T04:00:00.000Z");
  assert.equal(window.endsAt.toISOString(), "2026-09-21T04:00:00.000Z");
  assert.equal(getWeekKey(new Date("2026-09-20T16:00:00Z"), config.timezone), "2026-09-14");
});

test("offer runs only in the Friday heartfelt slot and respects the rolling window", () => {
  const friday = new Date("2026-09-18T16:00:00Z");
  const content = { kind: "banner", variant: "heartfelt" };
  assert.equal(
    shouldAttemptOffer({
      content,
      state: { lastOffer: null },
      now: friday,
      timeZone: config.timezone,
      offerWeekday: 5,
      offerWindowDays: 7,
    }),
    true,
  );
  assert.equal(
    shouldAttemptOffer({
      content,
      state: { lastOffer: { endsAt: "2026-09-21T04:00:00Z" } },
      now: friday,
      timeZone: config.timezone,
      offerWeekday: 5,
      offerWindowDays: 7,
    }),
    false,
  );
  assert.equal(buildPromotionCaption(config).includes("Friday"), true);
});

test("product and collection candidates are not reused within a week when alternatives exist", () => {
  const firstProduct = product({ handle: "first-product" });
  const secondProduct = product({ handle: "second-product", id: "gid://shopify/Product/2" });
  const firstCollection = {
    id: "gid://shopify/Collection/1",
    handle: "first-collection",
    title: "First Collection",
    image: { url: "https://cdn.example.test/collection-1.jpg" },
    products: { nodes: [firstProduct] },
  };
  const secondCollection = {
    id: "gid://shopify/Collection/2",
    handle: "second-collection",
    title: "Second Collection",
    image: { url: "https://cdn.example.test/collection-2.jpg" },
    products: { nodes: [secondProduct] },
  };
  const catalog = {
    products: [firstProduct, secondProduct],
    collections: [firstCollection, secondCollection],
  };
  const weekKey = "2026-09-14";
  const used = recordUsage(
    { usageLedger: { product: {}, collection: {} }, history: [] },
    { kind: "product", handle: "first-product", usedAt: "2026-09-14T12:00:00Z", weekKey },
  );
  const selected = selectDailyContent({
    catalog,
    state: {
      ...used,
      history: [{ kind: "product", handle: "first-product", weekKey }],
    },
    now: new Date("2026-09-16T16:00:00Z"),
    timeZone: config.timezone,
  });
  assert.equal(selected.handle, "second-product");
  const collectionSelected = selectDailyContent({
    catalog,
    state: {
      usageLedger: { collection: { "first-collection": { uses: 1 } } },
      history: [{ kind: "collection", handle: "first-collection", weekKey }],
    },
    now: new Date("2026-09-19T16:00:00Z"),
    timeZone: config.timezone,
  });
  assert.equal(collectionSelected.handle, "second-collection");
});

test("margin gate chooses the highest safe discount", () => {
  const safe = assessDiscountMargin([product()], config);
  assert.equal(safe.eligible, true);
  assert.equal(safe.percent, 15);
  const marginal = assessDiscountMargin(
    [
      product({
        variants: {
          nodes: [
            {
              id: "v",
              price: "60",
              inventoryItem: { unitCost: { amount: "25.10", currencyCode: "USD" } },
            },
          ],
        },
      }),
    ],
    config,
  );
  assert.equal(marginal.eligible, true);
  assert.equal(marginal.percent, 10);
  const unsafe = assessDiscountMargin(
    [
      product({
        variants: {
          nodes: [
            {
              id: "v",
              price: "30",
              inventoryItem: { unitCost: { amount: "20", currencyCode: "USD" } },
            },
          ],
        },
      }),
    ],
    config,
  );
  assert.equal(unsafe.eligible, false);
});

test("discount input scopes a code to the promoted product", () => {
  const input = buildDiscountInput({
    code: "VSWELCOME",
    title: "VS Store 10% welcome offer",
    percent: 10,
    startsAt: "2026-09-18T00:00:00Z",
    endsAt: "2026-09-25T00:00:00Z",
    target: { type: "product", id: "gid://shopify/Product/1" },
  });
  assert.deepEqual(input.customerGets.items.products.productsToAdd, ["gid://shopify/Product/1"]);
  assert.equal(input.customerGets.value.percentage, 0.1);
  assert.equal(input.appliesOncePerCustomer, true);
});

test("discount input can target the whole store", () => {
  const input = buildDiscountInput({
    code: "VSSTORE15",
    title: "VS Store weekly Friday sale",
    percent: 15,
    startsAt: "2026-09-18T04:00:00Z",
    endsAt: "2026-09-21T04:00:00Z",
    target: { type: "all", id: "all" },
  });
  assert.deepEqual(input.customerGets.items, { all: true });
  assert.equal(input.code, "VSSTORE15");
});

test("discount readback requires the approved dates and no stacking", () => {
  const input = buildDiscountInput({
    code: "VSWELCOME",
    title: "VS Store 10% welcome offer",
    percent: 10,
    startsAt: "2026-09-18T00:00:00.000Z",
    endsAt: "2026-09-25T00:00:00.000Z",
    target: { type: "product", id: "gid://shopify/Product/1" },
  });
  const readback = {
    status: "SCHEDULED",
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    appliesOncePerCustomer: true,
    combinesWith: {
      orderDiscounts: false,
      productDiscounts: false,
      shippingDiscounts: false,
    },
    codes: { nodes: [{ code: input.code }] },
    customerGets: {
      value: { percentage: 0.1 },
      items: { products: { nodes: [{ id: "gid://shopify/Product/1" }] } },
    },
  };
  assert.doesNotThrow(() =>
    verifyDiscountReadback(readback, {
      input,
      target: { type: "product", id: "gid://shopify/Product/1" },
      percent: 10,
    }),
  );
  assert.throws(
    () =>
      verifyDiscountReadback(
        { ...readback, combinesWith: null },
        {
          input,
          target: { type: "product", id: "gid://shopify/Product/1" },
          percent: 10,
        },
      ),
    /stacking/i,
  );
});

test("storewide discount readback verifies all-items scope", () => {
  const input = buildDiscountInput({
    code: "VSSTORE15",
    title: "VS Store weekly Friday sale",
    percent: 15,
    startsAt: "2026-09-18T04:00:00.000Z",
    endsAt: "2026-09-21T04:00:00.000Z",
    target: { type: "all", id: "all" },
  });
  assert.doesNotThrow(() =>
    verifyDiscountReadback(
      {
        status: "SCHEDULED",
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        appliesOncePerCustomer: true,
        combinesWith: {
          orderDiscounts: false,
          productDiscounts: false,
          shippingDiscounts: false,
        },
        codes: { nodes: [{ code: input.code }] },
        customerGets: {
          value: { percentage: 0.15 },
          items: { allItems: true },
        },
      },
      { input, target: { type: "all", id: "all" }, percent: 15 },
    ),
  );
});

test("partial discount writes reconcile by the deterministic code", async () => {
  const expectedId = "gid://shopify/DiscountCodeNode/42";
  const calls = [];
  const client = {
    async run(query, variables) {
      calls.push({ query, variables });
      return {
        discountNodes: {
          nodes: [
            {
              id: expectedId,
              discount: { codes: { nodes: [{ code: variables.query.slice(5) }] } },
            },
          ],
        },
      };
    },
  };
  assert.equal(await findDiscountByCode(client, "VSWELCOME"), expectedId);
  assert.equal(calls[0].query, SOCIAL_DISCOUNT_BY_CODE_QUERY);
  assert.equal(calls[0].variables.query, "code:VSWELCOME");
});

test("Image Gen handoff stays durable and token-free", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "vs-store-imagegen-test-"));
  try {
    const imagePath = join(rootDir, "output", "social", "assets", "2026-09-14", "creative.png");
    await mkdir(join(rootDir, "output", "social", "assets", "2026-09-14"), { recursive: true });
    await writeFile(imagePath, Buffer.alloc(1024, 7));
    await writeImageGenRequest(rootDir, {
      runKey: "2026-09-14",
      fingerprint: "image-fingerprint",
      referenceImagePaths: ["/tmp/logo.png"],
      outputPath: imagePath,
    });
    await writeImageGenResult(rootDir, {
      runKey: "2026-09-14",
      fingerprint: "image-fingerprint",
      image: { verified: true, path: imagePath, mode: "imagegen" },
    });
    const request = await readImageGenRequest(rootDir);
    const result = await readImageGenResult(rootDir);
    assert.equal(request.status, "pending");
    assert.equal(result.status, "success");
    assert.equal(result.image.path, imagePath);
    assert.equal(Object.hasOwn(request, "accessToken"), false);
    assert.equal(Object.hasOwn(result, "accessToken"), false);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("legacy browser-wait state migrates to the durable browser handoff", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "vs-store-social-state-test-"));
  try {
    await mkdir(join(rootDir, "output", "social"), { recursive: true });
    await writeFile(
      socialPaths(rootDir).state,
      JSON.stringify({
        schemaVersion: 3,
        status: "waiting_for_browser",
        pending: { runKey: "2026-09-18", offerPlan: { status: "browser-required" } },
      }),
      "utf8",
    );
    const state = await readSocialState(rootDir);
    assert.equal(state.schemaVersion, 5);
    assert.equal(state.status, "waiting_for_browser");
    assert.equal(state.pending.runKey, "2026-09-18");
    assert.equal(state.error, null);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("legacy API-only failure resumes the preserved Image Gen handoff", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "vs-store-social-legacy-failure-test-"));
  try {
    await mkdir(join(rootDir, "output", "social"), { recursive: true });
    await writeFile(
      socialPaths(rootDir).state,
      JSON.stringify({
        schemaVersion: 4,
        status: "failed",
        error: "Meta API credentials are missing; browser fallback has been removed.",
        pending: {
          runKey: "2026-09-20",
          content: { kind: "collection", handle: "kids-footwear" },
          imageGenRequest: { fingerprint: "preserved-imagegen-request" },
        },
      }),
      "utf8",
    );
    const state = await readSocialState(rootDir);
    assert.equal(state.schemaVersion, 5);
    assert.equal(state.status, "waiting_for_imagegen");
    assert.equal(state.error, null);
    assert.equal(state.pending.imageGenRequest.fingerprint, "preserved-imagegen-request");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("browser mode has no Meta token or public-image-URL dependency", () => {
  const browserMode = {
    ...browserConfig("/tmp/vs-store-social"),
    storeDomain: "vs-store-us.myshopify.com",
    shopifyUseCli: true,
    browserSession: "vs-store-social",
    browserProfileDir: "/tmp/vs-store-social-browser",
    businessSuiteUrl: "https://business.facebook.com/",
  };
  const missing = configMissing(browserMode);
  assert.equal(
    missing.some((item) => /META_PAGE_ACCESS_TOKEN|PUBLIC_IMAGE_URL/i.test(item)),
    false,
  );
  assert.equal(redactedConfig(browserMode).metaApiPublishingDisabled, true);
  assert.equal(redactedConfig(browserMode).metaInstagramPublicImageIgnored, true);
});

test("Meta API primary accepts the linked Page without implicit browser fallback", () => {
  const metaMode = {
    ...browserConfig("/tmp/vs-store-social"),
    socialPublisher: "meta-api-primary",
    metaPageId: "page-123",
    metaPageAccessToken: "redacted-token",
    metaInstagramAccountId: "ig-123",
    metaImageSource: "facebook-post",
    businessSuiteUrl: "https://business.facebook.com/",
    browserSession: "vs-store-social",
    browserProfileDir: "/tmp/vs-store-social-browser",
    storeDomain: "vs-store-us.myshopify.com",
    shopifyUseCli: true,
  };
  assert.deepEqual(configMissing(metaMode, { includeShopify: false }), []);
  assert.equal(redactedConfig(metaMode).metaApiPublishingDisabled, false);
  assert.equal(redactedConfig(metaMode).metaApiFallbackEnabled, false);
  assert.equal(redactedConfig(metaMode).metaInstagramPublicImageIgnored, true);
});

test("Meta API waits for a future publish slot instead of creating a browser schedule", () => {
  const now = new Date("2026-09-23T09:00:00.000Z");
  assert.equal(isMetaApiPublishWindowPending("2026-09-23T16:00:00.000Z", { now }), true);
  assert.equal(isMetaApiPublishWindowPending("2026-09-23T09:01:00.000Z", { now }), false);
  assert.equal(isMetaApiPublishWindowPending("invalid", { now }), false);
});

test("Meta photo upload readback prefers the Page post ID over the uploaded photo ID", () => {
  assert.equal(
    resolveMetaPagePostId({ id: "uploaded-photo-id", post_id: "page-id_post-id" }),
    "page-id_post-id",
  );
  assert.equal(resolveMetaPagePostId({ id: "page-post-id" }), "page-post-id");
  assert.equal(resolveMetaPagePostId({}), "");
});

test("moving an untouched browser handoff to API is guarded against duplicate submission", () => {
  const pending = {
    runKey: "2026-09-23",
    browserRequestPath: "/output/social/browser-request.json",
    browserRequestFingerprint: "request-fingerprint",
    platformStates: {
      facebook: { status: "not_started" },
      instagram: { status: "not_started" },
    },
  };
  const request = {
    runKey: pending.runKey,
    fingerprint: pending.browserRequestFingerprint,
    facebookPageId: "page-123",
    instagramHandle: "vs.store2608",
  };
  const migration = {
    stateStatus: "waiting_for_browser",
    pending,
    request,
    intent: null,
    result: null,
    hasExternalAttempt: false,
    facebookPageId: "page-123",
    instagramHandle: "vs.store2608",
  };
  assert.equal(browserPendingMigrationBlocker(migration), null);
  assert.match(
    browserPendingMigrationBlocker({ ...migration, intent: { attemptId: "submitted" } }),
    /browser submit intent or result/i,
  );
  assert.match(
    browserPendingMigrationBlocker({ ...migration, hasExternalAttempt: true }),
    /external submit/i,
  );
  assert.match(
    browserPendingMigrationBlocker({
      ...migration,
      pending: {
        ...pending,
        platformStates: { facebook: { status: "published" } },
      },
    }),
    /not untouched/i,
  );
});

test("browser mode schedules a future best-time slot and posts directly after it", () => {
  const now = new Date("2026-09-20T18:45:00.000Z");
  assert.equal(
    resolveBrowserPublishMode(new Date("2026-09-20T20:00:00.000Z"), { now }),
    "scheduled",
  );
  assert.equal(resolveBrowserPublishMode(new Date("2026-09-20T16:00:00.000Z"), { now }), "now");
  assert.equal(resolveBrowserPublishMode(new Date("2026-09-20T18:46:00.000Z"), { now }), "now");
});

test("Business Suite preflight requires the exact Page and connected Instagram", () => {
  const browserMode = browserConfig("/tmp/vs-store-social");
  const ready = inspectBusinessSuiteSnapshot({
    url: "https://business.facebook.com/latest/home",
    title: "Meta Business Suite",
    snapshot: "VS Store page-123 @vs.store2608 Create Post",
    config: browserMode,
  });
  assert.equal(ready.status, "ready");
  const mismatch = inspectBusinessSuiteSnapshot({
    url: "https://business.facebook.com/latest/home",
    title: "Meta Business Suite",
    snapshot: "Other Page @other-account Create Post",
    config: browserMode,
  });
  assert.equal(mismatch.status, "identity_mismatch");
});

test("browser request freezes one local asset and caption for both destinations", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "vs-store-browser-request-test-"));
  const previousOutputDir = process.env.VS_STORE_SOCIAL_OUTPUT_DIR;
  try {
    const config = browserConfig(rootDir);
    process.env.VS_STORE_SOCIAL_OUTPUT_DIR = config.socialOutputDir;
    const imagePath = join(config.socialOutputDir, "assets", "2026-09-20", "creative.png");
    await mkdir(join(config.socialOutputDir, "assets", "2026-09-20"), { recursive: true });
    await writeFile(imagePath, createFallbackLogoPng());
    const { request, image } = await buildBrowserRequest({
      config,
      runKey: "2026-09-20",
      imagePath,
      caption: "VS Store verified browser caption",
      content: { kind: "product", handle: "sample-product", title: "Sample Product" },
      scheduledAt: new Date(Date.now() + 60_000),
      expiresAt: new Date(Date.now() + 3_600_000),
      offerPlan: { status: "not-requested" },
    });
    assert.equal(request.allowedPlatforms.join(","), "facebook,instagram");
    assert.equal(request.imageSha256, image.sha256);
    assert.equal(request.captionSha256.length, 64);
    assert.doesNotThrow(() => validateBrowserRequest(request, config));
    assert.equal(request.imagePath.startsWith(config.socialOutputDir), true);
    assert.equal(request.captionPath.startsWith(config.socialOutputDir), true);
    const intent = buildBrowserIntent({
      request,
      attemptId: "attempt-1",
      platforms: ["instagram"],
    });
    assert.doesNotThrow(() => validateBrowserIntent(intent, request));
    assert.throws(
      () => buildBrowserIntent({ request, attemptId: "attempt-2", platforms: ["tiktok"] }),
      /allowed platforms/i,
    );
    const { request: instagramRetry } = await buildBrowserRequest({
      config,
      runKey: "2026-09-20",
      revision: 2,
      imagePath,
      caption: "VS Store verified browser caption",
      content: { kind: "product", handle: "sample-product", title: "Sample Product" },
      scheduledAt: new Date(Date.now() + 60_000),
      expiresAt: new Date(Date.now() + 3_600_000),
      offerPlan: { status: "not-requested" },
      allowedPlatforms: ["instagram"],
    });
    assert.deepEqual(instagramRetry.allowedPlatforms, ["instagram"]);
    assert.doesNotThrow(() => validateBrowserRequest(instagramRetry, config));
  } finally {
    if (previousOutputDir === undefined) delete process.env.VS_STORE_SOCIAL_OUTPUT_DIR;
    else process.env.VS_STORE_SOCIAL_OUTPUT_DIR = previousOutputDir;
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("browser results require independent receipts and classify partial or ambiguous submits", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "vs-store-browser-result-test-"));
  const previousOutputDir = process.env.VS_STORE_SOCIAL_OUTPUT_DIR;
  try {
    const config = browserConfig(rootDir);
    process.env.VS_STORE_SOCIAL_OUTPUT_DIR = config.socialOutputDir;
    const imagePath = join(config.socialOutputDir, "assets", "2026-09-20", "creative.png");
    const evidenceDir = join(config.socialOutputDir, "evidence");
    await mkdir(join(config.socialOutputDir, "assets", "2026-09-20"), { recursive: true });
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(imagePath, createFallbackLogoPng());
    const { request } = await buildBrowserRequest({
      config,
      runKey: "2026-09-20",
      imagePath,
      caption: "Same caption on both platforms",
      content: { kind: "banner", variant: "heartfelt", title: "Friday" },
      scheduledAt: new Date(Date.now() + 60_000),
      expiresAt: new Date(Date.now() + 3_600_000),
      offerPlan: { status: "not-requested" },
    });
    const evidencePath = join(evidenceDir, "attempt-1.json");
    await writeFile(evidencePath, "redacted browser evidence\n", "utf8");
    const result = {
      schemaVersion: 1,
      runKey: request.runKey,
      requestFingerprint: request.fingerprint,
      attemptId: "attempt-1",
      recordedAt: new Date().toISOString(),
      verifiedAt: new Date().toISOString(),
      status: "success",
      platforms: {
        facebook: {
          status: "published",
          id: "fb-post-1",
          url: "https://www.facebook.com/vs-store/posts/fb-post-1",
          pageId: request.facebookPageId,
          captionSha256: request.captionSha256,
          imageSha256: request.imageSha256,
          evidencePath,
        },
        instagram: {
          status: "published",
          id: "ig-post-1",
          url: "https://www.instagram.com/p/ig-post-1/",
          handle: request.instagramHandle,
          captionSha256: request.captionSha256,
          imageSha256: request.imageSha256,
          evidencePath,
        },
      },
    };
    assert.doesNotThrow(() => validateBrowserResult(result, request, config));
    assert.equal(
      deriveBrowserResultStatus({
        facebook: { status: "published" },
        instagram: { status: "known_failed" },
      }),
      "partial",
    );
    assert.equal(
      deriveBrowserResultStatus({
        facebook: { status: "unknown" },
        instagram: { status: "not_started" },
      }),
      "needs_review",
    );
    await assert.rejects(
      () => validateBrowserResult({ ...result, status: "partial" }, request, config),
      /does not match platform receipts/i,
    );
  } finally {
    if (previousOutputDir === undefined) delete process.env.VS_STORE_SOCIAL_OUTPUT_DIR;
    else process.env.VS_STORE_SOCIAL_OUTPUT_DIR = previousOutputDir;
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("browser reconciliation completes only after both receipts are independently verified", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "vs-store-browser-reconcile-test-"));
  const previousOutputDir = process.env.VS_STORE_SOCIAL_OUTPUT_DIR;
  try {
    const config = browserConfig(rootDir);
    process.env.VS_STORE_SOCIAL_OUTPUT_DIR = config.socialOutputDir;
    const imagePath = join(config.socialOutputDir, "assets", "2026-09-20", "creative.png");
    const evidenceDir = join(config.socialOutputDir, "evidence");
    await mkdir(join(config.socialOutputDir, "assets", "2026-09-20"), { recursive: true });
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(imagePath, createFallbackLogoPng());
    const { request } = await buildBrowserRequest({
      config,
      runKey: "2026-09-20",
      imagePath,
      caption: "Verified caption",
      content: { kind: "product", handle: "sample-product", title: "Sample Product" },
      scheduledAt: new Date(Date.now() + 60_000),
      expiresAt: new Date(Date.now() + 3_600_000),
      offerPlan: { status: "not-requested" },
    });
    const evidencePath = join(evidenceDir, "attempt-1.json");
    await writeFile(evidencePath, "redacted evidence\n", "utf8");
    const receipt = (status, extra = {}) => ({
      status,
      ...extra,
      captionSha256: request.captionSha256,
      imageSha256: request.imageSha256,
      evidencePath,
    });
    const result = {
      schemaVersion: 1,
      runKey: request.runKey,
      requestFingerprint: request.fingerprint,
      attemptId: "attempt-1",
      recordedAt: new Date().toISOString(),
      verifiedAt: new Date().toISOString(),
      status: "success",
      platforms: {
        facebook: receipt("published", {
          id: "fb-1",
          url: "https://facebook.com/fb-1",
          pageId: request.facebookPageId,
        }),
        instagram: receipt("published", {
          id: "ig-1",
          url: "https://instagram.com/p/ig-1",
          handle: request.instagramHandle,
        }),
      },
    };
    const state = {
      schemaVersion: 5,
      status: "waiting_for_browser",
      usageLedger: { product: {}, collection: {} },
      history: [],
      destinations: { facebook: { required: true }, instagram: { required: true } },
      pending: {
        runKey: request.runKey,
        browserRequestFingerprint: request.fingerprint,
        content: { kind: "product", handle: "sample-product", title: "Sample Product" },
        selectedAt: new Date().toISOString(),
        imageMode: "imagegen",
        offerPlan: { status: "not-requested" },
      },
    };
    const reconciled = await reconcileBrowserResult({ rootDir, config, state, request, result });
    assert.equal(reconciled.state.status, "completed");
    assert.equal(reconciled.state.pending, null);
    assert.equal(reconciled.state.history[0].executionPath, "business-suite-browser");
    assert.equal(reconciled.state.usageLedger.product["sample-product"].uses, 1);
  } finally {
    if (previousOutputDir === undefined) delete process.env.VS_STORE_SOCIAL_OUTPUT_DIR;
    else process.env.VS_STORE_SOCIAL_OUTPUT_DIR = previousOutputDir;
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("DNS, timeout, and rate-limit failures enter the retry class", () => {
  assert.equal(isSocialNetworkError({ code: "EAI_AGAIN", message: "DNS lookup failed" }), true);
  assert.equal(isSocialNetworkError({ code: "ETIMEDOUT", message: "request timed out" }), true);
  assert.equal(isSocialNetworkError({ status: 429, message: "rate limited" }), true);
  assert.equal(isSocialNetworkError({ status: 401, message: "invalid access token" }), false);
});

test("scheduled time uses the configured US timezone and fallback hour", () => {
  const now = new Date("2026-09-13T20:00:00Z");
  const scheduled = nextScheduledDate(now, config.timezone, 12);
  assert.equal(buildRunKey(now, config.timezone), "2026-09-13");
  assert.equal(scheduled.toISOString(), "2026-09-14T16:00:00.000Z");
  const weekdayScheduled = nextScheduledDateForWeekday(
    new Date("2026-09-17T12:00:00Z"),
    config.timezone,
    12,
    5,
  );
  assert.equal(weekdayScheduled.toISOString(), "2026-09-18T16:00:00.000Z");
});

test("caption validator rejects raw catalog labels and offer codes stay deterministic", () => {
  assert.throws(() => validatePostCopy("Brand Name: KOQZM\n\nSource Specifications: none", {}));
  assert.equal(
    buildOfferCode("2026-09-18", "gid://shopify/Product/1"),
    buildOfferCode("2026-09-18", "gid://shopify/Product/1"),
  );
});
