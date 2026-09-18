#!/usr/bin/env node

/* Future Light-only read-only product title/description/SEO verification. */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assessProductContentSpecificity } from "../src/lib/product-content-specificity.js";
import { createShopifyAdminGraphQLClient } from "./shopify-admin-graphql-client.mjs";
import { FUTURE_LIGHT_BRAND, FUTURE_LIGHT_SHOP_DOMAIN } from "./lib/product-image-health.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const outputPath = resolve(rootDir, "output/future-light-product-specificity-live-verify.json");
const envFiles = [resolve(rootDir, ".env.local"), resolve(rootDir, ".env.release.local")];
const PAGE_SIZE = 250;

const PRODUCTS_QUERY = /* GraphQL */ `
  query FutureLightProductSpecificity($first: Int!, $after: String) {
    products(first: $first, after: $after, query: "status:active") {
      nodes {
        id
        legacyResourceId
        handle
        title
        descriptionHtml
        productType
        vendor
        tags
        status
        category { id name fullName }
        seo { title description }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

function normalize(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function stripHtml(value) { return String(value || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim(); }
function parseEnvValue(value) {
  const trimmed = String(value || "").trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed.replace(/\s+#.*$/, "");
}
async function loadFutureEnv() {
  for (const file of envFiles) {
    let raw;
    try { raw = await readFile(file, "utf8"); }
    catch (error) { if (error?.code === "ENOENT") continue; throw error; }
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      if (match[1].startsWith("FUTURE_LIGHT_") || match[1].startsWith("SHOPIFY_")) process.env[match[1]] = parseEnvValue(match[2]);
    }
  }
}
function assessField(value, product, field, minimumEvidenceMatches, { minLength = 0, maxLength = 0 } = {}) {
  const assessment = assessProductContentSpecificity(value, product, {
    field,
    minimumEvidenceMatches,
    rejectGenericPatterns: true,
  });
  const text = Array.isArray(value) ? value.join(" | ") : String(value || "");
  if (minLength && text.length < minLength) assessment.issues.push(`minimum-length:${minLength}`);
  if (maxLength && text.length > maxLength) assessment.issues.push(`maximum-length:${maxLength}`);
  assessment.specific = assessment.issues.length === 0;
  return assessment;
}
function auditProduct(product) {
  const normalized = {
    ...product,
    category: product.category || null,
    descriptionHtml: String(product.descriptionHtml || ""),
    // Shopify can return a null SEO title when the storefront uses the
    // product title as its effective SEO title. Match the guarded apply and
    // readback contract instead of treating that valid fallback as missing.
    seoTitle: String(product.seo?.title || product.title || ""),
    seoDescription: String(product.seo?.description || ""),
  };
  const fields = {
    title: assessField(normalized.title, normalized, "title", 2, { minLength: 5, maxLength: 70 }),
    seoTitle: assessField(normalized.seoTitle, normalized, "seo-title", 2, { minLength: 5, maxLength: 70 }),
    seoDescription: assessField(normalized.seoDescription, normalized, "seo-description", 3, { minLength: 120, maxLength: 170 }),
    descriptionHtml: assessField(normalized.descriptionHtml, normalized, "description", 3, { minLength: 80 }),
  };
  const issues = [];
  if (!normalized.category?.id && !normalized.category?.name && !normalized.category?.fullName) issues.push("category:missing");
  for (const [name, assessment] of Object.entries(fields)) {
    for (const issue of assessment.issues) issues.push(`${name}:${issue}`);
  }
  if (stripHtml(normalized.descriptionHtml).length < 180) issues.push("description:human-readable-body-too-short");
  return {
    id: normalized.legacyResourceId || normalized.id,
    gid: normalized.id,
    handle: normalized.handle,
    title: normalized.title,
    vendor: normalized.vendor,
    status: normalized.status,
    issues: [...new Set(issues)],
    fields,
  };
}

async function main() {
  await loadFutureEnv();
  const retryInfo = [];
  const client = createShopifyAdminGraphQLClient({ rootDir, agentName: "future-light-product-specificity-live-verify" });
  const products = [];
  let after = null;
  let page = 0;
  do {
    page += 1;
    const data = await client.run(PRODUCTS_QUERY, { first: PAGE_SIZE, after }, { operation: `read Future Light active products page ${page}`, retryInfo });
    const payload = data.products;
    for (const product of payload.nodes || []) {
      if (normalize(product.vendor) !== FUTURE_LIGHT_BRAND) continue;
      products.push(product);
    }
    after = payload.pageInfo?.hasNextPage ? payload.pageInfo.endCursor : null;
  } while (after);
  if (!products.length) throw new Error("No active Future Light products were returned by Shopify.");
  const audited = products.map(auditProduct);
  const failed = audited.filter((entry) => entry.issues.length);
  const manifest = {
    schemaVersion: "2026-09-17.future-light-product-specificity-live-verify.1",
    targetStoreDomain: FUTURE_LIGHT_SHOP_DOMAIN,
    readOnly: true,
    liveMutation: false,
    retryInfo,
    summary: { activeProducts: audited.length, passedProducts: audited.length - failed.length, failedProducts: failed.length, pages: page },
    products: audited,
    verifiedAt: new Date().toISOString(),
  };
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`Future Light live specificity: ${manifest.summary.passedProducts}/${manifest.summary.activeProducts} passed; ${manifest.summary.failedProducts} failed across ${page} page(s). Read-only; no Shopify mutation.\n`);
  if (failed.length) {
    process.stderr.write(`${failed.slice(0, 12).map((entry) => `${entry.handle}: ${entry.issues.join(", ")}`).join(" | ")}\n`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
