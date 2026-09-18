#!/usr/bin/env node

/* Apply only the explicit ChatGPT visual-review contract. No heuristic label
 * generation, option reordering, SKU changes, price changes, or broad media
 * cleanup is permitted here. */

import { execFile } from "node:child_process";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import { FUTURE_LIGHT_SHOP_DOMAIN } from "./lib/product-image-health.mjs";

const execFileAsync = promisify(execFile);
const rootDir = resolve(import.meta.dirname, "..");
const reviewDir = resolve(rootDir, "output", "future-light-visual-review");
const queuePath = resolve(reviewDir, "queue.json");
const approvedPath = resolve(reviewDir, "approved-mappings.json");
const statePath = resolve(reviewDir, "apply-state.json");
const manifestPath = resolve(reviewDir, "apply-manifest.json");
const apiVersion = process.env.FUTURE_LIGHT_SHOPIFY_API_VERSION || process.env.SHOPIFY_ADMIN_API_VERSION || "2026-07";
const cliBinary = process.env.SHOPIFY_CLI_BINARY || "shopify";

const PRODUCT_QUERY = /* GraphQL */ `
  query FutureLightVisualApplyProduct($id: ID!) {
    node(id: $id) {
      ... on Product {
        id handle title vendor status
        options { id name position optionValues { id name } }
        media(first: 250) {
          nodes { __typename id alt ... on MediaImage { image { url width height } } }
          pageInfo { hasNextPage }
        }
        variants(first: 250) {
          nodes { id title sku selectedOptions { name value } media(first: 1) { nodes { __typename id ... on MediaImage { image { url width height } } } } }
          pageInfo { hasNextPage }
        }
      }
    }
  }
`;

const PRODUCT_BY_HANDLE_QUERY = /* GraphQL */ `
  query FutureLightVisualApplyProductByHandle($query: String!) {
    products(first: 1, query: $query) {
      nodes {
        id handle title vendor status
        media(first: 250) { nodes { __typename id alt ... on MediaImage { image { url width height } } } pageInfo { hasNextPage } }
        variants(first: 250) { nodes { id title media(first: 1) { nodes { __typename id } } } pageInfo { hasNextPage } }
      }
    }
  }
`;

const OPTION_UPDATE_MUTATION = /* GraphQL */ `
  mutation FutureLightVisualOptionUpdate($productId: ID!, $option: OptionUpdateInput!, $updates: [OptionValueUpdateInput!]!) {
    productOptionUpdate(productId: $productId, option: $option, optionValuesToUpdate: $updates) {
      userErrors { field message code }
    }
  }
`;

const VARIANT_UPDATE_MUTATION = /* GraphQL */ `
  mutation FutureLightVisualVariantUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id }
      userErrors { field message code }
    }
  }
`;

const STAGED_UPLOAD_MUTATION = /* GraphQL */ `
  mutation FutureLightVisualStage($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url resourceUrl parameters { name value } }
      userErrors { field message code }
    }
  }
`;

const CREATE_MEDIA_MUTATION = /* GraphQL */ `
  mutation FutureLightVisualCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media { id alt }
      mediaUserErrors { field message code }
      userErrors { field message code }
    }
  }
`;

const DELETE_MEDIA_MUTATION = /* GraphQL */ `
  mutation FutureLightVisualDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
    productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
      deletedMediaIds
      mediaUserErrors { field message code }
      userErrors { field message code }
    }
  }
`;

function asArray(value) { return Array.isArray(value) ? value : []; }
function normalize(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function sameShopifyId(left, right) {
  const a = normalize(left);
  const b = normalize(right);
  if (a === b) return true;
  const aNumeric = a.match(/(\d+)$/)?.[1];
  const bNumeric = b.match(/(\d+)$/)?.[1];
  return Boolean(aNumeric && bNumeric && aNumeric === bNumeric);
}
function safeChildEnv() { return Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^SALT_/i.test(key))); }

function parseEnvValue(value) {
  const trimmed = String(value || "").trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
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
      if (match[1].startsWith("FUTURE_LIGHT_") || match[1].startsWith("SHOPIFY_")) {
        if (process.env[match[1]] === undefined) process.env[match[1]] = parseEnvValue(match[2]);
      }
    }
  }
}

function parseGraphqlOutput(raw, operation) {
  const text = String(raw || "").trim();
  const start = text.indexOf("{");
  if (start < 0) throw new Error(`${operation}: Shopify returned no JSON`);
  const payload = JSON.parse(text.slice(start));
  const errors = [...asArray(payload?.errors), ...asArray(payload?.data?.errors)];
  if (errors.length) throw new Error(`${operation}: ${errors.map((error) => error.message || "GraphQL error").join(" | ")}`);
  return payload?.data || payload;
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
  const tempDir = await mkdtemp(join(tmpdir(), "future-light-visual-apply-"));
  const queryPath = join(tempDir, "operation.graphql");
  const variablesPath = join(tempDir, "variables.json");
  const outputPath = join(tempDir, "result.json");
  try {
    await Promise.all([writeFile(queryPath, query, "utf8"), writeFile(variablesPath, JSON.stringify(variables || {}), "utf8")]);
    const args = ["store", "execute", "--store", FUTURE_LIGHT_SHOP_DOMAIN, "--version", apiVersion, "--query-file", queryPath, "--variable-file", variablesPath, "--output-file", outputPath, "--json"];
    if (mutation) args.push("--allow-mutations");
    const result = await execFileAsync(cliBinary, args, { cwd: rootDir, env: { ...safeChildEnv(), CI: "1", SHOPIFY_CLI_DISABLE_ANALYTICS: "1" }, timeout: 180_000, maxBuffer: 20 * 1024 * 1024 });
    let raw = result.stdout || "";
    try { raw = await readFile(outputPath, "utf8"); } catch { /* stdout fallback */ }
    return parseGraphqlOutput(raw, operation);
  } finally { await rm(tempDir, { recursive: true, force: true }); }
}

async function readJson(path, fallback = null) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return fallback; throw error; }
}

async function writeJson(path, value) {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function formatErrors(errors) { return asArray(errors).map((error) => error.message || "Shopify mutation error").join(" | "); }

async function readProduct(id) {
  const data = await runGraphql(PRODUCT_QUERY, { id }, { operation: `read visual apply product ${id}` });
  const product = data?.node;
  if (!product) throw new Error(`Future Light product not found: ${id}`);
  if (normalize(product.vendor) !== "VS Store") throw new Error(`Refused non-VS Store product: ${product.handle}`);
  if (normalize(product.status).toUpperCase() !== "ACTIVE") throw new Error(`Refused non-active product: ${product.handle}`);
  if (product.media?.pageInfo?.hasNextPage || product.variants?.pageInfo?.hasNextPage) throw new Error(`Incomplete media or variant pagination for ${product.handle}`);
  return product;
}

async function readProductByHandle(handle) {
  const data = await runGraphql(PRODUCT_BY_HANDLE_QUERY, { query: `handle:${handle}` }, { operation: `read visual apply product ${handle}` });
  const product = data?.products?.nodes?.[0];
  if (!product) throw new Error(`Future Light product not found: ${handle}`);
  if (normalize(product.vendor) !== "VS Store") throw new Error(`Refused non-VS Store product: ${handle}`);
  return product;
}

async function stageAsset(filePath) {
  const extension = filePath.toLowerCase().split(".").pop();
  const mimeType = extension === "webp" ? "image/webp" : extension === "jpg" || extension === "jpeg" ? "image/jpeg" : "image/png";
  const data = await runGraphql(STAGED_UPLOAD_MUTATION, { input: [{ resource: "IMAGE", filename: basename(filePath), mimeType, httpMethod: "POST" }] }, { mutation: true, operation: `stage ${basename(filePath)}` });
  const payload = data?.stagedUploadsCreate;
  const errors = [...asArray(payload?.userErrors)];
  if (errors.length) throw new Error(`Stage upload failed: ${formatErrors(errors)}`);
  const target = payload?.stagedTargets?.[0];
  if (!target?.url || !target?.resourceUrl) throw new Error(`Shopify returned no stage target for ${basename(filePath)}`);
  const args = ["-sS", "-X", "POST", target.url];
  for (const parameter of asArray(target.parameters)) args.push("-F", `${parameter.name}=${parameter.value}`);
  args.push("-F", `file=@${filePath};type=${mimeType}`);
  await execFileAsync("curl", args, { cwd: rootDir, timeout: 180_000, maxBuffer: 20 * 1024 * 1024 });
  return target.resourceUrl;
}

async function createReplacementMedia(product, decision) {
  if (decision.productIdentityPreserved !== true || !sameShopifyId(decision.sourceProductId, product.id)) {
    throw new Error(`${product.handle}: refused replacement image without exact source-product identity confirmation`);
  }
  if (normalize(decision.identityReviewNote).length < 30) {
    throw new Error(`${product.handle}: refused replacement image without a substantive identity review note`);
  }
  const assetPath = resolve(rootDir, normalize(decision.generatedAssetPath || ""));
  if (!assetPath.startsWith(`${resolve(rootDir, "output", "imagegen")}/`)) throw new Error(`Refused generated asset outside output/imagegen: ${decision.generatedAssetPath}`);
  await access(assetPath);
  const originalSource = await stageAsset(assetPath);
  const data = await runGraphql(CREATE_MEDIA_MUTATION, {
    productId: product.id,
    media: [{ originalSource, mediaContentType: "IMAGE", alt: normalize(decision.alt || "VS Store product image") }],
  }, { mutation: true, operation: `create replacement media ${product.handle}` });
  const payload = data?.productCreateMedia;
  const errors = [...asArray(payload?.mediaUserErrors), ...asArray(payload?.userErrors)];
  if (errors.length) throw new Error(`Create replacement media failed for ${product.handle}: ${formatErrors(errors)}`);
  const media = payload?.media?.[0];
  if (!media?.id) throw new Error(`Shopify returned no replacement media ID for ${product.handle}`);
  return media.id;
}

async function updateOptions(product, decisions) {
  const groups = new Map();
  for (const decision of decisions) {
    const option = product.options.find((candidate) => candidate.optionValues?.some((value) => value.id === decision.optionValueId));
    if (!option) throw new Error(`${product.handle}: option value ${decision.optionValueId} is not present in live readback`);
    const current = option.optionValues.find((value) => value.id === decision.optionValueId);
    if (decision.fromName && normalize(decision.fromName) !== normalize(current.name)) throw new Error(`${product.handle}: option value changed since visual review (${current.name})`);
    if (!groups.has(option.id)) groups.set(option.id, []);
    groups.get(option.id).push({ id: decision.optionValueId, name: normalize(decision.newName) });
  }
  for (const [optionId, updates] of groups) {
    const data = await runGraphql(OPTION_UPDATE_MUTATION, { productId: product.id, option: { id: optionId }, updates }, { mutation: true, operation: `rename visual options ${product.handle}` });
    const errors = asArray(data?.productOptionUpdate?.userErrors);
    if (errors.length) throw new Error(`Option rename failed for ${product.handle}: ${formatErrors(errors)}`);
  }
}

async function updateVariants(product, decisions, replacements) {
  const updates = [];
  for (const decision of decisions) {
    const mediaId = decision.sourceImageUrl && replacements.get(normalize(decision.sourceImageUrl))
      ? replacements.get(normalize(decision.sourceImageUrl))
      : decision.mediaId;
    const variant = product.variants?.nodes?.find((candidate) => candidate.id === decision.variantId);
    if (!variant) throw new Error(`${product.handle}: variant ${decision.variantId} is not present in live readback`);
    if (!product.media?.nodes?.some((media) => media.id === mediaId) && !replacementsHasValue(replacements, mediaId)) {
      throw new Error(`${product.handle}: approved media ${mediaId} is not in live product media`);
    }
    updates.push({ id: decision.variantId, mediaId });
  }
  if (!updates.length) return new Map();
  const data = await runGraphql(VARIANT_UPDATE_MUTATION, { productId: product.id, variants: updates }, { mutation: true, operation: `apply visual variant media ${product.handle}` });
  const errors = asArray(data?.productVariantsBulkUpdate?.userErrors);
  if (errors.length) throw new Error(`Variant media update failed for ${product.handle}: ${formatErrors(errors)}`);
  return new Map(updates.map((update) => [update.id, update.mediaId]));
}

function replacementsHasValue(replacements, value) { return [...replacements.values()].includes(value); }

async function deleteReplacedMedia(product, decisions, replacements) {
  const ids = [];
  const referenced = new Set(asArray(product.variants?.nodes).flatMap((variant) => asArray(variant.media?.nodes).map((media) => media.id)));
  for (const decision of decisions) {
    if (decision.action !== "recreate") continue;
    const source = product.media?.nodes?.find((media) => normalize(media.image?.url) === normalize(decision.imageUrl));
    if (source && !replacementsHasValue(replacements, source.id)) {
      if (referenced.has(source.id)) throw new Error(`${product.handle}: refusing to delete replaced media still linked to a live variant (${source.id})`);
      ids.push(source.id);
    }
  }
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const data = await runGraphql(DELETE_MEDIA_MUTATION, { productId: product.id, mediaIds: unique }, { mutation: true, operation: `remove replaced visual media ${product.handle}` });
  const payload = data?.productDeleteMedia;
  const errors = [...asArray(payload?.mediaUserErrors), ...asArray(payload?.userErrors)];
  if (errors.length) throw new Error(`Replacement cleanup failed for ${product.handle}: ${formatErrors(errors)}`);
  return asArray(payload?.deletedMediaIds);
}

function verifyReadback(product, optionDecisions, variantDecisions, replacementMap, deletedMediaIds) {
  for (const decision of optionDecisions) {
    const option = product.options.find((candidate) => candidate.optionValues?.some((value) => value.id === decision.optionValueId));
    const actual = option?.optionValues?.find((value) => value.id === decision.optionValueId)?.name;
    if (normalize(actual) !== normalize(decision.newName)) throw new Error(`${product.handle}: option readback mismatch for ${decision.optionValueId}`);
  }
  for (const decision of variantDecisions) {
    const expected = decision.sourceImageUrl && replacementMap.get(normalize(decision.sourceImageUrl)) || decision.mediaId;
    const actual = product.variants?.nodes?.find((variant) => variant.id === decision.variantId)?.media?.nodes?.[0]?.id;
    if (actual !== expected) throw new Error(`${product.handle}: variant media readback mismatch for ${decision.variantId}`);
  }
  const liveMediaIds = new Set(asArray(product.media?.nodes).map((media) => media.id));
  for (const id of deletedMediaIds) if (liveMediaIds.has(id)) throw new Error(`${product.handle}: deleted media still present on readback (${id})`);
}

async function runCheck() {
  const result = await execFileAsync(process.execPath, [resolve(rootDir, "scripts", "future-light-visual-variant-review.mjs"), "--check"], { cwd: rootDir, env: safeChildEnv(), timeout: 180_000, maxBuffer: 20 * 1024 * 1024 });
  return result.stdout;
}

async function main() {
  await loadFutureEnv();
  await runCheck();
  const queue = await readJson(queuePath);
  const approved = await readJson(approvedPath);
  if (!queue || !approved) throw new Error("Visual queue or approved mapping is missing");
  if (queue.targetStoreDomain !== FUTURE_LIGHT_SHOP_DOMAIN || approved.targetStoreDomain !== FUTURE_LIGHT_SHOP_DOMAIN) throw new Error("Refused non-Future Light Store visual apply target");
  if ((queue.variantOptionEntries || []).length) {
    throw new Error("Visual apply refused: variant-only option labels need a separate explicit option-repair contract; media apply will not silently ignore them.");
  }

  const state = await readJson(statePath, { schemaVersion: "2026-09-16.future-light-visual-variant-apply.1", completedHandles: [], entries: {}, status: "running" });
  state.completedHandles ||= [];
  state.entries ||= {};
  const optionByHandle = new Map((queue.optionEntries || []).map((entry) => [entry.handle, entry]));
  const variantByHandle = new Map((queue.variantEntries || []).map((entry) => [entry.handle, entry]));
  const imageByHandle = new Map();
  for (const decision of approved.imageDecisions || []) {
    if (!imageByHandle.has(decision.handle)) imageByHandle.set(decision.handle, []);
    imageByHandle.get(decision.handle).push(decision);
  }
  const productIds = new Map();
  for (const entry of [...(queue.optionEntries || []), ...(queue.variantEntries || [])]) productIds.set(entry.handle, entry.productId);
  for (const image of queue.imageEntries || []) if (!productIds.has(image.handle) && image.productId) productIds.set(image.handle, `gid://shopify/Product/${image.productId}`);
  const handles = [...new Set([...optionByHandle.keys(), ...variantByHandle.keys(), ...imageByHandle.keys()])];

  const manifest = { schemaVersion: "2026-09-16.future-light-visual-variant-apply.1", targetStoreDomain: FUTURE_LIGHT_SHOP_DOMAIN, queueFingerprint: queue.queueFingerprint, status: "running", entries: state.entries || {}, summary: { products: handles.length, completed: state.completedHandles?.length || 0, failed: 0 }, startedAt: new Date().toISOString() };
  await writeJson(manifestPath, manifest);

  for (const handle of handles) {
    if (state.completedHandles?.includes(handle)) continue;
    const optionEntry = optionByHandle.get(handle);
    const variantEntry = variantByHandle.get(handle);
    const imageDecisions = imageByHandle.get(handle) || [];
    const productId = productIds.get(handle);
    if (!productId) throw new Error(`No product ID for approved visual handle ${handle}`);
    const entry = { handle, status: "running", optionRenames: 0, variantMappings: 0, replacements: 0, deletedMediaIds: [] };
    state.entries[handle] = entry;
    manifest.entries = state.entries;
    try {
      let product = await readProduct(productId);
      const optionDecisions = (approved.optionValueDecisions || []).filter((decision) => optionEntry?.options?.some((option) => option.values.some((value) => value.optionValueId === decision.optionValueId)));
      const variantDecisions = (approved.variantMediaAssignments || []).filter((decision) => variantEntry?.variants?.some((variant) => variant.variantId === decision.variantId));
      const replacements = new Map();
      for (const decision of imageDecisions.filter((item) => item.action === "recreate")) {
        if (replacements.has(normalize(decision.imageUrl))) continue;
        replacements.set(normalize(decision.imageUrl), await createReplacementMedia(product, decision));
        entry.replacements += 1;
        product = await readProduct(product.id);
      }
      await updateOptions(product, optionDecisions);
      entry.optionRenames = optionDecisions.length;
      const appliedVariants = await updateVariants(product, variantDecisions, replacements);
      entry.variantMappings = appliedVariants.size;
      product = await readProduct(product.id);
      entry.deletedMediaIds = await deleteReplacedMedia(product, imageDecisions, replacements);
      product = await readProduct(product.id);
      verifyReadback(product, optionDecisions, variantDecisions, replacements, entry.deletedMediaIds);
      entry.status = "completed-verified";
      entry.verifiedAt = new Date().toISOString();
      state.completedHandles = [...new Set([...(state.completedHandles || []), handle])];
      state.status = "running";
      manifest.summary.completed = state.completedHandles.length;
      await writeJson(statePath, state);
      manifest.entries = state.entries;
      await writeJson(manifestPath, manifest);
      process.stdout.write(`Future Light visual apply verified: ${handle}\n`);
    } catch (error) {
      entry.status = "failed";
      entry.error = normalize(error?.message || error);
      manifest.summary.failed += 1;
      await writeJson(statePath, state);
      await writeJson(manifestPath, manifest);
      throw error;
    }
  }
  manifest.status = "completed";
  manifest.completedAt = new Date().toISOString();
  state.status = "completed";
  await writeJson(statePath, state);
  await writeJson(manifestPath, manifest);
  process.stdout.write(`Future Light visual variant/image apply complete: ${manifest.summary.completed}/${manifest.summary.products} products verified.\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
