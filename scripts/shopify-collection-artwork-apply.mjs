#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";

import { createShopifyAdminGraphQLClient } from "./shopify-admin-graphql-client.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const outputPath = resolve(rootDir, "output", "catalog-collection-artwork-manifest.json");
const localCollectionsPath = resolve(rootDir, "public", "data", "collections.json");
const generatedImageDir = "/Users/mac/.codex/generated_images/019fb7b6-af37-7b72-9b55-e51bcd5f87d9";
const execFileAsync = promisify(execFile);
const dryRun = process.argv.includes("--dry-run");
const syncLocalOnly = process.argv.includes("--sync-local");
const client = createShopifyAdminGraphQLClient({ rootDir, agentName: "collection-artwork" });

const ARTWORKS = Object.freeze([
  ["coffee-tea-accessories", "exec-f814810a-cec2-4c26-b5f4-4695a4d82567.png"],
  ["dining-essentials", "exec-6c2fa483-f4eb-4f3d-ae87-b30120a4372e.png"],
  ["seasonal-decor", "exec-b246193f-3e84-421e-9292-7a3e8005ccaf.png"],
  ["decorative-accessories", "exec-0c68f11e-4ba5-4c20-8fcf-1375df74a377.png"],
  ["dog-supplies", "exec-c1b91440-8229-4bc9-912c-4a9034826427.png"],
  ["cat-supplies", "exec-69ae9703-777b-42ef-b84a-9bb33f3382e8.png"],
  ["pet-travel", "exec-18efd562-5a43-47e1-b947-2b03d9ef87dd.png"],
  ["pet-feeding", "exec-bf0c3517-158a-4278-9a87-8f516c221ef8.png"],
  ["pet-grooming", "exec-28d3ee1f-f8ae-4b83-a039-d60488c4722e.png"],
  ["relaxation-products", "exec-5035ea37-82c8-488b-85f3-cce4c5776346.png"],
  ["home-safety", "exec-d07a1a58-37a7-42a4-87ef-cfd7903f0180.png"],
  ["memory-organization", "exec-bb388d6f-f5ea-4f8e-9386-9528e7736507.png"],
  ["staff-picks", "exec-c1840fc7-3192-43ce-bd43-413fd922ae98.png"],
  ["women", "exec-c7bd9da6-c925-4e73-bc97-74c960a687dd.png"],
  ["womens-fashion", "exec-0b83dea4-67bf-4444-b917-57a579ba32e7.png"],
  ["mens-bags-wallets", "exec-1b4c9cf6-007e-43bd-9052-33b2ad79c3c6.png"],
  ["mens-accessories", "exec-f4ec3eef-9729-4bc4-aa6a-b0fd4f3ec961.png"],
  ["mens-beauty-skincare", "exec-d053e3ed-e608-4276-ad15-e6f918030440.png"],
  ["kids", "exec-1e5989fa-a530-4161-9567-1992e2c52521.png"],
  ["kids-wear", "exec-ad24cb55-04a2-406c-871f-15d8738e03f0.png"],
  ["kids-toys-games", "exec-205b9be0-7a49-4a96-99f4-ab5a899045b5.png"],
  ["bedsheets-handlooms-towels", "exec-3f8bb8d8-89f5-476a-847c-4a67d132b342.png"],
  ["covers-cases", "exec-abeae8a1-5be7-4d3b-9f15-bee1b8e7f69a.png"],
  ["mouse-keyboard", "exec-7f1a0019-f1dd-4353-8c8f-5472f77fad32.png"],
  ["audio", "exec-a1d6797f-a8ec-40a6-81a9-74ddb0c6fcf5.png"],
  ["office-school-supplies", "exec-bcb740ea-362f-45e1-8d44-e2fa2551f871.png"],
  ["fitness-equipment", "exec-d6d2d2ce-1d4b-4ebb-8aa3-c417797df472.png"],
]);

const COLLECTIONS_QUERY = /* GraphQL */ `
  query CollectionArtworkInventory($first: Int!, $after: String) {
    collections(first: $first, after: $after) {
      nodes {
        id
        handle
        title
        image { url altText }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const STAGED_UPLOAD_MUTATION = /* GraphQL */ `
  mutation CollectionArtworkStagedUpload($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url resourceUrl parameters { name value } }
      userErrors { field message }
    }
  }
`;

const COLLECTION_UPDATE_MUTATION = /* GraphQL */ `
  mutation CollectionArtworkUpdate($collection: CollectionUpdateInput!) {
    collectionUpdate(collection: $collection) {
      collection { id handle image { url altText } }
      userErrors { field message }
    }
  }
`;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatErrors(errors) {
  return asArray(errors)
    .map((error) => `${asArray(error?.field).join(".") || "collection"}: ${error?.message || "Unknown Shopify error"}`)
    .join(" | ");
}

async function fetchCollections() {
  const result = [];
  let after = null;
  while (true) {
    const data = await client.run(COLLECTIONS_QUERY, { first: 250, after }, { operation: "read collection artwork targets" });
    result.push(...asArray(data?.collections?.nodes));
    if (!data?.collections?.pageInfo?.hasNextPage) return result;
    after = data.collections.pageInfo.endCursor;
  }
}

async function stageImage(filePath, handle) {
  const file = await readFile(filePath);
  const data = await client.run(STAGED_UPLOAD_MUTATION, {
    input: [{
      resource: "IMAGE",
      filename: basename(filePath),
      mimeType: "image/png",
      httpMethod: "POST",
      fileSize: String(file.byteLength),
    }],
  }, { allowMutations: true, operation: `stage collection artwork ${handle}` });
  const errors = asArray(data?.stagedUploadsCreate?.userErrors);
  if (errors.length) throw new Error(`${handle}: ${formatErrors(errors)}`);
  const target = data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target?.url || !target?.resourceUrl) throw new Error(`${handle}: Shopify did not return a staged image target.`);

  const curlArgs = ["-sS", "-X", "POST", target.url];
  for (const parameter of asArray(target.parameters)) curlArgs.push("-F", `${parameter.name}=${parameter.value}`);
  curlArgs.push("-F", `file=@${filePath};type=image/png`);
  await execFileAsync("curl", curlArgs, { cwd: rootDir, maxBuffer: 10 * 1024 * 1024 });
  return target.resourceUrl;
}

async function updateCollectionImage(collection, sourceUrl) {
  const altText = `${collection.title} collection banner`;
  const data = await client.run(COLLECTION_UPDATE_MUTATION, {
    collection: {
      id: collection.id,
      image: { src: sourceUrl, altText },
    },
  }, { allowMutations: true, operation: `set collection artwork ${collection.handle}` });
  const errors = asArray(data?.collectionUpdate?.userErrors);
  if (errors.length) throw new Error(`${collection.handle}: ${formatErrors(errors)}`);
  return data?.collectionUpdate?.collection;
}

async function writeManifest(manifest) {
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function syncLocalCollectionImages(collections) {
  const payload = JSON.parse(await readFile(localCollectionsPath, "utf8"));
  const localByHandle = new Map(asArray(payload?.collections).map((collection) => [collection.handle, collection]));
  let updated = 0;
  for (const collection of collections) {
    const local = localByHandle.get(collection.handle);
    const imageUrl = collection.image?.url;
    if (!local || !imageUrl) continue;
    local.image = {
      ...(local.image || {}),
      src: imageUrl,
      alt: collection.image?.altText || local.image?.alt || null,
    };
    updated += 1;
  }
  payload.generatedAt = new Date().toISOString();
  await writeFile(localCollectionsPath, JSON.stringify(payload), "utf8");
  process.stdout.write(`Synchronized ${updated} collection image records into public/data/collections.json\n`);
}

async function main() {
  const collections = await fetchCollections();
  if (syncLocalOnly) {
    await syncLocalCollectionImages(collections);
    return;
  }
  const byHandle = new Map(collections.map((collection) => [collection.handle, collection]));
  const rows = [];
  for (const [handle, filename] of ARTWORKS) {
    const collection = byHandle.get(handle);
    if (!collection) throw new Error(`Artwork target collection not found: ${handle}`);
    const filePath = resolve(generatedImageDir, filename);
    const file = await readFile(filePath);
    rows.push({
      handle,
      title: collection.title,
      collectionId: collection.id,
      filePath,
      fileBytes: file.byteLength,
      existingImage: Boolean(collection.image?.url),
      shopifyImageUrl: collection.image?.url || null,
      altText: collection.image?.altText || null,
      status: collection.image?.url ? "skipped-existing-image" : dryRun ? "ready" : "pending",
    });
  }

  const manifest = {
    releaseVersion: "2026-08-04.39-collection-artwork.1",
    mode: dryRun ? "dry-run" : "apply",
    generatedAt: new Date().toISOString(),
    policy: {
      source: "OpenAI generated text-free collection banners",
      existingImages: "preserve and skip",
      scope: "27 approved missing-image collections only; merge-source collections excluded",
      altText: "collection title plus collection banner",
    },
    collections: rows,
    summary: {
      requested: rows.length,
      missingAtRead: rows.filter((row) => !row.existingImage).length,
      skippedExisting: rows.filter((row) => row.existingImage).length,
      uploaded: 0,
      failed: 0,
    },
  };
  if (!dryRun) await writeManifest(manifest);
  process.stdout.write(`${dryRun ? "Dry run" : "Applying"} artwork to ${rows.length} approved collections\n`);
  process.stdout.write(`${JSON.stringify(manifest.summary, null, 2)}\n`);
  if (dryRun) return;

  for (const row of rows) {
    if (row.existingImage) continue;
    try {
      const sourceUrl = await stageImage(row.filePath, row.handle);
      const updated = await updateCollectionImage(byHandle.get(row.handle), sourceUrl);
      if (!updated?.image?.url) throw new Error("Shopify returned no collection image URL after update.");
      row.sourceUrl = sourceUrl;
      row.shopifyImageUrl = updated.image.url;
      row.altText = updated.image.altText;
      row.status = "applied";
      manifest.summary.uploaded += 1;
      await writeManifest(manifest);
      process.stdout.write(`Applied artwork ${row.handle}: ${updated.image.url}\n`);
    } catch (error) {
      row.status = "failed";
      row.error = error instanceof Error ? error.message : String(error);
      manifest.summary.failed += 1;
      await writeManifest(manifest);
      throw error;
    }
  }

  manifest.completedAt = new Date().toISOString();
  await writeManifest(manifest);
  process.stdout.write("Collection artwork upload completed\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
