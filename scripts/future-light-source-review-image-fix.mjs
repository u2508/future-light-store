#!/usr/bin/env node

/*
 * Guarded repair for the 12 source-review image holds that the normal held
 * image workflow intentionally refused to guess. Every row is pinned to one
 * Future Light product, one live Shopify media ID/URL, one ChatGPT-reviewed
 * replacement, and an exact set of variant IDs. No classifier or broad media
 * cleanup is allowed here.
 */

import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import { createShopifyAdminGraphQLClient } from "./shopify-admin-graphql-client.mjs";
import { FUTURE_LIGHT_BRAND, FUTURE_LIGHT_SHOP_DOMAIN, canonicalImageUrl } from "./lib/product-image-health.mjs";

const execFileAsync = promisify(execFile);
const rootDir = resolve(import.meta.dirname, "..");
const configPath = resolve(rootDir, "config", "future-light-source-review-image-fixes.json");
const outputDir = resolve(rootDir, "output", "future-light-source-review-image-fix");
const statePath = resolve(outputDir, "state.json");
const manifestPath = resolve(outputDir, "manifest.json");
const verificationPath = resolve(outputDir, "verification.json");
const apiVersion = process.env.FUTURE_LIGHT_SHOPIFY_API_VERSION || process.env.SHOPIFY_ADMIN_API_VERSION || "2026-07";
const maxAttempts = Math.max(1, Math.min(6, Number(process.env.FUTURE_LIGHT_SOURCE_REVIEW_IMAGE_ATTEMPTS || 4) || 4));

const PRODUCT_QUERY = /* GraphQL */ `
  query FutureLightSourceReviewProduct($id: ID!) {
    node(id: $id) {
      ... on Product {
        id handle title vendor status
        media(first: 250) {
          nodes { __typename id alt ... on MediaImage { image { url width height } } }
          pageInfo { hasNextPage }
        }
        variants(first: 250) {
          nodes {
            id title
            media(first: 20) { nodes { __typename id ... on MediaImage { image { url } } } }
          }
          pageInfo { hasNextPage }
        }
      }
    }
  }
`;

const STAGED_UPLOAD_MUTATION = /* GraphQL */ `
  mutation FutureLightSourceReviewStage($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url resourceUrl parameters { name value } }
      userErrors { field message }
    }
  }
`;

const CREATE_MEDIA_MUTATION = /* GraphQL */ `
  mutation FutureLightSourceReviewCreate($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media { id alt }
      mediaUserErrors { field message code }
      userErrors { field message }
    }
  }
`;

const UPDATE_VARIANTS_MUTATION = /* GraphQL */ `
  mutation FutureLightSourceReviewVariantUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id }
      userErrors { field message code }
    }
  }
`;

const DELETE_MEDIA_MUTATION = /* GraphQL */ `
  mutation FutureLightSourceReviewDelete($productId: ID!, $mediaIds: [ID!]!) {
    productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
      deletedMediaIds
      mediaUserErrors { field message code }
      userErrors { field message }
    }
  }
`;

function asArray(value) { return Array.isArray(value) ? value : []; }
function normalize(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function now() { return new Date().toISOString(); }
function sameId(left, right) {
  const a = normalize(left); const b = normalize(right);
  if (a === b) return true;
  const an = a.match(/(\d+)$/)?.[1]; const bn = b.match(/(\d+)$/)?.[1];
  return Boolean(an && bn && an === bn);
}
function sameImage(left, right) { return canonicalImageUrl(left) === canonicalImageUrl(right); }
function formatErrors(errors) { return asArray(errors).map((error) => normalize(error?.message || error)).filter(Boolean).join(" | "); }
function keyFor(fix) { return `${normalize(fix.productId)}|${normalize(fix.sourceMediaId)}`; }
function replacementAlt(fix) { return `VS Store | ChatGPT approved source-review image | ${fix.productId} | ${fix.sourceMediaId}`; }
function sortedIds(ids) { return [...new Set(asArray(ids).map(normalize).filter(Boolean))].sort(); }
function sameIdSet(left, right) { const a = sortedIds(left); const b = sortedIds(right); return a.length === b.length && a.every((id, index) => sameId(id, b[index])); }
function safeChildEnv() { return Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^SALT_/i.test(key))); }

function parseArgs(argv = process.argv.slice(2)) {
  return {
    apply: argv.includes("--apply"),
    verifyOnly: argv.includes("--verify-only"),
    dryRun: argv.includes("--dry-run") || !argv.includes("--apply"),
    resume: argv.includes("--resume"),
  };
}

function parseEnvValue(value) {
  const trimmed = String(value || "").trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1).replace(/\\n/g, "\n");
  return trimmed.replace(/\s+#.*$/, "");
}

async function loadFutureEnv() {
  for (const file of [resolve(rootDir, ".env.local"), resolve(rootDir, ".env.release.local")]) {
    let raw;
    try { raw = await readFile(file, "utf8"); }
    catch (error) { if (error?.code === "ENOENT") continue; throw error; }
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || /^SALT_/i.test(match[1])) continue;
      if ((match[1].startsWith("FUTURE_LIGHT_") || match[1].startsWith("SHOPIFY_")) && process.env[match[1]] === undefined) process.env[match[1]] = parseEnvValue(match[2]);
    }
  }
}

async function readJson(filePath, fallback = null) {
  try { return JSON.parse(await readFile(filePath, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return fallback; throw error; }
}
async function writeJson(filePath, value) {
  await mkdir(resolve(filePath, ".."), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
function retryable(error) { return /429|rate limit|throttl|timeout|timed out|network|socket|eai_again|enotfound|getaddrinfo|temporar|unavailable|bad gateway|gateway timeout|5\d\d/i.test(normalize(error?.message || error)); }
async function wait(milliseconds) { return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)); }

async function withRetry(operation, label) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      lastError = error;
      if (!retryable(error) || attempt === maxAttempts) throw error;
      const delay = Math.min(30_000, 1_000 * (2 ** (attempt - 1)));
      process.stdout.write(`Retrying ${label} in ${delay}ms (${attempt}/${maxAttempts - 1})\n`);
      await wait(delay);
    }
  }
  throw lastError;
}

function validateConfig(config) {
  if (!config || config.targetStoreDomain !== FUTURE_LIGHT_SHOP_DOMAIN) throw new Error("Source-review image config is not scoped to Future Light.");
  if (config.policy !== "manual-chatgpt-reviewed-exact-source-only" || config.goodImagesRemainUntouched !== true || config.sourceReviewOnly !== true) throw new Error("Source-review image safety policy is not approved.");
  const fixes = asArray(config.fixes);
  if (fixes.length !== 12) throw new Error(`Expected exactly 12 source-review fixes, found ${fixes.length}.`);
  const keys = new Set(); const failures = [];
  fixes.forEach((fix, index) => {
    const errors = [];
    if (!/^gid:\/\/shopify\/Product\/\d+$/.test(normalize(fix.productId))) errors.push("invalid product ID");
    if (!normalize(fix.handle)) errors.push("missing handle");
    if (!/^gid:\/\/shopify\/MediaImage\/\d+$/.test(normalize(fix.sourceMediaId))) errors.push("invalid source media ID");
    if (!/^https:\/\/cdn\.shopify\.com\//.test(normalize(fix.sourceImageUrl))) errors.push("source is not Shopify CDN");
    if (!normalize(fix.generatedAssetPath).startsWith("output/imagegen/")) errors.push("asset is outside output/imagegen");
    if (!Array.isArray(fix.expectedVariantIds)) errors.push("expectedVariantIds must be an array");
    if (fix.decision !== "approved" || fix.reviewedBy !== "ChatGPT") errors.push("not explicitly ChatGPT approved");
    if (normalize(fix.visualFinding).length < 30 || normalize(fix.identityReviewNote).length < 30) errors.push("review evidence too short");
    const key = keyFor(fix); if (keys.has(key)) errors.push("duplicate product/source key"); keys.add(key);
    if (errors.length) failures.push(`fix ${index}: ${errors.join("; ")}`);
  });
  if (failures.length) throw new Error(`Source-review image config rejected: ${failures.join(" | ")}`);
  return fixes;
}

async function stageAsset(client, filePath) {
  const data = await withRetry(() => client.run(STAGED_UPLOAD_MUTATION, { input: [{ resource: "IMAGE", filename: basename(filePath), mimeType: "image/png", httpMethod: "POST" }] }, { allowMutations: true, operation: `stage ${basename(filePath)}` }), `stage ${basename(filePath)}`);
  const payload = data?.stagedUploadsCreate;
  if (asArray(payload?.userErrors).length) throw new Error(`Stage upload failed: ${formatErrors(payload.userErrors)}`);
  const target = payload?.stagedTargets?.[0];
  if (!target?.url || !target?.resourceUrl) throw new Error(`Shopify returned no stage target for ${basename(filePath)}`);
  const args = ["-sS", "-X", "POST", target.url];
  for (const parameter of asArray(target.parameters)) args.push("-F", `${parameter.name}=${parameter.value}`);
  args.push("-F", `file=@${filePath};type=image/png`);
  await withRetry(() => execFileAsync("curl", args, { cwd: rootDir, env: safeChildEnv(), timeout: 180_000, maxBuffer: 20 * 1024 * 1024 }), `upload ${basename(filePath)}`);
  return target.resourceUrl;
}

async function readProduct(client, productId) {
  const data = await withRetry(() => client.run(PRODUCT_QUERY, { id: productId }, { operation: `read ${productId}` }), `read ${productId}`);
  const product = data?.node;
  if (!product) throw new Error(`Future Light product not found: ${productId}`);
  if (!sameId(product.id, productId)) throw new Error(`Product ID readback mismatch: ${productId}`);
  if (normalize(product.vendor) !== FUTURE_LIGHT_BRAND) throw new Error(`Refused non-${FUTURE_LIGHT_BRAND} product: ${product.handle}`);
  if (normalize(product.status).toUpperCase() !== "ACTIVE") throw new Error(`Refused non-active product: ${product.handle}`);
  if (product.media?.pageInfo?.hasNextPage || product.variants?.pageInfo?.hasNextPage) throw new Error(`Incomplete media or variant pagination for ${product.handle}`);
  return product;
}

function sourceFor(product, fix) {
  const byId = asArray(product.media?.nodes).filter((media) => media.id === fix.sourceMediaId);
  if (byId.length !== 1) return { media: null, error: byId.length ? `source media ID matched ${byId.length} items` : "source media ID is missing" };
  if (!byId[0]?.image?.url || !sameImage(byId[0].image.url, fix.sourceImageUrl)) return { media: null, error: "source media ID URL differs from the pinned source URL" };
  return { media: byId[0], error: null };
}

function linkedVariantIds(product, mediaId) {
  return asArray(product.variants?.nodes).filter((variant) => asArray(variant.media?.nodes).some((media) => media.id === mediaId)).map((variant) => variant.id);
}

function replacementFor(product, fix) {
  return asArray(product.media?.nodes).find((media) => normalize(media.alt) === replacementAlt(fix) && media?.image?.url) || null;
}

function validateLiveSource(product, fix, source) {
  const failures = [];
  if (normalize(product.handle) !== normalize(fix.handle)) failures.push(`handle mismatch: ${product.handle}`);
  if (!source?.media) failures.push(source?.error || "pinned source is missing");
  if (source?.media) {
    const current = linkedVariantIds(product, source.media.id);
    if (!sameIdSet(current, fix.expectedVariantIds)) failures.push(`source variant links differ; expected ${sortedIds(fix.expectedVariantIds).join(",") || "none"}, found ${sortedIds(current).join(",") || "none"}`);
  }
  for (const variantId of asArray(fix.expectedVariantIds)) if (!product.variants?.nodes?.some((variant) => sameId(variant.id, variantId))) failures.push(`configured variant is not on product: ${variantId}`);
  return failures;
}

async function createOrFindReplacement(client, product, fix, assetPath) {
  const existing = replacementFor(product, fix);
  if (existing) return { media: existing, created: false };
  const originalSource = await stageAsset(client, assetPath);
  const data = await withRetry(() => client.run(CREATE_MEDIA_MUTATION, { productId: product.id, media: [{ originalSource, mediaContentType: "IMAGE", alt: replacementAlt(fix) }] }, { allowMutations: true, operation: `create replacement ${fix.handle}` }), `create replacement ${fix.handle}`);
  const payload = data?.productCreateMedia;
  const errors = [...asArray(payload?.mediaUserErrors), ...asArray(payload?.userErrors)];
  if (errors.length) throw new Error(`Create replacement failed for ${fix.handle}: ${formatErrors(errors)}`);
  const media = payload?.media?.[0];
  if (!media?.id) throw new Error(`Shopify returned no replacement media for ${fix.handle}`);
  return { media: { ...media, alt: replacementAlt(fix) }, created: true };
}

async function waitForMedia(client, productId, mediaId) {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const product = await readProduct(client, productId);
    if (asArray(product.media?.nodes).some((media) => media.id === mediaId && media?.image?.url)) return product;
    await wait(Math.min(5_000, 800 + attempt * 100));
  }
  throw new Error(`Timed out waiting for replacement media ${mediaId}`);
}

async function mapExactVariants(client, product, fix, replacementMediaId) {
  const variantIds = sortedIds(fix.expectedVariantIds);
  if (!variantIds.length) return;
  const current = new Map(asArray(product.variants?.nodes).map((variant) => [variant.id, variant]));
  for (const variantId of variantIds) {
    const variant = [...current.values()].find((candidate) => sameId(candidate.id, variantId));
    if (!variant) throw new Error(`Cannot map missing configured variant ${variantId}`);
    const hasSource = asArray(variant.media?.nodes).some((media) => media.id === fix.sourceMediaId);
    const hasReplacement = asArray(variant.media?.nodes).some((media) => media.id === replacementMediaId);
    if (!hasSource && !hasReplacement) throw new Error(`Configured variant ${variantId} is no longer linked to source or replacement; refusing guess.`);
  }
  const data = await withRetry(() => client.run(UPDATE_VARIANTS_MUTATION, { productId: product.id, variants: variantIds.map((id) => ({ id, mediaId: replacementMediaId })) }, { allowMutations: true, operation: `map exact variants ${fix.handle}` }), `map exact variants ${fix.handle}`);
  const errors = asArray(data?.productVariantsBulkUpdate?.userErrors);
  if (errors.length) throw new Error(`Variant mapping failed for ${fix.handle}: ${formatErrors(errors)}`);
}

async function deleteExactSource(client, product, fix) {
  const stillLinked = linkedVariantIds(product, fix.sourceMediaId);
  if (stillLinked.length) throw new Error(`Refusing source deletion while variants still reference it: ${stillLinked.join(",")}`);
  const data = await withRetry(() => client.run(DELETE_MEDIA_MUTATION, { productId: product.id, mediaIds: [fix.sourceMediaId] }, { allowMutations: true, operation: `delete exact source ${fix.handle}` }), `delete exact source ${fix.handle}`);
  const payload = data?.productDeleteMedia;
  const errors = [...asArray(payload?.mediaUserErrors), ...asArray(payload?.userErrors)];
  if (errors.length) throw new Error(`Source deletion failed for ${fix.handle}: ${formatErrors(errors)}`);
  if (!asArray(payload?.deletedMediaIds).some((id) => sameId(id, fix.sourceMediaId))) throw new Error(`Shopify did not confirm source deletion for ${fix.handle}`);
}

function verifyProduct(product, fix, entry) {
  const failures = [];
  if (!sameId(product.id, fix.productId)) failures.push("product ID mismatch");
  if (normalize(product.handle) !== normalize(fix.handle)) failures.push("handle mismatch");
  const replacement = asArray(product.media?.nodes).find((media) => media.id === entry.replacementMediaId && media?.image?.url);
  if (!replacement) failures.push("replacement media missing");
  if (asArray(product.media?.nodes).some((media) => media.id === fix.sourceMediaId)) failures.push("source media still present");
  const linked = linkedVariantIds(product, entry.replacementMediaId);
  if (!sameIdSet(linked, fix.expectedVariantIds)) failures.push(`replacement variant links differ; expected ${sortedIds(fix.expectedVariantIds).join(",") || "none"}, found ${sortedIds(linked).join(",") || "none"}`);
  return failures;
}

async function main() {
  const args = parseArgs();
  await loadFutureEnv();
  const config = await readJson(configPath);
  const fixes = validateConfig(config);
  const client = createShopifyAdminGraphQLClient({ rootDir, agentName: "source-review-image-fix" });
  const prior = await readJson(statePath, null);
  const state = prior?.schemaVersion === "2026-09-18.future-light-source-review-image-fix.1"
    ? prior
    : { schemaVersion: "2026-09-18.future-light-source-review-image-fix.1", targetStoreDomain: FUTURE_LIGHT_SHOP_DOMAIN, status: "idle", entries: {} };
  if (state.targetStoreDomain !== FUTURE_LIGHT_SHOP_DOMAIN) throw new Error("Existing source-review image state is not scoped to Future Light.");

  if (args.verifyOnly) {
    const verification = { schemaVersion: "2026-09-18.future-light-source-review-image-verification.1", targetStoreDomain: FUTURE_LIGHT_SHOP_DOMAIN, readOnly: true, entries: fixes.length, verified: 0, failed: 0, failures: [], verifiedAt: now() };
    for (const fix of fixes) {
      const entry = state.entries?.[keyFor(fix)];
      try {
        if (!entry?.replacementMediaId) throw new Error("no completed replacement state");
        const product = await readProduct(client, fix.productId);
        const failures = verifyProduct(product, fix, entry);
        if (failures.length) throw new Error(failures.join("; "));
        verification.verified += 1;
      } catch (error) {
        verification.failed += 1;
        verification.failures.push(`${fix.handle}: ${normalize(error?.message || error)}`);
      }
    }
    await writeJson(verificationPath, verification);
    process.stdout.write(`Future Light source-review image verification: ${verification.verified}/${verification.entries} verified; ${verification.failed} failed. No Shopify mutation.\n`);
    if (verification.failed) process.exitCode = 1;
    return;
  }

  const manifest = { schemaVersion: "2026-09-18.future-light-source-review-image-manifest.1", targetStoreDomain: FUTURE_LIGHT_SHOP_DOMAIN, mode: args.apply ? "apply-approved-exact-source-review" : "dry-run-approved-exact-source-review", entries: {}, summary: { total: fixes.length, ready: 0, completed: 0, skippedCompleted: 0, blocked: 0, failed: 0, variantMappings: 0, deletedSources: 0 }, generatedAt: now() };
  for (const fix of fixes) {
    const key = keyFor(fix); const priorEntry = state.entries?.[key];
    const entry = { productId: fix.productId, handle: fix.handle, sourceMediaId: fix.sourceMediaId, sourceImageUrl: fix.sourceImageUrl, expectedVariantIds: fix.expectedVariantIds, generatedAssetPath: fix.generatedAssetPath, replacementMediaId: priorEntry?.replacementMediaId || null, sourceDeleted: Boolean(priorEntry?.sourceDeleted), status: "running", startedAt: priorEntry?.startedAt || now() };
    if (args.resume && priorEntry?.status === "completed-verified") {
      try {
        const product = await readProduct(client, fix.productId); const failures = verifyProduct(product, fix, priorEntry);
        if (!failures.length) { entry.status = "completed-from-checkpoint"; manifest.entries[key] = entry; manifest.summary.skippedCompleted += 1; manifest.summary.completed += 1; continue; }
      } catch { /* process again below */ }
    }
    const assetPath = resolve(rootDir, normalize(fix.generatedAssetPath));
    if (!assetPath.startsWith(`${resolve(rootDir, "output", "imagegen")}/`)) { entry.status = "blocked"; entry.error = "asset is outside output/imagegen"; manifest.summary.blocked += 1; manifest.entries[key] = entry; continue; }
    try { await access(assetPath); }
    catch { entry.status = "blocked"; entry.error = "approved generated asset is missing"; manifest.summary.blocked += 1; manifest.entries[key] = entry; continue; }
    let liveProduct;
    let liveSource;
    try {
      liveProduct = await readProduct(client, fix.productId);
      liveSource = sourceFor(liveProduct, fix);
      const liveFailures = validateLiveSource(liveProduct, fix, liveSource);
      if (liveFailures.length) throw new Error(liveFailures.join("; "));
    } catch (error) {
      entry.status = "blocked";
      entry.error = normalize(error?.message || error);
      manifest.summary.blocked += 1;
      manifest.entries[key] = entry;
      continue;
    }
    manifest.summary.ready += 1;
    if (!args.apply) {
      entry.status = "ready-for-apply";
      entry.liveSourceMediaId = liveSource.media.id;
      entry.liveLinkedVariantIds = linkedVariantIds(liveProduct, liveSource.media.id);
      entry.existingReplacementMediaId = replacementFor(liveProduct, fix)?.id || null;
      manifest.entries[key] = entry;
      continue;
    }
    state.status = "running"; state.entries ||= {}; state.entries[key] = entry; await writeJson(statePath, state);
    try {
      let product = await readProduct(client, fix.productId);
      if (priorEntry?.replacementMediaId && !sourceFor(product, fix).media) {
        const failures = verifyProduct(product, fix, priorEntry);
        if (failures.length) throw new Error(`Partial checkpoint is not safe to finalize: ${failures.join("; ")}`);
        entry.replacementMediaId = priorEntry.replacementMediaId; entry.sourceDeleted = true; entry.status = "completed-verified";
      } else {
        const source = sourceFor(product, fix);
        const sourceFailures = validateLiveSource(product, fix, source);
        if (sourceFailures.length) throw new Error(sourceFailures.join("; "));
        const replacement = await createOrFindReplacement(client, product, fix, assetPath);
        entry.replacementMediaId = replacement.media.id; state.entries[key] = entry; await writeJson(statePath, state);
        product = await waitForMedia(client, product.id, replacement.media.id);
        await mapExactVariants(client, product, fix, replacement.media.id);
        product = await readProduct(client, product.id);
        const replacementLinked = linkedVariantIds(product, replacement.media.id);
        if (!sameIdSet(replacementLinked, fix.expectedVariantIds)) throw new Error(`Replacement mapping readback differs before deletion for ${fix.handle}`);
        await deleteExactSource(client, product, fix);
        product = await readProduct(client, product.id);
        const failures = verifyProduct(product, fix, entry);
        if (failures.length) throw new Error(`Final readback failed: ${failures.join("; ")}`);
        entry.sourceDeleted = true; entry.status = "completed-verified";
      }
      entry.completedAt = now(); state.entries[key] = entry; state.status = "running"; state.updatedAt = entry.completedAt; manifest.entries[key] = entry; manifest.summary.completed += 1; manifest.summary.variantMappings += fix.expectedVariantIds.length; manifest.summary.deletedSources += 1; await writeJson(statePath, state);
      process.stdout.write(`Future Light source-review image verified: ${fix.handle} — ${fix.expectedVariantIds.length} exact variant mapping(s), source removed.\n`);
    } catch (error) {
      entry.status = "failed"; entry.error = normalize(error?.message || error); entry.failedAt = now(); state.status = "failed"; state.updatedAt = entry.failedAt; state.entries[key] = entry; manifest.entries[key] = entry; manifest.summary.failed += 1; await writeJson(statePath, state); process.stderr.write(`Source-review image failed: ${fix.handle}: ${entry.error}\n`);
    }
  }
  manifest.status = manifest.summary.failed || manifest.summary.blocked ? "failed" : args.apply ? "completed" : "dry-run-ready"; manifest.completedAt = now(); await writeJson(manifestPath, manifest);
  if (args.apply && !manifest.summary.failed && !manifest.summary.blocked) { state.status = "completed"; state.updatedAt = manifest.completedAt; await writeJson(statePath, state); }
  process.stdout.write(`Future Light source-review image ${args.apply ? "apply" : "dry-run"}: ${manifest.summary.completed}/${manifest.summary.total} completed, ${manifest.summary.ready} ready, ${manifest.summary.blocked} blocked, ${manifest.summary.failed} failed; ${manifest.summary.variantMappings} exact mapping(s), ${manifest.summary.deletedSources} source(s) removed.\n`);
  if (manifest.summary.failed || manifest.summary.blocked) process.exitCode = 1;
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
