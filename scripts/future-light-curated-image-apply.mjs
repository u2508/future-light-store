#!/usr/bin/env node

import { execFile } from "node:child_process";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import { FUTURE_LIGHT_SHOP_DOMAIN } from "./lib/product-image-health.mjs";

const execFileAsync = promisify(execFile);
const rootDir = resolve(import.meta.dirname, "..");
const outputDir = resolve(rootDir, "output", "future-light-curated-images");
const statePath = resolve(outputDir, "state.json");
const manifestPath = resolve(outputDir, "manifest.json");
const apiVersion = process.env.FUTURE_LIGHT_SHOPIFY_API_VERSION || process.env.SHOPIFY_ADMIN_API_VERSION || "2026-07";
const cliBinary = process.env.SHOPIFY_CLI_BINARY || "shopify";
const maxAttempts = 4;

// These are ChatGPT-reviewed replacements. Each source image was inspected
// before generation; the plan is intentionally explicit so a later run can
// resume the same decisions without reclassifying products heuristically.
const CURATED_IMAGE_PLAN = Object.freeze([
  {
    handle: "face-cream-evens-out-skin-tone-eliminates-dark-spots-and-dullness-non-greasy-suitable-for-both-men-and-women-whitening-an",
    assets: [{ file: "face-cream-hero.png", alt: "White face cream stick on a clean studio background" }],
    variantPolicy: "preserve-existing-size-media-mapping",
  },
  {
    handle: "luxury-phone-cases-for-iphone-x-xs-max-case-silicone-case-iphone-6-6s-7-8-plus-5-5s-se-iphone-7-plus-7plus-shockproof-phone-case",
    assets: [{ file: "clear-phone-case-hero.png", alt: "Clear shockproof phone case on a clean studio background" }],
    variantPolicy: "preserve-existing-model-media-mapping",
  },
  {
    handle: "m10-wireless-headphone-bluetooth-earphones-waterproof-earpieces-sport-earbuds-for-huawei-iphone-oppo-xiaomi-tws-music-headset",
    assets: [{ file: "m10-earbuds-hero.png", alt: "Black M10 wireless earbuds and charging case on a clean studio background" }],
    variantPolicy: "preserve-existing-black-variant-media-mapping",
    removeOldPrimaryWhenUnreferenced: true,
  },
  {
    handle: "m10-wireless-headphone-bluetooth-earphones-waterproof-earpieces-sport-earbuds-for-huawei-iphone-oppo-xiaomi-tws-music-headset-1",
    assets: [{ file: "m10-earbuds-hero.png", alt: "Black M10 wireless earbuds and charging case on a clean studio background" }],
    variantPolicy: "preserve-existing-black-variant-media-mapping",
    removeOldPrimaryWhenUnreferenced: true,
  },
  {
    handle: "newest-r69-plus-smart-tv-box-android-14-allwinner-h728-octa-core-1000m-bt5-0-2-4g-5g-wifi6-smart-set-top-box-home-video-player",
    assets: [{ file: "r69-plus-hero.png", alt: "R69 Plus streaming box and remote on a clean studio background" }],
    variantPolicy: "preserve-existing-ram-and-plug-media-mapping",
  },
  {
    handle: "white-blouse-for-women-2026-blusas-mujer-bandage-bow-sleeveless-loose-shirts-fashion-sweet-summer-blouses-tops-female",
    assets: [
      { file: "white-bow-blouse-hero.png", alt: "White sleeveless blouse with oversized bow on a clean studio background", color: "white" },
      { file: "blue-bow-blouse-hero.png", alt: "Powder-blue sleeveless blouse with oversized bow on a clean studio background", color: "blue" },
    ],
    variantPolicy: "explicit-color-mapping",
    replaceGallery: true,
  },
  {
    handle: "white-blouse-for-women-2026-blusas-mujer-bandage-bow-sleeveless-loose-shirts-fashion-sweet-summer-blouses-tops-female-1",
    assets: [
      { file: "white-bow-blouse-hero.png", alt: "White sleeveless blouse with oversized bow on a clean studio background", color: "white" },
      { file: "blue-bow-blouse-hero.png", alt: "Powder-blue sleeveless blouse with oversized bow on a clean studio background", color: "blue" },
    ],
    variantPolicy: "explicit-color-mapping",
    replaceGallery: true,
  },
]);

const PRODUCT_BY_HANDLE_QUERY = /* GraphQL */ `
  query FutureLightCuratedImageProduct($query: String!) {
    products(first: 1, query: $query) {
      nodes {
        id
        handle
        title
        vendor
        status
        media(first: 250) {
          nodes {
            __typename
            id
            alt
            ... on MediaImage { image { url width height } }
          }
          pageInfo { hasNextPage }
        }
        variants(first: 250) {
          nodes {
            id
            title
            media(first: 10) { nodes { __typename id } }
          }
          pageInfo { hasNextPage }
        }
      }
    }
  }
`;

const STAGED_UPLOAD_MUTATION = /* GraphQL */ `
  mutation FutureLightCuratedImageStage($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url resourceUrl parameters { name value } }
      userErrors { field message }
    }
  }
`;

const CREATE_MEDIA_MUTATION = /* GraphQL */ `
  mutation FutureLightCuratedImageCreate($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media { id alt }
      mediaUserErrors { field message code }
      userErrors { field message }
    }
  }
`;

const UPDATE_VARIANTS_MUTATION = /* GraphQL */ `
  mutation FutureLightCuratedImageVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id }
      userErrors { field message code }
    }
  }
`;

const REORDER_MEDIA_MUTATION = /* GraphQL */ `
  mutation FutureLightCuratedImageReorder($id: ID!, $moves: [MoveInput!]!) {
    productReorderMedia(id: $id, moves: $moves) {
      job { id }
      mediaUserErrors { field message code }
      userErrors { field message }
    }
  }
`;

const JOB_QUERY = /* GraphQL */ `
  query FutureLightCuratedImageJob($id: ID!) { job(id: $id) { id done } }
`;

const DELETE_MEDIA_MUTATION = /* GraphQL */ `
  mutation FutureLightCuratedImageDelete($productId: ID!, $mediaIds: [ID!]!) {
    productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
      deletedMediaIds
      mediaUserErrors { field message code }
      userErrors { field message }
    }
  }
`;

function parseArgs(argv = process.argv) {
  return {
    apply: argv.includes("--apply"),
    resume: argv.includes("--resume"),
    dryRun: argv.includes("--dry-run") || !argv.includes("--apply"),
  };
}

function parseEnvValue(value) {
  const trimmed = String(value || "").trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }
  return trimmed.replace(/\s+#.*$/, "");
}

async function loadFutureEnv() {
  for (const file of [resolve(rootDir, ".env.local"), resolve(rootDir, ".env.release.local")]) {
    let raw;
    try { raw = await readFile(file, "utf8"); }
    catch (error) { if (error?.code === "ENOENT") continue; throw error; }
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      const key = match[1];
      if (key.startsWith("SALT_")) continue;
      if (key.startsWith("FUTURE_LIGHT_") || key.startsWith("SHOPIFY_")) {
        if (process.env[key] === undefined) process.env[key] = parseEnvValue(match[2]);
      }
    }
  }
}

function safeChildEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^SALT_/i.test(key)));
}

function normalize(value) { return String(value ?? "").replace(/\r\n/g, "\n").trim(); }

function asArray(value) { return Array.isArray(value) ? value : []; }

function formatErrors(errors) {
  return asArray(errors).map((error) => normalize(error?.message || error)).filter(Boolean).join(" | ");
}

function parseGraphqlOutput(raw, operation) {
  const text = String(raw || "").trim();
  const start = text.indexOf("{");
  if (start < 0) throw new Error(`${operation}: Shopify returned no JSON`);
  const payload = JSON.parse(text.slice(start));
  const errors = [...asArray(payload?.errors), ...asArray(payload?.data?.errors)];
  if (errors.length) throw new Error(`${operation}: ${formatErrors(errors)}`);
  return payload?.data || payload;
}

function retryable(error) {
  return /429|rate limit|throttl|timeout|timed out|network|socket|eai_again|enotfound|getaddrinfo|temporar|unavailable|bad gateway|gateway timeout|5\d\d/i.test(normalize(error?.message || error));
}

async function wait(ms) { return new Promise((resolvePromise) => setTimeout(resolvePromise, ms)); }

async function withRetry(operation, label) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      lastError = error;
      if (!retryable(error) || attempt === maxAttempts) throw error;
      const delay = Math.min(30_000, 1_000 * 2 ** (attempt - 1));
      process.stdout.write(`Retrying ${label} in ${delay}ms (${attempt}/${maxAttempts - 1})\n`);
      await wait(delay);
    }
  }
  throw lastError;
}

async function runGraphql(query, variables, { mutation = false, operation = "Shopify request" } = {}) {
  const token = normalize(process.env.FUTURE_LIGHT_SHOPIFY_ADMIN_ACCESS_TOKEN);
  const url = `https://${FUTURE_LIGHT_SHOP_DOMAIN}/admin/api/${apiVersion}/graphql.json`;
  if (token) {
    const response = await fetch(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(180_000),
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`${operation}: Admin GraphQL HTTP ${response.status}: ${raw.slice(0, 500)}`);
    return parseGraphqlOutput(raw, operation);
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "future-light-curated-images-"));
  const queryPath = join(temporaryDirectory, "operation.graphql");
  const variablesPath = join(temporaryDirectory, "variables.json");
  const outputPath = join(temporaryDirectory, "result.json");
  try {
    await Promise.all([writeFile(queryPath, query, "utf8"), writeFile(variablesPath, JSON.stringify(variables), "utf8")]);
    const args = ["store", "execute", "--store", FUTURE_LIGHT_SHOP_DOMAIN, "--version", apiVersion, "--query-file", queryPath, "--variable-file", variablesPath, "--output-file", outputPath, "--json"];
    if (mutation) args.push("--allow-mutations");
    const result = await execFileAsync(cliBinary, args, { cwd: rootDir, env: { ...safeChildEnv(), CI: "1", SHOPIFY_CLI_DISABLE_ANALYTICS: "1" }, timeout: 180_000, maxBuffer: 20 * 1024 * 1024 });
    let raw = result.stdout || "";
    try { raw = await readFile(outputPath, "utf8"); } catch { /* stdout fallback */ }
    return parseGraphqlOutput(raw, operation);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function readProduct(handle) {
  const data = await withRetry(
    () => runGraphql(PRODUCT_BY_HANDLE_QUERY, { query: `handle:${handle}` }, { operation: `Future Light product read ${handle}` }),
    `product read ${handle}`,
  );
  const product = data?.products?.nodes?.[0];
  if (!product) throw new Error(`Future Light product not found: ${handle}`);
  if (normalize(product.vendor) !== "VS Store") throw new Error(`Refused non-VS Store product: ${handle}`);
  if (normalize(product.status).toUpperCase() !== "ACTIVE") throw new Error(`Refused non-active product: ${handle}`);
  if (product.media?.pageInfo?.hasNextPage || product.variants?.pageInfo?.hasNextPage) throw new Error(`Incomplete media or variant pagination for ${handle}`);
  return product;
}

async function stageAsset(filePath) {
  const data = await withRetry(
    () => runGraphql(STAGED_UPLOAD_MUTATION, { input: [{ resource: "IMAGE", filename: basename(filePath), mimeType: "image/png", httpMethod: "POST" }] }, { mutation: true, operation: `stage ${basename(filePath)}` }),
    `stage ${basename(filePath)}`,
  );
  const errors = [...asArray(data?.stagedUploadsCreate?.userErrors)];
  if (errors.length) throw new Error(`Staged upload reservation failed: ${formatErrors(errors)}`);
  const target = data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target?.url || !target?.resourceUrl) throw new Error(`Shopify returned no image staged target for ${basename(filePath)}`);
  const args = ["-sS", "-X", "POST", target.url];
  for (const parameter of asArray(target.parameters)) args.push("-F", `${parameter.name}=${parameter.value}`);
  args.push("-F", `file=@${filePath};type=image/png`);
  await withRetry(() => execFileAsync("curl", args, { cwd: rootDir, timeout: 180_000, maxBuffer: 20 * 1024 * 1024 }), `upload ${basename(filePath)}`);
  return target.resourceUrl;
}

async function createOrFindMedia(product, asset) {
  const existing = asArray(product.media?.nodes).find((media) => normalize(media.alt) === normalize(asset.alt) && media?.image?.url);
  if (existing) return { media: existing, created: false };
  const source = await stageAsset(resolve(rootDir, "output", "imagegen", "future-light", asset.file));
  const data = await withRetry(
    () => runGraphql(CREATE_MEDIA_MUTATION, { productId: product.id, media: [{ originalSource: source, mediaContentType: "IMAGE", alt: asset.alt }] }, { mutation: true, operation: `create ${asset.file} on ${product.handle}` }),
    `create ${asset.file}`,
  );
  const payload = data?.productCreateMedia;
  const errors = [...asArray(payload?.mediaUserErrors), ...asArray(payload?.userErrors)];
  if (errors.length) throw new Error(`Create media failed for ${product.handle}: ${formatErrors(errors)}`);
  const media = payload?.media?.[0];
  if (!media?.id) throw new Error(`Shopify returned no media id for ${product.handle}`);
  return { media: { ...media, alt: asset.alt }, created: true };
}

async function waitForMedia(productId, mediaId, handle) {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const data = await readProduct(handle);
    const media = asArray(data.media?.nodes).find((entry) => entry.id === mediaId && entry?.image?.url);
    if (media) return data;
    await wait(Math.min(5_000, 1_000 + attempt * 100));
  }
  throw new Error(`Timed out waiting for Shopify media processing: ${handle} ${mediaId}`);
}

async function reorderPrimary(productId, mediaId, handle) {
  const data = await withRetry(
    () => runGraphql(REORDER_MEDIA_MUTATION, { id: productId, moves: [{ id: mediaId, newPosition: "0" }] }, { mutation: true, operation: `reorder ${handle}` }),
    `reorder ${handle}`,
  );
  const payload = data?.productReorderMedia;
  const errors = [...asArray(payload?.mediaUserErrors), ...asArray(payload?.userErrors)];
  if (errors.length) throw new Error(`Reorder failed for ${handle}: ${formatErrors(errors)}`);
  if (payload?.job?.id) {
    for (let attempt = 1; attempt <= 30; attempt += 1) {
      const status = await withRetry(() => runGraphql(JOB_QUERY, { id: payload.job.id }, { operation: `reorder job ${handle}` }), `reorder job ${handle}`);
      if (status?.job?.done) return;
      await wait(1_000);
    }
    throw new Error(`Timed out waiting for media reorder job: ${handle}`);
  }
}

function explicitVariantAssignments(product, mediaByColor) {
  const assignments = [];
  for (const variant of asArray(product.variants?.nodes)) {
    const title = normalize(variant.title).toLowerCase();
    const color = title.startsWith("blue") ? "blue" : title.startsWith("white") ? "white" : "";
    if (!color || !mediaByColor[color]) throw new Error(`Unresolved clothing-color mapping for ${product.handle}: ${variant.title}`);
    const current = asArray(variant.media?.nodes).map((entry) => entry.id);
    if (current.length !== 1 || current[0] !== mediaByColor[color]) assignments.push({ id: variant.id, mediaId: mediaByColor[color], color, variantTitle: variant.title });
  }
  return assignments;
}

async function applyVariantAssignments(product, assignments) {
  if (!assignments.length) return;
  const data = await withRetry(
    () => runGraphql(UPDATE_VARIANTS_MUTATION, { productId: product.id, variants: assignments.map(({ id, mediaId }) => ({ id, mediaId })) }, { mutation: true, operation: `variant mapping ${product.handle}` }),
    `variant mapping ${product.handle}`,
  );
  const errors = asArray(data?.productVariantsBulkUpdate?.userErrors);
  if (errors.length) throw new Error(`Variant mapping failed for ${product.handle}: ${formatErrors(errors)}`);
}

async function deleteMedia(productId, mediaIds, handle) {
  const ids = [...new Set(mediaIds.filter(Boolean))];
  if (!ids.length) return [];
  const data = await withRetry(
    () => runGraphql(DELETE_MEDIA_MUTATION, { productId, mediaIds: ids }, { mutation: true, operation: `delete obsolete media ${handle}` }),
    `delete obsolete media ${handle}`,
  );
  const payload = data?.productDeleteMedia;
  const errors = [...asArray(payload?.mediaUserErrors), ...asArray(payload?.userErrors)];
  if (errors.length) throw new Error(`Media cleanup failed for ${handle}: ${formatErrors(errors)}`);
  return asArray(payload?.deletedMediaIds);
}

function variantMediaIds(product) {
  return new Set(asArray(product.variants?.nodes).flatMap((variant) => asArray(variant.media?.nodes).map((media) => media.id)));
}

async function writeJson(path, value) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main() {
  const args = parseArgs(process.argv);
  await loadFutureEnv();
  await mkdir(outputDir, { recursive: true });
  const prior = args.resume ? await readJson(statePath, null) : null;
  const state = prior?.schemaVersion === "2026-09-15.future-light-curated-images.1"
    ? prior
    : { schemaVersion: "2026-09-15.future-light-curated-images.1", targetStoreDomain: FUTURE_LIGHT_SHOP_DOMAIN, completedHandles: [], entries: {}, status: args.dryRun ? "dry-run" : "planned" };
  const manifest = { generatedAt: new Date().toISOString(), status: args.dryRun ? "dry-run" : "running", targetStoreDomain: FUTURE_LIGHT_SHOP_DOMAIN, apiVersion, scope: "ChatGPT-reviewed Future Light image replacements", plannedProducts: CURATED_IMAGE_PLAN.map((entry) => entry.handle), entries: state.entries, summary: { planned: CURATED_IMAGE_PLAN.length, completed: state.completedHandles.length, failed: 0 } };
  await writeJson(manifestPath, manifest);

  for (const plan of CURATED_IMAGE_PLAN) {
    if (args.resume && state.completedHandles.includes(plan.handle)) continue;
    const entry = { handle: plan.handle, variantPolicy: plan.variantPolicy, status: args.dryRun ? "would-update" : "running", assets: plan.assets.map((asset) => asset.file), variantAssignments: [], deletedMediaIds: [] };
    state.entries[plan.handle] = entry;
    manifest.entries = state.entries;
    if (args.dryRun) continue;
    try {
      let product = await readProduct(plan.handle);
      const beforeMediaIds = asArray(product.media?.nodes).map((media) => media.id);
      const beforePrimary = beforeMediaIds[0] || null;
      const resolved = {};
      for (const asset of plan.assets) {
        const result = await createOrFindMedia(product, asset);
        resolved[asset.color || "hero"] = result.media.id;
        entry[`mediaId_${asset.color || "hero"}`] = result.media.id;
        product = await waitForMedia(product.id, result.media.id, plan.handle);
      }

      const assignments = plan.variantPolicy === "explicit-color-mapping" ? explicitVariantAssignments(product, resolved) : [];
      await applyVariantAssignments(product, assignments);
      entry.variantAssignments = assignments;
      product = assignments.length ? await readProduct(plan.handle) : product;

      if (plan.replaceGallery) {
        const currentVariantMedia = variantMediaIds(product);
        const keep = new Set(Object.values(resolved));
        const obsolete = asArray(product.media?.nodes).map((media) => media.id).filter((id) => !keep.has(id));
        const unsafe = obsolete.filter((id) => currentVariantMedia.has(id));
        if (unsafe.length) throw new Error(`Refusing gallery cleanup because ${unsafe.length} obsolete media item(s) remain variant-linked`);
        entry.deletedMediaIds = await deleteMedia(product.id, obsolete, plan.handle);
      } else if (plan.removeOldPrimaryWhenUnreferenced && beforePrimary && !variantMediaIds(product).has(beforePrimary) && !Object.values(resolved).includes(beforePrimary)) {
        entry.deletedMediaIds = await deleteMedia(product.id, [beforePrimary], plan.handle);
      }

      const primaryId = resolved.white || resolved.hero;
      await reorderPrimary(product.id, primaryId, plan.handle);
      product = await readProduct(plan.handle);
      const liveIds = asArray(product.media?.nodes).map((media) => media.id);
      if (!liveIds.includes(primaryId)) throw new Error(`Primary replacement missing on readback: ${plan.handle}`);
      if (liveIds[0] !== primaryId) throw new Error(`Primary order readback mismatch: ${plan.handle}`);
      if (plan.variantPolicy === "explicit-color-mapping") {
        const expected = new Map(assignments.map((assignment) => [assignment.id, assignment.mediaId]));
        for (const variant of asArray(product.variants?.nodes)) {
          const actual = asArray(variant.media?.nodes).map((media) => media.id);
          if (actual.length !== 1 || actual[0] !== (normalize(variant.title).toLowerCase().startsWith("blue") ? resolved.blue : resolved.white)) {
            throw new Error(`Variant image readback mismatch: ${plan.handle} / ${variant.title}`);
          }
        }
      }
      entry.status = "completed-verified";
      entry.beforeMediaIds = beforeMediaIds;
      entry.afterMediaIds = liveIds;
      entry.verifiedAt = new Date().toISOString();
      state.completedHandles = [...new Set([...state.completedHandles, plan.handle])];
      state.status = "running";
      manifest.summary.completed = state.completedHandles.length;
      await writeJson(statePath, state);
      manifest.entries = state.entries;
      await writeJson(manifestPath, manifest);
      process.stdout.write(`Curated image replacement verified: ${plan.handle}\n`);
    } catch (error) {
      entry.status = "failed";
      entry.error = normalize(error?.message || error);
      manifest.summary.failed += 1;
      manifest.entries = state.entries;
      await writeJson(statePath, state);
      await writeJson(manifestPath, manifest);
      throw error;
    }
  }

  manifest.summary.completed = state.completedHandles.length;
  manifest.status = args.dryRun ? "dry-run" : "completed";
  manifest.completedAt = new Date().toISOString();
  state.status = manifest.status;
  await writeJson(statePath, state);
  await writeJson(manifestPath, manifest);
  process.stdout.write(`${args.dryRun ? "Curated image dry-run" : "Curated image apply complete"}: ${CURATED_IMAGE_PLAN.length} product plan(s), ${state.completedHandles.length} verified.\n`);
}

async function readJson(path, fallback = null) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return fallback; throw error; }
}

main().catch((error) => { console.error(error.message || error); process.exit(1); });
