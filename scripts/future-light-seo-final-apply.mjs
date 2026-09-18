#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readFile as readText, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import { FUTURE_LIGHT_SHOP_DOMAIN } from "./lib/product-image-health.mjs";

const execFileAsync = promisify(execFile);
const rootDir = resolve(import.meta.dirname, "..");
const artifactPath = resolve(rootDir, "public", "data", "product-seo.json");
const outputDir = resolve(rootDir, "output", "future-light-seo-final");
const statePath = resolve(outputDir, "state.json");
const manifestPath = resolve(outputDir, "manifest.json");
const apiVersion = process.env.FUTURE_LIGHT_SHOPIFY_API_VERSION || process.env.SHOPIFY_ADMIN_API_VERSION || "2026-07";
const cliBinary = process.env.SHOPIFY_CLI_BINARY || "shopify";
const batchSize = 5;
const workerCount = Math.max(1, Math.min(4, Number(process.env.FUTURE_LIGHT_SEO_APPLY_WORKERS || 4)));

const ACTIVE_PRODUCTS_QUERY = /* GraphQL */ `
  query FutureLightActiveProducts($after: String) {
    products(first: 250, after: $after, query: "status:active") {
      nodes { id handle title descriptionHtml vendor seo { title description } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const PRODUCT_UPDATE_MUTATION = (size) => /* GraphQL */ `
  mutation FutureLightSeoBatch(${Array.from({ length: size }, (_, index) => `$p${index}: ProductUpdateInput!`).join(", ")}) {
    ${Array.from({ length: size }, (_, index) => `
      p${index}: productUpdate(product: $p${index}) {
        product { id handle title descriptionHtml seo { title description } }
        userErrors { field message }
      }
    `).join("\n")}
  }
`;

const READBACK_QUERY = /* GraphQL */ `
  query FutureLightSeoReadback($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product { id handle title descriptionHtml vendor seo { title description } }
    }
  }
`;

function parseArgs(argv) {
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
    try {
      raw = await readText(file, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      const key = match[1];
      if (key.startsWith("SALT_")) continue;
      if (key.startsWith("FUTURE_LIGHT_") || key.startsWith("SHOPIFY_") || key === "OPENAI_API_KEY") {
        if (process.env[key] === undefined) process.env[key] = parseEnvValue(match[2]);
      }
    }
  }
}

function safeChildEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("SALT_")),
  );
}

function parseGraphqlOutput(raw, operation) {
  const text = String(raw || "").trim();
  const jsonStart = text.indexOf("{");
  if (jsonStart < 0) throw new Error(`${operation}: Shopify returned no JSON`);
  const payload = JSON.parse(text.slice(jsonStart));
  const errors = payload?.errors || payload?.data?.errors || [];
  if (errors.length) throw new Error(`${operation}: ${errors.map((entry) => entry.message || "GraphQL error").join(" | ")}`);
  return payload?.data || payload;
}

async function runGraphql(query, variables, { mutation = false, operation = "Shopify request" } = {}) {
  const token = String(process.env.FUTURE_LIGHT_SHOPIFY_ADMIN_ACCESS_TOKEN || "").trim();
  const graphqlUrl = `https://${FUTURE_LIGHT_SHOP_DOMAIN}/admin/api/${apiVersion}/graphql.json`;
  if (token) {
    const response = await fetch(graphqlUrl, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(180_000),
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`${operation}: Admin GraphQL HTTP ${response.status}: ${raw.slice(0, 400)}`);
    return parseGraphqlOutput(raw, operation);
  }

  const tempDir = await mkdtemp(join(tmpdir(), "future-light-shopify-seo-"));
  const queryPath = join(tempDir, "operation.graphql");
  const variablesPath = join(tempDir, "variables.json");
  const outputPath = join(tempDir, "result.json");
  try {
    await Promise.all([
      writeFile(queryPath, query, "utf8"),
      writeFile(variablesPath, JSON.stringify(variables), "utf8"),
    ]);
    const args = [
      "store", "execute", "--store", FUTURE_LIGHT_SHOP_DOMAIN, "--version", apiVersion,
      "--query-file", queryPath, "--variable-file", variablesPath,
      "--output-file", outputPath, "--json",
    ];
    if (mutation) args.push("--allow-mutations");
    const result = await execFileAsync(cliBinary, args, {
      cwd: rootDir,
      env: { ...safeChildEnv(), CI: "1", SHOPIFY_CLI_DISABLE_ANALYTICS: "1" },
      timeout: 180_000,
      maxBuffer: 20 * 1024 * 1024,
    });
    let raw = result.stdout || "";
    try { raw = await readFile(outputPath, "utf8"); } catch { /* stdout fallback */ }
    return parseGraphqlOutput(raw, operation);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
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

function normalized(value) { return String(value ?? "").replace(/\r\n/g, "\n").trim(); }

// Shopify may pretty-print description HTML on readback (for example by
// inserting a newline after a list item). Those formatting-only changes do
// not alter the customer-facing content, so compare a canonical HTML form.
function canonicalHtml(value) {
  return normalized(value)
    .replace(/>\s+</g, "><")
    // Shopify decodes safe HTML entities while persisting rich text.
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&hellip;/gi, "…");
}

function sameDescription(actual, expected) {
  return canonicalHtml(actual) === canonicalHtml(expected);
}

function effectiveSeoTitle(product) {
  // Shopify returns null when the SEO title intentionally inherits the
  // product title. Treat that as the explicit desired title on readback.
  return normalized(product?.seo?.title || product?.title);
}

async function fetchActiveProducts() {
  const products = [];
  let after = null;
  do {
    const data = await runGraphql(ACTIVE_PRODUCTS_QUERY, { after }, { operation: "Future Light active catalog read" });
    const page = data?.products;
    if (!page) throw new Error("Future Light active catalog read returned no products connection");
    products.push(...(page.nodes || []));
    after = page.pageInfo?.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return products;
}

function buildPlan(liveProducts, artifact) {
  const artifactRows = Array.isArray(artifact?.products) ? artifact.products : [];
  const byHandle = new Map(artifactRows.map((row) => [normalized(row.handle).toLowerCase(), row]));
  const plan = [];
  const missing = [];
  const foreign = liveProducts.filter((product) => normalized(product.vendor) !== "VS Store");
  if (foreign.length) throw new Error(`Future Light SEO refused ${foreign.length} non-VS Store active product(s)`);
  for (const product of liveProducts) {
    const row = byHandle.get(normalized(product.handle).toLowerCase());
    if (!row) { missing.push(product.handle); continue; }
    const desired = {
      id: product.id,
      handle: product.handle,
      title: normalized(row.title),
      descriptionHtml: normalized(row.descriptionHtml),
      seo: { title: normalized(row.seoTitle || row.title), description: normalized(row.seoDescription) },
    };
    const update = { id: product.id, title: desired.title, descriptionHtml: desired.descriptionHtml, seo: desired.seo };
    const changed = normalized(product.title) !== desired.title ||
      !sameDescription(product.descriptionHtml, desired.descriptionHtml) ||
      effectiveSeoTitle(product) !== desired.seo.title ||
      normalized(product.seo?.description) !== desired.seo.description;
    plan.push({ product, desired, update, changed });
  }
  if (missing.length) throw new Error(`Product SEO artifact is missing ${missing.length} live active handle(s): ${missing.slice(0, 10).join(", ")}`);
  if (plan.length !== artifactRows.length) {
    throw new Error(`Product SEO scope mismatch: live active ${plan.length}, artifact ${artifactRows.length}`);
  }
  return plan;
}

async function applyBatch(batch) {
  const variables = Object.fromEntries(batch.map((entry, index) => [`p${index}`, entry.update]));
  const data = await runGraphql(PRODUCT_UPDATE_MUTATION(batch.length), variables, {
    mutation: true,
    operation: `Future Light SEO product batch (${batch.length})`,
  });
  const failures = [];
  for (const [index, entry] of batch.entries()) {
    const result = data?.[`p${index}`];
    for (const error of result?.userErrors || []) failures.push(`${entry.product.handle}: ${error.message}`);
    if (!result?.product?.id) failures.push(`${entry.product.handle}: Shopify returned no updated product`);
  }
  if (failures.length) throw new Error(failures.join(" | "));
  return batch.map((entry) => entry.product.id);
}

async function readback(ids) {
  const result = [];
  for (let offset = 0; offset < ids.length; offset += 250) {
    const data = await runGraphql(READBACK_QUERY, { ids: ids.slice(offset, offset + 250) }, { operation: "Future Light SEO live readback" });
    result.push(...(data?.nodes || []));
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv);
  await loadFutureEnv();
  await mkdir(outputDir, { recursive: true });
  const artifact = await readJson(artifactPath);
  if (!artifact?.products?.length) throw new Error(`Missing product SEO artifact: ${artifactPath}`);
  const liveProducts = await fetchActiveProducts();
  const plan = buildPlan(liveProducts, artifact);
  const changed = plan.filter((entry) => entry.changed);
  const batches = Array.from({ length: Math.ceil(changed.length / batchSize) }, (_, index) => changed.slice(index * batchSize, (index + 1) * batchSize));
  const priorState = args.resume ? await readJson(statePath, null) : null;
  const state = priorState?.artifactGeneratedAt === artifact.generatedAt && priorState?.liveProductCount === liveProducts.length
    ? priorState
    : { schemaVersion: "2026-09-15.future-light-seo-final.1", artifactGeneratedAt: artifact.generatedAt, liveProductCount: liveProducts.length, completedBatches: [], updatedProductIds: [], status: "planned" };
  const manifest = {
    generatedAt: new Date().toISOString(),
    status: args.dryRun ? "dry-run" : "running",
    targetStoreDomain: FUTURE_LIGHT_SHOP_DOMAIN,
    apiVersion,
    scope: "all active VS Store products",
    artifact: { path: artifactPath, generatedAt: artifact.generatedAt, total: artifact.products.length },
    summary: { liveProducts: liveProducts.length, changedProducts: changed.length, totalBatches: batches.length, completedBatches: state.completedBatches.length, failed: 0 },
    changedHandles: changed.map((entry) => entry.product.handle),
  };
  await writeJson(manifestPath, manifest);
  if (args.dryRun) {
    manifest.completedAt = new Date().toISOString();
    await writeJson(manifestPath, manifest);
    process.stdout.write(`Future Light SEO dry-run: ${changed.length} product(s) would update; ${batches.length} batch(es).\n`);
    return;
  }

  const pending = batches.map((batch, index) => ({ batch, index })).filter(({ index }) => !state.completedBatches.includes(index));
  let cursor = 0;
  let checkpointTail = Promise.resolve();
  const persistCheckpoint = (item, ids) => {
    checkpointTail = checkpointTail.then(async () => {
      state.completedBatches = [...new Set([...state.completedBatches, item.index])].sort((left, right) => left - right);
      state.updatedProductIds = [...new Set([...state.updatedProductIds, ...ids])];
      state.status = "running";
      await writeJson(statePath, state);
      manifest.summary.completedBatches = state.completedBatches.length;
      await writeJson(manifestPath, manifest);
    });
    return checkpointTail;
  };
  const worker = async () => {
    while (cursor < pending.length) {
      const item = pending[cursor++];
      const ids = await applyBatch(item.batch);
      await persistCheckpoint(item, ids);
      process.stdout.write(`Applied SEO batch ${item.index + 1}/${batches.length}\n`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(workerCount, Math.max(1, pending.length)) }, worker));
  const ids = plan.map((entry) => entry.product.id);
  const liveAfter = await readback(ids);
  const expectedById = new Map(plan.map((entry) => [entry.product.id, entry.desired]));
  const failures = [];
  for (const actual of liveAfter) {
    const expected = expectedById.get(actual.id);
    if (!expected) { failures.push(`${actual.id}: unexpected product in readback`); continue; }
    if (normalized(actual.title) !== expected.title) failures.push(`${actual.handle}: title readback mismatch`);
    if (!sameDescription(actual.descriptionHtml, expected.descriptionHtml)) failures.push(`${actual.handle}: description readback mismatch`);
    if (effectiveSeoTitle(actual) !== expected.seo.title) failures.push(`${actual.handle}: SEO title readback mismatch`);
    if (normalized(actual.seo?.description) !== expected.seo.description) failures.push(`${actual.handle}: SEO description readback mismatch`);
  }
  if (liveAfter.length !== ids.length) failures.push(`readback returned ${liveAfter.length}/${ids.length} products`);
  manifest.summary.failed = failures.length;
  manifest.summary.completedBatches = state.completedBatches.length;
  manifest.status = failures.length ? "failed-readback" : "completed";
  manifest.completedAt = new Date().toISOString();
  manifest.failures = failures.slice(0, 100);
  state.status = manifest.status;
  state.completedAt = manifest.completedAt;
  await writeJson(statePath, state);
  await writeJson(manifestPath, manifest);
  if (failures.length) throw new Error(`Future Light SEO live readback failed for ${failures.length} item(s): ${failures.slice(0, 8).join(" | ")}`);
  process.stdout.write(`Future Light SEO final apply complete: ${liveAfter.length} product(s) read back and verified.\n`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
