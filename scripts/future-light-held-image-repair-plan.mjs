#!/usr/bin/env node

/*
 * Build a deterministic, draft-only repair plan for images explicitly held by
 * ChatGPT's visual review. This file never uploads, deletes, or approves
 * media. It separates presentation-only repairs from uncertain product
 * identity/specification cases so the release gate cannot silently keep a bad
 * asset or invent a replacement.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dirname, "..");
const reviewDir = resolve(rootDir, "output", "future-light-visual-review");
const queuePath = resolve(reviewDir, "queue.json");
const decisionsPath = resolve(reviewDir, "chatgpt-image-decisions.json");
const progressPath = resolve(reviewDir, "chatgpt-review-progress.json");
const outputPath = resolve(reviewDir, "held-image-repair-plan.json");
const targetStoreDomain = "vs-future-store-0jl2t-jxu6tnr3.myshopify.com";

function normalize(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function imageKey(handle, imageUrl) {
  return `${normalize(handle)}|${normalize(imageUrl)}`;
}

function numericId(value) {
  return normalize(value).match(/(\d+)$/)?.[1] || "";
}

function productGid(value) {
  const id = numericId(value);
  return id ? `gid://shopify/Product/${id}` : "";
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function slug(value) {
  return normalize(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96) || "product";
}

function classifyReason(hold) {
  const text = `${normalize(hold.holdReason)} ${normalize(hold.visualNote)}`.toLowerCase();
  if (/wrong[ -]product|wrong[ -]variant|unrelated (?:short-sleeve )?dress|does not show (?:the )?(?:listed )?product\b|shows only (?:a|an) [^.;]+ (?:logo|extension cable)\b|only (?:a|an) [^.;]+ logo\b|partial top edge|incomplete|cropped|unusable|feedback request|review solicitation|does not visibly show/.test(text)) {
    return { reasonCode: text.includes("cropped") || text.includes("incomplete") || text.includes("unusable") ? "broken-or-unusable-image" : "wrong-product-or-variant", identityStatus: "source-review-required" };
  }
  if (/usb 2\.0.*(?:conflict|listing)|(?:conflict|conflicts).*usb 3|exact variant identity uncertain|identity uncertain|pending confirmation|not confirmed/.test(text)) {
    return { reasonCode: "wrong-product-or-variant", identityStatus: "source-review-required" };
  }
  if (/crop|composition|partial/.test(text)) {
    return { reasonCode: "materially misleading crop/composition", identityStatus: "identity-preserved-candidate" };
  }
  if (/supplier|watermark|branding|chinese|non-english|promotional|marketplace|storefront|off-brand|logistics|shipping|warehouse|buy now|discount|choice/.test(text)) {
    return { reasonCode: /supplier|watermark|branding/.test(text) ? "supplier-or-China branding/watermark" : "clearly off-brand presentation", identityStatus: "identity-preserved-candidate" };
  }
  return { reasonCode: "clearly off-brand presentation", identityStatus: "source-review-required" };
}

// A visual hold is not safe to regenerate when the immutable handle and the
// title attached to the held asset describe different product families. This
// catches stale/mixed catalog metadata before an otherwise plausible image is
// allowed into the native Image Gen queue.
function hasIdentityMetadataConflict(handle, title) {
  const h = normalize(handle).toLowerCase().replace(/[-_]+/g, " ");
  const t = normalize(title).toLowerCase().replace(/[-_]+/g, " ");
  const handleFamilies = [
    ["apparel", /\b(?:shirt|t shirt|dress|blouse|hoodie|jacket|pants|jeans|skirt|clothing)\b/],
    ["camera-support", /\b(?:tripod|light stand|softbox|gimbal|stabilizer)\b/],
    ["audio", /\b(?:audio|aux|cable|earbuds?|earphones?|headphones?|speaker|microphone)\b/],
    ["jewelry", /\b(?:jewelry|necklace|earrings?|bracelet|ring|brooch)\b/],
    ["beauty", /\b(?:makeup|cosmetic|serum|cream|lipstick|foundation|brush)\b/],
    ["controller", /\b(?:controller|gamepad|gaming)\b/],
  ];
  const titleFamilies = handleFamilies.filter(([, pattern]) => pattern.test(t)).map(([name]) => name);
  const handleFamilyNames = handleFamilies.filter(([, pattern]) => pattern.test(h)).map(([name]) => name);
  if (!handleFamilyNames.length || !titleFamilies.length) {
    return handleFamilyNames.includes("camera-support") && /\b(?:shirt|dress|clothing|apparel|fashion)\b/.test(t);
  }
  return handleFamilyNames.some((family) => !titleFamilies.includes(family));
}

function repairPrompt(hold) {
  const issue = normalize(hold.holdReason || hold.visualNote);
  return [
    "Use case: precise-object-edit",
    "Asset type: VS Store product gallery image",
    "Primary request: create an identity-preserving cleanup of the supplied source image",
    `Subject: the exact product shown in the source image for ${normalize(hold.title)}`,
    `Change only: remove the documented presentation issue (${issue})`,
    "Must keep: the exact product, physical form, material, color, pattern, dimensions, variant identity, manufacturer logo, printed emblem, labels on the product body, buttons, ports, seams, connector geometry, and every hardware detail shown in the source",
    "Hard identity rule: remove only external supplier overlays, packaging, promotional panels, shipping claims, or watermarks; never erase, redraw, translate, simplify, or replace a marking physically printed on the product itself",
    "If any product detail or variant identity cannot be preserved with confidence, do not generate a replacement; leave the image in source-review-required status",
    "Style: clean premium VS Store product photography; neutral light background; natural proportions",
    "Avoid: changing the product, inventing a variant, replacing the design, generic substitute, supplier logo, supplier packaging, marketplace claims, China-origin claims, promotional text, watermark, extra objects, or readable text",
  ].join("\n");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readOptionalJson(path) {
  try { return await readJson(path); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

async function main() {
  const [queue, decisions, progress] = await Promise.all([readJson(queuePath), readJson(decisionsPath), readOptionalJson(progressPath)]);
  if (queue.targetStoreDomain !== targetStoreDomain || decisions.targetStoreDomain !== targetStoreDomain) {
    throw new Error("Refused to build a held-image plan for a non-Future Light Store target.");
  }
  if (queue.queueFingerprint !== decisions.queueFingerprint) {
    throw new Error("Held-image decisions do not match the current visual queue fingerprint.");
  }

  const queuedImages = new Map((queue.imageEntries || []).map((entry) => [imageKey(entry.handle, entry.imageUrl), entry]));
  const keepCounts = new Map();
  for (const entry of decisions.entries || []) {
    if (entry.action !== "keep" && entry.action !== "recreate") continue;
    keepCounts.set(entry.handle, (keepCounts.get(entry.handle) || 0) + 1);
  }
  const heldCounts = new Map();
  for (const entry of decisions.holds || []) heldCounts.set(entry.handle, (heldCounts.get(entry.handle) || 0) + 1);
  const manuallyRejected = new Set();
  for (const entry of progress?.entries || []) {
    for (const media of entry.reviewedMedia || []) {
      if (media.decision === "rejected-generated-asset" && media.heldSourceImageUrl) {
        manuallyRejected.add(imageKey(entry.handle, media.heldSourceImageUrl));
      }
    }
  }

  const failures = [];
  const replacements = [];
  const sourceReview = [];

  // A manually reviewed recreate decision is persisted by the recorder as a
  // keep decision plus identity-preserving metadata. Rehydrate those records
  // into the repair plan so a generated asset is never orphaned when the
  // source hold is removed from decisions.holds.
  const explicitRecreateKeys = new Set();
  for (const decision of decisions.entries || []) {
    if (decision.productIdentityPreserved !== true || !normalize(decision.generatedAssetPath)) continue;
    const key = imageKey(decision.handle, decision.imageUrl);
    const queued = queuedImages.get(key);
    if (!queued) {
      failures.push(`${decision.handle}: explicit recreate source is not in the current queue`);
      continue;
    }
    if (numericId(decision.productId) !== numericId(queued.productId)) {
      failures.push(`${decision.handle}: explicit recreate product ID differs from current queue`);
      continue;
    }
    const assetPath = normalize(decision.generatedAssetPath);
    if (!assetPath.startsWith("output/imagegen/future-light/")) {
      failures.push(`${decision.handle}: explicit recreate asset is outside output/imagegen/future-light`);
      continue;
    }
    const sourceProductId = productGid(decision.productId);
    replacements.push({
      productId: decision.productId,
      sourceProductId,
      handle: decision.handle,
      title: decision.title,
      heldSourceImageUrl: decision.imageUrl,
      reasonCode: normalize(decision.reasonCode) || "clearly off-brand presentation",
      reviewNote: normalize(decision.reviewNote || decision.visualNote),
      keepableMediaAlreadyAvailable: (keepCounts.get(decision.handle) || 0) > 1,
      productImageCount: keepCounts.get(decision.handle) || 0,
      generatedAssetPath: assetPath,
      prompt: repairPrompt({
        title: decision.title,
        holdReason: decision.reasonCode,
        visualNote: decision.reviewNote || decision.visualNote,
      }),
      sourceReviewedBy: decision.reviewedBy || "ChatGPT",
      sourceReviewMethod: decision.reviewMethod || "internal-browser-contact-sheet",
      sourceReviewedAt: decision.reviewedAt || null,
      action: "recreate_candidate",
      productIdentityPreserved: true,
      identityReviewNote: normalize(decision.identityReviewNote),
      applyPolicy: "create-and-readback-before-source-delete",
      decisionOrigin: "explicit-chatgpt-recreate-review",
    });
    explicitRecreateKeys.add(key);
  }

  for (const hold of decisions.holds || []) {
    const key = imageKey(hold.handle, hold.imageUrl);
    if (explicitRecreateKeys.has(key)) continue;
    const queued = queuedImages.get(key);
    if (!queued) {
      failures.push(`${hold.handle}: held image is not in the current queue`);
      continue;
    }
    if (numericId(hold.productId) !== numericId(queued.productId)) {
      failures.push(`${hold.handle}: held image product ID differs from current queue`);
      continue;
    }
    const classification = manuallyRejected.has(key)
      ? { reasonCode: "wrong-product-or-variant", identityStatus: "source-review-required" }
      : hasIdentityMetadataConflict(hold.handle, hold.title)
        ? { reasonCode: "wrong-product-or-variant", identityStatus: "source-review-required" }
        : classifyReason(hold);
    const sourceProductId = productGid(hold.productId);
    const assetName = `held-${slug(hold.handle)}-${digest(hold.imageUrl)}.png`;
    const base = {
      productId: hold.productId,
      sourceProductId,
      handle: hold.handle,
      title: hold.title,
      heldSourceImageUrl: hold.imageUrl,
      reasonCode: classification.reasonCode,
      reviewNote: normalize(hold.holdReason || hold.visualNote),
      keepableMediaAlreadyAvailable: (keepCounts.get(hold.handle) || 0) > 0,
      productImageCount: (keepCounts.get(hold.handle) || 0) + (heldCounts.get(hold.handle) || 0),
      generatedAssetPath: `output/imagegen/future-light/${assetName}`,
      prompt: repairPrompt(hold),
      sourceReviewedBy: hold.reviewedBy || "ChatGPT",
      sourceReviewMethod: hold.reviewMethod || "internal-browser-contact-sheet",
      sourceReviewedAt: hold.reviewedAt || null,
    };
    if (classification.identityStatus === "identity-preserved-candidate") {
      replacements.push({
        ...base,
        action: "recreate_candidate",
        productIdentityPreserved: true,
        identityReviewNote: `The source review identifies the exact listed product in this asset. The candidate may change only the documented presentation issue; product form, design, color, material, and variant identity must remain unchanged. ${normalize(hold.visualNote)}`,
        applyPolicy: "create-and-readback-before-source-delete",
      });
    } else {
      sourceReview.push({
        ...base,
        action: "source_review_required",
        productIdentityPreserved: false,
        identityReviewNote: `Do not generate or upload a replacement until the exact product/variant identity is confirmed. ${normalize(hold.visualNote)}`,
        applyPolicy: "no-live-mutation",
      });
    }
  }
  if (failures.length) throw new Error(`Held-image repair plan failed: ${failures.join(" | ")}`);

  const payload = {
    schemaVersion: "2026-09-17.future-light-held-image-repair-plan.1",
    targetStoreDomain,
    queueFingerprint: queue.queueFingerprint,
    status: "draft_only_waiting_for_identity_safe_assets",
    liveMutation: false,
    generatedAssetsAvailable: false,
    policy: {
      source: "ChatGPT visual holds only",
      preserveGoodImages: true,
      noAutomaticProductSubstitution: true,
      noAutomaticVariantGuessing: true,
      noSourceDeleteBeforeReplacementReadback: true,
      noSALTAccess: true,
      requiredGeneratedAssetRoot: "output/imagegen/future-light",
    },
    summary: {
      // Include source images that were explicitly promoted to recreate in
      // the held-image accounting. They are no longer in decisions.holds, but
      // remain part of this repair run until their replacement is reviewed
      // and applied with live readback.
      heldImages: replacements.length + sourceReview.length,
      identityPreservedCandidates: replacements.length,
      sourceReviewRequired: sourceReview.length,
      productsWithCleanAlternative: [...new Set(replacements.filter((item) => item.keepableMediaAlreadyAvailable).map((item) => item.handle))].length,
      productsWithNoCleanAlternative: [...new Set(replacements.filter((item) => !item.keepableMediaAlreadyAvailable).map((item) => item.handle))].length,
    },
    replacementCandidates: replacements,
    sourceReviewRequired: sourceReview,
    createdAt: new Date().toISOString(),
  };
  await mkdir(reviewDir, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`Future Light held-image repair plan ready: ${payload.summary.identityPreservedCandidates} identity-safe candidate(s), ${payload.summary.sourceReviewRequired} source-review hold(s), 0 live mutations.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
