#!/usr/bin/env node

/*
 * Apply only an explicitly approved, ChatGPT-reviewed image fix to one exact
 * Future Light product. This script never classifies products, never guesses
 * variant mappings, and never changes media outside the pinned source image.
 */

import { execFile } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import { FUTURE_LIGHT_BRAND, FUTURE_LIGHT_SHOP_DOMAIN, canonicalImageUrl } from "./lib/product-image-health.mjs";

const execFileAsync = promisify(execFile);
const rootDir = resolve(import.meta.dirname, "..");
const configPath = resolve(rootDir, "config", "future-light-explicit-image-fixes.json");
const outputDir = resolve(rootDir, "output", "future-light-explicit-image-fix");
const statePath = resolve(outputDir, "state.json");
const manifestPath = resolve(outputDir, "manifest.json");
const verificationPath = resolve(outputDir, "verification.json");
const outputImageDir = resolve(rootDir, "output", "imagegen");
const apiVersion = process.env.FUTURE_LIGHT_SHOPIFY_API_VERSION || process.env.SHOPIFY_ADMIN_API_VERSION || "2026-07";
const cliBinary = process.env.SHOPIFY_CLI_BINARY || "shopify";
const maxAttempts = Math.max(1, Math.min(6, Number(process.env.FUTURE_LIGHT_EXPLICIT_IMAGE_ATTEMPTS || 4) || 4));

const PRODUCT_QUERY = /* GraphQL */ `
  query FutureLightExplicitImageProduct($id: ID!) {
    node(id: $id) {
      ... on Product {
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
  mutation FutureLightExplicitImageStage($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url resourceUrl parameters { name value } }
      userErrors { field message }
    }
  }
`;

const CREATE_MEDIA_MUTATION = /* GraphQL */ `
  mutation FutureLightExplicitImageCreate($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media { id alt }
      mediaUserErrors { field message code }
      userErrors { field message }
    }
  }
`;

const UPDATE_VARIANTS_MUTATION = /* GraphQL */ `
  mutation FutureLightExplicitImageVariantUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id }
      userErrors { field message code }
    }
  }
`;

const REORDER_MEDIA_MUTATION = /* GraphQL */ `
  mutation FutureLightExplicitImageReorder($id: ID!, $moves: [MoveInput!]!) {
    productReorderMedia(id: $id, moves: $moves) {
      job { id }
      mediaUserErrors { field message code }
      userErrors { field message }
    }
  }
`;

const JOB_QUERY = /* GraphQL */ `
  query FutureLightExplicitImageJob($id: ID!) { job(id: $id) { id done } }
`;

const DELETE_MEDIA_MUTATION = /* GraphQL */ `
  mutation FutureLightExplicitImageDelete($productId: ID!, $mediaIds: [ID!]!) {
    productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
      deletedMediaIds
      mediaUserErrors { field message code }
      userErrors { field message }
    }
  }
`;

function asArray(value) { return Array.isArray(value) ? value : []; }
function normalize(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function sameId(left, right) {
  const a = normalize(left);
  const b = normalize(right);
  if (a === b) return true;
  const an = a.match(/(\d+)$/)?.[1];
  const bn = b.match(/(\d+)$/)?.[1];
  return Boolean(an && bn && an === bn);
}
function sameImage(left, right) { return canonicalImageUrl(left) === canonicalImageUrl(right); }
function formatErrors(errors) {
  return asArray(errors).map((error) => normalize(error?.message || error)).filter(Boolean).join(" | ");
}
function now() { return new Date().toISOString(); }
function wait(milliseconds) { return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)); }
function parseEnvValue(value) {
  const trimmed = String(value || "").trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1).replace(/\\n/g, "\n");
  return trimmed.replace(/\s+#.*$/, "");
}
function safeChildEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^SALT_/i.test(key)));
}
function parseArgs(argv = process.argv.slice(2)) {
  const fixIndexPosition = argv.indexOf("--fix-index");
  const parsedFixIndex = fixIndexPosition >= 0 ? Number(argv[fixIndexPosition + 1]) : 0;
  return {
    apply: argv.includes("--apply"),
    verifyOnly: argv.includes("--verify-only"),
    dryRun: argv.includes("--dry-run") || !argv.includes("--apply"),
    resume: argv.includes("--resume"),
    fixIndex: Number.isInteger(parsedFixIndex) && parsedFixIndex >= 0 ? parsedFixIndex : 0,
  };
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
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "future-light-explicit-image-"));
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
  } finally { await rm(temporaryDirectory, { recursive: true, force: true }); }
}
async function readJson(filePath, fallback = null) {
  try { return JSON.parse(await readFile(filePath, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return fallback; throw error; }
}
async function writeJsonAtomic(filePath, payload) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}
function validateConfig(config) {
  if (!config || config.targetStoreDomain !== FUTURE_LIGHT_SHOP_DOMAIN) throw new Error("Explicit image config is not scoped to the Future Light Shopify store.");
  if (config.policy !== "manual-chatgpt-reviewed-exact-source-only") throw new Error("Explicit image config policy is not approved.");
  const fixes = asArray(config.fixes);
  if (!fixes.length) throw new Error("Explicit image config contains no approved fixes.");
  const keys = new Set();
  const failures = [];
  fixes.forEach((fix, index) => {
    const fixFailures = [];
    if (!/^gid:\/\/shopify\/Product\/\d+$/.test(normalize(fix.productId))) fixFailures.push("invalid product ID");
    if (!normalize(fix.handle)) fixFailures.push("missing product handle");
    if (!/^https:\/\/cdn\.shopify\.com\//.test(normalize(fix.sourceImageUrl))) fixFailures.push("source image is not a Shopify CDN URL");
    if (!normalize(fix.generatedAssetPath).startsWith("output/imagegen/")) fixFailures.push("generated asset must be under output/imagegen");
    if (fix.decision !== "approved" || fix.reviewedBy !== "ChatGPT") fixFailures.push("image fix is not explicitly approved by ChatGPT");
    if (normalize(fix.visualFinding).length < 30) fixFailures.push("visual finding is too short");
    if (normalize(fix.identityReviewNote).length < 30) fixFailures.push("identity review note is too short");
    const key = `${normalize(fix.productId)}|${canonicalImageUrl(fix.sourceImageUrl)}`;
    if (keys.has(key)) fixFailures.push("duplicate product/source fix");
    keys.add(key);
    if (fixFailures.length) failures.push(`fix ${index}: ${fixFailures.join("; ")}`);
  });
  if (failures.length) throw new Error(`Explicit image config rejected: ${failures.join(" | ")}`);
  return fixes;
}
async function readProduct(productId) {
  const data = await withRetry(() => runGraphql(PRODUCT_QUERY, { id: productId }, { operation: `read ${productId}` }), `read ${productId}`);
  const product = data?.node;
  if (!product) throw new Error(`Future Light product not found: ${productId}`);
  if (!sameId(product.id, productId)) throw new Error(`Product ID readback mismatch: ${productId}`);
  if (normalize(product.vendor) !== FUTURE_LIGHT_BRAND) throw new Error(`Refused non-${FUTURE_LIGHT_BRAND} product: ${product.handle}`);
  if (normalize(product.status).toUpperCase() !== "ACTIVE") throw new Error(`Refused non-active product: ${product.handle}`);
  if (product.media?.pageInfo?.hasNextPage || product.variants?.pageInfo?.hasNextPage) throw new Error(`Incomplete media or variant pagination for ${product.handle}`);
  return product;
}
async function stageAsset(filePath) {
  const data = await withRetry(() => runGraphql(STAGED_UPLOAD_MUTATION, { input: [{ resource: "IMAGE", filename: basename(filePath), mimeType: "image/png", httpMethod: "POST" }] }, { mutation: true, operation: `stage ${basename(filePath)}` }), `stage ${basename(filePath)}`);
  const payload = data?.stagedUploadsCreate;
  if (asArray(payload?.userErrors).length) throw new Error(`Stage upload failed: ${formatErrors(payload.userErrors)}`);
  const target = payload?.stagedTargets?.[0];
  if (!target?.url || !target?.resourceUrl) throw new Error(`Shopify returned no stage target for ${basename(filePath)}`);
  const args = ["-sS", "-X", "POST", target.url];
  for (const parameter of asArray(target.parameters)) args.push("-F", `${parameter.name}=${parameter.value}`);
  args.push("-F", `file=@${filePath};type=image/png`);
  await withRetry(() => execFileAsync("curl", args, { cwd: rootDir, timeout: 180_000, maxBuffer: 20 * 1024 * 1024 }), `upload ${basename(filePath)}`);
  return target.resourceUrl;
}
function replacementAlt(fix) { return `VS Store smart watch hero image — ${normalize(fix.handle).slice(0, 90)}`; }
async function createOrFindMedia(product, fix) {
  const alt = replacementAlt(fix);
  const existing = asArray(product.media?.nodes).find((media) => normalize(media.alt) === alt && media?.image?.url);
  if (existing) return { media: existing, created: false, alt };
  const assetPath = resolve(rootDir, normalize(fix.generatedAssetPath));
  const source = await stageAsset(assetPath);
  const data = await withRetry(() => runGraphql(CREATE_MEDIA_MUTATION, { productId: product.id, media: [{ originalSource: source, mediaContentType: "IMAGE", alt }] }, { mutation: true, operation: `create explicit replacement ${product.handle}` }), `create explicit replacement ${product.handle}`);
  const payload = data?.productCreateMedia;
  const errors = [...asArray(payload?.mediaUserErrors), ...asArray(payload?.userErrors)];
  if (errors.length) throw new Error(`Create replacement failed for ${product.handle}: ${formatErrors(errors)}`);
  const media = payload?.media?.[0];
  if (!media?.id) throw new Error(`Shopify returned no replacement media ID for ${product.handle}`);
  return { media: { ...media, alt }, created: true, alt };
}
async function waitForMedia(productId, mediaId) {
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    const product = await readProduct(productId);
    const media = asArray(product.media?.nodes).find((entry) => entry.id === mediaId && entry?.image?.url);
    if (media) return product;
    await wait(Math.min(5_000, 800 + attempt * 100));
  }
  throw new Error(`Timed out waiting for Shopify media processing: ${mediaId}`);
}
async function updateExactVariantMappings(product, sourceMediaId, replacementMediaId) {
  const linked = asArray(product.variants?.nodes).filter((variant) => asArray(variant.media?.nodes).some((media) => media.id === sourceMediaId));
  if (!linked.length) return { linkedVariantIds: [], updatedVariantIds: [] };
  const data = await withRetry(() => runGraphql(UPDATE_VARIANTS_MUTATION, { productId: product.id, variants: linked.map((variant) => ({ id: variant.id, mediaId: replacementMediaId })) }, { mutation: true, operation: `map exact variants ${product.handle}` }), `map exact variants ${product.handle}`);
  const errors = asArray(data?.productVariantsBulkUpdate?.userErrors);
  if (errors.length) throw new Error(`Variant mapping failed for ${product.handle}: ${formatErrors(errors)}`);
  return { linkedVariantIds: linked.map((variant) => variant.id), updatedVariantIds: linked.map((variant) => variant.id) };
}
async function reorderPrimary(productId, mediaId, handle) {
  const data = await withRetry(() => runGraphql(REORDER_MEDIA_MUTATION, { id: productId, moves: [{ id: mediaId, newPosition: "0" }] }, { mutation: true, operation: `reorder explicit hero ${handle}` }), `reorder explicit hero ${handle}`);
  const payload = data?.productReorderMedia;
  const errors = [...asArray(payload?.mediaUserErrors), ...asArray(payload?.userErrors)];
  if (errors.length) throw new Error(`Hero reorder failed for ${handle}: ${formatErrors(errors)}`);
  if (!payload?.job?.id) return;
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    const status = await withRetry(() => runGraphql(JOB_QUERY, { id: payload.job.id }, { operation: `hero reorder job ${handle}` }), `hero reorder job ${handle}`);
    if (status?.job?.done) return;
    await wait(1_000);
  }
  throw new Error(`Timed out waiting for hero reorder job: ${handle}`);
}
async function deleteSourceIfUnreferenced(product, sourceMediaId, replacementMediaId) {
  if (!sourceMediaId || sourceMediaId === replacementMediaId) return false;
  const stillReferenced = asArray(product.variants?.nodes).some((variant) => asArray(variant.media?.nodes).some((media) => media.id === sourceMediaId));
  if (stillReferenced) throw new Error(`Refusing source deletion because a variant still references ${sourceMediaId}`);
  const data = await withRetry(() => runGraphql(DELETE_MEDIA_MUTATION, { productId: product.id, mediaIds: [sourceMediaId] }, { mutation: true, operation: `remove exact supplier hero ${product.handle}` }), `remove exact supplier hero ${product.handle}`);
  const payload = data?.productDeleteMedia;
  const errors = [...asArray(payload?.mediaUserErrors), ...asArray(payload?.userErrors)];
  if (errors.length) throw new Error(`Source cleanup failed for ${product.handle}: ${formatErrors(errors)}`);
  return asArray(payload?.deletedMediaIds).some((id) => sameId(id, sourceMediaId));
}
function findExactSource(product, sourceImageUrl) {
  const matches = asArray(product.media?.nodes).filter((media) => media?.image?.url && sameImage(media.image.url, sourceImageUrl));
  if (matches.length > 1) throw new Error(`More than one live media item matches the pinned source URL for ${product.handle}`);
  return matches[0] || null;
}
function verifyProductState(product, fix, entry) {
  const failures = [];
  if (!sameId(product.id, fix.productId)) failures.push("product ID mismatch");
  if (normalize(product.handle) !== normalize(fix.handle)) failures.push("handle mismatch");
  const replacement = asArray(product.media?.nodes).find((media) => media.id === entry.replacementMediaId && media?.image?.url);
  if (!replacement) failures.push("replacement media missing");
  if (replacement && asArray(product.media?.nodes)[0]?.id !== replacement.id) failures.push("replacement is not the first hero media");
  for (const variantId of asArray(entry.mappedVariantIds)) {
    const variant = asArray(product.variants?.nodes).find((candidate) => candidate.id === variantId);
    if (!variant || !asArray(variant.media?.nodes).some((media) => media.id === entry.replacementMediaId)) failures.push(`replacement not mapped to variant ${variantId}`);
  }
  if (entry.sourceDeleted && findExactSource(product, fix.sourceImageUrl)) failures.push("deleted source media is still present");
  return failures;
}
async function verifyEntry(fix, entry) {
  const product = await readProduct(fix.productId);
  return { failures: verifyProductState(product, fix, entry), product };
}
async function main() {
  const args = parseArgs();
  await loadFutureEnv();
  const config = await readJson(configPath);
  const fixes = validateConfig(config);
  if (args.fixIndex >= fixes.length) throw new Error(`Explicit image fix index ${args.fixIndex} is out of range; ${fixes.length} approved fix(es) configured.`);
  const fix = fixes[args.fixIndex];
  const assetPath = resolve(rootDir, normalize(fix.generatedAssetPath));
  if (!assetPath.startsWith(`${outputImageDir}/`)) throw new Error("Generated asset is outside the approved output/imagegen directory.");
  await access(assetPath);
  await mkdir(outputDir, { recursive: true });
  const prior = await readJson(statePath, null);
  const state = prior?.schemaVersion === "2026-09-18.future-light-explicit-image-fix.1"
    ? prior
    : { schemaVersion: "2026-09-18.future-light-explicit-image-fix.1", targetStoreDomain: FUTURE_LIGHT_SHOP_DOMAIN, status: "idle", entries: {} };
  if (state.targetStoreDomain !== FUTURE_LIGHT_SHOP_DOMAIN) throw new Error("Existing explicit image state is not scoped to Future Light.");
  const key = `${fix.productId}|${canonicalImageUrl(fix.sourceImageUrl)}`;
  const priorEntry = state.entries?.[key] || null;
  const manifest = {
    schemaVersion: "2026-09-18.future-light-explicit-image-fix-manifest.1",
    targetStoreDomain: FUTURE_LIGHT_SHOP_DOMAIN,
    apiVersion,
    mode: args.verifyOnly ? "verify-only" : args.apply ? "apply-approved-exact-fix" : "dry-run-approved-exact-fix",
    sourceConfig: "config/future-light-explicit-image-fixes.json",
    key,
    productId: fix.productId,
    handle: fix.handle,
    assetPath: fix.generatedAssetPath,
    status: args.verifyOnly ? "verifying" : args.dryRun ? "dry-run" : "running",
    summary: { sourcePresent: false, replacementPresent: false, wouldMapVariants: 0, mappedVariants: 0, sourceDeleted: false },
    generatedAt: now(),
  };
  if (args.verifyOnly) {
    if (!priorEntry?.replacementMediaId) throw new Error("No completed explicit image state exists for read-only verification.");
    const checked = await verifyEntry(fix, priorEntry);
    const verification = { schemaVersion: "2026-09-18.future-light-explicit-image-verification.1", targetStoreDomain: FUTURE_LIGHT_SHOP_DOMAIN, productId: fix.productId, handle: fix.handle, replacementMediaId: priorEntry.replacementMediaId, mappedVariantIds: asArray(priorEntry.mappedVariantIds), verified: checked.failures.length === 0, failures: checked.failures, verifiedAt: now() };
    await writeJsonAtomic(verificationPath, verification);
    manifest.status = verification.verified ? "verified" : "failed";
    manifest.summary.replacementPresent = !checked.failures.includes("replacement media missing");
    manifest.summary.mappedVariants = asArray(priorEntry.mappedVariantIds).length;
    manifest.summary.sourceDeleted = Boolean(priorEntry.sourceDeleted);
    await writeJsonAtomic(manifestPath, manifest);
    process.stdout.write(`Future Light explicit image verification: ${verification.verified ? "PASS" : "FAIL"} — ${fix.handle}${verification.failures.length ? ` — ${verification.failures.join("; ")}` : ""}\n`);
    if (!verification.verified) process.exitCode = 1;
    return;
  }
  if (priorEntry?.status === "completed-verified" && args.resume) {
    const checked = await verifyEntry(fix, priorEntry);
    if (!checked.failures.length) {
      manifest.status = "completed-from-checkpoint";
      manifest.summary.replacementPresent = true;
      manifest.summary.mappedVariants = asArray(priorEntry.mappedVariantIds).length;
      manifest.summary.sourceDeleted = Boolean(priorEntry.sourceDeleted);
      await writeJsonAtomic(manifestPath, manifest);
      process.stdout.write(`Future Light explicit image fix already verified from checkpoint: ${fix.handle}\n`);
      return;
    }
  }
  let product = await readProduct(fix.productId);
  if (normalize(product.handle) !== normalize(fix.handle)) throw new Error(`Exact handle readback mismatch: expected ${fix.handle}, got ${product.handle}`);
  const source = findExactSource(product, fix.sourceImageUrl);
  manifest.summary.sourcePresent = Boolean(source);
  if (!source && !priorEntry?.replacementMediaId) throw new Error("Pinned source image is not present in live Shopify media.");
  if (source) {
    if (priorEntry?.sourceMediaId && !sameId(priorEntry.sourceMediaId, source.id)) throw new Error("Pinned source media ID changed unexpectedly.");
  }
  const entry = {
    productId: fix.productId,
    handle: fix.handle,
    sourceImageUrl: fix.sourceImageUrl,
    sourceMediaId: source?.id || priorEntry?.sourceMediaId || null,
    replacementMediaId: priorEntry?.replacementMediaId || null,
    mappedVariantIds: asArray(priorEntry?.mappedVariantIds),
    sourceDeleted: Boolean(priorEntry?.sourceDeleted),
    status: args.dryRun ? "would-update" : "running",
    startedAt: priorEntry?.startedAt || now(),
  };
  if (args.dryRun) {
    const linked = source ? asArray(product.variants?.nodes).filter((variant) => asArray(variant.media?.nodes).some((media) => media.id === source.id)) : [];
    const replacement = asArray(product.media?.nodes).find((media) => normalize(media.alt) === replacementAlt(fix) && media?.image?.url);
    manifest.summary.replacementPresent = Boolean(replacement);
    manifest.summary.wouldMapVariants = linked.length;
    manifest.preview = { sourceMediaId: source?.id || null, existingReplacementMediaId: replacement?.id || null, linkedVariantIds: linked.map((variant) => variant.id), sourceWouldBeRemovedAfterReadback: Boolean(source) };
    manifest.status = "dry-run";
    await writeJsonAtomic(manifestPath, manifest);
    process.stdout.write(`Future Light explicit image dry-run: ${fix.handle} — exact source ${source ? "found" : "not found"}, ${linked.length} exact variant mapping(s), replacement ${replacement ? "already present" : "will be created"}. No Shopify mutation.\n`);
    return;
  }
  state.status = "running";
  state.entries ||= {};
  state.entries[key] = entry;
  await writeJsonAtomic(statePath, state);
  try {
    const created = await createOrFindMedia(product, fix);
    entry.replacementMediaId = created.media.id;
    manifest.summary.replacementPresent = true;
    await writeJsonAtomic(statePath, state);
    product = await waitForMedia(product.id, created.media.id);
    if (source) {
      const mapping = await updateExactVariantMappings(product, source.id, created.media.id);
      entry.mappedVariantIds = [...new Set([...entry.mappedVariantIds, ...mapping.linkedVariantIds])];
      manifest.summary.mappedVariants = entry.mappedVariantIds.length;
      await writeJsonAtomic(statePath, state);
      product = await readProduct(product.id);
      for (const variantId of entry.mappedVariantIds) {
        const variant = product.variants?.nodes?.find((candidate) => candidate.id === variantId);
        if (!asArray(variant?.media?.nodes).some((media) => media.id === created.media.id)) throw new Error(`Variant readback mismatch before hero reorder: ${variantId}`);
      }
    }
    await reorderPrimary(product.id, created.media.id, product.handle);
    product = await readProduct(product.id);
    const sourceStillPresent = source ? findExactSource(product, fix.sourceImageUrl) : null;
    if (sourceStillPresent) {
      entry.sourceDeleted = await deleteSourceIfUnreferenced(product, sourceStillPresent.id, created.media.id);
      if (!entry.sourceDeleted) throw new Error("Source deletion was not confirmed by Shopify.");
      product = await readProduct(product.id);
    }
    const failures = verifyProductState(product, fix, entry);
    if (failures.length) throw new Error(`Explicit image final readback failed: ${failures.join("; ")}`);
    entry.status = "completed-verified";
    entry.completedAt = now();
    state.status = "completed";
    state.updatedAt = entry.completedAt;
    state.entries[key] = entry;
    manifest.status = "completed-verified";
    manifest.summary.mappedVariants = entry.mappedVariantIds.length;
    manifest.summary.sourceDeleted = entry.sourceDeleted;
    manifest.completedAt = entry.completedAt;
    await writeJsonAtomic(statePath, state);
    await writeJsonAtomic(manifestPath, manifest);
    process.stdout.write(`Future Light explicit image fix verified: ${fix.handle} — hero reordered, ${entry.mappedVariantIds.length} exact variant mapping(s), source ${entry.sourceDeleted ? "removed" : "retained"}.\n`);
  } catch (error) {
    entry.status = "failed";
    entry.error = normalize(error?.message || error);
    entry.failedAt = now();
    state.status = "failed";
    state.updatedAt = entry.failedAt;
    state.entries[key] = entry;
    manifest.status = "failed";
    manifest.error = entry.error;
    await writeJsonAtomic(statePath, state);
    await writeJsonAtomic(manifestPath, manifest);
    throw error;
  }
}

main().catch((error) => { console.error(error.message || error); process.exit(1); });
