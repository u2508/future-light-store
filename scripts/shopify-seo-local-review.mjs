#!/usr/bin/env node

import { access, readFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import XLSX from "xlsx";
import {
  buildSeoBatchExportRows,
  buildSeoBatchManifest,
  buildSeoBatchPlan,
  createSeoCatalogContext,
} from "../src/lib/shopify-seo-batch-intelligence.js";
import { normalizeHandleValue, normalizePlainText } from "../src/lib/shopify-seo-batch.js";
import { readProductCatalogPayload } from "./product-catalog-files.mjs";

const root = resolve(process.cwd());
const inputs = process.argv.slice(2).filter((entry) => !entry.startsWith("--"));
const outputDir = resolve(root, "output/shopify-seo-local-review");
const workbookPath = resolve(outputDir, "shopify-seo-local-review.xlsx");
const workbookRowLimit = Math.max(100, Number(process.env.SALT_SEO_LOCAL_REVIEW_WORKBOOK_LIMIT || 1000));
const defaultSourceInputs = [
  "/Users/mac/Documents/Codex/2026-07-11/a/outputs/products_export_1_optimized.csv",
  "/Users/mac/Documents/Codex/2026-07-11/a/outputs/products_export_2_optimized.csv",
  "/Users/mac/Documents/Codex/2026-07-11/a/outputs/products_export_3_optimized.csv",
  "/Users/mac/Documents/Codex/2026-07-11/a/outputs/products_export_4_optimized.csv",
];

const catalogSnapshot = {
  products: await readProductCatalogPayload(resolve(root, "public/data")),
  collections: JSON.parse(await readFile(resolve(root, "public/data/collections.json"), "utf8")),
  collectionProducts: JSON.parse(await readFile(resolve(root, "public/data/collection-products.json"), "utf8")),
};
const catalogContext = createSeoCatalogContext(catalogSnapshot);
const protectedFields = [
  "Product ID", "Variant ID", "Handle", "Variant SKU", "SKU", "Barcode", "Image Src",
  "Inventory Qty", "Inventory Tracker", "Inventory Policy", "Vendor", "Status", "Tags",
  "Type", "Product Type",
];
const metafieldColumns = [];
const ADVISORY_AUDIT_ISSUES = new Set(["insufficient-product-facts", "weak-handle-alignment", "title-length"]);
const MANAGED_MINIMUM_QUANTITY_TAG = /^minimum-qty-(?:2|3)$/i;

function normalizeProtectedFieldValue(field, value) {
  if (field !== "Tags") return String(value ?? "");

  return String(value ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag) => !MANAGED_MINIMUM_QUANTITY_TAG.test(tag))
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }))
    .join(",");
}

function parseCsvMatrix(text) {
  const matrix = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value.replace(/\r$/, ""));
      matrix.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  if (value || row.length) {
    row.push(value.replace(/\r$/, ""));
    matrix.push(row);
  }
  return matrix;
}

async function readCsv(filePath) {
  const matrix = parseCsvMatrix((await readFile(filePath, "utf8")).replace(/^\uFEFF/, ""));
  const header = matrix[0] || [];
  const rows = matrix.slice(1).filter((values) => values.some((value) => value !== "")).map((values) =>
    Object.fromEntries(header.map((key, index) => [key, values[index] ?? ""])),
  );
  return { header, rows };
}

function escapeCsv(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildCsv(rows, header) {
  return `\uFEFF${[header.map(escapeCsv).join(","), ...rows.map((row) => header.map((key) => escapeCsv(row[key])).join(","))].join("\r\n")}\r\n`;
}

const LIVE_CATALOG_REVIEW_HEADERS = [
  "Product ID", "Handle", "Title", "Body (HTML)", "Vendor", "Product Type", "Tags", "Status", "Published",
  "Image Src",
  "SEO Title", "SEO Description", "Google Shopping / Google Product Category",
];

function buildLiveCatalogReviewRows(products) {
  return (Array.isArray(products) ? products : []).map((product) => {
    const image = Array.isArray(product?.images) ? product.images[0] || {} : {};
    const seo = product?.seo && typeof product.seo === "object" ? product.seo : {};

    return {
      "Product ID": product?.id || "",
      Handle: product?.handle || "",
      Title: product?.title || "",
      "Body (HTML)": product?.body_html || "",
      Vendor: product?.vendor || "",
      "Product Type": product?.product_type || "",
      Tags: Array.isArray(product?.tags) ? product.tags.join(", ") : product?.tags || "",
      Status: product?.status || "active",
      Published: product?.published_at ? "TRUE" : "FALSE",
      "Image Src": image?.src || image?.url || "",
      "SEO Title": seo?.title || product?.seo_title || "",
      "SEO Description": seo?.description || product?.seo_description || "",
      "Google Shopping / Google Product Category": product?.google_product_category || "",
    };
  });
}

function get(row, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name) && normalizePlainText(row[name])) return normalizePlainText(row[name]);
  }
  return "";
}

function htmlIsApproved(value) {
  const tags = [...String(value || "").matchAll(/<\/?([a-z0-9]+)\b/gi)].map((match) => match[1].toLowerCase());
  return tags.every((tag) => ["h2", "h3", "p", "ul", "li", "strong", "ol"].includes(tag));
}

let sourceInputs = inputs.length
  ? inputs.map((entry) => resolve(process.cwd(), entry))
  : defaultSourceInputs;

function checkRows(sourceRows, outputRows, header, plans, fileName) {
  const checks = [];
  const first = new Map();
  sourceRows.forEach((row, index) => {
    const handle = normalizeHandleValue(get(row, ["Handle"]));
    if (handle && !first.has(handle)) first.set(handle, index);
  });
  const planByHandle = new Map(plans.products.map((plan) => [plan.handle, plan]));
  let changed = 0;
  let invalidHtml = 0;
  let protectedChanged = 0;
  let missingSeo = 0;
  for (let index = 0; index < sourceRows.length; index += 1) {
    const before = sourceRows[index];
    const after = outputRows[index];
    const handle = normalizeHandleValue(get(before, ["Handle"]));
    const plan = planByHandle.get(handle);
    const isPrimary = first.get(handle) === index;
    for (const field of header) {
      if (
        protectedFields.includes(field) &&
        normalizeProtectedFieldValue(field, before[field]) !== normalizeProtectedFieldValue(field, after[field])
      ) {
        protectedChanged += 1;
      }
    }
    if (isPrimary && plan) {
      const body = get(after, ["Body (HTML)"]);
      if (body && !htmlIsApproved(body)) invalidHtml += 1;
      if (!get(after, ["SEO Title"]) || !get(after, ["SEO Description"])) missingSeo += 1;
    }
    if (JSON.stringify(before) !== JSON.stringify(after)) changed += 1;
  }
  checks.push({ file: fileName, rows: sourceRows.length, columns: header.length, handles: planByHandle.size, changedRows: changed, protectedFieldChanges: protectedChanged, invalidHtmlProducts: invalidHtml, missingSeoProducts: missingSeo, plannedWrites: plans.summary?.totalWrites || 0, status: protectedChanged || invalidHtml || missingSeo ? "review" : "pass" });
  return checks;
}

await mkdir(outputDir, { recursive: true });

if (!inputs.length) {
  const missingDefaultInputs = [];
  for (const inputPath of defaultSourceInputs) {
    try {
      await access(inputPath);
    } catch {
      missingDefaultInputs.push(inputPath);
    }
  }

  if (missingDefaultInputs.length === defaultSourceInputs.length) {
    const liveCatalogInput = resolve(outputDir, "shopify-live-catalog-review.csv");
    const liveRows = buildLiveCatalogReviewRows(catalogSnapshot.products.products);
    await writeFile(liveCatalogInput, buildCsv(liveRows, LIVE_CATALOG_REVIEW_HEADERS), "utf8");
    sourceInputs = [liveCatalogInput];
    process.stdout.write(
      `Historical SEO CSVs unavailable; generated a live-catalog review input for ${liveRows.length} products at ${liveCatalogInput}\n`,
    );
  }
}

const allOptimized = [];
const allQa = [];
const allMetafields = [];
const allProductAudit = [];
const summaries = [];
const workbookSampleLimitPerFile = 250;

function auditProducts(rows, fileName, plans) {
  const seen = new Set();
  const results = [];
  const planByHandle = new Map((plans?.products || []).map((entry) => [entry.handle, entry]));
  for (const row of rows) {
    const handle = normalizeHandleValue(get(row, ["Handle"]));
    if (!handle || seen.has(handle)) continue;
    seen.add(handle);
    const title = get(row, ["Title"]);
    const productPlan = planByHandle.get(handle);
    const seoTitle = get(row, ["SEO Title"]);
    const seoDescription = get(row, ["SEO Description"]);
    const body = String(row["Body (HTML)"] || "");
    const plainBody = normalizePlainText(body.replace(/<[^>]+>/g, " ").replace(/&amp;/gi, "&"));
    const searchable = normalizePlainText(`${title} ${seoTitle} ${seoDescription} ${plainBody}`).toLowerCase();
    const handleTokens = handle
      .split(/[-_]+/)
      .filter((token) => token.length >= 3 && !["women", "womens", "woman", "2024", "2025", "2026", "fashion", "new"].includes(token));
    const handleHits = handleTokens.slice(0, 12).filter((token) => searchable.includes(token)).length;
    const issues = [];
    if (!title) issues.push("missing-title");
    else if (title.length < 20 || title.length > 75) issues.push("title-length");
    if (seoTitle.length < 35 || seoTitle.length > 65) issues.push("seo-title-length");
    if (seoDescription.length < 120 || seoDescription.length > 170) issues.push("seo-description-length");
    if (!["About", "Key Details", "Use & Care", "FAQs"].every((section) => plainBody.toLowerCase().includes(section.toLowerCase()))) issues.push("description-structure");
    if ((body.match(/<h[23]>/gi) || []).length > 5) issues.push("cluttered-description-structure");
    if (!htmlIsApproved(body)) issues.push("unsupported-html");
    if (/product identity|catalog context|listing data|shopper intent|easy to compare|straightforward product page/i.test(plainBody)) issues.push("generic-description-copy");
    const factLabels = ["product focus", "size or capacity", "material", "supported features", "intended user", "use or occasion", "style or design", "placement or setting", "device compatibility", "pack format"];
    const factHits = factLabels.filter((label) => plainBody.toLowerCase().includes(label)).length;
    if (handleTokens.length >= 5 && factHits < 1) issues.push("insufficient-product-facts");
    if (!productPlan?.intelligence?.knowledge?.titleOverride && handleHits < Math.max(2, Math.min(4, handleTokens.length))) issues.push("weak-handle-alignment");
    if (/lines water light|beauty product|personal care item|portable false eyelashes/i.test(title)) issues.push("generic-or-misclassified-title");
    const blockingIssues = issues.filter((issue) => !ADVISORY_AUDIT_ISSUES.has(issue));
    results.push({
      SourceFile: fileName,
      Handle: handle,
      KnowledgeFamily: productPlan?.intelligence?.knowledge?.family || "",
      KnowledgeVersion: productPlan?.intelligence?.knowledge?.version || "",
      SupportedFactCount: productPlan?.intelligence?.knowledge?.factCount || 0,
      Title: title,
      SeoTitle: seoTitle,
      SeoDescriptionLength: seoDescription.length,
      HandleEvidenceHits: handleHits,
      Status: blockingIssues.length ? "FAIL" : issues.length ? "WARN" : "PASS",
      Issues: issues.join(", "),
    });
  }
  return results;
}

for (const inputPath of sourceInputs) {
  const { rows, header } = await readCsv(inputPath);
  if (!get(rows[0] || {}, ["Handle"])) console.warn(`Handle parser diagnostic for ${basename(inputPath)}: ${JSON.stringify(Object.keys(rows[0] || {}).slice(0, 4))}`);
  const plan = await buildSeoBatchPlan(rows, { catalogContext, suppressCategoryWarnings: true });
  const optimizedRows = buildSeoBatchExportRows(rows, plan);
  const productAudit = auditProducts(optimizedRows, basename(inputPath), plan);
  const qa = checkRows(rows, optimizedRows, header, plan, basename(inputPath));
  summaries.push({ file: basename(inputPath), sourceRows: rows.length, products: plan.products.length, changedRows: qa[0].changedRows, plannedWrites: plan.products.reduce((sum, entry) => sum + (entry.writeCount || 0), 0), high: plan.products.filter((entry) => entry.rewriteLevel === "high").length, medium: plan.products.filter((entry) => entry.rewriteLevel === "medium").length, low: plan.products.filter((entry) => entry.rewriteLevel === "low").length });
  allQa.push(...qa);
  allProductAudit.push(...productAudit);
  for (const row of optimizedRows.slice(0, workbookSampleLimitPerFile)) allOptimized.push({ SourceFile: basename(inputPath), ...row });
  for (const row of rows.slice(0, workbookSampleLimitPerFile)) {
    const handle = normalizeHandleValue(get(row, ["Handle"]));
    if (!handle) continue;
    const metafields = Object.fromEntries(Object.keys(row).filter((key) => /metafield|rating|related|complementary|search product boosts|custom product|diaper|disclosure/i.test(key)).map((key) => [key, row[key]]));
    if (Object.keys(metafields).length) allMetafields.push({ SourceFile: basename(inputPath), Handle: handle, ...metafields });
  }
  const outputCsv = resolve(outputDir, `${basename(inputPath, ".csv")}.seo-reviewed.csv`);
  await writeFile(outputCsv, buildCsv(optimizedRows, header), "utf8");
  await import("node:fs/promises").then(({ writeFile }) => writeFile(resolve(outputDir, `${basename(inputPath)}.manifest.json`), `${JSON.stringify(buildSeoBatchManifest(plan, { inputPath, mode: "local-review" }), null, 2)}\n`));
}

console.log(JSON.stringify({
  mode: "local-review",
  workbookRowLimit,
  summaries: summaries.length,
  qaRows: allQa.length,
  optimizedRows: allOptimized.length,
  metafieldRows: allMetafields.length,
  auditRows: allProductAudit.length,
}, null, 2));
const fallback = XLSX.utils.book_new();
for (const [name, rows] of [["Summary", summaries], ["QA Checks", allQa], ["Optimized Products", allOptimized], ["Metafield Review", allMetafields], ["All Product Audit", allProductAudit]]) {
  if (rows.length) {
    const limitedRows = rows.slice(0, workbookRowLimit);
    const sheet = XLSX.utils.json_to_sheet(limitedRows);
    const widths = name === "Summary"
      ? [36, 14, 12, 14, 14, 10, 10, 10]
      : name === "QA Checks"
        ? [36, 12, 12, 12, 14, 18, 18, 18, 14, 12]
        : name === "All Product Audit"
          ? [34, 62, 48, 48, 20, 18, 12, 36]
          : name === "Optimized Products"
            ? [34, 62, 48, 90, ...Array(194).fill(18)]
            : [34, 62, ...Array(140).fill(24)];
    sheet["!cols"] = widths.map((wch) => ({ wch }));
    sheet["!autofilter"] = { ref: sheet["!ref"] };
    XLSX.utils.book_append_sheet(fallback, sheet, name);
  }
}
XLSX.writeFile(fallback, workbookPath);
const failedAudit = allProductAudit.filter((entry) => entry.Status === "FAIL");
const warningAudit = allProductAudit.filter((entry) => entry.Status === "WARN");
const failedQa = allQa.filter((entry) => entry.status !== "pass");
console.log(JSON.stringify({
  mode: "local-review",
  inputFiles: sourceInputs.length,
  summaries,
  audit: {
    products: allProductAudit.length,
    passed: allProductAudit.length - failedAudit.length - warningAudit.length,
    warnings: warningAudit.length,
    failed: failedAudit.length,
    sampleWarnings: warningAudit.slice(0, 20),
    sampleFailures: failedAudit.slice(0, 20),
  },
  qa: { rows: allQa.length, failures: failedQa.length, sampleFailures: failedQa.slice(0, 20) },
  workbookPath,
  csvOutputDir: outputDir,
  shopifyWrites: 0,
}, null, 2));
if (failedAudit.length || failedQa.length) process.exitCode = 2;
