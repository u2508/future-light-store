#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { buildRecentlyOrderedProductsPayload } from "../src/lib/recently-ordered-products-core.js";
import { readProductCatalogPayload } from "./product-catalog-files.mjs";

const execFileAsync = promisify(execFile);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(rootDir, "public/data/recently-ordered-products.json");
const shopBase = process.env.SALT_SHOP_URL;
if (!shopBase) throw new Error("SALT_SHOP_URL is required to sync Future Light Store orders.");
const shopDomain = new URL(shopBase).hostname;
const apiVersion = process.env.SHOPIFY_ADMIN_API_VERSION || "2026-07";
const adminToken =
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ||
  process.env.SALT_SHOPIFY_ADMIN_ACCESS_TOKEN ||
  "";
const RECENTLY_ORDERED_PRODUCT_LIMIT = 1000;
const RECENTLY_ORDERED_PRODUCT_MINIMUM = 300;
// The daily price-floor stage runs after this feed is refreshed. Do not drop
// genuine recent orders before that stage can normalize their variant prices.
const RECENTLY_ORDERED_MIN_PRICE_EXCLUSIVE = 0;

export const RECENT_ORDER_PRODUCTS_QUERY = /* GraphQL */ `
  query RecentlyOrderedProducts($after: String) {
    orders(first: 100, after: $after, sortKey: CREATED_AT, reverse: true) {
      nodes {
        createdAt
        cancelledAt
        lineItems(first: 250) {
          nodes {
            title
            product {
              id
              title
              handle
              featuredMedia {
                preview {
                  image {
                    url
                    altText
                  }
                }
              }
            }
            variant {
              price
              image {
                url
                altText
              }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

async function queryWithAdminToken(after) {
  const response = await fetch(`${new URL(shopBase).origin}/admin/api/${apiVersion}/graphql.json`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": adminToken,
    },
    body: JSON.stringify({ query: RECENT_ORDER_PRODUCTS_QUERY, variables: { after } }),
  });
  const payload = await response.json();
  if (!response.ok || payload.errors) {
    const detail = formatShopifyErrors(payload.errors) || response.statusText;
    const error = new Error(`Shopify recent orders query failed: ${detail}`);
    error.status = response.status;
    throw error;
  }
  return payload.data;
}

async function queryWithShopifyCli(after) {
  const tempDir = await mkdtemp(join(tmpdir(), "salt-recent-orders-"));
  const queryFile = join(tempDir, "query.graphql");
  const outputFile = join(tempDir, "result.json");
  const variableFile = join(tempDir, "variables.json");

  try {
    await writeFile(queryFile, RECENT_ORDER_PRODUCTS_QUERY, "utf8");
    await writeFile(variableFile, JSON.stringify({ after }), "utf8");
    await execFileAsync(
      "shopify",
      [
        "store",
        "execute",
        "--store",
        shopDomain,
        "--version",
        apiVersion,
        "--query-file",
        queryFile,
        "--output-file",
        outputFile,
        "--json",
        "--variable-file",
        variableFile,
      ],
      { env: process.env, maxBuffer: 10 * 1024 * 1024 },
    );
    const payload = JSON.parse(await readFile(outputFile, "utf8"));
    if (payload.errors) {
      throw new Error(formatShopifyErrors(payload.errors));
    }
    return payload.data || payload;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function loadCommittedFallback() {
  const payload = JSON.parse(await readFile(outputPath, "utf8"));
  if (!Array.isArray(payload?.products) || payload.products.length < 4) {
    throw new Error(
      "Committed recently ordered product fallback is missing or incomplete",
    );
  }
  return payload;
}

function isMissingShopifyAuth(error) {
  const message = [error?.message, error?.stderr, error?.stdout]
    .filter(Boolean)
    .join(" ");
  return /No stored app authentication found|shopify store auth/i.test(message);
}

function formatShopifyErrors(errors) {
  if (Array.isArray(errors)) {
    return errors
      .map((error) => (typeof error === "string" ? error : error?.message || JSON.stringify(error)))
      .filter(Boolean)
      .join(" | ");
  }

  if (typeof errors === "string") {
    return errors;
  }

  if (errors && typeof errors === "object") {
    return errors.message || errors.error || JSON.stringify(errors);
  }

  return "";
}

function isAdminAuthFailure(error) {
  const message = [error?.message, error?.stderr, error?.stdout]
    .filter(Boolean)
    .join(" ");
  return error?.status === 401 || error?.status === 403 || /unauthori[sz]ed|access denied|invalid api key|invalid access token/i.test(message);
}

async function fetchRecentlyOrderedProducts(queryPage) {
  const orders = [];
  let after = null;
  let page = 0;
  let payload = null;

  while (true) {
    const data = await queryPage(after);
    const connection = data?.orders;
    if (!connection) throw new Error("Shopify recent orders query returned no orders connection");
    orders.push(...(Array.isArray(connection.nodes) ? connection.nodes : []));
    page += 1;
    payload = buildRecentlyOrderedProductsPayload({ nodes: orders }, {
      limit: RECENTLY_ORDERED_PRODUCT_LIMIT,
      minPriceExclusive: RECENTLY_ORDERED_MIN_PRICE_EXCLUSIVE,
    });
    process.stdout.write(
      `Fetched recent orders page ${page}: ${connection.nodes?.length || 0} orders, ` +
      `${payload.products.length} qualifying products\n`,
    );

    if (payload.products.length >= RECENTLY_ORDERED_PRODUCT_LIMIT || !connection.pageInfo?.hasNextPage) break;
    after = connection.pageInfo.endCursor || null;
    if (!after) throw new Error("Shopify recent orders page hasNextPage without an end cursor");
  }

  return payload;
}

async function addDeterministicCatalogFloorFill(payload) {
  if (payload.products.length >= RECENTLY_ORDERED_PRODUCT_MINIMUM) return payload;

  const catalog = await readProductCatalogPayload(resolve(rootDir, "public/data"));
  const existingHandles = new Set(payload.products.map((product) => String(product.handle || "").toLowerCase()));
  const candidates = (Array.isArray(catalog?.products) ? catalog.products : [])
    .filter((product) => String(product?.status || "ACTIVE").toUpperCase() === "ACTIVE")
    .map((product) => {
      const image = product?.image?.src || product?.images?.[0]?.src || product?.images?.[0]?.url || "";
      const firstVariant = Array.isArray(product?.variants) ? product.variants[0] : null;
      const price = Number(firstVariant?.price || product?.price);
      const numericId = String(product?.legacyResourceId || product?.id || "").match(/(\d+)$/)?.[1] || "";
      return {
        id: numericId ? `gid://shopify/Product/${numericId}` : String(product?.id || ""),
        title: String(product?.title || "").trim(),
        handle: String(product?.handle || "").trim(),
        image,
        imageAlt: String(product?.image?.alt || product?.images?.[0]?.alt || product?.title || "").trim(),
        price: Number.isFinite(price) && price > 34 ? price : null,
        updatedAt: product?.updated_at || product?.created_at || "",
      };
    })
    .filter((product) => product.id && product.title && product.handle && product.image && product.price !== null)
    .filter((product) => !existingHandles.has(product.handle.toLowerCase()))
    .sort((left, right) =>
      new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime() ||
      left.handle.localeCompare(right.handle),
    );

  const needed = RECENTLY_ORDERED_PRODUCT_MINIMUM - payload.products.length;
  const floorFill = candidates.slice(0, needed).map(({ updatedAt, ...product }) => product);
  const products = [...payload.products, ...floorFill].slice(0, RECENTLY_ORDERED_PRODUCT_LIMIT);
  return {
    ...payload,
    source: "shopify-admin-orders-with-deterministic-catalog-floor-fill",
    total: products.length,
    recentOrderProducts: payload.products.length,
    catalogFloorFillProducts: floorFill.length,
    products,
  };
}

let payload;

if (adminToken) {
  try {
    payload = await addDeterministicCatalogFloorFill(await fetchRecentlyOrderedProducts(queryWithAdminToken));
  } catch (error) {
    if (!isAdminAuthFailure(error)) throw error;
    payload = await addDeterministicCatalogFloorFill(await loadCommittedFallback());
    process.stdout.write(
      "Shopify Admin authentication is unavailable; preserving the committed recently ordered product feed.\n",
    );
  }
} else {
  try {
    payload = await addDeterministicCatalogFloorFill(await fetchRecentlyOrderedProducts(queryWithShopifyCli));
  } catch (error) {
    if (error?.code !== "ENOENT" && !isMissingShopifyAuth(error) && !isAdminAuthFailure(error)) throw error;
    payload = await addDeterministicCatalogFloorFill(await loadCommittedFallback());
    process.stdout.write(
      "Shopify CLI authentication is unavailable; preserving the committed recently ordered product feed.\n",
    );
  }
}

if (payload.products.length < RECENTLY_ORDERED_PRODUCT_MINIMUM) {
  throw new Error(
    `Shopify returned only ${payload.products.length} unique recent-order products; ` +
    `at least ${RECENTLY_ORDERED_PRODUCT_MINIMUM} are required`,
  );
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
process.stdout.write(`Saved ${payload.products.length} recently ordered Shopify products to ${outputPath}\n`);
