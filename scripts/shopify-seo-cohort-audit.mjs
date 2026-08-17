#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { buildShopifySeoReleasePlan } from "../src/lib/shopify-seo-release.js";
import { normalizeHandleValue, normalizePlainText } from "../src/lib/shopify-seo-batch.js";
import { PER_ORDER_OVERHEAD } from "../src/lib/shopify-seo-batch-intelligence.js";

const inputPath = resolve(process.cwd(), process.argv[2] || "output/new-products-305-catalog.json");
const outputPath = resolve(process.cwd(), process.argv[3] || "output/new-products-305-seo-audit.json");
const snapshot = JSON.parse(await readFile(inputPath, "utf8"));
const plan = await buildShopifySeoReleasePlan(snapshot);
const products = Array.isArray(snapshot.products) ? snapshot.products : [];
const sourceByHandle = new Map(products.map((product) => [normalizeHandleValue(product.handle), product]));

function plainHtml(value) {
  return normalizePlainText(String(value || "").replace(/<[^>]+>/g, " ").replace(/&amp;/gi, "&"));
}

function expectedQuantityTag(prices) {
  if (!prices.length) return "";
  const minimum = Math.min(...prices);
  if (minimum < 15) return "minimum-qty-3";
  if (minimum < 25) return "minimum-qty-2";
  return "";
}

function baseHandle(handle) {
  return normalizeHandleValue(handle).replace(/-\d+$/, "");
}

function stableReviewRank(handle) {
  let hash = 2166136261;
  for (const character of normalizeHandleValue(handle)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const titleGroups = new Map();
for (const product of plan.products) {
  const title = normalizePlainText(product.desiredProductInput?.title || product.sourceTitle);
  if (!titleGroups.has(title)) titleGroups.set(title, []);
  titleGroups.get(title).push(product.handle);
}

const contentGroups = new Map();
for (const product of plan.products) {
  const desired = product.desiredProductInput || {};
  const signature = JSON.stringify([
    normalizePlainText(desired.title || product.sourceTitle).toLowerCase(),
    normalizePlainText(desired.seo?.description).toLowerCase(),
    plainHtml(desired.descriptionHtml).toLowerCase(),
  ]);
  if (!contentGroups.has(signature)) contentGroups.set(signature, []);
  contentGroups.get(signature).push(product.handle);
}
const duplicateContentIssues = new Set();
for (const handles of contentGroups.values()) {
  if (handles.length < 2) continue;
  const identities = new Set(handles.map(baseHandle));
  if (identities.size > 1) handles.forEach((handle) => duplicateContentIssues.add(handle));
}

const records = [];
for (const product of plan.products) {
  const source = sourceByHandle.get(product.handle) || {};
  const desired = product.desiredProductInput || {};
  const title = normalizePlainText(desired.title || product.sourceTitle);
  const seoTitle = normalizePlainText(desired.seo?.title || title);
  const seoDescription = normalizePlainText(desired.seo?.description);
  const body = String(desired.descriptionHtml || "");
  const plainBody = plainHtml(body);
  const issues = [];
  const family = product.intelligence?.knowledge?.family || "";
  const operationalAdjustment = family === "order-adjustment";

  if (!title || title.length < 20 || title.length > 70) issues.push("title-length");
  if (/\b(?:and|for|with|of|to)$/i.test(title)) issues.push("title-trailing-connector");
  if (!seoTitle || seoTitle.length < 35 || seoTitle.length > 65) issues.push("seo-title-length");
  if (/\b(?:and|for|with|of|to)$/i.test(seoTitle)) issues.push("seo-title-trailing-connector");
  if (!seoDescription || seoDescription.length < 120 || seoDescription.length > 160) issues.push("seo-description-length");
  if ((body.match(/<h[23]>/gi) || []).length !== 4) issues.push("description-heading-count");
  if (!/<h2>About /i.test(body) || !/Key Details/i.test(body) || !/Use &amp; Care/i.test(body) || !/FAQs/i.test(body)) issues.push("description-structure");
  if (/\bSPECIFICATIONS\b|High-concerned chemical|Origin\s*:|Brand Name\s*:|product identity|catalog context|serves the specific function identified/i.test(plainBody)) issues.push("generic-or-raw-description");
  if (family === "general") issues.push("unclassified-family");
  if (duplicateContentIssues.has(product.handle)) issues.push("duplicate-seo-content");

  const sourceVariants = new Map((source.variants || []).map((variant) => [String(variant.id), variant]));
  const desiredPrices = [];
  for (const variant of product.desiredVariantUpdates || []) {
    const id = String(variant.variantId || "").match(/(\d+)$/)?.[1] || "";
    const before = Number(sourceVariants.get(id)?.price || 0);
    const after = Number(variant.price || 0);
    const compareAt = Number(variant.compareAtPrice || 0);
    if (!Number.isFinite(after) || after <= 0) issues.push(`invalid-price:${id}`);
    if (!operationalAdjustment && before > 0 && after + 0.001 < before + PER_ORDER_OVERHEAD) issues.push(`price-overhead-floor:${id}`);
    if (compareAt > 0 && (compareAt < after * 1.2 - 0.02 || compareAt > after * 1.4 + 0.02)) issues.push(`compare-at-range:${id}`);
    desiredPrices.push(after);
  }
  const expectedTag = operationalAdjustment ? "" : expectedQuantityTag(desiredPrices);
  if ((product.desiredQuantityTag || "") !== expectedTag) issues.push("quantity-tag");

  records.push({
    handle: product.handle,
    family,
    confidence: product.confidence,
    title,
    seoTitle,
    seoDescription,
    priceMin: desiredPrices.length ? Math.min(...desiredPrices) : null,
    desiredQuantityTag: product.desiredQuantityTag || "",
    status: issues.length ? "FAIL" : "PASS",
    issues,
  });
}

const failures = records.filter((record) => record.status === "FAIL");
const recordByHandle = new Map(records.map((record) => [record.handle, record]));
const reviewSample = [...plan.products]
  .sort((left, right) => stableReviewRank(left.handle) - stableReviewRank(right.handle))
  .slice(0, Math.min(100, plan.products.length))
  .map((product) => {
    const record = recordByHandle.get(product.handle);
    return {
      ...record,
      descriptionHtml: String(product.desiredProductInput?.descriptionHtml || ""),
    };
  });
const payload = {
  generatedAt: new Date().toISOString(),
  inputPath,
  summary: {
    products: records.length,
    passed: records.length - failures.length,
    failed: failures.length,
    reviewSampleCount: reviewSample.length,
    uniqueTitles: titleGroups.size,
    uniqueContentPackages: contentGroups.size,
    families: Object.fromEntries(
      Object.entries(Object.groupBy(records, (record) => record.family)).map(([family, entries]) => [family, entries.length]),
    ),
  },
  failures,
  reviewSample,
  products: records,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(payload.summary, null, 2)}\n`);
if (failures.length) {
  process.stdout.write(`${JSON.stringify(failures.slice(0, 30), null, 2)}\n`);
  process.exitCode = 1;
}
