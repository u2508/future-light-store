#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { normalizeHandleValue, normalizePlainText } from "../src/lib/shopify-seo-batch.js";
import { readProductCatalogPayload } from "./product-catalog-files.mjs";
import { createRequestScheduler, envInteger, recommendedConcurrency } from "./lib/performance-runtime.mjs";

const execFileAsync = promisify(execFile);
const rootDir = resolve(import.meta.dirname, "..");
const defaultInputPath = resolve(rootDir, "public", "data", "products.json");
const defaultOutputPath = resolve(rootDir, "output", "shopify-variant-image-mapping-manifest.json");
const defaultHandlesPath = resolve(rootDir, "output", "shopify-seo-scope-handles.json");
const defaultMediaCachePath = resolve(rootDir, "output", "shopify-variant-image-live-media-cache.json");
const defaultCheckpointPath = resolve(rootDir, "output", "shopify-variant-image-mapping-checkpoint.json");
const shopBase = process.env.SALT_SHOP_URL;
if (!shopBase) throw new Error("SALT_SHOP_URL is required for Future Light Store variant-image mapping.");
const storeDomain = new URL(shopBase).hostname;
const apiVersion = process.env.SHOPIFY_ADMIN_API_VERSION || "2026-07";
const adminAccessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.SALT_SHOPIFY_ADMIN_ACCESS_TOKEN || "";
const adminGraphqlUrl = `${new URL(shopBase).origin}/admin/api/${apiVersion}/graphql.json`;
const cliBinary = process.env.SHOPIFY_CLI_BINARY || "shopify";
const requestDelayMs = Math.max(0, Number(process.env.SALT_SHOPIFY_REQUEST_DELAY_MS || 125));
const requestConcurrency = envInteger(
  "SALT_SHOPIFY_REQUEST_CONCURRENCY",
  recommendedConcurrency({ kind: "io", reserve: 2, max: 8 }),
  { min: 1, max: 8 },
);
const requestScheduler = createRequestScheduler({ concurrency: requestConcurrency, minIntervalMs: requestDelayMs });
const maxAttempts = Math.max(1, Number(process.env.SALT_SHOPIFY_MAX_REQUEST_ATTEMPTS || 5));
const maxBatchProducts = Math.max(1, Math.min(25, Number(process.env.SALT_VARIANT_IMAGE_BATCH_SIZE || 25)));
const applyConcurrency = envInteger("SALT_VARIANT_IMAGE_APPLY_CONCURRENCY", 3, { min: 1, max: 4 });
const fetchConcurrency = envInteger(
  "SALT_VARIANT_IMAGE_FETCH_CONCURRENCY",
  recommendedConcurrency({ kind: "io", reserve: 2, max: 8 }),
  { min: 1, max: 8 },
);
// Serial readback avoids false failures when Shopify throttles a large verification fan-out.
const verifyConcurrency = envInteger(
  "SALT_VARIANT_IMAGE_VERIFY_CONCURRENCY",
  recommendedConcurrency({ kind: "io", reserve: 2, max: 4 }),
  { min: 1, max: 4 },
);
const interBatchDelayMs = Math.max(0, Number(process.env.SALT_VARIANT_IMAGE_INTER_BATCH_DELAY_MS || 500));
const forceGuesses = process.env.SALT_VARIANT_IMAGE_FORCE_GUESSES !== "0";
const visionEnabled = process.env.SALT_VARIANT_IMAGE_VISION !== "0";
const visionConcurrency = envInteger("SALT_VARIANT_IMAGE_VISION_CONCURRENCY", 1, { min: 1, max: 8 });
const planConcurrency = envInteger(
  "SALT_VARIANT_IMAGE_PLAN_CONCURRENCY",
  recommendedConcurrency({ kind: "cpu", reserve: 1, max: 8 }),
  { min: 1, max: 8 },
);
const visionModel = process.env.SALT_VARIANT_IMAGE_VISION_MODEL || "gemma3:4b";
const ollamaUrl = (process.env.SALT_OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
const visionImageLimit = Math.max(2, Math.min(8, Number(process.env.SALT_VARIANT_IMAGE_VISION_IMAGE_LIMIT || 8)));
const visionImageWidth = Math.max(384, Math.min(1200, Number(process.env.SALT_VARIANT_IMAGE_VISION_IMAGE_WIDTH || 512)));
const visionImageAttempts = Math.max(1, Number(process.env.SALT_VARIANT_IMAGE_VISION_IMAGE_ATTEMPTS || 2));
const visionImageTimeoutMs = Math.max(10_000, Number(process.env.SALT_VARIANT_IMAGE_VISION_IMAGE_TIMEOUT_MS || 45_000));
const visionRequestAttempts = Math.max(1, Number(process.env.SALT_VARIANT_IMAGE_VISION_REQUEST_ATTEMPTS || 1));
const visionRequestTimeoutMs = Math.max(30_000, Number(process.env.SALT_VARIANT_IMAGE_VISION_REQUEST_TIMEOUT_MS || 90_000));
const visionOutputTokens = Math.max(256, Number(process.env.SALT_VARIANT_IMAGE_VISION_OUTPUT_TOKENS || 512));
const visionContextLength = Math.max(4096, Number(process.env.SALT_VARIANT_IMAGE_VISION_CONTEXT_LENGTH || 4096));
const visionCircuitFailureThreshold = Math.max(1, Number(process.env.SALT_VARIANT_IMAGE_VISION_CIRCUIT_FAILURE_THRESHOLD || 2));
const visionCircuitCooldownMs = Math.max(30_000, Number(process.env.SALT_VARIANT_IMAGE_VISION_CIRCUIT_COOLDOWN_MS || 300_000));
let visionConsecutiveFailures = 0;
let visionCircuitOpenUntil = 0;
const imageRankingCache = new WeakMap();
const debugHandle = normalizeHandleValue(process.env.SALT_VARIANT_IMAGE_DEBUG_HANDLE || "");
const useBulkApply = process.env.SALT_VARIANT_IMAGE_USE_BULK !== "0";
const bulkApplyThreshold = Math.max(1, Number(process.env.SALT_VARIANT_IMAGE_BULK_THRESHOLD || 25));
const visionRoleTokens = new Set([
  "backpack", "bag", "bottle", "box", "case", "chair", "charger", "coat", "conditioner", "cup",
  "dress", "drill", "earbuds", "fork", "grinder", "headphones", "jacket", "keyboard", "laptop",
  "lunch", "mat", "mug", "mouse", "necklace", "pencil", "perfume", "phone", "plate", "purse",
  "razor", "ring", "serum", "shampoo", "shirt", "shoe", "soap", "spoon", "stroller", "tablet",
  "toy", "trimmer", "towel", "umbrella", "wallet", "watch", "water", "wrist", "bottle",
]);
const TARGET_QUERY_COST = 900;

const liveProductPageSize = Math.max(
  1,
  Math.min(25, Number(process.env.SALT_VARIANT_IMAGE_PAGE_SIZE || 20))
);

const liveVariantPageSize = Math.max(
  1,
  Math.min(25, Number(process.env.SALT_VARIANT_IMAGE_VARIANT_PAGE_SIZE || 25))
);

const liveMediaPageSize = Math.max(
  1,
  Math.min(25, Number(process.env.SALT_VARIANT_IMAGE_MEDIA_PAGE_SIZE || 25))
);
const graphqlTimeoutMs = Math.max(30_000, Number(process.env.SALT_SHOPIFY_GRAPHQL_TIMEOUT_MS || 120_000));
const checkpointInterval = envInteger(
  "SALT_VARIANT_IMAGE_CHECKPOINT_INTERVAL",
  // Rewriting the growing checkpoint after every product makes resume mode
  // disk-bound. Eight plans is a small recovery window while avoiding a
  // full-catalog write for every completed product.
  process.env.SALT_VARIANT_IMAGE_RESUME === "1" ? 8 : 24,
  { min: 1, max: 100 },
);

const LIVE_PRODUCT_SELECTION = /* GraphQL */ `
  id
  handle
  title
  variants(first: $variantFirst) {
    nodes {
      id
      title
      sku
      selectedOptions {
        name
        value
      }
      media(first: 1) {
        nodes {
          __typename
          id
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
  media(first: $mediaFirst) {
    nodes {
      __typename
      ... on MediaImage {
        id
        image {
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
`;

const LIVE_PRODUCTS_QUERY = /* GraphQL */ `
  query ShopifyVariantImageProducts($first: Int!, $after: String, $variantFirst: Int!, $mediaFirst: Int!) {
    products(first: $first, after: $after) {
      nodes { ${LIVE_PRODUCT_SELECTION} }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const LIVE_PRODUCTS_BY_ID_QUERY = /* GraphQL */ `
  query ShopifyVariantImageProductsById($ids: [ID!]!, $variantFirst: Int!, $mediaFirst: Int!) {
    nodes(ids: $ids) {
      ... on Product { ${LIVE_PRODUCT_SELECTION} }
    }
  }
`;

const LIVE_PRODUCT_VARIANTS_SELECTION = /* GraphQL */ `
  id
  handle
  variants(first: $variantFirst, after: $variantAfter) {
    nodes {
      id
      title
      sku
      selectedOptions {
        name
        value
      }
      media(first: 1) {
        nodes {
          __typename
          id
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
`;

const LIVE_PRODUCT_VARIANTS_BY_ID_QUERY = /* GraphQL */ `
  query ShopifyVariantImageProductVariantsById($ids: [ID!]!, $variantFirst: Int!, $variantAfter: String) {
    nodes(ids: $ids) {
      ... on Product { ${LIVE_PRODUCT_VARIANTS_SELECTION} }
    }
  }
`;

const LIVE_PRODUCT_MEDIA_SELECTION = /* GraphQL */ `
  id
  handle
  title
  media(first: $mediaFirst, after: $mediaAfter) {
    nodes {
      __typename
      ... on MediaImage {
        id
        image {
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
`;

const LIVE_PRODUCT_MEDIA_BY_ID_QUERY = /* GraphQL */ `
  query ShopifyVariantImageProductMediaById($ids: [ID!]!, $mediaFirst: Int!, $mediaAfter: String) {
    nodes(ids: $ids) {
      ... on Product { ${LIVE_PRODUCT_MEDIA_SELECTION} }
    }
  }
`;

const STAGED_UPLOAD_CREATE_MUTATION = /* GraphQL */ `
  mutation VariantImageMappingStagedUpload($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url parameters { name value } }
      userErrors { field message }
    }
  }
`;

const BULK_OPERATION_RUN_MUTATION = /* GraphQL */ `
  mutation VariantImageMappingBulkRun($mutation: String!, $stagedUploadPath: String!) {
    bulkOperationRunMutation(mutation: $mutation, stagedUploadPath: $stagedUploadPath) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }
`;

const BULK_OPERATION_STATUS_QUERY = /* GraphQL */ `
  query VariantImageMappingBulkStatus($id: ID!) {
    bulkOperation(id: $id) {
      id
      status
      errorCode
      objectCount
      url
      partialDataUrl
      completedAt
    }
  }
`;

const BULK_VARIANT_IMAGE_MUTATION = /* GraphQL */ `
  mutation VariantImageMappingBulk($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      userErrors { field message code }
    }
  }
`;

function parseArgs(argv) {
  const args = {
    mode: "dry-run",
    scope: "all-products",
    inputPath: defaultInputPath,
    outputPath: defaultOutputPath,
    handlesPath: defaultHandlesPath,
    mediaCachePath: defaultMediaCachePath,
    checkpointPath: defaultCheckpointPath,
    vision: visionEnabled,
    forceGuesses,
    resume: process.env.SALT_VARIANT_IMAGE_RESUME === "1",
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === "--apply") args.mode = "apply";
    else if (token === "--dry-run") args.mode = "dry-run";
    else if (token === "--scope" && next) {
      args.scope = next;
      index += 1;
    } else if (token === "--all-products") args.scope = "all-products";
    else if (token === "--new-products-only") args.scope = "new-products";
    else if (token === "--input" && next) {
      args.inputPath = resolve(rootDir, next);
      index += 1;
    } else if (token === "--output" && next) {
      args.outputPath = resolve(rootDir, next);
      index += 1;
    } else if (token === "--handles-output" && next) {
      args.handlesPath = resolve(rootDir, next);
      index += 1;
    } else if (token === "--media-cache" && next) {
      args.mediaCachePath = resolve(rootDir, next);
      index += 1;
    } else if (token === "--checkpoint" && next) {
      args.checkpointPath = resolve(rootDir, next);
      index += 1;
    } else if (token === "--resume") {
      args.resume = true;
    } else if (token === "--no-resume") {
      args.resume = false;
    } else if (token === "--no-vision") {
      args.vision = false;
    } else if (token === "--no-guesses") {
      args.forceGuesses = false;
    }
  }

  if (!["all-products", "new-products"].includes(args.scope)) {
    throw new Error(`Invalid --scope ${args.scope}; expected all-products or new-products`);
  }

  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * AbortSignal.timeout() should cover fetch, but some local model runtimes can
 * leave a response promise open after the socket has stopped making progress.
 * Race the complete response (including JSON parsing) against an explicit
 * timer so one vision request can never hold the resumable release forever.
 */
async function withHardTimeout(task, timeoutMs, label) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => task(controller.signal)),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function tokenise(value) {
  return normalizePlainText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);
}

function unique(array) {
  return [...new Set(array.filter(Boolean))];
}

function imageUrlKey(value) {
  const raw = normalizePlainText(value);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().toLowerCase();
  } catch {
    return raw.toLowerCase().split("?")[0];
  }
}

function parseJsonResponse(rawContent) {
  const raw = String(rawContent || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function variantText(variant) {
  return normalizePlainText([
    variant?.title,
    variant?.sku,
    ...(Array.isArray(variant?.selectedOptions)
      ? variant.selectedOptions.map((option) => option?.value)
      : [variant?.option1, variant?.option2, variant?.option3]),
  ].filter(Boolean).join(" "));
}

function hasSemanticVariantRole(variant) {
  return tokenise(variantText(variant)).some((token) => visionRoleTokens.has(token));
}

function productNeedsVisualVerification(product, images, variants, liveProduct = null, deterministicAssignments = null) {
  if (!visionEnabled || !Array.isArray(images) || images.length < 2 || variants.length < 2) return false;
  // Deterministic SKU/title/option evidence is both faster and more auditable
  // than local vision. If every variant already has a unique deterministic
  // candidate, do not spend model time re-checking an answer we can prove from
  // the catalog and image metadata.
  const deterministic = deterministicAssignments || assignDeterministicMappings(variants, images);
  if (deterministic.size >= variants.length) return false;
  const liveMediaByIdentity = new Map();
  for (const liveVariant of liveProduct?.variants?.nodes || []) {
    const mediaId = getVariantMediaId(liveVariant);
    if (!mediaId) continue;
    for (const identity of variantIdentityValues(liveVariant)) liveMediaByIdentity.set(identity, mediaId);
  }
  const currentAssignments = variants
    .map((variant) => {
      const liveMediaId = [...variantIdentityValues(variant)].map((identity) => liveMediaByIdentity.get(identity)).find(Boolean);
      return liveMediaId || variant?.featured_image?.id || variant?.image_id || "";
    })
    .filter(Boolean)
    .map(String);
  const distinctCurrentImages = new Set(currentAssignments);
  // A missing live association is unknown data, not evidence that every
  // variant uses the same image. Treating it as "all same" sent almost the
  // whole catalog through Ollama even when no visual decision was needed.
  const allCurrentImage = currentAssignments.length >= variants.length && distinctCurrentImages.size <= 1;
  const productTokens = new Set(tokenise(product?.title || ""));
  const criticalRoleTokens = new Set(["backpack", "bottle", "insulated", "lunch", "pencil"]);
  const hasDifferentSemanticRoles = variants.filter(hasSemanticVariantRole).length >= 2
    || variants.some((variant) => tokenise(variantText(variant))
      .some((token) => criticalRoleTokens.has(token) && !productTokens.has(token)));
  const duplicateCurrentImage = currentAssignments.length >= 2 && distinctCurrentImages.size < currentAssignments.length;
  const currentMappingContradictsText = variants.some((variant) => {
    const currentMediaId = [...variantIdentityValues(variant)].map((identity) => liveMediaByIdentity.get(identity)).find(Boolean);
    if (!currentMediaId) return false;
    const currentImage = images.find((image) => image.id === currentMediaId);
    const ranked = rankImageCandidates(variant, images);
    const best = ranked[0];
    const currentScore = currentImage ? scoreImageMatch(variant, currentImage).score : 0;
    return Boolean(best?.image?.id && best.image.id !== currentMediaId && best.score >= 18 && best.score - currentScore >= 8);
  });
  const hasWeakLexicalEvidence = variants.some((variant) => {
    const ranked = images
      .map((image) => ({ image, ...scoreImageMatch(variant, image) }))
      .sort((left, right) => right.score - left.score);
    return !ranked[0] || ranked[0].score < 18 || ranked[0].score - (ranked[1]?.score || 0) < 6;
  });
  return allCurrentImage
    || currentMappingContradictsText
    || (hasDifferentSemanticRoles && (duplicateCurrentImage || hasWeakLexicalEvidence));
}

async function imageAsBase64(url) {
  let lastError = null;
  const candidates = (() => {
    try {
      const resized = new URL(url);
      resized.searchParams.set("width", String(visionImageWidth));
      resized.searchParams.set("format", "jpg");
      return unique([resized.toString(), url]);
    } catch {
      return [url];
    }
  })();

  for (let attempt = 1; attempt <= visionImageAttempts; attempt += 1) {
    for (const candidate of candidates) {
      try {
        const response = await fetch(candidate, {
          headers: {
            Accept: "image/jpeg,image/png,*/*",
            "User-Agent": "SALT-variant-media-supervised-verifier/1.0",
          },
          signal: AbortSignal.timeout(visionImageTimeoutMs),
        });
        if (!response.ok) throw new Error(`image HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        if (!bytes.byteLength) throw new Error("image response was empty");
        const header = Buffer.from(bytes).subarray(0, 12).toString("ascii");
        const isJpeg = Buffer.from(bytes).subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
        const isPng = Buffer.from(bytes).subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        const isGif = header.startsWith("GIF8");
        if (!isJpeg && !isPng && !isGif) throw new Error("image format is not supported by the supervised vision runtime");
        return Buffer.from(bytes).toString("base64");
      } catch (error) {
        lastError = error;
      }
    }
    if (attempt < visionImageAttempts) await sleep(500 * attempt);
  }
  throw lastError || new Error("image fetch failed");
}

function normalizeVisionIndex(value, imageCount, zeroBased) {
  const number = Number(value);
  if (!Number.isInteger(number)) return -1;
  const index = zeroBased ? number : number - 1;
  return index >= 0 && index < imageCount ? index : -1;
}

function visionMappings(payload) {
  if (Array.isArray(payload?.mappings)) return payload.mappings;
  if (Array.isArray(payload?.assignments)) return payload.assignments;
  if (payload && typeof payload === "object") {
    return Object.entries(payload)
      .filter(([, value]) => value && typeof value === "object")
      .map(([variant, value]) => ({ variant, ...value }));
  }
  return [];
}

function resolveVisionVariantIndex(mapping, variants, usedIndexes) {
  const label = normalizePlainText(mapping?.variant || "").toLowerCase();
  if (!label) return -1;
  const exact = variants.findIndex((variant, index) => {
    if (usedIndexes.has(index)) return false;
    const values = [
      variant?.title,
      variant?.option1,
      variant?.option2,
      variant?.option3,
      ...(Array.isArray(variant?.selectedOptions) ? variant.selectedOptions.map((option) => option?.value) : []),
    ].filter(Boolean).map((value) => normalizePlainText(value).toLowerCase());
    return values.some((value) => value === label || value.split(" /")[0].trim() === label);
  });
  if (exact >= 0) return exact;
  const labelTokens = new Set(tokenise(label));
  let bestIndex = -1;
  let bestScore = 0;
  variants.forEach((variant, index) => {
    if (usedIndexes.has(index)) return;
    const overlap = [...labelTokens].filter((token) => tokenise(variantText(variant)).includes(token)).length;
    const score = overlap / Math.max(1, labelTokens.size);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestScore >= 0.5 ? bestIndex : -1;
}

function selectVisionCandidates(images, variants, limit) {
  const selected = [];
  const selectedIds = new Set();
  const add = (image) => {
    if (!image?.id || selectedIds.has(image.id) || selected.length >= limit) return;
    selected.push(image);
    selectedIds.add(image.id);
  };
  for (const variant of variants) {
    const ranked = rankImageCandidates(variant, images);
    add(ranked[0]?.image);
    add(ranked[1]?.image);
  }
  for (const image of images) add(image);
  return selected;
}

async function classifyVariantImagesWithVision(product, variants, images) {
  if (visionCircuitOpenUntil > Date.now()) {
    const remainingSeconds = Math.ceil((visionCircuitOpenUntil - Date.now()) / 1000);
    throw new Error(`Ollama vision circuit is cooling down (${remainingSeconds}s); deterministic fallback remains active.`);
  }
  const needsDeepVariantWindow = variants.some((variant) => {
    const tokens = new Set(tokenise(variantText(variant)));
    return tokens.has("lunch") || tokens.has("pencil");
  });
  const candidateLimit = needsDeepVariantWindow
    ? visionImageLimit
    : Math.min(4, Math.max(2, variants.length));
  const candidates = selectVisionCandidates(images, variants, candidateLimit);
  if (candidates.length < 2) return null;
  const encodedResults = await Promise.all(candidates.map(async (image, sourceIndex) => {
    try {
      return { image, sourceIndex, encoded: await imageAsBase64(image.url) };
    } catch (error) {
      if (debugHandle && normalizeHandleValue(product?.handle) === debugHandle) {
        process.stdout.write(`DEBUG image failure ${image.url}: ${normalizePlainText(error?.message || error)}\n`);
      }
      return null;
    }
  }));
  const usableImages = encodedResults.filter(Boolean);
  if (usableImages.length < 2) return null;
  const encodedImages = usableImages.map((entry) => entry.encoded);
  const body = {
    model: visionModel,
    stream: false,
    format: {
      type: "object",
      properties: {
        mappings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              variant: { type: "string" },
              variantIndex: { type: "integer" },
              imageIndex: { type: "integer" },
              confidence: { type: "number" },
              rationale: { type: "string" },
            },
            required: ["variant", "imageIndex", "confidence", "rationale"],
          },
        },
      },
      required: ["mappings"],
    },
    messages: [{
      role: "user",
      content: [
        "Match every variant to the image that most clearly shows that exact variant.",
        "The supplied images are indexed from 0 in the order received.",
        "Inspect the image contents. Do not rely on filenames, image order, or the existing Shopify assignment.",
        "Distinguish different object types, package sizes, colors, and product forms; a backpack image must not be assigned to a bottle, lunch box, or pencil case variant.",
        "Use the variant label as a verification target, not as proof that the image matches.",
        "If an exact image is not present, choose the closest visible product image and lower confidence.",
        `Product: ${normalizePlainText(product?.title || "")}`,
        `Variants: ${variants.map((variant, index) => `${index}: ${variantText(variant)}`).join(" | ")}`,
        "Return exactly one mapping per variant.",
      ].join(" "),
      images: encodedImages,
    }],
    options: { temperature: 0, num_predict: visionOutputTokens, num_ctx: visionContextLength },
    keep_alive: "10m",
  };
  const requestBody = JSON.stringify(body);
  let response = null;
  let payload = null;
  let requestError = null;
  for (let attempt = 1; attempt <= visionRequestAttempts; attempt += 1) {
    try {
      const result = await withHardTimeout(async (signal) => {
        const nextResponse = await fetch(`${ollamaUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal,
          body: requestBody,
        });
        return {
          response: nextResponse,
          payload: nextResponse.ok ? await nextResponse.json() : null,
        };
      }, visionRequestTimeoutMs, "Ollama vision request");
      response = result.response;
      payload = result.payload;
      if (response.ok) break;
      requestError = new Error(`Ollama HTTP ${response.status}`);
    } catch (error) {
      requestError = error;
    }
    if (attempt < visionRequestAttempts) await sleep(1000 * attempt);
  }
  if (!response?.ok) {
    visionConsecutiveFailures += 1;
    if (visionConsecutiveFailures >= visionCircuitFailureThreshold) {
      visionCircuitOpenUntil = Date.now() + visionCircuitCooldownMs;
      process.stderr.write(
        `Ollama vision circuit opened after ${visionConsecutiveFailures} consecutive failure(s); guarded deterministic fallback will continue for ${Math.ceil(visionCircuitCooldownMs / 1000)}s.\n`,
      );
    }
    throw requestError || new Error("Ollama vision request failed");
  }
  visionConsecutiveFailures = 0;
  visionCircuitOpenUntil = 0;
  const parsed = parseJsonResponse(payload?.message?.content) || {};
  if (debugHandle && normalizeHandleValue(product?.handle) === debugHandle) {
    process.stdout.write(`DEBUG vision response ${JSON.stringify(parsed)}\n`);
  }
  const rawMappings = visionMappings(parsed);
  const numericImageIndexes = rawMappings
    .map((mapping) => Number(mapping?.imageIndex))
    .filter((value) => Number.isInteger(value));
  const hasZero = numericImageIndexes.some((value) => value === 0);
  const oneBasedPossible = numericImageIndexes.length > 0
    && numericImageIndexes.every((value) => value >= 1 && value <= usableImages.length);
  const zeroBasedPossible = numericImageIndexes.every((value) => value >= 0 && value < usableImages.length);
  const zeroBased = hasZero || (!oneBasedPossible && zeroBasedPossible);
  const normalized = [];
  const usedVariantIndexes = new Set();
  for (const mapping of rawMappings) {
    const resolvedIndex = resolveVisionVariantIndex(mapping, variants, usedVariantIndexes);
    const explicitVariantIndex = Number.isInteger(Number(mapping?.variantIndex))
      ? Number(mapping.variantIndex)
      : -1;
    const variantIndex = resolvedIndex >= 0 ? resolvedIndex : explicitVariantIndex;
    const imageIndex = normalizeVisionIndex(mapping?.imageIndex, usableImages.length, zeroBased);
    if (variantIndex < 0 || variantIndex >= variants.length || imageIndex < 0) continue;
    if (usedVariantIndexes.has(variantIndex)) continue;
    usedVariantIndexes.add(variantIndex);
    const confidenceNumber = Number(mapping?.confidence);
    const confidence = Number.isFinite(confidenceNumber)
      ? Math.round((confidenceNumber <= 1 ? confidenceNumber * 100 : confidenceNumber))
      : 0;
    normalized.push({
      variantIndex,
      imageIndex: usableImages[imageIndex].sourceIndex,
      confidence: Math.max(0, Math.min(100, confidence)),
      rationale: normalizePlainText(mapping?.rationale || "visual variant match"),
    });
  }
  return {
    mappings: normalized,
    imageCount: candidates.length,
    model: visionModel,
  };
}

async function concurrentExecutor(tasks, concurrency, interTaskDelay = 0) {
  const results = [];
  const total = tasks.length;
  let index = 0;

  async function worker() {
    while (index < total) {
      const current = index++;
      try {
        results[current] = { status: "fulfilled", value: await tasks[current]() };
      } catch (error) {
        results[current] = { status: "rejected", reason: error };
      }
      if (interTaskDelay > 0 && current < total - 1) {
        await sleep(interTaskDelay);
      }
      if (total > 10 && (current + 1) % Math.max(1, Math.floor(total / 20)) === 0) {
        const done = results.filter((r) => r !== undefined).length;
        process.stdout.write(`  Progress: ${done}/${total} (${Math.round((done / total) * 100)}%)\n`);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, total) }, () => worker());
  await Promise.all(workers);

  const failures = results.filter((r) => r && r.status === "rejected");
  if (failures.length) {
    const first = failures[0].reason;
    const rest = failures.length - 1;
    const error = new Error(`${first.message || first}${rest ? ` (and ${rest} more failure(s))` : ""}`);
    error.completedValues = results
      .filter((result) => result && result.status === "fulfilled")
      .map((result) => result.value);
    throw error;
  }

  return results.filter((r) => r && r.status === "fulfilled").map((r) => r.value);
}

function createConcurrencyGate(limit) {
  let active = 0;
  const queue = [];

  const pump = () => {
    while (active < limit && queue.length) {
      const { task, resolve, reject } = queue.shift();
      active += 1;
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  };

  return (task) => new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    pump();
  });
}

const visionGate = createConcurrencyGate(visionConcurrency);

function scoreImageMatch(variant, image) {
  const imageText = normalizePlainText([
    image?.altText,
    basename(image?.url || image?.src || ""),
  ].filter(Boolean).join(" ")).toLowerCase();
  const imageTokens = tokenise(imageText);
  const signals = [];
  let score = 0;

  if (!imageTokens.length || !variant) return { score, signals };

  const phraseMatches = (value) => {
    const tokens = tokenise(value);
    if (!tokens.length || tokens.some((token) => token.length < 2)) return false;
    for (let offset = 0; offset <= imageTokens.length - tokens.length; offset += 1) {
      if (tokens.every((token, index) => imageTokens[offset + index] === token)) return true;
    }
    return false;
  };

  const sku = normalizePlainText(variant.sku).toLowerCase();
  if (sku && phraseMatches(sku)) {
    score += 40;
    signals.push("sku-exact");
  }

  const title = normalizePlainText(variant.title).toLowerCase();
  if (title && !/^(default title|default)$/i.test(title) && phraseMatches(title)) {
    score += 30;
    signals.push("title-exact");
  }

  const optionValues = Array.isArray(variant.selectedOptions)
    ? variant.selectedOptions.map((option) => normalizePlainText(option?.value).toLowerCase()).filter(Boolean)
    : [];
  for (const optionValue of optionValues) {
    if (phraseMatches(optionValue)) {
      score += 18;
      signals.push(`option:${optionValue}`);
    }
  }

  const variantTokens = tokenise([title, sku, ...optionValues].filter(Boolean).join(" "));
  const overlap = [...new Set(variantTokens)].filter((token) => token.length >= 3 && imageTokens.includes(token));
  if (overlap.length >= 2) {
    score += Math.min(24, overlap.reduce((total, token) => total + (token.length >= 6 ? 6 : 3), 0));
    signals.push(`token-overlap:${overlap.length}`);
  }

  const variantIdentities = variantIdentityValues(variant);
  if (Array.isArray(image.variantIds) && image.variantIds.some((value) => variantIdentities.has(String(value)))) {
    score += 18;
    signals.push("legacy-variant-media-hint");
  }

  if (Array.isArray(image.sourceVariantIds) && image.sourceVariantIds.length === 1 && image.sourceVariantIds.some((value) => variantIdentities.has(String(value)))) {
    score += 30;
    signals.push("source-variant-exact");
  }

  if (Array.isArray(image.liveVariantIds) && image.liveVariantIds.length === 1 && image.liveVariantIds.some((value) => variantIdentities.has(String(value)))) {
    score += 10;
    signals.push("current-live-media-hint");
  }

  return { score, signals };
}

async function executeGraphQlInternal(query, variables = {}, { mutation = false, operation = "Shopify request" } = {}) {
  const cliArgs = [
    "store",
    "execute",
    "--store",
    storeDomain,
    "--version",
    apiVersion,
    "--query",
    query,
    "--variables",
    JSON.stringify(variables),
    "--json",
  ];
  if (mutation) cliArgs.push("--allow-mutations");

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      let payload;
      if (adminAccessToken) {
        const response = await fetch(adminGraphqlUrl, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": adminAccessToken,
          },
          body: JSON.stringify({ query, variables }),
          signal: AbortSignal.timeout(graphqlTimeoutMs),
        });
        const raw = await response.text();
        try {
          payload = JSON.parse(raw);
        } catch {
          throw new Error(`${operation} returned invalid JSON: ${raw.slice(0, 500)}`);
        }
        if (!response.ok) {
          throw new Error(`Admin GraphQL HTTP ${response.status}: ${raw.slice(0, 500)}`);
        }
      } else {
        const result = await execFileAsync(cliBinary, cliArgs, {
          cwd: rootDir,
          timeout: graphqlTimeoutMs,
          env: {
            ...process.env,
            SHOPIFY_CLI_AGENT_INFO: process.env.SHOPIFY_CLI_AGENT_INFO || "n:future-light-store|v:1|p:openai",
            SHOPIFY_CLI_AGENT_IDS: process.env.SHOPIFY_CLI_AGENT_IDS || `s:${process.env.CONVERSATION_ID || "local"}|r:${process.pid}|i:variant-image-mapping`,
          },
          maxBuffer: 40 * 1024 * 1024,
        });
        const text = String(result.stdout || "").trim();
        const startIndex = text.indexOf("{");
        if (startIndex === -1) {
          throw new Error(`${operation} returned no JSON payload: ${text.slice(0, 500)}`);
        }
        payload = JSON.parse(text.slice(startIndex));
      }

      // Check for throttled/rate-limited errors first as they are transient
      if (payload.errors?.length) {
        const throttled = payload.errors.some(
          (e) => /throttled|rate limit|429/i.test(e?.message || e?.extensions?.code || "")
        );
        if (throttled) {
          throw new Error(`Throttled`);
        }
        throw new Error(payload.errors.map((error) => error.message).join(" | "));
      }
      return payload.data || payload;
    } catch (error) {
      const message = String(error?.stderr || error?.stdout || error?.message || error);
      const transient = /429|throttl|rate limit|timeout|5\d\d|network|socket|temporar|aborted|MAX_COST_EXCEEDED|Query cost|ENOTFOUND|EAI_AGAIN|getaddrinfo|ECONNRESET|ECONNREFUSED|fetch failed|DNS/i.test(message);
      if (!transient || attempt === maxAttempts - 1) {
        throw new Error(`${operation} failed: ${message.trim()}`);
      }
      // Use a longer base delay for "Throttled" errors and add jitter to avoid thundering herd
      const baseDelay = /throttled|THROTTLED/i.test(message) ? 2000 * 2 ** attempt : 1000 * 2 ** attempt;
      const jitter = Math.floor(Math.random() * baseDelay * 0.3);
      const retryMs = Math.min(30_000, baseDelay + jitter);
      process.stdout.write(`${operation} throttled; retrying in ${(retryMs / 1000).toFixed(1)}s\n`);
      await sleep(retryMs);
    }
  }
  throw new Error(`${operation} failed`);
}

async function executeGraphQl(query, variables = {}, options = {}) {
  return requestScheduler.run(() => executeGraphQlInternal(query, variables, options));
}

async function loadHandles(handlesPath) {
  try {
    const raw = await readFile(handlesPath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed.map((handle) => normalizeHandleValue(handle)).filter(Boolean));
    if (Array.isArray(parsed?.handles)) return new Set(parsed.handles.map((handle) => normalizeHandleValue(handle)).filter(Boolean));
  } catch {
    return null;
  }
  return null;
}

async function loadSnapshot(inputPath) {
  if (basename(inputPath) === "products.json") {
    return readProductCatalogPayload(dirname(inputPath));
  }

  const raw = await readFile(inputPath, "utf8");
  return JSON.parse(raw);
}

async function loadMediaCache(cachePath, scopedProductIds) {
  try {
    const raw = await readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw);
    const products = Array.isArray(parsed) ? parsed : parsed?.products;
    if (!Array.isArray(products) || !products.length || parsed?.mediaPagesComplete !== true) return null;
    const ids = new Set(products.map((product) => String(product?.id || "")).filter(Boolean));
    if (scopedProductIds.some((id) => !ids.has(String(id)))) return null;
    if (products.some((product) => product?.media?.pageInfo?.hasNextPage || product?.variants?.pageInfo?.hasNextPage)) return null;
    process.stdout.write(`Reusing ${products.length} cached live Shopify product media records\n`);
    return products;
  } catch {
    return null;
  }
}

async function loadPartialMediaCache(cachePath, scopedProductIds) {
  try {
    const raw = await readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw);
    const products = Array.isArray(parsed) ? parsed : parsed?.products;
    if (!Array.isArray(products)) return new Map();
    const scopedIds = new Set(scopedProductIds.map((id) => String(id)));
    return new Map(products
      .filter((product) => scopedIds.has(String(product?.id || "")))
      .map((product) => [String(product.id), product]));
  } catch {
    return new Map();
  }
}

async function fetchLiveProducts() {
  const products = [];
  let after = null;
  let pageSize = liveProductPageSize;
  let variantPageSize = liveVariantPageSize;
  let mediaPageSize = liveMediaPageSize;
  const minPageSize = 1;

  while (true) {
    try {
      process.stdout.write(`Fetching live Shopify product page ${products.length + 1} (size ${pageSize})...\n`);
      const data = await executeGraphQl(
        LIVE_PRODUCTS_QUERY,
        { first: pageSize, after, variantFirst: variantPageSize, mediaFirst: mediaPageSize },
        { operation: `product page ${products.length + 1} (size ${pageSize}, variants ${variantPageSize}, media ${mediaPageSize})` },
      );
      const connection = data.products;
      products.push(...(connection?.nodes || []));
      after = connection?.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null;
      if (!after) break;
      if (requestDelayMs) {
        await sleep(requestDelayMs);
      }
    } catch (error) {
      const message = String(error?.message || error);
      if (!/MAX_COST_EXCEEDED|exceeds the single query max cost limit|Query cost is/i.test(message)) {
        throw error;
      }
      const canShrinkPage = pageSize > minPageSize;
      const canShrinkVariants = variantPageSize > 1;
      const canShrinkMedia = mediaPageSize > 1;
      if (!canShrinkPage && !canShrinkVariants && !canShrinkMedia) {
        throw error;
      }
      pageSize = canShrinkPage
        ? Math.max(1, Math.ceil(pageSize * 0.75))
        : pageSize;
      variantPageSize = canShrinkVariants
        ? Math.max(5, Math.ceil(variantPageSize * 0.75))
        : variantPageSize;
      mediaPageSize = canShrinkMedia
        ? Math.max(5, Math.ceil(mediaPageSize * 0.75))
        : mediaPageSize;
      process.stdout.write(
        `Target query cost < ${TARGET_QUERY_COST}. Retrying with page=${pageSize}, variants=${variantPageSize}, media=${mediaPageSize}.\n`,
      );
    }
  }

  return products;
}

async function fetchLiveProductsByIds(ids) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const batchCount = Math.ceil(uniqueIds.length / 20);
  const tasks = Array.from({ length: batchCount }, (_, batchIndex) => async () => {
    const batch = uniqueIds.slice(batchIndex * 20, (batchIndex + 1) * 20);
    const data = await executeGraphQl(
      LIVE_PRODUCTS_BY_ID_QUERY,
      { ids: batch, variantFirst: liveVariantPageSize, mediaFirst: liveMediaPageSize },
      { operation: `scoped product batch ${batchIndex + 1}/${batchCount}` },
    );
    return (data.nodes || []).filter((product) => product?.id);
  });
  const products = (await concurrentExecutor(tasks, fetchConcurrency)).flat();
  process.stdout.write(`Fetched ${products.length} scoped Shopify products by ID\n`);
  return products;
}

async function fetchLiveProductMediaByIds(ids, cachePath = "") {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const partialCache = cachePath ? await loadPartialMediaCache(cachePath, uniqueIds) : new Map();
  const missingIds = uniqueIds.filter((id) => !partialCache.has(String(id)));
  if (!missingIds.length) {
    process.stdout.write(`Reusing ${partialCache.size} partial/live Shopify product media records\n`);
    return [...partialCache.values()];
  }
  const batchCount = Math.ceil(missingIds.length / 20);
  const tasks = Array.from({ length: batchCount }, (_, batchIndex) => async () => {
    const batch = missingIds.slice(batchIndex * 20, (batchIndex + 1) * 20);
    const data = await executeGraphQl(
      LIVE_PRODUCT_MEDIA_BY_ID_QUERY,
      { ids: batch, mediaFirst: liveMediaPageSize, mediaAfter: null },
      { operation: `scoped media batch ${batchIndex + 1}/${batchCount}` },
    );
    const products = (data.nodes || []).filter((product) => product?.id);
    return Promise.all(products.map(async (product) => {
      const nodes = [...(product.media?.nodes || [])];
      let pageInfo = product.media?.pageInfo || { hasNextPage: false, endCursor: null };
      while (pageInfo.hasNextPage && pageInfo.endCursor) {
        const nextData = await executeGraphQl(
          LIVE_PRODUCT_MEDIA_BY_ID_QUERY,
          { ids: [product.id], mediaFirst: liveMediaPageSize, mediaAfter: pageInfo.endCursor },
          { operation: `media continuation ${product.handle || product.id}` },
        );
        const nextProduct = (nextData.nodes || []).find((entry) => String(entry?.id || "") === String(product.id));
        if (!nextProduct) break;
        nodes.push(...(nextProduct.media?.nodes || []));
        pageInfo = nextProduct.media?.pageInfo || { hasNextPage: false, endCursor: null };
      }
      const variants = [...(product.variants?.nodes || [])];
      let variantPageInfo = product.variants?.pageInfo || { hasNextPage: false, endCursor: null };
      while (variantPageInfo.hasNextPage && variantPageInfo.endCursor) {
        const nextData = await executeGraphQl(
          LIVE_PRODUCT_VARIANTS_BY_ID_QUERY,
          { ids: [product.id], variantFirst: liveVariantPageSize, variantAfter: variantPageInfo.endCursor },
          { operation: `variant continuation ${product.handle || product.id}` },
        );
        const nextProduct = (nextData.nodes || []).find((entry) => String(entry?.id || "") === String(product.id));
        if (!nextProduct) break;
        variants.push(...(nextProduct.variants?.nodes || []));
        variantPageInfo = nextProduct.variants?.pageInfo || { hasNextPage: false, endCursor: null };
      }
      return {
        ...product,
        media: { ...product.media, nodes, pageInfo },
        variants: { ...product.variants, nodes: variants, pageInfo: variantPageInfo },
      };
    }));
  });
  let fetchedCount = 0;
  try {
    const batches = await concurrentExecutor(tasks, fetchConcurrency, requestDelayMs);
    const products = batches.flat();
    for (const product of products) partialCache.set(String(product.id), product);
    fetchedCount = products.length;
  } catch (error) {
    const completedProducts = (error?.completedValues || []).flat();
    for (const product of completedProducts) partialCache.set(String(product.id), product);
    if (cachePath) {
      await writeJsonAtomic(cachePath, {
        generatedAt: new Date().toISOString(),
        mediaPagesComplete: false,
        products: [...partialCache.values()],
      });
    }
    throw error;
  }
  const missingAfterFetch = uniqueIds.filter((id) => !partialCache.has(String(id)));
  if (missingAfterFetch.length) {
    if (cachePath) {
      await writeJsonAtomic(cachePath, {
        generatedAt: new Date().toISOString(),
        mediaPagesComplete: false,
        products: [...partialCache.values()],
      });
    }
    throw new Error(`Shopify returned ${missingAfterFetch.length} scoped product(s) without live media records; resume after correcting the live scope.`);
  }
  if (cachePath) {
    await writeJsonAtomic(cachePath, {
      generatedAt: new Date().toISOString(),
      mediaPagesComplete: partialCache.size >= uniqueIds.length,
      products: [...partialCache.values()],
    });
  }
  process.stdout.write(`Fetched ${fetchedCount} scoped Shopify product media records by ID; cache now has ${partialCache.size}/${uniqueIds.length}\n`);
  return [...partialCache.values()];
}

function productIdForGraphql(product) {
  if (product?.admin_graphql_api_id) return String(product.admin_graphql_api_id);
  if (product?.id != null) return `gid://shopify/Product/${product.id}`;
  return "";
}

function variantIdForGraphql(variant) {
  const raw = String(variant?.admin_graphql_api_id || variant?.id || "");
  if (!raw) return "";
  return raw.startsWith("gid://") ? raw : `gid://shopify/ProductVariant/${raw}`;
}

function variantIdentityValues(variant) {
  const rawValues = [variant?.id, variant?.admin_graphql_api_id, variant?.legacyResourceId, variant?.image_id]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const numericValues = rawValues.flatMap((value) => {
    const match = value.match(/(\d+)$/);
    return match ? [match[1]] : [];
  });
  return new Set([...rawValues, ...numericValues]);
}

function getVariantMediaId(variant) {
  const mediaNode = Array.isArray(variant?.media?.nodes)
    ? variant.media.nodes.find((node) => node?.id && node?.__typename === "MediaImage")
    : null;
  return mediaNode?.id ? String(mediaNode.id) : "";
}

function buildProductImages(mediaNodes, snapshotProduct, liveProduct) {
  const sourceImages = Array.isArray(snapshotProduct?.images) ? snapshotProduct.images : [];
  const sourceByUrl = new Map(sourceImages.map((image) => [imageUrlKey(image?.src || image?.url), image]));
  const sourceById = new Map(sourceImages.map((image) => [String(image?.id || ""), image]));
  const liveVariantMedia = new Map();
  for (const variant of liveProduct?.variants?.nodes || []) {
    const mediaId = getVariantMediaId(variant);
    if (!mediaId) continue;
    if (!liveVariantMedia.has(mediaId)) liveVariantMedia.set(mediaId, new Set());
    for (const value of variantIdentityValues(variant)) liveVariantMedia.get(mediaId).add(value);
  }
  return (Array.isArray(mediaNodes) ? mediaNodes : [])
    .map((node, position) => {
      const url = normalizePlainText(node?.src || node?.url || node?.image?.url || "");
      const source = sourceByUrl.get(imageUrlKey(url)) || sourceById.get(String(node?.id || ""));
      return {
        id: String(node?.id || ""),
        url,
        altText: normalizePlainText(node?.alt || node?.altText || node?.image?.altText || source?.alt || ""),
        variantIds: Array.isArray(source?.variant_ids)
          ? source.variant_ids.map((value) => String(value || "")).filter(Boolean)
          : [],
        sourceVariantIds: Array.isArray(source?.variant_ids)
          ? source.variant_ids.map((value) => String(value || "")).filter(Boolean)
          : [],
        liveVariantIds: [...(liveVariantMedia.get(String(node?.id || "")) || [])],
        position,
        tokens: tokenise([node?.alt || node?.altText || node?.image?.altText, url, source?.alt].filter(Boolean).join(" ")),
      };
    })
    .filter((image) => image.id && image.url);
}

function currentVariantImageUrl(variant, snapshotProduct) {
  const direct = variant?.featured_image?.src || variant?.featured_image?.url;
  if (direct) return normalizePlainText(direct);
  const imageId = String(variant?.image_id || "");
  if (!imageId) return "";
  const image = (snapshotProduct?.images || []).find((entry) => String(entry?.id || "") === imageId);
  return normalizePlainText(image?.src || image?.url || "");
}

function planFingerprint(snapshotProducts, liveProducts, scopeHandles) {
  const snapshotMaterial = snapshotProducts
    .map((product) => [
      product?.id,
      normalizeHandleValue(product?.handle),
      product?.updated_at,
      (product?.variants || []).map((variant) => [variant?.id, variant?.title, variant?.sku, variant?.image_id]),
    ])
    .sort((left, right) => String(left[1]).localeCompare(String(right[1])));
  const liveMaterial = liveProducts
    .map((product) => [
      product?.id,
      normalizeHandleValue(product?.handle),
      (product?.variants?.nodes || []).map((variant) => [variant?.id, variant?.title, variant?.sku, getVariantMediaId(variant)]),
      (product?.media?.nodes || []).map((media) => [media?.id, media?.image?.url, media?.image?.altText]),
    ])
    .sort((left, right) => String(left[1]).localeCompare(String(right[1])));
  return createHash("sha256")
    .update(JSON.stringify({
      scope: scopeHandles ? [...scopeHandles].sort() : "all-products",
      snapshot: snapshotMaterial,
      live: liveMaterial,
    }))
    .digest("hex");
}

async function loadPlanCheckpoint(checkpointPath, fingerprint, resume) {
  if (!resume) return null;
  try {
    const parsed = JSON.parse(await readFile(checkpointPath, "utf8"));
    if (parsed?.version !== 2 || parsed?.fingerprint !== fingerprint || !Array.isArray(parsed?.plans)) return null;
    process.stdout.write(`Resuming ${parsed.plans.length} completed variant-image product plans from checkpoint\n`);
    return parsed;
  } catch {
    return null;
  }
}

async function writePlanCheckpoint(checkpointPath, fingerprint, scope, plansByHandle, totalProducts, status = "running") {
  if (!checkpointPath) return;
  await writeJsonAtomic(checkpointPath, {
    version: 2,
    status,
    fingerprint,
    scope,
    updatedAt: new Date().toISOString(),
    totalProducts,
    completedProducts: plansByHandle.size,
    plans: [...plansByHandle.values()].sort((left, right) => left.handle.localeCompare(right.handle)),
  });
}

function isDeterministicImageSignal(signal) {
  return ["sku-exact", "title-exact", "option:", "source-variant-exact"].some((prefix) => signal === prefix || signal.startsWith(prefix));
}

function rankImageCandidates(variant, images) {
  if (images && typeof images === "object" && variant && typeof variant === "object") {
    let rankingsForImages = imageRankingCache.get(images);
    if (!rankingsForImages) {
      rankingsForImages = new WeakMap();
      imageRankingCache.set(images, rankingsForImages);
    }
    const cached = rankingsForImages.get(variant);
    if (cached) return cached;
    const ranked = images
      .map((image) => ({ image, ...scoreImageMatch(variant, image) }))
      .sort((left, right) => right.score - left.score || String(left.image.id).localeCompare(String(right.image.id)));
    rankingsForImages.set(variant, ranked);
    return ranked;
  }
  return (Array.isArray(images) ? images : [])
    .map((image) => ({ image, ...scoreImageMatch(variant, image) }))
    .sort((left, right) => right.score - left.score || String(left.image.id).localeCompare(String(right.image.id)));
}

function assignDeterministicMappings(variants, images) {
  const assignments = new Map();
  const candidates = variants.map((variant, variantIndex) => {
    const ranked = rankImageCandidates(variant, images);
    const best = ranked.find((candidate) => candidate.signals.some(isDeterministicImageSignal));
    return {
      variantIndex,
      ranked,
      best,
      strength: best?.signals.includes("sku-exact") ? 3 : best?.signals.includes("title-exact") ? 2 : best ? 1 : 0,
      margin: best ? best.score - (ranked[1]?.score || 0) : 0,
    };
  }).filter((entry) => entry.best?.image?.id);
  const usedMediaIds = new Set();
  for (const entry of candidates.sort((left, right) => right.strength - left.strength || right.best.score - left.best.score || right.margin - left.margin || left.variantIndex - right.variantIndex)) {
    const selected = entry.ranked.find((candidate) => candidate.signals.some(isDeterministicImageSignal) && !usedMediaIds.has(candidate.image.id));
    if (!selected?.image?.id) continue;
    assignments.set(entry.variantIndex, {
      mediaId: selected.image.id,
      reason: "multi-signal-match",
      confidence: selected.score >= 40 ? "high" : "medium",
      score: selected.score,
      scoreMargin: entry.margin,
      signals: selected.signals,
      rationale: `Deterministic evidence outranked legacy Shopify associations and vision: ${selected.signals.join(", ")}.`,
    });
    usedMediaIds.add(selected.image.id);
  }
  return assignments;
}

function assignVisionMappings(variants, images, vision, existingAssignments = new Map()) {
  const assignments = new Map(existingAssignments);
  const candidates = [];
  for (const mapping of vision?.mappings || []) {
    const image = images[mapping.imageIndex];
    if (!image?.id) continue;
    if (assignments.has(mapping.variantIndex)) continue;
    candidates.push({ mapping, image });
  }
  const usedImages = new Set([...assignments.values()].map((entry) => entry.mediaId));
  for (const { mapping, image } of candidates.sort((left, right) => Number(right.mapping.confidence || 0) - Number(left.mapping.confidence || 0))) {
    if (assignments.has(mapping.variantIndex)) continue;
    if (images.length >= variants.length && usedImages.has(image.id)) continue;
    assignments.set(mapping.variantIndex, {
      mediaId: image.id,
      reason: "supervised-vision",
      confidence: mapping.confidence >= 75 ? "high" : "low",
      visualConfidence: mapping.confidence,
      rationale: mapping.rationale,
    });
    usedImages.add(image.id);
  }
  return assignments;
}

function assignVariantImages(variants, images, snapshotProduct, vision, allowGuesses, deterministicAssignments = null) {
  const assignments = new Map(deterministicAssignments || assignDeterministicMappings(variants, images));
  assignVisionMappings(variants, images, vision, assignments).forEach((assignment, variantIndex) => {
    assignments.set(variantIndex, assignment);
  });
  const usedMediaIds = new Set([...assignments.values()].map((entry) => entry.mediaId));

  const pending = variants
    .map((variant, variantIndex) => ({ variant, variantIndex }))
    .filter(({ variantIndex }) => !assignments.has(variantIndex))
    .map((entry) => {
      const ranked = images
        .map((image) => ({ image, ...scoreImageMatch(entry.variant, image) }))
        .sort((left, right) => right.score - left.score || String(left.image.id).localeCompare(String(right.image.id)));
      const best = ranked[0] || null;
      const runnerUp = ranked[1] || null;
      return {
        ...entry,
        ranked,
        strength: (best?.signals || []).some((signal) => ["sku-exact", "title-exact"].includes(signal)) ? 1 : 0,
        score: best?.score || 0,
        margin: (best?.score || 0) - (runnerUp?.score || 0),
      };
    })
    .sort((left, right) => right.strength - left.strength || right.score - left.score || right.margin - left.margin || left.variantIndex - right.variantIndex);

  for (const entry of pending) {
    const unused = entry.ranked.find((candidate) => !usedMediaIds.has(candidate.image.id));
    const selected = unused || (images.length < variants.length ? entry.ranked[0] : null);
    if (!selected?.image?.id) continue;
    const deterministic = selected.signals?.some(isDeterministicImageSignal);
    if (!deterministic && !allowGuesses) continue;
    assignments.set(entry.variantIndex, {
      mediaId: selected.image.id,
      reason: deterministic ? "multi-signal-match" : "forced-guess",
      confidence: deterministic && selected.score >= 40 ? "high" : "low",
      score: selected.score,
      scoreMargin: entry.margin,
      signals: selected.signals,
      rationale: deterministic
        ? `Global assignment preserved unique media candidates; signals: ${selected.signals.join(", ") || "none"}.`
        : "No deterministic variant-to-image evidence remained; forced assignment recorded for review.",
    });
    usedMediaIds.add(selected.image.id);
  }
  return assignments;
}

async function buildPlan(snapshotProducts, liveProducts, scopeHandles, options = {}) {
  const snapshotByHandle = new Map(snapshotProducts.map((product) => [normalizeHandleValue(product?.handle), product]));
  const liveFiltered = liveProducts.filter((product) => {
    const handle = normalizeHandleValue(product?.handle);
    if (!handle) return false;
    if (!scopeHandles) return true;
    return scopeHandles.has(handle);
  });

  const fingerprint = planFingerprint(snapshotProducts, liveProducts, scopeHandles);
  const priorCheckpoint = await loadPlanCheckpoint(options.checkpointPath, fingerprint, options.resume);
  const plansByHandle = new Map((priorCheckpoint?.plans || []).map((plan) => [plan.handle, plan]));
  const pendingLiveProducts = liveFiltered.filter((product) => !plansByHandle.has(normalizeHandleValue(product?.handle)));
  let completedSinceCheckpoint = 0;
  let checkpointWrite = Promise.resolve();
  const persist = (status = "running") => {
    checkpointWrite = checkpointWrite.then(() => writePlanCheckpoint(
      options.checkpointPath,
      fingerprint,
      scopeHandles ? "new-products" : "all-products",
      plansByHandle,
      liveFiltered.length,
      status,
    ));
    return checkpointWrite;
  };

  try {
    await concurrentExecutor(pendingLiveProducts.map((liveProduct) => async () => {
    const handle = normalizeHandleValue(liveProduct?.handle);
    const snapshotProduct = snapshotByHandle.get(handle) || liveProduct;
    const productImages = buildProductImages(liveProduct?.media?.nodes || [], snapshotProduct, liveProduct);
    const variants = Array.isArray(snapshotProduct?.variants) && snapshotProduct.variants.length
      ? snapshotProduct.variants
      : (Array.isArray(liveProduct?.variants?.nodes) ? liveProduct.variants.nodes : []);
    const updates = [];
    const skipped = [];
    const deterministicAssignments = assignDeterministicMappings(variants, productImages);

    let vision = null;
    let visionError = "";
    const visionEligible = options.vision && productNeedsVisualVerification(
      snapshotProduct,
      productImages,
      variants,
      liveProduct,
      deterministicAssignments,
    );
    if (debugHandle && handle === debugHandle) {
      process.stdout.write(`DEBUG vision=${options.vision} enabled=${visionEnabled} images=${productImages.length} variants=${variants.length} source=${variants.map((variant) => variant?.featured_image?.id || variant?.image_id || "").join(",")} eligible=${visionEligible} text=${variants.map(variantText).join(" | ")}\n`);
    }
    if (visionEligible) {
      try {
        vision = await visionGate(() => classifyVariantImagesWithVision(snapshotProduct, variants, productImages));
      } catch (error) {
        visionError = normalizePlainText(error?.message || error);
      }
    }

    const assignments = assignVariantImages(
      variants,
      productImages,
      snapshotProduct,
      vision,
      options.forceGuesses,
      deterministicAssignments,
    );
    for (let variantIndex = 0; variantIndex < variants.length; variantIndex += 1) {
      const variant = variants[variantIndex];
      const assignment = assignments.get(variantIndex);
      const variantId = variantIdForGraphql(variant);
      if (!assignment?.mediaId || !variantId) {
        skipped.push({ variantId, reason: "no-image-candidate", visionError });
        continue;
      }
      const image = productImages.find((candidate) => candidate.id === assignment.mediaId);
      if (!image?.url) {
        skipped.push({ variantId, reason: "candidate-not-in-live-product-media", mediaId: assignment.mediaId });
        continue;
      }
      const currentUrl = currentVariantImageUrl(variant, snapshotProduct);
      if (currentUrl && imageUrlKey(currentUrl) === imageUrlKey(image.url)) {
        skipped.push({ variantId, reason: "already-aligned", mediaId: assignment.mediaId, source: assignment.reason });
        continue;
      }
      updates.push({
        id: variantId,
        mediaId: assignment.mediaId,
        reason: assignment.reason,
        confidence: assignment.confidence || "low",
        visualConfidence: assignment.visualConfidence || null,
        rationale: assignment.rationale || "",
        expectedPrice: variant?.price != null ? String(variant.price) : "",
      });
    }

    const plan = {
      handle,
      productId: String(liveProduct?.id || productIdForGraphql(snapshotProduct)),
      title: normalizePlainText(liveProduct?.title || snapshotProduct?.title || ""),
      updates,
      skipped,
      visionUsed: Boolean(vision),
      visionError,
      variantsConsidered: variants.length,
      prices: variants.map((variant) => ({ id: String(variant?.id || ""), price: variant?.price != null ? String(variant.price) : "" })),
    };
    plansByHandle.set(handle, plan);
    completedSinceCheckpoint += 1;
    if (completedSinceCheckpoint % checkpointInterval === 0) await persist();
    return plan;
    }), planConcurrency, 0);
  } catch (error) {
    await persist("interrupted");
    throw error;
  }

  await persist("complete");

  const evaluatedProducts = liveFiltered
    .map((product) => plansByHandle.get(normalizeHandleValue(product?.handle)))
    .filter(Boolean);
  const plannedProducts = evaluatedProducts.filter((product) => product.updates.length);

  return {
    plannedProducts,
    evaluatedProducts,
    fingerprint,
    summary: {
      productsConsidered: liveFiltered.length,
      productsWithUpdates: plannedProducts.length,
      mappedVariants: plannedProducts.reduce((total, product) => total + product.updates.length, 0),
      skippedVariants: evaluatedProducts.reduce((total, product) => total + product.skipped.length, 0),
      variantsConsidered: evaluatedProducts.reduce((total, product) => total + product.variantsConsidered, 0),
      visionVerifiedProducts: evaluatedProducts.filter((product) => product.visionUsed).length,
      visionFailures: evaluatedProducts.filter((product) => product.visionError).length,
      forcedGuessVariants: plannedProducts.reduce((total, product) => total + product.updates.filter((variant) => variant.reason === "forced-guess").length, 0),
      deterministicVariants: plannedProducts.reduce((total, product) => total + product.updates.filter((variant) => variant.reason !== "forced-guess" && variant.reason !== "supervised-vision").length, 0),
      supervisedVisionVariants: plannedProducts.reduce((total, product) => total + product.updates.filter((variant) => variant.reason === "supervised-vision").length, 0),
    },
  };
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

async function uploadBulkInput(inputPath) {
  const data = await executeGraphQl(STAGED_UPLOAD_CREATE_MUTATION, {
    input: [{
      resource: "BULK_MUTATION_VARIABLES",
      filename: basename(inputPath),
      mimeType: "text/jsonl",
      httpMethod: "POST",
    }],
  }, { mutation: true, operation: "variant image staged upload" });
  const errors = Array.isArray(data?.stagedUploadsCreate?.userErrors) ? data.stagedUploadsCreate.userErrors : [];
  if (errors.length) throw new Error(`Variant image staged upload failed: ${errors.map((error) => error.message).join(" | ")}`);
  const target = data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target?.url) throw new Error("Shopify returned no variant image staged upload target");
  const curlArgs = ["-sS", "-X", "POST", target.url];
  for (const parameter of target.parameters || []) curlArgs.push("-F", `${parameter.name}=${parameter.value}`);
  curlArgs.push("-F", `file=@${inputPath};type=text/jsonl`);
  await execFileAsync("curl", curlArgs, { cwd: rootDir, maxBuffer: 20 * 1024 * 1024 });
  const stagedUploadPath = (target.parameters || []).find((parameter) => parameter.name === "key")?.value;
  if (!stagedUploadPath) throw new Error("Variant image staged upload target had no key");
  return stagedUploadPath;
}

async function waitForBulkOperation(operationId) {
  const activeStatuses = new Set(["CREATED", "RUNNING"]);
  let operation = null;
  while (true) {
    const data = await executeGraphQl(BULK_OPERATION_STATUS_QUERY, { id: operationId }, {
      operation: "variant image bulk status",
    });
    operation = data?.bulkOperation;
    if (!operation) throw new Error(`Variant image bulk operation not found: ${operationId}`);
    process.stdout.write(`Variant image bulk operation ${operation.status}: ${operation.objectCount || 0} record(s)\n`);
    if (operation.status === "COMPLETED") return operation;
    if (["FAILED", "CANCELED", "EXPIRED"].includes(operation.status)) {
      throw new Error(`Variant image bulk operation ended ${operation.status}: ${operation.errorCode || "unknown error"}`);
    }
    if (!activeStatuses.has(operation.status)) throw new Error(`Variant image bulk operation ended ${operation.status || "unknown"}`);
    await sleep(5000);
  }
}

async function applyBulk(plannedProducts, outputPath) {
  const inputPath = outputPath.replace(/\.json$/i, "-bulk-input.jsonl");
  const resultPath = outputPath.replace(/\.json$/i, "-bulk-result.jsonl");
  const lines = plannedProducts.map((product) => JSON.stringify({
    productId: product.productId,
    variants: product.updates.map((variant) => ({ id: variant.id, mediaId: variant.mediaId })),
  }));
  await writeFile(inputPath, `${lines.join("\n")}\n`, "utf8");
  process.stdout.write(`Prepared ${lines.length} variant image bulk inputs (${plannedProducts.reduce((total, product) => total + product.updates.length, 0)} variant writes)\n`);
  const stagedUploadPath = await uploadBulkInput(inputPath);
  const started = await executeGraphQl(BULK_OPERATION_RUN_MUTATION, {
    mutation: BULK_VARIANT_IMAGE_MUTATION,
    stagedUploadPath,
  }, { mutation: true, operation: "start variant image bulk mutation" });
  const startErrors = Array.isArray(started?.bulkOperationRunMutation?.userErrors)
    ? started.bulkOperationRunMutation.userErrors
    : [];
  if (startErrors.length) throw new Error(`Variant image bulk mutation failed to start: ${startErrors.map((error) => error.message).join(" | ")}`);
  const operationId = started?.bulkOperationRunMutation?.bulkOperation?.id;
  if (!operationId) throw new Error("Shopify returned no variant image bulk operation id");
  const operation = await waitForBulkOperation(operationId);
  if (!operation.url) throw new Error("Variant image bulk operation returned no result URL");
  await execFileAsync("curl", ["-sS", "-L", operation.url, "-o", resultPath], {
    cwd: rootDir,
    maxBuffer: 20 * 1024 * 1024,
  });
  const resultLines = (await readFile(resultPath, "utf8")).split(/\r?\n/).filter(Boolean);
  const resultsByLine = new Map();
  resultLines.forEach((line, index) => {
    const payload = JSON.parse(line);
    const lineNumber = Number.isInteger(Number(payload?.__lineNumber))
      ? Number(payload.__lineNumber)
      : index;
    resultsByLine.set(lineNumber, payload);
  });
  const applied = [];
  const failures = [];
  for (let index = 0; index < lines.length; index += 1) {
    const payload = resultsByLine.get(index) || null;
    if (!payload) {
      failures.push({ handle: plannedProducts[index].handle, reason: "bulk-result-missing" });
      continue;
    }
    const errors = [
      ...(Array.isArray(payload.errors) ? payload.errors : []),
      ...(Array.isArray(payload?.data?.productVariantsBulkUpdate?.userErrors)
        ? payload.data.productVariantsBulkUpdate.userErrors
        : []),
    ];
    if (errors.length) failures.push({ handle: plannedProducts[index].handle, errors });
    else applied.push(plannedProducts[index].handle);
  }
  return {
    applied,
    failures,
    bulkOperation: { id: operation.id, status: operation.status, objectCount: Number(operation.objectCount || 0), inputPath, resultPath },
  };
}

async function applyBatches(plannedProducts, outputPath = defaultOutputPath) {
  if (useBulkApply && plannedProducts.length >= bulkApplyThreshold) {
    return applyBulk(plannedProducts, outputPath);
  }
  const totalProducts = plannedProducts.length;
  const tasks = [];

  for (let index = 0; index < totalProducts; index += maxBatchProducts) {
    const batch = plannedProducts.slice(index, index + maxBatchProducts);
    const batchIndex = index;

    tasks.push(async () => {
      const declarations = [];
      const fields = [];
      const variables = {};

      batch.forEach((product, productIndex) => {
        declarations.push(`$p${productIndex}: ID!`, `$v${productIndex}: [ProductVariantsBulkInput!]!`);
        variables[`p${productIndex}`] = product.productId;
        variables[`v${productIndex}`] = product.updates.map((variant) => ({ id: variant.id, mediaId: variant.mediaId }));
        fields.push(
          `p${productIndex}: productVariantsBulkUpdate(productId: $p${productIndex}, variants: $v${productIndex}) { userErrors { field message } }`,
        );
      });

      const response = await executeGraphQl(
        `mutation VariantImageMappingBatch(${declarations.join(", ")}) { ${fields.join(" ")} }`,
        variables,
        { mutation: true, operation: `variant image batch ${batchIndex + 1}` },
      );

      const batchApplied = [];
      const batchFailures = [];

      batch.forEach((product, productIndex) => {
        const payload = response?.[`p${productIndex}`];
        const errors = Array.isArray(payload?.userErrors) ? payload.userErrors : [];
        if (errors.length) {
          batchFailures.push({ handle: product.handle, errors });
        } else {
          batchApplied.push(product.handle);
        }
      });

      return { applied: batchApplied, failures: batchFailures };
    });
  }

  process.stdout.write(`Applying ${tasks.length} batches with concurrency ${applyConcurrency}...\n`);
  const batchResults = await concurrentExecutor(tasks, applyConcurrency, interBatchDelayMs);

  const applied = [];
  const failures = [];
  for (const result of batchResults) {
    applied.push(...result.applied);
    failures.push(...result.failures);
  }

  return { applied, failures };
}

async function runBulkLiveReadback(manifestPath) {
  const readbackPath = manifestPath.replace(/\.json$/i, "-live-readback.json");
  try {
    await execFileAsync(process.execPath, [
      resolve(rootDir, "scripts", "verify-shopify-variant-image-mapping.mjs"),
      "--manifest",
      manifestPath,
      "--output",
      readbackPath,
    ], {
      cwd: rootDir,
      env: { ...process.env, SALT_CATALOG_PRICE_FLOOR: process.env.SALT_CATALOG_PRICE_FLOOR || "35" },
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (error) {
    try {
      await readFile(readbackPath, "utf8");
    } catch {
      throw new Error(`Variant image live readback failed: ${error.message || error}`);
    }
  }
  return JSON.parse(await readFile(readbackPath, "utf8"));
}

async function verifyProducts(plannedProducts) {
  process.stdout.write(`Verifying ${plannedProducts.length} products with concurrency ${verifyConcurrency}...\n`);

  const tasks = plannedProducts.map((product) => async () => {
    const live = await executeGraphQl(
      `
      query VariantImageMappingVerify($id: ID!) {
        node(id: $id) {
          ... on Product {
            id
            handle
            variants(first: 250) {
              nodes {
                id
                title
                price
                compareAtPrice
                media(first: 1) {
                  nodes {
                    __typename
                    id
                  }
                }
              }
            }
          }
        }
      }
      `,
      { id: product.productId },
      { operation: `variant image verification ${product.handle}` },
    );
    const nodes = live?.node?.variants?.nodes || [];
    const productFailures = [];
    for (const update of product.updates) {
      const actual = nodes.find((variant) => String(variant?.id || "") === update.id);
      const actualMediaId = getVariantMediaId(actual);
      if (!actual || actualMediaId !== update.mediaId) {
        productFailures.push({ handle: product.handle, variantId: update.id, expected: update.mediaId, actual: actualMediaId });
      }
      if (actual && update.expectedPrice && String(actual.price || "") !== update.expectedPrice) {
        productFailures.push({
          handle: product.handle,
          variantId: update.id,
          reason: "price-readback-mismatch",
          expectedPrice: update.expectedPrice,
          actualPrice: String(actual.price || ""),
        });
      }
    }
    return productFailures;
  });

  const nestedFailures = await concurrentExecutor(tasks, verifyConcurrency);
  return nestedFailures.flat();
}

async function main() {
  const args = parseArgs(process.argv);
  const [snapshot, scopeHandles] = await Promise.all([
    loadSnapshot(args.inputPath),
    args.scope === "new-products" ? loadHandles(args.handlesPath) : Promise.resolve(null),
  ]);
  const scopedProductIds = scopeHandles
    ? (snapshot.products || [])
        .filter((product) => scopeHandles.has(normalizeHandleValue(product?.handle)))
        .map(productIdForGraphql)
        .filter(Boolean)
    : (snapshot.products || []).map(productIdForGraphql).filter(Boolean);
  if (scopeHandles && !scopedProductIds.length) {
    throw new Error("New-products scope handles did not resolve to any local product IDs");
  }
  if (!scopedProductIds.length) {
    throw new Error("All-products scope did not resolve to any local product IDs");
  }
  const cachedLiveProducts = await loadMediaCache(args.mediaCachePath, scopedProductIds);
  const liveProducts = cachedLiveProducts || await fetchLiveProductMediaByIds(scopedProductIds, args.mediaCachePath);
  if (!cachedLiveProducts) {
    await writeJsonAtomic(args.mediaCachePath, {
      generatedAt: new Date().toISOString(),
      mediaPagesComplete: true,
      products: liveProducts,
    });
  }

  const { plannedProducts, summary, fingerprint } = await buildPlan(snapshot.products || [], liveProducts, scopeHandles, {
    vision: args.vision,
    forceGuesses: args.forceGuesses,
    checkpointPath: args.checkpointPath,
    resume: args.resume,
  });
  const manifest = {
    startedAt: new Date().toISOString(),
    completedAt: "",
    mode: args.mode,
    scope: args.scope,
    summary,
    policy: {
      currentVariantMediaWasNotTrusted: true,
      supervisedVisionEnabled: args.vision,
      forcedGuessesEnabled: args.forceGuesses,
      visualVerificationModel: args.vision ? visionModel : null,
      priceReadback: "compare every changed variant against the frozen catalog price",
      deterministicEvidencePrecedesVision: true,
      currentShopifyVariantMediaUsedAsHintOnly: true,
      planFingerprint: fingerprint,
      resumableCheckpoint: args.checkpointPath,
      resumeRequested: args.resume,
    },
    products: plannedProducts,
    failures: [],
  };

  if (args.mode === "dry-run") {
    await writeJsonAtomic(args.outputPath, manifest);
    process.stdout.write(
      `Variant image mapping dry-run complete: ${summary.productsWithUpdates} products, ${summary.mappedVariants} variant image association(s).\n`,
    );
    return;
  }

  const applyResult = await applyBatches(plannedProducts, args.outputPath);
  const { applied, failures } = applyResult;
  if (applyResult.bulkOperation) manifest.bulkOperation = applyResult.bulkOperation;
  manifest.failures.push(...failures);
  manifest.appliedHandles = applied;
  manifest.summary.appliedProducts = applied.length;
  if (!failures.length && applyResult.bulkOperation) {
    await writeJsonAtomic(args.outputPath, manifest);
    const liveReadback = await runBulkLiveReadback(args.outputPath);
    manifest.liveReadback = liveReadback;
    manifest.summary.priceReadbackMismatches = liveReadback.summary.priceMismatches;
    manifest.summary.priceFloorViolations = liveReadback.summary.priceFloorViolations;
    manifest.failures.push(...liveReadback.failures.filter((failure) => failure.reason !== "price-readback-mismatch"));
  } else if (!failures.length) {
    const verificationFailures = await verifyProducts(plannedProducts.filter((product) => applied.includes(product.handle)));
    manifest.failures.push(...verificationFailures);
  }
  manifest.completedAt = new Date().toISOString();
  manifest.summary.failedProducts = manifest.failures.length;
  await writeJsonAtomic(args.outputPath, manifest);

  if (manifest.failures.length) {
    throw new Error(`Variant image mapping failed for ${manifest.failures.length} product(s)`);
  }

  process.stdout.write(
    `Variant image mapping complete: ${summary.productsWithUpdates} products updated, ${summary.mappedVariants} variant image association(s).\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch(async (error) => {
    try {
      await rm(`${defaultOutputPath}.${process.pid}.tmp`, { force: true });
    } catch {}
    console.error(error.message || error);
    process.exit(1);
  });
}

export {
  assignVariantImages,
  buildProductImages,
  productNeedsVisualVerification,
  scoreImageMatch,
};
