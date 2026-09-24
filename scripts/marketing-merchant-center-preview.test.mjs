import test from "node:test";
import assert from "node:assert/strict";

import { buildMerchantCenterPreview } from "./marketing-merchant-center-preview.mjs";

test("builds a blocked preview when Google shipping and Shopify rates disagree", () => {
  const preview = buildMerchantCenterPreview({
    sourceFacts: {
      shopify: {
        source: "Shopify read-only evidence",
        currency: "USD",
        cpa: {
          status: "not-calculable",
          reason: "No paid-order or ad-spend evidence.",
        },
        shippingProfile: {
          usAndCanada: "free shipping, 5-8 business days",
          international: "economy, $5, 5-8 business days",
        },
        shippingPolicy: { estimateGuaranteed: false },
        returnRules: {
          returnWindow: "30 days",
          returnAddress: "not provided in the Shopify policy",
        },
      },
      googleMerchantCenter: {
        accountId: "5840088121",
        status: "returns-policy-missing-and-misrepresentation-issue",
        returnPolicyConfigured: false,
        shippingPolicy: {
          merchantCenterVisibleWindow: "26-29 days",
          status: "mismatch-needs-reconciliation-before-feed-or-spend",
        },
      },
    },
  });

  assert.equal(preview.status, "blocked");
  assert.equal(preview.merchantCenter.returnPolicyConfigured, false);
  assert.equal(preview.shopify.cpaStatus, "not-calculable");
  assert.equal(preview.reconciliation.proposedUsShippingWindow, "5-8 business days");
  assert.equal(preview.blockers.length, 4);
});

test("keeps a reconciled, policy-complete evidence set reviewable", () => {
  const preview = buildMerchantCenterPreview({
    sourceFacts: {
      shopify: {
        currency: "USD",
        shippingProfile: { usAndCanada: "free shipping, 5-8 business days" },
        shippingPolicy: { estimateGuaranteed: false },
        returnRules: { returnWindow: "30 days", returnAddress: "provided" },
      },
      googleMerchantCenter: {
        accountId: "5840088121",
        status: "ready",
        returnPolicyConfigured: true,
        shippingPolicy: { status: "reconciled", merchantCenterVisibleWindow: "5-8 days" },
      },
    },
  });

  assert.equal(preview.status, "ready-for-review");
  assert.deepEqual(preview.blockers, []);
});

test("keeps a checkout warning blocked until Google recrawls the live purchase path", () => {
  const preview = buildMerchantCenterPreview({
    sourceFacts: {
      shopify: {
        shippingProfile: { usAndCanada: "free shipping, 5-8 business days" },
        shippingPolicy: { estimateGuaranteed: false },
        returnRules: { returnWindow: "30 days", returnAddress: "provided" },
      },
      googleMerchantCenter: {
        status: "ready",
        returnPolicyConfigured: true,
        shippingPolicy: { status: "reconciled", merchantCenterVisibleWindow: "5-8 days" },
        checkoutIssue: { status: "warning", productsImpacted: 32176 },
      },
    },
  });

  assert.equal(preview.status, "blocked");
  assert.equal(preview.blockers.length, 1);
  assert.match(preview.blockers[0], /32176/);
});
