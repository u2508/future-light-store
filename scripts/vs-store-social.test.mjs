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
  selectDailyContent,
  shouldAttemptOffer,
} from "./lib/vs-store-social-content.mjs";
import { nextScheduledDate } from "./lib/vs-store-social-meta.mjs";
import {
  buildProductCaption,
  extractProductFacts,
  validatePostCopy,
} from "./lib/vs-store-social-copy.mjs";
import { isSocialNetworkError } from "./lib/vs-store-social-network.mjs";
import {
  readImageGenRequest,
  readImageGenResult,
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

test("rotation selects product, collection, then banner", () => {
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
  const now = new Date("2026-09-13T12:00:00Z");
  assert.equal(
    selectDailyContent({
      catalog,
      state: { nextRotation: 0, history: [] },
      now,
      timeZone: config.timezone,
    }).kind,
    "product",
  );
  assert.equal(
    selectDailyContent({
      catalog,
      state: { nextRotation: 1, history: [] },
      now,
      timeZone: config.timezone,
    }).kind,
    "collection",
  );
  assert.equal(
    selectDailyContent({
      catalog,
      state: { nextRotation: 2, history: [] },
      now,
      timeZone: config.timezone,
    }).kind,
    "banner",
  );
});

test("offer runs only on the configured weekday and rolling window", () => {
  const friday = new Date("2026-09-18T16:00:00Z");
  const content = { kind: "product", id: "gid://shopify/Product/1", handle: "item" };
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
      state: { lastOffer: { createdAt: "2026-09-14T00:00:00Z" } },
      now: friday,
      timeZone: config.timezone,
      offerWeekday: 5,
      offerWindowDays: 7,
    }),
    false,
  );
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
});

test("caption validator rejects raw catalog labels and offer codes stay deterministic", () => {
  assert.throws(() => validatePostCopy("Brand Name: KOQZM\n\nSource Specifications: none", {}));
  assert.equal(
    buildOfferCode("2026-09-18", "gid://shopify/Product/1"),
    buildOfferCode("2026-09-18", "gid://shopify/Product/1"),
  );
});
