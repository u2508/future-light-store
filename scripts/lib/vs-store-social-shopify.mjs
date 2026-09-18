import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  retryDelayMs,
  parseRetryAfterMs,
  sleep,
  createRequestScheduler,
} from "./performance-runtime.mjs";

const execFileAsync = promisify(execFile);

export const SOCIAL_PRODUCTS_QUERY = /* GraphQL */ `
  query VsStoreSocialProducts($first: Int!, $after: String) {
    products(first: $first, after: $after, query: "status:active", sortKey: UPDATED_AT) {
      nodes {
        id
        handle
        title
        descriptionHtml
        vendor
        productType
        tags
        status
        publishedAt
        totalInventory
        featuredImage {
          url
          altText
        }
        images(first: 3) {
          nodes {
            url
            altText
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

export const SOCIAL_COLLECTIONS_QUERY = /* GraphQL */ `
  query VsStoreSocialCollections($first: Int!, $after: String) {
    collections(first: $first, after: $after, sortKey: UPDATED_AT) {
      nodes {
        id
        handle
        title
        descriptionHtml
        updatedAt
        image {
          url
          altText
        }
        products(first: 12) {
          nodes {
            id
            handle
            title
            featuredImage {
              url
              altText
            }
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

export const SOCIAL_PRODUCT_OFFER_QUERY = /* GraphQL */ `
  query VsStoreSocialProductOffer($id: ID!) {
    node(id: $id) {
      ... on Product {
        id
        handle
        title
        status
        variants(first: 250) {
          nodes {
            id
            title
            price
            inventoryQuantity
            inventoryItem {
              unitCost {
                amount
                currencyCode
              }
            }
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

export const SOCIAL_COLLECTION_OFFER_QUERY = /* GraphQL */ `
  query VsStoreSocialCollectionOffer($id: ID!) {
    node(id: $id) {
      ... on Collection {
        id
        handle
        title
        products(first: 250) {
          nodes {
            id
            handle
            title
            status
            variants(first: 250) {
              nodes {
                id
                title
                price
                inventoryQuantity
                inventoryItem {
                  unitCost {
                    amount
                    currencyCode
                  }
                }
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
    }
  }
`;

export const SOCIAL_STOREWIDE_OFFER_QUERY = /* GraphQL */ `
  query VsStoreSocialStorewideOffer($first: Int!, $after: String) {
    products(first: $first, after: $after, query: "status:active", sortKey: UPDATED_AT) {
      nodes {
        id
        status
        publishedAt
        totalInventory
        variants(first: 250) {
          nodes {
            id
            price
            inventoryQuantity
            inventoryItem {
              unitCost {
                amount
                currencyCode
              }
            }
          }
          pageInfo {
            hasNextPage
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

export const SOCIAL_DISCOUNT_CREATE_MUTATION = /* GraphQL */ `
  mutation VsStoreSocialDiscountCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode {
        id
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const SOCIAL_DISCOUNT_UPDATE_MUTATION = /* GraphQL */ `
  mutation VsStoreSocialDiscountUpdate($id: ID!, $basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicUpdate(id: $id, basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode {
        id
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const SOCIAL_DISCOUNT_READ_QUERY = /* GraphQL */ `
  query VsStoreSocialDiscountRead($id: ID!) {
    node(id: $id) {
      ... on DiscountCodeNode {
        id
        codeDiscount {
          ... on DiscountCodeBasic {
            title
            status
            startsAt
            endsAt
            appliesOncePerCustomer
            combinesWith {
              orderDiscounts
              productDiscounts
              shippingDiscounts
            }
            codes(first: 5) {
              nodes {
                code
              }
            }
            customerGets {
              value {
                ... on DiscountPercentage {
                  percentage
                }
              }
              items {
                ... on AllDiscountItems {
                  allItems
                }
                ... on DiscountProducts {
                  products(first: 250) {
                    nodes {
                      id
                    }
                  }
                }
                ... on DiscountCollections {
                  collections(first: 250) {
                    nodes {
                      id
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const SOCIAL_DISCOUNT_BY_CODE_QUERY = /* GraphQL */ `
  query VsStoreSocialDiscountByCode($first: Int!, $query: String!) {
    discountNodes(first: $first, query: $query) {
      nodes {
        id
        discount {
          ... on DiscountCodeBasic {
            codes(first: 5) {
              nodes {
                code
              }
            }
          }
        }
      }
    }
  }
`;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMoney(value) {
  const amount = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(amount) ? amount : null;
}

function graphQlErrorMessage(errors) {
  return asArray(errors)
    .map((error) => normalizeText(error?.message || "Shopify GraphQL error"))
    .filter(Boolean)
    .join(" | ");
}

function parseCliPayload(raw) {
  const text = String(raw || "").trim();
  const jsonStart = text.indexOf("{");
  if (jsonStart < 0) throw new Error(text || "Shopify CLI returned no JSON payload.");
  let payload;
  try {
    payload = JSON.parse(text.slice(jsonStart));
  } catch {
    throw new Error("Shopify CLI returned invalid JSON.");
  }
  if (asArray(payload?.errors).length) {
    throw new Error(graphQlErrorMessage(payload.errors));
  }
  return payload?.data || payload || {};
}

function isRetryable(error) {
  return Boolean(
    error?.retryable ||
    error?.killed ||
    error?.signal === "SIGTERM" ||
    error?.code === "ETIMEDOUT" ||
    error?.code === "EAI_AGAIN" ||
    error?.code === "ENOTFOUND" ||
    /\b(408|425|429|500|502|503|504)\b|timeout|timed out|network|socket|dns|temporar|unavailable|gateway/i.test(
      String(error?.message || error),
    ),
  );
}

export function createVsStoreShopifyClient(config) {
  if (!config.storeDomain) throw new Error("FUTURE_LIGHT_SHOPIFY_STORE_DOMAIN is required.");
  const endpoint = `https://${config.storeDomain}/admin/api/${config.shopifyApiVersion}/graphql.json`;
  const useCli = Boolean(config.shopifyUseCli);
  const cliBinary = config.shopifyCliBinary || "shopify";
  const scheduler = createRequestScheduler({
    // Shopify CLI's stored-auth session is shared by every invocation; keep
    // CLI-backed reads/mutations serialized so parallel commands cannot race
    // the session lock. Direct Admin API token mode remains concurrent.
    concurrency: useCli ? 1 : config.requestConcurrency,
    minIntervalMs: 100,
  });

  async function runViaCli(query, variables, { allowMutation = false, operation }) {
    const tempDir = await mkdtemp(join(tmpdir(), "vs-store-social-shopify-cli-"));
    const queryPath = join(tempDir, "operation.graphql");
    const variablesPath = join(tempDir, "variables.json");
    const outputPath = join(tempDir, "result.json");
    try {
      await Promise.all([
        writeFile(queryPath, query, "utf8"),
        writeFile(variablesPath, JSON.stringify(variables), "utf8"),
      ]);
      const args = [
        "store",
        "execute",
        "--store",
        config.storeDomain,
        "--version",
        config.shopifyApiVersion,
        "--query-file",
        queryPath,
        "--variable-file",
        variablesPath,
        "--output-file",
        outputPath,
        "--json",
      ];
      if (allowMutation) args.push("--allow-mutations");
      const result = await execFileAsync(cliBinary, args, {
        cwd: config.rootDir,
        env: {
          ...process.env,
          CI: "1",
          SHOPIFY_CLI_DISABLE_ANALYTICS: "1",
          SHOPIFY_CLI_AGENT_INFO: "n:vs-store-social|v:1|p:openai",
          SHOPIFY_CLI_AGENT_IDS: `s:${process.env.CONVERSATION_ID || "future-light-store"}|r:${process.pid}|i:local`,
        },
        maxBuffer: 20 * 1024 * 1024,
        timeout: Math.max(config.requestTimeoutMs, 120_000),
        killSignal: "SIGTERM",
      });
      let raw = result.stdout || "";
      try {
        const output = await readFile(outputPath, "utf8");
        if (String(output).trim()) raw = output;
      } catch {
        // Older CLI versions emit JSON on stdout only.
      }
      return parseCliPayload(raw);
    } catch (error) {
      const detail =
        [error?.stderr, error?.stdout, error?.message, error]
          .map((value) => normalizeText(value))
          .find(Boolean) || "unknown Shopify CLI error";
      const wrapped = new Error(`${operation} via Shopify CLI failed: ${detail.slice(0, 800)}`);
      wrapped.code = error?.code;
      wrapped.killed = error?.killed;
      wrapped.signal = error?.signal;
      wrapped.retryable = isRetryable(error) || isRetryable(wrapped);
      throw wrapped;
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  async function run(
    query,
    variables = {},
    { operation = "Shopify social request", retryInfo = [], allowMutation = false } = {},
  ) {
    if (!config.shopifyAdminAccessToken && !useCli) {
      const error = new Error("FUTURE_LIGHT_SHOPIFY_ADMIN_ACCESS_TOKEN is not configured.");
      error.code = "MISSING_CREDENTIAL";
      throw error;
    }
    return scheduler.run(async () => {
      for (let attempt = 0; attempt < config.maxAttempts; attempt += 1) {
        try {
          if (useCli) {
            return await runViaCli(query, variables, { allowMutation, operation });
          }
          const response = await fetch(endpoint, {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": config.shopifyAdminAccessToken,
            },
            body: JSON.stringify({ query, variables }),
            signal: AbortSignal.timeout(config.requestTimeoutMs),
          });
          const raw = await response.text();
          let payload;
          try {
            payload = JSON.parse(raw);
          } catch {
            const error = new Error(`Shopify returned non-JSON HTTP ${response.status}.`);
            error.retryable = response.status >= 500;
            throw error;
          }
          if (!response.ok) {
            const error = new Error(
              `Shopify Admin GraphQL HTTP ${response.status}: ${graphQlErrorMessage(payload?.errors) || raw.slice(0, 300)}`,
            );
            error.retryable =
              response.status === 408 ||
              response.status === 425 ||
              response.status === 429 ||
              response.status >= 500;
            error.retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
            throw error;
          }
          if (asArray(payload?.errors).length) {
            const error = new Error(graphQlErrorMessage(payload.errors));
            error.retryable = /throttl|rate limit|temporar|timeout|unavailable/i.test(
              error.message,
            );
            throw error;
          }
          return payload?.data || {};
        } catch (error) {
          if (!isRetryable(error) || attempt >= config.maxAttempts - 1) {
            error.message = `${operation} failed: ${normalizeText(error.message || error)}`;
            throw error;
          }
          const delayMs = retryDelayMs({
            attempt,
            baseMs: 750,
            maxMs: 60_000,
            retryAfterMs: Number.isFinite(error.retryAfterMs) ? error.retryAfterMs : null,
            jitterMs: 350,
          });
          retryInfo.push({
            operation,
            attempt: attempt + 1,
            delayMs,
            at: new Date().toISOString(),
          });
          process.stdout.write(
            `Shopify social request transient failure; retrying in ${Math.ceil(delayMs / 1000)}s (${operation})\n`,
          );
          await sleep(delayMs);
        }
      }
      throw new Error(`${operation} exhausted retries.`);
    });
  }

  return {
    run,
    endpoint,
    storeDomain: config.storeDomain,
    apiVersion: config.shopifyApiVersion,
    authMode: useCli ? "shopify-cli" : "admin-token",
  };
}

async function fetchConnection(
  client,
  query,
  connectionName,
  { pageSize = 100, retryInfo = [] } = {},
) {
  const nodes = [];
  let after = null;
  let page = 0;
  while (true) {
    page += 1;
    const data = await client.run(
      query,
      { first: pageSize, after },
      {
        operation: `social ${connectionName} page ${page}`,
        retryInfo,
      },
    );
    const connection = data?.[connectionName];
    if (!connection) throw new Error(`Shopify returned no ${connectionName} connection.`);
    nodes.push(...asArray(connection.nodes));
    if (!connection.pageInfo?.hasNextPage) break;
    if (!connection.pageInfo?.endCursor)
      throw new Error(`Shopify ${connectionName} pagination has no end cursor.`);
    after = connection.pageInfo.endCursor;
  }
  return nodes;
}

export async function fetchSocialCatalog(client, { retryInfo = [] } = {}) {
  const [products, collections] = await Promise.all([
    fetchConnection(client, SOCIAL_PRODUCTS_QUERY, "products", { retryInfo }),
    fetchConnection(client, SOCIAL_COLLECTIONS_QUERY, "collections", { retryInfo }),
  ]);
  return {
    products: products.filter(
      (product) =>
        normalizeText(product?.status).toUpperCase() === "ACTIVE" && Boolean(product?.publishedAt),
    ),
    collections: collections.filter(
      (collection) => asArray(collection?.products?.nodes).length > 0,
    ),
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchProductForOffer(client, productId, { retryInfo = [] } = {}) {
  const data = await client.run(
    SOCIAL_PRODUCT_OFFER_QUERY,
    { id: productId },
    {
      operation: `social offer product ${productId}`,
      retryInfo,
    },
  );
  return data?.node || null;
}

export async function fetchCollectionForOffer(client, collectionId, { retryInfo = [] } = {}) {
  const data = await client.run(
    SOCIAL_COLLECTION_OFFER_QUERY,
    { id: collectionId },
    {
      operation: `social offer collection ${collectionId}`,
      retryInfo,
    },
  );
  return data?.node || null;
}

export async function fetchStorewideProductsForOffer(client, { retryInfo = [] } = {}) {
  const products = await fetchConnection(client, SOCIAL_STOREWIDE_OFFER_QUERY, "products", {
    pageSize: 50,
    retryInfo,
  });
  return products.filter(
    (product) =>
      normalizeText(product?.status).toUpperCase() === "ACTIVE" &&
      Boolean(product?.publishedAt) &&
      (product?.totalInventory === null || Number(product?.totalInventory) > 0),
  );
}

export function assessDiscountMargin(products, config) {
  const items = asArray(products);
  if (!items.length) return { eligible: false, reason: "no-target-products" };
  const variants = items.flatMap((product) =>
    asArray(product?.variants?.nodes).map((variant) => ({ product, variant })),
  );
  if (!variants.length) return { eligible: false, reason: "no-priced-variants" };
  if (items.some((product) => product?.variants?.pageInfo?.hasNextPage)) {
    return { eligible: false, reason: "variant-cost-data-incomplete" };
  }
  const normalized = variants.map(({ product, variant }) => ({
    productId: product?.id || null,
    variantId: variant?.id || null,
    price: normalizeMoney(variant?.price),
    cost: normalizeMoney(variant?.inventoryItem?.unitCost?.amount),
    currencyCode: normalizeText(variant?.inventoryItem?.unitCost?.currencyCode).toUpperCase(),
  }));
  if (
    normalized.some(
      (entry) => entry.price === null || entry.price <= 0 || entry.cost === null || entry.cost < 0,
    )
  ) {
    return { eligible: false, reason: "missing-or-invalid-unit-cost" };
  }
  if (normalized.some((entry) => entry.currencyCode && entry.currencyCode !== "USD")) {
    return { eligible: false, reason: "non-usd-unit-cost" };
  }
  const candidates = [...new Set([config.maxDiscountPercent, config.defaultDiscountPercent])]
    .filter((percent) => percent > 0 && percent <= 15)
    .sort((left, right) => right - left);
  for (const percent of candidates) {
    const contributions = normalized.map(
      (entry) => entry.price * (1 - percent / 100) - entry.cost - config.overheadUsd,
    );
    const lowestContribution = Math.min(...contributions);
    if (lowestContribution >= config.minimumContributionUsd) {
      return {
        eligible: true,
        percent,
        lowestContribution: Number(lowestContribution.toFixed(2)),
        variantCount: normalized.length,
        reason: "margin-gate-passed",
      };
    }
  }
  return {
    eligible: false,
    reason: "margin-floor-failed",
    lowestContribution: Number(
      Math.min(
        ...candidates.flatMap((percent) =>
          normalized.map(
            (entry) => entry.price * (1 - percent / 100) - entry.cost - config.overheadUsd,
          ),
        ),
      ).toFixed(2),
    ),
    variantCount: normalized.length,
  };
}

export function buildDiscountInput({ code, title, percent, startsAt, endsAt, target }) {
  const items =
    target?.type === "all"
      ? { all: true }
      : target?.type === "collection"
        ? { collections: { add: [target.id] } }
        : { products: { productsToAdd: [target.id] } };
  return {
    title,
    code,
    startsAt,
    endsAt,
    context: { all: true },
    appliesOncePerCustomer: true,
    usageLimit: null,
    combinesWith: {
      orderDiscounts: false,
      productDiscounts: false,
      shippingDiscounts: false,
    },
    customerGets: {
      value: { percentage: percent / 100 },
      items,
    },
  };
}

export async function createDiscount(client, input, { retryInfo = [] } = {}) {
  const data = await client.run(
    SOCIAL_DISCOUNT_CREATE_MUTATION,
    { basicCodeDiscount: input },
    {
      operation: `social discount create ${input.code}`,
      retryInfo,
      allowMutation: true,
    },
  );
  const payload = data?.discountCodeBasicCreate;
  const userErrors = asArray(payload?.userErrors);
  if (userErrors.length) {
    throw new Error(
      `Shopify discount creation failed: ${userErrors.map((error) => normalizeText(error?.message)).join(" | ")}`,
    );
  }
  const id = normalizeText(payload?.codeDiscountNode?.id);
  if (!id) throw new Error("Shopify discount creation returned no discount ID.");
  return { id };
}

export async function updateDiscount(client, id, input, { retryInfo = [] } = {}) {
  const data = await client.run(
    SOCIAL_DISCOUNT_UPDATE_MUTATION,
    { id, basicCodeDiscount: input },
    {
      operation: `social discount update ${input.code}`,
      retryInfo,
      allowMutation: true,
    },
  );
  const payload = data?.discountCodeBasicUpdate;
  const userErrors = asArray(payload?.userErrors);
  if (userErrors.length) {
    throw new Error(
      `Shopify discount update failed: ${userErrors.map((error) => normalizeText(error?.message)).join(" | ")}`,
    );
  }
  const updatedId = normalizeText(payload?.codeDiscountNode?.id);
  if (!updatedId) throw new Error("Shopify discount update returned no discount ID.");
  return { id: updatedId };
}

export async function readDiscount(client, id, { retryInfo = [] } = {}) {
  const data = await client.run(
    SOCIAL_DISCOUNT_READ_QUERY,
    { id },
    {
      operation: `social discount readback ${id}`,
      retryInfo,
    },
  );
  return data?.node?.codeDiscount || null;
}

export async function findDiscountByCode(client, code, { retryInfo = [] } = {}) {
  const normalizedCode = normalizeText(code);
  if (!normalizedCode) return null;
  const data = await client.run(
    SOCIAL_DISCOUNT_BY_CODE_QUERY,
    { first: 10, query: `code:${normalizedCode}` },
    {
      operation: `social discount idempotency lookup ${normalizedCode}`,
      retryInfo,
    },
  );
  const match = asArray(data?.discountNodes?.nodes).find((node) =>
    asArray(node?.discount?.codes?.nodes).some(
      (entry) => normalizeText(entry?.code) === normalizedCode,
    ),
  );
  return normalizeText(match?.id) || null;
}

export function verifyDiscountReadback(discount, { input, target, percent }) {
  if (!discount) throw new Error("Shopify discount readback returned no discount.");
  const codes = asArray(discount?.codes?.nodes).map((entry) => normalizeText(entry?.code));
  if (!codes.includes(input.code))
    throw new Error("Shopify discount readback code does not match the generated code.");
  if (!/^ACTIVE$|^SCHEDULED$/i.test(normalizeText(discount.status)))
    throw new Error(
      `Shopify discount status is not active or scheduled: ${discount.status || "unknown"}.`,
    );
  if (discount.appliesOncePerCustomer !== true)
    throw new Error("Shopify discount readback is not limited to one use per customer.");
  if (
    !discount.combinesWith ||
    discount.combinesWith.orderDiscounts !== false ||
    discount.combinesWith.productDiscounts !== false ||
    discount.combinesWith.shippingDiscounts !== false
  ) {
    throw new Error("Shopify discount readback allows stacking with another discount.");
  }
  if (
    !input.startsAt ||
    !discount.startsAt ||
    Date.parse(discount.startsAt) !== Date.parse(input.startsAt)
  ) {
    throw new Error("Shopify discount readback start date does not match the approved offer.");
  }
  if (
    !input.endsAt ||
    !discount.endsAt ||
    Date.parse(discount.endsAt) !== Date.parse(input.endsAt)
  ) {
    throw new Error("Shopify discount readback end date does not match the approved offer.");
  }
  const actualPercent = Number(discount?.customerGets?.value?.percentage);
  if (!Number.isFinite(actualPercent) || Math.abs(actualPercent - percent / 100) > 0.0001) {
    throw new Error("Shopify discount readback percentage does not match the approved offer.");
  }
  const productIds = asArray(discount?.customerGets?.items?.products?.nodes)
    .map((entry) => entry?.id)
    .filter(Boolean);
  const collectionIds = asArray(discount?.customerGets?.items?.collections?.nodes)
    .map((entry) => entry?.id)
    .filter(Boolean);
  if (target?.type === "all" && discount?.customerGets?.items?.allItems !== true) {
    throw new Error("Shopify discount readback is not storewide.");
  }
  const targetIds = target?.type === "collection" ? collectionIds : productIds;
  if (target?.type === "all") {
    return {
      code: input.code,
      status: discount.status,
      percent,
      targetId: "all",
      targetType: "all",
    };
  }
  if (!targetIds.includes(target.id))
    throw new Error("Shopify discount readback target does not match the promoted item.");
  return {
    code: input.code,
    status: discount.status,
    percent,
    targetId: target.id,
    targetType: target.type,
  };
}
