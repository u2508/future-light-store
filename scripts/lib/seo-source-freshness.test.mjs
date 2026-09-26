import test from "node:test";
import assert from "node:assert/strict";
import {
  assertSeoManifestSourceFreshness,
  auditSeoManifestSourceFreshness,
  bindSeoSourceSnapshot,
  fingerprintSeoSource,
} from "./seo-source-freshness.mjs";

function product(overrides = {}) {
  return {
    id: "gid://shopify/Product/42",
    handle: "blue-mug",
    title: "Blue Ceramic Mug",
    descriptionHtml: "<p>A blue ceramic mug for everyday drinks.</p>",
    productType: "Drinkware",
    options: [{ name: "Color", position: 1, values: ["Blue", "White"] }],
    variants: {
      nodes: [
        {
          id: "gid://shopify/ProductVariant/4201",
          title: "Blue",
          sku: "MUG-BLU",
          selectedOptions: [{ name: "Color", value: "Blue" }],
          image: { id: "gid://shopify/MediaImage/9001", url: "https://cdn.example/mug-blue.jpg" },
        },
      ],
      pageInfo: { hasNextPage: false },
    },
    images: {
      nodes: [{ id: "gid://shopify/MediaImage/9001", url: "https://cdn.example/mug-blue.jpg", altText: "Blue mug" }],
      pageInfo: { hasNextPage: false },
    },
    ...overrides,
  };
}

function manifestItem(source, overrides = {}) {
  return {
    handle: source.handle,
    productId: source.id,
    sourceTitle: source.title,
    ...fingerprintSeoSource(source),
    desired: { title: "Blue Ceramic Mug", descriptionHtml: source.descriptionHtml },
    status: "pending",
    ...overrides,
  };
}

test("accepts the exact current source preimage and produces a deterministic digest", () => {
  const source = product();
  const item = manifestItem(source);
  assert.match(item.sourceFingerprint, /^future-light-seo-source-v1:sha256:[a-f0-9]{64}$/);
  assert.deepEqual(fingerprintSeoSource(source), fingerprintSeoSource(structuredClone(source)));
  assert.deepEqual(auditSeoManifestSourceFreshness([source], [item]), { checked: 1, issues: [] });
  assert.deepEqual(assertSeoManifestSourceFreshness([source], [item]), { checked: 1, issues: [] });
});

test("fingerprints equivalent Shopify GraphQL and REST source shapes identically", () => {
  const graphql = product();
  const rest = {
    id: 42,
    handle: "blue-mug",
    title: "Blue Ceramic Mug",
    body_html: "<p>A blue ceramic mug for everyday drinks.</p>",
    product_type: "Drinkware",
    options: [{ name: "Color", position: 1, values: ["Blue", "White"] }],
    variants: [{
      id: 4201,
      title: "Blue",
      sku: "MUG-BLU",
      option1: "Blue",
      featured_image: { id: 9001, src: "https://cdn.example/mug-blue.jpg" },
    }],
    images: [{ id: 9001, src: "https://cdn.example/mug-blue.jpg", alt: "Blue mug", variant_ids: [4201] }],
  };
  assert.deepEqual(fingerprintSeoSource(graphql), fingerprintSeoSource(rest));
});

test("rejects stale source title, body, product type, option, variant, and media references", () => {
  const source = product();
  const item = manifestItem(source);
  const mutations = [
    ["stale-source-title", { title: "Blue Porcelain Mug" }],
    ["stale-source-fingerprint", { descriptionHtml: "<p>A different source description.</p>" }],
    ["stale-source-fingerprint", { productType: "Kitchenware" }],
    ["stale-source-fingerprint", { options: [{ name: "Size", position: 1, values: ["Small"] }] }],
    ["stale-source-fingerprint", {
      variants: {
        ...source.variants,
        nodes: [{ ...source.variants.nodes[0], selectedOptions: [{ name: "Color", value: "Red" }] }],
      },
    }],
    ["stale-source-fingerprint", {
      images: {
        ...source.images,
        nodes: [{ ...source.images.nodes[0], url: "https://cdn.example/mug-red.jpg" }],
      },
    }],
  ];
  for (const [reason, change] of mutations) {
    const changed = product(change);
    const audit = auditSeoManifestSourceFreshness([changed], [item]);
    assert.equal(audit.issues[0]?.reason, reason, JSON.stringify(change));
  }
});

test("rejects reused handles whose product identity changes", () => {
  const source = product();
  const audit = auditSeoManifestSourceFreshness(
    [product({ id: "gid://shopify/Product/43" })],
    [manifestItem(source)],
  );
  assert.equal(audit.issues[0]?.reason, "product-id-mismatch");
});

test("fails closed when a prior manifest has no source fingerprints", () => {
  const source = product();
  const oldItem = { handle: source.handle, productId: source.id, sourceTitle: source.title };
  assert.equal(auditSeoManifestSourceFreshness([source], [oldItem]).issues[0]?.reason, "missing-source-fingerprint");
  assert.throws(() => assertSeoManifestSourceFreshness([source], [oldItem]), /missing or stale/);
});

test("rejects duplicate manifest identity rows instead of choosing an arbitrary preimage", () => {
  const source = product();
  const item = manifestItem(source);
  const audit = auditSeoManifestSourceFreshness([source], [item, { ...item }]);
  assert.ok(audit.issues.some(({ reason }) => reason === "duplicate-manifest-handle"));
  assert.ok(audit.issues.some(({ reason }) => reason === "duplicate-manifest-product-id"));
});

test("accepts only an exact verified title/body write with unchanged structure", () => {
  const source = product();
  const desired = {
    title: "Blue Ceramic Coffee Mug",
    descriptionHtml: "<p>A blue ceramic coffee mug for hot and cold drinks.</p>",
  };
  const item = manifestItem(source, { desired, status: "verified" });
  const applied = product({ title: desired.title, descriptionHtml: desired.descriptionHtml });
  assert.deepEqual(auditSeoManifestSourceFreshness([applied], [item]), { checked: 1, issues: [] });

  const externalChange = product({
    title: desired.title,
    descriptionHtml: "<p>Someone changed this product description.</p>",
  });
  assert.equal(auditSeoManifestSourceFreshness([externalChange], [item]).issues[0]?.reason, "stale-source-fingerprint");

  const structureChange = product({
    title: desired.title,
    descriptionHtml: desired.descriptionHtml,
    productType: "Unrelated category",
  });
  assert.equal(auditSeoManifestSourceFreshness([structureChange], [item]).issues[0]?.reason, "stale-source-fingerprint");
});

test("fails closed rather than fingerprinting truncated variant or media connections", () => {
  const source = product({
    variants: { ...product().variants, pageInfo: { hasNextPage: true } },
  });
  assert.throws(() => fingerprintSeoSource(source), /incomplete \(variants\)/);
  assert.equal(
    auditSeoManifestSourceFreshness([source], [manifestItem(product())]).issues[0]?.reason,
    "incomplete-source-preimage:variants",
  );

  const truncatedImages = product({
    images: { ...product().images, pageInfo: { hasNextPage: true } },
  });
  assert.throws(() => fingerprintSeoSource(truncatedImages), /incomplete \(images\)/);
});

test("does not invent fingerprints for source fields that are absent", () => {
  const minimal = { id: "42", handle: "minimal", title: "Minimal source" };
  const fingerprint = fingerprintSeoSource(minimal);
  assert.equal(typeof fingerprint.sourceFingerprint, "string");
  assert.notDeepEqual(fingerprintSeoSource({ ...minimal, descriptionHtml: "" }), fingerprint);
  assert.notDeepEqual(fingerprintSeoSource({ ...minimal, descriptionHtml: "Known empty body" }), fingerprint);
  assert.deepEqual(fingerprintSeoSource({ ...minimal, vendor: "Ignored because not in the source contract" }), fingerprint);
});

test("binds live copy to matching catalog variant/media data and rejects stale snapshots", () => {
  const current = product({ updatedAt: "2026-09-25T10:00:00.000Z" });
  const catalog = {
    id: 42,
    handle: current.handle,
    updated_at: "2026-09-25T12:00:00+02:00",
    options: [{ name: "Color", position: 1, values: ["Blue", "White"] }],
    variants: [{ id: 4201, title: "Blue", option1: "Blue", sku: "MUG-BLU" }],
    images: [{ id: 9001, src: "https://cdn.example/mug-blue.jpg", alt: "Blue mug", variant_ids: [4201] }],
  };
  const bound = bindSeoSourceSnapshot([current], [catalog]);
  assert.deepEqual(fingerprintSeoSource(bound[0]), fingerprintSeoSource({
    ...current,
    options: catalog.options,
    variants: catalog.variants,
    images: catalog.images,
  }));
  assert.throws(
    () => bindSeoSourceSnapshot([current], [{ ...catalog, updated_at: "2026-09-24T12:00:00Z" }]),
    /source snapshot is stale/,
  );
});

test("only reuses an older structural snapshot after exact verified SEO output at the recorded live timestamp", () => {
  const priorSource = product({ updatedAt: "2026-09-24T10:00:00.000Z" });
  const finalCopy = {
    title: "Blue Ceramic Coffee Mug",
    descriptionHtml: "<p>A blue ceramic coffee mug for hot and cold drinks.</p>",
  };
  const item = manifestItem(priorSource, {
    desired: finalCopy,
    status: "verified",
    verifiedSourceUpdatedAt: "2026-09-25T10:00:00.000Z",
  });
  const live = product({ ...finalCopy, updatedAt: item.verifiedSourceUpdatedAt });
  const catalog = {
    id: 42,
    handle: "blue-mug",
    updated_at: priorSource.updatedAt,
    options: [{ name: "Color", position: 1, values: ["Blue", "White"] }],
    variants: [{
      id: 4201,
      title: "Blue",
      sku: "MUG-BLU",
      option1: "Blue",
      featured_image: { id: 9001, src: "https://cdn.example/mug-blue.jpg" },
    }],
    images: [{ id: 9001, src: "https://cdn.example/mug-blue.jpg", alt: "Blue mug", variant_ids: [4201] }],
  };
  const bound = bindSeoSourceSnapshot([live], [catalog], [item]);
  assert.deepEqual(auditSeoManifestSourceFreshness(bound, [item]), { checked: 1, issues: [] });

  assert.throws(
    () => bindSeoSourceSnapshot([product({ ...finalCopy, updatedAt: "2026-09-25T11:00:00.000Z" })], [catalog], [item]),
    /source snapshot is stale/,
  );
});

test("leaves products with no manifest row for the existing completeness gate", () => {
  assert.deepEqual(auditSeoManifestSourceFreshness([product()], []), { checked: 1, issues: [] });
});
