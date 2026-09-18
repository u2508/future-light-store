#!/usr/bin/env node

/* Local-only, read-only visual evidence viewer. It serves the persisted queue
 * as small contact sheets so ChatGPT can inspect source images with their
 * exact product handles before any approval file or Shopify mutation exists. */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dirname, "..");
const queuePath = resolve(rootDir, "output", "future-light-visual-review", "queue.json");
const productSeoPath = resolve(rootDir, "public", "data", "product-seo.json");
const host = "127.0.0.1";
const port = Number(process.env.FUTURE_LIGHT_REVIEW_PORT || 4312);
const maxBatchSize = 24;
const maxOptionBatchSize = 12;

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
  const cards = entries.map((entry, index) => `
    <article class="card">
      <div class="meta"><span>#${offset + index + 1}</span><span>${escapeHtml(entry.handle)}</span></div>
      <h2>${escapeHtml(displayTitle(queue, entry))}</h2>
      <img loading="eager" src="${escapeHtml(entry.imageUrl)}" alt="${escapeHtml(displayTitle(queue, entry))}" />
      <a href="${escapeHtml(entry.imageUrl)}" target="_blank" rel="noreferrer">Open source image</a>
      <code>${escapeHtml(entry.imageUrl)}</code>
    </article>`).join("\n");
  const previous = offset > 0 ? `/batch?offset=${Math.max(0, offset - limit)}&limit=${limit}` : "#";
  const next = end < (queue.imageEntries?.length || 0) ? `/batch?offset=${end}&limit=${limit}` : "#";
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
  const cards = products.map((entry, index) => {
    const title = displayTitle(queue, entry);
    const productMedia = (entry.media || []).slice(0, 8).map((media) => `
      <a href="${escapeHtml(media.url)}" target="_blank" rel="noreferrer"><img class="thumb" loading="lazy" src="${escapeHtml(media.url)}" alt="${escapeHtml(title)}" /></a>`).join("");
    const regularOptions = (queue.optionEntries || []).find((item) => item.handle === entry.handle)?.options || [];
    const variantOnlyOptions = (queue.variantOptionEntries || []).find((item) => item.handle === entry.handle)?.options || [];
    const options = [...regularOptions, ...variantOnlyOptions];
    const optionRows = options.map((option) => `
      <div class="option-row"><strong>${escapeHtml(option.optionName)}</strong><div class="chips">${(option.values || []).map((value) => {
        const raw = Boolean(option.source === "variant-selected-option") || /china|mainland|tk[-_]?\d{4,}/i.test(String(value.currentName || ""));
        return `<span class="chip ${raw ? "raw" : ""}">${escapeHtml(value.currentName)} <small>${raw ? "raw/unverified" : "review required"}</small></span>`;
      }).join("")}</div></div>`).join("");
    const mediaByOptionValue = new Map();
    for (const variant of entry.variants || []) {
      const mediaIds = (variant.currentMedia || []).map((item) => item.mediaId).filter(Boolean);
      for (const selected of variant.selectedOptions || []) {
        const key = `${selected.name}\u0000${selected.value}`;
        if (!mediaByOptionValue.has(key)) mediaByOptionValue.set(key, new Set());
        for (const mediaId of mediaIds) mediaByOptionValue.get(key).add(mediaId);
      }
    }
    const mappingConflicts = [];
    for (const option of options) {
      for (const value of option.values || []) {
        const mediaIds = mediaByOptionValue.get(`${option.optionName}\u0000${value.currentName}`);
        if (mediaIds && mediaIds.size > 1) mappingConflicts.push(`${option.optionName}: ${value.currentName} currently points to ${mediaIds.size} different media assets`);
      }
    }
    const conflictMarkup = mappingConflicts.length
      ? `<div class="conflict"><strong>Mapping conflict detected</strong><ul>${mappingConflicts.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>Current associations are evidence only and must not be trusted as the final variant mapping.</div>`
      : "";
    const variants = (entry.variants || []).map((variant) => {
      const selections = (variant.selectedOptions || []).map((item) => `${escapeHtml(item.name)}: ${escapeHtml(item.value)}`).join(" · ");
      const media = (variant.currentMedia || []).map((item) => `
        <a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer"><img class="variant-thumb" loading="lazy" src="${escapeHtml(item.url)}" alt="${escapeHtml(variant.title)}" /></a>`).join("");
      return `<div class="variant"><div class="variant-title"><code>${escapeHtml(variant.variantId)}</code><span>${escapeHtml(variant.title)}</span></div><div class="selections">${selections}</div><div class="variant-media">${media || "<span class=\"missing\">No current media</span>"}</div></div>`;
    }).join("");
    return `<article class="option-card"><div class="meta"><span>#${offset + index + 1}</span><span>${escapeHtml(entry.handle)}</span></div><h2>${escapeHtml(title)}</h2><p class="identity">Product identity is read-only evidence. Do not rename an option or remap media without exact visual confirmation.</p>${conflictMarkup}<div class="product-media">${productMedia || "<span class=\"missing\">No product media</span>"}</div><section><h3>Current option values</h3>${optionRows || "<p class=\"missing\">No option evidence</p>"}</section><section><h3>Current variant → media evidence (${(entry.variants || []).length})</h3>${variants}</section></article>`;
  }).join("\n");
  const previous = offset > 0 ? `/options?offset=${Math.max(0, offset - limit)}&limit=${limit}` : "#";
  const next = end < (queue.variantEntries?.length || 0) ? `/options?offset=${end}&limit=${limit}` : "#";
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Future Light option and variant evidence ${offset + 1}-${end}</title>
<style>
  :root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#101217;color:#f2f4f8}
  body{margin:0;padding:24px} header{position:sticky;top:0;background:#101217ee;backdrop-filter:blur(12px);padding:10px 0 18px;z-index:2}
  h1{font-size:22px;margin:0 0 6px}.note{color:#aeb7c7;font-size:13px}.nav{display:flex;gap:12px;flex-wrap:wrap;margin-top:12px}.nav a{color:#a7c7ff;border:1px solid #38547f;padding:8px 12px;border-radius:8px;text-decoration:none}.nav a.disabled{opacity:.4;pointer-events:none}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(520px,1fr));gap:18px;margin-top:20px}.option-card{background:#1a1e27;border:1px solid #303846;border-radius:12px;padding:14px;overflow:hidden}.meta{display:flex;gap:8px;color:#92a1b6;font:11px ui-monospace,monospace}.meta span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.option-card h2{font-size:16px;line-height:1.35;margin:10px 0 5px}.identity{color:#d9b66d;font-size:12px;line-height:1.4}.conflict{border:1px solid #c14d4d;background:#3a1d22;color:#ffd8d8;border-radius:8px;padding:9px;font-size:12px;line-height:1.4}.conflict strong{display:block;color:#ff9999;margin-bottom:4px}.conflict ul{margin:5px 0;padding-left:18px}.product-media{display:flex;gap:8px;overflow:auto;padding:8px 0}.thumb{width:92px;height:92px;object-fit:contain;background:#fff;border-radius:7px}.option-card section{border-top:1px solid #303846;margin-top:12px;padding-top:10px}.option-card h3{font-size:13px;margin:0 0 8px;color:#c8d1df}.option-row{display:flex;gap:10px;align-items:flex-start;margin:8px 0}.option-row strong{min-width:110px;color:#e8edf5;font-size:12px}.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{border:1px solid #53698c;border-radius:999px;padding:5px 8px;color:#dbe7ff;font-size:12px}.chip.raw{border-color:#c9793b;background:#3a2417}.chip small{display:block;color:#f0b27d;font-size:9px;margin-top:2px}.variant{border:1px solid #303846;border-radius:8px;padding:8px;margin:8px 0}.variant-title{display:flex;gap:8px;align-items:flex-start;font-size:11px}.variant-title code{color:#8492a8;white-space:nowrap}.variant-title span{color:#f2f4f8;line-height:1.35}.selections{color:#aeb7c7;font-size:11px;margin:6px 0}.variant-media{display:flex;gap:6px;overflow:auto}.variant-thumb{width:74px;height:74px;object-fit:contain;background:#fff;border-radius:5px}.missing{color:#f0b27d;font-size:12px;padding:8px}
</style></head><body>
<header><h1>Future Light option + variant evidence · ${offset + 1}-${end} / ${queue.variantEntries?.length || 0}</h1>
<div class="note">Read-only source review. Raw supplier/origin codes are highlighted; they are not customer-facing labels. Review exact product identity before creating any mapping.</div>
<nav class="nav"><a href="/batch?offset=0&limit=${maxBatchSize}">← Image evidence</a><a class="${offset === 0 ? "disabled" : ""}" href="${previous}">← Previous products</a><a class="${end >= (queue.variantEntries?.length || 0) ? "disabled" : ""}" href="${next}">Next products →</a></nav></header>
<main class="grid">${cards}</main></body></html>`;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${host}:${port}`);
    const queue = await readQueue();
    if (url.pathname === "/health") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, targetStoreDomain: queue.targetStoreDomain, imageCandidates: queue.imageEntries?.length || 0 }));
      return;
    }
    if (url.pathname !== "/" && url.pathname !== "/batch" && url.pathname !== "/options") {
      response.writeHead(404); response.end("Not found"); return;
    }
    const isOptions = url.pathname === "/options";
    const requestedLimit = Number(url.searchParams.get("limit") || (isOptions ? maxOptionBatchSize : maxBatchSize));
    const selectedMax = isOptions ? maxOptionBatchSize : maxBatchSize;
    const limit = Math.max(1, Math.min(selectedMax, Number.isFinite(requestedLimit) ? requestedLimit : selectedMax));
    const requestedOffset = Number(url.searchParams.get("offset") || 0);
    const sourceLength = isOptions ? queue.variantEntries?.length || 0 : queue.imageEntries?.length || 0;
    const offset = Math.max(0, Math.min(sourceLength, Number.isFinite(requestedOffset) ? requestedOffset : 0));
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(isOptions ? optionPage(queue, offset, limit) : page(queue, offset, limit));
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end(error.stack || error.message || String(error));
  }
});

server.listen(port, host, () => process.stdout.write(`Future Light visual evidence viewer: http://${host}:${port}/batch?offset=0&limit=${maxBatchSize}\n`));
process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
