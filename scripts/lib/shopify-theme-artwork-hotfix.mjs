function themeAssetNames(source) {
  const match = source.match(/export\s*\{([^}]+)\}\s*;?\s*$/);
  if (!match) throw new Error("Artwork module has no stable named-export contract");
  return match[1]
    .split(",")
    .map((entry) =>
      entry
        .trim()
        .split(/\s+as\s+/)
        .at(-1),
    )
    .filter(Boolean)
    .sort();
}

export function prepareArtworkHotfix({
  layoutSource,
  entryName,
  entrySource,
  oldArtworkSource,
  artworkName,
  artworkSource,
  availableAssets,
}) {
  if (!/^salt-entry-[A-Za-z0-9_-]+\.js$/.test(entryName)) {
    throw new Error("Expected the current Shopify salt-entry asset name");
  }
  if (!/^collection-artwork-[A-Za-z0-9_-]+\.js$/.test(artworkName)) {
    throw new Error("Expected a built Vite collection-artwork asset name");
  }
  if (!artworkSource.includes("globalThis.SALT_THEME_ASSET_BASE")) {
    throw new Error("New artwork module does not resolve URLs through the Shopify theme base");
  }

  const references = [
    ...new Set(entrySource.match(/collection-artwork-[A-Za-z0-9_-]+\.js/g) || []),
  ];
  if (references.length !== 1 || references[0] === artworkName) {
    throw new Error("Expected exactly one older artwork-module reference in the live entry");
  }
  const oldArtworkName = references[0];
  if (
    !oldArtworkSource ||
    JSON.stringify(themeAssetNames(oldArtworkSource)) !==
      JSON.stringify(themeAssetNames(artworkSource))
  ) {
    throw new Error("New artwork module does not preserve the currently deployed export contract");
  }

  const layoutRefs = [...layoutSource.matchAll(/salt-entry-[A-Za-z0-9_-]+\.js/g)].map((m) => m[0]);
  if (layoutRefs.length < 1 || layoutRefs.some((name) => name !== entryName)) {
    throw new Error("Theme layout does not consistently point to the current entry asset");
  }

  const referencedAssets = [
    ...new Set([...artworkSource.matchAll(/`\/assets\/([^`]+\.jpg)`/g)].map((m) => m[1])),
  ];
  const missingAssets = referencedAssets.filter((name) => !availableAssets.has(name));
  if (!referencedAssets.length || missingAssets.length) {
    throw new Error(
      `Theme is missing referenced collection artwork: ${missingAssets.slice(0, 8).join(", ") || "no image URLs found"}`,
    );
  }

  const patchedEntrySource = entrySource.replaceAll(oldArtworkName, artworkName);
  const patchedLayoutSource = layoutSource.replaceAll(entryName, "__ENTRY_NAME__");
  const entryDigest = createHash("sha256").update(patchedEntrySource).digest("hex").slice(0, 12);
  const nextEntryName = `salt-entry-${entryDigest}.js`;
  const finalLayoutSource = patchedLayoutSource.replaceAll("__ENTRY_NAME__", nextEntryName);

  return {
    oldArtworkName,
    oldEntryName: entryName,
    newArtworkName: artworkName,
    newEntryName: nextEntryName,
    patchedEntrySource,
    patchedLayoutSource: finalLayoutSource,
    referencedAssetCount: referencedAssets.length,
  };
}
import { createHash } from "node:crypto";
