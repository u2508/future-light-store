#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  applyCollectionReorderMoves,
  buildCollectionReorderMoves,
  shuffleCollectionProductIds,
} from "../src/lib/shopify-collection-shuffle.js";
import { createShopifyAdminGraphQLClient } from "./shopify-admin-graphql-client.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const defaultOutputPath = resolve(rootDir, "output", "shopify-collection-shuffle-manifest.json");
const collectionPageSize = Math.max(1, Math.min(250, Number(process.env.SALT_COLLECTION_SHUFFLE_PAGE_SIZE || 100)));
const productPageSize = 250;
const jobPollMs = Math.max(1000, Number(process.env.SALT_COLLECTION_SHUFFLE_JOB_POLL_MS || 2000));
const jobPollAttempts = Math.max(1, Number(process.env.SALT_COLLECTION_SHUFFLE_JOB_POLL_ATTEMPTS || 300));
const client = createShopifyAdminGraphQLClient({ rootDir, agentName: "collection-shuffle" });
const SHUFFLE_EXCLUDED_HANDLES = new Set(["all-products"]);

const COLLECTIONS_QUERY = /* GraphQL */ `
  query CollectionShuffleCollections($first: Int!, $after: String) {
    collections(first: $first, after: $after) {
      nodes { id handle title sortOrder }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const PRODUCTS_QUERY = /* GraphQL */ `
  query CollectionShuffleProducts($id: ID!, $first: Int!, $after: String) {
    collection(id: $id) {
      products(first: $first, after: $after) {
        nodes { id }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

const SORT_UPDATE_MUTATION = /* GraphQL */ `
  mutation CollectionShuffleSort($id: ID!, $sortOrder: CollectionSortOrder!) {
    collectionUpdate(input: { id: $id, sortOrder: $sortOrder }) {
      collection { id sortOrder }
      userErrors { field message }
    }
  }
`;

const REORDER_MUTATION = /* GraphQL */ `
  mutation CollectionShuffleReorder($id: ID!, $moves: [MoveInput!]!) {
    collectionReorderProducts(id: $id, moves: $moves) {
      job { id }
      userErrors { field message }
    }
  }
`;

const JOB_QUERY = /* GraphQL */ `
  query CollectionShuffleJob($id: ID!) {
    job(id: $id) { id done }
  }
`;

function parseArgs(argv) {
  const args = { mode: "dry-run", output: defaultOutputPath, seed: process.env.SALT_COLLECTION_SHUFFLE_SEED || "" };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--apply") args.mode = "apply";
    else if (token === "--verify") args.mode = "verify";
    else if (token === "--dry-run") args.mode = "dry-run";
    else if (token === "--repair-failed") args.repairFailed = true;
    else if (token === "--output" && argv[index + 1]) args.output = resolve(rootDir, argv[++index]);
    else if (token === "--seed" && argv[index + 1]) args.seed = argv[++index];
  }
  if (!args.seed) args.seed = new Date().toISOString().slice(0, 10);
  return args;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildLiveMembershipTarget(currentIds, plannedIds) {
  const currentSet = new Set(currentIds);
  const plannedSet = new Set(plannedIds);
  const plannedMembersStillLive = plannedIds.filter((id) => currentSet.has(id));
  const newlyLiveMembers = currentIds.filter((id) => !plannedSet.has(id));
  return [...plannedMembersStillLive, ...newlyLiveMembers];
}

async function fetchCollections() {
  const collections = [];
  let after = null;
  while (true) {
    const payload = await client.run(COLLECTIONS_QUERY, { first: collectionPageSize, after }, { operation: "read collections for manual shuffle" });
    collections.push(...asArray(payload?.collections?.nodes));
    if (!payload?.collections?.pageInfo?.hasNextPage) break;
    after = payload.collections.pageInfo.endCursor || null;
    if (!after) throw new Error("Shopify returned a next page without a cursor while reading collections");
  }
  return collections;
}

async function fetchCollectionProducts(collectionId) {
  const ids = [];
  let after = null;
  while (true) {
    const payload = await client.run(PRODUCTS_QUERY, { id: collectionId, first: productPageSize, after }, { operation: `read products for collection ${collectionId}` });
    const connection = payload?.collection?.products;
    ids.push(...asArray(connection?.nodes).map((product) => String(product?.id || "")).filter(Boolean));
    if (!connection?.pageInfo?.hasNextPage) break;
    after = connection.pageInfo.endCursor || null;
    if (!after) throw new Error(`Collection ${collectionId} returned a next page without a cursor`);
  }
  return ids;
}

async function buildPlan(seed) {
  const collections = await fetchCollections();
  const plan = [];
  for (const collection of collections) {
    if (SHUFFLE_EXCLUDED_HANDLES.has(collection.handle)) continue;
    const currentIds = await fetchCollectionProducts(collection.id);
    const desiredIds = shuffleCollectionProductIds(currentIds, `${seed}:${collection.handle}`);
    const moves = buildCollectionReorderMoves(currentIds, desiredIds);
    plan.push({
      id: collection.id,
      handle: collection.handle,
      title: collection.title,
      currentSortOrder: collection.sortOrder || "UNKNOWN",
      desiredSortOrder: "MANUAL",
      productCount: currentIds.length,
      currentIds,
      desiredIds,
      moves,
      needsReorder: currentIds.join("|") !== desiredIds.join("|"),
    });
  }
  return plan;
}

async function waitForJob(jobId) {
  if (!jobId) return;
  for (let attempt = 0; attempt < jobPollAttempts; attempt += 1) {
    const payload = await client.run(JOB_QUERY, { id: jobId }, { operation: `wait for collection reorder job ${jobId}` });
    if (payload?.job?.done === true) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, jobPollMs));
  }
  throw new Error(`Collection reorder job ${jobId} did not finish within the verification window`);
}

async function applyCollection(entry) {
  if (entry.currentSortOrder !== "MANUAL") {
    const payload = await client.run(
      SORT_UPDATE_MUTATION,
      { id: entry.id, sortOrder: "MANUAL" },
      { allowMutations: true, operation: `set manual sort for ${entry.handle}` },
    );
    const errors = asArray(payload?.collectionUpdate?.userErrors);
    if (errors.length) throw new Error(`${entry.handle}: ${JSON.stringify(errors)}`);
  }

  // Always start from Shopify's live order. This makes a resumed apply safe if
  // a previous process completed a reorder before its checkpoint was written.
  let currentIds = await fetchCollectionProducts(entry.id);
  const targetIds = buildLiveMembershipTarget(currentIds, entry.desiredIds);
  const plannedSet = new Set(entry.desiredIds);
  const currentSet = new Set(currentIds);
  const membershipDrift = {
    missingFromLive: entry.desiredIds.filter((id) => !currentSet.has(id)),
    newlyLive: currentIds.filter((id) => !plannedSet.has(id)),
  };
  while (currentIds.join("|") !== targetIds.join("|")) {
    const moves = buildCollectionReorderMoves(currentIds, targetIds);
    if (!moves.length) throw new Error(`Unable to build a reorder move for ${entry.handle}`);
    const payload = await client.run(
      REORDER_MUTATION,
      // Shopify models newPosition as UnsignedInt64, which the Admin GraphQL
      // CLI requires to be encoded as a string even for small positions.
      { id: entry.id, moves: moves.map((move) => ({ ...move, newPosition: String(move.newPosition) })) },
      { allowMutations: true, operation: `shuffle collection ${entry.handle}` },
    );
    const errors = asArray(payload?.collectionReorderProducts?.userErrors);
    if (errors.length) throw new Error(`${entry.handle}: ${JSON.stringify(errors)}`);
    await waitForJob(payload?.collectionReorderProducts?.job?.id);
    // Shopify applies moves sequentially. Mirror that deterministic result
    // locally between jobs and do one complete live readback at the end of the
    // collection instead of re-fetching every product page after every batch.
    currentIds = applyCollectionReorderMoves(currentIds, moves);
  }

  const actualIds = await fetchCollectionProducts(entry.id);
  const actualTargetIds = buildLiveMembershipTarget(actualIds, targetIds);
  if (actualIds.join("|") !== actualTargetIds.join("|")) {
    throw new Error(`${entry.handle}: manual order readback mismatch`);
  }
  return membershipDrift;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.mode === "verify") {
    const prior = JSON.parse(await readFile(args.output, "utf8"));
    const plan = await buildPlan(prior.seed);
    const failures = [];
    for (const entry of plan) {
      const expected = prior.collections?.find((candidate) => candidate.handle === entry.handle);
      if (!expected) {
        failures.push({ handle: entry.handle, reason: "collection-not-in-prior-manifest" });
        continue;
      }
      if (entry.currentSortOrder !== "MANUAL") failures.push({ handle: entry.handle, reason: "sort-order-not-manual", actual: entry.currentSortOrder });
      const expectedOrder = buildLiveMembershipTarget(entry.currentIds, expected.desiredIds);
      if (entry.currentIds.join("|") !== expectedOrder.join("|")) failures.push({ handle: entry.handle, reason: "order-readback-mismatch" });
    }
    const report = { ...prior, mode: "verify", verifiedAt: new Date().toISOString(), failures };
    await writeFile(args.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    if (failures.length) throw new Error(`Collection shuffle verification failed for ${failures.length} collection(s)`);
    process.stdout.write(`Collection shuffle verification passed: ${plan.length} collections, zero order mismatches.\n`);
    return;
  }
  let priorManifest = null;
  if (args.mode === "apply") {
    try {
      priorManifest = JSON.parse(await readFile(args.output, "utf8"));
    } catch {
      priorManifest = null;
    }
  }
  const hasReusablePriorPlan = Boolean(
    priorManifest?.seed === args.seed &&
      Array.isArray(priorManifest.collections) &&
      priorManifest.collections.length,
  );
  let canReusePriorPlan = hasReusablePriorPlan;
  let plan;
  if (args.repairFailed) {
    if (args.mode !== "apply" || !hasReusablePriorPlan) {
      throw new Error("--repair-failed requires --apply and a same-seed shuffle manifest.");
    }
    const failedHandles = new Set(
      asArray(priorManifest.failures)
        .filter((failure) => failure?.reason === "order-readback-mismatch")
        .map((failure) => failure.handle),
    );
    if (!failedHandles.size) throw new Error("--repair-failed found no order-readback failures in the shuffle manifest.");
    const repairedPlan = [];
    for (const entry of priorManifest.collections) {
      if (!failedHandles.has(entry.handle)) {
        repairedPlan.push(entry);
        continue;
      }
      process.stdout.write(`Rebuilding live shuffle plan for failed collection ${entry.handle}\n`);
      const currentIds = await fetchCollectionProducts(entry.id);
      const desiredIds = shuffleCollectionProductIds(currentIds, `${args.seed}:${entry.handle}`);
      repairedPlan.push({
        ...entry,
        currentIds,
        desiredIds,
        moves: buildCollectionReorderMoves(currentIds, desiredIds),
        productCount: currentIds.length,
        needsReorder: currentIds.join("|") !== desiredIds.join("|"),
      });
    }
    priorManifest = {
      ...priorManifest,
      collections: repairedPlan,
      failures: [],
      appliedCollections: asArray(priorManifest.appliedCollections).filter((handle) => !failedHandles.has(handle)),
    };
    plan = repairedPlan;
  } else {
    plan = hasReusablePriorPlan ? priorManifest.collections : await buildPlan(args.seed);
  }
  plan = plan.filter((entry) => !SHUFFLE_EXCLUDED_HANDLES.has(entry.handle));
  const manifest = canReusePriorPlan
    ? { ...priorManifest, mode: args.mode, resumedAt: new Date().toISOString() }
    : {
        generatedAt: new Date().toISOString(),
        mode: args.mode,
        seed: args.seed,
        policy: {
          sortOrder: "MANUAL",
          seed: "one deterministic shuffle per collection per seed; the daily release supplies a new date seed",
          mutationLimit: 250,
          readback: "every collection order is read back after asynchronous reorder jobs finish",
          resume: "reuse the same date-seeded plan and begin each collection from live Shopify order",
        },
        summary: {
          collections: plan.length,
          collectionsRequiringManualSort: plan.filter((entry) => entry.currentSortOrder !== "MANUAL").length,
          collectionsRequiringReorder: plan.filter((entry) => entry.needsReorder).length,
          productsCovered: plan.reduce((sum, entry) => sum + entry.productCount, 0),
        },
        collections: plan,
        failures: [],
      };
  await writeFile(args.output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  if (args.mode === "dry-run") {
    process.stdout.write(`Collection shuffle dry-run complete: ${manifest.summary.collections} collections, ${manifest.summary.collectionsRequiringReorder} order changes.\n`);
    return;
  }

  const appliedCollections = new Set(manifest.appliedCollections || []);
  for (const [index, entry] of plan.entries()) {
    if (appliedCollections.has(entry.handle)) continue;
    process.stdout.write(`Shuffle progress: ${appliedCollections.size}/${plan.length} starting ${entry.handle}\n`);
    const membershipDrift = await applyCollection(entry);
    appliedCollections.add(entry.handle);
    manifest.appliedCollections = [...appliedCollections];
    if (membershipDrift.missingFromLive.length || membershipDrift.newlyLive.length) {
      manifest.membershipDrift = [
        ...(manifest.membershipDrift || []),
        { handle: entry.handle, ...membershipDrift },
      ];
    }
    await writeFile(args.output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    process.stdout.write(`Shuffle progress: ${index + 1}/${plan.length} verified ${entry.handle}\n`);
  }
  manifest.completedAt = new Date().toISOString();
  await writeFile(args.output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`Collection shuffle complete: ${manifest.appliedCollections?.length || 0} collections manually sorted and read back.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
