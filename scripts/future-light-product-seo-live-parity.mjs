#!/usr/bin/env node

/*
 * Read-only parity audit for the final Future Light SEO artifact.
 * It never writes Shopify and never reads or exports SALT configuration.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createShopifyAdminGraphQLClient } from "./shopify-admin-graphql-client.mjs";
import { FUTURE_LIGHT_BRAND, FUTURE_LIGHT_SHOP_DOMAIN } from "./lib/product-image-health.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const artifactPath = resolve(rootDir, "public/data/product-seo.json");
const outputPath = resolve(rootDir, "output/future-light-product-seo-live-parity.json");
const envFiles = [resolve(rootDir, ".env.local"), resolve(rootDir, ".env.release.local")];
const PAGE_SIZE = 250;

const PRODUCTS_QUERY = /* GraphQL */ `
  query FutureLightProductSeoParity($first: Int!, $after: String) {
    products(first: $first, after: $after, query: "status:active") {
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

function normalize(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeMarkup(value) {
  return String(value ?? "")
    .replace(/&mdash;|&#8212;|&#x2014;/gi, "—")
    .replace(/&amp;|&#38;|&#x26;/gi, "&")
    .replace(/&apos;|&#39;|&#x27;/gi, "'")
    .replace(/&quot;|&#34;|&#x22;/gi, '"')
    .replace(/&nbsp;|&#160;|&#xA0;/gi, " ")
    .replace(/>\s+</g, "><")
    .replace(/\s+/g, " ")
    .trim();
}

function parseEnvValue(value) {
  const trimmed = String(value || "").trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
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

function expectedSeoTitle(row) {
  return normalize(row.seoTitle || row.title);
}

function isOnlineStorePublished(product) {
  return (product?.resourcePublications?.nodes || []).some((publication) => (
    publication?.isPublished === true &&
    String(publication?.channel?.name || "").trim().toLowerCase() === "online store"
  ));
}

function compareProduct(live, expected) {
  const fields = [
    ["title", live.title, expected.title],
    ["seoTitle", live.seo?.title || live.title, expectedSeoTitle(expected)],
    ["seoDescription", live.seo?.description, expected.seoDescription],
    ["descriptionHtml", live.descriptionHtml, expected.descriptionHtml],
  ];
  const mismatches = fields
    .filter(([field, actual, desired]) => (field === "descriptionHtml" ? normalizeMarkup(actual) !== normalizeMarkup(desired) : normalize(actual) !== normalize(desired)))
    .map(([field, actual, desired]) => ({ field, actual: field === "descriptionHtml" ? normalizeMarkup(actual) : normalize(actual), expected: field === "descriptionHtml" ? normalizeMarkup(desired) : normalize(desired) }));
  return { handle: live.handle, id: live.legacyResourceId || live.id, mismatches };
}

async function main() {
  await loadFutureEnv();
  const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
  const expectedByHandle = new Map((artifact.products || []).map((product) => [product.handle, product]));
  if (expectedByHandle.size !== Number(artifact.total || artifact.products?.length || 0)) {
    throw new Error("SEO artifact contains duplicate or missing handles.");
  }

  const retryInfo = [];
  const client = createShopifyAdminGraphQLClient({ rootDir, agentName: "future-light-product-seo-live-parity" });
  const liveProducts = [];
  let after = null;
  let pages = 0;
  do {
    pages += 1;
    const data = await client.run(PRODUCTS_QUERY, { first: PAGE_SIZE, after }, { operation: `read Future Light SEO parity page ${pages}`, retryInfo });
    const payload = data.products;
    for (const product of payload.nodes || []) {
      if (normalize(product.vendor) === FUTURE_LIGHT_BRAND && isOnlineStorePublished(product)) liveProducts.push(product);
    }
    after = payload.pageInfo?.hasNextPage ? payload.pageInfo.endCursor : null;
  } while (after);

  const missingFromArtifact = liveProducts.filter((product) => !expectedByHandle.has(product.handle)).map((product) => product.handle);
  const extraInArtifact = [...expectedByHandle.keys()].filter((handle) => !liveProducts.some((product) => product.handle === handle));
  const compared = liveProducts
    .filter((product) => expectedByHandle.has(product.handle))
    .map((product) => compareProduct(product, expectedByHandle.get(product.handle)));
  const drifted = compared.filter((product) => product.mismatches.length);
  const manifest = {
    schemaVersion: "2026-09-20.future-light-online-store-product-seo-live-parity.2",
    targetStoreDomain: FUTURE_LIGHT_SHOP_DOMAIN,
    readOnly: true,
    liveMutation: false,
    artifactPath: "public/data/product-seo.json",
    scope: "active products published to the Shopify Online Store channel",
    retryInfo,
    summary: {
      artifactProducts: expectedByHandle.size,
      liveProducts: liveProducts.length,
      comparedProducts: compared.length,
      exactMatches: compared.length - drifted.length,
      driftedProducts: drifted.length,
      missingFromArtifact: missingFromArtifact.length,
      extraInArtifact: extraInArtifact.length,
      pages,
    },
    drifted: drifted.slice(0, 100),
    missingFromArtifact,
    extraInArtifact,
    verifiedAt: new Date().toISOString(),
  };
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`Future Light SEO live parity: ${manifest.summary.exactMatches}/${manifest.summary.comparedProducts} exact, ${manifest.summary.driftedProducts} drifted; ${manifest.summary.missingFromArtifact} missing artifact, ${manifest.summary.extraInArtifact} extra artifact. Read-only.\n`);
  if (drifted.length || missingFromArtifact.length || extraInArtifact.length) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
