#!/usr/bin/env node
// Targeted collection-image rollout. Never invokes the broad catalog release.
import { readFile, writeFile, rename, open, unlink, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createShopifyAdminGraphQLClient } from "./shopify-admin-graphql-client.mjs";
import {
  SHOP,
  prepareManifest,
  validateFiles,
  assertLiveTargets,
  assetPath,
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
const STAGE = `mutation BannerStage($input: [StagedUploadInput!]!) { stagedUploadsCreate(input: $input) { stagedTargets { url resourceUrl parameters { name value } } userErrors { field message } } }`;
const UPDATE = `mutation BannerUpdate($input: CollectionInput!) { collectionUpdate(input: $input) { collection { id handle image { url altText } } userErrors { field message } } }`;

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
function ownsImage(row, image) {
  if (!image?.url) return false;
  const url = new URL(image.url);
  return (
    url.protocol === "https:" &&
    url.hostname === "cdn.shopify.com" &&
    decodeURIComponent(url.pathname).includes(row.sha256.slice(0, 12))
  );
}
async function verifyRemote(row, image) {
  if (!ownsImage(row, image) || image.altText !== row.altText)
    throw new Error(`Readback did not match new artwork: ${row.handle}`);
  const res = await fetch(image.url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok || !res.headers.get("content-type")?.startsWith("image/"))
    throw new Error(`Image is not available: ${row.handle} (${res.status})`);
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength < 1000) throw new Error(`Image response is too small: ${row.handle}`);
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
    // Recover a mutation whose response was lost only when the unique source
    // hash filename and alt text prove it is this exact reviewed artwork.
    for (const row of manifest.targets) {
      const entry = state.items[row.id];
      const current = live.collections.nodes.find((c) => c.id === row.id);
      if (
        entry?.status === "updating" &&
        entry.sourceUrl &&
        ownsImage(row, current?.image) &&
        current.image.altText === row.altText
      )
        entry.afterImage = current.image;
    }
    assertLiveTargets(manifest, live, state);
    await save(statePath, state);
    for (const row of manifest.targets) {
      let entry = state.items[row.id];
      if (entry?.afterImage) {
        await verifyRemote(row, entry.afterImage);
        entry.status = "verified";
        entry.verifiedAt = new Date().toISOString();
        await save(statePath, state);
        continue;
      }
      if (mode === "verify") throw new Error(`Not yet applied: ${row.handle}`);
      try {
        const fresh = (
          await client.run(
            READ,
            { id: row.id },
            { operation: `check ${row.handle} before replacement` },
          )
        ).collection;
        if (fresh?.handle !== row.handle || imageKey(fresh.image) !== imageKey(row.beforeImage))
          throw new Error(`Concurrent collection change detected: ${row.handle}`);
        const file = await readFile(assetPath(root, row.file));
        const filename = `vs-banner-${row.handle}-${row.sha256.slice(0, 12)}.jpg`;
        const staged = payload(
          await client.run(
            STAGE,
            {
              input: [
                {
                  resource: "COLLECTION_IMAGE",
                  filename,
                  mimeType: "image/jpeg",
                  httpMethod: "POST",
                  fileSize: String(file.length),
                },
              ],
            },
            { allowMutations: true, operation: `stage ${row.handle}` },
          ),
          "stagedUploadsCreate",
        ).stagedTargets?.[0];
        if (!staged?.url || !staged.resourceUrl) throw new Error("Missing staged image target");
        const form = new FormData();
        for (const parameter of staged.parameters) form.append(parameter.name, parameter.value);
        form.append("file", new Blob([file], { type: "image/jpeg" }), filename);
        const upload = await fetch(staged.url, {
          method: "POST",
          body: form,
          signal: AbortSignal.timeout(60000),
        });
        if (!upload.ok) throw new Error(`Staged upload HTTP ${upload.status}`);
        entry = state.items[row.id] = {
          handle: row.handle,
          sha256: row.sha256,
          status: "updating",
          sourceUrl: staged.resourceUrl,
          startedAt: new Date().toISOString(),
        };
        await save(statePath, state);
        const updated = payload(
          await client.run(
            UPDATE,
            { input: { id: row.id, image: { src: staged.resourceUrl, altText: row.altText } } },
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
        if (imageKey(readback?.image) !== imageKey(entry.afterImage))
          throw new Error(`Fresh image readback differs: ${row.handle}`);
        await verifyRemote(row, readback.image);
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
    assertLiveTargets(manifest, finalLive, state);
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
