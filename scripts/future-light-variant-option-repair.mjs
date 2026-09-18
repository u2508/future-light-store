#!/usr/bin/env node

import { execFile } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import { FUTURE_LIGHT_SHOP_DOMAIN } from "./lib/product-image-health.mjs";

const execFileAsync = promisify(execFile);
const rootDir = resolve(import.meta.dirname, "..");
const outputDir = resolve(rootDir, "output", "future-light-variant-options");
const statePath = resolve(outputDir, "state.json");
const manifestPath = resolve(outputDir, "manifest.json");
const apiVersion = process.env.FUTURE_LIGHT_SHOPIFY_API_VERSION || process.env.SHOPIFY_ADMIN_API_VERSION || "2026-07";
const cliBinary = process.env.SHOPIFY_CLI_BINARY || "shopify";
const pageSize = 250;

const PRODUCT_PAGE_QUERY = /* GraphQL */ `
  query FutureLightVariantOptionAudit($after: String) {
    products(first: ${pageSize}, after: $after, query: "status:active") {
      nodes {
        id
        handle
        title
        options(first: 10) {
          id
          name
          position
          optionValues { id name }
        }
        variants(first: 250) {
          nodes {
            id
            title
            sku
            selectedOptions { name value }
          }
          pageInfo { hasNextPage }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const SCHEMA_QUERY = /* GraphQL */ `
  query FutureLightVariantOptionSchema {
    mutationFields: __schema {
      mutationType {
        fields {
          name
          args { name type { kind name ofType { kind name ofType { kind name } } } }
        }
      }
    }
    bulk: __type(name: "ProductVariantsBulkInput") {
      name
      inputFields { name type { kind name ofType { kind name ofType { kind name } } } }
    }
    optionValue: __type(name: "VariantOptionValueInput") {
      name
      inputFields { name type { kind name ofType { kind name ofType { kind name } } } }
    }
    optionUpdate: __type(name: "ProductOptionUpdateInput") {
      name
      inputFields { name type { kind name ofType { kind name ofType { kind name } } } }
    }
    optionInput: __type(name: "ProductOptionInput") {
      name
      inputFields { name type { kind name ofType { kind name ofType { kind name } } } }
    }
    optionCreateInput: __type(name: "ProductOptionsCreateInput") {
      name
      inputFields { name type { kind name ofType { kind name ofType { kind name } } } }
    }
    optionMutationInput: __type(name: "OptionUpdateInput") {
      name
      inputFields { name type { kind name ofType { kind name ofType { kind name } } } }
    }
    optionValueUpdate: __type(name: "OptionValueUpdateInput") {
      name
      inputFields { name type { kind name ofType { kind name ofType { kind name } } } }
    }
    optionValueCreate: __type(name: "OptionValueCreateInput") {
      name
      inputFields { name type { kind name ofType { kind name ofType { kind name } } } }
    }
  }
`;

const MEDIA_EVIDENCE_QUERY = /* GraphQL */ `
  query FutureLightVariantVisualEvidence($id: ID!) {
    node(id: $id) {
      ... on Product {
        id
        handle
        title
        media(first: 50) {
          nodes {
            __typename
            id
            alt
            ... on MediaImage { image { url width height } }
          }
        }
        variants(first: 250) {
          nodes {
            id
            title
            sku
            selectedOptions { name value }
            media(first: 1) {
              nodes {
                __typename
                id
                ... on MediaImage { image { url width height } }
              }
            }
          }
          pageInfo { hasNextPage }
        }
      }
    }
  }
`;

function parseArgs(argv = process.argv) {
  return {
    apply: argv.includes("--apply"),
    resume: argv.includes("--resume"),
    schema: argv.includes("--schema"),
    media: argv.includes("--media"),
    dryRun: argv.includes("--dry-run") || !argv.includes("--apply"),
  };
}

function parseEnvValue(value) {
  const trimmed = String(value || "").trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }
  return trimmed.replace(/\s+#.*$/, "");
}

async function loadFutureEnv() {
  for (const file of [resolve(rootDir, ".env.local"), resolve(rootDir, ".env.release.local")]) {
    let raw;
    try { raw = await readFile(file, "utf8"); }
    catch (error) { if (error?.code === "ENOENT") continue; throw error; }
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      const key = match[1];
      if (key.startsWith("SALT_")) continue;
      if (key.startsWith("FUTURE_LIGHT_") || key.startsWith("SHOPIFY_")) {
        if (process.env[key] === undefined) process.env[key] = parseEnvValue(match[2]);
      }
    }
  }
}

function safeChildEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^SALT_/i.test(key)));
}

function parseGraphqlOutput(raw, operation) {
  const text = String(raw || "").trim();
  const jsonStart = text.indexOf("{");
  if (jsonStart < 0) throw new Error(`${operation}: Shopify returned no JSON`);
  const payload = JSON.parse(text.slice(jsonStart));
  const errors = payload?.errors || payload?.data?.errors || [];
  if (errors.length) throw new Error(`${operation}: ${errors.map((entry) => entry.message || "GraphQL error").join(" | ")}`);
  return payload?.data || payload;
}

async function runGraphql(query, variables, { mutation = false, operation = "Shopify request" } = {}) {
  const token = String(process.env.FUTURE_LIGHT_SHOPIFY_ADMIN_ACCESS_TOKEN || "").trim();
  const url = `https://${FUTURE_LIGHT_SHOP_DOMAIN}/admin/api/${apiVersion}/graphql.json`;
  if (token) {
    const response = await fetch(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(180_000),
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`${operation}: Admin GraphQL HTTP ${response.status}: ${raw.slice(0, 500)}`);
    return parseGraphqlOutput(raw, operation);
  }
  const tempDir = await mkdtemp(join(tmpdir(), "future-light-variant-options-"));
  const queryPath = join(tempDir, "operation.graphql");
  const variablesPath = join(tempDir, "variables.json");
  const outputPath = join(tempDir, "result.json");
  try {
    await Promise.all([
      writeFile(queryPath, query, "utf8"),
      writeFile(variablesPath, JSON.stringify(variables || {}), "utf8"),
    ]);
    const args = ["store", "execute", "--store", FUTURE_LIGHT_SHOP_DOMAIN, "--version", apiVersion, "--query-file", queryPath, "--variable-file", variablesPath, "--output-file", outputPath, "--json"];
    if (mutation) args.push("--allow-mutations");
    const result = await execFileAsync(cliBinary, args, {
      cwd: rootDir,
      env: { ...safeChildEnv(), CI: "1", SHOPIFY_CLI_DISABLE_ANALYTICS: "1" },
      timeout: 180_000,
      maxBuffer: 20 * 1024 * 1024,
    });
    let raw = result.stdout || "";
    try { raw = await readFile(outputPath, "utf8"); } catch { /* stdout fallback */ }
    return parseGraphqlOutput(raw, operation);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function writeJson(path, value) {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(path, fallback = null) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return fallback; throw error; }
}

function normalize(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

const customerFacingLabelOptions = new Set([
  "color",
  "pattern",
  "style",
  "finish",
  "design",
  "material",
]);

function normalizedOptionName(value) {
  return normalize(value).toLowerCase().replace(/\s+/g, " ");
}

function optionValueNeedsRepair(value, optionName = "") {
  const text = normalize(value);
  const normalizedName = normalizedOptionName(optionName);
  return Boolean(text && (
    /^(?:china(?: mainland)?|mainland china)$/i.test(text)
    || /^(?:image\s*color|color\s*image)[-_\s]*\d+/i.test(text)
    || /^(?:tk|sku|item|color)[-_]?\d{4,}$/i.test(text)
    || /^\d+:[^;]+(?:;\d+:[^;]+)*$/.test(text)
    || (customerFacingLabelOptions.has(normalizedName) && /^\d{1,4}$/.test(text))
  ));
}

async function fetchProducts() {
  const products = [];
  let after = null;
  let page = 0;
  while (true) {
    const data = await runGraphql(PRODUCT_PAGE_QUERY, { after }, { operation: `read active product option page ${page + 1}` });
    const connection = data?.products;
    if (!connection) throw new Error("Shopify returned no active product option connection");
    products.push(...(connection.nodes || []));
    page += 1;
    process.stdout.write(`Fetched active product option page ${page}: ${(connection.nodes || []).length} (${products.length} total)\n`);
    if (!connection.pageInfo?.hasNextPage) break;
    after = connection.pageInfo.endCursor;
    if (!after) throw new Error("Shopify returned a next page without a cursor");
  }
  return products;
}

function auditProducts(products) {
  const entries = [];
  let affectedProducts = 0;
  let affectedVariants = 0;
  let affectedValues = 0;
  for (const product of products) {
    const issues = [];
    const declaredOptionNames = new Set((product.options || []).map((option) => normalizedOptionName(option.name)));
    for (const option of product.options || []) {
      const bad = (option.optionValues || []).filter((value) => optionValueNeedsRepair(value.name, option.name));
      if (bad.length) issues.push({ optionId: option.id, optionName: option.name, values: bad.map((value) => ({ id: value.id, name: value.name })) });
    }
    const variantOnlyOptions = new Map();
    const variantIssues = [];
    for (const variant of product.variants?.nodes || []) {
      const flaggedOptions = [];
      for (const selected of variant.selectedOptions || []) {
        const optionName = normalize(selected.name);
        const value = normalize(selected.value);
        const reasons = [];
        if (!declaredOptionNames.has(normalizedOptionName(optionName))) {
          reasons.push("selected variant option is absent from Product.options");
        }
        if (optionValueNeedsRepair(value, optionName)) reasons.push("raw or supplier option label");
        if (!reasons.length) continue;
        flaggedOptions.push({ name: optionName, value });
        const key = `${normalizedOptionName(optionName)}\u0000${value.toLowerCase()}`;
        const prior = variantOnlyOptions.get(key) || { name: optionName, value, reasons: new Set(), variantIds: [] };
        for (const reason of reasons) prior.reasons.add(reason);
        prior.variantIds.push(variant.id);
        variantOnlyOptions.set(key, prior);
      }
      if (flaggedOptions.length) {
        variantIssues.push({ id: variant.id, title: variant.title, sku: variant.sku, selectedOptions: variant.selectedOptions });
      }
    }
    const variantOptionIssues = [...variantOnlyOptions.values()].map((issue) => ({
      name: issue.name,
      value: issue.value,
      reasons: [...issue.reasons],
      variantIds: [...new Set(issue.variantIds)],
    }));
    if (issues.length || variantIssues.length || variantOptionIssues.length) {
      affectedProducts += 1;
      affectedValues += issues.reduce((sum, issue) => sum + issue.values.length, 0);
      affectedVariants += variantIssues.length;
      entries.push({
        productId: product.id,
        handle: product.handle,
        title: product.title,
        options: issues.map((issue) => ({
          ...issue,
          allValues: (product.options || []).find((option) => option.id === issue.optionId)?.optionValues?.map((value) => ({ id: value.id, name: value.name })) || [],
        })),
        variants: variantIssues,
        variantOptionIssues,
      });
    }
  }
  return {
    entries,
    summary: {
      products: products.length,
      affectedProducts,
      affectedValues,
      affectedVariants,
      affectedVariantOnlyOptionValues: entries.reduce((sum, entry) => sum + entry.variantOptionIssues.length, 0),
    },
  };
}

async function fetchMediaEvidence(entries) {
  const concurrency = Math.max(1, Math.min(8, Number(process.env.FUTURE_LIGHT_VARIANT_MEDIA_CONCURRENCY || 6)));
  const enriched = new Array(entries.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= entries.length) return;
      const entry = entries[index];
      const data = await runGraphql(MEDIA_EVIDENCE_QUERY, { id: entry.productId }, { operation: `read visual evidence ${entry.handle}` });
      const product = data?.node;
      if (!product) throw new Error(`Shopify returned no visual evidence product for ${entry.handle}`);
      enriched[index] = {
        ...entry,
        media: (product.media?.nodes || []).map((media) => ({
          id: media.id,
          alt: media.alt || "",
          url: media.image?.url || "",
          width: media.image?.width || null,
          height: media.image?.height || null,
        })),
        variantMedia: Object.fromEntries((product.variants?.nodes || []).map((variant) => [
          variant.id,
          {
            title: variant.title,
            sku: variant.sku,
            selectedOptions: variant.selectedOptions,
            media: (variant.media?.nodes || []).map((media) => ({
              id: media.id,
              url: media.image?.url || "",
              width: media.image?.width || null,
              height: media.image?.height || null,
            })),
          },
        ])),
      };
      process.stdout.write(`Fetched visual evidence ${index + 1}/${entries.length}: ${entry.handle}\n`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, () => worker()));
  return enriched;
}

async function main() {
  const args = parseArgs();
  await loadFutureEnv();
  if (args.schema) {
    const schema = await runGraphql(SCHEMA_QUERY, {}, { operation: "read Shopify variant option mutation schema" });
    await writeJson(resolve(outputDir, "schema.json"), { generatedAt: new Date().toISOString(), apiVersion, schema });
    process.stdout.write(`Saved Shopify variant option schema to ${resolve(outputDir, "schema.json")}\n`);
    return;
  }
  const products = await fetchProducts();
  const audit = auditProducts(products);
  const evidenceEntries = args.media ? await fetchMediaEvidence(audit.entries) : audit.entries;
  const manifest = {
    generatedAt: new Date().toISOString(),
    targetStoreDomain: FUTURE_LIGHT_SHOP_DOMAIN,
    apiVersion,
    status: args.dryRun ? "dry-run" : "audit-only",
    policy: "flag customer-facing option codes, variant-only option values, and supplier-origin values; preserve SKU/internal codes",
    summary: audit.summary,
    entries: evidenceEntries,
  };
  await writeJson(manifestPath, manifest);
  await writeJson(statePath, { schemaVersion: "2026-09-15.future-light-variant-options.1", status: manifest.status, summary: audit.summary, updatedAt: manifest.generatedAt });
  process.stdout.write(`Variant option audit: ${audit.summary.affectedProducts} product(s), ${audit.summary.affectedVariants} variant(s), ${audit.summary.affectedValues} option value(s) need review.\n`);
  if (args.apply) throw new Error("Safe audit complete; mutation contract and human label mapping must be explicitly verified before apply.");
}

main().catch((error) => { console.error(error); process.exit(1); });
