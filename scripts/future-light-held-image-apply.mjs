#!/usr/bin/env node

/*
 * Apply only the held-image replacements that have already been approved by
 * ChatGPT's explicit visual review. This adapter deliberately does not read
 * SALT configuration, does not classify images, and never guesses a variant
 * mapping. Every source URL, product ID, generated asset, and live variant
 * reference is checked immediately before mutation and again after it.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import { FUTURE_LIGHT_SHOP_DOMAIN } from "./lib/product-image-health.mjs";

const execFileAsync = promisify(execFile);
const rootDir = resolve(import.meta.dirname, "..");
const reviewDir = resolve(rootDir, "output", "future-light-visual-review");
const progressPath = resolve(reviewDir, "chatgpt-review-progress.json");
const liveAuditPath = resolve(reviewDir, "held-image-mapping-live-audit.json");
const outputDir = resolve(rootDir, "output", "future-light-held-image-apply");
const statePath = resolve(outputDir, "state.json");
const manifestPath = resolve(outputDir, "manifest.json");
const apiVersion = process.env.FUTURE_LIGHT_SHOPIFY_API_VERSION || process.env.SHOPIFY_ADMIN_API_VERSION || "2026-07";
const cliBinary = process.env.SHOPIFY_CLI_BINARY || "shopify";
const maxAttempts = Math.max(1, Math.min(6, Number(process.env.FUTURE_LIGHT_IMAGE_APPLY_ATTEMPTS || 4)));

const PRODUCT_QUERY = /* GraphQL */ `
  query FutureLightHeldImageProduct($id: ID!) {
    node(id: $id) {
      ... on Product {
        id
        handle
        title
        vendor
        status
        media(first: 250) {
          nodes { __typename id alt ... on MediaImage { image { url width height } } }
          pageInfo { hasNextPage }
        }
        variants(first: 250) {
          nodes {
            id
            title
            media(first: 10) { nodes { __typename id ... on MediaImage { image { url } } } }
          }
          pageInfo { hasNextPage }
        }
      }
    }
  }
`;

const STAGED_UPLOAD_MUTATION = /* GraphQL */ `
  mutation FutureLightHeldImageStage($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url resourceUrl parameters { name value } }
      userErrors { field message }
    }
  }
`;

const CREATE_MEDIA_MUTATION = /* GraphQL */ `
  mutation FutureLightHeldImageCreate($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media { id alt }
      mediaUserErrors { field message code }
      userErrors { field message }
    }
  }
`;

const UPDATE_VARIANTS_MUTATION = /* GraphQL */ `
  mutation FutureLightHeldImageVariantUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id }
      userErrors { field message }
    }
  }
`;

const DELETE_MEDIA_MUTATION = /* GraphQL */ `
  mutation FutureLightHeldImageDelete($productId: ID!, $mediaIds: [ID!]!) {
    productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
      deletedMediaIds
      mediaUserErrors { field message code }
      userErrors { field message }
    }
  }
`;

function asArray(value) { return Array.isArray(value) ? value : []; }
function normalize(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function sameShopifyId(left, right) {
  const a = normalize(left);
  const b = normalize(right);
  if (a === b) return true;
  const an = a.match(/(\d+)$/)?.[1];
  const bn = b.match(/(\d+)$/)?.[1];
  return Boolean(an && bn && an === bn);
}
function sourceKey(entry) { return `${normalize(entry.handle)}|${normalize(entry.heldSourceImageUrl)}`; }
function fingerprint(value) { return createHash("sha256").update(normalize(value)).digest("hex").slice(0, 12); }
function safeChildEnv() { return Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^SALT_/i.test(key))); }
function parseEnvValue(value) {
  const trimmed = String(value || "").trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed.replace(/\s+#.*$/, "");
}
function parseArgs(argv = process.argv.slice(2)) {
  const read = (name, fallback = "") => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : fallback;
  };
  return {
    apply: argv.includes("--apply"),
    verifyOnly: argv.includes("--verify-only"),
    dryRun: argv.includes("--dry-run") || !argv.includes("--apply"),
    resume: argv.includes("--resume"),
    limit: Math.max(0, Number(read("--limit", "0"))),
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
      if ((match[1].startsWith("FUTURE_LIGHT_") || match[1].startsWith("SHOPIFY_")) && process.env[match[1]] === undefined) {
        process.env[match[1]] = parseEnvValue(match[2]);
      }
    }
  }
}

async function readJson(path, fallback = null) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return fallback; throw error; }
}
async function writeJson(path, value) {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
function formatErrors(errors) { return asArray(errors).map((error) => normalize(error?.message || error)).filter(Boolean).join(" | "); }
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
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "future-light-held-image-"));
  const queryPath = join(temporaryDirectory, "operation.graphql");
  const variablesPath = join(temporaryDirectory, "variables.json");
  const outputPath = join(temporaryDirectory, "result.json");
  try {
    await Promise.all([writeFile(queryPath, query, "utf8"), writeFile(variablesPath, JSON.stringify(variables || {}), "utf8")]);
    const args = ["store", "execute", "--store", FUTURE_LIGHT_SHOP_DOMAIN, "--version", apiVersion, "--query-file", queryPath, "--variable-file", variablesPath, "--output-file", outputPath, "--json"];
    if (mutation) args.push("--allow-mutations");
    const result = await execFileAsync(cliBinary, args, { cwd: rootDir, env: { ...safeChildEnv(), CI: "1", SHOPIFY_CLI_DISABLE_ANALYTICS: "1" }, timeout: 180_000, maxBuffer: 20 * 1024 * 1024 });
    let raw = result.stdout || "";
    try { raw = await readFile(outputPath, "utf8"); } catch { /* stdout fallback */ }
    return parseGraphqlOutput(raw, operation);
  } finally { await rm(temporaryDirectory, { recursive: true, force: true }); }
}

async function readProduct(productId) {
  const data = await withRetry(() => runGraphql(PRODUCT_QUERY, { id: productId }, { operation: `read ${productId}` }), `read ${productId}`);
  const product = data?.node;
  if (!product) throw new Error(`Future Light product not found: ${productId}`);
  if (normalize(product.vendor) !== "VS Store") throw new Error(`Refused non-VS Store product: ${product.handle}`);
  if (normalize(product.status).toUpperCase() !== "ACTIVE") throw new Error(`Refused non-active product: ${product.handle}`);
  if (product.media?.pageInfo?.hasNextPage || product.variants?.pageInfo?.hasNextPage) throw new Error(`Incomplete media or variant pagination for ${product.handle}`);
  return product;
}

async function stageAsset(filePath) {
  const extension = filePath.toLowerCase().split(".").pop();
  const mimeType = extension === "webp" ? "image/webp" : extension === "jpg" || extension === "jpeg" ? "image/jpeg" : "image/png";
  const data = await withRetry(
    () => runGraphql(STAGED_UPLOAD_MUTATION, { input: [{ resource: "IMAGE", filename: basename(filePath), mimeType, httpMethod: "POST" }] }, { mutation: true, operation: `stage ${basename(filePath)}` }),
    `stage ${basename(filePath)}`,
  );
  const payload = data?.stagedUploadsCreate;
  if (asArray(payload?.userErrors).length) throw new Error(`Stage upload failed: ${formatErrors(payload.userErrors)}`);
  const target = payload?.stagedTargets?.[0];
  if (!target?.url || !target?.resourceUrl) throw new Error(`Shopify returned no stage target for ${basename(filePath)}`);
  const args = ["-sS", "-X", "POST", target.url];
  for (const parameter of asArray(target.parameters)) args.push("-F", `${parameter.name}=${parameter.value}`);
  args.push("-F", `file=@${filePath};type=${mimeType}`);
  await withRetry(() => execFileAsync("curl", args, { cwd: rootDir, timeout: 180_000, maxBuffer: 20 * 1024 * 1024 }), `upload ${basename(filePath)}`);
  return target.resourceUrl;
}

async function createOrFindMedia(product, decision) {
  const token = fingerprint(decision.heldSourceImageUrl);
  // Some held products have a stale supplier-derived title in Shopify. Do not
  // copy that title into accessibility text while the separate SEO contract
  // repairs it; the token is only for safe idempotency/readback.
  const alt = `VS Store product image [${token}]`;
  const existing = asArray(product.media?.nodes).find((media) => normalize(media.alt) === alt && media?.image?.url);
  if (existing) return { media: existing, created: false, alt };
  const assetPath = resolve(rootDir, normalize(decision.generatedAssetPath || ""));
  const source = await stageAsset(assetPath);
  const data = await withRetry(
    () => runGraphql(CREATE_MEDIA_MUTATION, { productId: product.id, media: [{ originalSource: source, mediaContentType: "IMAGE", alt }] }, { mutation: true, operation: `create replacement ${product.handle}` }),
    `create replacement ${product.handle}`,
  );
  const payload = data?.productCreateMedia;
  const errors = [...asArray(payload?.mediaUserErrors), ...asArray(payload?.userErrors)];
  if (errors.length) throw new Error(`Create replacement failed for ${product.handle}: ${formatErrors(errors)}`);
  const media = payload?.media?.[0];
  if (!media?.id) throw new Error(`Shopify returned no replacement media ID for ${product.handle}`);
  return { media: { ...media, alt }, created: true, alt };
}

async function waitForMedia(productId, mediaId) {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const product = await readProduct(productId);
    const media = asArray(product.media?.nodes).find((entry) => entry.id === mediaId && entry?.image?.url);
    if (media) return product;
    await wait(Math.min(5_000, 1_000 + attempt * 100));
  }
  throw new Error(`Timed out waiting for Shopify media processing: ${mediaId}`);
}

async function updateVariantMedia(product, sourceMediaId, replacementMediaId) {
  const linked = asArray(product.variants?.nodes).filter((variant) => asArray(variant.media?.nodes).some((media) => media.id === sourceMediaId));
  if (!linked.length) return { linkedVariants: [], updatedVariants: [] };
  const data = await withRetry(
    () => runGraphql(UPDATE_VARIANTS_MUTATION, { productId: product.id, variants: linked.map((variant) => ({ id: variant.id, mediaId: replacementMediaId })) }, { mutation: true, operation: `map replacement variants ${product.handle}` }),
    `map replacement variants ${product.handle}`,
  );
  const errors = asArray(data?.productVariantsBulkUpdate?.userErrors);
  if (errors.length) throw new Error(`Variant mapping failed for ${product.handle}: ${formatErrors(errors)}`);
  return { linkedVariants: linked.map((variant) => variant.id), updatedVariants: linked.map((variant) => variant.id) };
}

async function deleteSourceIfUnreferenced(product, sourceMediaId, replacementMediaId) {
  if (!sourceMediaId || sourceMediaId === replacementMediaId) return false;
  const stillReferenced = asArray(product.variants?.nodes).some((variant) => asArray(variant.media?.nodes).some((media) => media.id === sourceMediaId));
  if (stillReferenced) return false;
  const data = await withRetry(
    () => runGraphql(DELETE_MEDIA_MUTATION, { productId: product.id, mediaIds: [sourceMediaId] }, { mutation: true, operation: `remove replaced source ${product.handle}` }),
    `remove replaced source ${product.handle}`,
  );
  const payload = data?.productDeleteMedia;
  const errors = [...asArray(payload?.mediaUserErrors), ...asArray(payload?.userErrors)];
  if (errors.length) throw new Error(`Source cleanup failed for ${product.handle}: ${formatErrors(errors)}`);
  return asArray(payload?.deletedMediaIds).includes(sourceMediaId);
}

function approvedDecisions(progress) {
  const decisions = [];
  for (const parent of asArray(progress?.entries)) {
    for (const media of asArray(parent.reviewedMedia)) {
      if (media?.decision !== "approved-generated-asset" || media?.status !== "approved" || media?.notApprovedForUpload !== false) continue;
      decisions.push({
        productId: parent.productId,
        sourceProductId: parent.productId,
        handle: parent.handle,
        title: parent.title,
        heldSourceImageUrl: media.heldSourceImageUrl,
        generatedAssetPath: media.generatedAssetPath,
        identityReviewNote: media.identityReviewNote,
        visualFinding: media.visualFinding,
      });
    }
  }
  const unique = new Map(decisions.map((decision) => [sourceKey(decision), decision]));
  return [...unique.values()].sort((left, right) => sourceKey(left).localeCompare(sourceKey(right)));
}

function validateDecision(decision, liveAuditByKey) {
  const failures = [];
  if (!sameShopifyId(decision.productId, decision.sourceProductId)) failures.push("source product ID mismatch");
  if (normalize(decision.identityReviewNote).length < 30) failures.push("identity review note is too short");
  const assetPath = resolve(rootDir, normalize(decision.generatedAssetPath || ""));
  if (!assetPath.startsWith(`${resolve(rootDir, "output", "imagegen")}/`)) failures.push("generated asset is outside output/imagegen");
  const audit = liveAuditByKey.get(sourceKey(decision));
  if (!audit) failures.push("approved image has no matching live evidence audit");
  if (audit && !sameShopifyId(audit.productId, decision.productId)) failures.push("live audit product ID mismatch");
  return { failures, assetPath, audit };
}

async function main() {
  const args = parseArgs();
  await loadFutureEnv();
  const [progress, liveAudit, priorState] = await Promise.all([
    readJson(progressPath),
    readJson(liveAuditPath),
    readJson(statePath, { schemaVersion: "2026-09-18.future-light-held-image-apply.1", status: "idle", completedKeys: [], entries: {} }),
  ]);
  priorState.targetStoreDomain ||= FUTURE_LIGHT_SHOP_DOMAIN;
  if (args.verifyOnly) {
    if (!priorState || priorState.targetStoreDomain !== FUTURE_LIGHT_SHOP_DOMAIN) throw new Error("Missing held-image apply state for read-only verification.");
    const entries = Object.values(priorState.entries || {}).filter((entry) => entry.status === "completed-verified");
    const byProduct = new Map();
    for (const entry of entries) {
      if (!byProduct.has(entry.productId)) byProduct.set(entry.productId, []);
      byProduct.get(entry.productId).push(entry);
    }
    const verification = { schemaVersion: "2026-09-18.future-light-held-image-verification.1", targetStoreDomain: FUTURE_LIGHT_SHOP_DOMAIN, readOnly: true, products: 0, entries: entries.length, verified: 0, failed: 0, failures: [], verifiedAt: new Date().toISOString() };
    for (const [productId, productEntries] of byProduct) {
      verification.products += 1;
      try {
        const product = await readProduct(productId);
        for (const entry of productEntries) {
          const replacement = asArray(product.media?.nodes).find((media) => media.id === entry.replacementMediaId && media?.image?.url);
          if (!replacement) throw new Error(`${entry.handle}: replacement media missing (${entry.replacementMediaId})`);
          if (entry.deletedSource && asArray(product.media?.nodes).some((media) => media.id === entry.sourceMediaId)) {
            throw new Error(`${entry.handle}: deleted source media still present (${entry.sourceMediaId})`);
          }
          for (const variantId of asArray(entry.linkedVariantIds)) {
            const variant = product.variants?.nodes?.find((candidate) => candidate.id === variantId);
            if (!variant || !asArray(variant.media?.nodes).some((media) => media.id === entry.replacementMediaId)) {
              throw new Error(`${entry.handle}: replacement is not mapped to variant ${variantId}`);
            }
          }
          verification.verified += 1;
        }
      } catch (error) {
        verification.failed += productEntries.length;
        verification.failures.push(normalize(error?.message || error));
      }
    }
    await writeJson(resolve(outputDir, "verification.json"), verification);
    process.stdout.write(`Future Light held-image read-only verification: ${verification.verified}/${verification.entries} entries verified across ${verification.products} product(s); ${verification.failed} failed. No Shopify mutation.\n`);
    if (verification.failed) process.exitCode = 1;
    return;
  }
  if (!progress || progress.targetStoreDomain !== FUTURE_LIGHT_SHOP_DOMAIN) throw new Error("Missing or non-Future Light ChatGPT visual review progress.");
  if (!liveAudit || liveAudit.targetStoreDomain !== FUTURE_LIGHT_SHOP_DOMAIN || liveAudit.liveMutation !== false) throw new Error("Missing or unsafe held-image live audit; run the read-only live audit first.");

  const liveAuditByKey = new Map(asArray(liveAudit.entries).map((entry) => [sourceKey({ handle: entry.handle, heldSourceImageUrl: entry.sourceImageUrl }), entry]));
  let decisions = approvedDecisions(progress);
  if (args.limit > 0) decisions = decisions.slice(0, args.limit);
  const completedKeys = new Set(asArray(priorState?.completedKeys));
  const manifest = {
    schemaVersion: "2026-09-18.future-light-held-image-apply.1",
    targetStoreDomain: FUTURE_LIGHT_SHOP_DOMAIN,
    mode: args.apply ? "apply-approved-only" : "dry-run-approved-only",
    source: { reviewProgress: "output/future-light-visual-review/chatgpt-review-progress.json", liveAudit: "output/future-light-visual-review/held-image-mapping-live-audit.json" },
    summary: { candidates: decisions.length, skippedCompleted: 0, ready: 0, blocked: 0, completed: 0, failed: 0, variantMappings: 0, deletedSources: 0 },
    entries: {},
    generatedAt: new Date().toISOString(),
  };

  for (const decision of decisions) {
    const key = sourceKey(decision);
    if (completedKeys.has(key)) {
      manifest.summary.skippedCompleted += 1;
      manifest.entries[key] = { ...decision, status: "completed-from-checkpoint" };
      continue;
    }
    const validation = validateDecision(decision, liveAuditByKey);
    try { await access(validation.assetPath); }
    catch { validation.failures.push(`generated asset missing: ${decision.generatedAssetPath}`); }
    if (validation.failures.length) {
      manifest.summary.blocked += 1;
      manifest.entries[key] = { ...decision, status: "blocked", failures: validation.failures };
      continue;
    }
    manifest.summary.ready += 1;
    if (!args.apply) {
      manifest.entries[key] = { ...decision, status: "ready-for-apply", liveAudit: validation.audit.liveApplyStatus };
      continue;
    }

    const entry = { ...decision, status: "running", sourceMediaId: null, replacementMediaId: null, linkedVariantIds: [], deletedSource: false, startedAt: new Date().toISOString() };
    manifest.entries[key] = entry;
    try {
      let product = await readProduct(decision.productId);
      const source = asArray(product.media?.nodes).find((media) => normalize(media?.image?.url) === normalize(decision.heldSourceImageUrl));
      if (!source?.id) throw new Error(`Exact held source image is not present in live product media: ${decision.heldSourceImageUrl}`);
      entry.sourceMediaId = source.id;
      const created = await createOrFindMedia(product, decision);
      entry.replacementMediaId = created.media.id;
      product = await waitForMedia(product.id, created.media.id);
      const mapping = await updateVariantMedia(product, source.id, created.media.id);
      entry.linkedVariantIds = mapping.linkedVariants;
      manifest.summary.variantMappings += mapping.updatedVariants.length;
      product = await readProduct(product.id);
      for (const variantId of mapping.linkedVariants) {
        const variant = product.variants.nodes.find((candidate) => candidate.id === variantId);
        if (!asArray(variant?.media?.nodes).some((media) => media.id === created.media.id)) throw new Error(`Variant readback mismatch for ${variantId}`);
      }
      if (!asArray(product.media?.nodes).some((media) => media.id === created.media.id && media?.image?.url)) throw new Error(`Replacement media readback missing for ${decision.handle}`);
      entry.deletedSource = await deleteSourceIfUnreferenced(product, source.id, created.media.id);
      if (entry.deletedSource) manifest.summary.deletedSources += 1;
      entry.status = "completed-verified";
      entry.completedAt = new Date().toISOString();
      completedKeys.add(key);
      manifest.summary.completed += 1;
      priorState.completedKeys = [...completedKeys];
      priorState.entries ||= {};
      priorState.entries[key] = entry;
      priorState.status = "running";
      priorState.updatedAt = entry.completedAt;
      await writeJson(statePath, priorState);
      await writeJson(manifestPath, manifest);
      process.stdout.write(`Future Light held-image apply verified: ${decision.handle} / ${fingerprint(decision.heldSourceImageUrl)}\n`);
    } catch (error) {
      entry.status = "failed";
      entry.error = normalize(error?.message || error);
      entry.failedAt = new Date().toISOString();
      manifest.summary.failed += 1;
      priorState.status = "failed";
      priorState.updatedAt = entry.failedAt;
      priorState.entries ||= {};
      priorState.entries[key] = entry;
      await writeJson(statePath, priorState);
      await writeJson(manifestPath, manifest);
      throw error;
    }
  }

  manifest.summary.completed += manifest.summary.skippedCompleted;
  manifest.status = manifest.summary.failed ? "failed" : args.apply ? "completed" : "dry-run-ready";
  manifest.completedAt = new Date().toISOString();
  if (args.apply) {
    priorState.status = manifest.summary.failed ? "failed" : "completed";
    priorState.updatedAt = manifest.completedAt;
    await writeJson(statePath, priorState);
  }
  await writeJson(manifestPath, manifest);
  process.stdout.write(`Future Light held-image ${args.apply ? "apply" : "dry-run"}: ${manifest.summary.ready} ready, ${manifest.summary.completed} verified, ${manifest.summary.blocked} blocked, ${manifest.summary.failed} failed; ${manifest.summary.variantMappings} variant mapping(s), ${manifest.summary.deletedSources} source image(s) removed.\n`);
  if (manifest.summary.blocked || manifest.summary.failed) process.exitCode = 1;
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
