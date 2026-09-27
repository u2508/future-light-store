#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareArtworkHotfix } from "./lib/shopify-theme-artwork-hotfix.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const themeDir = resolve(projectRoot, "../future-light-store-shopify");
const distAssetsDir = resolve(projectRoot, "dist/assets");
const writeMode = process.argv.includes("--write");

function readThemeHead(path) {
  return execFileSync("git", ["-C", themeDir, "show", `HEAD:${path}`], { encoding: "utf8" });
}

async function main() {
  const layoutSource = readThemeHead("layout/theme.liquid");
  const entryName = layoutSource.match(/salt-entry-[A-Za-z0-9_-]+\.js/)?.[0];
  if (!entryName) throw new Error("No deployed Shopify entry asset found in the theme layout");

  const entrySource = readThemeHead(`assets/${entryName}`);
  const oldArtworkName = [
    ...new Set(entrySource.match(/collection-artwork-[A-Za-z0-9_-]+\.js/g) || []),
  ][0];
  if (!oldArtworkName) throw new Error("No collection-artwork module found in the deployed entry");

  const oldArtworkSource = readThemeHead(`assets/${oldArtworkName}`);
  const artworkName = (await readdir(distAssetsDir)).find((name) =>
    /^collection-artwork-[A-Za-z0-9_-]+\.js$/.test(name),
  );
  if (!artworkName || artworkName === oldArtworkName) {
    throw new Error(
      "A new production collection-artwork module is required before preparing this hotfix",
    );
  }
  const artworkSource = await readFile(resolve(distAssetsDir, artworkName), "utf8");
  const availableAssets = new Set(await readdir(resolve(themeDir, "assets")));
  for (const name of await readdir(distAssetsDir)) {
    if (name.endsWith(".jpg")) availableAssets.add(name);
  }

  const patch = prepareArtworkHotfix({
    layoutSource,
    entryName,
    entrySource,
    oldArtworkSource,
    artworkName,
    artworkSource,
    availableAssets,
  });

  const output = {
    themeDir,
    liveEntry: patch.oldEntryName,
    nextEntry: patch.newEntryName,
    liveArtwork: patch.oldArtworkName,
    nextArtwork: patch.newArtworkName,
    artworkImagesVerified: patch.referencedAssetCount,
    uploadPaths: [
      `assets/${patch.newArtworkName}`,
      `assets/${patch.newEntryName}`,
      "layout/theme.liquid",
    ],
    mode: writeMode ? "write" : "dry-run",
  };

  if (!writeMode) {
    process.stdout.write(
      `${JSON.stringify(output, null, 2)}\nRe-run with --write to create only these targeted hotfix files.\n`,
    );
    return;
  }

  await writeFile(resolve(themeDir, "assets", patch.newArtworkName), artworkSource);
  await writeFile(resolve(themeDir, "assets", patch.newEntryName), patch.patchedEntrySource);
  await writeFile(resolve(themeDir, "layout", "theme.liquid"), patch.patchedLayoutSource);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
