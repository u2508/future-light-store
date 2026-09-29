#!/usr/bin/env node

/* Records one explicit visual assignment against a persisted full-catalog
 * queue. It writes local approval evidence only and never calls Shopify. */

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";

import { createVariantImageAssignment } from "./lib/future-light-variant-image-approvals.mjs";
import { findVariantImageReviewGroup } from "./lib/future-light-variant-image-review-groups.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const reviewDir = resolve(rootDir, "output", "future-light-visual-review");
const targetStoreDomain = "vs-future-store-0jl2t-jxu6tnr3.myshopify.com";

function flagValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : null;
}

function parseArgs(argv = process.argv.slice(2)) {
  return {
    queue:
      flagValue(argv, "--queue") || "output/future-light-visual-review/queue.full-catalog.json",
    approved:
      flagValue(argv, "--approved") ||
      "output/future-light-visual-review/approved-full-catalog-mappings.json",
    productId: flagValue(argv, "--product-id"),
    variantId: flagValue(argv, "--variant-id"),
    mediaId: flagValue(argv, "--media-id"),
    noImage: argv.includes("--no-image"),
    note: flagValue(argv, "--note") || "",
    sameAppearanceGroup: argv.includes("--same-appearance-group"),
    replace: argv.includes("--replace"),
  };
}

function resolveReviewPath(path, label) {
  const selected = isAbsolute(path) ? resolve(path) : resolve(rootDir, path);
  if (!selected.startsWith(`${reviewDir}/`) || !selected.endsWith(".json")) {
    throw new Error(`${label} must be a .json file inside output/future-light-visual-review/.`);
  }
  return selected;
}

async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function record() {
  const args = parseArgs();
  const queuePath = resolveReviewPath(args.queue, "Queue path");
  const approvedPath = resolveReviewPath(args.approved, "Approval path");
  if (queuePath === approvedPath) throw new Error("Queue and approval files must be distinct.");
  if (!args.productId || !args.variantId)
    throw new Error("Both --product-id and --variant-id are required.");
  if (args.noImage === Boolean(args.mediaId)) {
    throw new Error("Select exactly one of --media-id <Shopify MediaImage GID> or --no-image.");
  }

  const queue = await readJson(queuePath);
  if (!queue || queue.targetStoreDomain !== targetStoreDomain || !queue.queueFingerprint) {
    throw new Error(
      "The full visual review queue is missing, malformed, or targets another store.",
    );
  }
  const product = (queue.variantEntries || []).find((entry) => entry.productId === args.productId);
  if (!product) throw new Error("Product ID is not part of the persisted review queue.");
  const variant = (product.variants || []).find((entry) => entry.variantId === args.variantId);
  if (!variant) throw new Error("Variant ID is not part of the exact queued product.");
  const mediaId = args.noImage ? null : args.mediaId;
  const reviewGroup = args.sameAppearanceGroup
    ? findVariantImageReviewGroup(product, variant.variantId)
    : null;
  if (args.sameAppearanceGroup && (!reviewGroup || reviewGroup.variants.length < 2)) {
    throw new Error(
      "This variant has no multi-variant appearance group; record it individually after visual review.",
    );
  }
  const targetVariants = args.sameAppearanceGroup ? reviewGroup.variants : [variant];
  const newAssignments = targetVariants.map((targetVariant) =>
    createVariantImageAssignment(queue, {
      product: { productId: product.productId, handle: product.handle },
      variant: { variantId: targetVariant.variantId },
      mediaId,
      reviewNote: args.note,
    }),
  );

  const lockPath = `${approvedPath}.lock`;
  await mkdir(lockPath);
  const temporaryPath = `${approvedPath}.${randomUUID()}.tmp`;
  try {
    const prior = await readJson(approvedPath, {
      schemaVersion: "2026-09-27.future-light-variant-image-approval.1",
      targetStoreDomain,
      queueFingerprint: queue.queueFingerprint,
      approval: {
        mode: "chatgpt-manual-visual-review",
        source: "full-catalog-variant-image-review-queue",
      },
      variantMediaAssignments: [],
    });
    if (prior.targetStoreDomain !== targetStoreDomain) {
      throw new Error("Existing approval file targets a different store; it will not be reused.");
    }
    if (prior.queueFingerprint !== queue.queueFingerprint) {
      throw new Error(
        "Existing decisions belong to a different snapshot; refresh and visually review again before recording.",
      );
    }

    const assignments = [...(prior.variantMediaAssignments || [])];
    const targetIds = new Set(newAssignments.map((assignment) => assignment.variantId));
    const existingIds = new Set(
      assignments.filter((entry) => targetIds.has(entry.variantId)).map((entry) => entry.variantId),
    );
    if (existingIds.size && !args.replace) {
      throw new Error(
        "At least one target variant already has a decision; use --replace only after a fresh visual comparison.",
      );
    }
    const retainedAssignments = assignments.filter((entry) => !targetIds.has(entry.variantId));
    retainedAssignments.push(...newAssignments);
    retainedAssignments.sort((left, right) => left.variantId.localeCompare(right.variantId));

    const updated = {
      ...prior,
      updatedAt: new Date().toISOString(),
      variantMediaAssignments: retainedAssignments,
    };
    await writeFile(temporaryPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
    await rename(temporaryPath, approvedPath);
    process.stdout.write(
      `Recorded visually reviewed mapping for ${product.handle} · ${newAssignments.length} variant(s)${args.sameAppearanceGroup ? " in one exact appearance/evidence group" : ""}; ${retainedAssignments.length}/${queue.requirements.variantMediaDecisions} variants reviewed. Local approval only; Shopify was not changed.\n`,
    );
  } finally {
    await rm(temporaryPath, { force: true });
    await rm(lockPath, { recursive: true, force: true });
  }
}

record().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
