import test from "node:test";
import assert from "node:assert/strict";
import { prepareArtworkHotfix } from "./shopify-theme-artwork-hotfix.mjs";

const oldArtwork = "export{full as a,srcset as i,thumb as n,art as r,hidden as t};";
const newArtwork =
  "const base=globalThis.SALT_THEME_ASSET_BASE;const image=`/assets/travel-outdoor-Ca5XGuIT.jpg`;export{full as a,srcset as i,thumb as n,art as r,hidden as t};";
const input = () => ({
  layoutSource:
    "<script src=\"{{ 'salt-entry-old123.js' | asset_url }}\"></script><link href=\"{{ 'salt-entry-old123.js' | asset_url }}\">",
  entryName: "salt-entry-old123.js",
  entrySource:
    'import {r as artwork} from "./collection-artwork-old123.js";import("./routes-live.js");',
  oldArtworkSource: oldArtwork,
  artworkName: "collection-artwork-new123.js",
  artworkSource: newArtwork,
  availableAssets: new Set(["travel-outdoor-Ca5XGuIT.jpg"]),
});

test("makes a cache-busted entry pointing to the Shopify-aware artwork module", () => {
  const result = prepareArtworkHotfix(input());
  assert.notEqual(result.newEntryName, result.oldEntryName);
  assert.match(result.patchedEntrySource, /collection-artwork-new123\.js/g);
  assert.doesNotMatch(result.patchedLayoutSource, /salt-entry-old123\.js/);
  assert.match(result.patchedLayoutSource, new RegExp(result.newEntryName.replaceAll(".", "\\.")));
  assert.equal(result.referencedAssetCount, 1);
});

test("updates dependent route chunks so they use the same artwork module", () => {
  const result = prepareArtworkHotfix({
    ...input(),
    dependentModuleSources: [
      {
        path: "assets/routes-live.js",
        source: 'import {r as artwork} from "./collection-artwork-route123.js";',
      },
      {
        path: "assets/unrelated.js",
        source: 'import "./other-module.js";',
      },
    ],
    legacyArtworkModules: [
      {
        name: "collection-artwork-route123.js",
        source: oldArtwork,
      },
    ],
  });

  const routeModule = result.patchedDependentModules.find(
    ({ replaces }) => replaces === "routes-live.js",
  );
  assert.match(result.patchedEntrySource, /routes-live-[a-f0-9]{12}\.js/);
  assert.equal(
    routeModule?.path.match(/routes-live-[a-f0-9]{12}\.js/)?.[0],
    routeModule?.path.split("/").at(-1),
  );
  assert.match(routeModule?.source || "", /collection-artwork-new123\.js/);
});

test("fails closed if the new artwork module changes its public exports", () => {
  assert.throws(
    () =>
      prepareArtworkHotfix({
        ...input(),
        artworkSource: newArtwork.replace("thumb as n", "thumb as changed"),
      }),
    /does not preserve the currently deployed export contract/,
  );
});

test("fails closed if any referenced theme image is missing", () => {
  assert.throws(
    () => prepareArtworkHotfix({ ...input(), availableAssets: new Set() }),
    /Theme is missing referenced collection artwork/,
  );
});

test("fails closed if the theme layout has mixed entry versions", () => {
  assert.throws(
    () =>
      prepareArtworkHotfix({ ...input(), layoutSource: "<script>salt-entry-other.js</script>" }),
    /does not consistently point to the current entry asset/,
  );
});
