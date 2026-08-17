#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import { normalizePlainText } from "../src/lib/shopify-seo-batch.js";
import { normalizeProductCustomData, normalizeCollectionCustomData, normalizeShopCustomData } from "../src/lib/product-custom-data.js";
import { readProductCatalogPayload } from "./product-catalog-files.mjs";

const execFileAsync = promisify(execFile);
const DEFAULT_SHOP_BASE = "";
const DEFAULT_INPUT_DIR = resolve(process.cwd(), "public", "data");
const SHOP_BASE = process.env.SALT_SHOP_URL || DEFAULT_SHOP_BASE;
const SHOP_DOMAIN = new URL(SHOP_BASE).hostname;
const SHOPIFY_ADMIN_API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || "2026-07";
const SHOPIFY_CLI_AGENT_INFO = process.env.SHOPIFY_CLI_AGENT_INFO || "n:future-light-store|v:1|p:openai";
const SHOPIFY_CLI_AGENT_IDS =
  process.env.SHOPIFY_CLI_AGENT_IDS || `s:future-light-store|r:${process.pid}|i:future-light-store`;
const PRODUCT_FIELDS = [
  ["subtitle", "descriptors", "subtitle"],
  ["badgeText", "salt-marketing", "badge_text"],
  ["highlights", "salt-marketing", "highlights"],
  ["collectionSignal", "salt-marketing", "collection_signal"],
  ["rating", "reviews", "rating"],
  ["ratingCount", "reviews", "rating_count"],
  ["relatedProductsDisplay", "shopify--discovery--product_recommendation", "related_products_display"],
  ["relatedProducts", "shopify--discovery--product_recommendation", "related_products"],
  ["complementaryProducts", "shopify--discovery--product_recommendation", "complementary_products"],
  ["complementaryProductsFallback", "salt-recommendations", "complementary_products"],
  ["searchProductBoosts", "shopify--discovery--product_search_boost", "queries"],
  ["searchProductBoostFallback", "salt-search", "query_terms"],
  ["googleCustomProduct", "mm-google-shopping", "custom_product"],
  ["shopChannelMinimumQuantity", "salt-marketing", "shop_channel_minimum_quantity"],
];

function normalizeDomain(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  try {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return new URL(withProtocol).hostname.toLowerCase();
  } catch {
    return raw.replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
  }
}

function getShopifyCliEnv() {
  return {
    ...process.env,
    SHOPIFY_CLI_AGENT_INFO,
    SHOPIFY_CLI_AGENT_IDS,
  };
}

async function runShopifyStoreGraphQL(query, variables = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), "salt-shopify-verify-"));
  const queryFile = join(tempDir, "operation.graphql");
  const outputFile = join(tempDir, "result.json");
  const variableFile = join(tempDir, "variables.json");

  try {
    await writeFile(queryFile, query, "utf8");
    if (variables && Object.keys(variables).length) {
      await writeFile(variableFile, JSON.stringify(variables, null, 2), "utf8");
    }

    const args = [
      "store",
      "execute",
      "--store",
      SHOP_DOMAIN,
      "--version",
      SHOPIFY_ADMIN_API_VERSION,
      "--query-file",
      queryFile,
      "--output-file",
      outputFile,
      "--json",
    ];

    if (variables && Object.keys(variables).length) {
      args.push("--variable-file", variableFile);
    }

    await execFileAsync("shopify", args, {
      env: getShopifyCliEnv(),
      maxBuffer: 10 * 1024 * 1024,
    });

    const parsedOutput = JSON.parse(await readFile(outputFile, "utf8"));
    if (Array.isArray(parsedOutput.errors) && parsedOutput.errors.length) {
      const message = parsedOutput.errors.map((entry) => entry.message || "Unknown GraphQL error").join(" | ");
      throw new Error(message);
    }

    return parsedOutput.data || parsedOutput || {};
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function loadJson(relativePath) {
  return readFile(resolve(DEFAULT_INPUT_DIR, relativePath), "utf8").then((value) => JSON.parse(value));
}

function normalizeGraphQLEntityProduct(node) {
  return normalizeProductCustomData({
    subtitle: node?.subtitle?.jsonValue ?? node?.subtitle?.value ?? null,
    badgeText: node?.badgeText?.jsonValue ?? node?.badgeText?.value ?? null,
    highlights: node?.highlights?.jsonValue ?? node?.highlights?.value ?? null,
    rating: node?.rating?.jsonValue ?? node?.rating?.value ?? null,
    ratingCount: node?.ratingCount?.jsonValue ?? node?.ratingCount?.value ?? null,
    relatedProductsDisplay: node?.relatedProductsDisplay?.jsonValue ?? node?.relatedProductsDisplay?.value ?? null,
    relatedProducts: node?.relatedProducts?.references?.nodes || [],
    complementaryProducts: node?.complementaryProducts?.references?.nodes || [],
    complementaryProductsFallback: node?.complementaryProductsFallback?.references?.nodes || [],
    searchProductBoosts: node?.searchProductBoosts?.jsonValue ?? node?.searchProductBoosts?.value ?? null,
    searchProductBoostFallback:
      node?.searchProductBoostFallback?.jsonValue ?? node?.searchProductBoostFallback?.value ?? null,
    googleCustomProduct: node?.googleCustomProduct?.jsonValue ?? node?.googleCustomProduct?.value ?? null,
    shopChannelMinimumQuantity:
      node?.shopChannelMinimumQuantity?.jsonValue ?? node?.shopChannelMinimumQuantity?.value ?? null,
    collectionSignal: node?.collectionSignal?.jsonValue ?? node?.collectionSignal?.value ?? null,
    diaperType: node?.diaperType?.references?.nodes || null,
    metafields: {},
  });
}

function normalizeGraphQLEntityCollection(node) {
  return normalizeCollectionCustomData({
    heroKicker: node?.heroKicker?.jsonValue ?? node?.heroKicker?.value ?? null,
    heroSummary: node?.heroSummary?.jsonValue ?? node?.heroSummary?.value ?? null,
    featuredProducts: node?.featuredProducts?.references?.nodes || [],
    trustStrip: node?.trustStrip?.jsonValue ?? node?.trustStrip?.value ?? null,
    metafields: {},
  });
}

function normalizeGraphQLEntityShop(node) {
  return normalizeShopCustomData({
    bannerText: node?.bannerText?.jsonValue ?? node?.bannerText?.value ?? null,
    trustStrip: node?.trustStrip?.jsonValue ?? node?.trustStrip?.value ?? null,
    metafields: {},
  });
}

function assertSame(label, expected, actual) {
  const left = JSON.stringify(expected);
  const right = JSON.stringify(actual);

  if (left !== right) {
    throw new Error(`${label} mismatch.\nExpected: ${left}\nActual:   ${right}`);
  }
}

function pickProductSample(products) {
  return (
    products.find((product) => {
      const data = product?.customData || {};
      return (
        data.subtitle ||
        data.badgeText ||
        (Array.isArray(data.highlights) && data.highlights.length > 0) ||
        data.relatedProductsDisplay ||
        (Array.isArray(data.relatedProducts) && data.relatedProducts.length > 0) ||
        (Array.isArray(data.complementaryProducts) && data.complementaryProducts.length > 0) ||
        (Array.isArray(data.searchProductBoosts) && data.searchProductBoosts.length > 0) ||
        data.googleCustomProduct === true ||
        data.shopChannelMinimumQuantity != null ||
        data.rating ||
        data.ratingCount
      );
    }) || products[0]
  );
}

function pickCollectionSample(collections) {
  return (
    collections.find((collection) => {
      const data = collection?.customData || {};
      return (
        data.heroKicker ||
        data.heroSummary ||
        (Array.isArray(data.featuredProducts) && data.featuredProducts.length > 0) ||
        (Array.isArray(data.trustStrip) && data.trustStrip.length > 0)
      );
    }) || collections[0]
  );
}

async function verifyProduct(product) {
  const query = /* GraphQL */ `
    query ProductMerchandisingVerification($id: ID!) {
      node(id: $id) {
        ... on Product {
          subtitle: metafield(namespace: "descriptors", key: "subtitle") {
            jsonValue
            value
          }
          badgeText: metafield(namespace: "salt-marketing", key: "badge_text") {
            jsonValue
            value
          }
          highlights: metafield(namespace: "salt-marketing", key: "highlights") {
            jsonValue
            value
          }
          collectionSignal: metafield(namespace: "salt-marketing", key: "collection_signal") {
            jsonValue
            value
          }
          rating: metafield(namespace: "reviews", key: "rating") {
            jsonValue
            value
          }
          ratingCount: metafield(namespace: "reviews", key: "rating_count") {
            jsonValue
            value
          }
          relatedProductsDisplay: metafield(
            namespace: "shopify--discovery--product_recommendation"
            key: "related_products_display"
          ) {
            jsonValue
            value
          }
          relatedProducts: metafield(
            namespace: "shopify--discovery--product_recommendation"
            key: "related_products"
          ) {
            references(first: 50) {
              nodes {
                ... on Product {
                  id
                  legacyResourceId
                  handle
                  title
                  productType
                  vendor
                }
              }
            }
          }
          complementaryProducts: metafield(
            namespace: "shopify--discovery--product_recommendation"
            key: "complementary_products"
          ) {
            references(first: 50) {
              nodes {
                ... on Product {
                  id
                  legacyResourceId
                  handle
                  title
                  productType
                  vendor
                }
              }
            }
          }
          complementaryProductsFallback: metafield(
            namespace: "salt-recommendations"
            key: "complementary_products"
          ) {
            references(first: 50) {
              nodes {
                ... on Product {
                  id
                  legacyResourceId
                  handle
                  title
                  productType
                  vendor
                }
              }
            }
          }
          searchProductBoosts: metafield(
            namespace: "shopify--discovery--product_search_boost"
            key: "queries"
          ) {
            jsonValue
            value
          }
          searchProductBoostFallback: metafield(
            namespace: "salt-search"
            key: "query_terms"
          ) {
            jsonValue
            value
          }
          googleCustomProduct: metafield(namespace: "mm-google-shopping", key: "custom_product") {
            jsonValue
            value
          }
          shopChannelMinimumQuantity: metafield(
            namespace: "salt-marketing"
            key: "shop_channel_minimum_quantity"
          ) {
            jsonValue
            value
          }
          diaperType: metafield(namespace: "shopify", key: "diaper-type") {
            references(first: 50) {
              nodes {
                ... on Metaobject {
                  id
                  handle
                  displayName
                  type
                }
              }
            }
          }
        }
      }
    }
  `;

  const response = await runShopifyStoreGraphQL(query, {
    id: `gid://shopify/Product/${product.id}`,
  });
  const liveProduct = normalizeGraphQLEntityProduct(response.node);
  const expectedProduct = normalizeProductCustomData(product.customData || {});

  assertSame(`Product ${product.handle}`, expectedProduct, liveProduct);
}

async function verifyCollection(collection) {
  const query = /* GraphQL */ `
    query CollectionMerchandisingVerification($id: ID!) {
      node(id: $id) {
        ... on Collection {
          heroKicker: metafield(namespace: "salt-marketing", key: "hero_kicker") {
            jsonValue
            value
          }
          heroSummary: metafield(namespace: "salt-marketing", key: "hero_summary") {
            jsonValue
            value
          }
          featuredProducts: metafield(namespace: "salt-marketing", key: "featured_products") {
            references(first: 50) {
              nodes {
                ... on Product {
                  id
                  legacyResourceId
                  handle
                  title
                  productType
                  vendor
                }
              }
            }
          }
          trustStrip: metafield(namespace: "salt-marketing", key: "trust_strip") {
            jsonValue
            value
          }
        }
      }
    }
  `;

  const response = await runShopifyStoreGraphQL(query, {
    id: `gid://shopify/Collection/${collection.id}`,
  });
  const liveCollection = normalizeGraphQLEntityCollection(response.node);
  const expectedCollection = normalizeCollectionCustomData(collection.customData || {});

  assertSame(`Collection ${collection.handle}`, expectedCollection, liveCollection);
}

async function verifyShop(shop) {
  const query = /* GraphQL */ `
    query ShopMerchandisingVerification {
      shop {
        bannerText: metafield(namespace: "salt-marketing", key: "banner_text") {
          jsonValue
          value
        }
        trustStrip: metafield(namespace: "salt-marketing", key: "trust_strip") {
          jsonValue
          value
        }
      }
    }
  `;

  const response = await runShopifyStoreGraphQL(query);
  const liveShop = normalizeGraphQLEntityShop(response.shop);
  const expectedShop = normalizeShopCustomData(shop.customData || {});

  assertSame("Shop merchandising", expectedShop, liveShop);
}

async function main() {
  const [productsPayload, collectionsPayload, shopPayload] = await Promise.all([
    readProductCatalogPayload(DEFAULT_INPUT_DIR),
    loadJson("collections.json"),
    loadJson("shop.json"),
  ]);

  const productSample = pickProductSample(productsPayload.products || []);
  const collectionSample = pickCollectionSample(collectionsPayload.collections || []);

  if (!productSample) {
    throw new Error("No product sample available for verification");
  }

  if (!collectionSample) {
    throw new Error("No collection sample available for verification");
  }

  if (!shopPayload?.shop) {
    throw new Error("Shop payload is unavailable");
  }

  process.stdout.write(
    `Verifying merchandising state for product ${productSample.handle}, collection ${collectionSample.handle}, and shop ${normalizePlainText(shopPayload.shop.name || "SALT")}.\n`,
  );

  await verifyProduct(productSample);
  await verifyCollection(collectionSample);
  await verifyShop(shopPayload.shop);

  process.stdout.write("Shopify merchandising verification passed.\n");
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
