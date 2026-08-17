#!/usr/bin/env node

import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, basename, resolve } from "node:path";
import XLSX from "xlsx";
import {
  DEFAULT_BUNDLE_TIERS,
  DEFAULT_PRICE_INCREASE_PERCENT,
  buildOrdersBundleManifest,
  getProductLookupCandidates,
  getProductSearchQuery,
  selectLiveVariant,
} from "../src/lib/shopify-orders-bundle.js";
import { normalizePlainText } from "../src/lib/shopify-seo-batch.js";

const DEFAULT_SHOP_BASE = "";
const SHOP_BASE = process.env.SALT_SHOP_URL || DEFAULT_SHOP_BASE;
const STORE_DOMAIN = new URL(SHOP_BASE).hostname;
const ADMIN_API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || "2026-07";
const SHOPIFY_CLI_AGENT_INFO = process.env.SHOPIFY_CLI_AGENT_INFO || "n:Codex|v:5|p:openai";
const SHOPIFY_CLI_AGENT_IDS = process.env.SHOPIFY_CLI_AGENT_IDS || "s:local|r:orders-bundle|i:local";

const PRODUCT_BY_IDENTIFIER_QUERY = /* GraphQL */ `
  query OrdersBundleProductByIdentifier($identifier: ProductIdentifierInput!) {
    productByIdentifier(identifier: $identifier) {
      id
      handle
      title
      variants(first: 100) {
        nodes {
          id
          title
          sku
          price
          compareAtPrice
          selectedOptions {
            name
            value
          }
        }
      }
    }
  }
`;

const PRODUCTS_SEARCH_QUERY = /* GraphQL */ `
  query OrdersBundleProductsSearch($query: String!, $first: Int = 10) {
    products(first: $first, query: $query) {
      nodes {
        id
        handle
        title
        variants(first: 100) {
          nodes {
            id
            title
            sku
            price
            compareAtPrice
            selectedOptions {
              name
              value
            }
          }
        }
      }
    }
  }
`;

const PRODUCT_VARIANTS_BULK_UPDATE_MUTATION = /* GraphQL */ `
  mutation OrdersBundleVariantUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        title
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
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const args = {
    input: "",
    output: "",
    apply: false,
    dryRun: true,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === "--input" || token === "-i") {
      args.input = next || "";
      index += 1;
      continue;
    }

    if (token === "--output" || token === "-o") {
      args.output = next || "";
      index += 1;
      continue;
    }

    if (token === "--apply") {
      args.apply = true;
      args.dryRun = false;
      continue;
    }

    if (token === "--dry-run") {
      args.dryRun = true;
      args.apply = false;
      continue;
    }
  }

  if (args.apply) {
    args.dryRun = false;
  }

  return args;
}

function requireInputPath(inputPath) {
  if (!inputPath) {
    throw new Error(
      "Missing --input path. Example: npm run shopify:orders-bundle:dry-run -- --input /Users/mac/Downloads/orders_export_1.csv",
    );
  }

  return resolve(process.cwd(), inputPath);
}

function requireOutputPath(inputPath, outputPath) {
  if (outputPath) {
    return resolve(process.cwd(), outputPath);
  }

  const baseName = basename(inputPath).replace(/\.[^.]+$/, "");
  return resolve(process.cwd(), "output", `${baseName}.bundle-manifest.json`);
}

async function readRowsFromCsv(filePath) {
  const workbook = XLSX.readFile(filePath, {
    cellDates: true,
    raw: false,
  });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error(`No worksheets found in ${filePath}`);
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    raw: false,
    defval: "",
  });

  if (!rows.length) {
    throw new Error(`No readable rows found in ${filePath}`);
  }

  return rows;
}

function getShopifyCliEnv() {
  return {
    ...process.env,
    SHOPIFY_CLI_AGENT_INFO,
    SHOPIFY_CLI_AGENT_IDS,
  };
}

function runShopifyCli(args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("shopify", args, {
      env: getShopifyCliEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      rejectPromise(error);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        rejectPromise(new Error(stderr.trim() || stdout.trim() || `shopify exited with code ${code}`));
        return;
      }

      resolvePromise({ stdout, stderr });
    });

    child.stdin.end();
  });
}

async function executeStoreGraphQL(query, variables, { allowMutations = false } = {}) {
  const args = [
    "store",
    "execute",
    "--store",
    STORE_DOMAIN,
    "--query",
    query,
    "--variables",
    JSON.stringify(variables || {}),
    "--version",
    ADMIN_API_VERSION,
    "--json",
  ];

  if (allowMutations) {
    args.push("--allow-mutations");
  }

  const { stdout } = await runShopifyCli(args);
  const trimmed = stdout.trim();
  const jsonStart = trimmed.indexOf("{");
  if (jsonStart < 0) {
    throw new Error(trimmed || "Shopify CLI returned no JSON payload");
  }

  return JSON.parse(trimmed.slice(jsonStart));
}

function compactText(value) {
  return normalizePlainText(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

async function resolveProduct(productPlan) {
  const handleCandidates = getProductLookupCandidates(productPlan.productTitle);
  for (const handle of handleCandidates) {
    const direct = await executeStoreGraphQL(PRODUCT_BY_IDENTIFIER_QUERY, {
      identifier: { handle },
    });

    const directProduct = direct?.productByIdentifier;
    if (directProduct?.id) {
      return directProduct;
    }
  }

  const searchQuery = getProductSearchQuery(productPlan.productTitle);
  const searchResult = await executeStoreGraphQL(PRODUCTS_SEARCH_QUERY, {
    query: searchQuery,
    first: 10,
  });

  const candidates = Array.isArray(searchResult?.products?.nodes) ? searchResult.products.nodes : [];
  const normalizedTitle = compactText(productPlan.productTitle);
  const normalizedLookupHandles = handleCandidates.map((handle) => compactText(handle));
  return (
    candidates.find((candidate) => compactText(candidate?.title) === normalizedTitle) ||
    candidates.find((candidate) => normalizedLookupHandles.includes(compactText(candidate?.handle))) ||
    candidates[0] ||
    null
  );
}

async function updateProductVariants(productPlan, liveProduct) {
  const liveVariants = Array.isArray(liveProduct?.variants?.nodes) ? liveProduct.variants.nodes : [];
  const productVariants = [];
  const unresolved = [];

  for (const variantPlan of productPlan.variants) {
    const liveVariant = selectLiveVariant(liveVariants, variantPlan);
    if (!liveVariant?.id) {
      unresolved.push({
        lineItemName: variantPlan.lineItemName,
        lineItemSku: variantPlan.lineItemSku,
        variantLabel: variantPlan.variantLabel,
      });
      continue;
    }

    const input = {
      id: liveVariant.id,
      price: Number(variantPlan.updatedPrice),
    };

    if (variantPlan.updatedCompareAtPrice) {
      input.compareAtPrice = Number(variantPlan.updatedCompareAtPrice);
    }

    productVariants.push(input);
  }

  if (unresolved.length) {
    return {
      skipped: true,
      unresolved,
      resolved: [],
    };
  }

  const response = await executeStoreGraphQL(
    PRODUCT_VARIANTS_BULK_UPDATE_MUTATION,
    {
      productId: liveProduct.id,
      variants: productVariants,
    },
    { allowMutations: true },
  );

  const userErrors = response?.productVariantsBulkUpdate?.userErrors || [];
  if (userErrors.length) {
    const message = userErrors
      .map((error) => `${error.field?.join?.(".") || ""} ${error.message}`.trim())
      .join("; ");
    throw new Error(`Variant update failed for ${productPlan.productHandle}: ${message}`);
  }

  return {
    skipped: false,
    unresolved: [],
    resolved: response?.productVariantsBulkUpdate?.productVariants || [],
  };
}

function printManifestSummary(manifest, { apply = false } = {}) {
  const mode = apply ? "APPLY" : "DRY RUN";
  process.stdout.write(`\n[${mode}] ${manifest.summary.productCount} product group(s) from spreadsheet\n`);
  process.stdout.write(
    `- ${manifest.summary.entryCount} order row(s), ${manifest.summary.variantCount} variant(s), ${manifest.summary.quantitySold} unit(s)\n`,
  );

  for (const product of manifest.products) {
    process.stdout.write(`- ${product.productTitle}\n`);
    process.stdout.write(`  handle: ${product.productHandle}\n`);
    process.stdout.write(`  variants:\n`);
    for (const variant of product.variants) {
      const compareAt = variant.updatedCompareAtPrice ? ` compare-at ${variant.updatedCompareAtPrice}` : "";
      process.stdout.write(`    ${variant.variantLabel || variant.lineItemName} -> ${variant.updatedPrice}${compareAt}\n`);
    }
  }

  if (manifest.warnings.length) {
    process.stdout.write("\nWarnings:\n");
    for (const warning of manifest.warnings) {
      process.stdout.write(`- ${warning}\n`);
    }
  }
}

async function writeManifest(outputFile, manifest) {
  await mkdir(dirname(outputFile), { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function main() {
  const args = parseArgs(process.argv);
  const inputFile = requireInputPath(args.input);
  const outputFile = requireOutputPath(inputFile, args.output);
  const rows = await readRowsFromCsv(inputFile);

  const manifest = buildOrdersBundleManifest(rows, {
    inputFile,
    outputFile,
    priceIncreasePercent: DEFAULT_PRICE_INCREASE_PERCENT,
    bundleTiers: DEFAULT_BUNDLE_TIERS,
    status: args.apply ? "applied" : "dry-run",
    resolvedAt: args.apply ? new Date().toISOString() : "",
  });

  printManifestSummary(manifest, { apply: args.apply });
  await writeManifest(outputFile, manifest);

  if (args.dryRun) {
    process.stdout.write(`\nDry run complete. Manifest written to ${outputFile}\n`);
    return;
  }

  const updatedProducts = [];
  const skippedProducts = [];

  for (const productPlan of manifest.products) {
    const liveProduct = await resolveProduct(productPlan);
    if (!liveProduct?.id) {
      skippedProducts.push(`${productPlan.productTitle} (product not found)`);
      continue;
    }

    const updateResult = await updateProductVariants(productPlan, liveProduct);
    if (updateResult.skipped) {
      productPlan.resolvedShopifyProducts = [
        {
          id: liveProduct.id,
          handle: liveProduct.handle,
          title: liveProduct.title,
        },
      ];
      productPlan.unresolvedVariants = updateResult.unresolved;
      skippedProducts.push(
        `${productPlan.productTitle} (${updateResult.unresolved.map((variant) => variant.lineItemSku || variant.lineItemName).join(", ")})`,
      );
      continue;
    }

    productPlan.resolvedShopifyProducts = [
      {
        id: liveProduct.id,
        handle: liveProduct.handle,
        title: liveProduct.title,
      },
    ];
    productPlan.unresolvedVariants = [];
    updatedProducts.push(productPlan.productHandle);
    process.stdout.write(`Applied ${productPlan.productHandle}\n`);
  }

  manifest.status = "applied";
  manifest.resolvedAt = new Date().toISOString();
  await writeManifest(outputFile, manifest);

  process.stdout.write(`\nUpdated ${updatedProducts.length} product group(s) on Shopify.\n`);
  if (skippedProducts.length) {
    process.stdout.write(`Skipped ${skippedProducts.length} product group(s).\n`);
    for (const skipped of skippedProducts) {
      process.stdout.write(`- ${skipped}\n`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
