#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import {
  PRODUCT_METAFIELD_DEFINITIONS,
  getProductMetafieldDefinitionId,
  getStandardMetafieldTemplateGid,
  isCustomProductMetafieldDefinition,
  isStandardProductMetafieldDefinition,
} from "../src/lib/shopify-product-metafield-definitions.js";
import {
  COLLECTION_MARKETING_METAFIELD_DEFINITIONS,
  SHOP_MARKETING_METAFIELD_DEFINITIONS,
} from "../src/lib/shopify-marketing-metafield-definitions.js";

const baseUrl = process.env.SALT_SHOP_URL;
if (!baseUrl) throw new Error("SALT_SHOP_URL is required to configure Future Light Store metafields.");
const adminApiVersion = process.env.SHOPIFY_ADMIN_API_VERSION || "2026-07";
const shopifyStoreDomain = new URL(baseUrl).hostname;
const shopifyCliApiVersion = process.env.SHOPIFY_CLI_API_VERSION || adminApiVersion;
const shopifyCliAgentInfo =
  process.env.SHOPIFY_CLI_AGENT_INFO || "n:future-light-store|v:1|p:openai";
const shopifyCliAgentIds =
  process.env.SHOPIFY_CLI_AGENT_IDS ||
  `s:future-light-store|r:${process.pid}|i:future-light-store`;
const requestSpacingMs = Number(process.env.SALT_SHOPIFY_REQUEST_DELAY_MS ?? 250);
const maxRequestAttempts = Number(process.env.SALT_SHOPIFY_MAX_REQUEST_ATTEMPTS ?? 8);
const maxRetryDelayMs = Number(process.env.SALT_SHOPIFY_MAX_RETRY_DELAY_MS ?? 60_000);
const adminRetryBaseDelayMs = Number(process.env.SALT_SHOPIFY_ADMIN_RETRY_BASE_DELAY_MS ?? 1500);
const execFileAsync = promisify(execFile);
const futureLightProfile = process.env.FUTURE_LIGHT_STORE === "1" ||
  String(process.env.SALT_RELEASE_NAME || "").toLowerCase().includes("future light");
const LEGACY_PRODUCT_METAFIELD_DEFINITIONS_TO_DELETE = [
  {
    ownerType: "PRODUCT",
    namespace: "google",
    key: "custom_product",
    name: "Google: Custom Product",
    deleteAllAssociatedMetafields: true,
  },
];

let requestQueue = Promise.resolve();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeCliRetryDelayMs(attempt) {
  const jitterMs = Math.floor(Math.random() * 500);
  return Math.min(maxRetryDelayMs, adminRetryBaseDelayMs * 2 ** attempt + jitterMs);
}

function isRetryableShopifyCliError(error) {
  const text = [
    error?.message,
    error?.stderr,
    error?.stdout,
    error?.code,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  return [
    "429",
    "too many requests",
    "retry-after",
    "temporarily unavailable",
    "service unavailable",
    "gateway timeout",
    "timeout",
    "eai_again",
    "etimedout",
  ].some((needle) => text.includes(needle));
}

function isDeferredFutureLightStandardMetafieldError(error) {
  return futureLightProfile && /must be one of.*public_read_write|public_read_write.*must be one of|access controls?.*not permitted|access.*not permitted|access denied for metafielddefinitioncreate|required access: api client/i.test(
    String(error?.message || error),
  );
}

async function runSerializedRequest(task) {
  let releaseQueue;
  const currentRequest = new Promise((resolve) => {
    releaseQueue = resolve;
  });

  const previousRequest = requestQueue;
  requestQueue = currentRequest;
  await previousRequest;

  try {
    const result = await task();
    if (requestSpacingMs > 0) {
      await sleep(requestSpacingMs);
    }
    return result;
  } finally {
    releaseQueue?.();
  }
}

async function fetchAdminGraphQL(
  query,
  variables = {},
  { attempt = 0, maxAttempts = maxRequestAttempts, allowMutations = false } = {},
) {
  const serializedVariables = variables && Object.keys(variables).length ? variables : null;

  const runCliOperation = async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "salt-shopify-cli-"));
    const queryFile = join(tempDir, "operation.graphql");
    const outputFile = join(tempDir, "result.json");
    const variableFile = join(tempDir, "variables.json");

    try {
      await writeFile(queryFile, query, "utf8");
      if (serializedVariables) {
        await writeFile(variableFile, JSON.stringify(serializedVariables, null, 2), "utf8");
      }

      const args = [
        "store",
        "execute",
        "--store",
        shopifyStoreDomain,
        "--version",
        shopifyCliApiVersion,
        "--query-file",
        queryFile,
        "--output-file",
        outputFile,
        "--json",
      ];

      if (serializedVariables) {
        args.push("--variable-file", variableFile);
      }

      if (allowMutations) {
        args.push("--allow-mutations");
      }

      await runSerializedRequest(() =>
        execFileAsync("shopify", args, {
          env: {
            ...process.env,
            SHOPIFY_CLI_AGENT_INFO: shopifyCliAgentInfo,
            SHOPIFY_CLI_AGENT_IDS: shopifyCliAgentIds,
          },
          maxBuffer: 10 * 1024 * 1024,
        }),
      );

      const rawOutput = await readFile(outputFile, "utf8");
      const parsedOutput = JSON.parse(rawOutput);

      if (Array.isArray(parsedOutput.errors) && parsedOutput.errors.length) {
        const message = parsedOutput.errors.map((error) => error.message || "Unknown GraphQL error").join(" | ");
        throw new Error(`Shopify CLI GraphQL errors for ${shopifyStoreDomain}: ${message}`);
      }

      if (parsedOutput && typeof parsedOutput === "object" && "data" in parsedOutput && parsedOutput.data) {
        return parsedOutput.data;
      }

      return parsedOutput || {};
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  };

  try {
    return await runCliOperation();
  } catch (error) {
    if (attempt < maxAttempts - 1 && isRetryableShopifyCliError(error)) {
      const delayMs = computeCliRetryDelayMs(attempt);
      process.stdout.write(
        `Shopify CLI GraphQL request failed on ${shopifyStoreDomain}; retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt + 1}/${maxAttempts - 1})\n`,
      );
      await sleep(delayMs);
      return fetchAdminGraphQL(query, variables, {
        attempt: attempt + 1,
        maxAttempts,
        allowMutations,
      });
    }

    const details = [error?.message, error?.stderr, error?.stdout].filter(Boolean).join(" | ");
    throw new Error(`Shopify CLI GraphQL request failed for ${shopifyStoreDomain}: ${details || "Unknown error"}`);
  }
}

async function fetchExistingProductMetafieldDefinitions() {
  const records = new Map();
  for (const ownerType of ["PRODUCT", "COLLECTION", "SHOP"]) {
    const ownerRecords = await fetchExistingMetafieldDefinitions(ownerType);
    for (const [key, value] of ownerRecords.entries()) {
      records.set(key, value);
    }
  }

  return records;
}

async function fetchExistingMetafieldDefinitions(ownerType) {
  const records = new Map();
  let after = null;
  const query = /* GraphQL */ `
    query ProductMetafieldDefinitions($first: Int!, $after: String, $ownerType: MetafieldOwnerType!) {
      metafieldDefinitions(first: $first, ownerType: $ownerType, after: $after) {
        edges {
          node {
            id
            namespace
            key
            name
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  while (true) {
    const payload = await fetchAdminGraphQL(query, {
      first: 250,
      after,
      ownerType,
    });

    const connection = payload.metafieldDefinitions;
    const edges = Array.isArray(connection?.edges) ? connection.edges : [];

    for (const edge of edges) {
      const node = edge?.node;
      if (!node?.namespace || !node?.key) {
        continue;
      }

      records.set(`${node.namespace}.${node.key}`, node);
    }

    if (!connection?.pageInfo?.hasNextPage) {
      break;
    }

    after = connection.pageInfo.endCursor || null;
  }

  return records;
}

function logDefinition(definition, action) {
  process.stdout.write(`${action} ${definition.name} (${getProductMetafieldDefinitionId(definition)})\n`);
}

async function enableStandardProductMetafieldDefinition(definition) {
  const mutation = /* GraphQL */ `
    mutation EnableStandardProductMetafieldDefinition(
      $id: ID!
      $ownerType: MetafieldOwnerType!
      $access: StandardMetafieldDefinitionAccessInput!
      $pin: Boolean
    ) {
      standardMetafieldDefinitionEnable(
        id: $id
        ownerType: $ownerType
        access: $access
        pin: $pin
      ) {
        createdDefinition {
          id
          namespace
          key
          name
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  let payload;
  try {
    payload = await fetchAdminGraphQL(mutation, {
      id: getStandardMetafieldTemplateGid(definition.standardTemplateId),
      ownerType: definition.ownerType,
      access: definition.access,
      pin: definition.pin ?? false,
    }, { allowMutations: true });
  } catch (error) {
    if (isDeferredFutureLightStandardMetafieldError(error)) {
      process.stdout.write(`Deferred standard metafield ${definition.name}: Shopify restricts this template to public_read_write access.\n`);
      return null;
    }
    throw error;
  }

  const result = payload.standardMetafieldDefinitionEnable;
  if (Array.isArray(result?.userErrors) && result.userErrors.length) {
    const message = result.userErrors
      .map((error) => `${error.field?.join(".") || "definition"}: ${error.message}`)
      .join(" | ");
    if (isDeferredFutureLightStandardMetafieldError(new Error(message))) {
      process.stdout.write(`Deferred standard metafield ${definition.name}: Shopify restricts this template to public_read_write access.\n`);
      return null;
    }
    throw new Error(`Failed to enable standard metafield definition "${definition.name}": ${message}`);
  }

  return result?.createdDefinition || null;
}

async function createCustomProductMetafieldDefinition(definition) {
  const mutation = /* GraphQL */ `
    mutation CreateProductMetafieldDefinition($definition: MetafieldDefinitionInput!) {
      metafieldDefinitionCreate(definition: $definition) {
        createdDefinition {
          id
          namespace
          key
          name
        }
        userErrors {
          field
          message
          code
        }
      }
    }
  `;

  const access = definition.access
    ? {
        ...definition.access,
        ...(definition.access.admin === "MERCHANT_READ_WRITE" ? { admin: undefined } : {}),
      }
    : undefined;

  if (access?.admin === undefined) {
    delete access.admin;
  }

  let payload;
  try {
    payload = await fetchAdminGraphQL(mutation, {
      definition: {
        name: definition.name,
        namespace: definition.namespace,
        key: definition.key,
        description: definition.description,
        type: definition.type,
        ownerType: definition.ownerType,
        ...(access ? { access } : {}),
        pin: definition.pin ?? false,
        ...(Array.isArray(definition.validations) && definition.validations.length
          ? { validations: definition.validations }
          : {}),
      },
    }, { allowMutations: true });
  } catch (error) {
    if (isDeferredFutureLightStandardMetafieldError(error)) {
      process.stdout.write(`Deferred custom metafield ${definition.name}: Shopify CLI lacks the required definition scope.\n`);
      return null;
    }
    throw error;
  }

  const result = payload.metafieldDefinitionCreate;
  if (Array.isArray(result?.userErrors) && result.userErrors.length) {
    const message = result.userErrors
      .map((error) => `${error.field?.join(".") || "definition"}: ${error.message}`)
      .join(" | ");
    throw new Error(`Failed to create metafield definition "${definition.name}": ${message}`);
  }

  return result?.createdDefinition || null;
}

async function deleteLegacyProductMetafieldDefinition(definition) {
  const mutation = /* GraphQL */ `
    mutation DeleteProductMetafieldDefinition(
      $identifier: MetafieldDefinitionIdentifierInput!
      $deleteAllAssociatedMetafields: Boolean!
    ) {
      metafieldDefinitionDelete(
        identifier: $identifier
        deleteAllAssociatedMetafields: $deleteAllAssociatedMetafields
      ) {
        deletedDefinitionId
        userErrors {
          field
          message
          code
        }
      }
    }
  `;

  const payload = await fetchAdminGraphQL(mutation, {
    identifier: {
      ownerType: definition.ownerType,
      namespace: definition.namespace,
      key: definition.key,
    },
    deleteAllAssociatedMetafields: definition.deleteAllAssociatedMetafields ?? false,
  }, { allowMutations: true });

  const result = payload.metafieldDefinitionDelete;
  if (Array.isArray(result?.userErrors) && result.userErrors.length) {
    const message = result.userErrors
      .map((error) => `${error.field?.join(".") || "definition"}: ${error.message}`)
      .join(" | ");
    throw new Error(`Failed to delete metafield definition "${definition.name}": ${message}`);
  }

  return result?.deletedDefinitionId || null;
}

async function ensureProductMetafieldDefinitions() {
  const allDefinitions = [
    ...PRODUCT_METAFIELD_DEFINITIONS,
    ...COLLECTION_MARKETING_METAFIELD_DEFINITIONS,
    ...SHOP_MARKETING_METAFIELD_DEFINITIONS,
  ];

  process.stdout.write(
    `Ensuring Shopify product, collection, and shop metafield definitions on ${shopifyStoreDomain} via Shopify CLI\n`,
  );
  const existingDefinitions = await fetchExistingProductMetafieldDefinitions();

  let createdCount = 0;
  let existingCount = 0;

  for (const definition of allDefinitions) {
    const definitionId = getProductMetafieldDefinitionId(definition);
    const existing = existingDefinitions.get(definitionId);

    if (existing) {
      existingCount += 1;
      logDefinition(definition, "Exists");
      continue;
    }

    if (isStandardProductMetafieldDefinition(definition)) {
      const created = await enableStandardProductMetafieldDefinition(definition);
      if (created) {
        createdCount += 1;
        logDefinition(definition, "Created standard");
      }
      continue;
    }

    if (isCustomProductMetafieldDefinition(definition)) {
      const created = await createCustomProductMetafieldDefinition(definition);
      if (created) {
        createdCount += 1;
        logDefinition(definition, "Created custom");
      }
      continue;
    }

    throw new Error(`Unsupported metafield definition kind for "${definition.name}"`);
  }

  let deletedCount = 0;
  for (const definition of LEGACY_PRODUCT_METAFIELD_DEFINITIONS_TO_DELETE) {
    const definitionId = getProductMetafieldDefinitionId(definition);
    const existing = existingDefinitions.get(definitionId);

    if (!existing) {
      process.stdout.write(`Legacy definition already absent ${definition.name} (${definitionId})\n`);
      continue;
    }

    await deleteLegacyProductMetafieldDefinition(definition);
    deletedCount += 1;
    logDefinition(definition, "Deleted legacy");
  }

  process.stdout.write(
    `Metafield definitions ensured: ${existingCount} existing, ${createdCount} created, ${deletedCount} deleted.\n`,
  );
}

async function main() {
  await ensureProductMetafieldDefinitions();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
