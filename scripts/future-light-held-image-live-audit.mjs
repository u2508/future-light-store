#!/usr/bin/env node

/*
 * Read-only Shopify reconciliation for manually approved held-image
 * replacements. It resolves the current source media and variant links; it
 * never creates, deletes, reorders, or remaps Shopify media.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createShopifyAdminGraphQLClient } from "./shopify-admin-graphql-client.mjs";
import { FUTURE_LIGHT_SHOP_DOMAIN } from "./lib/product-image-health.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const auditPath = resolve(rootDir, "output/future-light-visual-review/held-image-mapping-audit.json");
const outputPath = resolve(rootDir, "output/future-light-visual-review/held-image-mapping-live-audit.json");
const applyStatePath = resolve(rootDir, "output/future-light-held-image-apply/state.json");
const envFiles = [resolve(rootDir, ".env.local"), resolve(rootDir, ".env.release.local")];

const PRODUCT_QUERY = /* GraphQL */ `
  query FutureLightHeldImageLiveAudit($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        handle
        title
        vendor
        status
        media(first: 250) {
          nodes {
            __typename
            id
            ... on MediaImage { image { url width height } }
          }
          pageInfo { hasNextPage }
        }
        variants(first: 250) {
          nodes {
            id
            title
            sku
            selectedOptions { name value }
            media(first: 1) {
              nodes {
                __typename
                id
                ... on MediaImage { image { url width height } }
              }
            }
          }
          pageInfo { hasNextPage }
        }
      }
    }
  }
`;

function normalize(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function canonical(value) {
  const raw = normalize(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch { return raw.split("?")[0]; }
}
function sameId(left, right) {
  const a = normalize(left);
  const b = normalize(right);
  if (a === b) return true;
  const an = a.match(/(\d+)$/)?.[1];
  const bn = b.match(/(\d+)$/)?.[1];
  return Boolean(an && bn && an === bn);
}
function parseEnvValue(value) {
  const trimmed = String(value || "").trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed.replace(/\s+#.*$/, "");
}
async function loadFutureEnv() {
  for (const file of envFiles) {
    let raw;
    try { raw = await readFile(file, "utf8"); }
    catch (error) { if (error?.code === "ENOENT") continue; throw error; }
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      if (match[1].startsWith("FUTURE_LIGHT_") || match[1].startsWith("SHOPIFY_")) process.env[match[1]] = parseEnvValue(match[2]);
    }
  }
}
async function readJson(path, fallback = null) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return fallback; throw error; }
}

async function main() {
  await loadFutureEnv();
  const [audit, applyState] = await Promise.all([
    readJson(auditPath),
    readJson(applyStatePath, { entries: {} }),
  ]);
  if (audit.targetStoreDomain !== FUTURE_LIGHT_SHOP_DOMAIN) throw new Error("Refused a live audit for a non-Future Light Store target.");
  const productIds = [...new Set((audit.entries || []).map((entry) => normalize(entry.productId)).filter(Boolean))];
  const retryInfo = [];
  const client = createShopifyAdminGraphQLClient({ rootDir, agentName: "future-light-held-image-live-audit" });
  const products = new Map();
  for (let offset = 0; offset < productIds.length; offset += 20) {
    const ids = productIds.slice(offset, offset + 20);
    const data = await client.run(PRODUCT_QUERY, { ids }, { operation: `read held-image products ${offset + 1}-${offset + ids.length}`, retryInfo });
    for (const product of data.nodes || []) if (product?.id) products.set(product.id, product);
  }

  const completedByKey = new Map(
    Object.values(applyState?.entries || {})
      .filter((entry) => entry?.status === "completed-verified" && entry?.replacementMediaId)
      .map((entry) => [`${normalize(entry.handle)}|${canonical(entry.heldSourceImageUrl)}`, entry]),
  );

  const entries = (audit.entries || []).map((entry) => {
    const product = [...products.values()].find((candidate) => sameId(candidate.id, entry.productId));
    const issues = [...(entry.issues || [])];
    if (!product) issues.push("product was not returned by live Shopify readback");
    if (product && normalize(product.vendor) !== "VS Store") issues.push("live product vendor is not VS Store");
    if (product && product.media?.pageInfo?.hasNextPage) issues.push("live media pagination is incomplete");
    if (product && product.variants?.pageInfo?.hasNextPage) issues.push("live variant pagination is incomplete");
    const sourceUrl = canonical(entry.sourceImageUrl);
    const sourceMedia = product?.media?.nodes?.find((media) => canonical(media?.image?.url) === sourceUrl);
    const completed = completedByKey.get(`${normalize(entry.handle)}|${sourceUrl}`);
    const replacementMedia = completed && product?.media?.nodes?.find((media) => media?.id === completed.replacementMediaId);
    if (!sourceMedia && !completed) issues.push("approved source image is not present in current live product media");
    if (completed && !replacementMedia) issues.push("checkpoint replacement image is not present in current live product media");
    const linkedVariants = (product?.variants?.nodes || []).filter((variant) =>
      (variant.media?.nodes || []).some((media) => media?.id === sourceMedia?.id),
    ).map((variant) => ({
      variantId: variant.id,
      title: variant.title,
      sku: variant.sku,
      selectedOptions: variant.selectedOptions || [],
      sourceMediaId: sourceMedia.id,
    }));
    return {
      ...entry,
      liveReadback: {
        productId: product?.id || null,
        handle: product?.handle || null,
        title: product?.title || null,
        status: product?.status || null,
        sourceMediaId: sourceMedia?.id || null,
        sourceMediaUrl: sourceMedia?.image?.url || null,
        linkedVariants,
        completedFromCheckpoint: Boolean(completed),
        replacementMediaId: replacementMedia?.id || completed?.replacementMediaId || null,
        replacementMediaUrl: replacementMedia?.image?.url || null,
        replacementLinkedVariantIds: completed
          ? (product?.variants?.nodes || [])
            .filter((variant) => (variant.media?.nodes || []).some((media) => media?.id === completed.replacementMediaId))
            .map((variant) => variant.id)
          : [],
      },
      liveApplyStatus: issues.length
        ? "blocked_pending_live_evidence"
        : completed
          ? "completed_from_checkpoint"
          : "ready_for_guarded_mapping_review",
      issues: [...new Set(issues)],
    };
  });
  const output = {
    schemaVersion: "2026-09-17.future-light-held-image-live-audit.1",
    targetStoreDomain: FUTURE_LIGHT_SHOP_DOMAIN,
    readOnly: true,
    liveMutation: false,
    retryInfo,
    entries,
    summary: {
      approvedReviews: entries.length,
      productsRead: products.size,
      readyForGuardedMappingReview: entries.filter((entry) => entry.liveApplyStatus === "ready_for_guarded_mapping_review").length,
      blockedPendingLiveEvidence: entries.filter((entry) => entry.liveApplyStatus === "blocked_pending_live_evidence").length,
      completedFromCheckpoint: entries.filter((entry) => entry.liveApplyStatus === "completed_from_checkpoint").length,
      sourceMediaFound: entries.filter((entry) => entry.liveReadback.sourceMediaId).length,
      variantsLinkedToApprovedSources: entries.reduce((sum, entry) => sum + entry.liveReadback.linkedVariants.length, 0),
    },
    generatedAt: new Date().toISOString(),
  };
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  process.stdout.write(`Future Light held-image live audit: ${output.summary.productsRead} product(s) read, ${output.summary.sourceMediaFound} source media found, ${output.summary.variantsLinkedToApprovedSources} variant link(s), ${output.summary.blockedPendingLiveEvidence} blocked. Read-only; no Shopify mutation.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
