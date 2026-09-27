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
import { createHash } from "node:crypto";

function moduleDependencies(source) {
  return [
    ...new Set(
      [...source.matchAll(/["']\.\/([^"'?#]+\.js)(?:\?[^"']*)?["']/g)].map((match) => match[1]),
    ),
  ];
}

function cacheBustedModuleName(name, source) {
  const digest = createHash("sha256").update(source).digest("hex").slice(0, 12);
  return name.startsWith("salt-entry-")
    ? `salt-entry-${digest}.js`
    : `${name.slice(0, -3)}-${digest}.js`;
}

export function prepareArtworkHotfix({
  layoutSource,
  entryName,
  entrySource,
  oldArtworkSource,
  artworkName,
  artworkSource,
  availableAssets,
  dependentModuleSources = [],
  legacyArtworkModules = [],
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
  const artworkModules = [
    { name: oldArtworkName, source: oldArtworkSource },
    ...legacyArtworkModules.filter(({ name }) => name !== oldArtworkName),
  ];
  if (
    artworkModules.some(
      ({ name, source }) =>
        !/^collection-artwork-[A-Za-z0-9_-]+\.js$/.test(name) ||
        !source ||
        JSON.stringify(themeAssetNames(source)) !== JSON.stringify(themeAssetNames(artworkSource)),
    )
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

  const legacyArtworkNames = new Set(artworkModules.map(({ name }) => name));
  const moduleSources = new Map(
    dependentModuleSources.map(({ path, source }) => [path.replace(/^assets\//, ""), source]),
  );
  const rewrittenModules = new Map();
  const rewriteModule = (name, source, ancestry = new Set()) => {
    if (rewrittenModules.has(name)) return rewrittenModules.get(name);
    if (ancestry.has(name)) return { name, source };

    const nextAncestry = new Set(ancestry).add(name);
    let nextSource = source;
    for (const dependencyName of moduleDependencies(source)) {
      if (legacyArtworkNames.has(dependencyName)) {
        nextSource = nextSource.replaceAll(dependencyName, artworkName);
        continue;
      }
      const dependencySource = moduleSources.get(dependencyName);
      if (!dependencySource) continue;
      const rewrittenDependency = rewriteModule(dependencyName, dependencySource, nextAncestry);
      if (rewrittenDependency.name !== dependencyName) {
        nextSource = nextSource.replaceAll(dependencyName, rewrittenDependency.name);
      }
    }

    for (const legacyName of legacyArtworkNames) {
      nextSource = nextSource.replaceAll(legacyName, artworkName);
    }

    const result =
      nextSource === source
        ? { name, source }
        : { name: cacheBustedModuleName(name, nextSource), source: nextSource };
    rewrittenModules.set(name, result);
    return result;
  };

  const rewrittenEntry = rewriteModule(entryName, entrySource);
  const patchedEntrySource = rewrittenEntry.source;
  const patchedDependentModules = [...rewrittenModules.entries()]
    .filter(([name, result]) => name !== entryName && result.name !== name)
    .map(([name, result]) => ({
      path: `assets/${result.name}`,
      source: result.source,
      replaces: name,
    }));
  const patchedLayoutSource = layoutSource.replaceAll(entryName, "__ENTRY_NAME__");
  const nextEntryName = rewrittenEntry.name;
  const finalLayoutSource = patchedLayoutSource.replaceAll("__ENTRY_NAME__", nextEntryName);

  return {
    oldArtworkName,
    oldEntryName: entryName,
    newArtworkName: artworkName,
    newEntryName: nextEntryName,
    patchedDependentModules,
    patchedEntrySource,
    patchedLayoutSource: finalLayoutSource,
    referencedAssetCount: referencedAssets.length,
  };
}
