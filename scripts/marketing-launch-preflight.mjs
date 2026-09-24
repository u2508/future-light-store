#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createShopifyAdminGraphQLClient } from "./shopify-admin-graphql-client.mjs";
import { readApprovalManifest } from "./lib/marketing-cohort-approval.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const outputPath = resolve(rootDir, "output", "marketing-launch-preflight.json");
const cohortPath = resolve(rootDir, "output", "marketing-cohort-audit.json");
const approvalPath = resolve(rootDir, "docs", "marketing-cohort-approval.json");
const launchEvidencePath = resolve(rootDir, "docs", "marketing-launch-evidence.json");
const feedPreviewPath = resolve(rootDir, "output", "marketing-google-feed-preview.xml");
const strictMode = process.argv.includes("--strict");
const shopUrl = "https://vs-store-us.myshopify.com";
const activeCapacity = 3000;
const verifiedMetaPixelId = "921792280984136";
const policyRoutes = [
  ["shipping", "/policies/shipping-policy"],
  ["returns", "/policies/refund-policy"],
  ["privacy", "/policies/privacy-policy"],
  ["terms", "/policies/terms-of-service"],
  ["contact", "/policies/contact-information"],
];

function configured(name) {
  return Boolean(String(process.env[name] || "").trim());
}

async function readPolicyStatus() {
  const entries = await Promise.all(
    policyRoutes.map(async ([name, path]) => {
      try {
        const response = await fetch(`${shopUrl}${path}`, {
          redirect: "manual",
          signal: AbortSignal.timeout(15_000),
        });
        return { name, path, status: response.status, ok: response.status === 200 };
      } catch (error) {
        return {
          name,
          path,
          status: null,
          ok: false,
          error: String(error instanceof Error ? error.message : error).slice(0, 240),
        };
      }
    }),
  );
  return entries;
}

function policyText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function readOperationalFacts() {
  const routes = {
    shipping: "/policies/shipping-policy",
    returns: "/policies/refund-policy",
  };
  const pages = await Promise.all(
    Object.entries(routes).map(async ([name, path]) => {
      try {
        const response = await fetch(`${shopUrl}${path}`, {
          redirect: "manual",
          signal: AbortSignal.timeout(15_000),
        });
        return [name, response.ok ? policyText(await response.text()) : ""];
      } catch {
        return [name, ""];
      }
    }),
  );
  const textByPage = Object.fromEntries(pages);
  const shipping = textByPage.shipping || "";
  const returns = textByPage.returns || "";
  return {
    source: shopUrl,
    shipping: {
      processingOneToTwoBusinessDays: /prepared within 1[–-]2 business days/.test(shipping),
      deliveryCalculatedAtCheckout: /calculated at checkout/.test(shipping),
      deliveryEstimateNotGuaranteed: /delivery estimates are not guaranteed/.test(shipping),
      trackingSentAfterDispatch: /order is dispatched.*tracking link|tracking link.*after dispatch/.test(
        shipping,
      ),
      customsCaveatPresent: /customs duties|import taxes/.test(shipping),
    },
    returns: {
      thirtyDayWindow: /return within 30 days after receiving/.test(returns),
      originalPaymentRefund: /original payment method/.test(returns),
      returnDestinationProvidedAfterRequest: /provide the applicable return instructions and destination/.test(
        returns,
      ),
      fixedReturnAddressPublished: /return address|returns address/.test(returns),
    },
  };
}

async function optionalShopifyRead(client, query, operation) {
  try {
    return { status: "pass", data: await client.run(query, {}, { operation }) };
  } catch (error) {
    return {
      status: "blocked",
      // Preserve Shopify's access-scope hint so the launch report is actionable.
      error: String(error instanceof Error ? error.message : error).slice(0, 1000),
    };
  }
}

async function readCohortAudit() {
  try {
    const data = JSON.parse(await readFile(cohortPath, "utf8"));
    return { status: "pass", data };
  } catch (error) {
    return {
      status: "missing",
      data: null,
      error: String(error instanceof Error ? error.message : error).slice(0, 240),
    };
  }
}

async function readApprovalEvidence(cohort) {
  try {
    const approval = await readApprovalManifest(approvalPath);
    const auditByHandle = new Map(
      (Array.isArray(cohort?.candidates) ? cohort.candidates : []).map((candidate) => [
        candidate.handle,
        candidate,
      ]),
    );
    const errors = [...approval.errors];
    for (const handle of approval.handles) {
      const candidate = auditByHandle.get(handle);
      if (!candidate) errors.push(`${handle}: not present in the latest live audit shortlist`);
      else if (candidate.dataEligible !== true)
        errors.push(`${handle}: latest audit is not data-eligible`);
      else if (candidate.copy?.ready !== true)
        errors.push(`${handle}: latest audit copy is not ready`);
    }
    return {
      status: errors.length === 0 ? "pass" : "blocked",
      path: approvalPath,
      approvalId: String(approval.manifest?.approvalId || "") || null,
      handles: approval.handles,
      errors,
    };
  } catch (error) {
    return {
      status: "missing",
      path: approvalPath,
      approvalId: null,
      handles: [],
      errors: [
        `Approval manifest is missing or unreadable: ${String(error instanceof Error ? error.message : error).slice(0, 240)}`,
      ],
    };
  }
}

async function readFeedPreviewEvidence() {
  try {
    await access(feedPreviewPath);
    return { status: "pass", path: feedPreviewPath };
  } catch {
    return { status: "missing", path: feedPreviewPath };
  }
}

async function readLaunchEvidence() {
  try {
    const evidence = JSON.parse(await readFile(launchEvidencePath, "utf8"));
    return { status: "pass", path: launchEvidencePath, evidence, errors: [] };
  } catch (error) {
    return {
      status: "missing",
      path: launchEvidencePath,
      evidence: null,
      errors: [
        `Launch evidence is missing or unreadable: ${String(error instanceof Error ? error.message : error).slice(0, 240)}`,
      ],
    };
  }
}

async function readShopifyAppConfig() {
  const paths = [resolve(rootDir, "shopify.app.toml"), resolve(rootDir, "..", "shopify.app.toml")];
  for (const path of paths) {
    try {
      await access(path);
      return { status: "present", path, paths };
    } catch {
      // Continue checking the sibling app directory.
    }
  }
  return { status: "missing", path: null, paths };
}

async function main() {
  const client = createShopifyAdminGraphQLClient({
    rootDir,
    agentName: "marketing-launch-preflight",
  });

  const [
    shopRead,
    collectionRead,
    webhookRead,
    orderRead,
    marketRead,
    policyStatus,
    operationalFacts,
    cohortRead,
    shopifyAppConfig,
  ] = await Promise.all([
    client.run(
      `query {
        shop { name currencyCode primaryDomain { host } plan { displayName } }
        productsCount(query: "status:ACTIVE") { count precision }
      }`,
      {},
      { operation: "Read live Shopify shop and active product count" },
    ),
    client.run(
      `query {
        collections(first: 250) {
          nodes { id title handle productsCount { count precision } }
        }
      }`,
      {},
      { operation: "Read live Shopify collection counts" },
    ),
    optionalShopifyRead(
      client,
      `query {
        webhookSubscriptions(first: 50) {
          nodes { topic uri }
        }
      }`,
      "Read Shopify webhook subscriptions",
    ),
    optionalShopifyRead(
      client,
      `query { orders(first: 1) { nodes { id } } }`,
      "Read Shopify orders permission",
    ),
    optionalShopifyRead(
      client,
      `query { markets(first: 20) { nodes { id name handle enabled primary } } }`,
      "Read Shopify market settings",
    ),
    readPolicyStatus(),
    readOperationalFacts(),
    readCohortAudit(),
    readShopifyAppConfig(),
  ]);

  const collections = collectionRead.collections?.nodes ?? [];
  const selectedCollections = ["new-arrivals", "best-sellers", "premium-picks"].map((handle) => {
    const collection = collections.find((entry) => entry.handle === handle);
    return {
      handle,
      title: collection?.title ?? null,
      count: collection?.productsCount?.count ?? null,
      present: Boolean(collection),
    };
  });

  const webhooks = webhookRead.data?.webhookSubscriptions?.nodes ?? [];
  const hasOrdersPaidWebhook = webhooks.some((webhook) => webhook.topic === "ORDERS_PAID");
  const activeProductCount = Number(shopRead.productsCount?.count ?? 0);
  const policiesReady = policyStatus.every((entry) => entry.ok);
  const trackingConfig = {
    shopifyWebhookSecret: configured("SHOPIFY_WEBHOOK_SECRET"),
    // The storefront has a verified public fallback; the environment value
    // remains an override for a future account migration.
    metaPixel: configured("VITE_META_PIXEL_ID") || Boolean(verifiedMetaPixelId),
    googleAnalytics: configured("VITE_GOOGLE_ANALYTICS_ID"),
    googleAds: configured("VITE_GOOGLE_ADS_ID"),
    googleAdsConversion:
      configured("VITE_GOOGLE_ADS_CONVERSION_ID") && configured("VITE_GOOGLE_ADS_CONVERSION_LABEL"),
    metaConversionsApiToken: configured("META_CONVERSIONS_API_ACCESS_TOKEN"),
  };
  const cohort = cohortRead.data;
  const approvalEvidence = await readApprovalEvidence(cohort);
  const feedPreviewEvidence = await readFeedPreviewEvidence();
  const launchEvidence = await readLaunchEvidence();
  const evidence = launchEvidence.evidence ?? {};
  const shippingReady = Boolean(
    evidence.shippingPaymentReturns?.shippingVerified &&
    evidence.shippingPaymentReturns?.paymentVerified &&
    evidence.shippingPaymentReturns?.usReturnsVerified,
  );
  const dsersReady = Boolean(
    evidence.dsersFulfillment?.supplierMappingVerified &&
    evidence.dsersFulfillment?.routingVerified &&
    evidence.dsersFulfillment?.shippingRateTestVerified,
  );
  const testOrderReady = Boolean(
    evidence.testOrder?.checkoutCompleted &&
    evidence.testOrder?.confirmationEmailVerified &&
    evidence.testOrder?.webhookReadback &&
    evidence.testOrder?.dsersHandoffVerified &&
    evidence.testOrder?.trackingVerified &&
    evidence.testOrder?.refundVerified,
  );
  const purchaseReadbackReady = Boolean(
    evidence.purchaseTracking?.metaPurchaseReadback &&
    evidence.purchaseTracking?.googlePurchaseReadback,
  );
  const merchantCenterReady = Boolean(
    evidence.merchantCenter?.feedUploaded &&
    evidence.merchantCenter?.feedApproved &&
    evidence.merchantCenter?.liveProductTest,
  );
  const shopifyCommerceReady = Boolean(
    shopRead.shop?.currencyCode === "USD" &&
    evidence.shopifyCommerce?.usMarketVerified &&
    evidence.shopifyCommerce?.paymentProviderVerified &&
    evidence.shopifyCommerce?.taxesVerified &&
    evidence.shopifyCommerce?.payoutsVerified,
  );
  const missingCommerceEvidence = [
    ["US market", evidence.shopifyCommerce?.usMarketVerified],
    ["payment provider", evidence.shopifyCommerce?.paymentProviderVerified],
    ["taxes", evidence.shopifyCommerce?.taxesVerified],
    ["payouts", evidence.shopifyCommerce?.payoutsVerified],
  ].flatMap(([label, ready]) => (ready ? [] : [label]));
  const missingShippingEvidence = [
    ["shipping", evidence.shippingPaymentReturns?.shippingVerified],
    ["payment", evidence.shippingPaymentReturns?.paymentVerified],
    ["US returns", evidence.shippingPaymentReturns?.usReturnsVerified],
  ].flatMap(([label, ready]) => (ready ? [] : [label]));
  const missingDsersEvidence = [
    ["supplier mapping", evidence.dsersFulfillment?.supplierMappingVerified],
    ["order routing", evidence.dsersFulfillment?.routingVerified],
    ["shipping-rate test", evidence.dsersFulfillment?.shippingRateTestVerified],
  ].flatMap(([label, ready]) => (ready ? [] : [label]));
  const missingTestOrderEvidence = [
    ["checkout", evidence.testOrder?.checkoutCompleted],
    ["confirmation email", evidence.testOrder?.confirmationEmailVerified],
    ["webhook readback", evidence.testOrder?.webhookReadback],
    ["DSers handoff", evidence.testOrder?.dsersHandoffVerified],
    ["tracking", evidence.testOrder?.trackingVerified],
    ["refund", evidence.testOrder?.refundVerified],
  ].flatMap(([label, ready]) => (ready ? [] : [label]));
  const cohortCandidates = Array.isArray(cohort?.candidates) ? cohort.candidates : [];
  const productCopyReady =
    cohortCandidates.length >= 12 &&
    cohortCandidates.length <= 18 &&
    cohortCandidates.every((candidate) => candidate.copy?.ready === true);
  const cohortApproved = approvalEvidence.status === "pass";

  const report = {
    schemaVersion: "2026-09-21.vs-store.marketing-launch-preflight.1",
    generatedAt: new Date().toISOString(),
    mode: "read-only",
    shop: shopRead.shop,
    liveSource: shopUrl,
    activeCapacity,
    activeProductCount,
    capacity: {
      status: activeProductCount <= activeCapacity ? "pass" : "blocked",
      remaining: activeCapacity - activeProductCount,
      exact: shopRead.productsCount?.precision === "EXACT",
    },
    selectedCollections,
    allCollections: collections.map((collection) => ({
      id: collection.id,
      title: collection.title,
      handle: collection.handle,
      count: collection.productsCount?.count ?? null,
    })),
    policies: policyStatus,
    operationalFacts,
    webhooks: {
      status: webhookRead.status,
      subscriptions: webhooks,
      ordersPaid: hasOrdersPaidWebhook,
      error: webhookRead.error ?? null,
    },
    orderRead: {
      status: orderRead.status,
      error: orderRead.error ?? null,
    },
    marketRead: {
      status: marketRead.status,
      markets: marketRead.data?.markets?.nodes ?? [],
      error: marketRead.error ?? null,
    },
    shopifyAppConfig,
    trackingConfig,
    advertisingCohort: {
      status: cohortApproved ? "pass" : cohortRead.status === "pass" ? "blocked" : "missing",
      target: "12-18 products, then 3-5 products per ad test cycle",
      candidateCount: Number(cohort?.summary?.candidates ?? 0),
      candidateHandles: (cohort?.candidates ?? []).map((candidate) => candidate.handle),
      approvedHandleCount: approvalEvidence.handles.length,
      approvedHandles: approvalEvidence.handles,
      approvalId: approvalEvidence.approvalId,
      approvalStatus: approvalEvidence.status,
      approvalErrors: approvalEvidence.errors,
      copyReadyCandidateCount: cohortCandidates.filter((candidate) => candidate.copy?.ready).length,
      productCopyReady,
      reason: cohortApproved
        ? null
        : [
            ...approvalEvidence.errors,
            cohort?.approvalGate?.reason ?? "Run marketing:cohort:audit before selecting products.",
            ...(productCopyReady
              ? []
              : ["Selected-product copy is not yet specific and complete for every candidate."]),
          ].join(" "),
      auditPath: cohortPath,
    },
    gates: [
      { id: "policies", status: policiesReady ? "pass" : "blocked" },
      { id: "active-capacity", status: activeProductCount <= activeCapacity ? "pass" : "blocked" },
      {
        id: "selected-collections",
        status: selectedCollections.every((entry) => entry.present) ? "pass" : "blocked",
      },
      {
        id: "orders-paid-webhook",
        status: hasOrdersPaidWebhook ? "pass" : "blocked",
        reason: hasOrdersPaidWebhook
          ? null
          : "No ORDERS_PAID subscription is visible in Shopify; registration remains gated by webhook HMAC configuration.",
      },
      {
        id: "webhook-signature-secret",
        status: trackingConfig.shopifyWebhookSecret ? "pass" : "blocked",
        reason: trackingConfig.shopifyWebhookSecret
          ? null
          : "SHOPIFY_WEBHOOK_SECRET is not present in the launch environment.",
      },
      {
        id: "shopify-commerce-settings",
        status: shopifyCommerceReady ? "pass" : "blocked",
        reason: shopifyCommerceReady
          ? null
          : `USD store currency is confirmed; missing commerce evidence: ${missingCommerceEvidence.join(", ") || "unknown"}.`,
      },
      {
        id: "orders-read-permission",
        status: orderRead.status === "pass" ? "pass" : "blocked",
        reason:
          orderRead.status === "pass"
            ? null
            : orderRead.error?.includes("Access denied for orders field")
              ? "The Shopify CLI store auth is missing the read_orders access scope."
              : orderRead.error || "Shopify order-read verification failed.",
      },
      {
        id: "marketing-identifiers",
        status: trackingConfig.metaPixel && trackingConfig.googleAdsConversion ? "pass" : "pending",
        reason:
          trackingConfig.metaPixel && trackingConfig.googleAdsConversion
            ? null
            : "Meta Pixel and Google Ads conversion identifiers are not both configured in the launch environment.",
      },
      {
        id: "margin-approved-ad-cohort",
        status: cohortApproved ? "pass" : "blocked",
        reason: cohortApproved
          ? null
          : "The 12–18 product shortlist still needs explicit supplier, landed-cost, allowable-CPA, and operator approval.",
      },
      {
        id: "selected-product-copy",
        status: productCopyReady ? "pass" : "blocked",
        reason: productCopyReady
          ? null
          : "Selected products need product-specific, sufficiently detailed copy before ads.",
      },
      {
        id: "purchase-tracking-readback",
        status: purchaseReadbackReady ? "pass" : "blocked",
        reason: purchaseReadbackReady
          ? null
          : "Meta and Google paid/test-order readback is not recorded.",
      },
      {
        id: "merchant-center-feed",
        status: merchantCenterReady ? "pass" : "blocked",
        reason: merchantCenterReady
          ? null
          : feedPreviewEvidence.status === "pass"
            ? "Local feed preview exists, but Merchant Center upload, approval, and live product test are not recorded."
            : "Merchant Center feed preview, approval, and live product test are not recorded.",
      },
      {
        id: "shipping-payment-returns",
        status: shippingReady ? "pass" : "blocked",
        reason: shippingReady
          ? null
          : `Missing shipping/payment/returns evidence: ${missingShippingEvidence.join(", ") || "unknown"}.`,
      },
      {
        id: "dsers-fulfillment-mapping",
        status: dsersReady ? "pass" : "blocked",
        reason: dsersReady
          ? null
          : `Missing DSers evidence: ${missingDsersEvidence.join(", ") || "unknown"}.`,
      },
      {
        id: "test-order",
        status: testOrderReady ? "pass" : "blocked",
        reason: testOrderReady
          ? null
          : `Missing controlled test-order evidence: ${missingTestOrderEvidence.join(", ") || "unknown"}.`,
      },
    ],
    safeActionsTaken: [
      "No Shopify mutation was sent.",
      "No product was imported or added through DSers.",
      "No ad campaign was enabled and no production test order was placed.",
      "Unsigned Shopify webhook deliveries are rejected by the local handler.",
    ],
    cohortApproval: approvalEvidence,
    merchantFeedPreview: feedPreviewEvidence,
    launchEvidence,
  };

  await mkdir(resolve(rootDir, "output"), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const blocked = report.gates.filter((gate) => gate.status === "blocked").length;
  process.stdout.write(
    `Marketing launch preflight written to ${outputPath}\n` +
      `Live active products: ${activeProductCount}/${activeCapacity}; selected collections present: ${selectedCollections.filter((entry) => entry.present).length}/3; blocked gates: ${blocked}.\n`,
  );
  if (strictMode && blocked > 0) process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : error}\n`);
  process.exitCode = 1;
});
