import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  FUTURE_LIGHT_CDN_PATH_PREFIX,
  assertFutureLightCatalog,
  buildImageAudit,
  buildProductImageAudit,
  inspectImageBytes,
  isFutureLightImageUrl,
} from "./lib/product-image-health.mjs";
import { probeImageUrl, runImageHealthQueue } from "./shopify-image-health-queue.mjs";

const imageUrl = (name) =>
  `https://cdn.shopify.com${FUTURE_LIGHT_CDN_PATH_PREFIX}files/${name}.webp`;

function webpVp8x(width, height, byteLength = 30) {
  const bytes = Buffer.alloc(Math.max(30, byteLength));
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WEBP", 8, "ascii");
  bytes.write("VP8X", 12, "ascii");
  bytes.writeUInt32LE(bytes.length - 22, 16);
  bytes[24] = (width - 1) & 0xff;
  bytes[25] = ((width - 1) >> 8) & 0xff;
  bytes[26] = ((width - 1) >> 16) & 0x3f;
  bytes[27] = (height - 1) & 0xff;
  bytes[28] = ((height - 1) >> 8) & 0xff;
  bytes[29] = ((height - 1) >> 16) & 0x3f;
  return bytes;
}

function product(handle, image, variant = {}) {
  return {
    id: handle === "good" ? 1 : 2,
    handle,
    title: `${handle} product`,
    vendor: "VS Store",
    images: [image],
    variants: [{ id: `${handle}-variant`, title: "Default Title", ...variant }],
  };
}

test("keeps the Future Light scope explicit and rejects another vendor", () => {
  assert.equal(isFutureLightImageUrl(imageUrl("in-scope")), true);
  assert.equal(
    isFutureLightImageUrl("https://cdn.shopify.com/s/files/1/other-store/files/x.webp"),
    false,
  );
  assert.doesNotThrow(() => assertFutureLightCatalog([{ vendor: "VS Store" }]));
  assert.throws(
    () => assertFutureLightCatalog([{ vendor: "another-store", handle: "outside" }]),
    /non-VS Store/,
  );
});

test("parses WebP dimensions and catches a too-small primary image", () => {
  const bytes = webpVp8x(80, 80);
  assert.deepEqual(inspectImageBytes(bytes).format, "webp");
  assert.deepEqual(inspectImageBytes(bytes).width, 80);
  assert.deepEqual(inspectImageBytes(bytes).height, 80);
  const audit = buildImageAudit(
    {
      id: "image-1",
      url: imageUrl("tiny"),
      alt: "Tiny",
      width: 80,
      height: 80,
    },
    {
      primary: true,
      probe: {
        status: "ok",
        format: "webp",
        width: 80,
        height: 80,
        byteLength: bytes.length,
        issues: [],
      },
    },
  );
  assert.equal(audit.blocking, true);
  assert.equal(
    audit.issues.some((issue) => issue.code === "primary-low-resolution"),
    true,
  );
  assert.equal(
    audit.issues.some((issue) => issue.code === "primary-extreme-aspect-ratio"),
    false,
  );
});

test("queues broken associations and foreign URLs without probing them", () => {
  const audited = buildProductImageAudit(
    {
      id: 3,
      handle: "association-test",
      title: "Association test",
      vendor: "VS Store",
      images: [
        { id: 10, src: imageUrl("good"), width: 800, height: 800, alt: "Good" },
        {
          id: 11,
          src: "https://example.invalid/foreign.webp",
          width: 800,
          height: 800,
          alt: "Foreign",
        },
      ],
      variants: [
        { id: 30, image_id: 999, title: "Red" },
        { id: 31, title: "Blue" },
      ],
    },
    { maxImages: 10 },
  );
  assert.equal(
    audited.issues.some((issue) => issue.code === "foreign-image-url"),
    true,
  );
  assert.equal(
    audited.issues.some((issue) => issue.code === "broken-variant-association"),
    true,
  );
  assert.equal(
    audited.issues.some((issue) => issue.code === "missing-variant-image-association"),
    true,
  );
  assert.equal(
    audited.repairQueue.every((item) => item.automaticAction === "none"),
    true,
  );
  assert.equal(
    audited.repairQueue.every((item) => item.requiresApprovedSource),
    true,
  );
});

test("accepts an exact product-media URL when Shopify exposes a legacy variant image ID", () => {
  const url = imageUrl("legacy-id-same-url");
  const audited = buildProductImageAudit(
    {
      id: 4,
      handle: "legacy-image-id",
      title: "Legacy image ID product",
      vendor: "VS Store",
      images: [{ id: 200, src: url, width: 800, height: 800, alt: "Product" }],
      variants: [{ id: 40, image_id: 999200, featured_image: { src: url }, title: "Blue" }],
    },
    { maxImages: 10 },
  );
  assert.equal(
    audited.issues.some((issue) => issue.code === "broken-variant-association"),
    false,
  );
  assert.equal(
    audited.issues.some((issue) => issue.code === "variant-image-url-not-in-product-media"),
    false,
  );
  assert.equal(
    audited.issues.some((issue) => issue.code === "variant-points-to-unhealthy-image"),
    false,
  );
});

test("records invalid remote bytes as a broken image", async () => {
  const response = new Response(Buffer.from("not an image"), {
    status: 200,
    headers: { "content-type": "image/webp" },
  });
  Object.defineProperty(response, "url", { value: imageUrl("broken") });
  const probe = await probeImageUrl(imageUrl("broken"), {
    attempts: 1,
    fetchImpl: async () => response,
    sleepImpl: async () => undefined,
  });
  assert.equal(probe.status, "ok");
  assert.equal(
    probe.issues.some((issue) => issue.code === "unsupported-image-format"),
    true,
  );
});

test("never probes an image URL outside the Future Light scope", async () => {
  let fetchCalled = false;
  const probe = await probeImageUrl("https://example.invalid/outside.webp", {
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error("should not fetch");
    },
  });
  assert.equal(probe.status, "out-of-scope");
  assert.equal(fetchCalled, false);
});

test("resumes by product and preserves the bounded queue", async () => {
  const directory = await mkdtemp(join(tmpdir(), "future-light-image-health-"));
  try {
    const dataDir = join(directory, "data");
    const output = join(directory, "queue.json");
    const checkpoint = join(directory, "checkpoint.json");
    const goodUrl = imageUrl("good");
    const badUrl = imageUrl("bad");
    await mkdir(dataDir, { recursive: true });
    await writeFile(
      join(dataDir, "products.json"),
      JSON.stringify({
        products: [
          product("good", { id: 101, src: goodUrl, width: 800, height: 800, alt: "Good" }),
          product("bad", { id: 102, src: badUrl, width: 80, height: 80, alt: "" }),
        ],
      }),
    );

    let fetchCount = 0;
    const fetchImpl = async (url) => {
      fetchCount += 1;
      const response = new Response(
        webpVp8x(
          url === goodUrl ? 800 : 80,
          url === goodUrl ? 800 : 80,
          url === goodUrl ? 1200 : 30,
        ),
        {
          status: 200,
          headers: { "content-type": "image/webp" },
        },
      );
      Object.defineProperty(response, "url", { value: url });
      return response;
    };
    const baseArgs = {
      inputDir: dataDir,
      output,
      checkpoint,
      limit: 1,
      maxImagesPerProduct: 10,
      concurrency: 1,
      timeoutMs: 1000,
      attempts: 1,
      maxProbeBytes: 1024 * 1024,
      probe: true,
      retryFailed: true,
      handles: [],
    };
    const first = await runImageHealthQueue(baseArgs, {
      fetchImpl,
      sleepImpl: async () => undefined,
    });
    assert.equal(first.status, "paused");
    assert.equal(first.summary.productsAudited, 1);
    assert.equal(first.summary.remainingProducts, 1);
    const second = await runImageHealthQueue(
      { ...baseArgs, resume: true },
      { fetchImpl, sleepImpl: async () => undefined },
    );
    assert.equal(second.status, "complete");
    assert.equal(second.summary.productsAudited, 2);
    assert.equal(second.summary.productsNeedsRetry, 0);
    assert.equal(
      second.repairQueue.some(
        (item) => item.handle === "bad" && item.issueCode === "primary-low-resolution",
      ),
      true,
    );
    assert.equal(fetchCount, 2);
    assert.equal(JSON.parse(await readFile(checkpoint, "utf8")).scope, "future-light-store");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
