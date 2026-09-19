import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { readProductCatalogPayload } from "../product-catalog-files.mjs";

const DEFAULT_MAX_AGE_MS = 30 * 60 * 1000;

function expectedHostFrom(shopUrl) {
  const value = String(shopUrl || "").trim();
  if (!value) return "";

  try {
    return new URL(value).hostname;
  } catch {
    throw new Error(`Configured Shopify URL is invalid: ${value}`);
  }
}

function inspectSnapshotRecord(name, payload, { expectedHost, maxAgeMs }) {
  const generatedAt = String(payload?.generatedAt || "").trim();
  const source = String(payload?.source || "").trim();
  const parsedGeneratedAt = Date.parse(generatedAt);
  if (!source || !Number.isFinite(parsedGeneratedAt)) {
    throw new Error(
      `${name} is missing a live Shopify source or generatedAt; run sync:data before using catalog artifacts.`,
    );
  }

  let sourceHost;
  try {
    sourceHost = new URL(source).hostname;
  } catch {
    throw new Error(`${name} has an invalid Shopify source URL: ${source}`);
  }
  if (expectedHost && sourceHost !== expectedHost) {
    throw new Error(`${name} source ${sourceHost} does not match configured Shopify store ${expectedHost}.`);
  }

  const ageMs = Date.now() - parsedGeneratedAt;
  if (ageMs > maxAgeMs) {
    throw new Error(
      `${name} is ${Math.round(ageMs / 60_000)} minutes old; refresh Shopify data before using local build input.`,
    );
  }

  return { generatedAt, source, sourceHost, ageMs };
}

export function assertFreshLiveCatalogSnapshot(
  { products, collections, collectionProducts } = {},
  { shopUrl = process.env.SALT_SHOP_URL, maxAgeMs = undefined, context = "catalog artifact" } = {},
) {
  const resolvedMaxAgeMs = Math.max(
    60_000,
    Number(maxAgeMs ?? process.env.SALT_WEB_BUILD_MAX_CATALOG_AGE_MS ?? DEFAULT_MAX_AGE_MS),
  );
  const expectedHost = expectedHostFrom(shopUrl);
  const productRecord = inspectSnapshotRecord("Live products snapshot", products, {
    expectedHost,
    maxAgeMs: resolvedMaxAgeMs,
  });
  const collectionRecord = inspectSnapshotRecord("Live collections snapshot", collections, {
    expectedHost,
    maxAgeMs: resolvedMaxAgeMs,
  });
  const mappingRecord = collectionProducts
    ? inspectSnapshotRecord("Live collection membership snapshot", collectionProducts, {
        expectedHost,
        maxAgeMs: resolvedMaxAgeMs,
      })
    : null;

  if (!Number(products?.total) || !Number(collections?.total)) {
    throw new Error(`${context} is incomplete; refusing to use a local fallback catalog.`);
  }
  if (collectionProducts && !Number(collectionProducts?.totalCollections)) {
    throw new Error(`${context} has no live collection membership; refusing to use a local fallback catalog.`);
  }

  return {
    generatedAt: productRecord.generatedAt,
    source: productRecord.source,
    sourceHost: productRecord.sourceHost,
    maxAgeMs: resolvedMaxAgeMs,
    ageMs: Math.max(productRecord.ageMs, collectionRecord.ageMs, mappingRecord?.ageMs || 0),
  };
}

export async function readFreshLiveCatalogSnapshot(
  dataDir,
  { shopUrl = process.env.SALT_SHOP_URL, context = "catalog artifact" } = {},
) {
  const resolvedDataDir = resolve(dataDir);
  const collectionsPath = resolve(resolvedDataDir, "collections.json");
  const collectionProductsPath = resolve(resolvedDataDir, "collection-products.json");
  const [products, collections, collectionProducts] = await Promise.all([
    readProductCatalogPayload(resolvedDataDir),
    readFile(collectionsPath, "utf8").then(JSON.parse),
    readFile(collectionProductsPath, "utf8").then(JSON.parse),
  ]);

  assertFreshLiveCatalogSnapshot(
    { products, collections, collectionProducts },
    { shopUrl, context },
  );
  return { products, collections, collectionProducts };
}
