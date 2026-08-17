#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { fetchAllProducts } from "./shopify-seo-release.mjs";
import { convertLiveProductToCatalogProduct } from "../src/lib/shopify-seo-release.js";
import { normalizeHandleValue } from "../src/lib/shopify-seo-batch.js";

const rootDir = resolve(import.meta.dirname, "..");

function parseArgs(argv) {
  const args = {
    baseline: resolve(rootDir, "output", ".shopify-metafield-live-catalog.json"),
    expectedCount: 0,
    latestCount: 0,
    zeroSalesChannelOnly: false,
    handlesOutput: resolve(rootDir, "output", "new-product-cohort-handles.json"),
    catalogOutput: resolve(rootDir, "output", "new-product-cohort-catalog.json"),
    currentOutput: resolve(rootDir, "output", ".shopify-admin-current-catalog.json"),
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--baseline" || token === "--handles-output" || token === "--catalog-output" || token === "--current-output") {
      if (!next) {
        throw new Error(`Missing value for ${token}`);
      }
      const key = {
        "--baseline": "baseline",
        "--handles-output": "handlesOutput",
        "--catalog-output": "catalogOutput",
        "--current-output": "currentOutput",
      }[token];
      args[key] = resolve(rootDir, next);
      index += 1;
      continue;
    }
    if (token === "--expected-count") {
      if (!next || !Number.isInteger(Number(next)) || Number(next) < 1) {
        throw new Error("--expected-count must be a positive integer");
      }
      args.expectedCount = Number(next);
      index += 1;
      continue;
    }
    if (token === "--latest-count") {
      if (!next || !Number.isInteger(Number(next)) || Number(next) < 1) {
        throw new Error("--latest-count must be a positive integer");
      }
      args.latestCount = Number(next);
      index += 1;
      continue;
    }
    if (token === "--zero-sales-channel-only") {
      args.zeroSalesChannelOnly = true;
    }
  }

  return args;
}

async function readProducts(filePath) {
  const payload = JSON.parse(await readFile(filePath, "utf8"));
  const products = Array.isArray(payload) ? payload : payload?.products;
  if (!Array.isArray(products)) {
    throw new Error(`Catalog has no products array: ${filePath}`);
  }
  return products;
}

async function writeJson(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function findNewProducts(baselineProducts, currentProducts) {
  const baselineHandles = new Set(
    baselineProducts.map((product) => normalizeHandleValue(product?.handle)).filter(Boolean),
  );
  const seen = new Set();
  return currentProducts.filter((product) => {
    const handle = normalizeHandleValue(product?.handle);
    if (!handle || seen.has(handle) || baselineHandles.has(handle)) {
      return false;
    }
    seen.add(handle);
    return true;
  });
}

function hasZeroPublishedSalesChannels(product) {
  const publications = Array.isArray(product?.resourcePublications?.nodes)
    ? product.resourcePublications.nodes
    : [];
  return publications.every((publication) => publication?.isPublished !== true);
}

export async function freezeNewProductCohort(options) {
  if (options.zeroSalesChannelOnly && options.latestCount) {
    throw new Error("--latest-count cannot be combined with --zero-sales-channel-only");
  }
  const baselineProducts = options.zeroSalesChannelOnly ? [] : await readProducts(options.baseline);
  const retryInfo = [];
  const liveProducts = await fetchAllProducts(retryInfo);
  const currentProducts = liveProducts.map(convertLiveProductToCatalogProduct);
  const rawNewProducts = options.zeroSalesChannelOnly
    ? liveProducts.filter(hasZeroPublishedSalesChannels).map(convertLiveProductToCatalogProduct)
    : findNewProducts(baselineProducts, currentProducts);
  const newProducts = options.latestCount
    ? [...rawNewProducts]
        .sort((left, right) => {
          const createdDelta = new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime();
          return createdDelta || Number(right.id || 0) - Number(left.id || 0);
        })
        .slice(0, options.latestCount)
    : rawNewProducts;
  const handles = newProducts.map((product) => normalizeHandleValue(product.handle)).sort();

  const generatedAt = new Date().toISOString();
  const currentMetadata = {
    generatedAt,
    baseline: options.baseline,
    baselineCount: baselineProducts.length,
    currentCount: currentProducts.length,
    rawDeltaCount: rawNewProducts.length,
    retryInfo,
  };
  await writeJson(options.currentOutput, { ...currentMetadata, products: currentProducts });

  if (options.expectedCount && handles.length !== options.expectedCount) {
    throw new Error(
      `New-product safety check failed: expected ${options.expectedCount}, selected ${handles.length} from a raw delta of ${rawNewProducts.length}. No cohort files were written.`,
    );
  }

  const metadata = {
    ...currentMetadata,
    cohortCount: handles.length,
    selectionMethod: options.zeroSalesChannelOnly
      ? "active-products-with-zero-published-sales-channels"
      : options.latestCount
        ? "latest-created-from-baseline-delta"
        : "all-baseline-delta",
    latestCount: options.latestCount || null,
    newestCreatedAt: newProducts[0]?.created_at || null,
    oldestCreatedAt: newProducts.at(-1)?.created_at || null,
  };

  await writeJson(options.catalogOutput, { ...metadata, products: newProducts });
  await writeJson(options.handlesOutput, handles);

  process.stdout.write(
    `Frozen ${handles.length} new product(s): ${baselineProducts.length} baseline -> ${currentProducts.length} current.\n`,
  );
  return { metadata, handles, products: newProducts };
}

async function main() {
  await freezeNewProductCohort(parseArgs(process.argv));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
