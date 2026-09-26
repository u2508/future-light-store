#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { createShopifyAdminGraphQLClient } from "./shopify-admin-graphql-client.mjs";
import { loadFutureLightEnv } from "./lib/future-light-env.mjs";
import { aggregateShopifySalesOrders } from "./lib/future-light-shopify-sales-baseline.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const outputDir = join(rootDir, "output");
const expectedStore = "vs-future-store-0jl2t-jxu6tnr3.myshopify.com";
const expectedShopId = "gid://shopify/Shop/106570088529";
const lockPath = join(outputDir, "future-light-shopify-sales-baseline.lock");
let lockHandle;

const READ_ONLY_ENV_KEYS = new Set([
  "CONVERSATION_ID",
  "FUTURE_LIGHT_SHOP_DOMAIN",
  "FUTURE_LIGHT_SHOP_URL",
  "FUTURE_LIGHT_SHOPIFY_ADMIN_ACCESS_TOKEN",
  "FUTURE_LIGHT_SHOPIFY_API_VERSION",
  "FUTURE_LIGHT_SHOPIFY_CLI_AGENT_IDS",
  "FUTURE_LIGHT_SHOPIFY_CLI_AGENT_INFO",
  "FUTURE_LIGHT_SHOPIFY_MAX_REQUEST_ATTEMPTS",
  "FUTURE_LIGHT_SHOPIFY_MAX_RETRY_DELAY_MS",
  "FUTURE_LIGHT_SHOPIFY_REQUEST_CONCURRENCY",
  "FUTURE_LIGHT_SHOPIFY_REQUEST_DELAY_MS",
  "FUTURE_LIGHT_SHOPIFY_REQUEST_TIMEOUT_MS",
  "SHOPIFY_ADMIN_API_VERSION",
  "SHOPIFY_CLI_BINARY",
]);

const SHOP_IDENTITY_QUERY = /* GraphQL */ `
  query FutureLightSalesBaselineShop {
    shop {
      id
      myshopifyDomain
      currencyCode
    }
  }
`;

const ORDERS_QUERY = /* GraphQL */ `
  query FutureLightSalesBaselineOrders($after: String, $search: String!) {
    orders(first: 10, after: $after, sortKey: CREATED_AT, reverse: true, query: $search) {
      nodes {
        createdAt
        cancelledAt
        test
        displayFinancialStatus
        lineItems(first: 80) {
          nodes {
            currentQuantity
            priceAfterAllDiscountsBeforeTaxesSet {
              shopMoney { amount currencyCode }
            }
            product { id }
            variant { id }
          }
          pageInfo { hasNextPage }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

function log(message) {
  process.stdout.write(`[${new Date().toISOString()}] ${message}\n`);
}

async function acquireLock() {
  await mkdir(outputDir, { recursive: true });
  lockHandle = await open(lockPath, "wx", 0o600);
  await lockHandle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
}

async function releaseLock() {
  if (!lockHandle) return;
  await lockHandle.close();
  lockHandle = null;
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(lockPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function latestCatalogSnapshot() {
  const names = (await readdir(outputDir)).filter((name) =>
    name.startsWith("future-light-shopify-catalog-snapshot-") && name.endsWith(".json"),
  ).sort((left, right) => right.localeCompare(left));
  for (const name of names) {
    try {
      const path = join(outputDir, name);
      const raw = await readFile(path, "utf8");
      const document = JSON.parse(raw);
      if (
        document.shopDomain !== expectedStore ||
        document.schemaVersion !== 2 ||
        document.coverage?.products !== "complete" ||
        document.coverage?.productVariants !== "complete" ||
        !Array.isArray(document.products)
      ) continue;
      return {
        name,
        document,
        sha256: createHash("sha256").update(raw, "utf8").digest("hex"),
      };
    } catch {
      continue;
    }
  }
  throw new Error("A complete same-store catalog snapshot is required before order aggregation");
}

async function main() {
  await loadFutureLightEnv({ rootDir, allowedKeys: READ_ONLY_ENV_KEYS });
  await acquireLock();
  try {
    const client = createShopifyAdminGraphQLClient({ rootDir, agentName: "sales-baseline" });
    if (client.storeDomain !== expectedStore)
      throw new Error(`Refused Shopify target ${client.storeDomain}; expected ${expectedStore}`);
    const catalog = await latestCatalogSnapshot();
    const identity = (await client.run(SHOP_IDENTITY_QUERY, {}, {
      operation: "verify Future Light store and sales currency",
    })).shop;
    if (identity?.id !== expectedShopId || identity?.myshopifyDomain !== expectedStore || !identity?.currencyCode)
      throw new Error("Shop identity/currency readback did not match the verified Future Light target");

    const now = Date.now();
    const oldestWindow = 60 * 24 * 60 * 60 * 1000;
    const cutoffMs = now - oldestWindow;
    const search = `created_at:>=${new Date(cutoffMs).toISOString().slice(0, 10)}`;
    const catalogProductIds = new Set(catalog.document.products.map((product) => product.id));
    const orders = [];
    const seenCursors = new Set();
    let after = null;
    let pages = 0;
    do {
      const result = await client.run(ORDERS_QUERY, { after, search }, {
        operation: "read privacy-minimized Shopify product sales baseline",
      });
      const connection = result?.orders;
      if (!connection || !Array.isArray(connection.nodes) || !connection.pageInfo)
        throw new Error("Shopify returned incomplete order pagination");
      for (const order of connection.nodes) {
        if (order.lineItems?.pageInfo?.hasNextPage)
          throw new Error("An order has more than 80 lines; refusing an incomplete sales baseline");
        orders.push(order);
      }
      pages += 1;
      if (!connection.pageInfo.hasNextPage) break;
      after = connection.pageInfo.endCursor;
      if (!after || seenCursors.has(after)) throw new Error("Order pagination cursor missing or repeated");
      seenCursors.add(after);
      log(`Read Shopify order page ${pages}: ${orders.length} order(s)`);
    } while (true);

    const aggregate = aggregateShopifySalesOrders({
      orders,
      catalogProductIds,
      shopCurrency: identity.currencyCode,
      now,
    });
    const document = {
      schemaVersion: 1,
      readOnly: true,
      createdAt: new Date(now).toISOString(),
      shop: {
        id: identity.id,
        myshopifyDomain: identity.myshopifyDomain,
        currencyCode: String(identity.currencyCode).toUpperCase(),
      },
      windows: {
        days28: { startsAt: new Date(now - 28 * 24 * 60 * 60 * 1000).toISOString(), endsAt: new Date(now).toISOString() },
        days60: { startsAt: new Date(cutoffMs).toISOString(), endsAt: new Date(now).toISOString() },
      },
      orderAccessNote: "Uses only the latest 60-day window requested from Shopify; older-order access is not assumed.",
      sourceCatalogSnapshot: {
        filename: catalog.name,
        sha256: catalog.sha256,
        createdAt: catalog.document.createdAt,
        productCount: catalog.document.products.length,
      },
      pagination: { ordersComplete: true, pages, ordersScanned: orders.length },
      summary: {
        eligiblePaidOrders: aggregate.includedOrderCount,
        excludedOrderCounts: aggregate.excludedOrderCounts,
        unlinkedLineItems: aggregate.unlinkedLineItems,
        productsWithOrders: aggregate.products.length,
        variantsWithOrders: aggregate.variants.length,
        productsNotInCurrentCatalog: aggregate.products.filter((row) => !row.inCurrentCatalog).length,
      },
      products: aggregate.products,
      variants: aggregate.variants,
    };
    const filename = `future-light-shopify-sales-baseline-${new Date(now).toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.json`;
    const path = join(outputDir, filename);
    const temporaryPath = `${path}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, path);
    const digest = createHash("sha256").update(await readFile(path)).digest("hex");
    log(`Saved privacy-minimized Shopify sales baseline: ${basename(path)}; ${orders.length} orders scanned, ${aggregate.products.length} products with paid orders; sha256 ${digest}`);
  } finally {
    await releaseLock();
  }
}

main().catch((error) => {
  log(`Sales baseline stopped safely: ${error?.message || error}`);
  process.exitCode = 1;
});
