import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  readImageGenRequest,
  readImageGenResult,
  recordUsage,
  socialPaths,
  writeBrowserFallbackRequest,
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

test("browser fallback writes a durable, token-free request", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "vs-store-social-test-"));
  try {
    await writeBrowserFallbackRequest(rootDir, {
      runKey: "2026-09-18",
      fingerprint: "fingerprint",
      actions: [{ type: "meta.schedule_vs_store_page_post" }],
    });
    const request = JSON.parse(await readFile(socialPaths(rootDir).browserRequest, "utf8"));
    assert.equal(request.status, "pending");
    assert.equal(request.fingerprint, "fingerprint");
    assert.equal(Object.hasOwn(request, "accessToken"), false);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
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
