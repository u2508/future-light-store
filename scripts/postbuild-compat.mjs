#!/usr/bin/env node

import { copyFile, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const rootDir = process.cwd();
const distDir = resolve(rootDir, "dist");
const indexHtmlPath = resolve(distDir, "index.html");
const assetsDir = resolve(distDir, "assets");

const COMPAT_JS_ALIASES = ["index-rtp67GOb.js"];
const COMPAT_CSS_ALIASES = ["index-B3Zc37iF.css"];

function parseEntryAssets(indexHtml) {
  const jsMatch = indexHtml.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/i);
  const cssMatch = indexHtml.match(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/i);

  if (!jsMatch?.[1]) {
    throw new Error("Could not resolve built JavaScript entry asset from dist/index.html");
  }

  return {
    js: basename(jsMatch[1]),
    css: cssMatch?.[1] ? basename(cssMatch[1]) : null,
  };
}

async function writeAliases(entryFilename, aliases) {
  await Promise.all(
    aliases
      .filter((alias) => alias !== entryFilename)
      .map((alias) =>
        copyFile(resolve(assetsDir, entryFilename), resolve(assetsDir, alias)),
      ),
  );
}

async function main() {
  const indexHtml = await readFile(indexHtmlPath, "utf8");
  const { js, css } = parseEntryAssets(indexHtml);

  await writeAliases(js, COMPAT_JS_ALIASES);
  if (css) {
    await writeAliases(css, COMPAT_CSS_ALIASES);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
