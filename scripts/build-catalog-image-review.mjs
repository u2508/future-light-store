#!/usr/bin/env node

import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { classifyCatalogTaxonomyWithoutOverrides } from "../src/lib/catalog-taxonomy.js";
import { isImageReviewedCatalogTaxonomyOverride } from "../src/lib/catalog-taxonomy-image-overrides.js";
import { getCatalogTaxonomyOverride } from "../src/lib/catalog-taxonomy-overrides.js";
import { readProductCatalogPayload } from "./product-catalog-files.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const dataDir = resolve(rootDir, "public", "data");
const defaultOutputDir = resolve(rootDir, "output", "catalog-image-review");

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function productImageUrls(product) {
  return unique(
    asArray(product?.images)
      .map((image) => (typeof image === "string" ? image : image?.src || image?.url || image?.originalSrc || ""))
      .map(normalizeText),
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseArgs(argv) {
  const args = {
    outputDir: defaultOutputDir,
    pageSize: 20,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--output") {
      args.outputDir = resolve(rootDir, argv[index + 1] || args.outputDir);
      index += 1;
      continue;
    }
    if (token === "--page-size") {
      args.pageSize = Math.max(1, Math.min(100, Number(argv[index + 1] || args.pageSize) || args.pageSize));
      index += 1;
    }
  }

  return args;
}

function reviewRecord(product) {
  const rawClassification = classifyCatalogTaxonomyWithoutOverrides(product);
  const override = getCatalogTaxonomyOverride(product);
  const imageUrls = productImageUrls(product);
  const imageReviewed = isImageReviewedCatalogTaxonomyOverride(override);
  const rawRequiresVisualReview = rawClassification.reviewRequired === true;

  return {
    productId: String(product?.id || ""),
    handle: normalizeText(product?.handle),
    title: normalizeText(product?.title),
    productType: normalizeText(product?.product_type || product?.productType),
    imageUrls,
    rawClassification: {
      ruleId: rawClassification.ruleId,
      departmentId: rawClassification.departmentId,
      categoryId: rawClassification.categoryId,
      subcategoryId: rawClassification.subcategoryId,
      canonicalType: rawClassification.canonicalType,
      confidence: rawClassification.confidence,
      reviewRequired: rawRequiresVisualReview,
      reviewReasons: rawClassification.reviewReasons,
    },
    visualOverride: override
      ? {
        id: override.id,
        ruleId: override.ruleId,
        imageReviewed,
        imageUrl: normalizeText(override.imageUrl),
        reviewedAt: normalizeText(override.reviewedAt),
        reason: normalizeText(override.reason),
      }
      : null,
    status: !rawRequiresVisualReview
      ? "not-required"
      : imageReviewed
        ? "reviewed"
        : imageUrls.length
          ? "pending"
          : "blocked-no-image",
  };
}

function pageNavigation(pageNumber, totalPages) {
  const links = [];
  if (pageNumber > 1) links.push(`<a href="page-${String(pageNumber - 1).padStart(3, "0")}.html">Previous</a>`);
  links.push(`<a href="index.html">Index</a>`);
  if (pageNumber < totalPages) links.push(`<a href="page-${String(pageNumber + 1).padStart(3, "0")}.html">Next</a>`);
  return links.join(" ");
}

function renderProductCard(record) {
  const reasons = asArray(record.rawClassification.reviewReasons).join(", ") || "Visual confirmation required";
  const imageMarkup = record.imageUrls.length
    ? `<div class="image-grid">${record.imageUrls.map((image, index) => `<figure><a href="${escapeHtml(image)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(image)}" alt="${escapeHtml(`${record.title} image ${index + 1}`)}" loading="lazy"></a><figcaption>Image ${index + 1}</figcaption></figure>`).join("")}</div>`
    : "<div class=\"image-missing\">No image in refreshed catalog</div>";

  return `<article class="product-card">
    <div class="image-wrap">${imageMarkup}</div>
    <div class="details">
      <p class="eyebrow">${escapeHtml(record.status)}</p>
      <h2>${escapeHtml(record.title || record.handle || record.productId)}</h2>
      <dl>
        <div><dt>Product ID</dt><dd>${escapeHtml(record.productId)}</dd></div>
        <div><dt>Handle</dt><dd>${escapeHtml(record.handle)}</dd></div>
        <div><dt>Text suggestion</dt><dd>${escapeHtml(record.rawClassification.ruleId)} / ${escapeHtml(record.rawClassification.canonicalType)}</dd></div>
        <div><dt>Confidence</dt><dd>${escapeHtml(record.rawClassification.confidence)}</dd></div>
        <div><dt>Why it needs visual review</dt><dd>${escapeHtml(reasons)}</dd></div>
      </dl>
      <p class="image-link">${record.imageUrls.length ? `${record.imageUrls.length} source images shown above` : "Image refresh or deletion decision required"}</p>
    </div>
  </article>`;
}

function renderPage({ pageNumber, totalPages, records, summary }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SALT image review ${pageNumber}/${totalPages}</title>
  <style>
    :root { color-scheme: light; font-family: Georgia, "Times New Roman", serif; background: #f7f2e9; color: #14233b; }
    body { margin: 0; padding: 28px; background: radial-gradient(circle at 0 0, #fffaf0 0, transparent 45%), #f7f2e9; }
    header { max-width: 1260px; margin: 0 auto 22px; padding: 24px; border: 1px solid #d8c8ab; background: #fffdf9; box-shadow: 0 10px 28px rgba(48, 36, 18, .08); }
    h1 { margin: 0; font-size: clamp(28px, 4vw, 46px); letter-spacing: -.03em; }
    .summary { color: #725b2b; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    nav { margin-top: 14px; display: flex; gap: 12px; flex-wrap: wrap; }
    a { color: #0f5b65; font-weight: 700; }
    main { max-width: 1260px; margin: 0 auto; display: grid; gap: 18px; }
    .product-card { display: grid; grid-template-columns: minmax(180px, 300px) 1fr; overflow: hidden; border: 1px solid #d8c8ab; background: #fffdf9; box-shadow: 0 10px 28px rgba(48, 36, 18, .07); }
    .image-wrap { min-height: 240px; background: #eee5d7; display: grid; place-items: center; }
    .image-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; padding: 10px; align-content: start; background: #eee5d7; }
    figure { margin: 0; min-width: 0; background: white; border: 1px solid #d8c8ab; }
    img { display: block; width: 100%; aspect-ratio: 1; object-fit: contain; background: white; }
    figcaption { padding: 4px 6px; color: #725b2b; font: 700 10px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; }
    .details { padding: 20px; }
    .eyebrow { margin: 0 0 6px; color: #a74827; font: 700 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; letter-spacing: .14em; }
    h2 { margin: 0 0 15px; font-size: clamp(20px, 2.3vw, 30px); line-height: 1.05; }
    dl { margin: 0; display: grid; gap: 10px; }
    dl div { display: grid; grid-template-columns: minmax(150px, 27%) 1fr; gap: 14px; }
    dt { color: #725b2b; font: 700 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; letter-spacing: .08em; }
    dd { margin: 0; overflow-wrap: anywhere; }
    .image-link { margin-bottom: 0; }
    .image-missing { padding: 24px; color: #8a3030; text-align: center; font-weight: 700; }
    @media (max-width: 720px) { body { padding: 12px; } .product-card { grid-template-columns: 1fr; } dl div { grid-template-columns: 1fr; gap: 2px; } }
  </style>
</head>
<body>
  <header>
    <h1>Visual taxonomy review</h1>
    <p class="summary">Page ${pageNumber} of ${totalPages}. Pending: ${summary.pending}. Reviewed: ${summary.reviewed}. No-image blockers: ${summary.blockedNoImage}.</p>
    <nav>${pageNavigation(pageNumber, totalPages)}</nav>
  </header>
  <main>${records.map(renderProductCard).join("\n")}</main>
</body>
</html>`;
}

function renderIndex({ pageRecords, summary }) {
  const pageLinks = pageRecords.map((records, index) => {
    const pageNumber = index + 1;
    const first = records[0];
    const last = records.at(-1);
    return `<li><a href="page-${String(pageNumber).padStart(3, "0")}.html">Page ${pageNumber}</a> (${records.length} products): ${escapeHtml(first?.title || first?.handle)} through ${escapeHtml(last?.title || last?.handle)}</li>`;
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SALT visual taxonomy review</title>
  <style>
    :root { font-family: Georgia, "Times New Roman", serif; background: #f7f2e9; color: #14233b; }
    body { max-width: 980px; margin: 0 auto; padding: 44px 24px; }
    section { padding: 28px; border: 1px solid #d8c8ab; background: #fffdf9; box-shadow: 0 10px 28px rgba(48,36,18,.08); }
    h1 { margin-top: 0; font-size: clamp(30px, 5vw, 56px); letter-spacing: -.04em; }
    .counts { display: flex; flex-wrap: wrap; gap: 10px; margin: 24px 0; }
    .count { padding: 8px 12px; border: 1px solid #d8c8ab; border-radius: 999px; font: 700 13px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
    a { color: #0f5b65; font-weight: 700; }
    li { margin: 12px 0; }
  </style>
</head>
<body>
  <section>
    <h1>Visual taxonomy review queue</h1>
    <p>This queue is generated from the refreshed Shopify catalog. An item only leaves the queue after a source-controlled override records an inspected image URL and category decision.</p>
    <div class="counts">
      <span class="count">Total products: ${summary.totalProducts}</span>
      <span class="count">Visual candidates: ${summary.visualCandidates}</span>
      <span class="count">Reviewed: ${summary.reviewed}</span>
      <span class="count">Pending: ${summary.pending}</span>
      <span class="count">No-image blockers: ${summary.blockedNoImage}</span>
    </div>
    <ol>${pageLinks.join("\n")}</ol>
  </section>
</body>
</html>`;
}

async function main() {
  const args = parseArgs(process.argv);
  const payload = await readProductCatalogPayload(dataDir);
  const records = asArray(payload.products)
    .map(reviewRecord)
    .filter((record) => record.rawClassification.reviewRequired)
    .sort((left, right) => left.status.localeCompare(right.status) || left.title.localeCompare(right.title) || left.productId.localeCompare(right.productId));
  const pending = records.filter((record) => record.status === "pending");
  const summary = {
    generatedAt: new Date().toISOString(),
    taxonomyVersion: records[0]?.rawClassification?.version || "current",
    totalProducts: asArray(payload.products).length,
    visualCandidates: records.length,
    reviewed: records.filter((record) => record.status === "reviewed").length,
    pending: pending.length,
    blockedNoImage: records.filter((record) => record.status === "blocked-no-image").length,
  };
  summary.fallbackReviewProducts = summary.pending + summary.blockedNoImage;
  const pages = Array.from({ length: Math.ceil(pending.length / args.pageSize) }, (_, index) =>
    pending.slice(index * args.pageSize, (index + 1) * args.pageSize),
  );

  await rm(args.outputDir, { recursive: true, force: true });
  await mkdir(args.outputDir, { recursive: true });
  await writeFile(resolve(args.outputDir, "review-manifest.json"), `${JSON.stringify({ summary, records }, null, 2)}\n`, "utf8");
  const fallbackRecords = records
    .filter((record) => record.status === "pending" || record.status === "blocked-no-image")
    .map((record) => ({
      productId: record.productId,
      handle: record.handle,
      title: record.title,
      reason: record.status === "blocked-no-image" ? "no-image" : "visual-decision-required",
      collectionHandle: "classification-review",
      managedTag: "classification-review",
      semanticAssignmentAllowed: false,
    }));
  await writeFile(
    resolve(args.outputDir, "classification-review-fallback.json"),
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      policy: "unresolved visual taxonomy products are held in classification-review and receive no semantic collection assignment",
      products: fallbackRecords,
    }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(resolve(args.outputDir, "index.html"), renderIndex({ pageRecords: pages, summary }), "utf8");
  await Promise.all(
    pages.map((records, index) =>
      writeFile(
        resolve(args.outputDir, `page-${String(index + 1).padStart(3, "0")}.html`),
        renderPage({ pageNumber: index + 1, totalPages: pages.length, records, summary }),
        "utf8",
      ),
    ),
  );

  process.stdout.write(
    `Catalog image review queue generated: ${summary.pending} pending, ${summary.reviewed} reviewed, ${summary.blockedNoImage} no-image blockers; ${summary.fallbackReviewProducts} explicit classification-review fallback products.\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
