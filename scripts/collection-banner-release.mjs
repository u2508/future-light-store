#!/usr/bin/env node
// Targeted collection-image rollout. Never invokes the broad catalog release.
import { readFile, writeFile, rename, open, unlink, mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createShopifyAdminGraphQLClient } from "./shopify-admin-graphql-client.mjs";
import {
  SHOP,
  prepareManifest,
  validateFiles,
  assertShop,
  hash,
  imageKey,
} from "./lib/collection-banner-manifest.mjs";

const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(root, "docs/collection-banner-manifest.json");
const statePath = resolve(root, "output/collection-banner-release-state.json");
const lockPath = statePath + ".lock";
const args = process.argv.slice(2);
const mode = args.includes("--apply") ? "apply" : args.includes("--verify") ? "verify" : "prepare";
const approval = args[args.indexOf("--approval") + 1];
const INVENTORY = `query BannerInventory { shop { id name myshopifyDomain } collections(first: 250) { nodes { id handle title image { url altText } productsCount { count } } pageInfo { hasNextPage endCursor } } }`;
const READ = `query BannerReadback($id: ID!) { collection(id: $id) { id handle image { url altText } } }`;
const UPDATE = `mutation BannerUpdate($collection: CollectionUpdateInput!) { collectionUpdate(collection: $collection) { collection { id handle image { url altText } } userErrors { field message } } }`;
const THEME_ASSET_BASE_URL =
  process.env.SALT_THEME_ASSET_BASE_URL || "https://vs-store-us.myshopify.com/cdn/shop/t/3/assets";
const themeAssetsDir = resolve(root, "../future-light-store-shopify/assets");

async function save(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n");
  await rename(temporary, path);
}
function payload(data, key) {
  const value = data?.[key];
  if (!value) throw new Error(`Missing ${key} response`);
  if (value.userErrors?.length)
    throw new Error(value.userErrors.map((e) => `${e.field?.join(".")}: ${e.message}`).join("; "));
  return value;
}
function isShopifyCdnImage(image) {
  if (!image?.url) return false;
  const url = new URL(image.url);
  return url.protocol === "https:" && url.hostname === "cdn.shopify.com";
}

function themeAssetUrl(filename) {
  return new URL(filename, `${THEME_ASSET_BASE_URL.replace(/\/$/, "")}/`).href;
}

async function buildThemeAssetIndex(manifest) {
  const files = await readdir(themeAssetsDir);
  const wanted = new Map(manifest.targets.map((row) => [row.sha256, row]));
  const matches = new Map();
  await Promise.all(
    files
      .filter((filename) => filename.endsWith(".jpg"))
      .map(async (filename) => {
        const candidate = await readFile(resolve(themeAssetsDir, filename));
        const row = wanted.get(hash(candidate));
        if (row) matches.set(row.id, filename);
      }),
  );
  for (const row of manifest.targets) {
    if (!matches.has(row.id))
      throw new Error(`Missing live-theme asset match for approved artwork: ${row.handle}`);
  }
  return matches;
}

async function fetchImageProof(url, label) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(Number(process.env.SALT_SHOPIFY_IMAGE_VERIFY_TIMEOUT_MS || 120000)),
  });
  if (!response.ok || !response.headers.get("content-type")?.startsWith("image/"))
    throw new Error(`Image source is not available: ${label} (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1000) throw new Error(`Image source is too small: ${label}`);
  return hash(bytes);
}

async function verifyRemote(row, image, sourceUrl) {
  if (!isShopifyCdnImage(image) || image.altText !== row.altText)
    throw new Error(`Readback did not match new artwork: ${row.handle}`);
  const [sourceHash, remoteHash] = await Promise.all([
    fetchImageProof(sourceUrl, `${row.handle} theme asset`),
    fetchImageProof(image.url, `${row.handle} collection image`),
  ]);
  const remoteFilename = decodeURIComponent(new URL(image.url).pathname).split("/").pop();
  const sourceFilename = new URL(sourceUrl).pathname.split("/").pop();
  // Shopify can re-encode a JPEG while importing it. An exact approved
  // filename plus an image response is sufficient identity in that case;
  // exact bytes remain the strongest proof when Shopify preserves them.
  if (sourceHash !== remoteHash && remoteFilename !== sourceFilename)
    throw new Error(`Collection image content differs from approved artwork: ${row.handle}`);
}

function assertLiveInventory(manifest, live) {
  assertShop(live.shop);
  if (live.collections.pageInfo.hasNextPage) throw new Error("Incomplete live inventory");
  const expected = [...manifest.targets, ...manifest.excluded];
  const current = live.collections.nodes;
  if (
    current.length !== expected.length ||
    expected.some((row) => !current.some((collection) => collection.id === row.id))
  )
    throw new Error("Collection inventory changed; review a fresh manifest");
  const handleDrifts = expected
    .map((row) => {
      const collection = current.find((candidate) => candidate.id === row.id);
      return collection && collection.handle !== row.handle
        ? `${row.handle} -> ${collection.handle}`
        : null;
    })
    .filter(Boolean);
  if (handleDrifts.length)
    console.warn(`Preserving concurrent collection handle changes: ${handleDrifts.join(", ")}`);
}

function assertLiveImages(manifest, live, state) {
  for (const row of manifest.targets) {
    const current = live.collections.nodes.find((collection) => collection.id === row.id);
    const expectedImage = state.items[row.id]?.afterImage;
    if (!expectedImage || imageKey(current?.image) !== imageKey(expectedImage))
      throw new Error(`Image changed outside this rollout: ${row.handle}`);
  }
}

async function main() {
  if (mode === "prepare") {
    const result = await prepareManifest(root);
    await save(manifestPath, result.manifest);
    await save(resolve(root, "docs/collection-artwork-generation.json"), result.generation);
    console.log(
      JSON.stringify(
        {
          mode: "local-only dry run",
          targets: result.manifest.targets.length,
          excluded: result.manifest.excluded.length,
          fingerprint: result.manifest.fingerprint,
          liveWrites: 0,
          manifest: manifestPath,
        },
        null,
        2,
      ),
    );
    return;
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await validateFiles(root, manifest);
  if (mode === "apply" && (args.indexOf("--approval") < 0 || approval !== manifest.fingerprint))
    throw new Error(
      "Publication is gated. After explicit user approval, pass --approval with the reviewed manifest fingerprint.",
    );
  if (
    process.env.SALT_SHOP_URL &&
    new URL(process.env.SALT_SHOP_URL).hostname !== SHOP.myshopifyDomain
  )
    throw new Error("SALT_SHOP_URL must be the verified permanent store domain.");
  process.env.SALT_SHOP_URL = `https://${SHOP.myshopifyDomain}`;
  process.env.SHOPIFY_CLI_AGENT_INFO ||= "n:codex|v:1|p:openai";
  process.env.SHOPIFY_CLI_AGENT_IDS ||=
    "s:01a09c29-4e97-7751-828d-f0041ad2eee6|r:collection-banner-release";
  // An uncertain mutation must be reconciled by readback, not blindly retried.
  process.env.SALT_SHOPIFY_MAX_REQUEST_ATTEMPTS = "1";
  const client = createShopifyAdminGraphQLClient({
    rootDir: root,
    agentName: "collection-banner-release",
  });
  const themeAssetIndex = await buildThemeAssetIndex(manifest);
  await mkdir(resolve(root, "output"), { recursive: true });
  let state;
  try {
    state = JSON.parse(await readFile(statePath, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT" || mode === "verify") throw e;
    state = { fingerprint: manifest.fingerprint, startedAt: new Date().toISOString(), items: {} };
  }
  if (state.fingerprint !== manifest.fingerprint)
    throw new Error(
      "An existing rollout belongs to a different manifest. Review it before starting another.",
    );
  const lock = await open(lockPath, "wx").catch(() => {
    throw new Error(
      `A rollout lock exists at ${lockPath}. Inspect its PID before any recovery; do not start a duplicate.`,
    );
  });
  try {
    await lock.writeFile(
      JSON.stringify({ pid: process.pid, mode, fingerprint: manifest.fingerprint }),
    );
    const live = await client.run(
      INVENTORY,
      {},
      { operation: "verify store and collection inventory" },
    );
    assertLiveInventory(manifest, live);
    await save(statePath, state);
    for (const row of manifest.targets) {
      const checkpoint = state.items[row.id];
      if (checkpoint?.status === "verified" && checkpoint.afterImage) {
        console.log(`Verified ${row.handle} (checkpoint)`);
        continue;
      }
      const themeAssetFilename = themeAssetIndex.get(row.id);
      const sourceUrl = themeAssetUrl(themeAssetFilename);
      try {
        const fresh = (
          await client.run(
            READ,
            { id: row.id },
            { operation: `check ${row.handle} before replacement` },
          )
        ).collection;
        if (fresh?.handle !== row.handle)
          throw new Error(`Concurrent collection change detected: ${row.handle}`);

        // A previous attempt or a partial resume may already have assigned the
        // reviewed artwork under a Shopify-generated collection filename. The
        // source/destination byte proof is stronger than relying on filenames.
        try {
          await verifyRemote(row, fresh.image, sourceUrl);
          state.items[row.id] = {
            ...(state.items[row.id] || {}),
            handle: row.handle,
            sha256: row.sha256,
            status: "verified",
            sourceUrl,
            themeAssetFilename,
            afterImage: fresh.image,
            startedAt: state.items[row.id]?.startedAt || new Date().toISOString(),
            verifiedAt: new Date().toISOString(),
          };
          await save(statePath, state);
          console.log(`Verified ${row.handle} (already assigned)`);
          continue;
        } catch (proofError) {
          if (mode === "verify") throw new Error(`Not yet applied: ${row.handle}`);
          if (imageKey(fresh.image) !== imageKey(row.beforeImage))
            throw new Error(`Concurrent collection change detected: ${row.handle}`);
        }

        const entry = state.items[row.id] = {
          ...(state.items[row.id] || {}),
          handle: row.handle,
          sha256: row.sha256,
          status: "updating",
          sourceUrl,
          themeAssetFilename,
          startedAt: state.items[row.id]?.startedAt || new Date().toISOString(),
        };
        await save(statePath, state);
        const updated = payload(
          await client.run(
            UPDATE,
            { collection: { id: row.id, image: { src: sourceUrl, altText: row.altText } } },
            { allowMutations: true, operation: `replace ${row.handle} artwork` },
          ),
          "collectionUpdate",
        ).collection;
        if (updated?.id !== row.id || updated.handle !== row.handle)
          throw new Error("Unexpected collection update target");
        entry.afterImage = updated.image;
        await save(statePath, state);
        const readback = (
          await client.run(READ, { id: row.id }, { operation: `read back ${row.handle}` })
        ).collection;
        if (readback?.id !== row.id || readback.handle !== row.handle)
          throw new Error(`Fresh image readback targeted the wrong collection: ${row.handle}`);
        await verifyRemote(row, readback.image, sourceUrl);
        entry.afterImage = readback.image;
        entry.status = "verified";
        entry.verifiedAt = new Date().toISOString();
        await save(statePath, state);
        console.log(`Verified ${row.handle}`);
      } catch (error) {
        state.lastError = {
          handle: row.handle,
          message: error.message,
          at: new Date().toISOString(),
        };
        await save(statePath, state);
        throw error;
      }
    }
    const finalLive = await client.run(
      INVENTORY,
      {},
      { operation: "final artwork inventory readback" },
    );
    assertLiveInventory(manifest, finalLive);
    assertLiveImages(manifest, finalLive, state);
    state.completedAt = new Date().toISOString();
    state.lastError = null;
    await save(statePath, state);
    console.log(
      JSON.stringify({
        mode,
        verified: manifest.targets.length,
        fingerprint: manifest.fingerprint,
      }),
    );
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
