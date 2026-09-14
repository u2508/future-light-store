#!/usr/bin/env node
// Local-only harness for the generated theme's actual JS/CSS and CDN paths.
// It does not emulate Shopify Liquid, checkout, or Shopify's remote CDN.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const theme = resolve(root, "output/banner-theme-preview");
const port = Number(process.env.BANNER_PREVIEW_PORT || 4174);
const prefix = "/cdn/shop/t/banner-preview/assets/";
const mime = {
  js: "text/javascript",
  css: "text/css",
  json: "application/json",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  woff2: "font/woff2",
};
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

async function shell(origin) {
  const section = await readFile(resolve(theme, "sections/salt-app.liquid"), "utf8");
  const assets = Object.fromEntries(
    [
      ...section.matchAll(/"([^"\n]+)":\s*\{\{\s*'([^']+)'\s*\|\s*asset_url\s*\|\s*json\s*\}\}/g),
    ].map((m) => [m[1], origin + prefix + m[2]]),
  );
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>VS Store local theme preview</title><link rel="stylesheet" href="${prefix}salt-app.css"></head><body><div id="root" data-shop-base-url="${origin}" data-shop-domain="vs-future-store-0jl2t-jxu6tnr3.myshopify.com" data-shop-name="VS Store" data-currency="USD"></div><script>window.SALT_THEME_ASSET_BASE=${JSON.stringify(origin + prefix)};window.SALT_THEME_ASSETS=${JSON.stringify(assets).replace(/</g, "\\u003c")};</script><script type="module" src="${prefix}salt-app.js"></script></body></html>`;
}

async function gallery(page) {
  const raw = JSON.parse(
    await readFile(resolve(root, "output/banner-live-inventory.json"), "utf8"),
  );
  const rows = (raw.data ?? raw).collections.nodes.filter(
    (c) => !c.handle.startsWith("classification-"),
  );
  const start = Math.max(0, page) * 16;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Collection artwork review</title><style>body{margin:0;padding:24px;background:#090b10;color:white;font:16px system-ui}h1{font-size:22px}main{display:grid;grid-template-columns:repeat(4,1fr);gap:18px}figure{margin:0}img{width:100%;aspect-ratio:3/2;object-fit:cover}figcaption{font-size:13px;padding:6px}a{color:#c9dfff}</style></head><body><h1>Artwork review · ${start + 1}–${Math.min(start + 16, rows.length)} / ${rows.length}</h1><main>${rows
    .slice(start, start + 16)
    .map(
      (c) =>
        `<figure><img src="/__artwork/${encodeURIComponent(c.handle)}.jpg"><figcaption>${escape(c.title)} · ${escape(c.handle)}</figcaption></figure>`,
    )
    .join(
      "",
    )}</main><p>${Array.from({ length: Math.ceil(rows.length / 16) }, (_, i) => `<a href="?page=${i}">Page ${i + 1}</a>`).join(" · ")}</p></body></html>`;
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    res.setHeader("Cache-Control", "no-store");
    if (url.pathname === "/__artwork-review") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.end(await gallery(Number(url.searchParams.get("page")) || 0));
    }
    const assetRoot = url.pathname.startsWith(prefix)
      ? resolve(theme, "assets")
      : url.pathname.startsWith("/__artwork/")
        ? resolve(root, "src/assets/collection-artwork")
        : null;
    if (assetRoot) {
      const name = decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf("/") + 1));
      if (name !== basename(name) || !/^[A-Za-z0-9_.-]+$/.test(name))
        throw new Error("Invalid asset");
      res.setHeader("Content-Type", mime[name.split(".").at(-1)] || "application/octet-stream");
      return res.end(await readFile(resolve(assetRoot, name)));
    }
    // Wrong asset paths must fail visibly, never fall back to HTML with 200.
    if (/\.(js|css|jpg|png|svg|json|woff2?)$/.test(url.pathname)) {
      res.writeHead(404);
      return res.end("Asset not found");
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(await shell(url.origin));
  } catch (error) {
    res.writeHead(error.code === "ENOENT" ? 404 : 500);
    res.end(error.code === "ENOENT" ? "Not found" : "Preview error");
  }
}).listen(port, "127.0.0.1", () =>
  console.log(`Local theme asset preview: http://127.0.0.1:${port}`),
);
