#!/usr/bin/env node

/**
 * Read-only ad-cohort preparation for the VS Store launch.
 *
 * This command deliberately stops at a reviewable shortlist. It never marks a
 * product margin-approved, changes Shopify, imports through DSers, or enables
 * an ad campaign. Supplier delivery, returns handling, and the final margin
 * model need operator evidence before a product can cross the launch gate.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createShopifyAdminGraphQLClient } from "./shopify-admin-graphql-client.mjs";
import { dedupeRankedCandidates } from "./lib/marketing-cohort-selection.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const outputPath = resolve(rootDir, "output", "marketing-cohort-audit.json");
const pageSize = 100;
const requestedCohortSize = 18;

const RISK_RULES = [
  [
    "medical-or-treatment-claim",
    /\b(acne|anti[- ]?aging|wrinkle|treatment|therapy|therapeutic|cure|diagnos|pain relief|weight loss|slimming|supplement|vitamin|medical|orthopedic)\b/i,
  ],
  ["adult-or-sensitive", /\b(adult|erotic|lingerie|sex|sexual|fetish|weapon|gun|knife)\b/i],
  ["counterfeit-or-branded-risk", /\b(replica|counterfeit|fake|1:1|copy|clone)\b/i],
  [
    "character-or-licensed-content-risk",
    /\b(anime|cosplay|cartoon|gengar|disney|pokemon|marvel|manga)\b/i,
  ],
];

const GENERIC_COPY_RULES = [
  /high quality product/i,
  /perfect for everyday use/i,
  /suitable for all/i,
  /make your life easier/i,
  /fashionable and practical/i,
  /best choice for you/i,
];

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalize(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function descriptionText(product) {
  return normalize(String(product.descriptionHtml || "").replace(/<[^>]*>/g, " "));
}

function copyQuality(product) {
  const text = descriptionText(product);
  const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
  const generic = GENERIC_COPY_RULES.some((pattern) => pattern.test(text));
  return {
    present: Boolean(text),
    wordCount,
    generic,
    ready: Boolean(text) && wordCount >= 35 && !generic,
  };
}

function productText(product) {
  return [product.title, product.vendor, product.productType, ...(product.tags ?? [])]
    .map(normalize)
    .filter(Boolean)
    .join(" ");
}

function riskFlags(product) {
  const text = productText(product);
  return RISK_RULES.flatMap(([code, pattern]) => (pattern.test(text) ? [code] : []));
}

function summarizeProduct(product) {
  const variants = product.variants?.nodes ?? [];
  const rows = variants.map((variant) => {
    const price = numberValue(variant.price);
    const cost = numberValue(variant.inventoryItem?.unitCost?.amount);
    const inventory = numberValue(variant.inventoryQuantity);
    const margin = price !== null && cost !== null && price > 0 ? price - cost : null;
    const marginPercent = margin !== null && price !== null ? (margin / price) * 100 : null;
    return {
      id: variant.id,
      title: normalize(variant.title),
      price,
      cost,
      inventory,
      grossMarginBeforeShipping: margin,
      grossMarginPercentBeforeShipping: marginPercent,
    };
  });

  const priced = rows.filter((row) => row.price !== null && row.price > 0);
  const costed = rows.filter((row) => row.cost !== null && row.cost >= 0);
  const stocked = rows.filter((row) => row.inventory !== null && row.inventory > 0);
  const margins = rows
    .map((row) => row.grossMarginPercentBeforeShipping)
    .filter((value) => value !== null);
  const contributions = rows
    .map((row) => row.grossMarginBeforeShipping)
    .filter((value) => value !== null);
  const prices = priced.map((row) => row.price);
  const inventoryValues = rows.map((row) => row.inventory).filter((value) => value !== null);
  const risks = riskFlags(product);
  const copy = copyQuality(product);

  const costComplete = rows.length > 0 && costed.length === rows.length;
  const stockAvailable = stocked.length > 0 || numberValue(product.totalInventory) > 0;
  const dataEligible =
    rows.length > 0 &&
    priced.length === rows.length &&
    costComplete &&
    stockAvailable &&
    risks.length === 0;

  return {
    id: product.id,
    handle: product.handle,
    title: normalize(product.title),
    vendor: normalize(product.vendor),
    productType: normalize(product.productType),
    updatedAt: product.updatedAt ?? null,
    collections: (product.collections?.nodes ?? []).map((collection) => ({
      title: normalize(collection.title),
      handle: normalize(collection.handle),
    })),
    variantCount: rows.length,
    minPrice: prices.length ? Math.min(...prices) : null,
    maxPrice: prices.length ? Math.max(...prices) : null,
    minGrossMarginPercentBeforeShipping: margins.length ? Math.min(...margins) : null,
    minGrossMarginBeforeShipping: contributions.length ? Math.min(...contributions) : null,
    totalInventory: numberValue(product.totalInventory),
    minVariantInventory: inventoryValues.length ? Math.min(...inventoryValues) : null,
    maxVariantInventory: inventoryValues.length ? Math.max(...inventoryValues) : null,
    riskFlags: risks,
    copy,
    dataEligible,
    evidence: {
      shopifyPriceAndCost: costComplete,
      shopifyInventory: stockAvailable,
      productCopy: copy.ready,
      supplierDelivery: false,
      returnsProcess: false,
      marginApproval: false,
    },
    variants: rows,
  };
}

function rank(candidate) {
  // This is only a review-order score. It is not an approval or a promise of
  // profitability because shipping, payment fees, refunds, and supplier data
  // are intentionally not available in the read-only Shopify snapshot.
  const margin = candidate.minGrossMarginPercentBeforeShipping ?? -1_000;
  const contribution = candidate.minGrossMarginBeforeShipping ?? -1_000;
  const inventory = Math.min(Math.max(candidate.totalInventory ?? 0, 0), 10_000);
  const priceFit =
    candidate.minPrice !== null && candidate.minPrice >= 20 && candidate.minPrice <= 100 ? 10 : 0;
  const collectionFit = candidate.collections.some((collection) =>
    ["new-arrivals", "best-sellers", "premium-picks"].includes(collection.handle),
  )
    ? 5
    : 0;
  return (
    margin * 0.65 + contribution * 0.8 + Math.log10(inventory + 1) * 3 + priceFit + collectionFit
  );
}

async function readActiveProducts(client) {
  const products = [];
  let after = null;
  let hasNextPage = true;
  while (hasNextPage) {
    const data = await client.run(
      `query ActiveProducts($first: Int!, $after: String) {
        products(
          first: $first
          after: $after
          query: "status:ACTIVE"
          sortKey: UPDATED_AT
          reverse: true
        ) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            title
            handle
            descriptionHtml
            vendor
            productType
            tags
            totalInventory
            updatedAt
            variants(first: 100) {
              nodes {
                id
                title
                price
                inventoryQuantity
                inventoryItem { unitCost { amount currencyCode } }
              }
            }
            collections(first: 25) { nodes { title handle } }
          }
        }
      }`,
      { first: pageSize, after },
      { operation: "Read all active Shopify products for ad-cohort review" },
    );
    const connection = data.products;
    products.push(...(connection?.nodes ?? []));
    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage && connection?.pageInfo?.endCursor);
    after = connection?.pageInfo?.endCursor ?? null;
  }
  return products;
}

function buildReport(products) {
  const summarized = products.map(summarizeProduct);
  const ranked = dedupeRankedCandidates(
    summarized.filter((product) => product.dataEligible).sort((a, b) => rank(b) - rank(a)),
  );
  const reviewable = ranked.slice(0, requestedCohortSize).map((product, index) => ({
    ...product,
    reviewRank: index + 1,
    reviewScore: Number(rank(product).toFixed(2)),
    approvalStatus: "pending-operator-evidence",
  }));

  const testCycles = [];
  for (let index = 0; index < reviewable.length; index += 4) {
    testCycles.push({
      cycle: testCycles.length + 1,
      maxProducts: 4,
      handles: reviewable.slice(index, index + 4).map((product) => product.handle),
      status: "not-approved",
    });
  }

  return {
    schemaVersion: "2026-09-21.vs-store.marketing-cohort-audit.1",
    generatedAt: new Date().toISOString(),
    mode: "read-only",
    liveSource: "Shopify Admin API active products",
    requestedCohortSize,
    totalActiveProductsRead: products.length,
    summary: {
      dataEligibleProducts: summarized.filter((product) => product.dataEligible).length,
      copyReadyProducts: summarized.filter((product) => product.copy.ready).length,
      missingProductCopy: summarized.filter((product) => !product.copy.ready).length,
      missingCostEvidence: summarized.filter((product) => !product.evidence.shopifyPriceAndCost)
        .length,
      outOfStockOrUnknownInventory: summarized.filter(
        (product) => !product.evidence.shopifyInventory,
      ).length,
      riskFlaggedProducts: summarized.filter((product) => product.riskFlags.length > 0).length,
      candidates: reviewable.length,
    },
    approvalGate: {
      status: "blocked",
      reason:
        "Supplier delivery, US returns handling, shipping/payment costs, refund exposure, and operator margin approval are not present in Shopify product data.",
      requiredEvidence: [
        "supplier and DSers fulfillment mapping verified",
        "US delivery estimate and shipping cost verified",
        "US returns process/address verified",
        "product-specific title, description, compatibility/FAQ and trust copy reviewed",
        "payment fees, shipping cost, refund reserve, and allowable CPA modeled",
        "operator explicitly approves the 12–18 handles",
      ],
    },
    candidates: reviewable,
    testCycles,
    safeActionsTaken: [
      "Read active Shopify products only.",
      "No Shopify product, collection, price, inventory, or publication mutation.",
      "No DSers import or product push.",
      "No ad campaign or production test order.",
    ],
  };
}

async function main() {
  const client = createShopifyAdminGraphQLClient({
    rootDir,
    agentName: "marketing-cohort-audit",
  });
  const products = await readActiveProducts(client);
  const report = buildReport(products);
  await mkdir(resolve(rootDir, "output"), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(
    `Marketing cohort audit written to ${outputPath}\n` +
      `Live active products read: ${report.totalActiveProductsRead}; review candidates: ${report.summary.candidates}; approval gate: ${report.approvalGate.status}.\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : error}\n`);
  process.exitCode = 1;
});
