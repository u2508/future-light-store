#!/usr/bin/env node

/* Local-only, read-only visual evidence viewer. It serves the persisted queue
 * as small contact sheets so ChatGPT can inspect source images with their
 * exact product handles before any approval file or Shopify mutation exists. */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildVariantImageReviewGroups,
  findVariantImageMappingConflicts,
} from "./lib/future-light-variant-image-review-groups.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const reviewDir = resolve(rootDir, "output", "future-light-visual-review");
const queueArgumentIndex = process.argv.indexOf("--queue");
const requestedQueuePath = queueArgumentIndex >= 0 ? process.argv[queueArgumentIndex + 1] : null;
const queuePath = requestedQueuePath
  ? resolve(rootDir, requestedQueuePath)
  : resolve(reviewDir, "queue.json");
const productSeoPath = resolve(rootDir, "public", "data", "product-seo.json");
const host = "127.0.0.1";
const port = Number(process.env.FUTURE_LIGHT_REVIEW_PORT || 4312);
const maxBatchSize = 24;
const maxOptionBatchSize = 4;

if (!queuePath.startsWith(`${reviewDir}/`)) {
  throw new Error("Visual review viewer queue must be inside output/future-light-visual-review/.");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function readQueue() {
  const queue = JSON.parse(await readFile(queuePath, "utf8"));
  // The queue was built before the final SEO artifact and can contain stale
  // titles (for example a pet product displayed as a T-shirt). Keep the
  // persisted evidence untouched, but show the current handle-matched title
  // in the read-only reviewer so a stale label never steers a visual decision.
  try {
    const seo = JSON.parse(await readFile(productSeoPath, "utf8"));
    queue.canonicalTitleByHandle = Object.fromEntries(
      (seo.products || [])
        .filter((product) => product?.handle && product?.title)
        .map((product) => [product.handle, product.title]),
    );
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    queue.canonicalTitleByHandle = {};
  }
  return queue;
}

function displayTitle(queue, entry) {
  return queue.canonicalTitleByHandle?.[entry.handle] || entry.title;
}

function page(queue, offset, limit) {
  const entries = (queue.imageEntries || []).slice(offset, offset + limit);
  const end = Math.min(queue.imageEntries?.length || 0, offset + limit);
  const cards = entries
    .map(
      (entry, index) => `
    <article class="card">
      <div class="meta"><span>#${offset + index + 1}</span><span>${escapeHtml(entry.handle)}</span></div>
      <h2>${escapeHtml(displayTitle(queue, entry))}</h2>
      <img loading="eager" src="${escapeHtml(entry.imageUrl)}" alt="${escapeHtml(displayTitle(queue, entry))}" />
      <a href="${escapeHtml(entry.imageUrl)}" target="_blank" rel="noreferrer">Open source image</a>
      <code>${escapeHtml(entry.imageUrl)}</code>
    </article>`,
    )
    .join("\n");
  const previous = offset > 0 ? `/batch?offset=${Math.max(0, offset - limit)}&limit=${limit}` : "#";
  const next =
    end < (queue.imageEntries?.length || 0) ? `/batch?offset=${end}&limit=${limit}` : "#";
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Future Light visual evidence ${offset + 1}-${end}</title>
<style>
  :root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#101217;color:#f2f4f8}
  body{margin:0;padding:24px} header{position:sticky;top:0;background:#101217ee;backdrop-filter:blur(12px);padding:10px 0 18px;z-index:2}
  h1{font-size:22px;margin:0 0 6px}.note{color:#aeb7c7;font-size:13px}.nav{display:flex;gap:12px;margin-top:12px}.nav a{color:#a7c7ff;border:1px solid #38547f;padding:8px 12px;border-radius:8px;text-decoration:none}.nav a.disabled{opacity:.4;pointer-events:none}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px;margin-top:20px}.card{background:#1a1e27;border:1px solid #303846;border-radius:12px;padding:12px;overflow:hidden}.meta{display:flex;gap:8px;color:#92a1b6;font:11px ui-monospace,monospace}.meta span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.card h2{font-size:14px;line-height:1.35;min-height:38px;margin:10px 0}.card img{display:block;width:100%;height:240px;object-fit:contain;background:#fff;border-radius:8px}.card a{display:block;margin-top:9px;color:#a7c7ff;font-size:12px}.card code{display:block;color:#7e8ba0;font:10px ui-monospace,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:7px}
</style></head><body>
<header><h1>Future Light visual evidence · ${offset + 1}-${end} / ${queue.imageEntries?.length || 0}</h1>
<div class="note">Read-only source review. Keep beautiful/product-accurate images. Recreate only with objective issue + exact product identity confirmation.</div>
<nav class="nav"><a class="${offset === 0 ? "disabled" : ""}" href="${previous}">← Previous</a><a class="${end >= (queue.imageEntries?.length || 0) ? "disabled" : ""}" href="${next}">Next →</a><a href="/options?offset=0&limit=${maxOptionBatchSize}">Review options &amp; variant media →</a></nav></header>
<main class="grid">${cards}</main></body></html>`;
}

function optionPage(queue, offset, limit) {
  const products = (queue.variantEntries || []).slice(offset, offset + limit);
  const end = Math.min(queue.variantEntries?.length || 0, offset + limit);
  const cards = products
    .map((entry, index) => {
      const title = displayTitle(queue, entry);
      const mediaIndexById = new Map(
        (entry.media || []).map((media, mediaIndex) => [media.id, mediaIndex + 1]),
      );
      const productMedia = (entry.media || [])
        .map(
          (media, mediaIndex) => `
      <a class="candidate" href="${escapeHtml(media.url)}" target="_blank" rel="noreferrer">
        <img class="thumb" loading="lazy" src="${escapeHtml(media.url)}" alt="${escapeHtml(media.alt || `${title} candidate ${mediaIndex + 1}`)}" />
        <span>#${mediaIndex + 1} · ${escapeHtml(media.id)}</span><small>${escapeHtml(media.alt || "No image alt text")} · ${media.width || "?"}×${media.height || "?"}</small>
      </a>`,
        )
        .join("");
      const regularOptions =
        (queue.optionEntries || []).find((item) => item.handle === entry.handle)?.options || [];
      const variantOnlyOptions =
        (queue.variantOptionEntries || []).find((item) => item.handle === entry.handle)?.options ||
        [];
      const optionsByName = new Map();
      for (const option of [...regularOptions, ...variantOnlyOptions]) {
        const key = String(option.optionName || "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
        if (!key) continue;
        const existing = optionsByName.get(key) || { ...option, values: [] };
        const knownValues = new Set(existing.values.map((value) => value.currentName));
        for (const value of option.values || []) {
          if (!knownValues.has(value.currentName)) {
            existing.values.push(value);
            knownValues.add(value.currentName);
          }
        }
        optionsByName.set(key, existing);
      }
      const options = [...optionsByName.values()];
      const optionRows = options
        .map(
          (option) => `
      <div class="option-row"><strong>${escapeHtml(option.optionName)}</strong><div class="chips">${(
        option.values || []
      )
        .map((value) => {
          const raw =
            Boolean(option.source === "variant-selected-option") ||
            /china|mainland|tk[-_]?\d{4,}/i.test(String(value.currentName || ""));
          return `<span class="chip ${raw ? "raw" : ""}">${escapeHtml(value.currentName)} <small>${raw ? "raw/unverified" : "review required"}</small></span>`;
        })
        .join("")}</div></div>`,
        )
        .join("");
      const mappingConflicts = findVariantImageMappingConflicts(entry);
      const conflictMarkup = mappingConflicts.length
        ? `<div class="conflict"><strong>Mapping conflict detected</strong><ul>${mappingConflicts.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>Current associations are evidence only and must not be trusted as the final variant mapping.</div>`
        : "";
      const reviewGroups = buildVariantImageReviewGroups(entry);
      const variants = reviewGroups
        .map((group, groupIndex) => {
          const groupLabel = group.visualOptionValues.length
            ? group.visualOptionValues
                .map((option) => `${escapeHtml(option.name)}: ${escapeHtml(option.value)}`)
                .join(" · ")
            : "Variant-specific review";
          const members = group.variants
            .map((variant) => {
              const selections = (variant.selectedOptions || [])
                .map((item) => `${escapeHtml(item.name)}: ${escapeHtml(item.value)}`)
                .join(" · ");
              const media = (variant.currentMedia || [])
                .map((item) => {
                  const mediaId = item.id || item.mediaId;
                  const candidateIndex = mediaIndexById.get(mediaId);
                  return `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer"><img class="variant-thumb" loading="lazy" src="${escapeHtml(item.url)}" alt="${escapeHtml(variant.title)}" /><small>Current: gallery #${candidateIndex || "?"}</small><code>${escapeHtml(mediaId)}</code></a>`;
                })
                .join("");
              return `<div class="variant"><div class="variant-title"><code>${escapeHtml(variant.variantId)}</code><span>${escapeHtml(variant.title)}</span></div><div class="selections">${selections || "No selected-option values returned"}</div><div class="variant-media">${media || '<span class="missing">No current media association</span>'}</div></div>`;
            })
            .join("");
          const groupingNote =
            group.variants.length > 1
              ? "Same appearance option values and same current media evidence; visually inspect the full gallery and all listed variants before making any grouped decision. This grouping does not choose or approve an image."
              : "Variant-specific review; no other variant is assumed to share this mapping.";
          return `<div class="review-group" style="border:1px solid #455a75;background:#141a23;border-radius:9px;padding:9px;margin:10px 0"><div class="review-group-heading" style="display:flex;justify-content:space-between;gap:8px;color:#dbe7ff;font-size:12px"><strong>Review group ${groupIndex + 1}: ${groupLabel}</strong><span>${group.variants.length} variant${group.variants.length === 1 ? "" : "s"}</span></div><p class="current-label">${groupingNote}</p>${members}</div>`;
        })
        .join("");
      return `<article class="option-card"><div class="meta"><span>#${offset + index + 1}</span><span>${escapeHtml(entry.handle)}</span><span>${escapeHtml(entry.productId)}</span></div><h2>${escapeHtml(title)}</h2><p class="identity">All ${entry.variants?.length || 0} active variants are included in ${reviewGroups.length} cautious visual-review group(s). All ${entry.media?.length || 0} product images are numbered below; current Shopify links are evidence only, never proof or an automatic map.</p>${conflictMarkup}<section><h3>Complete product image candidate gallery (${entry.media?.length || 0})</h3><div class="product-media">${productMedia || '<span class="missing">No product media</span>'}</div></section><section><h3>Option evidence (not approved for display)</h3>${optionRows || '<p class="missing">No option evidence</p>'}</section><section><h3>Visual-review groups (${reviewGroups.length}); per-variant approvals still required</h3>${variants}</section></article>`;
    })
    .join("\n");
  const previous =
    offset > 0 ? `/options?offset=${Math.max(0, offset - limit)}&limit=${limit}` : "#";
  const next =
    end < (queue.variantEntries?.length || 0) ? `/options?offset=${end}&limit=${limit}` : "#";
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Future Light option and variant evidence ${offset + 1}-${end}</title>
<style>
  :root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#101217;color:#f2f4f8}
  body{margin:0;padding:24px} header{position:sticky;top:0;background:#101217ee;backdrop-filter:blur(12px);padding:10px 0 18px;z-index:2}
  h1{font-size:22px;margin:0 0 6px}.note{color:#aeb7c7;font-size:13px}.nav{display:flex;gap:12px;flex-wrap:wrap;margin-top:12px}.nav a{color:#a7c7ff;border:1px solid #38547f;padding:8px 12px;border-radius:8px;text-decoration:none}.nav a.disabled{opacity:.4;pointer-events:none}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(520px,1fr));gap:18px;margin-top:20px}.option-card{background:#1a1e27;border:1px solid #303846;border-radius:12px;padding:14px;overflow:hidden}.meta{display:flex;gap:8px;color:#92a1b6;font:11px ui-monospace,monospace}.meta span:nth-child(2){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.meta span:last-child{white-space:nowrap}.option-card h2{font-size:16px;line-height:1.35;margin:10px 0 5px}.identity{color:#d9b66d;font-size:12px;line-height:1.4}.conflict{border:1px solid #c14d4d;background:#3a1d22;color:#ffd8d8;border-radius:8px;padding:9px;font-size:12px;line-height:1.4}.conflict strong{display:block;color:#ff9999;margin-bottom:4px}.conflict ul{margin:5px 0;padding-left:18px}.product-media{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;padding:8px 0}.candidate{display:grid;grid-template-rows:100px auto auto;gap:4px;align-content:start;min-width:0;color:#a7c7ff;text-decoration:none}.thumb{width:100%;height:100px;object-fit:contain;background:#fff;border-radius:7px}.candidate span,.candidate small,.variant-media small,.variant-media code{font:9px ui-monospace,monospace;line-height:1.35;overflow-wrap:anywhere}.candidate small{color:#aeb7c7}.option-card section{border-top:1px solid #303846;margin-top:12px;padding-top:10px}.option-card h3{font-size:13px;margin:0 0 8px;color:#c8d1df}.option-row{display:flex;gap:10px;align-items:flex-start;margin:8px 0}.option-row strong{min-width:110px;color:#e8edf5;font-size:12px}.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{border:1px solid #53698c;border-radius:999px;padding:5px 8px;color:#dbe7ff;font-size:12px}.chip.raw{border-color:#c9793b;background:#3a2417}.chip small{display:block;color:#f0b27d;font-size:9px;margin-top:2px}.variant{border:1px solid #303846;border-radius:8px;padding:8px;margin:8px 0}.variant-title{display:flex;gap:8px;align-items:flex-start;font-size:11px}.variant-title code{color:#8492a8;white-space:nowrap}.variant-title span{color:#f2f4f8;line-height:1.35}.selections{color:#aeb7c7;font-size:11px;margin:6px 0}.current-label{color:#d9b66d;font-size:11px;margin:6px 0}.variant-media{display:flex;gap:6px;overflow:auto;align-items:flex-start}.variant-media a{display:grid;gap:3px;width:110px;flex:0 0 auto;color:#a7c7ff;text-decoration:none}.variant-thumb{width:110px;height:84px;object-fit:contain;background:#fff;border-radius:5px}.missing{color:#f0b27d;font-size:12px;padding:8px}
</style></head><body>
<header><h1>Future Light option + variant evidence · ${offset + 1}-${end} / ${queue.variantEntries?.length || 0}</h1>
<div class="note">Read-only source review · all active products and variants. Each current Shopify assignment must be visually compared with the complete numbered product gallery; never infer from filenames, alt text, or supplier codes.</div>
<nav class="nav"><a href="/batch?offset=0&limit=${maxBatchSize}">← Image evidence</a><a class="${offset === 0 ? "disabled" : ""}" href="${previous}">← Previous products</a><a class="${end >= (queue.variantEntries?.length || 0) ? "disabled" : ""}" href="${next}">Next products →</a></nav></header>
<main class="grid">${cards}</main></body></html>`;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${host}:${port}`);
    const queue = await readQueue();
    if (url.pathname === "/health") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(
        JSON.stringify({
          ok: true,
          targetStoreDomain: queue.targetStoreDomain,
          imageCandidates: queue.imageEntries?.length || 0,
          variantProducts: queue.variantEntries?.length || 0,
          variantDecisions: queue.requirements?.variantMediaDecisions || 0,
          queueFingerprint: queue.queueFingerprint,
        }),
      );
      return;
    }
    if (url.pathname !== "/" && url.pathname !== "/batch" && url.pathname !== "/options") {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const isOptions = url.pathname === "/options";
    const requestedLimit = Number(
      url.searchParams.get("limit") || (isOptions ? maxOptionBatchSize : maxBatchSize),
    );
    const selectedMax = isOptions ? maxOptionBatchSize : maxBatchSize;
    const limit = Math.max(
      1,
      Math.min(selectedMax, Number.isFinite(requestedLimit) ? requestedLimit : selectedMax),
    );
    const requestedOffset = Number(url.searchParams.get("offset") || 0);
    const sourceLength = isOptions
      ? queue.variantEntries?.length || 0
      : queue.imageEntries?.length || 0;
    const offset = Math.max(
      0,
      Math.min(sourceLength, Number.isFinite(requestedOffset) ? requestedOffset : 0),
    );
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(isOptions ? optionPage(queue, offset, limit) : page(queue, offset, limit));
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end(error.stack || error.message || String(error));
  }
});

server.listen(port, host, () =>
  process.stdout.write(
    `Future Light visual evidence viewer: http://${host}:${port}/batch?offset=0&limit=${maxBatchSize}\n`,
  ),
);
process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
