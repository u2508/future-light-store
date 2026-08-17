#!/usr/bin/env node

import { readProductCatalogPayload } from "./product-catalog-files.mjs";

const DEFAULT_SHOP_BASE = "";
const baseUrl = process.env.SALT_SHOP_URL || DEFAULT_SHOP_BASE;
const pageLimit = Number(process.env.SALT_PAGE_LIMIT || 250);
const maxAttempts = Number(process.env.SALT_PRICE_VERIFY_MAX_ATTEMPTS || 6);
const retryDelayMs = Number(process.env.SALT_PRICE_VERIFY_RETRY_DELAY_MS || 1000);
const adminAccessToken =
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.SALT_SHOPIFY_ADMIN_ACCESS_TOKEN || "";
const adminApiVersion = process.env.SHOPIFY_ADMIN_API_VERSION || "2026-07";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeMoney(value) {
  if (value == null || value === "") {
    return null;
  }

  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toFixed(2) : String(value).trim();
}

async function fetchPage(page) {
  let lastStatus = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const url = new URL("/products.json", baseUrl);
    url.searchParams.set("limit", String(pageLimit));
    url.searchParams.set("page", String(page));
    url.searchParams.set("salt_price_verify", String(Date.now()));
    const response = await fetch(url);
    lastStatus = response.status;

    if (response.ok) {
      return response.json();
    }

    if (response.status !== 429 && (response.status < 500 || response.status >= 600)) {
      throw new Error(`Live product readback failed on page ${page} (${response.status})`);
    }

    await sleep(Math.min(retryDelayMs * attempt, 10_000));
  }

  throw new Error(`Live product readback failed on page ${page} after ${maxAttempts} attempts (${lastStatus})`);
}

async function fetchAdminProductVariants() {
  const variants = [];
  const endpoint = `${new URL(baseUrl).origin}/admin/api/${adminApiVersion}/graphql.json`;
  const query = `query VerifyVariantPricing($after: String) {
    productVariants(first: 250, after: $after) {
      nodes {
        id
        legacyResourceId
        price
        compareAtPrice
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;
  let after = null;
  let page = 0;

  while (true) {
    page += 1;
    let lastStatus = 0;
    let response;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": adminAccessToken,
        },
        body: JSON.stringify({ query, variables: { after } }),
      });
      lastStatus = response.status;
      if (response.ok) {
        break;
      }

      if (response.status !== 429 && (response.status < 500 || response.status >= 600)) {
        throw new Error(`Admin variant readback failed (${response.status})`);
      }

      await sleep(Math.min(retryDelayMs * attempt, 10_000));
    }

    if (!response?.ok) {
      throw new Error(`Admin variant readback failed after ${maxAttempts} attempts (${lastStatus})`);
    }

    const payload = await response.json();
    if (payload.errors?.length) {
      throw new Error(payload.errors.map((error) => error.message || "Unknown GraphQL error").join(" | "));
    }

    const connection = payload.data?.productVariants;
    const pageVariants = Array.isArray(connection?.nodes) ? connection.nodes : [];
    variants.push(...pageVariants);
    if (page % 25 === 0 || !connection?.pageInfo?.hasNextPage) {
      process.stdout.write(`Read Admin variant pricing page ${page}: ${variants.length} variants\n`);
    }
    if (!connection?.pageInfo?.hasNextPage) {
      break;
    }

    after = connection.pageInfo.endCursor || null;
  }

  return variants;
}

const catalog = await readProductCatalogPayload("public/data");
const localVariants = new Map();

for (const product of catalog.products) {
  for (const variant of product.variants || []) {
    localVariants.set(String(variant.id), {
      productId: product.id,
      handle: product.handle,
      price: normalizeMoney(variant.price),
      compareAtPrice: normalizeMoney(variant.compare_at_price),
    });
  }
}

const mismatches = [];
const missingVariants = [];
let liveProductCount = 0;
let liveVariantCount = 0;
const expectedProductIds = new Set([...localVariants.values()].map((entry) => String(entry.productId)));
const seenLiveVariantIds = new Set();

if (adminAccessToken) {
  const liveVariants = await fetchAdminProductVariants();
  for (const variant of liveVariants) {
    const variantId = String(variant.legacyResourceId || variant.id || "");
    const local = localVariants.get(variantId);
    if (!local) {
      continue;
    }

    liveVariantCount += 1;
    seenLiveVariantIds.add(variantId);
    const livePrice = normalizeMoney(variant.price);
    const liveCompareAtPrice = normalizeMoney(variant.compareAtPrice);
    if (local.price !== livePrice || local.compareAtPrice !== liveCompareAtPrice) {
      mismatches.push({
        productId: local.productId,
        handle: local.handle,
        variantId,
        localPrice: local.price,
        livePrice,
        localCompareAtPrice: local.compareAtPrice,
        liveCompareAtPrice,
      });
    }
  }
  liveProductCount = expectedProductIds.size;
} else {
  const liveProducts = await (async () => {
    const products = [];
    for (let page = 1; ; page += 1) {
      const payload = await fetchPage(page);
      const pageProducts = Array.isArray(payload?.products) ? payload.products : [];
      products.push(...pageProducts);
      if (pageProducts.length < pageLimit) {
        break;
      }
    }
    return products;
  })();

  liveProductCount = liveProducts.length;
  for (const product of liveProducts) {
    for (const variant of product.variants || []) {
      liveVariantCount += 1;
      const variantId = String(variant.id);
      const local = localVariants.get(variantId);
      if (!local) {
        missingVariants.push({ productId: product.id, handle: product.handle, variantId: variant.id });
        continue;
      }
      seenLiveVariantIds.add(variantId);

      const livePrice = normalizeMoney(variant.price);
      const liveCompareAtPrice = normalizeMoney(variant.compare_at_price);
      if (local.price !== livePrice || local.compareAtPrice !== liveCompareAtPrice) {
        mismatches.push({
          productId: product.id,
          handle: product.handle,
          variantId: variant.id,
          localPrice: local.price,
          livePrice,
          localCompareAtPrice: local.compareAtPrice,
          liveCompareAtPrice,
        });
      }
    }
  }
}

for (const [variantId, local] of localVariants) {
  if (!seenLiveVariantIds.has(variantId)) {
    missingVariants.push({ productId: local.productId, handle: local.handle, variantId });
  }
}

if (missingVariants.length || mismatches.length) {
  const examples = [...missingVariants.slice(0, 5), ...mismatches.slice(0, 10)];
  throw new Error(
    [
      `Catalog pricing verification failed: ${mismatches.length} price mismatch(es), ${missingVariants.length} missing live variant(s).`,
      `Checked ${liveProductCount} live products and ${liveVariantCount} live variants against ${catalog.products.length} generated products.`,
      `Examples: ${JSON.stringify(examples)}`,
    ].join("\n"),
  );
}

process.stdout.write(
  `Verified generated pricing against ${liveProductCount} live products and ${liveVariantCount} live variants.\n`,
);
