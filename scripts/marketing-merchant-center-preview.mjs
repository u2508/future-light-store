#!/usr/bin/env node

/**
 * Build a local, preview-only reconciliation record for Merchant Center.
 *
 * This reads only the verified Shopify/Google evidence file. It never calls
 * Merchant Center, uploads a feed, saves a policy, or enables spend.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dirname, "..");
const evidencePath = resolve(rootDir, "docs", "marketing-launch-evidence.json");
const outputPath = resolve(rootDir, "output", "marketing-merchant-center-preview.json");

export function buildMerchantCenterPreview(evidence) {
  const shopify = evidence?.sourceFacts?.shopify ?? {};
  const merchantCenter = evidence?.sourceFacts?.googleMerchantCenter ?? {};
  const shippingPolicy = merchantCenter.shippingPolicy ?? {};
  const shippingMismatch = shippingPolicy.status === "mismatch-needs-reconciliation-before-feed-or-spend";
  const returnPolicyReady = merchantCenter.returnPolicyConfigured === true;
  const accountIssue = String(merchantCenter.status || "").includes("misrepresentation");
  const checkoutIssue = merchantCenter.checkoutIssue?.status === "warning";

  return {
    schemaVersion: "2026-09-21.vs-store.merchant-center-preview.1",
    generatedAt: new Date().toISOString(),
    mode: "preview-only",
    status: shippingMismatch || !returnPolicyReady || accountIssue || checkoutIssue ? "blocked" : "ready-for-review",
    sourceOfTruth: "verified Shopify and Merchant Center read-only evidence",
    merchantCenter: {
      accountId: merchantCenter.accountId ?? null,
      accountStatus: merchantCenter.status ?? "unknown",
      returnPolicyConfigured: returnPolicyReady,
      currentShippingWindow: shippingPolicy.merchantCenterVisibleWindow ?? "not recorded",
      catalogSources: merchantCenter.catalogSources ?? null,
      misrepresentation: merchantCenter.misrepresentation ?? null,
      checkoutIssue: merchantCenter.checkoutIssue ?? null,
    },
    shopify: {
      source: shopify.source ?? "Shopify evidence unavailable",
      currency: shopify.currency ?? null,
      usShippingRate: shopify.shippingProfile?.usAndCanada ?? "not recorded",
      internationalShippingRate: shopify.shippingProfile?.international ?? "not recorded",
      publicDeliveryCaveat: shopify.shippingPolicy?.estimateGuaranteed === false
        ? "Shopify's public policy says checkout calculates the estimate and it is not guaranteed."
        : "Delivery caveat not recorded.",
      returnWindow: shopify.returnRules?.returnWindow ?? "not recorded",
      returnAddress: shopify.returnRules?.returnAddress ?? "not recorded",
      cpaStatus: shopify.cpa?.status ?? "not-calculable",
      cpaReason:
        shopify.cpa?.reason ??
        "Shopify order and ad-spend evidence is not sufficient to calculate CPA or allowable CPA.",
    },
    reconciliation: {
      proposedUsShippingSource: "Shopify Admin shipping profile",
      proposedUsShippingWindow: "5-8 business days",
      proposedUsShippingCost: "Free shipping for US/Canada",
      returnPolicySource: "Shopify refund policy page, HTTP 200 verified",
      returnPolicyDestination: "Merchant Center return-policy configuration",
    },
    blockers: [
      ...(shippingMismatch
        ? [
            "Merchant Center currently shows 26-29 days while the Shopify US/Canada rate shows 5-8 business days; reconcile before feed or spend.",
          ]
        : []),
      ...(!returnPolicyReady
        ? ["Merchant Center has no configured return policy."]
        : []),
      ...(accountIssue ? ["Merchant Center reports an active misrepresentation issue."] : []),
      ...(checkoutIssue
        ? [
            `Merchant Center reports a checkout warning for ${merchantCenter.checkoutIssue.productsImpacted ?? "an unknown number of"} US items; Google must recrawl the live product purchase path before feed or spend.`,
          ]
        : []),
      ...(shopify.returnRules?.returnAddress?.includes("not provided")
        ? ["Shopify does not publish a fixed return address; do not invent one."]
        : []),
    ],
    safeActionsTaken: [
      "Read the verified local evidence and the separately captured Merchant Center shipping read-back.",
      "This preview performs no further Merchant Center mutation and does not submit verification or a review request.",
      "No feed was uploaded and no ad spend was enabled.",
    ],
  };
}

async function main() {
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  const preview = buildMerchantCenterPreview(evidence);
  await mkdir(resolve(rootDir, "output"), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(preview, null, 2)}\n`, "utf8");
  process.stdout.write(
    `Merchant Center reconciliation preview written to ${outputPath}\n` +
      `Status: ${preview.status}; blockers: ${preview.blockers.length}. No external mutation performed.\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : error}\n`);
    process.exitCode = 1;
  });
}
