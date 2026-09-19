#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { asArray, createShopifyAdminGraphQLClient, normalizeText } from "./shopify-admin-graphql-client.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const artifactPath = resolve(rootDir, process.env.FUTURE_LIGHT_CURATED_SEO_INPUT || "output/future-light-curated-product-seo-artifact-20260919.json");
const outputDir = resolve(rootDir, process.env.FUTURE_LIGHT_CURATED_SEO_APPLY_DIR || "output/future-light-curated-seo-apply-20260920");
const statePath = resolve(outputDir, "state.json");
const manifestPath = resolve(outputDir, "manifest.json");
const batchSize = Math.max(1, Math.min(25, Number(process.env.FUTURE_LIGHT_CURATED_SEO_BATCH_SIZE || 10)));
const client = createShopifyAdminGraphQLClient({ rootDir, agentName: "curated-product-seo-apply" });

const LIVE_PRODUCTS_QUERY = /* GraphQL */ `
  query CuratedSeoLiveProducts($after: String) {
    products(first: 250, after: $after, query: "status:active") {
      nodes {
        id
        legacyResourceId
        handle
        title
        descriptionHtml
        vendor
        status
        seo { title description }
        resourcePublications(first: 100) { nodes { isPublished channel { name } } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const PRODUCT_UPDATE_MUTATION = (size) => /* GraphQL */ `
  mutation CuratedSeoBatch(${Array.from({ length: size }, (_, index) => `$p${index}: ProductUpdateInput!`).join(", ")}) {
    ${Array.from({ length: size }, (_, index) => `
      p${index}: productUpdate(product: $p${index}) {
        product { id handle title descriptionHtml seo { title description } }
        userErrors { field message }
      }
    `).join("\n")}
  }
`;

const READBACK_QUERY = /* GraphQL */ `
  query CuratedSeoReadback($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product { id handle title descriptionHtml vendor status seo { title description } }
    }
  }
`;

function parseArgs(argv) {
  return { apply: argv.includes("--apply"), resume: argv.includes("--resume") };
}

function normalized(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

function canonicalHtml(value) {
  return normalized(value)
    .replace(/>\s+</g, "><")
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

function isOnlineStorePublished(product) {
  return asArray(product?.resourcePublications?.nodes).some((publication) => (
    publication?.isPublished === true && String(publication?.channel?.name || "").trim().toLowerCase() === "online store"
  ));
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function fetchLiveProducts() {
  const products = [];
  let after = null;
  while (true) {
    const payload = await client.run(LIVE_PRODUCTS_QUERY, { after }, { operation: "curated SEO live catalog read" });
    const connection = payload?.products;
    if (!connection) throw new Error("Curated SEO live catalog read returned no products connection.");
    products.push(...asArray(connection.nodes));
    if (!connection.pageInfo?.hasNextPage) break;
    if (!connection.pageInfo?.endCursor) throw new Error("Curated SEO live catalog page hasNextPage without an end cursor.");
    after = connection.pageInfo.endCursor;
  }
  return products.filter(isOnlineStorePublished);
}

function buildPlan(liveProducts, artifact) {
  const rows = asArray(artifact?.products);
  const byHandle = new Map(rows.map((row) => [normalized(row.handle).toLowerCase(), row]));
  const plan = [];
  const missing = [];
  const foreign = liveProducts.filter((product) => normalized(product.vendor) !== "VS Store");
  if (foreign.length) throw new Error(`Refused ${foreign.length} non-VS Store Online Store product(s).`);
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
    const changed = normalized(product.title) !== desired.title ||
      !sameDescription(product.descriptionHtml, desired.descriptionHtml) ||
      normalized(product.seo?.title || product.title) !== desired.seo.title ||
      normalized(product.seo?.description) !== desired.seo.description;
    plan.push({ product, desired, changed, evidence: row.evidence, audit: row.audit });
  }
  if (missing.length) throw new Error(`Curated SEO artifact missing ${missing.length} Online Store handle(s): ${missing.slice(0, 10).join(", ")}`);
  if (plan.length !== rows.length) throw new Error(`Curated SEO scope mismatch: live ${plan.length}, artifact ${rows.length}.`);
  return plan;
}

async function applyBatch(batch) {
  const variables = Object.fromEntries(batch.map((entry, index) => [`p${index}`, {
    id: entry.product.id,
    title: entry.desired.title,
    descriptionHtml: entry.desired.descriptionHtml,
    seo: entry.desired.seo,
  }]));
  const data = await client.run(PRODUCT_UPDATE_MUTATION(batch.length), variables, {
    allowMutations: true,
    operation: `curated SEO product batch (${batch.length})`,
  });
  const failures = [];
  for (const [index, entry] of batch.entries()) {
    const result = data?.[`p${index}`];
    for (const error of asArray(result?.userErrors)) failures.push(`${entry.product.handle}: ${error.message}`);
    if (!result?.product?.id) failures.push(`${entry.product.handle}: Shopify returned no updated product.`);
  }
  if (failures.length) throw new Error(failures.join(" | "));
  return batch.map((entry) => entry.product.id);
}

async function readback(ids) {
  const products = [];
  for (let offset = 0; offset < ids.length; offset += 250) {
    const payload = await client.run(READBACK_QUERY, { ids: ids.slice(offset, offset + 250) }, { operation: "curated SEO live readback" });
    products.push(...asArray(payload?.nodes));
  }
  return products;
}

function buildLocalSeoArtifact(artifact, liveProducts) {
  const liveByHandle = new Map(liveProducts.map((product) => [normalized(product.handle).toLowerCase(), product]));
  return {
    schemaVersion: "2026-09-20.curated-evidence-seo.1",
    generatedAt: new Date().toISOString(),
    source: "authoritative Shopify readback after curated evidence SEO apply",
    total: artifact.products.length,
    audit: artifact.audit,
    products: artifact.products.map((row) => {
      const live = liveByHandle.get(normalized(row.handle).toLowerCase());
      return {
        id: String(live?.legacyResourceId || row.id || ""),
        productId: live?.id || row.productId,
        handle: row.handle,
        sourceTitle: row.sourceTitle,
        title: row.title,
        seoTitle: row.seoTitle,
        seoDescription: row.seoDescription,
        descriptionHtml: row.descriptionHtml,
        productType: row.productType,
        classification: { familyId: row.productType, confidence: row.evidence?.confidence || "medium", source: "curated-evidence-audit" },
        evidence: row.evidence,
      };
    }),
  };
}

async function main() {
  const args = parseArgs(process.argv);
  await mkdir(outputDir, { recursive: true });
  const artifact = await readJson(artifactPath);
  const liveProducts = await fetchLiveProducts();
  const plan = buildPlan(liveProducts, artifact);
  const changed = plan.filter((entry) => entry.changed);
  const batches = Array.from({ length: Math.ceil(changed.length / batchSize) }, (_, index) => changed.slice(index * batchSize, (index + 1) * batchSize));
  const initialManifest = {
    generatedAt: new Date().toISOString(),
    status: args.apply ? "running" : "dry-run",
    targetStoreDomain: client.storeDomain,
    apiVersion: client.apiVersion,
    artifact: { path: artifactPath, generatedAt: artifact.generatedAt, total: artifact.products.length },
    summary: { liveOnlineStoreProducts: liveProducts.length, changedProducts: changed.length, totalBatches: batches.length, completedBatches: 0, failed: 0 },
    evidence: { zeroIssueArtifact: artifact.audit?.issueCount === 0, duplicateTitleGroups: artifact.audit?.duplicateTitleGroups || 0 },
  };
  await writeJson(manifestPath, initialManifest);
  if (!args.apply) {
    process.stdout.write(`${JSON.stringify({ mode: "dry-run", summary: initialManifest.summary, artifactAudit: artifact.audit }, null, 2)}\n`);
    return;
  }

  const prior = args.resume ? await readJson(statePath).catch(() => null) : null;
  const state = prior?.artifactGeneratedAt === artifact.generatedAt && prior?.liveProductCount === liveProducts.length
    ? prior
    : { schemaVersion: 1, artifactGeneratedAt: artifact.generatedAt, liveProductCount: liveProducts.length, completedBatches: [], updatedProductIds: [], status: "running" };
  for (let index = 0; index < batches.length; index += 1) {
    if (state.completedBatches.includes(index)) continue;
    const ids = await applyBatch(batches[index]);
    state.completedBatches = [...new Set([...state.completedBatches, index])].sort((left, right) => left - right);
    state.updatedProductIds = [...new Set([...state.updatedProductIds, ...ids])];
    await writeJson(statePath, state);
    process.stdout.write(`Applied curated SEO batch ${index + 1}/${batches.length}\n`);
  }

  const ids = plan.map((entry) => entry.product.id);
  const actual = await readback(ids);
  const expectedById = new Map(plan.map((entry) => [entry.product.id, entry.desired]));
  const failures = [];
  for (const product of actual) {
    const expected = expectedById.get(product.id);
    if (!expected) { failures.push(`${product.id}: unexpected readback product`); continue; }
    if (normalized(product.title) !== expected.title) failures.push(`${product.handle}: title readback mismatch`);
    if (!sameDescription(product.descriptionHtml, expected.descriptionHtml)) failures.push(`${product.handle}: description readback mismatch`);
    if (normalized(product.seo?.title || product.title) !== expected.seo.title) failures.push(`${product.handle}: SEO title readback mismatch`);
    if (normalized(product.seo?.description) !== expected.seo.description) failures.push(`${product.handle}: SEO description readback mismatch`);
  }
  if (actual.length !== ids.length) failures.push(`readback returned ${actual.length}/${ids.length} products`);
  const manifest = { ...initialManifest, status: failures.length ? "failed-readback" : "completed", completedAt: new Date().toISOString(), summary: { ...initialManifest.summary, completedBatches: state.completedBatches.length, failed: failures.length, readbackProducts: actual.length }, failures: failures.slice(0, 100) };
  state.status = manifest.status;
  state.completedAt = manifest.completedAt;
  await writeJson(statePath, state);
  await writeJson(manifestPath, manifest);
  if (failures.length) throw new Error(`Curated SEO readback failed for ${failures.length} item(s): ${failures.slice(0, 8).join(" | ")}`);

  await writeJson(resolve(rootDir, "public/data/product-seo.json"), buildLocalSeoArtifact(artifact, liveProducts));
  process.stdout.write(`Curated SEO apply complete: ${actual.length} Online Store products read back and verified.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
