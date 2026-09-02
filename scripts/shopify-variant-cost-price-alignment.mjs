#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { buildVariantCostPriceAlignmentPlan } from "../src/lib/shopify-variant-cost-pricing.js";
import { PRICE_REWORK_RULES } from "../src/lib/shopify-price-rework-policy.js";
import { normalizePlainText } from "../src/lib/shopify-seo-batch.js";
import { createShopifyAdminGraphQLClient } from "./shopify-admin-graphql-client.mjs";
import { envInteger, recommendedConcurrency } from "./lib/performance-runtime.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const defaultOutputPath = resolve(rootDir, "output", "shopify-variant-cost-price-alignment-manifest.json");
const client = createShopifyAdminGraphQLClient({ rootDir, agentName: "variant-cost-price-alignment" });
const tolerance = Math.max(0, Number(process.env.SALT_VARIANT_COST_TOLERANCE || 2));
const priceFloor = Math.max(0, Number(process.env.SALT_CATALOG_PRICE_FLOOR || PRICE_REWORK_RULES.minimumSellPrice));
const pageSize = Math.max(1, Math.min(250, Number(process.env.SALT_VARIANT_COST_PAGE_SIZE || 100)));
const readbackAttempts = Math.max(1, Number(process.env.SALT_VARIANT_COST_READBACK_ATTEMPTS || 5));
const applyConcurrency = envInteger(
  "SALT_VARIANT_COST_APPLY_CONCURRENCY",
  recommendedConcurrency({ kind: "io", reserve: 2, max: 4 }),
  { min: 1, max: 4 },
);

const PRODUCTS_QUERY = /* GraphQL */ `
  query VariantCostPriceProducts($first: Int!, $after: String) {
    products(first: $first, after: $after, query: "status:active") {
      nodes {
        id
        handle
        title
        variants(first: 250) {
          nodes {
            id
            title
            sku
            price
            compareAtPrice
            inventoryItem { unitCost { amount currencyCode } }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const VARIANT_CONTINUATION_QUERY = /* GraphQL */ `
  query VariantCostPriceVariantContinuation($id: ID!, $first: Int!, $after: String) {
    product(id: $id) {
      variants(first: $first, after: $after) {
        nodes {
          id
          title
          sku
          price
          compareAtPrice
          inventoryItem { unitCost { amount currencyCode } }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

const PRODUCT_QUERY = /* GraphQL */ `
  query VariantCostPriceProduct($id: ID!) {
    product(id: $id) {
      id
      handle
      title
      variants(first: 250) {
        nodes {
          id
          title
          sku
          price
          compareAtPrice
          inventoryItem { unitCost { amount currencyCode } }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

const UPDATE_MUTATION = /* GraphQL */ `
  mutation VariantCostPriceUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      product { id }
      userErrors { field message code }
    }
  }
`;

function parseArgs(argv) {
  const args = { mode: "dry-run", output: defaultOutputPath };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--apply") args.mode = "apply";
    else if (token === "--verify") args.mode = "verify";
    else if (token === "--dry-run") args.mode = "dry-run";
    else if (token === "--output" && argv[index + 1]) args.output = resolve(rootDir, argv[++index]);
  }
  return args;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function variantArray(product) {
  if (Array.isArray(product?.variants)) return product.variants;
  return asArray(product?.variants?.nodes);
}

function normalizeMoney(value) {
  if (value === null || value === undefined || value === "") return "";
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toFixed(2) : "";
}

function normalizeProduct(product) {
  return {
    ...product,
    variants: asArray(product?.variants?.nodes).map((variant) => ({
      ...variant,
      cost_per_item: variant?.inventoryItem?.unitCost?.amount || "",
    })),
    variantPageInfo: product?.variants?.pageInfo || product?.variantPageInfo || { hasNextPage: false, endCursor: null },
  };
}

async function completeProductVariants(product) {
  const variants = [...asArray(product?.variants)];
  let after = product?.variantPageInfo?.endCursor || null;
  let hasNextPage = Boolean(product?.variantPageInfo?.hasNextPage);
  while (hasNextPage) {
    const payload = await client.run(
      VARIANT_CONTINUATION_QUERY,
      { id: product.id, first: 250, after },
      { operation: `read variant cost continuation for ${product.handle}` },
    );
    const connection = payload?.product?.variants;
    if (!connection) throw new Error(`Shopify returned no variant continuation for ${product.handle}`);
    variants.push(...asArray(connection.nodes));
    hasNextPage = Boolean(connection.pageInfo?.hasNextPage);
    after = connection.pageInfo?.endCursor || null;
    if (hasNextPage && !after) throw new Error(`Variant continuation for ${product.handle} has no cursor`);
  }
  return normalizeProduct({ ...product, variants: { nodes: variants, pageInfo: { hasNextPage: false, endCursor: after } } });
}

async function fetchActiveProducts() {
  const products = [];
  let after = null;
  while (true) {
    const payload = await client.run(PRODUCTS_QUERY, { first: pageSize, after }, { operation: "read active variant costs and prices" });
    const connection = payload?.products;
    for (const product of asArray(connection?.nodes)) {
      products.push(await completeProductVariants(normalizeProduct(product)));
    }
    if (!connection?.pageInfo?.hasNextPage) break;
    after = connection.pageInfo.endCursor || null;
    if (!after) throw new Error("Shopify returned a next page without a cursor while reading variant costs");
  }
  return products;
}

function manifestForPlan(plan, mode) {
  const products = [...plan.byHandle.entries()].map(([handle, updates]) => ({ handle, updates }));
  return {
    generatedAt: new Date().toISOString(),
    mode,
    policy: {
      tolerance,
      priceFloor,
      readbackAttempts,
      applyConcurrency,
      targetPrice: "cost-based retail target calculated independently from each variant cost; same-product cost grouping is only a bounded safety scope",
      quantityTiers: "held outside automatic alignment",
      compareAt: "preserve absence; when present normalize to the cost-based target with psychological rounding",
      sourceOfTruth: "live Shopify variant inventoryItem.unitCost and the approved cost-based retail strategy",
    },
    summary: plan.summary,
    products,
    held: plan.held,
    blockingHeld: plan.blockingHeld || [],
    failures: [],
  };
}

async function writeManifest(path, payload) {
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function assertNoHeld(plan) {
  if ((plan.blockingHeld || []).length) {
    throw new Error(`Variant cost-price alignment held ${plan.blockingHeld.length} unsafe group(s); no price writes were started.`);
  }
}

function productIdForGraphql(product) {
  const raw = String(product?.id || "");
  return raw.startsWith("gid://") ? raw : `gid://shopify/Product/${raw}`;
}

function buildMutationInputs(updates) {
  return updates.map((update) => ({
    id: update.variantId.startsWith("gid://") ? update.variantId : `gid://shopify/ProductVariant/${update.variantId}`,
    price: update.price,
    ...(Object.prototype.hasOwnProperty.call(update, "compareAtPrice") ? { compareAtPrice: update.compareAtPrice } : {}),
  }));
}

function readbackFailures(product, updates) {
  const liveById = new Map(variantArray(product).map((variant) => [String(variant?.id), variant]));
  return updates.flatMap((update) => {
    const id = update.variantId.startsWith("gid://") ? update.variantId : `gid://shopify/ProductVariant/${update.variantId}`;
    const live = liveById.get(id);
    if (!live) return [{ variantId: id, reason: "variant-not-found" }];
    const failures = [];
    if (normalizeMoney(live.price) !== normalizeMoney(update.price)) {
      failures.push({ variantId: id, reason: "price-readback-mismatch", expected: update.price, actual: live.price });
    }
    if (Object.prototype.hasOwnProperty.call(update, "compareAtPrice") && normalizeMoney(live.compareAtPrice) !== normalizeMoney(update.compareAtPrice)) {
      failures.push({ variantId: id, reason: "compare-at-readback-mismatch", expected: update.compareAtPrice, actual: live.compareAtPrice });
    }
    return failures;
  });
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function readBackAlignedProduct(product, updates) {
  let lastProduct = null;
  let failures = [];
  for (let attempt = 0; attempt < readbackAttempts; attempt += 1) {
    const readback = await client.run(PRODUCT_QUERY, { id: productIdForGraphql(product) }, { operation: `read back aligned variant prices for ${product.handle}` });
    lastProduct = await completeProductVariants(normalizeProduct(readback?.product));
    failures = readbackFailures(lastProduct, updates);
    if (!failures.length) return { product: lastProduct, failures: [] };
    if (attempt < readbackAttempts - 1) await sleep(Math.min(8_000, 1_000 * 2 ** attempt));
  }
  return { product: lastProduct, failures };
}

async function applyPlan(plan, manifest, outputPath) {
  assertNoHeld(plan);
  const productsByHandle = new Map(plan.products.map((product) => [normalizePlainText(product.handle), product]));
  const completed = new Set(asArray(manifest.appliedProducts));
  const entries = [...plan.byHandle.entries()].filter(([handle]) => !completed.has(handle));
  let cursor = 0;
  let stopped = false;
  let writeQueue = Promise.resolve();
  const persistManifest = () => {
    writeQueue = writeQueue.then(() => writeManifest(outputPath, manifest));
    return writeQueue;
  };

  process.stdout.write(`Applying ${entries.length} product(s) with concurrency ${applyConcurrency}; resuming past ${completed.size} verified product(s).\n`);

  const applyOne = async ([handle, updates]) => {
    const product = productsByHandle.get(handle);
    if (!product) throw new Error(`Missing live product for cost-price plan handle ${handle}`);
    const payload = await client.run(
      UPDATE_MUTATION,
      { productId: productIdForGraphql(product), variants: buildMutationInputs(updates) },
      { allowMutations: true, operation: `align variant prices for ${handle}` },
    );
    const errors = asArray(payload?.productVariantsBulkUpdate?.userErrors);
    if (errors.length) throw new Error(`${handle}: ${JSON.stringify(errors)}`);
    const { failures } = await readBackAlignedProduct(product, updates);
    if (failures.length) {
      manifest.failures.push({ handle, failures });
      await persistManifest();
      throw new Error(`${handle}: ${failures.length} variant price readback failure(s)`);
    }
    manifest.appliedProducts = [...new Set([...(manifest.appliedProducts || []), handle])];
    await persistManifest();
  };

  const worker = async () => {
    while (!stopped) {
      const entry = entries[cursor++];
      if (!entry) return;
      try {
        await applyOne(entry);
      } catch (error) {
        stopped = true;
        throw error;
      }
    }
  };

  const workerCount = Math.min(applyConcurrency, Math.max(1, entries.length));
  const results = await Promise.allSettled(Array.from({ length: workerCount }, () => worker()));
  await writeQueue;
  const rejected = results.find((result) => result.status === "rejected");
  if (rejected) throw rejected.reason;
  if (manifest.failures?.length) throw new Error(`Variant cost-price alignment failed for ${manifest.failures.length} product(s)`);
}

async function readPriorApplyManifest(path) {
  try {
    const prior = JSON.parse(await readFile(path, "utf8"));
    if (prior?.mode === "apply" && Array.isArray(prior.appliedProducts)) return prior;
  } catch {
    // No prior apply checkpoint is expected on the first run.
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv);
  const products = await fetchActiveProducts();
  const plan = buildVariantCostPriceAlignmentPlan(products, { tolerance, priceFloor });
  plan.products = products;
  const manifest = manifestForPlan(plan, args.mode);
  if (args.mode === "apply") {
    const prior = await readPriorApplyManifest(args.output);
    const plannedHandles = new Set(plan.byHandle.keys());
    manifest.appliedProducts = asArray(prior?.appliedProducts).filter((handle) => plannedHandles.has(handle));
  }

  if (args.mode === "verify") {
    const prior = JSON.parse(await readFile(args.output, "utf8"));
    const liveByHandle = new Map(products.map((product) => [normalizePlainText(product.handle), product]));
    const failures = [];
    const priorProducts = asArray(prior.products);
    if (priorProducts.length) {
      for (const entry of priorProducts) {
        const product = liveByHandle.get(normalizePlainText(entry.handle));
        if (!product) failures.push({ handle: entry.handle, reason: "product-not-found" });
        else failures.push(...readbackFailures(product, entry.updates).map((failure) => ({ handle: entry.handle, ...failure })));
      }
    } else {
      for (const [handle, updates] of plan.byHandle.entries()) {
        const product = liveByHandle.get(normalizePlainText(handle));
        if (!product) failures.push({ handle, reason: "product-not-found" });
        else failures.push(...readbackFailures(product, updates).map((failure) => ({ handle, ...failure })));
      }
      if (!plan.byHandle.size) {
        manifest.verification = {
          source: "full-live invariant audit",
          productsInspected: products.length,
          variantsInspected: plan.summary.variantsInspected,
          productsWithUnalignedUpdates: 0,
          heldQuantityTierGroups: plan.held.length,
        };
      }
    }
    manifest.mode = "verify";
    manifest.products = priorProducts.length ? priorProducts : [];
    manifest.failures = failures;
    await writeManifest(args.output, manifest);
    if (failures.length) throw new Error(`Variant cost-price verification failed for ${failures.length} variant(s)`);
    process.stdout.write(`Variant cost-price verification passed: ${prior.products.length} product group(s), zero mismatches.\n`);
    return;
  }

  await writeManifest(args.output, manifest);
  if (args.mode === "dry-run") {
    if ((plan.blockingHeld || []).length) throw new Error(`Variant cost-price dry-run held ${plan.blockingHeld.length} unsafe group(s); review ${args.output}.`);
    process.stdout.write(`Variant cost-price dry-run complete: ${plan.summary.variantsToUpdate} variant price update(s) across ${plan.summary.productsWithUpdates} product(s).\n`);
    return;
  }

  await applyPlan(plan, manifest, args.output);
  manifest.completedAt = new Date().toISOString();
  await writeManifest(args.output, manifest);
  process.stdout.write(`Variant cost-price alignment complete: ${manifest.appliedProducts?.length || 0} product(s) updated and read back.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
