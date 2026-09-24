#!/usr/bin/env node

import { access, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";

import { assessProductContentSpecificity } from "../src/lib/product-content-specificity.js";
import {
  buildSeoBatchPlan,
  createSeoCatalogContext,
} from "../src/lib/shopify-seo-batch-intelligence.js";
import { normalizeHandleValue, normalizePlainText } from "../src/lib/shopify-seo-batch.js";
import { mapWithConcurrency, recommendedConcurrency, sleep } from "./lib/performance-runtime.mjs";
import { loadFutureLightEnv } from "./lib/future-light-env.mjs";
import { createShopifyAdminGraphQLClient } from "./shopify-admin-graphql-client.mjs";
import { readCatalogKnowledgeModel } from "./catalog-knowledge-model-files.mjs";
import { readProductCatalogPayload } from "./product-catalog-files.mjs";
import {
  canonicalImageUrl,
  FUTURE_LIGHT_SCOPE,
  IMAGE_HEALTH_SCHEMA_VERSION,
} from "./lib/product-image-health.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const inputDir = resolve(rootDir, "public", "data");
const defaultOutputDir = resolve(rootDir, "output", "future-light-seo-gpt-200");
const scopedHandleArgs = readHandleScopeFromArgv();
const outputDir = scopedHandleArgs.length
  ? resolve(rootDir, "output", "future-light-seo-gpt-200-scoped", `scope-${createHash("sha256").update(scopedHandleArgs.join("\n")).digest("hex").slice(0, 16)}`)
  : defaultOutputDir;
const statePath = resolve(outputDir, "state.json");
const manifestPath = resolve(outputDir, "manifest.json");
const lockPath = resolve(outputDir, "run.lock");
const overridesPath = resolve(rootDir, "config", "future-light-seo-overrides.json");
const imageHealthManifestPath = resolve(rootDir, "output", "future-light-image-health-queue.json");
const ACTIVE_PRODUCTS_QUERY = /* GraphQL */ `
  query FutureLightActiveProducts($after: String) {
    products(first: 250, after: $after, query: "status:active") {
      nodes {
        id
        handle
        title
        descriptionHtml
        productType
        status
        tags
        vendor
        seo {
          title
          description
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const PRODUCT_UPDATE_MUTATION = /* GraphQL */ `
  mutation FutureLightSeoProductUpdate($p0: ProductUpdateInput!) {
    p0: productUpdate(product: $p0) {
      product {
        id
        handle
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_READBACK_QUERY = /* GraphQL */ `
  query FutureLightSeoReadback($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        handle
        title
        descriptionHtml
        productType
        tags
        vendor
        status
        seo {
          title
          description
        }
      }
    }
  }
`;

const GENERIC_WORDS = new Set([
  "a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "is", "of", "on", "or", "the",
  "this", "to", "with", "your", "product", "products", "item", "items", "listing", "shop", "new", "best",
  "premium", "daily", "everyday", "use", "used", "available", "options", "option", "specific", "practical",
]);

function readHandleScopeFromArgv(argv = process.argv) {
  const handles = [];
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] !== "--handle" && argv[index] !== "--handles") continue;
    handles.push(...String(argv[index + 1] || "").split(",").map((handle) => normalizeHandleValue(handle)).filter(Boolean));
    index += 1;
  }
  return [...new Set(handles)];
}

function parseArgs(argv) {
  const args = {
    mode: "dry-run",
    resume: false,
    forceReplan: false,
    batchSize: 200,
    maxBatches: 0,
    limit: 0,
    retryFailed: false,
    handles: [],
    gpt: true,
    model: "",
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--apply") args.mode = "apply";
    else if (token === "--dry-run") args.mode = "dry-run";
    else if (token === "--resume") args.resume = true;
    else if (token === "--force-replan") args.forceReplan = true;
    else if (token === "--retry-failed") args.retryFailed = true;
    else if (token === "--no-gpt") args.gpt = false;
    else if (token === "--batch-size") {
      args.batchSize = Math.min(200, Math.max(1, Number(argv[++index] || 200) || 200));
    } else if (token === "--max-batches") {
      args.maxBatches = Math.max(0, Number(argv[++index] || 0) || 0);
    } else if (token === "--limit") {
      args.limit = Math.max(0, Number(argv[++index] || 0) || 0);
    } else if (token === "--handle" || token === "--handles") {
      args.handles = String(argv[++index] || "")
        .split(",")
        .map((handle) => normalizeHandleValue(handle))
        .filter(Boolean);
    } else if (token === "--model") {
      args.model = normalizePlainText(argv[++index] || "");
    }
  }

  return args;
}

function now() {
  return new Date().toISOString();
}

async function writeJsonAtomic(filePath, payload) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function acquireLock() {
  await mkdir(outputDir, { recursive: true });
  const payload = { pid: process.pid, startedAt: now(), command: process.argv.slice(2) };
  try {
    await writeFile(lockPath, `${JSON.stringify(payload)}\n`, { flag: "wx" });
    return;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }

  const existing = await readJson(lockPath, null);
  if (existing && isProcessAlive(Number(existing.pid))) {
    throw new Error(`Future Light SEO runner is already active (pid ${existing.pid}). Resume the existing run instead of starting a duplicate.`);
  }
  await unlink(lockPath).catch(() => {});
  await writeFile(lockPath, `${JSON.stringify(payload)}\n`, { flag: "wx" });
}

async function releaseLock() {
  await unlink(lockPath).catch(() => {});
}

function isNetworkError(error) {
  return /429|rate limit|throttl|timeout|timed out|5\d\d|network|socket|temporar|aborted|enotfound|eai_again|getaddrinfo|dns|bad gateway|gateway timeout|service unavailable|upstream/i.test(
    String(error?.message || error),
  );
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;|&#38;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&mdash;|&#8212;/gi, "—")
    .replace(/&ndash;|&#8211;/gi, "–")
    .replace(/&hellip;|&#8230;/gi, "…")
    .replace(/&lt;|&#60;/gi, "<")
    .replace(/&gt;|&#62;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function comparableText(value) {
  return normalizePlainText(stripHtml(value)).toLowerCase();
}

function comparableValue(value) {
  return normalizePlainText(value).replace(/\s+/g, " ");
}

function formatErrors(errors) {
  return (Array.isArray(errors) ? errors : [])
    .map((entry) => `${Array.isArray(entry?.field) ? entry.field.join(".") : ""} ${entry?.message || "Shopify user error"}`.trim())
    .filter(Boolean)
    .join("; ");
}

function usefulAnchorWords(product) {
  const raw = normalizePlainText(`${product?.title || ""} ${product?.handle || ""}`)
    .replace(/[-_]+/g, " ")
    .toLowerCase();
  return [...new Set(raw.split(/\s+/).filter((word) => word.length >= 3 && !GENERIC_WORDS.has(word) && !/^\d+$/.test(word)))]
    .slice(0, 5)
    .join(" ");
}

function titleCaseWords(value) {
  return normalizePlainText(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      if (["usb", "dji", "tws", "anc", "led", "rca", "aux", "ip", "eu", "uk", "us"].includes(lower)) return lower.toUpperCase();
      if (["kz", "edx", "tv"].includes(lower)) return lower.toUpperCase();
      if (lower === "wifi") return "Wi-Fi";
      if (/^(?:e|x|f)?\d+[a-z]*$/i.test(word)) return word.toUpperCase();
      if (/^\d+(?:mm|cm|ml|oz|v|a|w|mah|gb|tb)$/i.test(word)) return word.replace(/([a-z]+)$/i, (match) => match.toLowerCase());
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function shortenTitle(value, maxLength) {
  const text = normalizePlainText(value);
  if (text.length <= maxLength) return text;
  const shortened = text.slice(0, maxLength + 1).replace(/\s+\S*$/, "").trim();
  return shortened || text.slice(0, maxLength).trim();
}

function escapeHtmlText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function informativeTitleTokens(item, baseTitle) {
  const generic = new Set([
    ...GENERIC_WORDS,
    "new", "high", "quality", "fashion", "beautiful", "suitable", "compatible", "support", "supported", "for",
    "with", "without", "long", "lasting", "portable", "professional", "natural", "style", "design", "format",
  ]);
  const baseTokens = new Set(normalizePlainText(baseTitle).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  // Prefer the immutable Shopify handle over the current title. Titles may
  // already contain a prior disambiguation suffix; using them first causes
  // that suffix to snowball into the next release.
  const source = normalizePlainText(`${item.handle || ""} ${item.sourceTitle || ""}`).replace(/[-_]+/g, " ");
  const tokens = source
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9.]+/gi, ""))
    .filter((token) => token.length >= 2 && !/^\d+$/.test(token) && !generic.has(token.toLowerCase()))
    .filter((token) => !baseTokens.has(token.toLowerCase()))
    .filter((token, index, values) => values.findIndex((entry) => entry.toLowerCase() === token.toLowerCase()) === index);
  return tokens.slice(0, 5);
}

const DISTINCT_NOISE_WORDS = new Set([
  "box", "storage", "organizer", "holder", "case", "display", "travel", "portable", "option", "options",
  "listing", "details", "detail", "format", "product", "item", "accessory", "accessories", "piece", "pieces",
  "style", "styles", "top", "tops", "bag", "bags", "watch", "watches", "wristwatch", "wristwatches", "shirt", "shirts",
  "women", "womens", "woman", "female", "men", "mens", "man", "male", "ladies", "gentleman", "gentlemen",
  "kid", "kids", "child", "children", "pajama", "pajamas", "sleepwear", "robe", "bathrobe", "kimono", "gown", "set", "sets",
  "new", "fashion", "high", "quality", "premium", "suitable", "compatible", "unisex", "brand", "supplier", "original",
]);

function distinctiveEvidenceTokens(item, baseTitle) {
  const baseTokens = new Set(normalizePlainText(baseTitle).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const source = normalizePlainText(`${item.sourceTitle || ""} ${item.handle || ""}`).replace(/[-_]+/g, " ");
  return source
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9.]+/gi, ""))
    .filter((token) => token.length >= 3 && !/^\d+$/.test(token))
    .filter((token) => !GENERIC_WORDS.has(token.toLowerCase()) && !DISTINCT_NOISE_WORDS.has(token.toLowerCase()))
    .filter((token) => !baseTokens.has(token.toLowerCase()))
    .filter((token, index, values) => values.findIndex((entry) => entry.toLowerCase() === token.toLowerCase()) === index)
    .slice(0, 4);
}

function distinctSuffixFor(item, baseTitle, duplicateIndex, disambiguator = "") {
  const handle = normalizePlainText(item?.handle || "").toLowerCase().replace(/[-_]+/g, " ");
  const controlledSuffix = /\bkz edx\b/i.test(handle)
    ? /\bmetal\b/i.test(handle) ? "Metal Housing" : /\bdynamic drive\b/i.test(handle) ? "Dynamic Driver" : /\bwired\b/i.test(handle) ? "Wired" : "Earphone Edition"
    : /\bm10\b/i.test(handle) && /(?:-1| 1)$/i.test(handle) ? "Style 2"
      : /\bwhite blouse for women 2026\b/i.test(handle) && /(?:-1| 1)$/i.test(handle) ? "Style 2"
        : /(?:eyeliner\s+pencil|eye\s+liner)/i.test(handle) ? `Eyeliner Style ${duplicateIndex + 1}`
          : /(?:hoodie|hooded sweatshirt|pullover.*sweatshirt)/i.test(handle) ? `Hoodie Style ${duplicateIndex + 1}`
        : "";
  const suffixTokens = distinctiveEvidenceTokens(item, baseTitle)
    .filter((token) => !/^(?:kid|kids|child|children|pajama|pajamas|sleepwear|robe|bathrobe|kimono|gown|set|sets)$/i.test(token))
    .slice(0, 3);
  const marker = disambiguator ? `Style ${disambiguator}` : "";
  const evidenceSuffix = titleCaseWords(suffixTokens.join(" "));
  const baseSuffix = controlledSuffix
    || (/\b(?:kid|kids|child|children|pajama|pajamas|sleepwear|robe|bathrobe|kimono|gown)\b/i.test(evidenceSuffix) ? "" : evidenceSuffix)
    || `Style ${duplicateIndex + 1}`;
  const suffixBudget = 44;
  if (!marker) return shortenTitle(baseSuffix, suffixBudget);
  const baseBudget = Math.max(8, suffixBudget - marker.length - 1);
  return `${shortenTitle(baseSuffix, baseBudget)} ${marker}`.trim();
}

function distinctTitleFor(item, baseTitle, duplicateIndex, disambiguator = "") {
  const suffix = distinctSuffixFor(item, baseTitle, duplicateIndex, disambiguator);
  const availableBaseLength = Math.max(20, 70 - suffix.length - 3);
  const prefix = shortenTitle(baseTitle, availableBaseLength);
  return `${prefix} — ${suffix}`.trim().slice(0, 70).trim();
}

function distinctSeoTitleFor(item, baseTitle, duplicateIndex, disambiguator = "") {
  const suffix = distinctSuffixFor(item, baseTitle, duplicateIndex, disambiguator) || `Option ${duplicateIndex + 1}`;
  const availableBaseLength = Math.max(20, 70 - suffix.length - 3);
  const prefix = shortenTitle(baseTitle, availableBaseLength);
  return `${prefix} — ${suffix}`.trim().slice(0, 70).trim();
}

function regenerateDistinctSeoDescription(item, duplicateIndex) {
  const title = polishDeterministicTitle(item.desired.title, item);
  const base = naturalDeterministicSeoDescription(item);
  const anchor = titleCaseWords(distinctiveEvidenceTokens(item, title).slice(0, 3).join(" ")) || "product details";
  const suffixes = [
    `Review the ${anchor.toLowerCase()} details before ordering.`,
    `Check the ${anchor.toLowerCase()} fit before ordering.`,
    `Choose the ${anchor.toLowerCase()} finish shown on this page.`,
    "Check the photos, fit, and care details before ordering.",
  ];
  const prefix = `Shop ${title} at VS Store.`;
  const candidates = suffixes.map((suffix) => {
    const budget = 158 - prefix.length - 1;
    const lead = compactMetaLead(item, title);
    const parts = [prefix, lead, suffix].filter(Boolean);
    let result = parts[0];
    for (const part of parts.slice(1)) {
      if (result.length >= 120) break;
      const remaining = 158 - result.length - 1;
      if (remaining < 18) break;
      const safe = part.length <= remaining ? part : trimMetaSentence(part, remaining);
      if (safe.length >= 18 && !/\b(?:and|or|with|for|to|of|the|a|an)\.?$/i.test(safe)) result += ` ${safe.replace(/[.!?]?$/, ".")}`;
    }
    if (result.length < 120 && base !== result) {
      const remaining = 158 - result.length - 1;
      const extra = trimMetaSentence("Check the product photos and care details before ordering.", remaining);
      if (extra.length >= 18) result += ` ${extra.replace(/[.!?]?$/, ".")}`;
    }
    return result;
  });
  return candidates.find((candidate) => candidate.length >= 120 && candidate.length <= 158)
    || candidates[duplicateIndex % candidates.length]
    || base;
}

// The deterministic path is used when the optional OpenAI API key is not
// configured.  It must still produce customer-facing copy, not a uniqueness
// marker disguised as SEO.  In particular, "option 9" and "compare the ..."
// are implementation artefacts that do not help a shopper understand a
// product.  This normalizer keeps the already approved product identity and
// facts, then rewrites only the presentation layer.
function polishDeterministicTitle(value, item = null) {
  const source = normalizePlainText(`${item?.handle || ""} ${item?.sourceTitle || ""}`)
    .replace(/[-_]+/g, " ")
    .toLowerCase();
  const guardedTitle = (() => {
    if (/eyeliner\s+pencil|eye\s+liner/.test(source)) return "Waterproof Eyeliner Pencil";
    if (/mijia.*(?:nose|ear).*hair\s+trimmer/.test(source)) return "Mijia Rechargeable Nose and Ear Hair Trimmer";
    if (/dog hair clipper|pet hair trimmer/.test(source)) return "Electric Dog Hair Clipper";
    if (/mini.*music.*electronic piano.*keychain/.test(source)) return "Mini Music Keyboard Keychain";
    if (/invisible selfie stick.*insta360/.test(source)) return "Insta360 Invisible Selfie Stick Tripod";
    if (/screen auto clicker/.test(source)) return "Smartphone Screen Auto Clicker";
    if (/ambitful.*light stand tripod/.test(source)) return "Ambitful 2m Studio Light Stand Tripod";
    if (/fgclsy.*selfie stick tripod/.test(source)) return "FGCLSY Bluetooth Selfie Stick Tripod";
    if (/fouvor.*(?:outdoor )?backpack/.test(source)) return "Fouvor Waterproof Outdoor Backpack";
    if (/womens handbag.*crossbody.*backpack/.test(source)) return "Women's Crossbody Handbag Backpack";
    if (/anime related.*(?:brooch|badges)/.test(source)) return "Anime Enamel Brooch Lapel Pin";
    if (/anime keychain.*cat/.test(source)) return "Anime Cat Keychain Accessory";
    if (/fitness keychain/.test(source)) return "Sports Fitness Keychain";
    if (/pink love ring.*airpods/.test(source)) return "Pink Love Ring AirPods Case";
    if (/for airpods.*(?:earphone case|protective headphone box)/.test(source)) return "Cartoon AirPods Protective Case";
    if (/fashion man.*stand collar shirt.*dress shirts/.test(source)) return "Men's Irregular Button Down Shirt";
    if (/home textile.*doll cloth.*diy dress materials/.test(source)) return "DIY Doll Clothing Textile Fabric";
    if (/casual hoodies.*jogging sweatshirts/.test(source)) return "Men's Casual Hoodie Sweatshirt";
    if (/xiaomi mijia t200.*electric toothbrush/.test(source)) return "Xiaomi Mijia T200 Electric Toothbrush";
    if (/2024 magnetic window cleaner brush/.test(source)) return "Magnetic Window Cleaning Squeegee";
    if (/double sided window cleaner.*squeegee/.test(source)) return "Double-Sided Window Cleaning Squeegee";
    if (/72 226cm extended window cleaning tool/.test(source)) return "Extendable Window Cleaning Squeegee";
    if (/triangle glass wiper.*telescopic rod/.test(source)) return "Triangle Telescopic Window Squeegee";
    if (/(?:aux|audio).*cable.*(?:xh2|terminal)|(?:xh2|terminal).*(?:aux|audio).*cable/.test(source)) return "3.5mm AUX to XH2.54 Audio Cable";
    if (/k20 mechanical keyboard/.test(source)) return "K20 Mechanical Keyboard with Detachable USB Cable";
    if (/hoodie|hooded sweatshirt|pullover.*sweatshirt/.test(source)) {
      const hasWomen = /\b(?:women|womens|woman|ladies|female)\b/.test(source);
      const hasMen = /\b(?:men|mens|man|male)\b/.test(source);
      const audience = hasWomen && hasMen ? "Unisex" : hasWomen ? "Women's" : hasMen ? "Men's" : "";
      return `${audience ? `${audience} ` : ""}Casual Hoodie Sweatshirt`;
    }
    return "";
  })();
  if (guardedTitle) return guardedTitle;
  return normalizePlainText(value)
    .replace(/\s+—\s*Phone\s+/i, " with ")
    .replace(/\s+—\s*For\s*$/i, "")
    .replace(/\s+—\s*With\s*$/i, "")
    .replace(/\bWith\s+Water\s+Resistant\b/gi, "Water-Resistant")
    .replace(/\bWith\s+Waterproof\b/gi, "Waterproof")
    .replace(/\bFor\s+Multiple\b/gi, "For Multiple Models")
    .replace(/\bFor\s+Multiple\s+Models\s+Models\b/gi, "For Multiple Models")
    .replace(/\bIp\b/g, "IP")
    .replace(/\bPtz\b/g, "PTZ")
    .replace(/\bHd\b/g, "HD")
    .replace(/\bCctv\b/g, "CCTV")
    .replace(/\s+([,;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+(?:and|or|with|for|to|of)$/i, "")
    .trim();
}

function bodyParagraphs(value) {
  return [...String(value || "").matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripHtml(match[1]))
    .map((text) => normalizePlainText(text))
    .filter((text) => text && !/^(?:q:|a:|what is\b|what should i check\b)/i.test(text));
}

function bodyFacts(value) {
  return [...String(value || "").matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((match) => normalizePlainText(stripHtml(match[1])))
    .map((text) => {
      const separator = text.indexOf(":");
      if (separator < 0) return { label: "", value: text };
      return { label: normalizePlainText(text.slice(0, separator)), value: normalizePlainText(text.slice(separator + 1)) };
    })
    .filter((entry) => entry.value && !/^product type$/i.test(entry.label))
    .filter((entry, index, values) => values.findIndex((candidate) => candidate.value.toLowerCase() === entry.value.toLowerCase()) === index)
    .slice(0, 4);
}

function cleanDeterministicSentence(value, title) {
  const titleKey = normalizePlainText(title).toLowerCase();
  return normalizePlainText(value)
    .replace(/\bthe additional models listed here\b/gi, "the other compatible models shown in the options")
    .replace(/\bthe additional models\b/gi, "the other compatible models")
    .replace(/\bthe selected option\b/gi, "the version you choose")
    .replace(/\bthe listed option\b/gi, "the version you choose")
    .replace(/\bthe listed options\b/gi, "the available choices")
    .replace(/\bthe listed\b/gi, "the available")
    .replace(/\blisted here\b/gi, "shown in the options")
    .replace(/\buses a water-resistant\b/gi, "has water-resistant features")
    .replace(/\bis a water-resistant\b/gi, "has water-resistant features")
    .replace(/\bwith an audience of ([^,.]+)(?=[,.])/gi, "designed for $1")
    .replace(/\bas a shoes\b/gi, "as footwear")
    .replace(/\bthe product's purpose\b/gi, "its purpose")
    .replace(/\bfollow the care instructions supplied with the product\b/gi, "follow the care instructions included with it")
    .replace(/\baccording to the supplied setup, handling, and care instructions\b/gi, "following the supplied setup and care instructions")
    .replace(/\s+([,.])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+(?:and|or|with|for|to|of|the)$/i, "")
    .replace(new RegExp(`^${titleKey.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*(?:—|&mdash;|:|-)\\s*`, "i"), "")
    .trim();
}

function trimToCompleteSentence(value) {
  const text = normalizePlainText(value)
    .replace(/\b(?:Check|Compare|Confirm)\b[\s\S]*$/i, "")
    .replace(/\s+(?:and|or|with|for|to|of|the|a|an)$/i, "")
    .replace(/[,:;—-]+$/, "")
    .trim();
  if (!text) return "";
  const sentences = text.match(/[^.!?]+[.!?]/g);
  if (sentences?.length) return sentences[0].trim();
  return `${text}.`;
}

function removeTitleEcho(value, title) {
  const text = normalizePlainText(value);
  const titlePattern = title
    ? title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    : "";
  if (!titlePattern) return text;
  return text
    .replace(new RegExp(`^${titlePattern}\\s*(?:—|&mdash;|:|-)?\\s*`, "i"), "")
    .replace(new RegExp(`^(?:This|The)\\s+${titlePattern}\\s+`, "i"), "This ")
    .trim();
}

function detailSentenceForMeta(facts) {
  const details = [];
  for (const fact of facts) {
    const label = fact.label.toLowerCase();
    const value = fact.value;
    if (/device compatibility|compatibility/.test(label)) details.push(`Works with ${value}.`);
    else if (/material/.test(label)) details.push(`Made with ${value}.`);
    else if (/supported features|features/.test(label)) details.push(`Features include ${value}.`);
    else if (/size|capacity|pack format/.test(label)) details.push(`Available in ${value}.`);
    else if (/connection|connector|mounting|arm format/.test(label)) details.push(`The connection uses ${value}.`);
    else if (/use|occasion|placement|setting|style|design|color|pattern/.test(label)) details.push(`Designed for ${value} use.`);
  }
  return [...new Set(details.map((value) => normalizePlainText(value)).filter(Boolean))].slice(0, 2).join(" ");
}

function orderingSentenceForMeta(title) {
  const text = normalizePlainText(title);
  if (/\b(?:shirt|dress|top|pants|jeans|shorts|jacket|hoodie|sweater|shoes|socks|apparel|garment)\b/i.test(text)) {
    return "Use the size guide before ordering.";
  }
  if (/\b(?:case|cover|cable|cord|charger|adapter|holder|mount|tripod|camera|watch|mouse|keyboard|speaker|earbuds?|headphones?)\b/i.test(text)) {
    return "Check the model, connector, and size before ordering.";
  }
  if (/\b(?:lip|lash|makeup|brush|serum|mask|hair|skin|foundation|powder|eyeshadow)\b/i.test(text)) {
    return "Choose the shade or format that suits your routine.";
  }
  return "Check the size and configuration before ordering.";
}

function trimMetaSentence(value, maxLength) {
  const text = normalizePlainText(value);
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, Math.max(0, maxLength)).replace(/\s+\S*$/, "").replace(/[,;:—-]+$/, "").trim();
  return cut
    .replace(/\s+(?:and|or|with|for|to|of|the)(?:\s+(?:a|an|the))?$/i, "")
    .replace(/\s+(?:and|or|with|for|to|of|the)(?:\s+(?:a|an|the))?$/i, "")
    .trim();
}

function compactMetaLead(item, title) {
  const source = normalizePlainText(`${item?.handle || ""} ${item?.sourceTitle || ""}`)
    .replace(/[-_]+/g, " ")
    .toLowerCase();
  if (/k20 mechanical keyboard/.test(source)) return "Detachable USB cable design for compatible mechanical keyboards.";
  if (/xiaomi mijia t200.*electric toothbrush/.test(source)) return "Sonic vibration and water-resistant design for daily brushing.";
  if (/(?:eyeliner\s+pencil|eye\s+liner)/.test(source)) return "Waterproof eye definition in the selected color or liquid format.";
  if (/hoodie|hooded sweatshirt|pullover.*sweatshirt/.test(source)) return "A relaxed hooded layer for casual cooler-weather outfits.";
  if (/articulated arm.*(?:hex|thread)|hex pin.*articulated/.test(source)) return "Three-section positioning with 5/8 hex and female-thread fittings.";
  if (/(?:aux|audio).*cable.*(?:xh2|terminal)|(?:xh2|terminal).*(?:aux|audio).*cable/.test(source)) return "Male-to-male AUX and XH2.54 terminal connection for compatible audio setups.";
  if (/led mask|light therapy face mask/.test(source)) return "Red and blue light modes in a rechargeable face-mask format.";
  if (/phone case|iphone case|tablet case/.test(source)) return "Model-specific protection with the fit and cutouts shown for the case.";
  if (/window cleaner|squeegee|glass wiper/.test(source)) return "A practical window-cleaning format for smooth glass surfaces.";
  if (/backpack|rucksack/.test(source)) return "A carry-ready design with the capacity and features shown for this pack.";
  if (/tumbler|water bottle|thermos|drink bottle/.test(source)) return "Reusable drinkware shaped around the capacity and lid format shown.";
  if (/camera|tripod|phone holder|phone stand|mount/.test(source)) return "A device-ready format with the fittings and configuration shown.";
  if (/dress|shirt|hoodie|blouse|jacket|pants|skirt|apparel/.test(source)) return "A wearable design shaped around the style and fit shown.";
  const noun = title.match(/\b(?:case|cable|charger|holder|mount|brush|bag|watch|bottle|organizer|tool|shirt|dress|mask|keyboard|mouse|tripod)\b/i)?.[0];
  return noun ? `A ${noun.toLowerCase()} format with the details shown for this model.` : "Product details and care guidance are provided for this model.";
}

function naturalDeterministicSeoDescription(item) {
  const title = polishDeterministicTitle(item?.desired?.title || item?.sourceTitle || "Product");
  const paragraphs = bodyParagraphs(item?.desired?.descriptionHtml);
  const facts = bodyFacts(item?.desired?.descriptionHtml);
  let lead = cleanDeterministicSentence(paragraphs[0] || "", title);
  lead = trimToCompleteSentence(removeTitleEcho(lead, title));
  if (!lead || /\b(?:specific function|product details identify|the product serves|generic product)\b/i.test(lead)) {
    lead = `The ${title} is designed for the use described by its product type.`;
  }
  const prefix = `Shop ${title} at VS Store.`;
  const candidates = [prefix, lead, detailSentenceForMeta(facts), orderingSentenceForMeta(title)].filter(Boolean);
  let result = candidates[0];
  for (const sentence of candidates.slice(1)) {
    if (result.length >= 120) break;
    const remaining = 158 - result.length - 1;
    if (remaining < 18) break;
    const addition = sentence.length <= remaining ? sentence : compactMetaLead(item, title);
    const safeAddition = addition.length <= remaining ? addition : trimMetaSentence(addition, remaining);
    if (safeAddition.length >= 18 && !/\b(?:and|or|with|for|to|of|the|a|an)\.?$/i.test(safeAddition)) {
      result += ` ${safeAddition.replace(/[.!?]?$/, ".")}`;
    }
  }
  if (result.length < 120) {
    const fallback = "Choose the version that fits your setup and check the supplied care details.";
    const remaining = 158 - result.length - 1;
    if (remaining >= 18) result += ` ${trimMetaSentence(fallback, remaining).replace(/[.!?]?$/, ".")}`;
  }
  return result.slice(0, 158).replace(/\s+(?:and|or|with|for|to|of|the)\.?$/i, "").replace(/[.!?]?$/, ".");
}

function naturalizeDeterministicBody(value) {
  return String(value || "")
    .replace(/\bThe listing highlights\b/gi, "It includes")
    .replace(/\bthe selected option\b/gi, "the version you choose")
    .replace(/\bthe listed option\b/gi, "the version you choose")
    .replace(/\bthe listed options\b/gi, "the available choices")
    .replace(/\bthe additional models listed here\b/gi, "the other compatible models shown in the choices")
    .replace(/\bthe additional models\b/gi, "the other compatible models")
    .replace(/\bdescribed in the listing\b/gi, "shown for this model")
    .replace(/\bThe listing notes that\b/gi, "The product details note that")
    .replace(/,\s+and an audience of ([^,.]+)(?=[,.])/gi, " for $1")
    .replace(/\bwith an audience of ([^,.]+)(?=[,.])/gi, "designed for $1")
    .replace(/\bas a shoes\b/gi, "as footwear")
    .replace(/\buses a water-resistant\b/gi, "has water-resistant features")
    .replace(/\bthe product's purpose\b/gi, "its purpose")
    .replace(/\bfollow the care instructions supplied with the product\./gi, "follow the care instructions included with it.")
    .replace(/\bKeep it clean and dry between uses, and follow the care instructions included with it\./gi, "Keep it clean and store it as directed.")
    .replace(/\s+([,.])/g, "$1")
    .replace(/\s{2,}/g, " ");
}

function guardedSummaryForItem(item, title) {
  const source = normalizePlainText(`${item?.handle || ""} ${item?.sourceTitle || ""}`)
    .replace(/[-_]+/g, " ")
    .toLowerCase();
  if (/eyeliner\s+pencil|eye\s+liner/.test(source)) {
    return "This waterproof eyeliner pencil adds precise definition along the lash line in the color and liquid format selected. Apply with controlled strokes and remove it with an eye-makeup remover.";
  }
  if (/xiaomi mijia t200.*electric toothbrush/.test(source)) {
    return "This Xiaomi Mijia T200 electric toothbrush uses sonic vibration and a water-resistant design for a focused daily oral-care routine. Check the brush-head and charging details before use.";
  }
  if (/hoodie|hooded sweatshirt|pullover.*sweatshirt/.test(source)) {
    return `This ${title.toLowerCase()} combines a hooded long-sleeve shape with a relaxed everyday style for cooler-weather wear. Check the size, fabric, and care details before ordering.`;
  }
  return "";
}

function syncGuardedBodySummary(item) {
  const title = item.desired.title;
  const summary = guardedSummaryForItem(item, title);
  if (!summary || !item.desired.descriptionHtml) return;
  const escapedTitle = escapeHtmlText(title);
  const escapedSummary = escapeHtmlText(summary);
  item.desired.descriptionHtml = item.desired.descriptionHtml
    .replace(/<p><strong>[^<]*<\/strong>\s*(?:&mdash;|—)[\s\S]*?<\/p>/i, `<p><strong>${escapedTitle}</strong> &mdash; ${escapedSummary}</p>`)
    .replace(/(<p><strong>Q: What is )[^<]*(<\/strong><\/p>)\s*<p>A:\s*[\s\S]*?<\/p>/i, `$1${escapedTitle}?$2<p>A: ${escapedSummary}</p>`);
}

function sourceTextForEditorialCopy(item) {
  // The imported/source title may already contain a previous bad category
  // (for example a camera accessory labelled as apparel). Use the stable
  // Shopify handle as the classifier authority and never let that stale title
  // steer the next rewrite.
  return normalizePlainText(item?.handle || item?.sourceTitle || "")
    .replace(/[-_]+/g, " ")
    .toLowerCase();
}

function audienceLabelForEditorialCopy(source) {
  const women = /\b(?:women|womens|woman|ladies|female)\b/.test(source);
  const men = /\b(?:men|mens|man|male)\b/.test(source);
  if (women && men) return "Unisex";
  if (women) return "Women's";
  if (men) return "Men's";
  if (/\b(?:kids|kid|children|child|baby|boy|boys|girl|girls)\b/.test(source)) return "Kids'";
  return "";
}

function editorialTitleForItem(item, currentTitle) {
  const source = sourceTextForEditorialCopy(item);
  const audience = audienceLabelForEditorialCopy(source);
  const finishWords = [];
  if (/\blinen\b/.test(source)) finishWords.push("Linen");
  else if (/\bcotton\b/.test(source)) finishWords.push("Cotton");
  else if (/\bsilk\b/.test(source)) finishWords.push("Silk");
  else if (/\bleather\b/.test(source)) finishWords.push("Leather");
  if (/\bfloral\b|\bflower\b/.test(source)) finishWords.push("Floral");
  else if (/\bplaid\b|\bcheck(?:ed)?\b/.test(source)) finishWords.push("Plaid");
  else if (/\bstriped?\b|\bstripe\b/.test(source)) finishWords.push("Striped");
  else if (/\bprinted?\b|\bgraphic\b|\bpattern\b/.test(source)) finishWords.push("Printed");

  if (/(?:aux|audio).*cable.*(?:xh2|terminal)|(?:xh2|terminal).*(?:aux|audio).*cable/.test(source)) return "3.5mm AUX to XH2.54 Audio Cable";
  if (/hdmi.*vga|vga.*hdmi/.test(source)) return "HDMI to VGA Adapter with Audio";
  if (/camera cleaning|lens cleaning|air blower|ccd sensor/.test(source)) return "Camera Lens Cleaning Kit with Air Blower";
  if (/displayport|\bdp[- ]?cable\b|cable.*\bdp\b/.test(source)) return "DisplayPort 2.1 Cable for 8K High Refresh Video";
  if (/light stand|softbox.*stand|studio.*stand/.test(source)) return `${/ambitful/.test(source) ? "Ambitful " : ""}2 m Studio Light Stand`;
  if (/tripod|phone holder|camera stand|phone stand/.test(source) && !/tripod.*chair/.test(source)) {
    if (/selfie stick|insta ?360/.test(source)) return "Invisible Selfie Stick Tripod for 360 Cameras";
    return `${/smartphone|phone/.test(source) ? "Smartphone and Camera " : ""}Tripod`;
  }
  if (/smart ?watch|smartwatch/.test(source)) {
    const features = [];
    if (/bluetooth|call/.test(source)) features.push("Bluetooth Calling");
    if (/gps/.test(source)) features.push("GPS");
    if (/amoled|hd screen|display/.test(source)) features.push("HD Display");
    if (/fitness|sports|heart rate/.test(source)) features.push("Fitness Tracking");
    return shortenTitle(`Smart Watch${features.length ? ` with ${features.slice(0, 2).join(" and ")}` : ""}`, 70);
  }
  if (/watch ?(?:band|strap)|watchband|wristband.*watch|replacement.*watch/.test(source)) {
    const size = source.match(/\b(?:12|14|16|18|20|21|22|24)\s*mm\b/i)?.[0] || "";
    return `${finishWords[0] || "Replacement"} Watch Strap${size ? ` ${size}` : ""}`.replace("Replacement Watch", "Replacement Watch");
  }
  if (/\bwatch(?:es)?\b|wristwatch/.test(source)) {
    const type = /smart ?watch|smartwatch/.test(source) ? "Smart Watch" : /digital|led/.test(source) ? "Digital Wristwatch" : "Quartz Wristwatch";
    return `${audience ? `${audience} ` : ""}${type}${/waterproof|water resistant/.test(source) ? " Water-Resistant" : ""}`;
  }
  if (/(?:^|\s)(?:ipad|mipad|tablet)(?:\s|$).*case|(?:^|\s)case(?:\s|$).*\b(?:ipad|mipad|tablet)\b/.test(source)) {
    return /xiaomi|redmi|mipad/.test(source) ? "Xiaomi Tablet Protective Case" : "iPad and Tablet Protective Case";
  }
  if (/sticker/.test(source)) return "Waterproof Sticker Pack for Notebooks and Cases";
  if (/airpods?|air pods|earphone case|earbuds? case|headphone case/.test(source)) {
    return `${/silicone/.test(source) ? "Silicone " : "Protective "}Wireless Earbuds Case for Charging Box`;
  }
  if (/phone case|iphone.*case|case.*iphone/.test(source)) {
    const material = /silicone/.test(source) ? "Silicone " : /leather/.test(source) ? "Leather " : "";
    const feature = /magnetic|magsafe/.test(source) ? "Magnetic " : /shockproof|protective/.test(source) ? "Protective " : "";
    const device = /iphone|apple/.test(source)
      ? "iPhone"
      : /poco|xiaomi|redmi|samsung|huawei|oneplus|oppo|vivo|realme/.test(source)
        ? "Android Phone"
        : "Phone";
    return shortenTitle(`${feature}${material}${device} Case for Multiple Models`, 70);
  }
  if (/mouse ?pad|desk mat/.test(source)) return "Gaming Mouse Pad Desk Mat";
  if (/smart glasses|camera glasses/.test(source)) return "Smart Glasses with Camera and Bluetooth";
  if (/smart bracelet|fitness bracelet/.test(source)) return "Smart Fitness Bracelet for Everyday Wear";
  if (/keychain/.test(source)) return /piano|keyboard/.test(source) ? "Mini Piano Keyboard Keychain with Light" : "Decorative Keychain for Bags and Keys";
  if (/earbuds?|earphones?|headset|headphones?/.test(source)) return `${/wireless|bluetooth/.test(source) ? "Wireless Bluetooth " : "Wired "}${/headphone|headset/.test(source) ? "Headset" : "Earbuds"}${/anc|noise/.test(source) ? " with Noise Reduction" : " for Everyday Audio"}`.trim();
  if (/wrist rest|wrist support|wrist cushion/.test(source)) return "Keyboard Wrist Rest with Memory Foam Support";
  if (/piano|musical instrument|keyboard.*toy|toy.*keyboard/.test(source)) return "Electric Piano Keyboard for Kids and Beginners";
  if (/keyboard.*(?:riser|stand)|(?:riser|stand).*keyboard/.test(source)) return "Portable Keyboard Riser Stand for Desk";
  if (/keyboard/.test(source)) return `${/mechanical/.test(source) ? "Mechanical " : ""}Keyboard${/wireless/.test(source) ? " with Wireless Connection" : ""}`;
  if (/computer mouse|gaming mouse|wireless mouse/.test(source)) return `${/gaming/.test(source) ? "Gaming " : ""}${/wireless/.test(source) ? "Wireless " : ""}Computer Mouse`;
  if (/power bank|powerbank/.test(source)) return `${source.match(/\b\d{4,6}\s*mah\b/i)?.[0] || ""} Magnetic Wireless Power Bank`.trim();
  if (/charger|charging station/.test(source)) return "Fast Charging Power Adapter";
  if (/tent/.test(source)) return `${/beach/.test(source) ? "Pop-Up Beach Tent" : /camp/.test(source) ? "Camping Tent" : "Pop-Up Tent"}`;
  if (/backpack|rucksack/.test(source)) return `${audience ? `${audience} ` : ""}${/travel/.test(source) ? "Travel " : ""}${/hiking|camping|outdoor/.test(source) ? "Outdoor " : ""}Backpack`.replace(/\s+/g, " ").trim();
  if (/handbag|crossbody|tote bag|shoulder bag|purse/.test(source)) return `${audience ? `${audience} ` : ""}${/crossbody/.test(source) ? "Crossbody " : /tote/.test(source) ? "Tote " : "Handbag"}${/backpack/.test(source) ? " Backpack" : ""}`.replace(/\s+/g, " ").trim();
  if (/sunglasses|eyeglasses|glasses/.test(source)) return "Sunglasses for Everyday Wear";
  if (/crampon|snow claw|ice cleat/.test(source)) return "Anti-Slip Hiking Crampons";
  if (/ruler|measuring layout/.test(source)) return "Stainless Steel Square Ruler";
  if (/dog.*(?:toy|chew|bone|ball|rope)|puppy.*toy/.test(source)) return /bone/.test(source) ? "Squeaky Dog Chew Bone" : /rope/.test(source) ? "Interactive Dog Rope Toy" : "Dog Play Toy";
  if (/cat|kitten|catnip/.test(source) && /toy|plush|chew/.test(source)) return /catnip/.test(source) ? "Catnip Interactive Plush Toy" : "Interactive Cat Toy";
  if (/pet.*(?:outfit|clothing)|dog.*(?:coat|jacket)|cat.*(?:coat|cape)/.test(source)) return "Pet Outfit for Photo and Home Wear";
  if (/anime.*(?:card|photo card)/.test(source)) return "Anime Collectible Card Pack";
  if (/anime.*keychain|keychain/.test(source)) return "Decorative Keychain for Bags and Keys";
  if (/squeegee|window cleaner|glass wiper/.test(source)) return `${/extend|telescopic/.test(source) ? "Extendable " : ""}Window Cleaning Squeegee`;
  if (/tumbler|water bottle|thermos|drink bottle/.test(source)) return `${source.match(/\b\d+(?:ml|oz)\b/i)?.[0] || ""} Insulated Water Bottle`.trim();
  if (/makeup puff|powder puff/.test(source)) return "Cotton Makeup Puff for Foundation and Powder";
  if (/eyeliner|eye liner/.test(source)) return "Waterproof Eyeliner Pencil";
  if (/lipstick/.test(source)) return "Moisturizing Lipstick in Multiple Shades";
  if (/lip gloss|lip plumper/.test(source)) return "Lip Gloss for Everyday Shine";
  if (/eyeshadow|eye shadow/.test(source)) return "Multi-Color Eyeshadow Palette";
  if (/makeup brush|cosmetic brush|brush set/.test(source)) return "Makeup Brush Set for Eye and Face Looks";
  if (/led mask|light therapy face mask/.test(source)) return "Rechargeable LED Light Therapy Face Mask";
  if (/serum|face cream|moisturiz|skincare/.test(source)) return "Daily Skincare Treatment";
  if (/\b(?:shirt|t-shirt|tshirt|tee|blouse|polo|hoodie|sweatshirt|dress|skirt|pants|trousers|jeans|shorts|jacket|coat|top|tank top)\b/.test(source)) {
    if (/dress/.test(source) && /pleat|cheongsam|miyake|fishtail/.test(source)) return `${audience ? `${audience} ` : ""}Pleated Print Dress in Cheongsam Style`.trim();
    if (/(?:t-shirt|tshirt|tee)/.test(source) && /birthday|fabulous|grandma|grandmother|80th|80 years/.test(source)) return "80th Birthday Quote T-Shirt for Grandma";
    if (/jacket|coat/.test(source) && /retro|flight staff|pocket|autumn|winter/.test(source)) return "Retro Pocket Flight Jacket for Autumn";
    const garment = /hoodie|sweatshirt/.test(source) ? "Hoodie Sweatshirt"
      : /dress/.test(source) ? "Dress"
        : /blouse/.test(source) ? "Blouse"
          : /polo/.test(source) ? "Polo Shirt"
            : /tank/.test(source) ? "Tank Top"
              : /jeans/.test(source) ? "Jeans"
                : /pants|trousers/.test(source) ? "Pants"
                  : /jacket|coat|trench/.test(source) ? "Jacket"
                    : /skirt/.test(source) ? "Skirt"
                      : /shorts/.test(source) ? "Shorts"
                        : /t-shirt|tshirt|tee/.test(source) ? "T-Shirt" : "Button-Down Shirt";
    const sleeve = /long[- ]sleeve/.test(source) ? "Long-Sleeve" : /short[- ]sleeve/.test(source) ? "Short-Sleeve" : /sleeveless/.test(source) ? "Sleeveless" : "";
    return `${audience ? `${audience} ` : ""}${finishWords.slice(0, 2).join(" ")}${finishWords.length ? " " : ""}${sleeve ? `${sleeve} ` : ""}${garment}`.replace(/\s+/g, " ").trim();
  }
  if (/jewelry|jewellery|necklace|earring|brooch|lapel pin|bracelet|ring/.test(source)) return `${audience ? `${audience} ` : ""}${/brooch|lapel pin/.test(source) ? "Decorative Brooch Lapel Pin" : /necklace.*earring|earring.*necklace/.test(source) ? "Pendant Necklace and Earring Set" : /necklace/.test(source) ? "Pendant Necklace" : /bracelet/.test(source) ? `${/floral|flower|iris/.test(source) ? "Floral Adjustable " : ""}Bracelet for Everyday Wear` : "Jewelry Accessory for Everyday Wear"}`.trim();

  const polished = polishDeterministicTitle(currentTitle, item);
  if (!/casual graphic t shirt|casual button down shirt|product|listing|ref \d+|^accessory$/i.test(polished)) return polished;
  return polished || "Everyday Essential";
}

function editorialFactsForItem(item) {
  const source = sourceTextForEditorialCopy(item);
  const facts = bodyFacts(item?.desired?.descriptionHtml)
    .filter((fact) => !/^(?:product type|brand|brand name|brand or supplier|origin|model number|choice|high concerned chemical)$/i.test(fact.label))
    .filter((fact) => !/^(?:none|no features?|yes|no|mainland china|cn\(origin\))$/i.test(fact.value))
    .filter((fact) => {
      const text = `${fact.label} ${fact.value}`;
      if (/\b(?:aux|xh2|terminal)\b/i.test(text) && !/\b(?:aux|xh2|terminal)\b/.test(source)) return false;
      if (/\b(?:apple|iphone|ipad|macbook)\b/i.test(text) && !/\b(?:apple|iphone|ipad|macbook)\b/.test(source)) return false;
      if (/\b(?:women|womens|woman|ladies|female|men|mens|man|male)\b/i.test(text) &&
          !/\b(?:women|womens|woman|ladies|female|men|mens|man|male)\b/.test(source)) return false;
      return true;
    })
    .map((fact) => {
      const label = fact.label.toLowerCase();
      if (/material/.test(label)) return `Made with ${fact.value}.`;
      if (/compatib|device/.test(label)) return `Works with ${fact.value}.`;
      if (/feature/.test(label)) return `Features ${fact.value}.`;
      if (/size|capacity|pack/.test(label)) return `Available in ${fact.value}.`;
      if (/style|design|color|pattern/.test(label)) return `${titleCaseWords(fact.value)} design.`;
      return "";
    })
    .filter(Boolean);
  if (/jogger|cargo/.test(source)) facts.unshift(/cargo/.test(source) ? "Cargo pocket styling for a practical casual fit." : "Jogger-inspired styling for relaxed everyday wear.");
  if (/high[- ]waist|high waist/.test(source)) facts.unshift("High-waist fit shown in the selected size range.");
  if (/slim|straight|loose|wide[- ]leg/.test(source)) facts.unshift("The selected cut is shown in the product images.");
  if (/two[- ]piece|set|outfit/.test(source)) facts.unshift("A coordinated set format for the pieces shown.");
  if (/floral|flower|polka|stripe|striped|printed|graphic/.test(source)) facts.unshift("Pattern details are shown in the product images.");
  if (/cotton|linen|silk|leather/.test(source)) facts.unshift(`${titleCaseWords(source.match(/\b(?:cotton|linen|silk|leather)\b/)?.[0] || "Fabric")} fabric detail.`);
  if (/blouse/.test(source)) facts.unshift("Modest blouse styling with the top and front details shown.");
  if (/dress/.test(source)) facts.unshift("Dress styling with the lace, party, or occasion details shown.");
  if (/jacket|trench|coat/.test(source)) facts.unshift("Loose outer-layer styling with the stand-collar details shown.");
  if (/pants|trousers/.test(source)) facts.unshift("Pants silhouette with the waist and leg details shown.");
  if (/shirt|t-shirt|tshirt/.test(source)) facts.unshift("Shirt styling with the fabric and color details shown.");
  if (/stage|performance|dance/.test(source)) facts.unshift("Stage-performance styling with the details shown for movement.");
  if (/pleat|cheongsam|miyake|fishtail/.test(source)) facts.unshift("Pleated print cheongsam styling with the fishtail silhouette shown.");
  if (/multicolor|teen|wedding|birthday|gift/.test(source)) facts.unshift("Multicolor cotton shirt styling for birthday or wedding gifting.");
  if (/80th|80 years|fabulous|grandma|grandmother/.test(source)) facts.unshift("80th birthday quote design for grandma or grandmother gifting.");
  if (/retro|flight staff|pocket|autumn|winter/.test(source) && /jacket|coat/.test(source)) facts.unshift("Retro flight-staff jacket with segmented pocket details.");
  if (/camera cleaning|lens cleaning|air blower|ccd sensor/.test(source)) facts.unshift("Air blower, lens cloth, brush, and sensor-cleaning tools for camera care.");
  if (/aux.*xh2|xh2.*aux/.test(source)) facts.unshift("3.5 mm AUX to XH2.54 male-to-male connector layout.");
  if (/hdmi.*vga|vga.*hdmi/.test(source)) facts.unshift("HDMI input with VGA video output and a separate audio connection.");
  if (/smart ?watch|smartwatch/.test(source) && /bluetooth|call/.test(source)) facts.unshift("Bluetooth calling for a compatible phone.");
  return [...new Set(facts)].slice(0, 4);
}

function expandShortEditorialTitle(title, source) {
  const value = normalizePlainText(title);
  if (value.length >= 20) return shortenTitle(value, 70);
  const suffix = /tent/.test(source)
    ? " for Outdoor Trips"
    : /watch|wristwatch/.test(source)
      ? " for Everyday Timekeeping"
      : /pet|puppy|kitten|dog|cat/.test(source)
      ? " for Pets"
      : /toy/.test(source)
        ? " for Play and Learning"
        : /bag|backpack|rucksack/.test(source)
          ? " for Everyday Carry"
          : /sunglasses|eyeglasses|glasses/.test(source)
            ? " for Everyday Wear"
            : " for Everyday Use";
  return shortenTitle(`${value}${suffix}`, 70);
}

function buildEditorialDescription(item, title) {
  const source = sourceTextForEditorialCopy(item);
  const lowerTitle = title.toLowerCase();
  let intro;
  let order = "Choose the option that fits your setup, and check the measurements or compatibility shown before checkout.";
  let care = "Keep it clean, dry, and stored safely between uses; follow any care instructions supplied with the item.";
  let bullets = editorialFactsForItem(item);

  if (/displayport|\bdp[- ]?cable\b|cable.*\bdp\b/.test(source)) {
    intro = `Send a high-bandwidth video signal with this ${lowerTitle}. The DisplayPort format is suited to compatible computers, graphics hardware, and monitors when the selected resolution and refresh rate are supported.`;
    order = "Confirm DisplayPort versions, connector direction, cable length, and the resolution and refresh rate supported by your devices.";
    care = "Insert the plugs straight, avoid tight bends near the connectors, and store the cable loosely when not in use.";
  } else if (/(?:aux|audio).*cable.*(?:xh2|terminal)|(?:xh2|terminal).*(?:aux|audio).*cable/.test(source)) {
    intro = `Connect compatible audio equipment with this ${lowerTitle}. The male-to-male layout keeps a small audio setup straightforward when both devices use the matching terminals.`;
    order = "Confirm the 3.5 mm plug, XH2.54 terminal, cable length, and the connection direction required by your equipment.";
    care = "Insert the connectors gently, avoid pulling the cable at the plug, and coil it loosely for storage.";
  } else if (/audio.*cable|rca.*cable|aux.*cable|earphone.*cable/.test(source)) {
    intro = `Connect compatible audio equipment with this ${lowerTitle}. The plug layout and cable format are shown so you can match it to the amplifier, speaker, vehicle, or headphone setup you use.`;
    order = "Confirm both connector types, cable length, and the input and output direction required by your equipment before ordering.";
    care = "Insert the connectors gently, avoid pulling the cable at the plug, and coil it loosely for storage.";
  } else if (/hdmi.*vga|vga.*hdmi/.test(source)) {
    intro = `Give an older VGA display a practical HDMI connection with this ${lowerTitle}. It is suited to compatible laptops, media sources, monitors, and projectors that need separate audio.`;
    order = "HDMI-to-VGA is one-way, so confirm the source output, VGA input, resolution, audio path, and power requirement before ordering.";
    care = "Connect and remove the adapter by its plugs, support the cable near the connector, and store it dry.";
  } else if (/smart ?watch|smartwatch/.test(source)) {
    intro = `Keep calls, notifications, time, and everyday wrist functions close with this ${lowerTitle}. Pair it with a compatible phone, then choose the strap, color, and feature set shown for your version.`;
    order = "Confirm phone compatibility, charging method, strap choice, and the functions included with the selected version.";
    care = "Charge and pair the watch as directed, keep the case and strap clean and dry, and store it safely when not in use.";
  } else if (/watch ?(?:band|strap)|watchband|wristband.*watch/.test(source)) {
    intro = `Refresh a compatible watch with this ${lowerTitle}. The strap width, fastening style, and finish are shown in the available choices so you can match it to your watch case.`;
    order = "Measure the lug or strap width on your watch and confirm the fastening style before ordering.";
    care = "Wipe the strap with a soft cloth, keep it away from harsh chemicals, and let it dry fully before storage.";
  } else if (/\bwatch(?:es)?\b|wristwatch/.test(source)) {
    intro = `Add a clear, easy-to-wear timepiece with this ${lowerTitle}. The dial, case, strap, and finish shown in the product images define the look of the version you choose.`;
    order = "Check the case size, strap finish, movement type, and any water-resistance detail shown for your chosen version.";
    care = "Keep the watch away from unnecessary moisture and harsh chemicals, and wipe the case and strap gently when needed.";
  } else if (/phone case|iphone.*case|case.*iphone|ipad.*case|tablet.*case/.test(source)) {
    intro = `Give a compatible device a cleaner everyday layer with this ${lowerTitle}. The case follows the model, camera cutout, and controls shown for the option you select.`;
    order = "Choose the exact device model and check the camera cutout, buttons, and dimensions before checkout.";
    care = "Fit and remove the case carefully, wipe it with a soft cloth, and keep the closure and cutouts free of debris.";
  } else if (/earbuds?|earphones?|headset|headphones?|keyboard|computer mouse|power bank|charger/.test(source)) {
    intro = `Make this ${lowerTitle} part of your everyday tech setup. Its connection type, controls, and form are shown in the product imagery and the available version choices.`;
    order = "Confirm the connector, device compatibility, dimensions, and included accessories before checkout.";
    care = "Keep electronic parts dry, avoid sharp bends or drops, and store the item safely after use.";
  } else if (/tent|camping|hiking|outdoor|backpack/.test(source)) {
    intro = `Be ready for time outside with this ${lowerTitle}. The packed size, capacity, construction, and setup details shown for the selected version help you plan the outing.`;
    order = "Check the dimensions, packed size, weather limitations, and included setup pieces before ordering.";
    care = "Dry the item fully before packing it away, brush off dirt gently, and store it in a clean, dry place.";
  } else if (/backpack|rucksack|handbag|crossbody|tote bag|shoulder bag|purse/.test(source)) {
    intro = `Carry the essentials in this ${lowerTitle}. The compartments, handle or strap arrangement, and capacity shown for the selected version help you choose the right everyday carry.`;
    order = "Check the dimensions, capacity, strap arrangement, and closure shown for the version you want.";
    care = "Empty the bag before cleaning, wipe the surface gently, and store it in a dry place away from heavy pressure.";
  } else if (/squeegee|window cleaner|glass wiper/.test(source)) {
    intro = `Keep smooth glass surfaces clearer with this ${lowerTitle}. The head shape, handle, and reach shown for the selected version are suited to the cleaning task described by the product.`;
    order = "Check the head size, handle length, and surface compatibility before ordering.";
    care = "Rinse away residue after use, wipe the handle dry, and store the tool where the head will not be crushed.";
  } else if (/tumbler|water bottle|thermos|drink bottle/.test(source)) {
    intro = `Take a drink along in this ${lowerTitle}. The capacity, lid style, and shape shown for the selected version make it easy to choose a bottle that fits your routine.`;
    order = "Check the capacity, lid design, opening, and cleaning instructions before ordering.";
    care = "Wash before first use, clean after use, and let the bottle and lid dry fully before closing for storage.";
  } else if (/camera cleaning|lens cleaning|air blower|ccd sensor/.test(source)) {
    intro = `Keep camera surfaces and lenses clearer with this ${lowerTitle}. The blower, cloth, brush, and precision tools shown are arranged for routine cleaning of compatible camera equipment.`;
    order = "Check the included tool types and use each one only on the surface and equipment it is intended for.";
    care = "Keep the tools free of dust, avoid touching cleaning tips, and store the kit closed between uses.";
  } else if (/dog.*(?:toy|chew|bone|ball|rope)|puppy.*toy|cat|kitten|catnip|pet.*(?:outfit|clothing)/.test(source)) {
    intro = `Give your pet a more engaging addition to their routine with this ${lowerTitle}. The shape, texture, and finish shown are the details to compare for the play or outfit option you choose.`;
    order = "Choose the appropriate size and supervise use, especially during chewing or active play.";
    care = "Inspect it regularly, remove it if damaged, and clean or store it according to the material and supplied directions.";
  } else if (/makeup|cosmetic|lipstick|eyeliner|eyeshadow|lash|serum|skincare|hair/.test(source)) {
    intro = `Build a more considered beauty routine with this ${lowerTitle}. The texture, shade, size, and application format shown for the selected version make it easier to choose what suits your routine.`;
    order = "Choose the shade, size, and format shown for your needs, and review the supplied use guidance before ordering.";
    care = "Keep the item clean, close the container after use, and follow the supplied cosmetic storage and application guidance.";
  } else if (/shirt|t-shirt|tshirt|tee|blouse|polo|hoodie|sweatshirt|dress|skirt|pants|trousers|jeans|shorts|jacket|coat|top|tank top/.test(source)) {
    intro = `Add an easy layer to your wardrobe with this ${lowerTitle}. The cut, sleeve length, fabric, and color options shown for this design help you choose a version that feels right for the occasion.`;
    order = "Use the size guide, compare the measurements, and confirm the color and sleeve option before ordering.";
    care = "Follow the garment care instructions, wash it as directed, and let it dry fully before storing.";
  } else if (/jewelry|jewellery|necklace|earring|brooch|lapel pin|bracelet|ring/.test(source)) {
    intro = `Finish a look with this ${lowerTitle}. The shape, finish, and pairing shown in the product imagery give you a clear view of how the piece will sit with your accessories.`;
    order = "Check the dimensions, fastening, finish, and any sizing detail shown for your chosen version.";
    care = "Store the piece in a dry place, keep it away from harsh chemicals, and wipe it gently with a soft cloth.";
  } else {
    const first = trimToCompleteSentence(removeTitleEcho(bodyParagraphs(item?.desired?.descriptionHtml)[0] || "", title));
    intro = first && !/listing|product details|specific function|care guidance|for this model/i.test(first)
      ? first
      : `This ${lowerTitle} is shaped around the use and details shown in the product images and available choices.`;
  }

  const fallbackFacts = bullets.length ? bullets : [`${titleCaseWords(title)} details are shown in the available choices.`];
  return `<h2>About ${escapeHtmlText(title)}</h2>\n<p>${escapeHtmlText(intro)}</p>\n<h3>What to expect</h3>\n<ul>${fallbackFacts.map((fact) => `<li>${escapeHtmlText(fact)}</li>`).join("")}</ul>\n<h3>Before you order</h3>\n<p>${escapeHtmlText(order)}</p>\n<h3>Care</h3>\n<p>${escapeHtmlText(care)}</p>`;
}

function editorialMetaLeadForItem(item, title) {
  const source = sourceTextForEditorialCopy(item);
  if (/(?:aux|audio).*cable.*(?:xh2|terminal)|(?:xh2|terminal).*(?:aux|audio).*cable/.test(source)) return "A clear male-to-male connection for compatible audio equipment.";
  if (/audio.*cable|rca.*cable|aux.*cable|earphone.*cable/.test(source)) return "A direct audio connection with the plug layout shown for compatible equipment.";
  if (/hdmi.*vga|vga.*hdmi/.test(source)) return "A practical way to connect an HDMI source to a VGA display with separate audio.";
  if (/smart ?watch|smartwatch/.test(source)) return "Bluetooth calling and everyday wrist functions in a rectangular display.";
  if (/phone case|iphone.*case|case.*iphone/.test(source)) return "Model-specific protection with the camera cutout and fit shown for each choice.";
  if (/backpack|rucksack|handbag|crossbody|tote bag/.test(source)) return "A useful carry option shaped around the capacity and compartments shown.";
  if (/shirt|t-shirt|tshirt|tee|blouse|polo|hoodie|dress|skirt|pants|jeans|jacket|coat/.test(source)) return "An easy-to-style layer with the cut, fabric, and options shown for this design.";
  if (/makeup|cosmetic|lipstick|eyeliner|eyeshadow|lash|serum|skincare|hair/.test(source)) return "A practical addition to a beauty routine in the format shown.";
  const noun = title.match(/\b(?:case|cable|adapter|watch|strap|bag|backpack|brush|puff|bottle|organizer|tool|shirt|dress|mask|keyboard|mouse|tripod|toy|jacket)\b/i)?.[0] || "piece";
  return `A considered ${noun.toLowerCase()} with the details shown in the available choices.`;
}

function buildEditorialMetaDescription(item, title) {
  const prefix = `Shop ${title} at VS Store.`;
  const sentences = [editorialMetaLeadForItem(item, title), orderingSentenceForMeta(title)];
  let result = prefix;
  for (const sentence of sentences) {
    if (result.length >= 158) break;
    const remaining = 158 - result.length - 1;
    if (remaining < 18) break;
    const addition = sentence.length <= remaining ? sentence : trimMetaSentence(sentence, remaining);
    if (addition.length >= 18 && !/\s+(?:and|or|with|for|to|of|the)\.?$/i.test(addition)) result += ` ${addition.replace(/[.!?]?$/, ".")}`;
  }
  if (result.length < 120) {
    const remaining = 158 - result.length - 1;
    const extra = trimMetaSentence("Review the photos and available choices before checkout.", remaining);
    if (extra.length >= 18) result += ` ${extra.replace(/[.!?]?$/, ".")}`;
  }
  return result.slice(0, 158).replace(/\s+(?:and|or|with|for|to|of|the)\.?$/i, "").replace(/[.!?]?$/, ".");
}

function applyDeterministicHumanCopy(item) {
  if (item?.provider !== "deterministic-evidence-fallback") return;
  const source = sourceTextForEditorialCopy(item);
  item.desired.title = expandShortEditorialTitle(editorialTitleForItem(item, item.desired.title), source);
  item.desired.seoTitle = expandShortEditorialTitle(editorialTitleForItem(item, item.desired.seoTitle || item.desired.title), source);
  item.desired.descriptionHtml = buildEditorialDescription(item, item.desired.title);
  item.desired.seoDescription = buildEditorialMetaDescription(item, item.desired.title);
}

function ensureDistinctProductCopy(items, liveByHandle) {
  for (const item of items) applyDeterministicHumanCopy(item);
  const titleGroups = new Map();
  for (const item of items) {
    const key = normalizePlainText(item.desired?.title).toLowerCase();
    if (!titleGroups.has(key)) titleGroups.set(key, []);
    titleGroups.get(key).push(item);
  }
  const usedTitles = new Set();
  for (const item of [...items].sort((left, right) => left.handle.localeCompare(right.handle))) {
    const oldTitle = item.desired.title;
    const key = normalizePlainText(oldTitle).toLowerCase();
    const group = titleGroups.get(key) || [item];
    let nextTitle = oldTitle;
    // Keep the first product's canonical title clean; disambiguate only later
    // products in a true collision group or a collision with an earlier title.
    if ((group.length > 1 && group.indexOf(item) > 0) || usedTitles.has(key)) {
      const duplicateIndex = group.indexOf(item);
      nextTitle = distinctTitleFor(item, oldTitle, duplicateIndex < 0 ? usedTitles.size : duplicateIndex);
      let guard = 2;
      while (usedTitles.has(nextTitle.toLowerCase()) && guard < 20) {
        nextTitle = distinctTitleFor(item, oldTitle, guard, guard);
        guard += 1;
      }
    }
    if (nextTitle !== oldTitle) {
      item.desired.title = nextTitle;
      item.desired.seoTitle = shortenTitle(nextTitle, 70);
      if (item.desired.descriptionHtml) {
        const escapedTitle = escapeHtmlText(nextTitle);
        item.desired.descriptionHtml = item.desired.descriptionHtml
          .replace(/(<h2>About )[^<]*(<\/h2>)/i, `$1${escapedTitle}$2`)
          .replace(/(<p><strong>)[\s\S]*?(<\/strong>\s*(?:&mdash;|—))/i, `$1${escapedTitle}$2`)
          .replace(/(<p><strong>Q: What is )[^<]*(<\/strong><\/p>)/i, `$1${escapedTitle}?$2`);
      }
    }
    usedTitles.add(item.desired.title.toLowerCase());
  }

  const seoTitleGroups = new Map();
  for (const item of items) {
    const key = normalizePlainText(item.desired.seoTitle).toLowerCase();
    if (!seoTitleGroups.has(key)) seoTitleGroups.set(key, []);
    seoTitleGroups.get(key).push(item);
  }
  const usedSeoTitles = new Set();
  for (const item of [...items].sort((left, right) => left.handle.localeCompare(right.handle))) {
    const oldSeoTitle = item.desired.seoTitle;
    const key = normalizePlainText(oldSeoTitle).toLowerCase();
    const group = seoTitleGroups.get(key) || [item];
    let nextSeoTitle = oldSeoTitle;
    if ((group.length > 1 && group.indexOf(item) > 0) || usedSeoTitles.has(key)) {
      const duplicateIndex = group.indexOf(item);
      nextSeoTitle = distinctSeoTitleFor(item, oldSeoTitle, duplicateIndex < 0 ? usedSeoTitles.size : duplicateIndex);
      let guard = 2;
      while (usedSeoTitles.has(nextSeoTitle.toLowerCase()) && guard < 20) {
        nextSeoTitle = distinctSeoTitleFor(item, oldSeoTitle, guard, guard);
        guard += 1;
      }
    }
    item.desired.seoTitle = nextSeoTitle;
    usedSeoTitles.add(nextSeoTitle.toLowerCase());
  }

  const seoGroups = new Map();
  for (const item of items) {
    if (item.provider === "deterministic-evidence-fallback") {
      // Keep the editorial, handle-driven meta copy produced above. Reusing
      // the legacy deterministic lead here reintroduced stale source-title
      // facts such as XH2 terminals and unsupported gender/device claims.
      item.desired.seoDescription = buildEditorialMetaDescription(item, item.desired.title);
    }
    const key = normalizePlainText(item.desired.seoDescription).toLowerCase();
    if (!seoGroups.has(key)) seoGroups.set(key, []);
    seoGroups.get(key).push(item);
  }
  for (const group of seoGroups.values()) {
    if (group.length < 2) continue;
    group.sort((left, right) => left.handle.localeCompare(right.handle));
    group.forEach((item, index) => {
      if (index > 0 || group.some((entry, entryIndex) => entryIndex !== index && entry.desired.title === item.desired.title)) {
        item.desired.seoDescription = regenerateDistinctSeoDescription(item, index);
      }
    });
  }

  const usedSeoDescriptions = new Set();
  for (const item of [...items].sort((left, right) => left.handle.localeCompare(right.handle))) {
    let candidate = normalizePlainText(item.desired.seoDescription);
    if (/specific function|specific product|product format|before ordering, match the product|combines with|features shown|named by the product|confirmed product facts|the product details identify|option \d+|specific everyday task|product details|stated style|stated activity|stated setting|is a \w+ with [^.!?]*details/i.test(candidate)) {
      candidate = regenerateDistinctSeoDescription(item, 0);
    }
    let guard = 0;
    while (usedSeoDescriptions.has(candidate.toLowerCase()) && guard < 100) {
      candidate = regenerateDistinctSeoDescription(item, guard + 1);
      guard += 1;
    }
    item.desired.seoDescription = candidate;
    usedSeoDescriptions.add(candidate.toLowerCase());
  }

  for (const item of items) {
    const liveProduct = liveByHandle.get(item.handle);
    item.quality = validateCopy(item.desired, liveProduct);
    if (item.imageHealth?.eligible !== true) item.status = "held_image";
    else if (!item.quality.ok) item.status = "held_quality";
  }
}

function sourceHasGenderEvidence(product) {
  return /\b(?:women|womens|woman|ladies|men|mens|man|female|male|girls|girl|boys|boy|unisex)\b/i.test(
    `${product?.handle || ""} ${product?.title || ""}`,
  );
}

function containsHumanGenderClaim(value) {
  const technical = String(value || "")
    .replace(/\b(?:male|female)\s*[-/]?\s*to\s*[-/]?\s*(?:male|female)\b/gi, " ")
    .replace(/\b(?:male|female)\s+(?:connector|plug|port|thread|terminal|jack|fitting|end|pin)\b/gi, " ");
  return /\b(?:women|womens|woman|ladies|men|mens|man|female|male|girls|girl|boys|boy|unisex)\b/i.test(technical);
}

function validateCopy(candidate, liveProduct) {
  const title = comparableValue(candidate?.title);
  const descriptionHtml = String(candidate?.descriptionHtml || "").trim();
  const seoTitle = comparableValue(candidate?.seoTitle);
  const seoDescription = comparableValue(candidate?.seoDescription);
  const evidenceProduct = {
    handle: liveProduct?.handle || "",
    title,
    product_type: liveProduct?.productType || "",
    tags: liveProduct?.tags || [],
    vendor: liveProduct?.vendor || "",
  };
  const issues = [];
  if (title.length < 20 || title.length > 70) issues.push(`title-length:${title.length}`);
  if (seoTitle.length < 20 || seoTitle.length > 70) issues.push(`seo-title-length:${seoTitle.length}`);
  if (seoDescription.length < 120 || seoDescription.length > 170) issues.push(`seo-description-length:${seoDescription.length}`);
  if (stripHtml(descriptionHtml).length < 180) issues.push(`description-length:${stripHtml(descriptionHtml).length}`);

  const banned = /brand name:|brand or supplier:|choice:|high concerned chemical|catalog tag:|source specifications|the product serves the specific function|confirmed product facts|listed details include brand|follows the .*format named in the listing|named in the listing|listed with .*\.|specific function identified by|generic product format/i;
  if (banned.test(`${title}\n${seoTitle}\n${seoDescription}\n${descriptionHtml}`)) issues.push("raw-supplier-or-generic-copy");

  const sourceEvidence = `${liveProduct?.handle || ""} ${liveProduct?.title || ""}`;
  const hasAppleEvidence = /\b(?:iphone|ipad)(?:\s*[a-z0-9-]+)?/i.test(sourceEvidence);
  if (/\b(?:iphone|ipad)\b/i.test(`${title} ${seoTitle} ${seoDescription} ${descriptionHtml}`) && !hasAppleEvidence) {
    issues.push("unsupported-apple-device-claim");
  }
  if (/\b(?:xh2(?:\.54)?|terminal)\b/i.test(`${title} ${seoTitle} ${seoDescription} ${descriptionHtml}`) && !/\b(?:xh2|terminal)\b/i.test(sourceEvidence)) {
    issues.push("unsupported-xh2-terminal-claim");
  }
  if (containsHumanGenderClaim(`${title} ${seoTitle} ${seoDescription} ${descriptionHtml}`) && !sourceHasGenderEvidence(liveProduct)) {
    issues.push("unsupported-gender-claim");
  }

  const titleEvidence = assessProductContentSpecificity(title, evidenceProduct, {
    field: "title",
    minimumEvidenceMatches: 2,
    extraEvidence: [liveProduct?.title || ""],
    rejectGenericPatterns: true,
  });
  const seoEvidence = assessProductContentSpecificity(seoDescription, evidenceProduct, {
    field: "seo-description",
    minimumEvidenceMatches: 3,
    extraEvidence: [liveProduct?.title || "", liveProduct?.productType || ""],
    rejectGenericPatterns: true,
  });
  const bodyEvidence = assessProductContentSpecificity(descriptionHtml, evidenceProduct, {
    field: "description",
    minimumEvidenceMatches: 3,
    extraEvidence: [liveProduct?.title || "", liveProduct?.productType || ""],
    rejectGenericPatterns: true,
  });
  if (!titleEvidence.specific) issues.push(`title-evidence:${titleEvidence.issues.join(",")}`);
  if (!seoEvidence.specific) issues.push(`seo-evidence:${seoEvidence.issues.join(",")}`);
  if (!bodyEvidence.specific) issues.push(`body-evidence:${bodyEvidence.issues.join(",")}`);

  return {
    ok: issues.length === 0,
    issues,
    evidence: {
      title: titleEvidence,
      seoDescription: seoEvidence,
      description: bodyEvidence,
    },
  };
}

function buildRows(liveProducts) {
  return liveProducts.map((product) => ({
    Handle: product.handle,
    Title: product.title,
    "Body (HTML)": product.descriptionHtml,
    Type: product.productType,
    "Product ID": product.id,
    Tags: (product.tags || []).join(", "),
  }));
}

function candidateFromPlan(productPlan, liveProduct) {
  const intelligence = productPlan?.intelligence || {};
  return {
    title: comparableValue(intelligence.canonicalTitle || productPlan?.desiredProductInput?.title || liveProduct?.title || ""),
    descriptionHtml: String(intelligence.canonicalDescriptionHtml || productPlan?.desiredProductInput?.descriptionHtml || liveProduct?.descriptionHtml || "").trim(),
    seoTitle: comparableValue(intelligence.canonicalSeoTitle || productPlan?.desiredProductInput?.seo?.title || liveProduct?.seo?.title || ""),
    seoDescription: comparableValue(intelligence.canonicalSeoDescription || productPlan?.desiredProductInput?.seo?.description || liveProduct?.seo?.description || ""),
  };
}

async function callGptCopy(product, baseline, model) {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) return { copy: baseline, provider: "deterministic-evidence-fallback", warning: "OPENAI_API_KEY not configured" };

  const evidence = {
    handle: product.handle,
    currentTitle: product.title,
    productType: product.productType,
    vendor: product.vendor,
    tags: product.tags,
    baseline: {
      title: baseline.title,
      seoTitle: baseline.seoTitle,
      seoDescription: baseline.seoDescription,
      descriptionText: stripHtml(baseline.descriptionHtml).slice(0, 2200),
    },
  };
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || process.env.FUTURE_LIGHT_SEO_GPT_MODEL || "gpt-4.1-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "Write natural ecommerce copy from verified evidence only. Never invent materials, compatibility, gender, dimensions, certifications, health benefits, or performance. Return JSON with title, seoTitle, seoDescription, descriptionHtml. Keep title 20-70 chars, seoTitle 20-70 chars, seoDescription 120-170 chars. Use human language, no raw supplier labels, no catalog tags, no generic filler.",
        },
        { role: "user", content: JSON.stringify(evidence) },
      ],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`OpenAI copy request HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 500)}`);
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI copy request returned no message content");
  const parsed = JSON.parse(content);
  return {
    copy: {
      title: comparableValue(parsed.title || baseline.title),
      descriptionHtml: String(parsed.descriptionHtml || baseline.descriptionHtml).trim(),
      seoTitle: comparableValue(parsed.seoTitle || baseline.seoTitle),
      seoDescription: comparableValue(parsed.seoDescription || baseline.seoDescription),
    },
    provider: model || process.env.FUTURE_LIGHT_SEO_GPT_MODEL || "gpt-4.1-mini",
    warning: "",
  };
}

async function fetchActiveProducts(client, state, persistState) {
  const products = [];
  let after = null;
  let page = 0;
  while (true) {
    page += 1;
    const data = await runWithNetworkWait(
      client,
      `active product catalog page ${page}`,
      () => client.run(ACTIVE_PRODUCTS_QUERY, { after }, { operation: `Future Light active products page ${page}` }),
      state,
      persistState,
    );
    const connection = data?.products;
    const pageProducts = Array.isArray(connection?.nodes) ? connection.nodes.filter((product) => product?.id && product?.handle) : [];
    products.push(...pageProducts);
    console.log(`Fetched Future Light active catalog page ${page}: ${pageProducts.length} (${products.length} total)`);
    if (!connection?.pageInfo?.hasNextPage || !connection.pageInfo.endCursor) break;
    after = connection.pageInfo.endCursor;
  }
  const unique = [...new Map(products.map((product) => [product.id, product])).values()];
  if (!unique.length) throw new Error("Future Light active product query returned no products");
  return unique;
}

async function runWithNetworkWait(client, label, operation, state, persistState) {
  let attempt = 0;
  const pollBase = Math.max(5_000, Number(process.env.FUTURE_LIGHT_SEO_NETWORK_POLL_MS || 30_000));
  const pollMax = Math.max(pollBase, Number(process.env.FUTURE_LIGHT_SEO_NETWORK_MAX_POLL_MS || 300_000));
  while (true) {
    try {
      const result = await operation();
      if (state.status === "waiting_for_network") {
        state.status = "running";
        state.lastError = "";
        state.updatedAt = now();
        await persistState();
      }
      return result;
    } catch (error) {
      if (!isNetworkError(error)) throw error;
      const delayMs = Math.min(pollMax, pollBase * 2 ** Math.min(attempt, 5));
      state.status = "waiting_for_network";
      state.lastError = `${label}: ${String(error?.message || error).slice(0, 600)}`;
      state.networkRetries = Number(state.networkRetries || 0) + 1;
      state.updatedAt = now();
      await persistState();
      console.log(`Network unavailable during ${label}; waiting ${Math.ceil(delayMs / 1000)}s before retry ${attempt + 1}.`);
      await sleep(delayMs);
      attempt += 1;
    }
  }
}

async function readOptionalJson(filePath) {
  return readJson(filePath, {});
}

function isResolvedVariantAssociationIssue(issue, audit) {
  if (![
    "broken-variant-association",
    "variant-image-url-not-in-product-media",
    "variant-points-to-unhealthy-image",
  ].includes(issue?.code)) return false;
  const variantId = normalizePlainText(issue?.variantId || "");
  const variantAudit = (Array.isArray(audit?.variantAudits) ? audit.variantAudits : [])
    .find((entry) => normalizePlainText(entry?.variantId || "") === variantId);
  const variantImageUrl = canonicalImageUrl(variantAudit?.imageUrl || issue?.variantImageUrl || "");
  if (!variantImageUrl) return false;
  const matchingImage = (Array.isArray(audit?.imageAudits) ? audit.imageAudits : [])
    .find((image) => canonicalImageUrl(image?.url || "") === variantImageUrl);
  // A legacy/stale media ID is resolved when the variant's exact current URL
  // is present in the product media and that media asset is healthy. Keep real
  // missing-URL or unhealthy-asset errors blocking.
  return Boolean(matchingImage && matchingImage.blocking !== true);
}

function imageAuditHasBlockingIssue(audit) {
  return Boolean(
    audit?.needsRetry ||
      audit?.issues?.some((issue) =>
        ["critical", "error"].includes(issue?.severity) && !isResolvedVariantAssociationIssue(issue, audit),
      ),
  );
}

function buildImageEvidence(audit, preflight) {
  const issueCodes = [...new Set((audit?.issues || []).map((issue) => issue?.code).filter(Boolean))];
  const blocking = !preflight.ready || !audit || !audit.completed || imageAuditHasBlockingIssue(audit);
  return {
    preflightReady: preflight.ready,
    verified: Boolean(preflight.ready && audit?.completed && !imageAuditHasBlockingIssue(audit)),
    eligible: !blocking,
    status: audit?.status || "missing",
    completed: Boolean(audit?.completed),
    needsRetry: Boolean(audit?.needsRetry),
    blocking,
    imagesAudited: Number(audit?.auditedImageCount || 0),
    imageCount: Number(audit?.imageCount || 0),
    issueCodes,
    reason: !preflight.ready
      ? preflight.reason
      : !audit
        ? "product-missing-from-image-health-audit"
        : audit.needsRetry
          ? "image-health-audit-needs-retry"
          : imageAuditHasBlockingIssue(audit)
            ? "image-health-repair-required"
            : "",
  };
}

async function loadImageHealthPreflight(liveProducts) {
  const manifest = await readJson(imageHealthManifestPath, null);
  const byProductId = new Map();
  const byHandle = new Map();
  const base = {
    ready: false,
    status: manifest?.status || "missing",
    sourceFingerprint: manifest?.source?.fingerprint || "",
    reason: "image-health-audit-not-complete",
    manifest,
    byProductId,
    byHandle,
  };
  if (!manifest) {
    base.reason = "image-health-manifest-missing";
    return base;
  }
  const manifestScope = typeof manifest.scope === "string"
    ? manifest.scope
    : manifest.scope?.scope;
  if (manifestScope !== FUTURE_LIGHT_SCOPE || manifest.schemaVersion !== IMAGE_HEALTH_SCHEMA_VERSION) {
    base.reason = "image-health-manifest-scope-or-schema-mismatch";
    return base;
  }
  for (const audit of Array.isArray(manifest.products) ? manifest.products : []) {
    if (audit?.productId) byProductId.set(String(audit.productId), audit);
    if (audit?.handle) byHandle.set(normalizeHandleValue(audit.handle), audit);
  }
  const missing = liveProducts.filter(
    (product) => !byProductId.has(String(product.id)) && !byHandle.has(normalizeHandleValue(product.handle)),
  );
  if (manifest.status !== "complete") {
    base.reason = `image-health-audit-${manifest.status || "incomplete"}`;
    return base;
  }
  if (missing.length) {
    base.reason = `image-health-audit-missing-${missing.length}-active-product(s)`;
    return base;
  }
  base.ready = true;
  base.reason = "";
  return base;
}

async function buildManifest({ liveProducts, plan, args, priorManifest, imagePreflight, overrides }) {
  const liveByHandle = new Map(liveProducts.map((product) => [normalizeHandleValue(product.handle), product]));
  const priorByHandle = new Map((priorManifest?.items || []).map((item) => [item.handle, item]));
  const items = [];
  const warnings = [];

  for (const productPlan of plan.products || []) {
    const handle = normalizeHandleValue(productPlan.handle);
    const liveProduct = liveByHandle.get(handle);
    if (!liveProduct) {
      warnings.push(`${handle}:missing-live-product`);
      continue;
    }
    const baseline = candidateFromPlan(productPlan, liveProduct);
    const imageAudit = imagePreflight.byProductId.get(String(liveProduct.id)) ||
      imagePreflight.byHandle.get(handle);
    const imageHealth = buildImageEvidence(imageAudit, imagePreflight);
    let copyResult = { copy: baseline, provider: "deterministic-evidence-fallback", warning: "" };
    if (args.gpt && process.env.OPENAI_API_KEY) {
      try {
        copyResult = await callGptCopy(liveProduct, baseline, args.model);
      } catch (error) {
        warnings.push(`${handle}:gpt-fallback:${String(error?.message || error).slice(0, 300)}`);
      }
    } else if (args.gpt) {
      copyResult.warning = "OPENAI_API_KEY not configured; deterministic evidence fallback used";
    }

    const override = overrides?.products?.[handle];
    let copy = override
      ? {
          title: comparableValue(override.title || baseline.title),
          descriptionHtml: String(override.descriptionHtml || baseline.descriptionHtml).trim(),
          seoTitle: comparableValue(override.seoTitle || override.title || baseline.seoTitle),
          seoDescription: comparableValue(override.seoDescription || baseline.seoDescription),
        }
      : copyResult.copy;
    let quality = validateCopy(copy, liveProduct);
    if (!quality.ok && copy !== baseline) {
      copy = baseline;
      copyResult.provider = "deterministic-evidence-fallback";
      quality = validateCopy(copy, liveProduct);
    }
    const prior = priorByHandle.get(handle);
    items.push({
      handle,
      productId: liveProduct.id,
      sourceTitle: liveProduct.title || "",
      sourceUpdatedAt: liveProduct.updatedAt || "",
      imageHealth,
      desired: copy,
      provider: override ? "approved-exact-override" : copyResult.provider,
      providerWarning: override ? "config/future-light-seo-overrides.json" : copyResult.warning || "",
      quality,
      status: imageHealth.eligible ? (quality.ok ? "pending" : "held_quality") : "held_image",
      attempts: Number(prior?.attempts || 0),
      failures: Array.isArray(prior?.failures) ? prior.failures : [],
      verifiedAt: "",
    });
  }

  ensureDistinctProductCopy(items, liveByHandle);

  return {
    schemaVersion: "2026-09-14.future-light-seo-gpt-200.1",
    generatedAt: now(),
    mode: args.mode,
    batchSize: args.batchSize,
    providerMode: args.gpt ? "gpt-with-deterministic-fallback" : "deterministic-evidence",
    warnings,
    imagePreflight: {
      ready: imagePreflight.ready,
      status: imagePreflight.status,
      reason: imagePreflight.reason,
      sourceFingerprint: imagePreflight.sourceFingerprint,
      productsAudited: Number(imagePreflight.manifest?.summary?.productsAudited || 0),
      productsInScope: Number(imagePreflight.manifest?.summary?.productsInScope || 0),
      repairQueueItems: Number(imagePreflight.manifest?.summary?.repairQueueItems || 0),
    },
    sourceCount: liveProducts.length,
    plannedCount: items.length,
    items,
  };
}

function createMutationGroups(items, groupSize = 20) {
  const groups = [];
  for (let index = 0; index < items.length; index += groupSize) groups.push(items.slice(index, index + groupSize));
  return groups;
}

function buildMutationForGroup(group) {
  const declarations = [];
  const variables = {};
  const aliases = [];
  for (let index = 0; index < group.length; index += 1) {
    const alias = `p${index}`;
    declarations.push(`$${alias}: ProductUpdateInput!`);
    const item = group[index];
    variables[alias] = {
      id: item.productId,
      title: item.desired.title,
      descriptionHtml: item.desired.descriptionHtml,
      seo: {
        title: item.desired.seoTitle,
        description: item.desired.seoDescription,
      },
    };
    aliases.push(alias);
  }
  const fields = aliases.map((alias) => `${alias}: productUpdate(product: $${alias}) { product { id handle } userErrors { field message } }`).join(" ");
  return {
    query: `mutation FutureLightSeoBatch(${declarations.join(", ")}) { ${fields} }`,
    variables,
    aliases,
  };
}

function needsWrite(item, liveProduct) {
  if (!liveProduct) return true;
  return comparableValue(liveProduct.title) !== comparableValue(item.desired.title) ||
    comparableText(liveProduct.descriptionHtml) !== comparableText(item.desired.descriptionHtml) ||
    (comparableValue(liveProduct.seo?.title) || comparableValue(liveProduct.title)) !== comparableValue(item.desired.seoTitle) ||
    comparableValue(liveProduct.seo?.description) !== comparableValue(item.desired.seoDescription);
}

async function readbackProducts(client, ids, state, persistState) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const chunks = [];
  for (let index = 0; index < uniqueIds.length; index += 50) chunks.push(uniqueIds.slice(index, index + 50));
  const responses = await mapWithConcurrency(
    chunks,
    Math.min(4, recommendedConcurrency({ kind: "io", reserve: 2, max: 6 }), chunks.length || 1),
    (chunk, index) => runWithNetworkWait(
      client,
      `SEO readback chunk ${index + 1}/${chunks.length}`,
      () => client.run(PRODUCT_READBACK_QUERY, { ids: chunk }, { operation: `Future Light SEO readback ${index + 1}/${chunks.length}` }),
      state,
      persistState,
    ),
  );
  return new Map(responses.flatMap((response) => Array.isArray(response?.nodes) ? response.nodes.filter(Boolean).map((product) => [product.id, product]) : []));
}

async function processBatch({ batch, liveById, client, state, persistState, args, manifest }) {
  const pending = [];
  for (const item of batch) {
    if (item.imageHealth?.eligible !== true) {
      item.status = "held_image";
      continue;
    }
    if (!item.quality?.ok) {
      item.status = "held_quality";
      continue;
    }
    const liveProduct = liveById.get(item.productId);
    if (!needsWrite(item, liveProduct)) {
      item.status = "verified";
      item.verifiedAt = now();
      continue;
    }
    item.status = "pending";
    pending.push(item);
  }

  if (args.mode === "dry-run" || !pending.length) {
    if (args.mode === "dry-run") {
      for (const item of pending) item.status = "dry_run_ready";
    }
    return {
      pending: pending.length,
      written: 0,
      verified: batch.filter((item) => ["verified", "dry_run_ready"].includes(item.status)).length,
      failed: batch.filter((item) => ["held_quality", "held_image"].includes(item.status)).length,
    };
  }

  const groupSize = Math.min(25, Math.max(1, Number(process.env.FUTURE_LIGHT_SEO_MUTATION_GROUP_SIZE || 20)));
  const groups = createMutationGroups(pending, groupSize);
  const mutationConcurrency = Math.min(6, recommendedConcurrency({ kind: "io", reserve: 2, max: 6 }));
  const results = await mapWithConcurrency(groups, mutationConcurrency, async (group, groupIndex) => {
    try {
      const mutation = buildMutationForGroup(group);
      const data = await runWithNetworkWait(
        client,
        `SEO mutation group ${groupIndex + 1}/${groups.length}`,
        () => client.run(mutation.query, mutation.variables, { allowMutations: true, operation: `Future Light SEO mutation group ${groupIndex + 1}/${groups.length}` }),
        state,
        persistState,
      );
      return { group, data, aliases: mutation.aliases, error: "" };
    } catch (error) {
      return { group, data: null, aliases: [], error: String(error?.message || error) };
    }
  });

  const written = [];
  for (const result of results) {
    result.group.forEach((item, index) => {
      item.attempts = Number(item.attempts || 0) + 1;
      const payload = result.data?.[result.aliases[index]];
      const userErrors = payload?.userErrors || [];
      if (result.error) {
        item.status = "failed";
        item.failures.push(result.error.slice(0, 600));
      } else if (userErrors.length) {
        item.status = "failed";
        item.failures.push(formatErrors(userErrors).slice(0, 600));
      } else {
        item.status = "written_pending_readback";
        written.push(item);
      }
    });
  }
  await writeJsonAtomic(manifestPath, manifest);

  if (written.length) {
    const readback = await readbackProducts(client, written.map((item) => item.productId), state, persistState);
    for (const item of written) {
      const liveProduct = readback.get(item.productId);
      const actual = liveProduct && {
        title: liveProduct.title,
        descriptionHtml: liveProduct.descriptionHtml,
        // Shopify returns a null SEO title when it inherits the product title.
        // Treat that canonical inherited value as equivalent only when the
        // desired SEO title is the product title; distinct SEO titles must
        // still be explicitly present in the readback.
        seoTitle: liveProduct.seo?.title || liveProduct.title || "",
        seoDescription: liveProduct.seo?.description || "",
      };
      const quality = actual ? validateCopy(actual, { ...liveProduct, handle: item.handle }) : { ok: false, issues: ["missing-readback"] };
      const exact = actual && comparableValue(actual.title) === comparableValue(item.desired.title) &&
        comparableText(actual.descriptionHtml) === comparableText(item.desired.descriptionHtml) &&
        comparableValue(actual.seoTitle) === comparableValue(item.desired.seoTitle) &&
        comparableValue(actual.seoDescription) === comparableValue(item.desired.seoDescription);
      if (quality.ok && exact) {
        item.status = "verified";
        item.verifiedAt = now();
      } else {
        item.status = "failed";
        item.failures.push(`readback-mismatch:${[...(quality.issues || []), exact ? "" : "values-differ"].filter(Boolean).join(",")}`.slice(0, 600));
      }
    }
  }

  await writeJsonAtomic(manifestPath, manifest);
  return {
    pending: pending.length,
    written: written.length,
    verified: batch.filter((item) => item.status === "verified").length,
    failed: batch.filter((item) => ["failed", "held_quality", "held_image"].includes(item.status)).length,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  await loadFutureLightEnv({ rootDir });
  await acquireLock();

  let state = await readJson(statePath, null);
  if (args.resume && state?.status === "completed") {
    console.log(`Future Light SEO runner is already complete: ${state.verifiedProducts || 0} verified product(s).`);
    await releaseLock();
    return;
  }
  state = {
    schemaVersion: "2026-09-14.future-light-seo-gpt-200.state.1",
    status: "starting",
    mode: args.mode,
    startedAt: state?.startedAt || now(),
    updatedAt: now(),
    batchSize: args.batchSize,
    totalBatches: 0,
    activeProducts: 0,
    plannedProducts: 0,
    verifiedProducts: 0,
    failedProducts: 0,
    heldQualityProducts: 0,
    heldImageProducts: 0,
    imagePreflightReady: false,
    nextBatchIndex: args.resume ? Number(state?.nextBatchIndex || 0) : 0,
    networkRetries: Number(state?.networkRetries || 0),
    lastError: "",
    warnings: [],
  };
  const persistState = async () => {
    state.updatedAt = now();
    await writeJsonAtomic(statePath, state);
  };
  await persistState();

  try {
    const client = createShopifyAdminGraphQLClient({ rootDir, agentName: "future-light-seo-gpt-200" });
    const liveProducts = await fetchActiveProducts(client, state, persistState);
    const scopedProducts = args.handles.length
      ? liveProducts.filter((product) => args.handles.includes(normalizeHandleValue(product.handle)))
      : liveProducts;
    if (args.handles.length && scopedProducts.length !== args.handles.length) {
      const found = new Set(scopedProducts.map((product) => normalizeHandleValue(product.handle)));
      const missing = args.handles.filter((handle) => !found.has(handle));
      throw new Error(`Requested SEO handle(s) not found in the active catalog: ${missing.join(", ")}`);
    }
    const limitedProducts = args.limit ? scopedProducts.slice(0, args.limit) : scopedProducts;
    const liveById = new Map(limitedProducts.map((product) => [product.id, product]));
    const liveByHandle = new Map(limitedProducts.map((product) => [normalizeHandleValue(product.handle), product]));
    state.activeProducts = limitedProducts.length;
    state.status = "planning";
    const imagePreflight = await loadImageHealthPreflight(limitedProducts);
    state.imagePreflightReady = imagePreflight.ready;
    state.imagePreflight = {
      status: imagePreflight.status,
      ready: imagePreflight.ready,
      reason: imagePreflight.reason,
      sourceFingerprint: imagePreflight.sourceFingerprint,
      generatedAt: imagePreflight.manifest?.generatedAt || "",
      productsAudited: Number(imagePreflight.manifest?.summary?.productsAudited || 0),
      productsInScope: Number(imagePreflight.manifest?.summary?.productsInScope || 0),
      repairQueueItems: Number(imagePreflight.manifest?.summary?.repairQueueItems || 0),
    };
    await persistState();

    const priorManifest = args.resume && !args.forceReplan ? await readJson(manifestPath, null) : null;
    const reusableManifest = priorManifest && priorManifest.items?.length === limitedProducts.length &&
      priorManifest.schemaVersion === "2026-09-14.future-light-seo-gpt-200.1" &&
      priorManifest.imagePreflight?.sourceFingerprint === imagePreflight.sourceFingerprint &&
      priorManifest.imagePreflight?.ready === imagePreflight.ready &&
      priorManifest.imagePreflight?.generatedAt === (imagePreflight.manifest?.generatedAt || "") &&
      priorManifest.items.every((item) => liveById.has(item.productId));
    let manifest = reusableManifest
      ? priorManifest
      : null;
    if (!manifest) {
      const localPayload = await readProductCatalogPayload(inputDir);
      const collections = await readOptionalJson(resolve(inputDir, "collections.json"));
      const collectionProducts = await readOptionalJson(resolve(inputDir, "collection-products.json"));
      const knowledgeModel = await readCatalogKnowledgeModel({ required: true });
      const overrides = await readOptionalJson(overridesPath);
      const rows = buildRows(limitedProducts);
      const plan = await buildSeoBatchPlan(rows, {
        catalogContext: createSeoCatalogContext({
          products: localPayload.products,
          collections,
          collectionProducts,
        }),
        knowledgeModel,
        suppressCategoryWarnings: true,
      });
      manifest = await buildManifest({
        liveProducts: limitedProducts,
        plan,
        args,
        priorManifest: null,
        imagePreflight,
        overrides,
      });
      await writeJsonAtomic(manifestPath, manifest);
    } else {
      ensureDistinctProductCopy(manifest.items, liveByHandle);
      await writeJsonAtomic(manifestPath, manifest);
    }

    state.plannedProducts = manifest.items.length;
    state.totalBatches = Math.ceil(manifest.items.length / args.batchSize);
    state.warnings = manifest.warnings || [];
    state.providerMode = manifest.providerMode;
    await persistState();

    const batches = [];
    for (let index = 0; index < manifest.items.length; index += args.batchSize) batches.push(manifest.items.slice(index, index + args.batchSize));
    // A failed batch can be safely retried from the persisted manifest. Verified
    // items are skipped by needsWrite(), so this does not repeat successful
    // Shopify mutations. Keep this explicit for autonomous repair/resume runs.
    const firstBatch = args.retryFailed
      ? 0
      : args.resume ? Math.max(0, Number(state.nextBatchIndex || 0)) : 0;
    const lastBatch = args.maxBatches ? Math.min(batches.length, firstBatch + args.maxBatches) : batches.length;
    state.status = args.mode === "dry-run" ? "dry_run" : "running";
    await persistState();

    for (let batchIndex = firstBatch; batchIndex < lastBatch; batchIndex += 1) {
      const result = await processBatch({ batch: batches[batchIndex], liveById, client, state, persistState, args, manifest });
      state.nextBatchIndex = batchIndex + 1;
      state.verifiedProducts = manifest.items.filter((item) => item.status === "verified").length;
      state.failedProducts = manifest.items.filter((item) => item.status === "failed").length;
      state.heldQualityProducts = manifest.items.filter((item) => item.status === "held_quality").length;
      state.heldImageProducts = manifest.items.filter((item) => item.status === "held_image").length;
      await writeJsonAtomic(manifestPath, manifest);
      await persistState();
      console.log(`[SEO batch ${batchIndex + 1}/${batches.length}] eligible ${result.pending}, written ${result.written}, verified ${result.verified}, failed/held ${result.failed}, image-held ${state.heldImageProducts}`);
    }

    state.verifiedProducts = manifest.items.filter((item) => item.status === "verified").length;
    state.failedProducts = manifest.items.filter((item) => item.status === "failed").length;
    state.heldQualityProducts = manifest.items.filter((item) => item.status === "held_quality").length;
    state.heldImageProducts = manifest.items.filter((item) => item.status === "held_image").length;
    state.status = args.mode === "dry-run"
      ? (state.heldQualityProducts || state.heldImageProducts ? "dry_run_quality_blocked" : "dry_run_complete")
      : (state.failedProducts || state.heldQualityProducts || state.heldImageProducts ? "failed" : "completed");
    state.completedAt = now();
    await writeJsonAtomic(manifestPath, manifest);
    await persistState();
    const eligibleProducts = manifest.items.filter((item) => ["verified", "dry_run_ready"].includes(item.status)).length;
    state.eligibleProducts = eligibleProducts;
    await persistState();
    console.log(`Future Light SEO ${args.mode}: ${eligibleProducts}/${state.plannedProducts} quality-approved; ${state.verifiedProducts} live-verified; ${state.failedProducts} failed; ${state.heldQualityProducts} held by copy gate; ${state.heldImageProducts} held by image gate.`);
    if (state.status === "failed" || state.status === "dry_run_quality_blocked") process.exitCode = 1;
  } catch (error) {
    state.status = isNetworkError(error) ? "waiting_for_network" : "failed";
    state.lastError = String(error?.message || error).slice(0, 1200);
    await persistState();
    console.error(`Future Light SEO runner stopped safely: ${state.lastError}`);
    process.exitCode = 1;
  } finally {
    await releaseLock();
  }
}

await main();
