#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  asArray,
  createShopifyAdminGraphQLClient,
  normalizeText,
} from "./shopify-admin-graphql-client.mjs";
import {
  PRICE_REWORK_RULES,
  PRICE_REWORK_STRATEGY_ID,
  priceMultiplierFor,
  scalePrice,
} from "../src/lib/shopify-price-rework-policy.js";

const rootDir = resolve(import.meta.dirname, "..");
const defaultOutputPath = resolve(rootDir, "output", "shopify-price-rework-manifest.json");
const defaultThreshold = PRICE_REWORK_RULES.threshold;
const pageSize = 250;
const batchProductSize = Math.max(1, Math.min(25, Number(process.env.SALT_PRICE_REWORK_BATCH_SIZE || 10)));
const client = createShopifyAdminGraphQLClient({ rootDir, agentName: "price-rework" });

const PRODUCTS_QUERY = /* GraphQL */ `
  query PriceReworkProducts($first: Int!, $after: String) {
    products(first: $first, after: $after, sortKey: ID) {
      nodes {
        id
        handle
        title
        status
        variants(first: 250) {
          nodes {
            id
            title
            sku
            price
            compareAtPrice
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const PRODUCT_VARIANTS_QUERY = /* GraphQL */ `
  query PriceReworkProductVariants($id: ID!, $first: Int!, $after: String) {
    node(id: $id) {
      ... on Product {
        id
        handle
        status
        variants(first: $first, after: $after) {
          nodes {
            id
            price
            compareAtPrice
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;

const PRODUCT_BATCH_READBACK_QUERY = /* GraphQL */ `
  query PriceReworkBatchReadback($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        handle
        status
        variants(first: 250) {
          nodes {
            id
            price
            compareAtPrice
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;

const UPDATE_MUTATION = /* GraphQL */ `
  mutation PriceReworkBatch($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        price
        compareAtPrice
      }
      userErrors {
        field
        message
      }
    }
  }
`;

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function parseArgs(argv) {
  const args = {
    mode: "dry-run",
    threshold: defaultThreshold,
    output: defaultOutputPath,
    outputExplicit: false,
    verifyManifest: "",
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--apply") {
      args.mode = "apply";
    } else if (token === "--dry-run") {
      args.mode = "dry-run";
    } else if (token === "--verify") {
      args.mode = "verify";
    } else if (token === "--threshold" && next) {
      args.threshold = Number(next);
      index += 1;
    } else if (token === "--output" && next) {
      args.output = resolve(rootDir, next);
      args.outputExplicit = true;
      index += 1;
    } else if (token === "--verify-manifest" && next) {
      args.verifyManifest = resolve(rootDir, next);
      index += 1;
    }
  }

  if (args.mode === "verify" && !args.outputExplicit) {
    args.output = resolve(rootDir, "output", "shopify-price-rework-verification-manifest.json");
  }
  if (args.mode === "verify" && !args.verifyManifest) {
    throw new Error("Price rework verification requires --verify-manifest <path>." );
  }

  if (!Number.isFinite(args.threshold) || args.threshold <= 0) {
    throw new Error("Price rework threshold must be a positive number.");
  }
  return args;
}

function normalizeMoney(value) {
  if (value == null || value === "") return null;
  const amount = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(amount) ? amount.toFixed(2) : null;
}

async function loadPriorLedger(outputPath, threshold = defaultThreshold) {
  try {
    const parsed = JSON.parse(await readFile(outputPath, "utf8"));
    if (parsed?.strategyId !== PRICE_REWORK_STRATEGY_ID) return new Map();
    const ledger = new Map();
    for (const product of asArray(parsed?.products)) {
      for (const variant of asArray(product?.variants)) {
        const resumableStatuses = parsed?.mode === "apply"
          ? ["pending", "updated-verified", "mutation-verified"]
          : ["updated-verified", "mutation-verified"];
        if (!resumableStatuses.includes(variant?.status)) continue;
        const variantId = String(variant?.variantId || "").trim();
        const plannedPrice = normalizeMoney(variant?.plannedPrice);
        const plannedCompareAtPrice = normalizeMoney(variant?.plannedCompareAtPrice);
        // Keep below-floor prior plans available so a previously reworked value
        // can be lifted to the floor without applying the multiplier twice.
        if (variantId && plannedPrice) {
          ledger.set(variantId, { price: plannedPrice, compareAtPrice: plannedCompareAtPrice });
        }
      }
    }
    return ledger;
  } catch {
    return new Map();
  }
}

async function verifyApprovalForApply() {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  try {
    await execFileAsync(process.execPath, ["scripts/catalog-price-rework-approval.mjs"], {
      cwd: rootDir,
      env: process.env,
      maxBuffer: 2 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(normalizeText(error?.stderr || error?.stdout || error?.message || error));
  }
}

async function fetchProducts(retryInfo) {
  const products = [];
  let after = null;
  let page = 0;

  while (true) {
    page += 1;
    const data = await client.run(
      PRODUCTS_QUERY,
      { first: pageSize, after },
      { operation: `price rework catalog page ${page}`, retryInfo },
    );
    const connection = data?.products;
    if (!connection) throw new Error("Shopify returned no product connection during price rework.");
    for (const product of asArray(connection.nodes)) {
      products.push(
        product?.variants?.pageInfo?.hasNextPage
          ? await completeProductVariants(product, retryInfo, "price rework catalog")
          : product,
      );
    }
    process.stdout.write(`Fetched price catalog page ${page}: ${asArray(connection.nodes).length} products (${products.length} total)\n`);
    if (!connection.pageInfo?.hasNextPage) break;
    if (!connection.pageInfo.endCursor) throw new Error(`Price catalog page ${page} has no end cursor.`);
    after = connection.pageInfo.endCursor;
  }

  return products;
}

function buildPlan(products, args, priorLedger) {
  const plannedProducts = [];
  const summary = {
    productsScanned: products.length,
    variantsScanned: 0,
    eligibleVariants: 0,
    variantsToUpdate: 0,
    productsWithUpdates: 0,
    variantsAlreadyReworked: 0,
    invalidPriceVariants: 0,
    variantsAtOrAboveThreshold: 0,
    variantsUnderTwenty: 0,
    variantsTwentyToThirtyFive: 0,
  };

  for (const product of products) {
    const variants = asArray(product?.variants?.nodes);
    const plannedVariants = [];
    for (const variant of variants) {
      summary.variantsScanned += 1;
      const currentPrice = normalizeMoney(variant?.price);
      const compareAtPrice = normalizeMoney(variant?.compareAtPrice);
      if (!currentPrice || Number(currentPrice) <= 0) {
        summary.invalidPriceVariants += 1;
        continue;
      }
      if (Number(currentPrice) >= args.threshold) {
        summary.variantsAtOrAboveThreshold += 1;
        continue;
      }
      summary.eligibleVariants += 1;
      const multiplier = priceMultiplierFor(Number(currentPrice));
      if (Number(currentPrice) < PRICE_REWORK_RULES.lowPriceCeiling) summary.variantsUnderTwenty += 1;
      else summary.variantsTwentyToThirtyFive += 1;
      const plannedPrice = scalePrice(currentPrice, multiplier);
      const plannedCompareAtPrice = compareAtPrice ? scalePrice(compareAtPrice, multiplier) : null;
      const prior = priorLedger.get(String(variant?.id || ""));
      const priorMatchesCurrent = prior?.price === currentPrice &&
        (prior?.compareAtPrice || null) === (compareAtPrice || null);
      if (priorMatchesCurrent && Number(currentPrice) >= args.threshold) {
        summary.variantsAlreadyReworked += 1;
        continue;
      }
      const floorOnlyRepair = priorMatchesCurrent && Number(currentPrice) < args.threshold;
      const targetPrice = floorOnlyRepair
        ? args.threshold.toFixed(2)
        : Number(plannedPrice) < args.threshold
          ? args.threshold.toFixed(2)
          : plannedPrice;
      const targetCompareAtPrice = compareAtPrice
        ? floorOnlyRepair
          ? Math.max(Number(targetPrice), Number(scalePrice(targetPrice, Number(compareAtPrice) / Number(currentPrice)))).toFixed(2)
          : Math.max(Number(targetPrice), Number(plannedCompareAtPrice || targetPrice)).toFixed(2)
        : null;
      plannedVariants.push({
        variantId: String(variant?.id || ""),
        title: normalizeText(variant?.title),
        sku: normalizeText(variant?.sku),
        currentPrice,
        multiplier: floorOnlyRepair ? 1 : Number(multiplier.toFixed(6)),
        plannedPrice: targetPrice,
        currentCompareAtPrice: compareAtPrice,
        plannedCompareAtPrice: targetCompareAtPrice,
        pricingAdjustment: floorOnlyRepair || Number(plannedPrice) < args.threshold ? "floor-enforced" : "tiered-multiplier",
        status: "pending",
        actualPrice: "",
        actualCompareAtPrice: "",
        failure: "",
      });
      summary.variantsToUpdate += 1;
    }

    if (plannedVariants.length) {
      summary.productsWithUpdates += 1;
      plannedProducts.push({
        productId: String(product?.id || ""),
        handle: normalizeText(product?.handle),
        title: normalizeText(product?.title),
        status: "pending",
        variants: plannedVariants,
        failure: "",
      });
    }
  }

  return { plannedProducts, summary };
}

async function writeManifest(filePath, manifest) {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

function formatErrors(errors) {
  return asArray(errors)
    .map((error) => `${asArray(error?.field).join(".")}: ${normalizeText(error?.message || "Shopify user error")}`.trim())
    .filter(Boolean)
    .join("; ");
}

async function completeProductVariants(product, retryInfo, operationPrefix) {
  const initial = product?.variants || {};
  const nodes = [...asArray(initial.nodes)];
  let hasNextPage = Boolean(initial?.pageInfo?.hasNextPage);
  let after = initial?.pageInfo?.endCursor || null;
  let page = 1;

  while (hasNextPage) {
    if (!after) throw new Error(`${product?.handle || product?.id || "product"} has variant pagination without an end cursor.`);
    page += 1;
    const data = await client.run(
      PRODUCT_VARIANTS_QUERY,
      { id: product.id, first: pageSize, after },
      { operation: `${operationPrefix} ${product?.handle || product?.id} variant page ${page}`, retryInfo },
    );
    const connection = data?.node?.variants;
    nodes.push(...asArray(connection?.nodes));
    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    after = connection?.pageInfo?.endCursor || null;
  }

  product.variants = {
    nodes,
    pageInfo: { hasNextPage: false, endCursor: after },
  };
  return product;
}

function checkVariantReadback(product, actualVariants) {
  const actualById = new Map(asArray(actualVariants).map((variant) => [String(variant?.id || ""), variant]));
  const mismatches = [];
  for (const expected of product.variants) {
    const actual = actualById.get(expected.variantId);
    const actualPrice = normalizeMoney(actual?.price);
    const actualCompareAtPrice = normalizeMoney(actual?.compareAtPrice);
    expected.actualPrice = actualPrice || "";
    expected.actualCompareAtPrice = actualCompareAtPrice || "";
    if (!actual || actualPrice !== expected.plannedPrice || actualCompareAtPrice !== (expected.plannedCompareAtPrice || null)) {
      mismatches.push(
        `${expected.variantId}: expected price ${expected.plannedPrice}, got ${actualPrice || "missing"}; ` +
        `expected compare-at ${expected.plannedCompareAtPrice || "none"}, got ${actualCompareAtPrice || "none"}`,
      );
    }
  }
  return mismatches.join(" | ");
}

function buildUpdateBatch(batch) {
  const declarations = [];
  const fields = [];
  const variables = {};
  batch.forEach((product, index) => {
    declarations.push(`$p${index}: ID!`, `$v${index}: [ProductVariantsBulkInput!]!`);
    variables[`p${index}`] = product.productId;
    variables[`v${index}`] = product.variants.map((variant) => ({
      id: variant.variantId,
      price: variant.plannedPrice,
      ...(variant.plannedCompareAtPrice ? { compareAtPrice: variant.plannedCompareAtPrice } : {}),
    }));
    fields.push(
      `p${index}: productVariantsBulkUpdate(productId: $p${index}, variants: $v${index}) { ` +
      `productVariants { id price compareAtPrice } userErrors { field message } }`,
    );
  });
  return {
    query: `mutation PriceReworkBatch(${declarations.join(", ")}) { ${fields.join(" ")} }`,
    variables,
  };
}

async function verifyBatch(batch, retryInfo, batchNumber) {
  const data = await client.run(
    PRODUCT_BATCH_READBACK_QUERY,
    { ids: batch.map((product) => product.productId) },
    { operation: `price rework batch readback ${batchNumber}`, retryInfo },
  );
  const nodesById = new Map(asArray(data?.nodes).filter(Boolean).map((node) => [String(node?.id || ""), node]));
  const failures = new Map();
  for (const product of batch) {
    try {
      const node = nodesById.get(product.productId);
      if (!node) throw new Error("Product was not returned during price readback.");
      await completeProductVariants(node, retryInfo, "price rework readback");
      const mismatch = checkVariantReadback(product, node.variants?.nodes);
      if (mismatch) throw new Error(mismatch);
    } catch (error) {
      failures.set(product.productId, normalizeText(error?.message || error));
    }
  }
  return failures;
}

function refreshSummary(manifest) {
  const products = asArray(manifest.products);
  const variants = products.flatMap((product) => asArray(product.variants));
  manifest.summary.updatedProducts = products.filter((product) => product.status === "updated-verified").length;
  manifest.summary.updatedVariants = variants.filter((variant) => variant.status === "updated-verified").length;
  manifest.summary.failedProducts = products.filter((product) => product.status === "failed").length;
  manifest.summary.failedVariants = variants.filter((variant) => variant.status === "failed").length;
}

async function applyPlan(manifest) {
  const products = asArray(manifest.products);
  for (let start = 0; start < products.length; start += batchProductSize) {
    const batch = products.slice(start, start + batchProductSize);
    const batchNumber = Math.floor(start / batchProductSize) + 1;
    const totalBatches = Math.ceil(products.length / batchProductSize);
    process.stdout.write(`Applying price rework batch ${batchNumber}/${totalBatches} (${batch.length} products)\n`);
    const retryInfo = [];
    const failures = new Map();
    const mutation = buildUpdateBatch(batch);
    try {
      const data = await client.run(
        mutation.query,
        mutation.variables,
        { allowMutations: true, operation: `price rework mutation batch ${batchNumber}`, retryInfo },
      );
      const verifiedByMutation = [];
      batch.forEach((product, index) => {
        const payload = data?.[`p${index}`];
        const errors = formatErrors(payload?.userErrors);
        if (errors) {
          failures.set(product.productId, errors);
          return;
        }
        const mismatch = checkVariantReadback(product, payload?.productVariants);
        if (mismatch) failures.set(product.productId, `Mutation readback mismatch: ${mismatch}`);
        else verifiedByMutation.push(product);
      });
      if (verifiedByMutation.length) {
        const readbackFailures = await verifyBatch(verifiedByMutation, retryInfo, batchNumber);
        for (const [productId, failure] of readbackFailures) failures.set(productId, failure);
      }
    } catch (error) {
      const failure = normalizeText(error?.message || error);
      for (const product of batch) failures.set(product.productId, failure);
    }

    for (const product of batch) {
      const failure = failures.get(product.productId);
      if (failure) {
        product.status = "failed";
        product.failure = failure;
        for (const variant of product.variants) {
          variant.status = "failed";
          variant.failure = failure;
        }
        manifest.failures.push({ productId: product.productId, handle: product.handle, failure });
      } else {
        product.status = "updated-verified";
        for (const variant of product.variants) variant.status = "updated-verified";
      }
    }
    manifest.retryInfo.push(...retryInfo);
    refreshSummary(manifest);
    await writeManifest(manifest.output, manifest);
  }
}

async function loadVerificationTargets(manifestPath) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read price rework verification manifest ${manifestPath}: ${normalizeText(error?.message || error)}`);
  }

  if (parsed?.strategyId !== PRICE_REWORK_STRATEGY_ID) {
    throw new Error(`Price rework manifest ${manifestPath} does not use strategy ${PRICE_REWORK_STRATEGY_ID}.`);
  }

  const products = [];
  for (const product of asArray(parsed?.products)) {
    const variants = asArray(product?.variants)
      .map((variant) => ({
        variantId: String(variant?.variantId || ""),
        plannedPrice: normalizeMoney(variant?.plannedPrice),
        plannedCompareAtPrice: normalizeMoney(variant?.plannedCompareAtPrice),
      }))
      .filter((variant) => variant.variantId && variant.plannedPrice);
    if (!variants.length) continue;
    products.push({
      productId: String(product?.productId || ""),
      handle: normalizeText(product?.handle),
      title: normalizeText(product?.title),
      variants,
    });
  }

  // A clean, idempotent apply legitimately produces an empty target list. The
  // live catalog floor pass in verifyTargets remains authoritative in that case.
  return products;
}

async function verifyTargets(products, manifestPath, outputPath, threshold = defaultThreshold) {
  const expectedProducts = await loadVerificationTargets(manifestPath);
  const liveProductsById = new Map(products.map((product) => [String(product?.id || ""), product]));
  const verificationProducts = [];
  const failures = [];
  const summary = {
    catalogProducts: products.length,
    catalogVariants: products.reduce((count, product) => count + asArray(product?.variants?.nodes).length, 0),
    expectedProducts: expectedProducts.length,
    expectedVariants: 0,
    verifiedProducts: 0,
    verifiedVariants: 0,
    failedProducts: 0,
    failedVariants: 0,
    missingProducts: 0,
    mismatchProducts: 0,
    catalogUnderFloorVariants: 0,
    catalogInvalidPriceVariants: 0,
    catalogFloorThreshold: threshold,
  };

  for (const expectedProduct of expectedProducts) {
    summary.expectedVariants += expectedProduct.variants.length;
    const liveProduct = liveProductsById.get(expectedProduct.productId);
    const actualById = new Map(
      asArray(liveProduct?.variants?.nodes).map((variant) => [String(variant?.id || ""), variant]),
    );
    const variants = [];
    let productFailure = "";

    for (const expectedVariant of expectedProduct.variants) {
      const actualVariant = actualById.get(expectedVariant.variantId);
      const actualPrice = normalizeMoney(actualVariant?.price);
      const actualCompareAtPrice = normalizeMoney(actualVariant?.compareAtPrice);
      const expectedCompareAtPrice = expectedVariant.plannedCompareAtPrice || null;
      const matches = Boolean(
        actualVariant &&
        actualPrice === expectedVariant.plannedPrice &&
        actualCompareAtPrice === expectedCompareAtPrice,
      );
      const failure = matches
        ? ""
        : actualVariant
          ? `expected price ${expectedVariant.plannedPrice}, got ${actualPrice || "missing"}; expected compare-at ${expectedCompareAtPrice || "none"}, got ${actualCompareAtPrice || "none"}`
          : "variant was not returned by Shopify";
      variants.push({
        ...expectedVariant,
        actualPrice: actualPrice || "",
        actualCompareAtPrice: actualCompareAtPrice || "",
        status: matches ? "verified" : "failed",
        failure,
      });
      if (matches) {
        summary.verifiedVariants += 1;
      } else {
        summary.failedVariants += 1;
        productFailure ||= `${expectedVariant.variantId}: ${failure}`;
        failures.push({
          productId: expectedProduct.productId,
          variantId: expectedVariant.variantId,
          failure,
        });
      }
    }

    const productStatus = productFailure ? "failed" : "verified";
    if (productFailure) {
      summary.failedProducts += 1;
      if (!liveProduct) summary.missingProducts += 1;
      else summary.mismatchProducts += 1;
    } else {
      summary.verifiedProducts += 1;
    }
    verificationProducts.push({
      productId: expectedProduct.productId,
      handle: liveProduct?.handle || expectedProduct.handle,
      title: liveProduct?.title || expectedProduct.title,
      status: productStatus,
      variants,
      failure: productFailure,
    });
  }

  // The target manifest proves repaired variants retained their exact planned
  // values; this separate pass proves no other live variant remains below the
  // approved floor and prevents stale manifests from masking defects.
  for (const product of products) {
    for (const variant of asArray(product?.variants?.nodes)) {
      const actualPrice = normalizeMoney(variant?.price);
      if (!actualPrice) {
        summary.catalogInvalidPriceVariants += 1;
        if (failures.length < 100) {
          failures.push({
            productId: String(product?.id || ""),
            variantId: String(variant?.id || ""),
            handle: normalizeText(product?.handle),
            failure: "variant price is missing or invalid",
          });
        }
      } else if (Number(actualPrice) < threshold) {
        summary.catalogUnderFloorVariants += 1;
        if (failures.length < 100) {
          failures.push({
            productId: String(product?.id || ""),
            variantId: String(variant?.id || ""),
            handle: normalizeText(product?.handle),
            actualPrice,
            failure: `variant price ${actualPrice} is below floor ${threshold.toFixed(2)}`,
          });
        }
      }
    }
  }

  const manifest = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    mode: "verify",
    strategyId: PRICE_REWORK_STRATEGY_ID,
    output: outputPath,
    source: {
      store: client.storeDomain,
      apiVersion: client.apiVersion,
      freshLiveRead: true,
      targetManifest: manifestPath,
    },
    policy: {
      verification: "every planned variant must match both its planned price and planned compare-at price; every live variant must have a valid price at or above the approved floor",
      salesChannelState: "not changed by verification",
    },
    summary,
    products: verificationProducts,
    failures,
  };
  await writeManifest(outputPath, manifest);
  return manifest;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.mode === "apply") await verifyApprovalForApply();
  const retryInfo = [];
  const [products, priorLedger] = await Promise.all([
    fetchProducts(retryInfo),
    loadPriorLedger(args.output, args.threshold),
  ]);

  if (args.mode === "verify") {
    const manifest = await verifyTargets(products, args.verifyManifest, args.output, args.threshold);
    const catalogFloorFailures = manifest.summary.catalogUnderFloorVariants + manifest.summary.catalogInvalidPriceVariants;
    if (manifest.summary.failedProducts || catalogFloorFailures) {
      throw new Error(`Price rework verification failed for ${manifest.summary.failedVariants} planned variant(s) and ${catalogFloorFailures} catalog floor violation(s); see ${args.output}.`);
    }
    process.stdout.write(`Price rework verification complete: ${manifest.summary.verifiedVariants} variant target(s) verified across ${manifest.summary.verifiedProducts} product(s).\n`);
    return;
  }

  const { plannedProducts, summary } = buildPlan(products, args, priorLedger);
  const manifest = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    completedAt: "",
    mode: args.mode,
    strategyId: PRICE_REWORK_STRATEGY_ID,
    output: args.output,
    source: {
      store: client.storeDomain,
      apiVersion: client.apiVersion,
      freshLiveRead: true,
    },
    policy: {
      scope: "all Shopify products and variants with current price below $35",
      formula: "price < $20: linearly scale from 2.00x toward 1.80x; $20 <= price < $35: linearly scale from 1.70x toward 1.40x; price >= $35 unchanged",
      compareAtPrices: "existing compare-at prices receive the same variant multiplier; absent values remain absent",
      variantPricing: "variant-specific prices are preserved; no product-level flattening",
      statusAndChannels: "product status and sales-channel inclusion are unchanged",
      idempotency: "only manifests produced by this strategy can resume; previously verified targets are not compounded",
    },
    parameters: {
      threshold: args.threshold,
      lowPriceCeiling: PRICE_REWORK_RULES.lowPriceCeiling,
      underTwentyMultiplierRange: PRICE_REWORK_RULES.underTwenty,
      twentyToThirtyFiveMultiplierRange: PRICE_REWORK_RULES.twentyToThirtyFive,
    },
    summary: {
      ...summary,
      updatedProducts: 0,
      updatedVariants: 0,
      failedProducts: 0,
      failedVariants: 0,
    },
    retryInfo,
    products: plannedProducts,
    failures: [],
  };
  refreshSummary(manifest);

  if (args.mode === "dry-run") {
    for (const product of manifest.products) {
      product.status = "would-update";
      for (const variant of product.variants) variant.status = "would-update";
    }
    manifest.completedAt = new Date().toISOString();
    await writeManifest(args.output, manifest);
    process.stdout.write(`Price rework dry-run complete: ${summary.variantsToUpdate} variant price(s) across ${summary.productsWithUpdates} product(s).\n`);
    return;
  }

  await writeManifest(args.output, manifest);
  await applyPlan(manifest);
  manifest.completedAt = new Date().toISOString();
  refreshSummary(manifest);
  await writeManifest(args.output, manifest);
  if (manifest.summary.failedProducts) {
    throw new Error(`Price rework failed for ${manifest.summary.failedProducts} product(s); see ${args.output}.`);
  }
  process.stdout.write(`Price rework complete: ${manifest.summary.updatedVariants} variant price(s) updated and verified.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message || error}\n`);
  process.exitCode = 1;
});
